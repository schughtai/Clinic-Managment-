import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { type TestApp, addStaff, signUpClinic, startTestApp, type SignedInClinic } from './support/app';

let testApp: TestApp;

beforeAll(async () => {
  testApp = await startTestApp();
});

afterAll(async () => {
  await testApp.close();
});

interface PatientBody {
  id: string;
  patientNo: number;
  name: string;
  phone: string | null;
  age: number | null;
}
interface ListBody {
  items: PatientBody[];
  total: number;
}
interface ErrorBody {
  error: { code: string; details?: { candidates?: PatientBody[] } };
}

async function addPatient(clinic: SignedInClinic, body: Record<string, unknown>): Promise<PatientBody> {
  const response = await clinic.agent.post('/api/patients').send(body);
  if (response.status !== 201) throw new Error(`Could not add patient: ${response.status} ${JSON.stringify(response.body)}`);
  return response.body as PatientBody;
}

async function names(clinic: SignedInClinic, q: string): Promise<string[]> {
  const response = await clinic.agent.get('/api/patients').query({ q });
  expect(response.status).toBe(200);
  return (response.body as ListBody).items.map((patient) => patient.name).sort();
}

describe('creating patients', () => {
  it('stores details and turns an age into a birth year', async () => {
    const clinic = await signUpClinic(testApp);
    const patient = await addPatient(clinic, {
      name: 'Ayesha Khan',
      phone: '0300 1112223',
      gender: 'female',
      age: 34,
      allergies: 'Penicillin',
    });
    expect(patient).toMatchObject({ patientNo: 1, name: 'Ayesha Khan', phone: '923001112223', age: 34 });
  });

  it('numbers patients one by one for each clinic, even when created at the same moment', async () => {
    const clinic = await signUpClinic(testApp);
    const other = await signUpClinic(testApp);
    const created = await Promise.all(Array.from({ length: 10 }, (_, index) => addPatient(clinic, { name: `Parallel ${index}` })));
    expect(created.map((patient) => patient.patientNo).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect((await addPatient(other, { name: 'First elsewhere' })).patientNo).toBe(1);
  });

  it('warns about a likely duplicate and lets the receptionist confirm', async () => {
    const clinic = await signUpClinic(testApp);
    const first = await addPatient(clinic, { name: 'Muhammad Ali', phone: '03004445556' });

    const again = await clinic.agent.post('/api/patients').send({ name: 'Mohammed Ali', phone: '0300 4445556' });
    expect(again.status).toBe(409);
    const body = again.body as ErrorBody;
    expect(body.error.code).toBe('possible_duplicate');
    expect(body.error.details?.candidates?.map((patient) => patient.id)).toEqual([first.id]);

    const confirmed = await clinic.agent.post('/api/patients').send({ name: 'Mohammed Ali', phone: '0300 4445556', confirmDuplicate: true });
    expect(confirmed.status).toBe(201);
  });

  it('allows relatives who share a phone number', async () => {
    const clinic = await signUpClinic(testApp);
    await addPatient(clinic, { name: 'Zainab Bibi', phone: '03004445557' });
    const sibling = await clinic.agent.post('/api/patients').send({ name: 'Usman Ahmed', phone: '03004445557' });
    expect(sibling.status).toBe(201);
  });

  it('rejects unknown fields and invalid values', async () => {
    const clinic = await signUpClinic(testApp);
    const attempts: Record<string, unknown>[] = [
      { name: '' },
      { name: 'A', phone: '12' },
      { name: 'A', age: 200 },
      { name: 'A', age: 1.5 },
      { name: 'A', gender: 'robot' },
      { name: 'A', clinicId: '00000000-0000-4000-8000-000000000000' },
      { name: 'A', patientNo: 99 },
      { name: 'x'.repeat(121) },
    ];
    for (const body of attempts) {
      const response = await clinic.agent.post('/api/patients').send(body);
      expect(response.status, JSON.stringify(body)).toBe(400);
    }
  });

  it('is open to every role in the clinic', async () => {
    const owner = await signUpClinic(testApp);
    const doctor = await addStaff(testApp, owner, 'doctor');
    const reception = await addStaff(testApp, owner, 'receptionist');
    expect((await doctor.agent.post('/api/patients').send({ name: 'By Doctor' })).status).toBe(201);
    expect((await reception.agent.post('/api/patients').send({ name: 'By Reception' })).status).toBe(201);
    expect(((await owner.agent.get('/api/patients')).body as ListBody).total).toBe(2);
  });

  it('refuses people who are not signed in', async () => {
    expect((await testApp.anonymous().post('/api/patients').send({ name: 'Nobody' })).status).toBe(401);
    expect((await testApp.anonymous().get('/api/patients')).status).toBe(401);
  });
});

describe('searching patients', () => {
  let clinic: SignedInClinic;

  beforeAll(async () => {
    clinic = await signUpClinic(testApp);
    for (const [name, phone] of [
      ['Muhammad Ali', '03001230001'],
      ['Mohammed Aslam', '03001230002'],
      ['Fatima Bibi', '03001230003'],
      ['علی خان', '03001230004'],
      ['Qasim Raza', '03001230005'],
      ['Sana Mohammad', '03211230006'],
    ] as const) {
      await addPatient(clinic, { name, phone });
    }
  });

  it('finds the same person under different Roman Urdu spellings', async () => {
    expect(await names(clinic, 'mohamad')).toEqual(['Mohammed Aslam', 'Muhammad Ali', 'Sana Mohammad']);
    expect(await names(clinic, 'fatema')).toEqual(['Fatima Bibi']);
    expect(await names(clinic, 'kasim')).toEqual(['Qasim Raza']);
  });

  it('matches every word typed, in any order', async () => {
    expect(await names(clinic, 'ali muhammad')).toEqual(['Muhammad Ali']);
    expect(await names(clinic, 'bibi fatima')).toEqual(['Fatima Bibi']);
  });

  it('finds names written in Urdu script', async () => {
    expect(await names(clinic, 'علی')).toEqual(['علی خان']);
  });

  it('finds by part of a phone number and by patient number', async () => {
    expect(await names(clinic, '0003')).toEqual(['Fatima Bibi']);
    expect(await names(clinic, '+92 321 123')).toEqual(['Sana Mohammad']);
    expect(await names(clinic, '2')).toEqual(['Mohammed Aslam']);
  });

  it('lists everyone for an empty search and supports paging', async () => {
    const all = await clinic.agent.get('/api/patients').query({ limit: 4 });
    expect((all.body as ListBody).total).toBe(6);
    expect((all.body as ListBody).items).toHaveLength(4);
    const next = await clinic.agent.get('/api/patients').query({ limit: 4, offset: 4 });
    expect((next.body as ListBody).items).toHaveLength(2);
  });

  it('treats special characters as plain text', async () => {
    expect(await names(clinic, '%')).toEqual([]);
    expect(await names(clinic, '_')).toEqual([]);
    expect(await names(clinic, "'; drop table patients; --")).toEqual([]);
    expect(((await clinic.agent.get('/api/patients')).body as ListBody).total).toBe(6);
  });

  it('puts names that start with the search first', async () => {
    const response = await clinic.agent.get('/api/patients').query({ q: 'moh' });
    const ordered = (response.body as ListBody).items.map((patient) => patient.name);
    // Only "Mohammed Aslam" starts with what was typed, so it comes before names that merely contain it.
    expect(ordered[0]).toBe('Mohammed Aslam');
    expect(ordered).toContain('Sana Mohammad');
  });

  it('rejects absurd page sizes', async () => {
    expect((await clinic.agent.get('/api/patients').query({ limit: 1000 })).status).toBe(400);
    expect((await clinic.agent.get('/api/patients').query({ offset: -1 })).status).toBe(400);
  });
});

describe('reading and changing a patient', () => {
  it('updates details, keeps search working after a rename and clears fields with null', async () => {
    const clinic = await signUpClinic(testApp);
    const patient = await addPatient(clinic, { name: 'Old Name', phone: '03005550001', age: 20 });
    const updated = await clinic.agent.patch(`/api/patients/${patient.id}`).send({ name: 'Shahid Mahmood', phone: null, age: 21 });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ name: 'Shahid Mahmood', phone: null, age: 21 });
    expect(await names(clinic, 'shahed')).toEqual(['Shahid Mahmood']);
    expect(await names(clinic, 'old')).toEqual([]);
  });

  it('refuses unknown fields on update', async () => {
    const clinic = await signUpClinic(testApp);
    const patient = await addPatient(clinic, { name: 'Strict' });
    expect((await clinic.agent.patch(`/api/patients/${patient.id}`).send({ patientNo: 5 })).status).toBe(400);
    expect((await clinic.agent.patch(`/api/patients/${patient.id}`).send({ clinicId: patient.id })).status).toBe(400);
  });

  it('records who opened a patient record', async () => {
    const clinic = await signUpClinic(testApp);
    const patient = await addPatient(clinic, { name: 'Audited' });
    expect((await clinic.agent.get(`/api/patients/${patient.id}`)).status).toBe(200);

    const admin = new Client({ connectionString: inject('adminUrl') });
    await admin.connect();
    try {
      const rows = await admin.query<{ action: string; user_id: string | null }>(
        "select action, user_id from audit_log where entity_id = $1 and action in ('patient.created', 'patient.viewed') order by id",
        [patient.id],
      );
      expect(rows.rows.map((row) => row.action)).toEqual(['patient.created', 'patient.viewed']);
      expect(rows.rows.every((row) => row.user_id !== null)).toBe(true);
    } finally {
      await admin.end();
    }
  });

  it('returns 404 for a missing patient and 400 for a malformed id', async () => {
    const clinic = await signUpClinic(testApp);
    expect((await clinic.agent.get('/api/patients/00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await clinic.agent.get('/api/patients/not-a-uuid')).status).toBe(400);
  });
});

describe('patient privacy between clinics', () => {
  it('never exposes, finds or changes another clinic\'s patients', async () => {
    const clinicA = await signUpClinic(testApp, 'A');
    const clinicB = await signUpClinic(testApp, 'B');
    const secret = await addPatient(clinicA, { name: 'Confidential Person', phone: '03007770001', allergies: 'secret' });

    expect((await clinicB.agent.get(`/api/patients/${secret.id}`)).status).toBe(404);
    expect((await clinicB.agent.patch(`/api/patients/${secret.id}`).send({ name: 'Taken' })).status).toBe(404);
    expect(await names(clinicB, 'confidential')).toEqual([]);
    expect(await names(clinicB, '0007')).toEqual([]);
    expect(((await clinicB.agent.get('/api/patients')).body as ListBody).total).toBe(0);
    expect((await clinicA.agent.get(`/api/patients/${secret.id}`)).status).toBe(200);
  });
});
