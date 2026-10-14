import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createOrg, createPlatformAdmin, memberAgent, PASSWORD, signIn, startTestApp, uniquePhone, type TestApp } from './support/app';

let t: TestApp;
beforeAll(async () => {
  t = await startTestApp();
});
afterAll(async () => {
  await t.close();
});

describe('audit views (US6)', () => {
  it('shows an organization only its own events, filtered and paged', async () => {
    const a = await createOrg(t);
    const b = await createOrg(t);
    const { agent: adminA, person } = await memberAgent(t, a, ['tenant_admin']);
    const { agent: adminB } = await memberAgent(t, b, ['tenant_admin']);
    for (let index = 0; index < 55; index += 1) {
      await adminA.post(`/api/orgs/${a.slug}/invitations`).send({ inviteeName: `N${index}`, phone: uniquePhone(), roleIds: [a.roleIds.finance], facilityScope: 'all' });
    }
    await adminB.post(`/api/orgs/${b.slug}/invitations`).send({ inviteeName: 'B', phone: uniquePhone(), roleIds: [b.roleIds.finance], facilityScope: 'all' });

    const first = await adminA.get(`/api/orgs/${a.slug}/audit?action=staff.invited`);
    expect(first.status).toBe(200);
    expect(first.body.entries).toHaveLength(50);
    expect(first.body.entries[0]).toMatchObject({ actorId: person.id, actor: person.name, action: 'staff.invited', targetType: 'invitation' });
    const second = await adminA.get(`/api/orgs/${a.slug}/audit?action=staff.invited&cursor=${first.body.nextCursor as string}`);
    expect(second.body.entries).toHaveLength(5);
    expect(second.body.nextCursor).toBeNull();
    const ids = new Set([...first.body.entries, ...second.body.entries].map((entry: { id: string }) => entry.id));
    expect(ids.size).toBe(55);

    const byActor = await adminB.get(`/api/orgs/${b.slug}/audit?actor=${person.id}`);
    expect(byActor.body.entries).toHaveLength(0);
    const today = new Date().toISOString().slice(0, 10);
    expect((await adminA.get(`/api/orgs/${a.slug}/audit?from=${today}&to=${today}`)).body.entries.length).toBeGreaterThan(0);
    expect((await adminA.get(`/api/orgs/${a.slug}/audit?from=2000-01-01&to=2000-01-02`)).body.entries).toHaveLength(0);
  });

  it('is closed to receptionists and to other organizations', async () => {
    const org = await createOrg(t);
    const { agent: receptionist } = await memberAgent(t, org, ['receptionist']);
    expect((await receptionist.get(`/api/orgs/${org.slug}/audit`)).status).toBe(403);
    expect((await receptionist.get('/api/platform/audit')).status).toBe(403);
  });

  it('shows the platform log to Super Admins', async () => {
    const platform = await signIn(t, await createPlatformAdmin(t));
    const log = await platform.get('/api/platform/audit?action=auth.');
    expect(log.status).toBe(200);
    expect(log.body.entries.length).toBeGreaterThan(0);
    expect(log.body.entries[0]).toHaveProperty('organizationId');
  });

  it('never stores secrets in any audit entry produced by the flows', async () => {
    // Everything this file did is in the logs; look for anything that looks like a token or password.
    const rows = await t.admin.query<{ details: unknown }>(
      `select details from audit_events union all select details from platform_audit_events`,
    );
    const text = JSON.stringify(rows.rows);
    expect(text).not.toContain(PASSWORD);
    expect(text).not.toMatch(/[A-Za-z0-9_-]{43}/);
    expect(text).not.toMatch(/"(password|token|secret|code|hash)"/i);
  });
});
