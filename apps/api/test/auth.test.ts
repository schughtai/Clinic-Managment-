import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  PASSWORD,
  SIGNUP_CODE,
  type TestApp,
  addStaff,
  signUpClinic,
  startTestApp,
  uniquePhone,
} from './support/app';

let testApp: TestApp;

beforeAll(async () => {
  testApp = await startTestApp();
});

afterAll(async () => {
  await testApp.close();
});

interface ErrorBody {
  error: { code: string; message: string; details?: unknown; requestId?: string };
}

describe('health', () => {
  it('answers without signing in', async () => {
    const live = await testApp.anonymous().get('/api/health');
    expect(live.status).toBe(200);
    const ready = await testApp.anonymous().get('/api/health/ready');
    expect(ready.status).toBe(200);
    expect(ready.body).toEqual({ status: 'ready' });
  });
});

describe('clinic signup', () => {
  it('creates a clinic, signs the owner in and sets a safe cookie', async () => {
    const agent = testApp.anonymous();
    const response = await agent.post('/api/auth/register-clinic').send({
      signupCode: SIGNUP_CODE,
      clinicName: 'Shifa Clinic',
      ownerName: 'Dr Owner',
      phone: '0300 5550101',
      password: PASSWORD,
    });
    expect(response.status).toBe(201);
    expect(response.body).toEqual({ ok: true });

    const cookie = (response.headers['set-cookie'] as unknown as string[] | undefined)?.[0] ?? '';
    expect(cookie).toContain('clinic_session=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(JSON.stringify(response.body)).not.toContain('eyJ');

    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({
      user: { name: 'Dr Owner', role: 'owner', phone: '923005550101' },
      clinic: { name: 'Shifa Clinic', locale: 'en', aiEnabled: false, aiAvailable: false, modules: [] },
    });
  });

  it('rejects a wrong signup code and creates nothing', async () => {
    const response = await testApp
      .anonymous()
      .post('/api/auth/register-clinic')
      .send({ signupCode: 'WRONG-CODE', clinicName: 'X', ownerName: 'Y', phone: '03005550102', password: PASSWORD });
    expect(response.status).toBe(403);
    expect((response.body as ErrorBody).error.code).toBe('invalid_signup_code');
    const login = await testApp.anonymous().post('/api/auth/login').send({ phone: '03005550102', password: PASSWORD });
    expect(login.status).toBe(401);
  });

  it('rejects a phone number that is already registered', async () => {
    const first = await signUpClinic(testApp);
    const response = await testApp
      .anonymous()
      .post('/api/auth/register-clinic')
      .send({ signupCode: SIGNUP_CODE, clinicName: 'Other', ownerName: 'Other', phone: first.phone, password: PASSWORD });
    expect(response.status).toBe(409);
    expect((response.body as ErrorBody).error.code).toBe('phone_in_use');
  });

  it('reports field problems clearly', async () => {
    const response = await testApp
      .anonymous()
      .post('/api/auth/register-clinic')
      .send({ signupCode: SIGNUP_CODE, clinicName: '', ownerName: 'Y', phone: '123', password: 'short' });
    expect(response.status).toBe(400);
    const body = response.body as ErrorBody;
    expect(body.error.code).toBe('validation_failed');
    const paths = (body.error.details as { path: string }[]).map((issue) => issue.path).sort();
    expect(paths).toEqual(['clinicName', 'password', 'phone']);
    expect(body.error.requestId).toBeTruthy();
  });

  it('is switched off when the server has no signup code', async () => {
    const closed = await startTestApp({ signupCode: undefined });
    try {
      const response = await closed
        .anonymous()
        .post('/api/auth/register-clinic')
        .send({ signupCode: SIGNUP_CODE, clinicName: 'X', ownerName: 'Y', phone: uniquePhone(), password: PASSWORD });
      expect(response.status).toBe(404);
    } finally {
      await closed.close();
    }
  });
});

describe('sign-in', () => {
  it('gives the same answer for an unknown phone and a wrong password', async () => {
    const clinic = await signUpClinic(testApp);
    const unknown = await testApp.anonymous().post('/api/auth/login').send({ phone: uniquePhone(), password: PASSWORD });
    const wrong = await testApp.anonymous().post('/api/auth/login').send({ phone: clinic.phone, password: 'nope-nope-nope' });
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect((unknown.body as ErrorBody).error.message).toBe((wrong.body as ErrorBody).error.message);
    expect((unknown.body as ErrorBody).error.code).toBe((wrong.body as ErrorBody).error.code);
  });

  it('accepts the phone number in any common format', async () => {
    const clinic = await signUpClinic(testApp);
    const international = `+92 ${clinic.phone.slice(1, 4)} ${clinic.phone.slice(4)}`;
    const response = await testApp.anonymous().post('/api/auth/login').send({ phone: international, password: PASSWORD });
    expect(response.status).toBe(200);
  });

  it('locks the account after repeated wrong passwords', async () => {
    const clinic = await signUpClinic(testApp);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await testApp.anonymous().post('/api/auth/login').send({ phone: clinic.phone, password: 'wrong-wrong' });
      expect(response.status).toBe(401);
    }
    const locked = await testApp.anonymous().post('/api/auth/login').send({ phone: clinic.phone, password: PASSWORD });
    expect(locked.status).toBe(429);
    expect((locked.body as ErrorBody).error.code).toBe('account_locked');
  });

  it('applies a rate limit to sign-in attempts', async () => {
    const limited = await startTestApp({ loginRatePerMinute: 3 });
    try {
      const statuses: number[] = [];
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const response = await limited.anonymous().post('/api/auth/login').send({ phone: uniquePhone(), password: 'x-x-x-x-x-x' });
        statuses.push(response.status);
      }
      expect(statuses).toEqual([401, 401, 401, 429, 429]);
    } finally {
      await limited.close();
    }
  });

  it('refuses requests from an unknown website even with a valid session', async () => {
    const clinic = await signUpClinic(testApp);
    const response = await clinic.agent.patch('/api/clinic').set('Origin', 'https://evil.example').send({ name: 'Hijacked' });
    expect(response.status).toBe(403);
    expect((response.body as ErrorBody).error.code).toBe('origin_not_allowed');
    const allowed = await clinic.agent.patch('/api/clinic').set('Origin', 'http://localhost:3000').send({ name: 'Renamed' });
    expect(allowed.status).toBe(200);
  });
});

