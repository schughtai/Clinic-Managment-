import path from 'node:path';
import { createApp } from './bootstrap';
import { loadConfig } from './config/config';
import { DEV_APP_PASSWORD, startDevDatabase } from './db/dev-server';
import { migrate } from './db/migrate';

/**
 * One command for development: starts a real PostgreSQL, applies migrations and starts the API.
 * Data is kept in apps/api/data between runs. Never used in production.
 */
async function main(): Promise<void> {
  const root = process.cwd();
  const database = await startDevDatabase({ dataDir: path.join(root, 'data', 'pg'), port: Number(process.env.DEV_DB_PORT ?? 54329) });

  const applied = await migrate({ adminUrl: database.adminUrl, appPassword: DEV_APP_PASSWORD });

  const config = loadConfig({ ...process.env, NODE_ENV: 'development', DATABASE_URL: database.appUrl });
  const { app, logger } = await createApp(config);
  await app.listen(config.port);

  const lines = [
    '',
    `Clinic API:  http://localhost:${config.port}/api/health`,
    `Database:    port ${process.env.DEV_DB_PORT ?? 54329}, data kept in apps/api/data/pg`,
    `Migrations:  ${applied.length === 0 ? 'up to date' : `applied ${applied.join(', ')}`}`,
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
