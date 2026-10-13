import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { canTransition, roleMayMarkStatus, sessionSlots, weekdayOf } from '../src/modules/appointments/slots';
import { type SignedInClinic, type TestApp, addStaff, signUpClinic, startTestApp } from './support/app';

let testApp: TestApp;

beforeAll(async () => {
  testApp = await startTestApp();
});

afterAll(async () => {
  await testApp.close();
});

interface AppointmentBody {
  id: string;
  kind: 'appointment' | 'walkin';
  status: string;
  startsAt: string;
  tokenNo: number | null;
  patientName: string;
  doctorName: string;
}
interface SlotsBody {
  date: string;
  onLeave: boolean;
  slots: { startsAt: string; available: boolean }[];
}
interface ErrorBody {
  error: { code: string };
}

/** A calendar date a few days ahead, so that every slot is in the future. */
function dateAhead(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

/** Karachi is UTC+5 all year, so 09:00 local is 04:00 UTC. */
function karachi(date: string, time: string): string {
  const [hours, minutes] = time.split(':').map(Number);
  const utc = new Date(`${date}T00:00:00Z`).getTime() + ((hours ?? 0) - 5) * 3_600_000 + (minutes ?? 0) * 60_000;
  return new Date(utc).toISOString();
}

interface Setup {
  owner: SignedInClinic;
  doctorId: string;
  patientId: string;
  date: string;
}

async function setup(options: { slotMinutes?: number; start?: string; end?: string; daysAhead?: number } = {}): Promise<Setup> {
  const owner = await signUpClinic(testApp);
  const date = dateAhead(options.daysAhead ?? 3);
  const doctor = await owner.agent.post('/api/doctors').send({ name: 'Dr Slots', slotMinutes: options.slotMinutes ?? 30 });
  const doctorId = (doctor.body as { id: string }).id;
  const schedule = await owner.agent.put(`/api/doctors/${doctorId}/schedule`).send({
    sessions: [{ weekday: weekdayOf(date), start: options.start ?? '09:00', end: options.end ?? '12:00' }],
  });
  expect(schedule.status).toBe(200);
  const patient = await owner.agent.post('/api/patients').send({ name: 'Booked Patient', phone: '03001119999' });
  return { owner, doctorId, patientId: (patient.body as { id: string }).id, date };
}

describe('slot rules', () => {
  it('builds slots that end inside their session', () => {
    expect(sessionSlots([{ start: '09:00', end: '10:00' }], 30)).toEqual(['09:00', '09:30']);
    expect(sessionSlots([{ start: '09:00', end: '10:10' }], 30)).toEqual(['09:00', '09:30']);
    expect(sessionSlots([{ start: '09:00', end: '09:20' }], 30)).toEqual([]);
    expect(sessionSlots([{ start: '09:00', end: '10:00' }, { start: '17:00', end: '17:30' }], 15)).toEqual([
      '09:00', '09:15', '09:30', '09:45', '17:00', '17:15',
    ]);
  });

  it('finds the weekday of a calendar date', () => {
    expect(weekdayOf('2026-10-14')).toBe(3); // a Wednesday
    expect(weekdayOf('2026-10-18')).toBe(0); // a Sunday
  });

  it('allows only sensible status changes', () => {
    expect(canTransition('booked', 'arrived')).toBe(true);
    expect(canTransition('arrived', 'in_consult')).toBe(true);
    expect(canTransition('in_consult', 'done')).toBe(true);
    expect(canTransition('done', 'arrived')).toBe(false);
    expect(canTransition('cancelled', 'booked')).toBe(false);
    expect(canTransition('booked', 'done')).toBe(false);
    expect(roleMayMarkStatus('receptionist', 'arrived')).toBe(true);
    expect(roleMayMarkStatus('receptionist', 'in_consult')).toBe(false);
    expect(roleMayMarkStatus('doctor', 'done')).toBe(true);
  });
});

describe('available slots', () => {
  it('lists the doctor\'s slots in local time and marks booked ones', async () => {
    const { owner, doctorId, patientId, date } = await setup();
    const before = await owner.agent.get(`/api/doctors/${doctorId}/slots`).query({ date });
    expect(before.status).toBe(200);
    const slots = (before.body as SlotsBody).slots;
    expect(slots.map((slot) => slot.startsAt)).toEqual(
      ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30'].map((time) => karachi(date, time)),
    );
    expect(slots.every((slot) => slot.available)).toBe(true);

    await owner.agent.post('/api/appointments').send({ patientId, doctorId, startsAt: karachi(date, '09:30') });
    const after = (await owner.agent.get(`/api/doctors/${doctorId}/slots`).query({ date })).body as SlotsBody;
    expect(after.slots.filter((slot) => !slot.available).map((slot) => slot.startsAt)).toEqual([karachi(date, '09:30')]);
  });

  it('returns nothing on a day with no session and reports leave days', async () => {
    const { owner, doctorId, date } = await setup();
    const other = (weekdayOf(date) + 1) % 7;
    const otherDate = new Date(new Date(`${date}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10);
    expect(weekdayOf(otherDate)).toBe(other);
    const empty = (await owner.agent.get(`/api/doctors/${doctorId}/slots`).query({ date: otherDate })).body as SlotsBody;
    expect(empty.slots).toEqual([]);

    await owner.agent.post(`/api/doctors/${doctorId}/leaves`).send({ date });
    const leave = (await owner.agent.get(`/api/doctors/${doctorId}/slots`).query({ date })).body as SlotsBody;
    expect(leave).toMatchObject({ onLeave: true, slots: [] });
  });

  it('requires a valid date', async () => {
    const { owner, doctorId } = await setup();
    expect((await owner.agent.get(`/api/doctors/${doctorId}/slots`)).status).toBe(400);
    expect((await owner.agent.get(`/api/doctors/${doctorId}/slots`).query({ date: 'tomorrow' })).status).toBe(400);
  });
});

describe('booking', () => {
  it('books a slot and returns the appointment with names', async () => {
    const { owner, doctorId, patientId, date } = await setup();
    const response = await owner.agent
      .post('/api/appointments')
      .send({ patientId, doctorId, startsAt: karachi(date, '10:00'), reason: 'Fever' });
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      kind: 'appointment',
      status: 'booked',
      startsAt: karachi(date, '10:00'),
      patientName: 'Booked Patient',
      doctorName: 'Dr Slots',
      reason: 'Fever',
    });
  });

  it('refuses a slot that is already taken', async () => {
    const { owner, doctorId, patientId, date } = await setup();
    const body = { patientId, doctorId, startsAt: karachi(date, '09:00') };
    expect((await owner.agent.post('/api/appointments').send(body)).status).toBe(201);
    const again = await owner.agent.post('/api/appointments').send(body);
    expect(again.status).toBe(409);
    expect((again.body as ErrorBody).error.code).toBe('slot_taken');
  });

  it('lets exactly one of several simultaneous bookings win', async () => {
    const { owner, doctorId, patientId, date } = await setup();
    const responses = await Promise.all(
      Array.from({ length: 6 }, () =>
        owner.agent.post('/api/appointments').send({ patientId, doctorId, startsAt: karachi(date, '11:00') }),
      ),
    );
    const statuses = responses.map((response) => response.status).sort();
    expect(statuses).toEqual([201, 409, 409, 409, 409, 409]);
    const day = (await owner.agent.get('/api/appointments').query({ date })).body as AppointmentBody[];
    expect(day).toHaveLength(1);
  });

  it('frees the slot again when the appointment is cancelled', async () => {
    const { owner, doctorId, patientId, date } = await setup();
    const body = { patientId, doctorId, startsAt: karachi(date, '09:00') };
    const booked = (await owner.agent.post('/api/appointments').send(body)).body as AppointmentBody;
    expect((await owner.agent.patch(`/api/appointments/${booked.id}/status`).send({ status: 'cancelled' })).status).toBe(200);
    expect((await owner.agent.post('/api/appointments').send(body)).status).toBe(201);
  });

  it('rejects times that are not real slots', async () => {
    const { owner, doctorId, patientId, date } = await setup();
    const attempts: [string, string][] = [
      [karachi(date, '09:10'), 'not_a_slot'],
      [karachi(date, '08:30'), 'not_a_slot'],
      [karachi(date, '12:00'), 'not_a_slot'],
      [new Date(new Date(karachi(date, '09:00')).getTime() + 1_000).toISOString(), 'not_a_slot'],
    ];
    for (const [startsAt, code] of attempts) {
      const response = await owner.agent.post('/api/appointments').send({ patientId, doctorId, startsAt });
      expect(response.status, startsAt).toBe(400);
      expect((response.body as ErrorBody).error.code).toBe(code);
    }
    expect((await owner.agent.post('/api/appointments').send({ patientId, doctorId, startsAt: 'soon' })).status).toBe(400);
  });

  it('rejects the past and leave days', async () => {
    const past = await setup({ daysAhead: -3 });
    const late = await past.owner.agent
      .post('/api/appointments')
      .send({ patientId: past.patientId, doctorId: past.doctorId, startsAt: karachi(past.date, '09:00') });
    expect(late.status).toBe(400);
    expect((late.body as ErrorBody).error.code).toBe('in_the_past');

    const { owner, doctorId, patientId, date } = await setup();
    await owner.agent.post(`/api/doctors/${doctorId}/leaves`).send({ date });
    const onLeave = await owner.agent.post('/api/appointments').send({ patientId, doctorId, startsAt: karachi(date, '09:00') });
    expect(onLeave.status).toBe(400);
    expect((onLeave.body as ErrorBody).error.code).toBe('doctor_on_leave');
  });

  it('refuses inactive doctors and unknown patients', async () => {
    const { owner, doctorId, patientId, date } = await setup();
    const startsAt = karachi(date, '09:00');
    expect((await owner.agent.post('/api/appointments').send({ patientId: doctorId, doctorId, startsAt })).status).toBe(404);
    await owner.agent.patch(`/api/doctors/${doctorId}`).send({ active: false });
    const inactive = await owner.agent.post('/api/appointments').send({ patientId, doctorId, startsAt });
    expect(inactive.status).toBe(400);
    expect((inactive.body as ErrorBody).error.code).toBe('doctor_inactive');
  });

  it('moves a booked appointment to another free slot only', async () => {
    const { owner, doctorId, patientId, date } = await setup();
    const first = (await owner.agent.post('/api/appointments').send({ patientId, doctorId, startsAt: karachi(date, '09:00') })).body as AppointmentBody;
    await owner.agent.post('/api/appointments').send({ patientId, doctorId, startsAt: karachi(date, '09:30') });

    const taken = await owner.agent.patch(`/api/appointments/${first.id}/reschedule`).send({ startsAt: karachi(date, '09:30') });
    expect(taken.status).toBe(409);
    const moved = await owner.agent.patch(`/api/appointments/${first.id}/reschedule`).send({ startsAt: karachi(date, '11:00') });
    expect(moved.status).toBe(200);
    expect((moved.body as AppointmentBody).startsAt).toBe(karachi(date, '11:00'));

    await owner.agent.patch(`/api/appointments/${first.id}/status`).send({ status: 'arrived' });
    const late = await owner.agent.patch(`/api/appointments/${first.id}/reschedule`).send({ startsAt: karachi(date, '10:00') });
    expect(late.status).toBe(409);
    expect((late.body as ErrorBody).error.code).toBe('cannot_reschedule');
  });
});

describe('walk-ins and the queue', () => {
  it('hands out one token after another for each doctor', async () => {
    const { owner, doctorId, patientId } = await setup();
    const second = (await owner.agent.post('/api/doctors').send({ name: 'Dr Other' })).body as { id: string };
    const tokens: number[] = [];
    for (let index = 0; index < 3; index += 1) {
      const response = await owner.agent.post('/api/appointments/walkin').send({ patientId, doctorId });
      expect(response.status).toBe(201);
      tokens.push((response.body as AppointmentBody).tokenNo ?? 0);
    }
    expect(tokens).toEqual([1, 2, 3]);
    const other = await owner.agent.post('/api/appointments/walkin').send({ patientId, doctorId: second.id });
    expect((other.body as AppointmentBody).tokenNo).toBe(1);
    expect(other.body).toMatchObject({ kind: 'walkin', status: 'arrived' });
  });

  it('never gives two walk-ins the same token when they arrive together', async () => {
    const { owner, doctorId, patientId } = await setup();
    const responses = await Promise.all(
      Array.from({ length: 8 }, () => owner.agent.post('/api/appointments/walkin').send({ patientId, doctorId })),
    );
    expect(responses.every((response) => response.status === 201)).toBe(true);
    const tokens = responses.map((response) => (response.body as AppointmentBody).tokenNo ?? 0).sort((a, b) => a - b);
    expect(tokens).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('orders the queue with the patient being seen first and arrivals before bookings', async () => {
    const { owner, doctorId, patientId } = await setup();
    await owner.agent.post('/api/appointments/walkin').send({ patientId, doctorId });
    const walkin2 = (await owner.agent.post('/api/appointments/walkin').send({ patientId, doctorId })).body as AppointmentBody;
    const doctor = await addStaff(testApp, owner, 'doctor');
    await doctor.agent.patch(`/api/appointments/${walkin2.id}/status`).send({ status: 'in_consult' });

    const queue = (await owner.agent.get('/api/appointments/queue').query({ doctorId })).body as AppointmentBody[];
    expect(queue.map((entry) => entry.tokenNo)).toEqual([2, 1]);
    expect(queue.map((entry) => entry.status)).toEqual(['in_consult', 'arrived']);
  });
});

describe('status changes', () => {
  it('follows the visit through arrival, consultation and completion', async () => {
    const { owner, doctorId, patientId, date } = await setup();
    const reception = await addStaff(testApp, owner, 'receptionist');
    const doctor = await addStaff(testApp, owner, 'doctor');
    const booked = (await reception.agent.post('/api/appointments').send({ patientId, doctorId, startsAt: karachi(date, '09:00') })).body as AppointmentBody;
    const url = `/api/appointments/${booked.id}/status`;

    expect((await reception.agent.patch(url).send({ status: 'arrived' })).status).toBe(200);
    expect((await reception.agent.patch(url).send({ status: 'in_consult' })).status).toBe(403);
    expect((await doctor.agent.patch(url).send({ status: 'in_consult' })).status).toBe(200);
    expect((await doctor.agent.patch(url).send({ status: 'done' })).status).toBe(200);

    const reopen = await doctor.agent.patch(url).send({ status: 'arrived' });
    expect(reopen.status).toBe(409);
    expect((reopen.body as ErrorBody).error.code).toBe('invalid_status_change');
    expect((await owner.agent.patch(url).send({ status: 'flying' })).status).toBe(400);
  });
});

describe('appointments between clinics', () => {
  it('keeps one clinic out of another clinic\'s schedule', async () => {
    const mine = await setup();
    const other = await signUpClinic(testApp, 'Other');
    const startsAt = karachi(mine.date, '09:00');
    const booked = (await mine.owner.agent.post('/api/appointments').send({ patientId: mine.patientId, doctorId: mine.doctorId, startsAt })).body as AppointmentBody;

    expect((await other.agent.post('/api/appointments').send({ patientId: mine.patientId, doctorId: mine.doctorId, startsAt })).status).toBe(404);
    expect((await other.agent.get(`/api/doctors/${mine.doctorId}/slots`).query({ date: mine.date })).status).toBe(404);
    expect((await other.agent.patch(`/api/appointments/${booked.id}/status`).send({ status: 'cancelled' })).status).toBe(404);
    expect((await other.agent.patch(`/api/appointments/${booked.id}/reschedule`).send({ startsAt: karachi(mine.date, '10:00') })).status).toBe(404);
    expect(((await other.agent.get('/api/appointments').query({ date: mine.date })).body as AppointmentBody[]).length).toBe(0);
  });
});

describe('daily list', () => {
  it('lists a day\'s appointments in time order and filters by status', async () => {
    const { owner, doctorId, patientId, date } = await setup();
    const late = (await owner.agent.post('/api/appointments').send({ patientId, doctorId, startsAt: karachi(date, '11:00') })).body as AppointmentBody;
    await owner.agent.post('/api/appointments').send({ patientId, doctorId, startsAt: karachi(date, '09:00') });
    await owner.agent.patch(`/api/appointments/${late.id}/status`).send({ status: 'cancelled' });

    const all = (await owner.agent.get('/api/appointments').query({ date })).body as AppointmentBody[];
    expect(all.map((entry) => entry.startsAt)).toEqual([karachi(date, '09:00'), karachi(date, '11:00')]);
    const cancelled = (await owner.agent.get('/api/appointments').query({ date, status: 'cancelled' })).body as AppointmentBody[];
    expect(cancelled.map((entry) => entry.id)).toEqual([late.id]);
    const otherDay = (await owner.agent.get('/api/appointments').query({ date: dateAhead(10) })).body as AppointmentBody[];
    expect(otherDay).toEqual([]);
  });
});
