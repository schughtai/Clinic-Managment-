import path from 'node:path';
import { createApp } from './bootstrap';
import { loadConfig } from './config/config';
import { DEV_APP_PASSWORD, startDevDatabase } from './db/dev-server';
import { migrate } from './db/migrate';
import { DEMO_ACCOUNTS, DEMO_PASSWORD, seedDemo } from './db/seed';

/**
 * One command for development: starts a real PostgreSQL, applies migrations, adds demo data the first
 * time, and starts the API. Data is kept in apps/api/data between runs. Never used in production.
 */
async function main(): Promise<void> {
  const root = process.cwd();
  const database = await startDevDatabase({ dataDir: path.join(root, 'data', 'pg'), port: Number(process.env.DEV_DB_PORT ?? 54329) });

  const applied = await migrate({ adminUrl: database.adminUrl, appPassword: DEV_APP_PASSWORD });
  const seeded = await seedDemo(database.adminUrl);

  const config = loadConfig({
    ...process.env,
    NODE_ENV: 'development',
    DATABASE_URL: database.appUrl,
    SESSION_SECRET: process.env.SESSION_SECRET ?? 'development-only-session-secret-0123456789',
    SIGNUP_CODE: process.env.SIGNUP_CODE ?? 'dev-signup-code',
    UPLOAD_DIR: process.env.UPLOAD_DIR ?? path.join(root, 'data', 'uploads'),
  });
  const { app, logger } = await createApp(config);
  await app.listen(config.port);

  const lines = [
    '',
    `Clinic API:  http://localhost:${config.port}/api/health`,
    `Database:    port ${process.env.DEV_DB_PORT ?? 54329}, data kept in apps/api/data/pg`,
    `Migrations:  ${applied.length === 0 ? 'up to date' : `applied ${applied.join(', ')}`}`,
    seeded.seeded
      ? `Demo data:   created. Sign in with ${DEMO_ACCOUNTS.owner.phone}, ${DEMO_ACCOUNTS.doctor.phone} or ${DEMO_ACCOUNTS.receptionist.phone} and password ${DEMO_PASSWORD}`
      : 'Demo data:   already present',
    config.anthropicApiKey === undefined ? 'AI features:  off (set ANTHROPIC_API_KEY to enable handwriting reading)' : 'AI features:  available',
    '',
  ];
  process.stdout.write(`${lines.join('\n')}\n`);

  const shutdown = async (): Promise<void> => {
    logger.info('shutting down');
    await app.close();
    await database.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exit(1);
});