describe('sessions', () => {
  it('refuses private routes without a session or with a forged one', async () => {
    const none = await testApp.anonymous().get('/api/clinic');
    expect(none.status).toBe(401);
    const forged = await testApp.anonymous().get('/api/clinic').set('Cookie', 'clinic_session=not.a.token');
    expect(forged.status).toBe(401);
  });

  it('ends the session on logout', async () => {
    const clinic = await signUpClinic(testApp);
    expect((await clinic.agent.get('/api/auth/me')).status).toBe(200);
    expect((await clinic.agent.post('/api/auth/logout')).status).toBe(200);
    expect((await clinic.agent.get('/api/auth/me')).status).toBe(401);
  });

  it('stops working at once when the user is deactivated', async () => {
    const owner = await signUpClinic(testApp);
    const staff = await addStaff(testApp, owner, 'receptionist');
    expect((await staff.agent.get('/api/auth/me')).status).toBe(200);
    const off = await owner.agent.patch(`/api/users/${staff.userId}`).send({ active: false });
    expect(off.status).toBe(200);
    expect((await staff.agent.get('/api/auth/me')).status).toBe(401);
    const login = await testApp.anonymous().post('/api/auth/login').send({ phone: staff.phone, password: PASSWORD });
    expect(login.status).toBe(401);
  });

  it('signs out other sessions when the password changes but keeps the current one', async () => {
    const owner = await signUpClinic(testApp);
    const second = testApp.anonymous();
    expect((await second.post('/api/auth/login').send({ phone: owner.phone, password: PASSWORD })).status).toBe(200);

    const wrong = await owner.agent.post('/api/auth/change-password').send({ currentPassword: 'bad-bad-bad', newPassword: 'a new password 1' });
    expect(wrong.status).toBe(400);
    const changed = await owner.agent
      .post('/api/auth/change-password')
      .send({ currentPassword: PASSWORD, newPassword: 'a new password 1' });
    expect(changed.status).toBe(200);

    expect((await owner.agent.get('/api/auth/me')).status).toBe(200);
    expect((await second.get('/api/auth/me')).status).toBe(401);
    const relogin = await testApp.anonymous().post('/api/auth/login').send({ phone: owner.phone, password: 'a new password 1' });
    expect(relogin.status).toBe(200);
  });
});

