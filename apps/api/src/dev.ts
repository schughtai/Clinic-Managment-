import path from 'node:path';
import { createApp } from './bootstrap';
import { loadConfig } from './config/config';
import { DEV_APP_PASSWORD, startDevDatabase } from './db/dev-server';
import { migrate } from './db/migrate';
import { DEMO_ACCOUNTS, DEMO_PASSWORD, DEMO_TOTP_SECRET, seedDemo } from './db/seed';
import { base32Decode, totpAt } from './modules/identity/totp';

/**
 * One command for development: starts a real PostgreSQL, applies migrations and starts the API.
 * Data is kept in apps/api/data between runs. Never used in production.
 */
async function main(): Promise<void> {
  const root = process.cwd();
  const database = await startDevDatabase({ dataDir: path.join(root, 'data', 'pg'), port: Number(process.env.DEV_DB_PORT ?? 54329) });

  const applied = await migrate({ adminUrl: database.adminUrl, appPassword: DEV_APP_PASSWORD });

  // PORT may be set for the web server by preview tools, so the API reads its own variable.
  const config = loadConfig({ ...process.env, NODE_ENV: 'development', PORT: process.env.API_PORT ?? '3001', DATABASE_URL: database.appUrl });
  const seeded = await seedDemo(database.adminUrl, config.mfaKey);
  const { app, logger } = await createApp(config);
  await app.listen(config.port);

  const lines = [
    '',
    `Clinic API:  http://localhost:${config.port}/api/health`,
    `Database:    port ${process.env.DEV_DB_PORT ?? 54329}, data kept in apps/api/data/pg`,
    `Migrations:  ${applied.length === 0 ? 'up to date' : `applied ${applied.join(', ')}`}`,
    `Demo data:   ${seeded.seeded ? 'created' : 'already present'} (synthetic, development only). Password for all: ${DEMO_PASSWORD}`,
    `  Super Admin       ${DEMO_ACCOUNTS.superAdmin.email}  (authenticator key ${DEMO_TOTP_SECRET})`,
    `  Shifa admin       0${DEMO_ACCOUNTS.shifaAdmin.phone.slice(2)}`,
    `  Shifa reception   0${DEMO_ACCOUNTS.shifaReceptionist.phone.slice(2)}  (Gulberg branch only)`,
    `  Shifa finance     0${DEMO_ACCOUNTS.shifaFinance.phone.slice(2)}`,
    `  City Medical      0${DEMO_ACCOUNTS.cityAdmin.phone.slice(2)}`,
    process.env.DEV_PRINT_TOTP === 'true' ? 'Authenticator codes are printed every 30 seconds.' : 'Set DEV_PRINT_TOTP=true to print the Super Admin code here.',
    '',
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
  if (process.env.DEV_PRINT_TOTP === 'true') {
    const secret = base32Decode(DEMO_TOTP_SECRET);
    const print = (): void => {
      process.stdout.write(`Super Admin code: ${totpAt(secret, Date.now() / 1000)}\n`);
    };
    print();
    setInterval(print, 30_000).unref();
  }

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
