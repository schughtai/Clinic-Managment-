import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createOrg, memberAgent, startTestApp, uniquePhone, type TestApp } from './support/app';

let t: TestApp;
beforeAll(async () => {
  t = await startTestApp();
});
afterAll(async () => {
  await t.close();
});

// Names that are dissimilar enough that the duplicate check does not fire between them.
const DISTINCT_NAMES = ['Zara Quill', 'Omar Petal', 'Irene Vosk', 'Tahir Lumen', 'Gulnar Fitch', 'Selim Orrin', 'Dana Kestrel', 'Rukhsana Veil', 'Nadir Thorne', 'Yasmin Ocher'];

describe('patients (US1)', () => {
  it('numbers patients in sequence and keeps numbers unique under concurrent saves', async () => {
    const org = await createOrg(t);
    const { agent } = await memberAgent(t, org, ['receptionist']);
    const responses = await Promise.all(
      DISTINCT_NAMES.map((name) => agent.post(`/api/orgs/${org.slug}/patients`).send({ nameEn: name, sex: 'female', phones: [] })),
    );
    expect(responses.every((response) => response.status === 201)).toBe(true);
    const numbers = responses.map((response) => response.body.patientNumber as string);
    expect(new Set(numbers).size).toBe(DISTINCT_NAMES.length);
    expect(numbers.sort()).toEqual(Array.from({ length: DISTINCT_NAMES.length }, (_, index) => `P-${String(index + 1).padStart(6, '0')}`));
  });

  it('stops a likely duplicate until the receptionist confirms it', async () => {
    const org = await createOrg(t);
    const { agent } = await memberAgent(t, org, ['receptionist']);
    const phone = uniquePhone();
    const first = await agent.post(`/api/orgs/${org.slug}/patients`).send({ nameEn: 'Hira Anwar', sex: 'female', phones: [{ phone, label: 'mobile' }] });
    expect(first.status).toBe(201);

    const blocked = await agent.post(`/api/orgs/${org.slug}/patients`).send({ nameEn: 'Hira Anwar', sex: 'female', phones: [{ phone, label: 'mobile' }] });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('possible_duplicates');
    expect(blocked.body.error.details.duplicates[0]).toMatchObject({ id: first.body.id, patientNumber: first.body.patientNumber, reason: 'phone' });

    const confirmed = await agent.post(`/api/orgs/${org.slug}/patients`).send({
      nameEn: 'Hira Anwar',
      sex: 'female',
      phones: [{ phone, label: 'mobile' }],
      confirmDuplicates: true,
    });
    expect(confirmed.status).toBe(201);
  });

  it('finds patients by name spelling variants, number and phone, and not by other organizations', async () => {
    const org = await createOrg(t);
    const other = await createOrg(t);
    const { agent } = await memberAgent(t, org, ['receptionist']);
    const { agent: otherAgent } = await memberAgent(t, other, ['receptionist']);
    const phone = uniquePhone();
    const created = await agent.post(`/api/orgs/${org.slug}/patients`).send({ nameEn: 'Muhammad Ali', sex: 'male', phones: [{ phone, label: 'mobile' }] });
    expect(created.status).toBe(201);

    const byName = await agent.get(`/api/orgs/${org.slug}/patients`).query({ q: 'Mohammad' });
    expect(byName.body.map((p: { id: string }) => p.id)).toContain(created.body.id);

    const byNumber = await agent.get(`/api/orgs/${org.slug}/patients`).query({ q: created.body.patientNumber });
    expect(byNumber.body).toHaveLength(1);

    const byPhone = await agent.get(`/api/orgs/${org.slug}/patients`).query({ q: `0${phone.slice(2)}` });
    expect(byPhone.body.map((p: { id: string }) => p.id)).toContain(created.body.id);

    const elsewhere = await otherAgent.get(`/api/orgs/${other.slug}/patients`).query({ q: 'Muhammad' });
    expect(elsewhere.body).toHaveLength(0);
    expect((await otherAgent.get(`/api/orgs/${other.slug}/patients/${created.body.id}`)).status).toBe(404);
  });

  it('accepts blank optional fields exactly as the form sends them', async () => {
    const org = await createOrg(t);
    const { agent } = await memberAgent(t, org, ['receptionist']);
    const saved = await agent.post(`/api/orgs/${org.slug}/patients`).send({
      nameEn: 'Blank Fields',
      sex: 'unknown',
      address: '',
      emergencyContactName: '',
      emergencyContactPhone: '',
      phones: [],
      confirmDuplicates: false,
    });
    expect(saved.status).toBe(201);
  });

  it('asks for a name, and refuses both a date of birth and an approximate age', async () => {
    const org = await createOrg(t);
    const { agent } = await memberAgent(t, org, ['receptionist']);
    const noName = await agent.post(`/api/orgs/${org.slug}/patients`).send({ sex: 'unknown' });
    expect(noName.status).toBe(400);
    const both = await agent.post(`/api/orgs/${org.slug}/patients`).send({
      nameEn: 'Both Given',
      dateOfBirth: '1990-01-01',
      approximateAge: 30,
    });
    expect(both.status).toBe(400);
  });

  it('updates only the fields sent, and the audit log names the fields but not their values', async () => {
    const org = await createOrg(t);
    const { agent } = await memberAgent(t, org, ['receptionist', 'tenant_admin']);
    const created = await agent.post(`/api/orgs/${org.slug}/patients`).send({ nameEn: 'Before Name', sex: 'unknown', phones: [] });
    const patch = await agent.patch(`/api/orgs/${org.slug}/patients/${created.body.id}`).send({ address: 'Street 9', nameEn: 'After Name' });
    expect(patch.status).toBe(200);
    expect(patch.body.changed).toEqual(['nameEn', 'address']);

    const fetched = await agent.get(`/api/orgs/${org.slug}/patients/${created.body.id}`);
    expect(fetched.body).toMatchObject({ nameEn: 'After Name', address: 'Street 9', sex: 'unknown' });

    const audit = await agent.get(`/api/orgs/${org.slug}/audit?action=patient.updated`);
    const entry = audit.body.entries.find((e: { targetId: string }) => e.targetId === created.body.id);
    expect(entry.details).toMatchObject({ fields: 'nameEn,address' });
    expect(JSON.stringify(entry)).not.toContain('Street 9');
  });

  it('keeps date of birth and approximate age exclusive when one is changed', async () => {
    const org = await createOrg(t);
    const { agent } = await memberAgent(t, org, ['receptionist']);
    const created = await agent.post(`/api/orgs/${org.slug}/patients`).send({ nameEn: 'Age Changer', sex: 'male', dateOfBirth: '1980-05-02' });
    const changed = await agent.patch(`/api/orgs/${org.slug}/patients/${created.body.id}`).send({ approximateAge: 45 });
    expect(changed.status).toBe(200);
    const fetched = await agent.get(`/api/orgs/${org.slug}/patients/${created.body.id}`);
    expect(fetched.body).toMatchObject({ approximateAge: 45, dateOfBirth: null });
  });
});

