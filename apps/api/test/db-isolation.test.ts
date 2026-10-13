import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

/**
 * These tests talk to the real database as the restricted application role.
 * They prove that row-level security, not application code, keeps clinics apart.
 */

let app: Client;
let clinicA: { clinicId: string; userId: string };
let clinicB: { clinicId: string; userId: string };

async function inClinic<T>(clinicId: string | null, work: () => Promise<T>): Promise<T> {
  await app.query('begin');
  try {
    if (clinicId !== null) await app.query("select set_config('app.clinic_id', $1, true)", [clinicId]);
    const result = await work();
    await app.query('commit');
    return result;
  } catch (error) {
    await app.query('rollback');
    throw error;
  }
}

async function register(name: string, phone: string): Promise<{ clinicId: string; userId: string }> {
  const result = await app.query<{ clinic_id: string; user_id: string }>(
    'select * from register_clinic($1, $2, $3, $4)',
    [name, `${name} owner`, phone, 'not-a-real-hash'],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error('register_clinic returned nothing');
  return { clinicId: row.clinic_id, userId: row.user_id };
}

beforeAll(async () => {
  app = new Client({ connectionString: inject('appUrl') });
  await app.connect();
  clinicA = await register('Clinic A', '923001110001');
  clinicB = await register('Clinic B', '923001110002');
  for (const clinic of [clinicA, clinicB]) {
    await inClinic(clinic.clinicId, () =>
      app.query(
        "insert into patients (clinic_id, patient_no, name, name_key) values ($1::uuid, 1, 'Patient of ' || $1::text, ' p')",
        [clinic.clinicId],
      ),
    );
  }
});

afterAll(async () => {
  await app.end();
});

describe('application role', () => {
  it('is not a superuser and cannot bypass row-level security', async () => {
    const result = await app.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      'select rolsuper, rolbypassrls from pg_roles where rolname = current_user',
    );
    expect(result.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it('sees nothing when no clinic is set', async () => {
    const patients = await inClinic(null, () => app.query('select id from patients'));
    expect(patients.rowCount).toBe(0);
    const users = await inClinic(null, () => app.query('select id from users'));
    expect(users.rowCount).toBe(0);
  });

  it('sees only its own clinic rows', async () => {
    const rows = await inClinic(clinicA.clinicId, () =>
      app.query<{ clinic_id: string }>('select clinic_id from patients'),
    );
    expect(rows.rows.map((row) => row.clinic_id)).toEqual([clinicA.clinicId]);
  });

  it('cannot read another clinic by id even when it knows the id', async () => {
    const rows = await inClinic(clinicA.clinicId, () =>
      app.query('select id from clinics where id = $1', [clinicB.clinicId]),
    );
    expect(rows.rowCount).toBe(0);
  });

  it('cannot write rows that belong to another clinic', async () => {
    await expect(
      inClinic(clinicA.clinicId, () =>
        app.query("insert into patients (clinic_id, patient_no, name, name_key) values ($1, 2, 'Intruder', ' i')", [
          clinicB.clinicId,
        ]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('cannot update or delete another clinic rows', async () => {
    const updated = await inClinic(clinicA.clinicId, () =>
      app.query("update patients set name = 'Hacked' where clinic_id = $1", [clinicB.clinicId]),
    );
    expect(updated.rowCount).toBe(0);
    const deleted = await inClinic(clinicA.clinicId, () =>
      app.query('delete from patients where clinic_id = $1', [clinicB.clinicId]),
    );
    expect(deleted.rowCount).toBe(0);
  });

  it('cannot create or delete clinics directly', async () => {
    await expect(
      inClinic(clinicA.clinicId, () => app.query("insert into clinics (name) values ('Sneaky')")),
    ).rejects.toThrow(/permission denied/);
    await expect(
      inClinic(clinicA.clinicId, () => app.query('delete from clinics where id = $1', [clinicA.clinicId])),
    ).rejects.toThrow(/permission denied/);
  });

  it('cannot change or remove audit entries', async () => {
    await inClinic(clinicA.clinicId, () =>
      app.query("insert into audit_log (clinic_id, action) values ($1, 'test.event')", [clinicA.clinicId]),
    );
    await expect(
      inClinic(clinicA.clinicId, () => app.query("update audit_log set action = 'edited'")),
    ).rejects.toThrow(/permission denied/);
    await expect(inClinic(clinicA.clinicId, () => app.query('delete from audit_log'))).rejects.toThrow(
      /permission denied/,
    );
  });
});

describe('sign-in functions', () => {
  it('finds a user by phone without knowing the clinic', async () => {
    const result = await inClinic(null, () =>
      app.query<{ clinic_id: string; role: string }>('select * from auth_find_user($1)', ['923001110001']),
    );
    expect(result.rows[0]?.clinic_id).toBe(clinicA.clinicId);
    expect(result.rows[0]?.role).toBe('owner');
  });

  it('locks an account after repeated failures and clears the lock on success', async () => {
    await inClinic(null, async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await app.query('select auth_record_login($1, false, 3, 15)', [clinicB.userId]);
      }
    });
    const locked = await inClinic(null, () =>
      app.query<{ locked_until: Date | null }>('select locked_until from auth_find_user($1)', ['923001110002']),
    );
    expect(locked.rows[0]?.locked_until).not.toBeNull();

    await inClinic(null, () => app.query('select auth_record_login($1, true, 3, 15)', [clinicB.userId]));
    const cleared = await inClinic(null, () =>
      app.query<{ locked_until: Date | null }>('select locked_until from auth_find_user($1)', ['923001110002']),
    );
    expect(cleared.rows[0]?.locked_until).toBeNull();
  });

  it('rejects a second clinic owner with the same phone number', async () => {
    await expect(register('Clinic C', '923001110001')).rejects.toThrow(/users_phone_unique/);
  });
});

describe('appointment overlap rule', () => {
  it('rejects two overlapping booked slots for one doctor but allows other doctors and walk-ins', async () => {
    const { clinicId } = clinicA;
    const ids = await inClinic(clinicId, async () => {
      const patient = await app.query<{ id: string }>('select id from patients limit 1');
      const doctorOne = await app.query<{ id: string }>(
        "insert into doctors (clinic_id, name) values ($1, 'Dr One') returning id",
        [clinicId],
      );
      const doctorTwo = await app.query<{ id: string }>(
        "insert into doctors (clinic_id, name) values ($1, 'Dr Two') returning id",
        [clinicId],
      );
      return { patient: patient.rows[0]?.id, one: doctorOne.rows[0]?.id, two: doctorTwo.rows[0]?.id };
    });

    const book = (doctor: string | undefined, start: string, end: string, kind = 'appointment'): Promise<unknown> =>
      inClinic(clinicId, () =>
        app.query(
          'insert into appointments (clinic_id, patient_id, doctor_id, starts_at, ends_at, kind) values ($1, $2, $3, $4, $5, $6)',
          [clinicId, ids.patient, doctor, start, end, kind],
        ),
      );

    await book(ids.one, '2030-01-01T09:00:00Z', '2030-01-01T09:15:00Z');
    await expect(book(ids.one, '2030-01-01T09:10:00Z', '2030-01-01T09:25:00Z')).rejects.toThrow(
      /appointments_no_overlap/,
    );
    await book(ids.one, '2030-01-01T09:15:00Z', '2030-01-01T09:30:00Z');
    await book(ids.two, '2030-01-01T09:00:00Z', '2030-01-01T09:15:00Z');
    await book(ids.one, '2030-01-01T09:05:00Z', '2030-01-01T09:20:00Z', 'walkin');
  });
});
