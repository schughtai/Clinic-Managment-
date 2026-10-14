import { describe, expect, inject, it } from 'vitest';
import { createApp } from '../src/bootstrap';
import { DbService, UnsafeDatabaseRoleError } from '../src/db/db.service';
import { testConfig } from './support/app';

describe('database role check', () => {
  it('accepts the restricted application role', async () => {
    const db = new DbService(testConfig());
    await expect(db.assertRestrictedRole()).resolves.toBeUndefined();
    await db.onApplicationShutdown();
  });

  it('refuses a superuser connection', async () => {
    const db = new DbService(testConfig({ databaseUrl: inject('adminUrl') }));
    await expect(db.assertRestrictedRole()).rejects.toBeInstanceOf(UnsafeDatabaseRoleError);
    await db.onApplicationShutdown();
  });

  it('stops a production start with a superuser connection', async () => {
    const config = testConfig({
      nodeEnv: 'production',
      databaseUrl: inject('adminUrl'),
      allowedOrigins: ['https://clinic.example.test'],
      publicOrigin: 'https://clinic.example.test',
      cookieSecure: true,
    });
    await expect(createApp(config)).rejects.toThrow(/bypasses row-level security/);
  });
});
