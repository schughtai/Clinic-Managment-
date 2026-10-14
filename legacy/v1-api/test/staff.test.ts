import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findOverlap } from '../src/modules/doctors/doctors.service';
import { type TestApp, addStaff, signUpClinic, startTestApp } from './support/app';

let testApp: TestApp;

beforeAll(async () => {
  testApp = await startTestApp();
});

afterAll(async () => {
  await testApp.close();
});

interface DoctorBody {
  id: string;
  name: string;
  active: boolean;
  defaultFee: number;
  slotMinutes: number;
  schedule: { weekday: number; start: string; end: string }[];
}

describe('clinic settings', () => {
  it('lets the owner update details and clears optional fields', async () => {
    const owner = await signUpClinic(testApp);
    const updated = await owner.agent
      .patch('/api/clinic')
      .send({ name: 'Noor Clinic', city: 'Lahore', address: '12 Main Road', phone: '0321 1234567', locale: 'ur', aiEnabled: true });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({
      name: 'Noor Clinic',
      city: 'Lahore',
      phone: '923211234567',
      locale: 'ur',
      aiEnabled: true,
      aiAvailable: false,
    });

    const cleared = await owner.agent.patch('/api/clinic').send({ city: null, address: '' });
    expect(cleared.body).toMatchObject({ city: null, address: null });
  });

  it('rejects invalid values', async () => {
    const owner = await signUpClinic(testApp);
    expect((await owner.agent.patch('/api/clinic').send({ locale: 'fr' })).status).toBe(400);
    expect((await owner.agent.patch('/api/clinic').send({ phone: '12' })).status).toBe(400);
    expect((await owner.agent.patch('/api/clinic').send({ name: '   ' })).status).toBe(400);
  });

  it('does not let the owner switch on modules or change the clinic id through the API', async () => {
    const owner = await signUpClinic(testApp);
    const response = await owner.agent.patch('/api/clinic').send({ modules: ['lab'], id: '00000000-0000-4000-8000-000000000000' });
    expect(response.status).toBe(200);
    expect((response.body as { modules: string[] }).modules).toEqual([]);
  });
});

