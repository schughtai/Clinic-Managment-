/**
 * Builds the SET part of an UPDATE from a fixed map of column names to new values.
 * Column names come only from code constants, never from request data. Values stay as parameters.
 * Fields that are undefined are skipped, so a partial update changes only what was sent.
 */
export function buildSet(
  fields: Readonly<Record<string, unknown>>,
  firstParameter: number,
): { sql: string; values: unknown[] } | null {
  const entries = Object.entries(fields).filter(([, value]) => value !== undefined);
  if (entries.length === 0) return null;
  for (const [column] of entries) {
    if (!/^[a-z_]+$/.test(column)) throw new Error(`Unsafe column name: ${column}`);
  }
  return {
    sql: entries.map(([column], index) => `${column} = $${firstParameter + index}`).join(', '),
    values: entries.map(([, value]) => value),
  };
}

/** Escapes the characters that have a special meaning inside a LIKE pattern. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}
