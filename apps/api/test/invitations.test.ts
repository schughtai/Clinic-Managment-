import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createOrg, createPerson, createPlatformAdmin, PASSWORD, signIn, startTestApp, uniquePhone, type Agent, type TestApp } from './support/app';

let t: TestApp;
let platform: Agent;
beforeAll(async () => {
  t = await startTestApp();
  platform = await signIn(t, await createPlatformAdmin(t));
});
afterAll(async () => {
  await t.close();
});

const tokenOf = (link: string): string => link.split('#')[1] ?? '';

async function inviteAdmin(orgId: string, phone = uniquePhone()) {
  const response = await platform.post(`/api/platform/organizations/${orgId}/invitations`).send({ inviteeName: 'Dr Ayesha', phone });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return { ...response.body, phone } as { link: string; whatsappUrl: string; expiresAt: string; phone: string };
}

describe('invitations', () => {
  it('returns a one-time link with the token only in the fragment and a WhatsApp link', async () => {
    const org = await createOrg(t);
    const invite = await inviteAdmin(org.id);
    expect(invite.link).toMatch(/^http:\/\/localhost:3000\/invite#[A-Za-z0-9_-]{43}$/);
    expect(invite.whatsappUrl).toMatch(new RegExp(`^https://wa\\.me/${invite.phone}\\?text=`));
    const hours = (Date.parse(invite.expiresAt) - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(71.9);
    expect(hours).toBeLessThan(72.1);
    const stored = await t.admin.query<{ token_hash: Buffer }>('select token_hash from invitations where organization_id = $1', [org.id]);
    expect(stored.rows[0]!.token_hash.toString('base64url')).not.toBe(tokenOf(invite.link));
  });

  it('reveals only names on lookup and creates the admin membership on acceptance', async () => {
    const org = await createOrg(t, { name: 'Lookup Clinic' });
    const invite = await inviteAdmin(org.id);
    const anonymous = t.agent();
    const lookup = await anonymous.post('/api/invitations/lookup').send({ token: tokenOf(invite.link) });
    expect(lookup.status).toBe(200);
    expect(lookup.body).toMatchObject({ organizationName: 'Lookup Clinic', inviteeName: 'Dr Ayesha', roles: ['Clinic / Hospital Admin'], accountExists: false });
    expect(JSON.stringify(lookup.body)).not.toContain(invite.phone);

    const accept = await anonymous.post('/api/invitations/accept').send({ token: tokenOf(invite.link), password: 'a-new-password' });
    expect(accept.status, JSON.stringify(accept.body)).toBe(200);
    expect(accept.body.destination).toBe(`/app/${org.slug}/dashboard`);
    const me = await anonymous.get('/api/auth/me');
    expect(me.body.memberships[0]).toMatchObject({ orgSlug: org.slug, roles: ['Clinic / Hospital Admin'] });
    expect(me.body.context.orgSlug).toBe(org.slug);

    // The same person can sign in with the new password.
    const relog = await t.agent().post('/api/auth/login').send({ identifier: invite.phone, password: 'a-new-password' });
    expect(relog.body.next).toBe('ready');
  });

  it('works exactly once, even for two simultaneous acceptances', async () => {
    const org = await createOrg(t);
    const invite = await inviteAdmin(org.id);
    const token = tokenOf(invite.link);
    const results = await Promise.all([
      t.agent().post('/api/invitations/accept').send({ token, password: 'first-password' }),
      t.agent().post('/api/invitations/accept').send({ token, password: 'second-password' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 410]);
    const memberships = await t.admin.query('select 1 from memberships where organization_id = $1', [org.id]);
    expect(memberships.rowCount).toBe(1);
    const again = await t.agent().post('/api/invitations/lookup').send({ token });
    expect(again.status).toBe(410);
    expect(again.body.error.code).toBe('invitation_invalid');
  });

  it('refuses expired, revoked and malformed tokens the same way', async () => {
    const org = await createOrg(t);
    const expired = await inviteAdmin(org.id);
    await t.admin.query(`update invitations set expires_at = now() - interval '1 minute' where organization_id = $1`, [org.id]);
    expect((await t.agent().post('/api/invitations/accept').send({ token: tokenOf(expired.link), password: 'whatever-123' })).status).toBe(410);
    const revoked = await inviteAdmin(org.id);
    await t.admin.query(`update invitations set status = 'revoked', revoked_at = now() where status = 'pending' and organization_id = $1`, [org.id]);
    expect((await t.agent().post('/api/invitations/lookup').send({ token: tokenOf(revoked.link) })).status).toBe(410);
    expect((await t.agent().post('/api/invitations/lookup').send({ token: 'not-a-token' })).status).toBe(410);
  });

  it('requires an existing account holder to be signed in as themselves', async () => {
    const org = await createOrg(t);
    const existing = await createPerson(t);
    const invite = await inviteAdmin(org.id, existing.phone);
    const token = tokenOf(invite.link);

    const lookup = await t.agent().post('/api/invitations/lookup').send({ token });
    expect(lookup.body.accountExists).toBe(true);
    const anonymous = await t.agent().post('/api/invitations/accept').send({ token, password: 'takeover-attempt' });
    expect(anonymous.status).toBe(409);
    expect(anonymous.body.error.code).toBe('sign_in_required');

    const someoneElse = await signIn(t, await createPerson(t));
    expect((await someoneElse.post('/api/invitations/accept').send({ token })).body.error.code).toBe('sign_in_required');

    const owner = await signIn(t, existing);
    const accepted = await owner.post('/api/invitations/accept').send({ token });
    expect(accepted.status).toBe(200);
    // The existing password still works and was not changed.
    expect((await t.agent().post('/api/auth/login').send({ identifier: existing.phone, password: PASSWORD })).status).toBe(200);
  });

  it('writes an organization audit entry for the acceptance', async () => {
    const org = await createOrg(t);
    const invite = await inviteAdmin(org.id);
    await t.agent().post('/api/invitations/accept').send({ token: tokenOf(invite.link), password: 'audit-password' });
    const audit = await t.admin.query<{ action: string; details: Record<string, unknown> }>(
      `select action, details from audit_events where organization_id = $1`,
      [org.id],
    );
    expect(audit.rows.map((r) => r.action)).toEqual(['invitation.accepted']);
    expect(JSON.stringify(audit.rows)).not.toContain(tokenOf(invite.link));
  });
});
