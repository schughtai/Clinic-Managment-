import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createOrg, createPlatformAdmin, memberAgent, signIn, startTestApp, uniqueSlug, type Agent, type TestApp } from './support/app';

let t: TestApp;
let platform: Agent;
beforeAll(async () => {
  t = await startTestApp();
  platform = await signIn(t, await createPlatformAdmin(t));
});
afterAll(async () => {
  await t.close();
});

const newOrg = (slug = uniqueSlug('clinic')) => ({
  name: 'Shifa Health Clinic',
  slug,
  facility: { name: 'Main Branch', address: '12 Mall Road', city: 'Lahore', phone: '0300 1234567' },
});

describe('platform organizations', () => {
  it('creates an organization with defaults, one facility and the role templates', async () => {
    const created = await platform.post('/api/platform/organizations').send(newOrg());
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body).toMatchObject({
      status: 'setup_required',
      currency: 'PKR',
      defaultLanguage: 'en',
      timezone: 'Asia/Karachi',
      dateFormat: 'dd/MM/yyyy',
      facilityCount: 1,
      activeStaffCount: 0,
      modules: [],
    });
    expect(created.body.facilities).toHaveLength(1);
    const roles = await t.admin.query<{ key: string }>('select key from roles where organization_id = $1 order by key', [created.body.id]);
    expect(roles.rows.map((r) => r.key)).toEqual(['finance', 'practitioner', 'receptionist', 'tenant_admin']);
    const audit = await t.admin.query(`select 1 from platform_audit_events where action = 'organization.created' and organization_id = $1`, [created.body.id]);
    expect(audit.rowCount).toBe(1);
  });

  it('refuses a slug in use or reserved, and invalid locale settings', async () => {
    const slug = uniqueSlug('dup');
    expect((await platform.post('/api/platform/organizations').send(newOrg(slug))).status).toBe(201);
    const duplicate = await platform.post('/api/platform/organizations').send(newOrg(slug));
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('slug_taken');
    expect((await platform.post('/api/platform/organizations').send(newOrg('platform'))).status).toBe(400);
    expect((await platform.post('/api/platform/organizations').send({ ...newOrg(), timezone: 'Mars/Base' })).status).toBe(400);
    expect((await platform.post('/api/platform/organizations').send({ ...newOrg(), currency: 'XYZ1' })).status).toBe(400);
  });

  it('lists organizations without any patient or clinical fields', async () => {
    const list = await platform.get('/api/platform/organizations');
    expect(list.status).toBe(200);
    const keys = new Set(Object.keys(list.body[0] as object));
    expect([...keys].sort()).toEqual(['activeStaffCount', 'createdAt', 'facilityCount', 'id', 'lastActivityAt', 'modules', 'name', 'slug', 'status']);
  });

  it('shows organization detail with setup checks', async () => {
    const created = await platform.post('/api/platform/organizations').send(newOrg());
    const detail = await platform.get(`/api/platform/organizations/${created.body.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.setupChecks).toEqual([
      { key: 'profile', ok: false, link: 'settings' },
      { key: 'facility', ok: false, link: 'settings/facilities' },
      { key: 'admin', ok: false, link: 'settings/staff' },
    ]);
    expect((await platform.get('/api/platform/organizations/00000000-0000-4000-8000-000000000000')).status).toBe(404);
  });

  it('is closed to organization members and anonymous callers', async () => {
    const org = await createOrg(t);
    const { agent } = await memberAgent(t, org, ['tenant_admin']);
    expect((await agent.get('/api/platform/organizations')).status).toBe(403);
    expect((await agent.post('/api/platform/organizations').send(newOrg())).status).toBe(403);
    expect((await t.agent().get('/api/platform/organizations')).status).toBe(401);
  });
});
