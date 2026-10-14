import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, createOrg, createPerson, memberAgent, PASSWORD, signIn, startTestApp, uniquePhone, type TestApp } from './support/app';

let t: TestApp;
beforeAll(async () => {
  t = await startTestApp();
});
afterAll(async () => {
  await t.close();
});

const tokenOf = (link: string): string => link.split('#')[1] ?? '';

describe('inviting staff (US3)', () => {
  it('invites a receptionist limited to one branch, who then sees only that branch', async () => {
    const org = await createOrg(t, { facilities: 2 });
    const { agent: admin } = await memberAgent(t, org, ['tenant_admin']);
    const phone = uniquePhone();
    const invite = await admin.post(`/api/orgs/${org.slug}/invitations`).send({
      inviteeName: 'Bilal',
      phone,
      roleIds: [org.roleIds.receptionist],
      facilityScope: 'selected',
      facilityIds: [org.facilityIds[0]],
    });
    expect(invite.status, JSON.stringify(invite.body)).toBe(201);

    const staff = await admin.get(`/api/orgs/${org.slug}/staff`);
    expect(staff.body.invitations).toHaveLength(1);
    expect(staff.body.invitations[0]).toMatchObject({ inviteeName: 'Bilal', roles: ['Receptionist'], facilityScope: 'selected', expired: false });
    expect(staff.body.invitations[0].identifier).not.toContain(phone);

    const receptionist = t.agent();
    const accepted = await receptionist.post('/api/invitations/accept').send({ token: tokenOf(invite.body.link), password: 'reception-pass' });
    expect(accepted.status).toBe(200);
    const me = await receptionist.get('/api/auth/me');
    expect(me.body.memberships[0].facilities).toEqual([{ id: org.facilityIds[0], name: 'Branch 1' }]);
    expect((await receptionist.get(`/api/orgs/${org.slug}/facilities`)).body.map((f: { id: string }) => f.id)).toEqual([org.facilityIds[0]]);
  });

  it('refuses roles the caller could not hold, roles of switched-off modules, and other organizations’ ids', async () => {
    const org = await createOrg(t);
    const other = await createOrg(t);
    const { agent: admin } = await memberAgent(t, org, ['tenant_admin']);
    const base = { inviteeName: 'X', phone: uniquePhone(), facilityScope: 'all' };

    // An admin whose role was narrowed cannot hand out the full admin role.
    await t.admin.query(`update roles set permissions = array_remove(permissions, 'audit.read') where id = $1`, [org.roleIds.receptionist]);
    const limitedRole = await t.admin.query<{ id: string }>(
      `insert into roles (organization_id, key, name, permissions) values ($1, 'staff_manager', 'Staff manager', '{dashboard.read,staff.read,staff.invite,staff.manage}') returning id`,
      [org.id],
    );
    const manager = await createPerson(t);
    const membership = await addMember(t, org, manager, ['receptionist']);
    await t.admin.query('insert into membership_roles (membership_id, role_id, organization_id) values ($1, $2, $3)', [membership, limitedRole.rows[0]!.id, org.id]);
    const managerAgent = await signIn(t, manager);
    const escalate = await managerAgent.post(`/api/orgs/${org.slug}/invitations`).send({ ...base, roleIds: [org.roleIds.tenant_admin] });
    expect(escalate.status).toBe(403);
    expect(escalate.body.error.code).toBe('permission_escalation');

    const practitioner = await admin.post(`/api/orgs/${org.slug}/invitations`).send({ ...base, roleIds: [org.roleIds.practitioner] });
    expect(practitioner.status).toBe(409);
    expect(practitioner.body.error.code).toBe('module_disabled');

    expect((await admin.post(`/api/orgs/${org.slug}/invitations`).send({ ...base, roleIds: [other.roleIds.receptionist] })).status).toBe(404);
    expect(
      (await admin.post(`/api/orgs/${org.slug}/invitations`).send({ ...base, roleIds: [org.roleIds.receptionist], facilityScope: 'selected', facilityIds: [other.facilityIds[0]] })).status,
    ).toBe(404);
  });

  it('lists roles with what the caller may assign', async () => {
    const org = await createOrg(t);
    const { agent: admin } = await memberAgent(t, org, ['tenant_admin']);
    const roles = await admin.get(`/api/orgs/${org.slug}/roles`);
    const byKey = Object.fromEntries((roles.body as Array<{ key: string; assignable: boolean }>).map((r) => [r.key, r.assignable]));
    expect(byKey).toEqual({ tenant_admin: true, receptionist: true, finance: true, practitioner: false });
  });
});

