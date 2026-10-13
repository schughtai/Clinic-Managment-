import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { Pool } from 'pg';
import { CONFIG, type AppConfig } from '../config/config';
import { Tx } from './tx';

/**
 * The only way application code reaches the database.
 *
 * withClinic opens a transaction that is bound to one clinic. PostgreSQL row-level security then
 * hides every other clinic's rows, even if a query forgets a filter.
 * withoutClinic is for the few sign-in functions that run before the clinic is known.
 */
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
    // An idle client can fail when the server restarts. The pool replaces it, so only log.
    this.pool.on('error', () => undefined);
  }

  async withClinic<T>(clinicId: string, work: (tx: Tx) => Promise<T>): Promise<T> {
    return this.run(clinicId, work);
  }

  async withoutClinic<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    return this.run(undefined, work);
  }

  async ping(): Promise<void> {
    await this.pool.query('select 1');
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }

  private async run<T>(clinicId: string | undefined, work: (tx: Tx) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      if (clinicId !== undefined) {
        await client.query("select set_config('app.clinic_id', $1, true)", [clinicId]);
      }
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