describe('roles', () => {
  it('lets only the owner change settings and manage staff', async () => {
    const owner = await signUpClinic(testApp);
    const reception = await addStaff(testApp, owner, 'receptionist');
    const doctor = await addStaff(testApp, owner, 'doctor');

    for (const other of [reception, doctor]) {
      expect((await other.agent.patch('/api/clinic').send({ name: 'Nope' })).status).toBe(403);
      expect((await other.agent.get('/api/users')).status).toBe(403);
      expect((await other.agent.post('/api/users').send({ name: 'X', phone: uniquePhone(), password: PASSWORD, role: 'owner' })).status).toBe(403);
    }
    expect((await reception.agent.get('/api/clinic')).status).toBe(200);
    expect((await owner.agent.get('/api/users')).status).toBe(200);
  });

  it('stops an owner from deactivating or demoting themselves', async () => {
    const owner = await signUpClinic(testApp);
    const users = await owner.agent.get('/api/users');
    const ownerId = (users.body as { id: string }[])[0]?.id ?? '';

    const self = await owner.agent.patch(`/api/users/${ownerId}`).send({ active: false });
    expect(self.status).toBe(400);
    expect((self.body as ErrorBody).error.code).toBe('cannot_change_self');
    const selfDemote = await owner.agent.patch(`/api/users/${ownerId}`).send({ role: 'receptionist' });
    expect(selfDemote.status).toBe(400);
  });

  it('ends the sessions of an owner who was demoted by another owner', async () => {
    const owner = await signUpClinic(testApp);
    const ownerId = ((await owner.agent.get('/api/users')).body as { id: string }[])[0]?.id ?? '';
    const secondOwner = await addStaff(testApp, owner, 'owner', 'Second Owner');

    const demote = await secondOwner.agent.patch(`/api/users/${ownerId}`).send({ role: 'receptionist' });
    expect(demote.status).toBe(200);
    expect((await owner.agent.get('/api/auth/me')).status).toBe(401);
    expect((await owner.agent.get('/api/users')).status).toBe(401);
  });

  it('cannot be left without an owner when two owners demote each other at the same time', async () => {
    const first = await signUpClinic(testApp);
    const firstId = ((await first.agent.get('/api/users')).body as { id: string }[])[0]?.id ?? '';
    const second = await addStaff(testApp, first, 'owner', 'Second Owner');

    const [byFirst, bySecond] = await Promise.all([
      first.agent.patch(`/api/users/${second.userId}`).send({ role: 'receptionist' }),
      second.agent.patch(`/api/users/${firstId}`).send({ role: 'receptionist' }),
    ]);
    const statuses = [byFirst.status, bySecond.status].sort();
    // Exactly one change succeeds. The other is refused because its caller is no longer an owner.
    expect(statuses[0]).toBe(200);
    expect([401, 403, 409]).toContain(statuses[1]);

    const survivor = byFirst.status === 200 ? first : second;
    const users = await survivor.agent.get('/api/users');
    expect(users.status).toBe(200);
    const activeOwners = (users.body as { role: string; active: boolean }[]).filter((user) => user.role === 'owner' && user.active);
    expect(activeOwners).toHaveLength(1);
  });
});

describe('clinic isolation through the API', () => {
  it('never shows or changes another clinic\'s staff', async () => {
    const clinicA = await signUpClinic(testApp, 'Clinic A');
    const clinicB = await signUpClinic(testApp, 'Clinic B');
    const staffA = await addStaff(testApp, clinicA, 'receptionist', 'Only In A');

    const listB = await clinicB.agent.get('/api/users');
    expect((listB.body as { name: string }[]).some((user) => user.name === 'Only In A')).toBe(false);

    const patch = await clinicB.agent.patch(`/api/users/${staffA.userId}`).send({ active: false });
    expect(patch.status).toBe(404);
    const reset = await clinicB.agent.post(`/api/users/${staffA.userId}/reset-password`).send({ newPassword: 'hijack password 1' });
    expect(reset.status).toBe(404);
    expect((await staffA.agent.get('/api/auth/me')).status).toBe(200);
  });
});