describe('staff lifecycle (US4)', () => {
  it('revokes and reissues invitations', async () => {
    const org = await createOrg(t);
    const { agent: admin } = await memberAgent(t, org, ['tenant_admin']);
    const first = await admin.post(`/api/orgs/${org.slug}/invitations`).send({ inviteeName: 'A', phone: uniquePhone(), roleIds: [org.roleIds.finance], facilityScope: 'all' });
    const id = (await admin.get(`/api/orgs/${org.slug}/staff`)).body.invitations[0].id as string;

    const reissued = await admin.post(`/api/orgs/${org.slug}/invitations/${id}/reissue`);
    expect(reissued.status).toBe(200);
    expect((await t.agent().post('/api/invitations/lookup').send({ token: tokenOf(first.body.link) })).status).toBe(410);
    expect((await t.agent().post('/api/invitations/lookup').send({ token: tokenOf(reissued.body.link) })).status).toBe(200);

    expect((await admin.post(`/api/orgs/${org.slug}/invitations/${id}/revoke`)).status).toBe(200);
    expect((await t.agent().post('/api/invitations/lookup').send({ token: tokenOf(reissued.body.link) })).status).toBe(410);
    expect((await admin.post(`/api/orgs/${org.slug}/invitations/${id}/revoke`)).status).toBe(404);
  });

  it('deactivation ends access in this organization at once but keeps other organizations', async () => {
    const org = await createOrg(t);
    const other = await createOrg(t);
    const { agent: admin } = await memberAgent(t, org, ['tenant_admin']);
    const person = await createPerson(t);
    const membershipId = await addMember(t, org, person, ['receptionist']);
    await addMember(t, other, person, ['receptionist']);
    const here = await signIn(t, person);
    await here.post('/api/auth/context').send({ orgSlug: org.slug });
    const elsewhere = await signIn(t, person);
    await elsewhere.post('/api/auth/context').send({ orgSlug: other.slug });
    expect((await here.get(`/api/orgs/${org.slug}/dashboard`)).status).toBe(200);

    expect((await admin.post(`/api/orgs/${org.slug}/staff/${membershipId}/deactivate`)).status).toBe(200);
    expect((await here.get(`/api/orgs/${org.slug}/dashboard`)).status).toBe(401);
    expect((await elsewhere.get(`/api/orgs/${other.slug}/dashboard`)).status).toBe(200);
    expect((await elsewhere.get(`/api/orgs/${org.slug}/dashboard`)).status).toBe(404);

    expect((await admin.post(`/api/orgs/${org.slug}/staff/${membershipId}/reactivate`)).status).toBe(200);
    expect((await elsewhere.get(`/api/orgs/${org.slug}/dashboard`)).status).toBe(200);
  });

  it('protects the last active administrator', async () => {
    const org = await createOrg(t);
    const { agent: admin, membershipId } = await memberAgent(t, org, ['tenant_admin']);
    const self = await admin.post(`/api/orgs/${org.slug}/staff/${membershipId}/deactivate`);
    expect(self.body.error.code).toBe('cannot_deactivate_self');
    const demote = await admin.put(`/api/orgs/${org.slug}/staff/${membershipId}`).send({ roleIds: [org.roleIds.receptionist], facilityScope: 'all' });
    expect(demote.status).toBe(409);
    expect(demote.body.error.code).toBe('last_admin');

    const second = await memberAgent(t, org, ['tenant_admin']);
    expect((await admin.post(`/api/orgs/${org.slug}/staff/${second.membershipId}/deactivate`)).status).toBe(200);
    const lastOne = await t.admin.query<{ id: string }>(`select id from memberships where organization_id = $1 and status = 'active'`, [org.id]);
    expect(lastOne.rowCount).toBe(1);
  });

  it('changes roles and branch access', async () => {
    const org = await createOrg(t, { facilities: 2 });
    const { agent: admin } = await memberAgent(t, org, ['tenant_admin']);
    const { agent: staff, membershipId } = await memberAgent(t, org, ['receptionist'], [org.facilityIds[0]!]);
    const changed = await admin.put(`/api/orgs/${org.slug}/staff/${membershipId}`).send({
      roleIds: [org.roleIds.finance],
      facilityScope: 'selected',
      facilityIds: [org.facilityIds[1]],
    });
    expect(changed.status).toBe(200);
    const me = await staff.get('/api/auth/me');
    expect(me.body.memberships[0]).toMatchObject({ roles: ['Finance'], facilities: [{ id: org.facilityIds[1], name: 'Branch 2' }] });
  });

  it('issues a single-use 24-hour reset link that ends all sessions', async () => {
    const org = await createOrg(t);
    const { agent: admin } = await memberAgent(t, org, ['tenant_admin']);
    const { agent: staff, person, membershipId } = await memberAgent(t, org, ['finance']);
    const reset = await admin.post(`/api/orgs/${org.slug}/staff/${membershipId}/reset-password`);
    expect(reset.status).toBe(200);
    expect(reset.body.link).toMatch(/\/reset#[A-Za-z0-9_-]{43}$/);
    const hours = (Date.parse(reset.body.expiresAt) - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(23.9);
    expect(hours).toBeLessThan(24.1);
    expect((await staff.get('/api/auth/me')).status).toBe(401);

    const token = tokenOf(reset.body.link);
    expect((await t.agent().post('/api/password-resets/lookup').send({ token })).body.displayName).toBe(person.name);
    expect((await t.agent().post('/api/password-resets/complete').send({ token, newPassword: 'short' })).status).toBe(400);
    expect((await t.agent().post('/api/password-resets/complete').send({ token, newPassword: 'brand-new-password' })).status).toBe(200);
    expect((await t.agent().post('/api/password-resets/complete').send({ token, newPassword: 'another-password' })).status).toBe(410);
    expect((await t.agent().post('/api/auth/login').send({ identifier: person.phone, password: PASSWORD })).status).toBe(401);
    expect((await t.agent().post('/api/auth/login').send({ identifier: person.phone, password: 'brand-new-password' })).status).toBe(200);
  });

  it('refuses expired reset links', async () => {
    const org = await createOrg(t);
    const { agent: admin } = await memberAgent(t, org, ['tenant_admin']);
    const { membershipId } = await memberAgent(t, org, ['finance']);
    const reset = await admin.post(`/api/orgs/${org.slug}/staff/${membershipId}/reset-password`);
    await t.admin.query(`update password_resets set expires_at = now() - interval '1 second' where used_at is null`);
    expect((await t.agent().post('/api/password-resets/complete').send({ token: tokenOf(reset.body.link), newPassword: 'brand-new-password' })).status).toBe(410);
  });
});