describe('patient history (US2)', () => {
  it('records typed entries, shows assessment states, and keeps corrections as new entries', async () => {
    const org = await createOrg(t);
    const { agent } = await memberAgent(t, org, ['tenant_admin']);
    const created = await agent.post(`/api/orgs/${org.slug}/patients`).send({ nameEn: 'History Case', sex: 'female' });
    const base = `/api/orgs/${org.slug}/patients/${created.body.id}`;

    const initial = await agent.get(`${base}/history`);
    expect(initial.body.find((s: { section: string }) => s.section === 'allergy')).toMatchObject({ state: 'not_assessed', entries: [] });

    const bad = await agent.post(`${base}/history`).send({ section: 'allergy', content: { reaction: 'rash' } });
    expect(bad.status).toBe(400);

    const allergy = await agent.post(`${base}/history`).send({ section: 'allergy', content: { substance: 'Penicillin', severity: 'severe' } });
    expect(allergy.status).toBe(201);

    await agent.post(`${base}/assessments`).send({ section: 'condition', state: 'patient_reports_none' });
    let view = (await agent.get(`${base}/history`)).body;
    expect(view.find((s: { section: string }) => s.section === 'allergy')).toMatchObject({ state: 'has_entries' });
    expect(view.find((s: { section: string }) => s.section === 'condition')).toMatchObject({ state: 'patient_reports_none' });

    const correction = await agent.post(`${base}/history`).send({
      section: 'allergy',
      content: { substance: 'Penicillin', severity: 'moderate' },
      supersedesId: allergy.body.id,
    });
    expect(correction.status).toBe(201);
    view = (await agent.get(`${base}/history`)).body;
    const entries = view.find((s: { section: string }) => s.section === 'allergy').entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ id: correction.body.id, content: { substance: 'Penicillin', severity: 'moderate' } });

    const again = await agent.post(`${base}/history`).send({ section: 'allergy', content: { substance: 'Latex' }, supersedesId: allergy.body.id });
    expect(again.status).toBe(400);
  });

  it('is hidden from finance and receptionists, who lack the history read permission', async () => {
    const org = await createOrg(t);
    const { agent: admin } = await memberAgent(t, org, ['tenant_admin']);
    const { agent: finance } = await memberAgent(t, org, ['finance']);
    const { agent: reception } = await memberAgent(t, org, ['receptionist']);
    const created = await admin.post(`/api/orgs/${org.slug}/patients`).send({ nameEn: 'Hidden History', sex: 'male' });
    const base = `/api/orgs/${org.slug}/patients/${created.body.id}`;

    expect((await finance.get(`${base}/history`)).status).toBe(403);
    expect((await reception.get(`${base}/history`)).status).toBe(403);
    expect((await finance.post(`${base}/history`).send({ section: 'allergy', content: { substance: 'X' } })).status).toBe(403);
    // Finance can still see the patient's identifiers, but cannot create patients.
    expect((await finance.get(base)).status).toBe(200);
    expect((await finance.post(`/api/orgs/${org.slug}/patients`).send({ nameEn: 'Finance Creates', sex: 'male' })).status).toBe(403);
  });
});