describe('doctors', () => {
  it('creates a doctor profile automatically for a doctor account', async () => {
    const owner = await signUpClinic(testApp);
    await addStaff(testApp, owner, 'doctor', 'Dr Sara');
    const list = await owner.agent.get('/api/doctors');
    expect((list.body as DoctorBody[]).map((doctor) => doctor.name)).toEqual(['Dr Sara']);
  });

  it('manages a doctor profile and hides inactive doctors from other roles', async () => {
    const owner = await signUpClinic(testApp);
    const reception = await addStaff(testApp, owner, 'receptionist');
    const created = await owner.agent.post('/api/doctors').send({ name: 'Dr Visiting', specialty: 'ENT', defaultFee: 1500, slotMinutes: 20 });
    expect(created.status).toBe(201);
    const doctor = created.body as DoctorBody;
    expect(doctor).toMatchObject({ defaultFee: 1500, slotMinutes: 20, active: true, schedule: [] });

    expect((await owner.agent.patch(`/api/doctors/${doctor.id}`).send({ active: false })).status).toBe(200);
    expect(((await reception.agent.get('/api/doctors')).body as DoctorBody[]).length).toBe(0);
    expect(((await reception.agent.get('/api/doctors?includeInactive=true')).body as DoctorBody[]).length).toBe(0);
    expect(((await owner.agent.get('/api/doctors?includeInactive=true')).body as DoctorBody[]).length).toBe(1);
  });

  it('rejects out-of-range fees and slot lengths', async () => {
    const owner = await signUpClinic(testApp);
    expect((await owner.agent.post('/api/doctors').send({ name: 'Dr A', defaultFee: -1 })).status).toBe(400);
    expect((await owner.agent.post('/api/doctors').send({ name: 'Dr A', slotMinutes: 2 })).status).toBe(400);
    expect((await owner.agent.post('/api/doctors').send({ name: 'Dr A', defaultFee: 12.5 })).status).toBe(400);
  });

  it('stores a weekly schedule and replaces it as a whole', async () => {
    const owner = await signUpClinic(testApp);
    const doctor = (await owner.agent.post('/api/doctors').send({ name: 'Dr Schedule' })).body as DoctorBody;
    const first = await owner.agent.put(`/api/doctors/${doctor.id}/schedule`).send({
      sessions: [
        { weekday: 1, start: '09:00', end: '13:00' },
        { weekday: 1, start: '17:00', end: '20:00' },
        { weekday: 3, start: '10:00', end: '12:00' },
      ],
    });
    expect(first.status).toBe(200);
    expect((first.body as DoctorBody).schedule).toEqual([
      { weekday: 1, start: '09:00', end: '13:00' },
      { weekday: 1, start: '17:00', end: '20:00' },
      { weekday: 3, start: '10:00', end: '12:00' },
    ]);

    const second = await owner.agent.put(`/api/doctors/${doctor.id}/schedule`).send({ sessions: [{ weekday: 5, start: '08:30', end: '09:30' }] });
    expect((second.body as DoctorBody).schedule).toEqual([{ weekday: 5, start: '08:30', end: '09:30' }]);
  });

  it('rejects overlapping, backwards and malformed sessions without changing the schedule', async () => {
    const owner = await signUpClinic(testApp);
    const doctor = (await owner.agent.post('/api/doctors').send({ name: 'Dr Strict' })).body as DoctorBody;
    await owner.agent.put(`/api/doctors/${doctor.id}/schedule`).send({ sessions: [{ weekday: 2, start: '09:00', end: '10:00' }] });

    const bad = [
      { sessions: [{ weekday: 2, start: '09:00', end: '12:00' }, { weekday: 2, start: '11:00', end: '14:00' }] },
      { sessions: [{ weekday: 2, start: '12:00', end: '09:00' }] },
      { sessions: [{ weekday: 2, start: '9:00', end: '10:00' }] },
      { sessions: [{ weekday: 7, start: '09:00', end: '10:00' }] },
      { sessions: [{ weekday: 2, start: '24:00', end: '25:00' }] },
    ];
    for (const body of bad) {
      expect((await owner.agent.put(`/api/doctors/${doctor.id}/schedule`).send(body)).status).toBe(400);
    }
    const after = (await owner.agent.get('/api/doctors')).body as DoctorBody[];
    expect(after[0]?.schedule).toEqual([{ weekday: 2, start: '09:00', end: '10:00' }]);
  });

  it('allows touching sessions on the same day and different days at the same time', () => {
    expect(findOverlap([{ weekday: 1, start: '09:00', end: '12:00' }, { weekday: 1, start: '12:00', end: '15:00' }])).toBeNull();
    expect(findOverlap([{ weekday: 1, start: '09:00', end: '12:00' }, { weekday: 2, start: '09:00', end: '12:00' }])).toBeNull();
    expect(findOverlap([{ weekday: 1, start: '09:00', end: '12:00' }, { weekday: 1, start: '11:59', end: '15:00' }])).not.toBeNull();
  });

  it('records leave days, refuses duplicates and removes them', async () => {
    const owner = await signUpClinic(testApp);
    const doctor = (await owner.agent.post('/api/doctors').send({ name: 'Dr Leave' })).body as DoctorBody;
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

    expect((await owner.agent.post(`/api/doctors/${doctor.id}/leaves`).send({ date: tomorrow, note: 'Conference' })).status).toBe(201);
    const duplicate = await owner.agent.post(`/api/doctors/${doctor.id}/leaves`).send({ date: tomorrow });
    expect(duplicate.status).toBe(409);
    expect((duplicate.body as { error: { code: string } }).error.code).toBe('already_exists');
    expect((await owner.agent.get(`/api/doctors/${doctor.id}/leaves`)).body).toEqual([{ date: tomorrow, note: 'Conference' }]);
    expect((await owner.agent.delete(`/api/doctors/${doctor.id}/leaves/${tomorrow}`)).status).toBe(204);
    expect((await owner.agent.delete(`/api/doctors/${doctor.id}/leaves/${tomorrow}`)).status).toBe(404);
    expect((await owner.agent.post(`/api/doctors/${doctor.id}/leaves`).send({ date: '2030-13-45x' })).status).toBe(400);
  });

  it('keeps one clinic from reading or changing another clinic\'s doctors', async () => {
    const clinicA = await signUpClinic(testApp, 'A');
    const clinicB = await signUpClinic(testApp, 'B');
    const doctor = (await clinicA.agent.post('/api/doctors').send({ name: 'Dr Private' })).body as DoctorBody;

    expect(((await clinicB.agent.get('/api/doctors')).body as DoctorBody[]).length).toBe(0);
    expect((await clinicB.agent.patch(`/api/doctors/${doctor.id}`).send({ name: 'Taken' })).status).toBe(404);
    expect((await clinicB.agent.put(`/api/doctors/${doctor.id}/schedule`).send({ sessions: [] })).status).toBe(404);
    expect((await clinicB.agent.post(`/api/doctors/${doctor.id}/leaves`).send({ date: '2030-01-01' })).status).toBe(404);
  });

  it('only lets the owner change doctors', async () => {
    const owner = await signUpClinic(testApp);
    const reception = await addStaff(testApp, owner, 'receptionist');
    const doctorUser = await addStaff(testApp, owner, 'doctor');
    for (const other of [reception, doctorUser]) {
      expect((await other.agent.post('/api/doctors').send({ name: 'Nope' })).status).toBe(403);
    }
  });
});
