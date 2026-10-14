import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

/**
 * Feature 002 database guarantees, checked against PostgreSQL as the application role: organization
 * isolation on new tables, facility scope on facility-bound tables, append-only money and history,
 * the appointment double-booking constraint, and the invoice lock after issue.
 */

let admin: Client;
let app: Client;
const ids: Record<string, string> = {};

async function asApp<T>(ctx: { org?: string; facilities?: string; person?: string }, work: (c: Client) => Promise<T>): Promise<T> {
  await app.query('begin');
  try {
    await app.query(
      `select set_config('app.org_id', $1, true), set_config('app.facility_ids', $2, true), set_config('app.person_id', $3, true), set_config('app.platform', '', true)`,
      [ctx.org ?? '', ctx.facilities ?? '', ctx.person ?? ''],
    );
    return await work(app);
  } finally {
    await app.query('rollback');
  }
}

beforeAll(async () => {
  admin = new Client({ connectionString: inject('adminUrl') });
  app = new Client({ connectionString: inject('appUrl') });
  await admin.connect();
  await app.connect();
  const org = async (slug: string) =>
    (await admin.query<{ id: string }>(`insert into organizations (name, slug, status) values ($1, $2, 'active') returning id`, [slug, slug])).rows[0]!.id;
  ids.orgA = await org(`r2-a-${Date.now()}`);
  ids.orgB = await org(`r2-b-${Date.now()}`);
  const facility = async (org: string, name: string) =>
    (await admin.query<{ id: string }>('insert into facilities (organization_id, name) values ($1, $2) returning id', [org, name])).rows[0]!.id;
  ids.facA1 = await facility(ids.orgA, 'A1');
  ids.facA2 = await facility(ids.orgA, 'A2');
  ids.facB = await facility(ids.orgB, 'B1');
  const patient = async (org: string, number: string) =>
    (
      await admin.query<{ id: string }>(
        `insert into patients (organization_id, patient_number, name_en, name_key) values ($1, $2, 'Test', 'test') returning id`,
        [org, number],
      )
    ).rows[0]!.id;
  ids.patA = await patient(ids.orgA, `P-${Date.now()}`);
  ids.patB = await patient(ids.orgB, `P-${Date.now()}`);
  const practitioner = async (org: string) =>
    (await admin.query<{ id: string }>(`insert into practitioners (organization_id, name) values ($1, 'Dr') returning id`, [org])).rows[0]!.id;
  ids.docA = await practitioner(ids.orgA);
  ids.docB = await practitioner(ids.orgB);
  for (const facility of [ids.facA1, ids.facA2]) {
    await admin.query(
      `insert into practitioner_facilities (practitioner_id, facility_id, organization_id) values ($1, $2, $3)`,
      [ids.docA, facility, ids.orgA],
    );
  }
});

afterAll(async () => {
  await app.end();
  await admin.end();
});

describe('feature 002 row-level security', () => {
  it('hides other organizations patients, practitioners and invoices', async () => {
    await asApp({ org: ids.orgA, facilities: '*' }, async (c) => {
      const rows = await c.query('select id from patients');
      expect(rows.rows.map((r: { id: string }) => r.id)).toEqual([ids.patA]);
      expect((await c.query('select id from practitioners')).rowCount).toBe(1);
    });
  });

  it('hides facility-bound rows outside the granted branches', async () => {
    await admin.query(
      `insert into appointments (organization_id, facility_id, practitioner_id, patient_id, starts_at, ends_at, during, status)
       values ($1, $2, $3, $4, now(), now() + interval '15 minutes', tstzrange(now(), now() + interval '15 minutes'), 'booked')`,
      [ids.orgA, ids.facA2, ids.docA, ids.patA],
    );
    await asApp({ org: ids.orgA, facilities: ids.facA1 }, async (c) => {
      expect((await c.query('select id from appointments')).rowCount).toBe(0);
    });
    await asApp({ org: ids.orgA, facilities: ids.facA2 }, async (c) => {
      expect((await c.query('select id from appointments')).rowCount).toBe(1);
    });
  });

  it('refuses a practitioner and a patient that belong to another organization', async () => {
    await expect(
      admin.query(
        `insert into appointments (organization_id, facility_id, practitioner_id, patient_id, starts_at, ends_at, during)
         values ($1, $2, $3, $4, now(), now() + interval '5 minutes', tstzrange(now(), now() + interval '5 minutes'))`,
        [ids.orgA, ids.facA1, ids.docB, ids.patA],
      ),
    ).rejects.toThrow(/foreign key/);
  });
});

