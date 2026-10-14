import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { Pool, type PoolClient } from 'pg';
import { CONFIG, type AppConfig } from '../config/config';
import { Tx } from './tx';

/**
 * Who a transaction acts for. PostgreSQL row-level security reads these values, so a query that
 * forgets a filter still cannot see another organization's rows.
 */
export interface DbContext {
  /** The organization of an organization route. */
  orgId?: string;
  /** Every facility ('*') or only these. Omitted means none. */
  facilityIds?: readonly string[] | '*';
  /** The signed-in person. */
  personId?: string;
  /** A Super Admin on a platform route, after the authenticator check. */
  platform?: boolean;
}

export class UnsafeDatabaseRoleError extends Error {}

/** The only way application code reaches the database. */
@Injectable()
export class DbService implements OnApplicationShutdown {
  private readonly pool: Pool;

  constructor(@Inject(CONFIG) config: AppConfig) {
    this.pool = new Pool({
      connectionString: config.databaseUrl,
      max: 10,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      statement_timeout: 15_000,
      idle_in_transaction_session_timeout: 30_000,
    });
    // An idle client can fail when the server restarts. The pool replaces it, so only ignore.
    this.pool.on('error', () => undefined);
  }

  async withContext<T>(context: DbContext, work: (tx: Tx) => Promise<T>): Promise<T> {
    return this.run(context, work);
  }

  /** For steps before anyone is known, such as sign-in. Only security-definer functions help here. */
  async withoutContext<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    return this.run({}, work);
  }

  async ping(): Promise<void> {
    await this.pool.query('select 1');
  }

  /**
   * Superusers and roles with BYPASSRLS ignore row-level security. Managed hosts hand out such
   * connection strings by default, so refuse to run with one.
   */
  async assertRestrictedRole(): Promise<void> {
    const result = await this.pool.query<{ rolsuper: boolean; rolbypassrls: boolean; rolname: string }>(
      'select rolname, rolsuper, rolbypassrls from pg_roles where rolname = current_user',
    );
    const role = result.rows[0];
    if (role === undefined || role.rolsuper || role.rolbypassrls) {
      throw new UnsafeDatabaseRoleError(
        `DATABASE_URL connects as "${role?.rolname ?? 'unknown'}", which bypasses row-level security. ` +
          'Use the restricted clinic_app role (see docs/v2/deploy-railway.md).',
      );
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }

  private async run<T>(context: DbContext, work: (tx: Tx) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await applyContext(client, context);
      const result = await work(new Tx(client));
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

async function applyContext(client: PoolClient, context: DbContext): Promise<void> {
  const facilities =
    context.facilityIds === undefined ? '' : context.facilityIds === '*' ? '*' : context.facilityIds.join(',');
  await client.query(
    `select set_config('app.org_id', $1, true), set_config('app.facility_ids', $2, true),
            set_config('app.person_id', $3, true), set_config('app.platform', $4, true)`,
    [context.orgId ?? '', facilities, context.personId ?? '', context.platform === true ? 'on' : ''],
  );
}
