import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * A real PostgreSQL server for development and tests, started from an npm package.
 * Never used in production. See docs/decisions/0005-development-database.md.
 */

export interface DevDatabase {
  adminUrl: string;
  appUrl: string;
  stop: () => Promise<void>;
}

export interface DevDatabaseOptions {
  dataDir: string;
  port: number;
  database?: string;
  /** Delete the data directory on stop. Used by tests. */
  ephemeral?: boolean;
}

const ADMIN_USER = 'postgres';
const ADMIN_PASSWORD = 'dev-admin-password';
export const DEV_APP_PASSWORD = 'dev-app-password';

export async function startDevDatabase(options: DevDatabaseOptions): Promise<DevDatabase> {
  const database = options.database ?? 'clinic';
  // The package is ESM-only, so it is loaded with a dynamic import from this CommonJS code.
  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  const server = new EmbeddedPostgres({
    databaseDir: options.dataDir,
    port: options.port,
    user: ADMIN_USER,
    password: ADMIN_PASSWORD,
    persistent: !options.ephemeral,
    onLog: () => undefined,
    onError: () => undefined,
  });

  if (!existsSync(path.join(options.dataDir, 'PG_VERSION'))) {
    await server.initialise();
  }
  await server.start();

  const admin = server.getPgClient('postgres');
  await admin.connect();
  try {
    const found = await admin.query('select 1 from pg_database where datname = $1', [database]);
    if (found.rowCount === 0) {
      await admin.query(`create database "${database}"`);
    }
  } finally {
    await admin.end();
  }

  return {
    adminUrl: `postgres://${ADMIN_USER}:${ADMIN_PASSWORD}@127.0.0.1:${options.port}/${database}`,
    appUrl: `postgres://clinic_app:${DEV_APP_PASSWORD}@127.0.0.1:${options.port}/${database}`,
    stop: () => server.stop(),
  };
}
