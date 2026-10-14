import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createOrg, createPerson, memberAgent, startTestApp, type Agent, type TestApp, type TestOrg } from './support/app';

/**
 * Concurrency guarantees from the spec (SC-003): simultaneous bookings for one slot give exactly one
 * booking, and simultaneous queue check-ins never share a number.
 */

let t: TestApp;
let org: TestOrg;
let admin: Agent;
let practitionerId: string;
let typeId: string;
let patientIds: string[];

const future = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();

beforeAll(async () => {
  t = await startTestApp();
  org = await createOrg(t, { facilities: 1, status: 'active' });
  ({ agent: admin } = await memberAgent(t, org, ['tenant_admin']));
  const doctor = await t.admin.query<{ id: string }>(
    `insert into practitioners (organization_id, name) values ($1, 'Dr Hassan') returning id`,
    [org.id],
  );
  practitionerId = doctor.rows[0]!.id;
  await t.admin.query('insert into practitioner_facilities (practitioner_id, facility_id, organization_id) values ($1, $2, $3)', [
    practitionerId,
    org.facilityIds[0],
    org.id,
  ]);
  const type = await t.admin.query<{ id: string }>(
    `insert into appointment_types (organization_id, name, duration_minutes, buffer_minutes) values ($1, 'Consultation', 15, 0) returning id`,
    [org.id],
  );
  typeId = type.rows[0]!.id;
  patientIds = [];
  for (let index = 0; index < 30; index += 1) {
    const person = await createPerson(t);
    const row = await t.admin.query<{ id: string }>(
      `insert into patients (organization_id, patient_number, name_en, name_key, name_words)
       values ($1, $2, $3, 'k', '{}') returning id`,
      [org.id, `P-C${index}-${Date.now()}`, `Patient ${person.name}`],
    );
    patientIds.push(row.rows[0]!.id);
  }
});

afterAll(async () => {
  await t.close();
});

describe('concurrent booking', () => {
  it('books one slot exactly once when two requests race', async () => {
    const body = { facilityId: org.facilityIds[0], practitionerId, typeId, startsAt: future(60 * 24) };
    const [a, b] = await Promise.all([
      admin.post(`/api/orgs/${org.slug}/appointments`).send({ ...body, patientId: patientIds[0] }),
      admin.post(`/api/orgs/${org.slug}/appointments`).send({ ...body, patientId: patientIds[1] }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);
    const loser = a.status === 409 ? a : b;
    expect(loser.body.error.code).toBe('slot_taken');
    const rows = await t.admin.query(`select 1 from appointments where practitioner_id = $1 and starts_at = $2::timestamptz and status = 'booked'`, [
      practitionerId,
      body.startsAt,
    ]);
    expect(rows.rowCount).toBe(1);
  });

  it('never double-books when twenty requests race for overlapping times', async () => {
    const base = Date.now() + 3 * 24 * 3_600_000;
    const requests = Array.from({ length: 20 }, (_, index) =>
      admin.post(`/api/orgs/${org.slug}/appointments`).send({
        facilityId: org.facilityIds[0],
        practitionerId,
        typeId,
        patientId: patientIds[index % patientIds.length],
        startsAt: new Date(base + (index % 4) * 5 * 60_000).toISOString(),
      }),
    );
    const results = await Promise.all(requests);
    expect(results.every((r) => r.status === 201 || r.status === 409)).toBe(true);
    const active = await t.admin.query<{ id: string }>(
      `select a.id from appointments a join appointments b on a.id < b.id and a.practitioner_id = b.practitioner_id
         and a.during && b.during and a.status in ('booked','confirmed','checked_in','in_progress')
         and b.status in ('booked','confirmed','checked_in','in_progress')`,
    );
    expect(active.rowCount).toBe(0);
  });
});

describe('concurrent queue tickets', () => {
  it('gives thirty simultaneous check-ins thirty distinct numbers', async () => {
    const tickets = await Promise.all(
      patientIds.map((patientId) =>
        admin.post(`/api/orgs/${org.slug}/queue/tickets`).send({
          facilityId: org.facilityIds[0],
          practitionerId,
          patientId,
        }),
      ),
    );
    expect(tickets.every((r) => r.status === 201)).toBe(true);
    const numbers = tickets.map((r) => r.body.number as number).sort((x, y) => x - y);
    expect(new Set(numbers).size).toBe(30);
    expect(numbers[0]).toBe(1);
    expect(numbers.at(-1)).toBe(30);
  });
});
