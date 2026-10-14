import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import supertest from 'supertest';
import { inject } from 'vitest';
import type { AppOverrides } from '../../src/app.module';
import { createApp } from '../../src/bootstrap';
import type { AppConfig } from '../../src/config/config';

export const SIGNUP_CODE = 'TEST-SIGNUP-CODE';
export const PASSWORD = 'correct horse battery';

export type Agent = ReturnType<typeof supertest.agent>;

export interface TestApp {
  app: NestExpressApplication;
  config: AppConfig;
  /** A client with no session. */
  anonymous: () => Agent;
  close: () => Promise<void>;
}

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    nodeEnv: 'test',
    port: 0,
    databaseUrl: inject('appUrl'),
    adminDatabaseUrl: inject('adminUrl'),
    sessionSecret: 'test-secret-value-that-is-long-enough-1234567890',
    sessionHours: 12,
    allowedOrigins: ['http://localhost:3000'],
    cookieSecure: false,
    signupCode: SIGNUP_CODE,
    uploadDir: mkdtempSync(path.join(tmpdir(), 'clinic-uploads-')),
    uploadMaxBytes: 5_000_000,
    anthropicApiKey: undefined,
    aiModel: 'claude-opus-5',
    aiTimeoutMs: 5_000,
    logLevel: process.env.TEST_LOG_LEVEL ?? 'silent',
    trustProxy: 0,
    rateLimitPerMinute: 100_000,
    loginRatePerMinute: 100_000,
    ...overrides,
  };
}

export async function startTestApp(
  overrides: Partial<AppConfig> = {},
  appOverrides: AppOverrides = {},
): Promise<TestApp> {
  const config = testConfig(overrides);
  const { app } = await createApp(config, appOverrides);
  await app.init();
  return {
    app,
    config,
    anonymous: () => supertest.agent(app.getHttpServer()),
    close: () => app.close(),
  };
}

let phoneCounter = 0;

/** A unique valid Pakistani mobile number, so test files never collide on the global phone rule. */
export function uniquePhone(): string {
  phoneCounter += 1;
  const suffix = `${Date.now() % 1_000_000}${phoneCounter}`.padStart(7, '0').slice(-7);
  return `0300${suffix}`;
}

export interface SignedInClinic {
  agent: Agent;
  phone: string;
  clinicName: string;
}

/** Creates a clinic through the public signup route and returns a client that is signed in as its owner. */
export async function signUpClinic(testApp: TestApp, clinicName = 'Test Clinic'): Promise<SignedInClinic> {
  const agent = testApp.anonymous();
  const phone = uniquePhone();
  const response = await agent
    .post('/api/auth/register-clinic')
    .send({ signupCode: SIGNUP_CODE, clinicName, ownerName: 'Owner Name', phone, password: PASSWORD });
  if (response.status !== 201) {
    throw new Error(`Signup failed: ${response.status} ${JSON.stringify(response.body)}`);
  }
  return { agent, phone, clinicName };
}

/** Creates a staff account as the owner and returns a client signed in as that user. */
export async function addStaff(
  testApp: TestApp,
  owner: SignedInClinic,
  role: 'doctor' | 'receptionist' | 'owner',
  name = `${role} user`,
): Promise<SignedInClinic & { userId: string }> {
  const phone = uniquePhone();
  const created = await owner.agent.post('/api/users').send({ name, phone, password: PASSWORD, role });
  if (created.status !== 201) {
    throw new Error(`Could not create staff: ${created.status} ${JSON.stringify(created.body)}`);
  }
  const agent = testApp.anonymous();
  const login = await agent.post('/api/auth/login').send({ phone, password: PASSWORD });
  if (login.status !== 200) throw new Error(`Staff login failed: ${login.status}`);
  return { agent, phone, clinicName: owner.clinicName, userId: (created.body as { id: string }).id };
}
