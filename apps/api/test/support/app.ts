import type { NestExpressApplication } from '@nestjs/platform-express';
import bcrypt from 'bcryptjs';
import { Client } from 'pg';
import supertest from 'supertest';
import { expect, inject } from 'vitest';
import { createApp } from '../../src/bootstrap';
import { type AppConfig, DEV_MFA_KEY } from '../../src/config/config';
import { seal } from '../../src/modules/identity/crypto-box';
import { ROLE_TEMPLATES, type RoleKey } from '../../src/modules/identity/permissions';
import { newTotpSecret, totpAt } from '../../src/modules/identity/totp';

export const PASSWORD = 'correct horse battery';
export type Agent = ReturnType<typeof supertest.agent>;

export interface TestApp {
  app: NestExpressApplication;
  config: AppConfig;
  /** A client with its own cookie jar and no session. */
  agent: () => Agent;
  /** Direct database access as the migration role, for building fixtures quickly. */
  admin: Client;
  close: () => Promise<void>;
}

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    nodeEnv: 'test',
    port: 0,
    databaseUrl: inject('appUrl'),
    adminDatabaseUrl: inject('adminUrl'),
    sessionHours: 12,
    mfaKey: Buffer.from(DEV_MFA_KEY, 'hex'),
    allowedOrigins: ['http://localhost:3000'],
    publicOrigin: 'http://localhost:3000',
    cookieSecure: false,
    webDistDir: undefined,
    logLevel: process.env.TEST_LOG_LEVEL ?? 'silent',
    trustProxy: 0,
    rateLimitPerMinute: 100_000,
    loginRatePerMinute: 100_000,
    ...overrides,
  };
}

export async function startTestApp(overrides: Partial<AppConfig> = {}): Promise<TestApp> {
  const config = testConfig(overrides);
  const { app } = await createApp(config);
  await app.init();
  const admin = new Client({ connectionString: inject('adminUrl') });
  await admin.connect();
  return {
    app,
    config,
    admin,
    agent: () => supertest.agent(app.getHttpServer()),
    close: async () => {
      await admin.end();
      await app.close();
    },
  };
}

let counter = 0;
const unique = (): string => {
  counter += 1;
  return `${Date.now() % 100_000_000}${counter}`.slice(-7).padStart(7, '0');
};

/** A unique Pakistani mobile number in stored form (92 + 10 digits). */
export const uniquePhone = (): string => `92300${unique()}`;
export const uniqueSlug = (prefix = 'org'): string => `${prefix}-${unique()}`;

const passwordHash = bcrypt.hashSync(PASSWORD, 4);

export interface TestPerson {
  id: string;
  name: string;
  phone: string;
  /** Present when the person has an authenticator enrolled. */
  totpSecret?: Buffer;
}

export async function createPerson(t: TestApp, options: { name?: string; mfa?: boolean } = {}): Promise<TestPerson> {
  const phone = uniquePhone();
  const name = options.name ?? `Person ${phone.slice(-4)}`;
  const secret = options.mfa === true ? newTotpSecret() : undefined;
  const row = await t.admin.query<{ id: string }>(
    `insert into persons (display_name, phone, password_hash, mfa_secret_enc, mfa_enabled_at)
     values ($1, $2, $3, $4, case when $4::bytea is null then null else now() end) returning id`,
    [name, phone, passwordHash, secret === undefined ? null : seal(t.config.mfaKey, secret)],
  );
  return { id: row.rows[0]!.id, name, phone, ...(secret === undefined ? {} : { totpSecret: secret }) };
}

/** A Super Admin with an enrolled authenticator (unless `enrolled` is false). */
export async function createPlatformAdmin(t: TestApp, enrolled = true): Promise<TestPerson> {
  const person = await createPerson(t, { name: 'Platform Owner', mfa: enrolled });
  await t.admin.query('insert into platform_admins (person_id) values ($1)', [person.id]);
  return person;
}

export interface TestOrg {
  id: string;
  slug: string;
  facilityIds: string[];
  roleIds: Record<RoleKey, string>;
}

