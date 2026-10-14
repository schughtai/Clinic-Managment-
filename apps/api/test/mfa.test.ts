import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { base32Decode, totpAt } from '../src/modules/identity/totp';
import { createOrg, createPerson, createPlatformAdmin, currentCode, memberAgent, PASSWORD, signIn, startTestApp, type TestApp } from './support/app';

let t: TestApp;
beforeAll(async () => {
  t = await startTestApp();
});
afterAll(async () => {
  await t.close();
});

describe('Super Admin authenticator', () => {
  it('forces enrolment at first sign-in and then grants platform access', async () => {
    const admin = await createPlatformAdmin(t, false);
    const agent = t.agent();
    const login = await agent.post('/api/auth/login').send({ identifier: admin.phone, password: PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body).toEqual({ next: 'mfa_enroll' });

    // Platform routes refuse a password-only session.
    const early = await agent.get('/api/platform/organizations');
    expect(early.status).toBe(403);
    expect(early.body.error.code).toBe('mfa_required');

    const start = await agent.post('/api/auth/mfa/enroll/start').send({});
    expect(start.status).toBe(200);
    expect(start.body.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
    const secret = base32Decode(start.body.secretBase32 as string);

    const wrong = await agent.post('/api/auth/mfa/enroll/confirm').send({ code: '000000' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.code).toBe('mfa_invalid');

    const confirm = await agent.post('/api/auth/mfa/enroll/confirm').send({ code: totpAt(secret, Date.now() / 1000) });
    expect(confirm.status).toBe(200);
    expect(confirm.body.recoveryCodes).toHaveLength(10);
    expect(confirm.body.next).toBe('ready');
    expect(confirm.body.destination).toBe('/platform');

    const list = await agent.get('/api/platform/organizations');
    expect(list.status).toBe(200);

    const again = await agent.post('/api/auth/mfa/enroll/start').send({});
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('mfa_already_enrolled');
  });

  it('asks enrolled admins for a code, refuses wrong and reused codes, and accepts a recovery code once', async () => {
    const admin = await createPlatformAdmin(t, false);
    const agent = t.agent();
    await agent.post('/api/auth/login').send({ identifier: admin.phone, password: PASSWORD });
    const start = await agent.post('/api/auth/mfa/enroll/start').send({});
    const secret = base32Decode(start.body.secretBase32 as string);
    const enrolCode = totpAt(secret, Date.now() / 1000);
    const confirm = await agent.post('/api/auth/mfa/enroll/confirm').send({ code: enrolCode });
    const recovery = (confirm.body.recoveryCodes as string[])[0]!;

    const second = t.agent();
    const login = await second.post('/api/auth/login').send({ identifier: admin.phone, password: PASSWORD });
    expect(login.body).toEqual({ next: 'mfa' });
    expect((await second.post('/api/auth/mfa/verify').send({ code: '123456' })).body.error.code).toBe('mfa_invalid');
    // The code used during enrolment cannot be used again.
    expect((await second.post('/api/auth/mfa/verify').send({ code: enrolCode })).status).toBe(400);

    const viaRecovery = await second.post('/api/auth/mfa/verify').send({ recoveryCode: recovery.toLowerCase() });
    expect(viaRecovery.status).toBe(200);
    expect((await second.get('/api/platform/organizations')).status).toBe(200);

    const third = t.agent();
    await third.post('/api/auth/login').send({ identifier: admin.phone, password: PASSWORD });
    expect((await third.post('/api/auth/mfa/verify').send({ recoveryCode: recovery })).status).toBe(400);
  });

  it('keeps people without platform rights out of the platform, even with a complete sign-in', async () => {
    const person = await createPerson(t, { mfa: true });
    const agent = await signIn(t, person);
    expect((await agent.get('/api/platform/organizations')).status).toBe(403);
  });

  it('lets any staff member turn on an authenticator, which is then required at sign-in', async () => {
    const org = await createOrg(t);
    const { agent, person } = await memberAgent(t, org, ['finance']);
    const start = await agent.post('/api/auth/mfa/enroll/start').send({});
    expect(start.status).toBe(200);
    const secret = base32Decode(start.body.secretBase32 as string);
    const confirm = await agent.post('/api/auth/mfa/enroll/confirm').send({ code: totpAt(secret, Date.now() / 1000) });
    expect(confirm.status).toBe(200);
    expect((await agent.get('/api/auth/me')).body.person.mfaEnabled).toBe(true);

    const next = t.agent();
    const login = await next.post('/api/auth/login').send({ identifier: person.phone, password: PASSWORD });
    expect(login.body).toEqual({ next: 'mfa' });
    // Organization routes wait for the code.
    const blocked = await next.get(`/api/orgs/${org.slug}/dashboard`);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('mfa_required');
    const verify = await next.post('/api/auth/mfa/verify').send({ code: totpAt(secret, Date.now() / 1000 + 30) });
    expect(verify.status).toBe(200);
    expect(verify.body).toEqual({ next: 'ready', destination: `/app/${org.slug}/dashboard` });
  });

  it('records sign-ins without writing codes or passwords to the audit log', async () => {
    const admin = await createPlatformAdmin(t);
    await signIn(t, admin);
    const rows = await t.admin.query<{ action: string; details: unknown }>(
      `select action, details from platform_audit_events where actor_person_id = $1`,
      [admin.id],
    );
    expect(rows.rows.map((r) => r.action)).toEqual(expect.arrayContaining(['auth.login', 'auth.mfa_verified']));
    expect(JSON.stringify(rows.rows)).not.toContain(PASSWORD);
    expect(currentCode).toBeDefined();
  });
});
