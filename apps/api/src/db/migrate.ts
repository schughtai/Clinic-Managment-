import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';

/** The restricted role the application connects as. It is not a superuser and does not own the tables. */
export const APP_ROLE = 'clinic_app';

const MIGRATION_LOCK_ID = 727_274;

export interface MigrateOptions {
  /** Connection string of a role that can create roles, extensions and tables. */
  adminUrl: string;
  /** Password to set on the application role. Taken from DATABASE_URL. */
  appPassword: string;
  migrationsDir?: string;
}

export function passwordFromUrl(databaseUrl: string): string {
  const password = decodeURIComponent(new URL(databaseUrl).password);
  if (password === '') {
    throw new Error('DATABASE_URL must include a password for the application role.');
  }
  return password;
}

export function listMigrationFiles(directory: string): string[] {
  return readdirSync(directory)
    .filter((file) => /^\d{4}_[a-z0-9_]+\.sql$/.test(file))
    .sort();
}

/** Urdu names and notes need UTF-8. A legacy encoding would reject them at save time, so refuse to start. */
export async function assertUtf8Database(client: Client): Promise<void> {
  const result = await client.query<{ encoding: string }>(
    'select pg_encoding_to_char(encoding) as encoding from pg_database where datname = current_database()',
  );
  const encoding = result.rows[0]?.encoding;
  if (encoding !== 'UTF8') {
    throw new Error(`The database encoding is ${encoding ?? 'unknown'} but must be UTF8. Create the database with ENCODING 'UTF8'.`);
  }
}

async function ensureAppRole(client: Client, password: string): Promise<void> {
  const existing = await client.query('select 1 from pg_roles where rolname = $1', [APP_ROLE]);
  const template =
    existing.rowCount === 0
      ? 'create role %I login password %L nosuperuser nocreatedb nocreaterole nobypassrls'
      : 'alter role %I login password %L nosuperuser nobypassrls';
  const built = await client.query<{ statement: string }>('select format($1::text, $2::text, $3::text) as statement', [
    template,
    APP_ROLE,
    password,
  ]);
  const statement = built.rows[0]?.statement;
  if (statement === undefined) throw new Error('Could not build the role statement.');
  await client.query(statement);
  await client.query(`grant usage on schema public to ${APP_ROLE}`);
}

/**
 * Applies pending SQL migrations in order. Safe to run repeatedly and from several machines,
 * because an advisory lock serialises runs and each file is applied in its own transaction.
 */
export async function migrate(options: MigrateOptions): Promise<string[]> {
  const directory = options.migrationsDir ?? path.join(__dirname, 'migrations');
  const client = new Client({ connectionString: options.adminUrl });
  await client.connect();
  const applied: string[] = [];
  try {
    await client.query('select pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    await assertUtf8Database(client);
    await ensureAppRole(client, options.appPassword);
    await client.query(
      'create table if not exists schema_migrations (version text primary key, applied_at timestamptz not null default now())',
    );
    const done = await client.query<{ version: string }>('select version from schema_migrations');
    const alreadyApplied = new Set(done.rows.map((row) => row.version));

    for (const file of listMigrationFiles(directory)) {
      if (alreadyApplied.has(file)) continue;
      const sql = readFileSync(path.join(directory, file), 'utf8');
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query('insert into schema_migrations (version) values ($1)', [file]);
        await client.query('commit');
        applied.push(file);
      } catch (error) {
        await client.query('rollback');
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`Migration ${file} failed and was rolled back: ${reason}`);
      }
    }
  } finally {
    await client.query('select pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => undefined);
    await client.end();
  }
  return applied;
}