export async function createOrg(
  t: TestApp,
  options: { name?: string; facilities?: number; status?: 'setup_required' | 'active' } = {},
): Promise<TestOrg> {
  const slug = uniqueSlug();
  const org = await t.admin.query<{ id: string }>(
    `insert into organizations (name, slug, status, phone, address) values ($1, $2, 'provisioning', '923001234567', '1 Test Road') returning id`,
    [options.name ?? `Org ${slug}`, slug],
  );
  const id = org.rows[0]!.id;
  const facilityIds: string[] = [];
  for (let index = 0; index < (options.facilities ?? 1); index += 1) {
    const facility = await t.admin.query<{ id: string }>(
      `insert into facilities (organization_id, name, address, opening_hours)
       values ($1, $2, '1 Test Road', '[{"day":1,"opens":"09:00","closes":"17:00"}]') returning id`,
      [id, `Branch ${index + 1}`],
    );
    facilityIds.push(facility.rows[0]!.id);
  }
  const roleIds = {} as Record<RoleKey, string>;
  for (const role of ROLE_TEMPLATES) {
    const row = await t.admin.query<{ id: string }>(
      'insert into roles (organization_id, key, name, permissions, system, requires_module) values ($1, $2, $3, $4, true, $5) returning id',
      [id, role.key, role.name, role.permissions, role.requiresModule],
    );
    roleIds[role.key] = row.rows[0]!.id;
  }
  await t.admin.query(`update organizations set status = 'setup_required' where id = $1`, [id]);
  if (options.status === 'active') await t.admin.query(`update organizations set status = 'active' where id = $1`, [id]);
  return { id, slug, facilityIds, roleIds };
}

/** Adds a person to an organization with roles and facility access. Returns the membership id. */
export async function addMember(t: TestApp, org: TestOrg, person: TestPerson, roles: RoleKey[], facilities: 'all' | string[] = 'all'): Promise<string> {
  const membership = await t.admin.query<{ id: string }>(
    'insert into memberships (organization_id, person_id, facility_scope) values ($1, $2, $3) returning id',
    [org.id, person.id, facilities === 'all' ? 'all' : 'selected'],
  );
  const membershipId = membership.rows[0]!.id;
  for (const role of roles) {
    await t.admin.query('insert into membership_roles (membership_id, role_id, organization_id) values ($1, $2, $3)', [membershipId, org.roleIds[role], org.id]);
  }
  if (facilities !== 'all') {
    for (const facility of facilities) {
      await t.admin.query('insert into membership_facilities (membership_id, facility_id, organization_id) values ($1, $2, $3)', [
        membershipId,
        facility,
        org.id,
      ]);
    }
  }
  return membershipId;
}

/** A person with a membership, signed in on a fresh agent. */
export async function memberAgent(t: TestApp, org: TestOrg, roles: RoleKey[], facilities: 'all' | string[] = 'all') {
  const person = await createPerson(t);
  const membershipId = await addMember(t, org, person, roles, facilities);
  const agent = await signIn(t, person);
  return { person, membershipId, agent };
}

/** Signs in through the API, answering the authenticator step when the person has one. */
export async function signIn(t: TestApp, person: TestPerson, agent: Agent = t.agent()): Promise<Agent> {
  const login = await agent.post('/api/auth/login').send({ identifier: person.phone, password: PASSWORD });
  expect(login.status, JSON.stringify(login.body)).toBe(200);
  if (login.body.next === 'mfa') {
    expect(person.totpSecret).toBeDefined();
    const verify = await agent.post('/api/auth/mfa/verify').send({ code: currentCode(person) });
    expect(verify.status, JSON.stringify(verify.body)).toBe(200);
  }
  return agent;
}

/**
 * The authenticator code for now. Codes can be used once per 30-second step, so a test that needs a
 * second code moves to the next step (allowed by the one-step drift window).
 */
const lastStepUsed = new Map<string, number>();
export function currentCode(person: TestPerson): string {
  const secret = person.totpSecret;
  if (secret === undefined) throw new Error('Person has no authenticator.');
  const now = Math.floor(Date.now() / 1000);
  const key = person.id;
  const used = lastStepUsed.get(key) ?? 0;
  const at = used >= Math.floor(now / 30) ? (used + 1) * 30 : now;
  lastStepUsed.set(key, Math.floor(at / 30));
  return totpAt(secret, at);
}