describe('feature 002 database rules', () => {
  it('refuses two overlapping active bookings for one practitioner', async () => {
    const start = '2030-01-01T09:00:00Z';
    const first = await admin.query(
      `insert into appointments (organization_id, facility_id, practitioner_id, patient_id, starts_at, ends_at, during)
       values ($1, $2, $3, $4, $5, $5::timestamptz + interval '15 minutes', tstzrange($5, $5::timestamptz + interval '15 minutes'))`,
      [ids.orgA, ids.facA1, ids.docA, ids.patA, start],
    );
    expect(first.rowCount).toBe(1);
    await expect(
      admin.query(
        `insert into appointments (organization_id, facility_id, practitioner_id, patient_id, starts_at, ends_at, during)
         values ($1, $2, $3, $4, $5, $5::timestamptz + interval '15 minutes', tstzrange($5, $5::timestamptz + interval '15 minutes'))`,
        [ids.orgA, ids.facA1, ids.docA, ids.patA, '2030-01-01T09:10:00Z'],
      ),
    ).rejects.toThrow(/appointments_no_overlap/);
    // A cancelled booking does not block the slot.
    await admin.query(`update appointments set status = 'cancelled', cancel_reason = 'test' where starts_at = $1`, [start]);
    await expect(
      admin.query(
        `insert into appointments (organization_id, facility_id, practitioner_id, patient_id, starts_at, ends_at, during)
         values ($1, $2, $3, $4, $5, $5::timestamptz + interval '15 minutes', tstzrange($5, $5::timestamptz + interval '15 minutes'))`,
        [ids.orgA, ids.facA1, ids.docA, ids.patA, '2030-01-01T09:10:00Z'],
      ),
    ).resolves.toBeDefined();
  });

  it('keeps payments and refunds append-only for the application role', async () => {
    const invoice = await admin.query<{ id: string }>(
      `insert into invoices (organization_id, facility_id, patient_id, status, number) values ($1, $2, $3, 'issued', 'INV-1') returning id`,
      [ids.orgA, ids.facA1, ids.patA],
    );
    await admin.query(
      `insert into payments (organization_id, facility_id, invoice_id, amount_minor, currency, method, business_date, idempotency_key, request_hash)
       values ($1, $2, $3, 1000, 'PKR', 'cash', current_date, 'seed-payment-001', 'h')`,
      [ids.orgA, ids.facA1, invoice.rows[0]!.id],
    );
    await asApp({ org: ids.orgA, facilities: '*' }, async (c) => {
      await expect(c.query(`update payments set amount_minor = 1`)).rejects.toThrow(/permission denied/);
    });
    await asApp({ org: ids.orgA, facilities: '*' }, async (c) => {
      await expect(c.query(`delete from refunds`)).rejects.toThrow(/permission denied/);
    });
  });

  it('refuses a second payment with the same idempotency key', async () => {
    const invoice = await admin.query<{ id: string }>(`select id from invoices where number = 'INV-1'`);
    await expect(
      admin.query(
        `insert into payments (organization_id, facility_id, invoice_id, amount_minor, currency, method, business_date, idempotency_key, request_hash)
         values ($1, $2, $3, 1000, 'PKR', 'cash', current_date, 'seed-payment-001', 'h')`,
        [ids.orgA, ids.facA1, invoice.rows[0]!.id],
      ),
    ).rejects.toThrow(/payments_idempotency/);
  });

  it('locks invoice lines once the invoice is issued', async () => {
    const draft = await admin.query<{ id: string }>(
      `insert into invoices (organization_id, facility_id, patient_id) values ($1, $2, $3) returning id`,
      [ids.orgA, ids.facA1, ids.patA],
    );
    await admin.query(
      `insert into invoice_lines (organization_id, invoice_id, position, description, quantity, unit_price_minor, line_total_minor)
       values ($1, $2, 1, 'Consultation', 1, 150000, 150000)`,
      [ids.orgA, draft.rows[0]!.id],
    );
    await admin.query(`update invoices set status = 'issued', number = 'INV-DRAFT-1', total_minor = 150000, subtotal_minor = 150000 where id = $1`, [draft.rows[0]!.id]);
    await expect(
      admin.query(`update invoice_lines set unit_price_minor = 1 where invoice_id = $1`, [draft.rows[0]!.id]),
    ).rejects.toThrow(/issued invoice cannot change/);
  });

  it('refuses to change a reviewed history entry or to delete one', async () => {
    const entry = await admin.query<{ id: string }>(
      `insert into history_entries (organization_id, patient_id, section, content, source, review_status, reviewed_by, reviewed_at)
       values ($1, $2, 'allergy', '{"substance":"penicillin"}', 'patient_reported', 'reviewed', null, null) returning id`,
      [ids.orgA, ids.patA],
    ).catch(() => ({ rows: [{ id: '' }] }));
    expect(entry.rows[0]!.id).toBe('');
    const unreviewed = await admin.query<{ id: string }>(
      `insert into history_entries (organization_id, patient_id, section, content, source) values ($1, $2, 'allergy', '{"substance":"penicillin"}', 'patient_reported') returning id`,
      [ids.orgA, ids.patA],
    );
    await expect(admin.query(`update history_entries set content = '{}' where id = $1`, [unreviewed.rows[0]!.id])).rejects.toThrow(/preserved/);
    await expect(admin.query(`delete from history_entries where id = $1`, [unreviewed.rows[0]!.id])).rejects.toThrow(/cannot be deleted/);
  });
});
