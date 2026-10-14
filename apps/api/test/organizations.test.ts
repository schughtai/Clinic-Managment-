import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createOrg, memberAgent, startTestApp, type Agent, type TestApp, type TestOrg } from './support/app';

let t: TestApp;
beforeAll(async () => {
  t = await startTestApp();
});
afterAll(async () => {
  await t.close();
});

const settings = {
  name: 'Shifa Clinic',
  legalName: '',
  phone: '0300 1234567',
  email: 'info@shifa.test',
  address: '12 Mall Road, Lahore',
  currency: 'PKR',
  defaultLanguage: 'ur',
  timezone: 'Asia/Karachi',
  dateFormat: 'dd/MM/yyyy',
};

const hours = [{ day: 1, opens: '09:00', closes: '13:00' }, { day: 1, opens: '14:00', closes: '18:00' }];

async function adminOf(): Promise<{ org: TestOrg; admin: Agent }> {
  const org = await createOrg(t);
  const { agent } = await memberAgent(t, org, ['tenant_admin']);
  return { org, admin: agent };
}

describe('organization settings', () => {
  it('updates profile and locale and validates every field', async () => {
    const { org, admin } = await adminOf();
    const saved = await admin.put(`/api/orgs/${org.slug}/settings`).send(settings);
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body).toMatchObject({ name: 'Shifa Clinic', phone: '923001234567', defaultLanguage: 'ur', legalName: null });

    for (const bad of [{ currency: 'RUPEE' }, { timezone: 'Lahore' }, { defaultLanguage: 'fr' }, { dateFormat: 'dd-mm-yy' }, { name: '' }, { phone: '12' }]) {
      const response = await admin.put(`/api/orgs/${org.slug}/settings`).send({ ...settings, ...bad });
      expect(response.status, JSON.stringify(bad)).toBe(400);
    }
    const audit = await t.admin.query(`select 1 from audit_events where organization_id = $1 and action = 'organization.settings_updated'`, [org.id]);
    expect(audit.rowCount).toBe(1);
  });

  it('is read-only for receptionists', async () => {
    const org = await createOrg(t);
    const { agent } = await memberAgent(t, org, ['receptionist']);
    expect((await agent.get(`/api/orgs/${org.slug}/settings`)).status).toBe(200);
    expect((await agent.put(`/api/orgs/${org.slug}/settings`).send(settings)).status).toBe(403);
    expect((await agent.post(`/api/orgs/${org.slug}/facilities`).send({ name: 'X' })).status).toBe(403);
  });
});

describe('branches', () => {
  it('creates and updates branches with valid opening hours', async () => {
    const { org, admin } = await adminOf();
    const created = await admin.post(`/api/orgs/${org.slug}/facilities`).send({ name: 'DHA Branch', address: 'Phase 5', openingHours: hours });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.openingHours).toEqual(hours);
    const list = await admin.get(`/api/orgs/${org.slug}/facilities`);
    expect(list.body.map((f: { name: string }) => f.name).sort()).toEqual(['Branch 1', 'DHA Branch']);

    const overlap = await admin.put(`/api/orgs/${org.slug}/facilities/${created.body.id}`).send({
      name: 'DHA Branch',
      openingHours: [{ day: 2, opens: '09:00', closes: '13:00' }, { day: 2, opens: '12:00', closes: '15:00' }],
    });
    expect(overlap.status).toBe(400);
    const backwards = await admin.put(`/api/orgs/${org.slug}/facilities/${created.body.id}`).send({ name: 'DHA Branch', openingHours: [{ day: 3, opens: '18:00', closes: '09:00' }] });
    expect(backwards.status).toBe(400);
    expect((await admin.post(`/api/orgs/${org.slug}/facilities`).send({ name: 'dha branch' })).body.error.code).toBe('name_in_use');
  });

  it('keeps at least one active branch', async () => {
    const { org, admin } = await adminOf();
    const response = await admin.put(`/api/orgs/${org.slug}/facilities/${org.facilityIds[0]}`).send({ name: 'Branch 1', active: false });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('last_facility');
  });
});

describe('activation', () => {
  it('reports missing setup items, then activates when they are done', async () => {
    const org = await createOrg(t);
    await t.admin.query('update organizations set phone = null where id = $1', [org.id]);
    await t.admin.query(`update facilities set opening_hours = '[]' where organization_id = $1`, [org.id]);
    const { agent: admin } = await memberAgent(t, org, ['tenant_admin']);

    const dashboard = await admin.get(`/api/orgs/${org.slug}/dashboard`);
    expect(dashboard.body.setupChecks).toEqual([
      { key: 'profile', ok: false, link: 'settings' },
      { key: 'facility', ok: false, link: 'settings/facilities' },
      { key: 'admin', ok: true, link: 'settings/staff' },
    ]);
    const refused = await admin.post(`/api/orgs/${org.slug}/activate`);
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatchObject({ code: 'setup_incomplete', details: ['profile', 'facility'] });

    await admin.put(`/api/orgs/${org.slug}/settings`).send(settings);
    await admin.put(`/api/orgs/${org.slug}/facilities/${org.facilityIds[0]}`).send({ name: 'Branch 1', address: '1 Road', openingHours: hours });
    const activated = await admin.post(`/api/orgs/${org.slug}/activate`);
    expect(activated.status).toBe(200);
    expect(activated.body.status).toBe('active');
    const audit = await t.admin.query(`select 1 from audit_events where organization_id = $1 and action = 'organization.activated'`, [org.id]);
    expect(audit.rowCount).toBe(1);
  });
});
