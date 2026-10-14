import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, createOrg, createPerson, memberAgent, PASSWORD, signIn, startTestApp, type TestApp } from './support/app';

let t: TestApp;
beforeAll(async () => {
  t = await startTestApp();
});
afterAll(async () => {
  await t.close();
});

describe('sign-in routing and context', () => {
  it('sends a person with one organization and one branch straight to its dashboard', async () => {
    const org = await createOrg(t);
    const person = await createPerson(t);
    await addMember(t, org, person, ['receptionist']);
    const agent = t.agent();
    const login = await agent.post('/api/auth/login').send({ identifier: `0${person.phone.slice(2)}`, password: PASSWORD });
    expect(login.body).toEqual({ next: 'ready', destination: `/app/${org.slug}/dashboard` });
    const me = await agent.get('/api/auth/me');
    expect(me.body.context).toEqual({ orgSlug: org.slug, facilityId: org.facilityIds[0] });
    expect(me.body.permissions).toEqual([
      'appointments.manage',
      'appointments.read',
      'consent.manage',
      'dashboard.read',
      'documents.read',
      'documents.upload',
      'facility.read',
      'history.write',
      'invoices.read',
      'organization.read',
      'patients.create',
      'patients.merge',
      'patients.read',
      'patients.update',
      'payments.record',
      'queue.manage',
      'refunds.request',
      'reminders.send',
      'schedule.read',
    ]);
  });

  it('asks a person with two organizations, or several branches, to choose', async () => {
    const person = await createPerson(t);
    const a = await createOrg(t);
    const b = await createOrg(t);
    await addMember(t, a, person, ['receptionist']);
    await addMember(t, b, person, ['finance']);
    const login = await t.agent().post('/api/auth/login').send({ identifier: person.phone, password: PASSWORD });
    expect(login.body).toEqual({ next: 'choose_context' });

    const multi = await createOrg(t, { facilities: 2 });
    const other = await createPerson(t);
    await addMember(t, multi, other, ['receptionist']);
    expect((await t.agent().post('/api/auth/login').send({ identifier: other.phone, password: PASSWORD })).body).toEqual({ next: 'choose_context' });
  });

  it('accepts a context only for own active memberships and granted branches', async () => {
    const org = await createOrg(t, { facilities: 2 });
    const stranger = await createOrg(t);
    const { agent } = await memberAgent(t, org, ['receptionist'], [org.facilityIds[0]!]);
    expect((await agent.post('/api/auth/context').send({ orgSlug: stranger.slug })).status).toBe(404);
    expect((await agent.post('/api/auth/context').send({ orgSlug: org.slug, facilityId: org.facilityIds[1] })).status).toBe(404);
    const ok = await agent.post('/api/auth/context').send({ orgSlug: org.slug, facilityId: org.facilityIds[0] });
    expect(ok.status).toBe(200);
    expect(ok.body.context.facilityId).toBe(org.facilityIds[0]);
    expect(ok.body.memberships[0].facilities).toEqual([{ id: org.facilityIds[0], name: 'Branch 1' }]);
  });

  it('locks the account after 5 wrong passwords, even for the right one afterwards', async () => {
    const person = await createPerson(t);
    const agent = t.agent();
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const wrong = await agent.post('/api/auth/login').send({ identifier: person.phone, password: 'wrong-password' });
      expect(wrong.status).toBe(401);
    }
    const fifth = await agent.post('/api/auth/login').send({ identifier: person.phone, password: 'wrong-password' });
    expect(fifth.status).toBe(423);
    expect(fifth.body.error.code).toBe('account_locked');
    const right = await agent.post('/api/auth/login').send({ identifier: person.phone, password: PASSWORD });
    expect(right.status).toBe(423);
    const events = await t.admin.query(`select 1 from platform_audit_events where actor_person_id = $1 and action = 'auth.account_locked'`, [person.id]);
    expect(events.rowCount).toBe(1);
  });

  it('gives the same answer for an unknown account and a wrong password', async () => {
    const unknown = await t.agent().post('/api/auth/login').send({ identifier: '03009999999', password: 'whatever-123' });
    const person = await createPerson(t);
    const wrong = await t.agent().post('/api/auth/login').send({ identifier: person.phone, password: 'whatever-123' });
    expect(unknown.status).toBe(401);
    expect(unknown.body.error.message).toBe(wrong.body.error.message);
  });

  it('ends access on the next request when the membership is deactivated', async () => {
    const org = await createOrg(t);
    const { agent, membershipId } = await memberAgent(t, org, ['tenant_admin']);
    expect((await agent.get(`/api/orgs/${org.slug}/dashboard`)).status).toBe(200);
    await t.admin.query(`update memberships set status = 'deactivated', deactivated_at = now() where id = $1`, [membershipId]);
    expect((await agent.get(`/api/orgs/${org.slug}/dashboard`)).status).toBe(404);
  });

  it('expires sessions after their lifetime and ends them on sign-out', async () => {
    const org = await createOrg(t);
    const { agent, person } = await memberAgent(t, org, ['tenant_admin']);
    await t.admin.query(`update sessions set expires_at = now() - interval '1 second' where person_id = $1`, [person.id]);
    expect((await agent.get('/api/auth/me')).status).toBe(401);

    const again = await signIn(t, person);
    expect((await again.post('/api/auth/logout').send({})).status).toBe(200);
    expect((await again.get('/api/auth/me')).status).toBe(401);
  });

  it('lets a member whose last branch grant was removed sign in but use no branch', async () => {
    const org = await createOrg(t, { facilities: 2 });
    const person = await createPerson(t);
    const membershipId = await addMember(t, org, person, ['receptionist'], [org.facilityIds[0]!]);
    await t.admin.query('delete from membership_facilities where membership_id = $1', [membershipId]);
    const agent = t.agent();
    const login = await agent.post('/api/auth/login').send({ identifier: person.phone, password: PASSWORD });
    expect(login.body).toEqual({ next: 'choose_context' });
    const me = await agent.get('/api/auth/me');
    expect(me.body.memberships[0].facilities).toEqual([]);
    const choose = await agent.post('/api/auth/context').send({ orgSlug: org.slug });
    expect(choose.status).toBe(409);
    expect(choose.body.error.code).toBe('context_required');
  });

  it('changes the password and ends the other sessions', async () => {
    const org = await createOrg(t);
    const { agent, person } = await memberAgent(t, org, ['receptionist']);
    const other = await signIn(t, person);
    expect((await agent.post('/api/auth/change-password').send({ currentPassword: 'wrong', newPassword: 'another-password' })).status).toBe(400);
    expect((await agent.post('/api/auth/change-password').send({ currentPassword: PASSWORD, newPassword: 'short' })).status).toBe(400);
    expect((await agent.post('/api/auth/change-password').send({ currentPassword: PASSWORD, newPassword: 'another-password' })).status).toBe(200);
    expect((await agent.get('/api/auth/me')).status).toBe(200);
    expect((await other.get('/api/auth/me')).status).toBe(401);
  });
});
