import type { PoolClient, QueryResultRow } from 'pg';

/** A transaction handle with typed helpers. SQL always uses numbered parameters, never string building. */
export class Tx {
  constructor(private readonly client: PoolClient) {}

  async many<R extends QueryResultRow>(sql: string, params: readonly unknown[] = []): Promise<R[]> {
    const result = await this.client.query<R>(sql, params as unknown[]);
    return result.rows;
  }

  async maybeOne<R extends QueryResultRow>(sql: string, params: readonly unknown[] = []): Promise<R | null> {
    const rows = await this.many<R>(sql, params);
    if (rows.length > 1) {
      throw new Error('Expected at most one row but the query returned more.');
    }
    return rows[0] ?? null;
  }

  async one<R extends QueryResultRow>(sql: string, params: readonly unknown[] = []): Promise<R> {
    const row = await this.maybeOne<R>(sql, params);
    if (row === null) {
      throw new Error('Expected one row but the query returned none.');
    }
    return row;
  }

  /** Runs a statement and returns the number of affected rows. */
  async execute(sql: string, params: readonly unknown[] = []): Promise<number> {
    const result = await this.client.query(sql, params as unknown[]);
    return result.rowCount ?? 0;
  }
}
