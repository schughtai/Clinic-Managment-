import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createOrg, createPlatformAdmin, memberAgent, signIn, startTestApp, type Agent, type TestApp } from './support/app';

let t: TestApp;
let platform: Agent;
beforeAll(async () => {
  t = await startTestApp();
  platform = await signIn(t, await createPlatformAdmin(t));
});
afterAll(async () => {
  await t.close();
});

const status = (orgId: string, action: string, reason?: string) =>
  platform.post(`/api/platform/organizations/${orgId}/status`).send(reason === undefined ? { action } : { action, reason });

describe('organization lifecycle (US5)', () => {
  it('suspends with a reason, blocks members at once, keeps data, and reactivates', async () => {
    const org = await createOrg(t, { status: 'active' });
    const { agent: member } = await memberAgent(t, org, ['tenant_admin']);
    expect((await member.get(`/api/orgs/${org.slug}/dashboard`)).status).toBe(200);

    expect((await status(org.id, 'suspend')).body.error.code).toBe('reason_required');
    const suspended = await status(org.id, 'suspend', 'Unpaid subscription');
    expect(suspended.status).toBe(200);
    expect(suspended.body).toMatchObject({ status: 'suspended', statusReason: 'Unpaid subscription' });
    // Sessions working in the organization were ended.
    expect((await member.get(`/api/orgs/${org.slug}/dashboard`)).status).toBe(401);
    const again = await memberAgent(t, org, ['receptionist']);
    const blocked = await again.agent.get(`/api/orgs/${org.slug}/dashboard`);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('organization_suspended');

    const restored = await status(org.id, 'reactivate');
    expect(restored.body.status).toBe('active');
    expect(restored.body.facilityCount).toBe(1);
    expect((await again.agent.get(`/api/orgs/${org.slug}/dashboard`)).status).toBe(200);
  });

  it('returns a suspended setup organization to setup, and deactivates only from suspended', async () => {
    const org = await createOrg(t);
    expect((await status(org.id, 'deactivate', 'Closed')).status).toBe(409);
    await status(org.id, 'suspend', 'Paused');
    expect((await status(org.id, 'reactivate')).body.status).toBe('setup_required');
    await status(org.id, 'suspend', 'Closing');
    expect((await status(org.id, 'deactivate', 'Clinic closed')).body.status).toBe('deactivated');
    expect((await status(org.id, 'reactivate')).status).toBe(409);
  });

  it('activates from the platform only when setup checks pass', async () => {
    const org = await createOrg(t);
    const refused = await status(org.id, 'activate');
    expect(refused.body.error).toMatchObject({ code: 'setup_incomplete', details: ['admin'] });
    await memberAgent(t, org, ['tenant_admin']);
    expect((await status(org.id, 'activate')).body.status).toBe('active');
  });

  it('switches modules; the practitioner role is assignable only while clinical is on', async () => {
    const org = await createOrg(t);
    const { agent: admin } = await memberAgent(t, org, ['tenant_admin']);
    expect((await platform.put(`/api/platform/organizations/${org.id}/modules`).send({ modules: ['pharmacy'] })).status).toBe(400);
    expect((await platform.put(`/api/platform/organizations/${org.id}/modules`).send({ modules: ['clinical'] })).body).toEqual({ modules: ['clinical'] });

    const roles = await admin.get(`/api/orgs/${org.slug}/roles`);
    expect(roles.body.find((r: { key: string }) => r.key === 'practitioner').assignable).toBe(true);
    const invite = await admin.post(`/api/orgs/${org.slug}/invitations`).send({ inviteeName: 'Dr X', email: 'drx@example.test', roleIds: [org.roleIds.practitioner], facilityScope: 'all' });
    expect(invite.status).toBe(201);

    await platform.put(`/api/platform/organizations/${org.id}/modules`).send({ modules: [] });
    const after = await admin.get(`/api/orgs/${org.slug}/roles`);
    expect(after.body.find((r: { key: string }) => r.key === 'practitioner').assignable).toBe(false);
  });

  it('lets a Super Admin reset an organization administrator’s password', async () => {
    const org = await createOrg(t);
    const { agent: admin, membershipId } = await memberAgent(t, org, ['tenant_admin']);
    const reset = await platform.post(`/api/platform/organizations/${org.id}/admins/${membershipId}/reset-password`);
    expect(reset.status).toBe(200);
    expect((await admin.get('/api/auth/me')).status).toBe(401);
    const { membershipId: receptionist } = await memberAgent(t, org, ['receptionist']);
    expect((await platform.post(`/api/platform/organizations/${org.id}/admins/${receptionist}/reset-password`)).status).toBe(404);
  });

  it('records every lifecycle change in the platform log only', async () => {
    const org = await createOrg(t, { status: 'active' });
    await status(org.id, 'suspend', 'Audit check');
    await status(org.id, 'reactivate');
    const rows = await t.admin.query<{ action: string }>(`select action from platform_audit_events where organization_id = $1 order by occurred_at`, [org.id]);
    expect(rows.rows.map((r) => r.action)).toEqual(['organization.suspended', 'organization.reactivated']);
    expect((await t.admin.query(`select 1 from audit_events where organization_id = $1 and action like 'organization.suspend%'`, [org.id])).rowCount).toBe(0);
  });
});
