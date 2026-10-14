import { createHash } from 'node:crypto';
import { badRequest, conflict } from '../../common/errors';

const KEY = /^[A-Za-z0-9._:-]{8,64}$/;

/** Reads the mandatory Idempotency-Key header on money-moving writes. */
export function requireIdempotencyKey(header: string | undefined): string {
  if (header === undefined || !KEY.test(header)) {
    throw badRequest('idempotency_required', 'Send an Idempotency-Key header (8 to 64 letters, digits, dots, dashes or colons).');
  }
  return header;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, sortKeys(record[key])]));
  }
  return value;
}

/** Stable hash of a request body, so a reused key with a different body can be detected. */
export function requestHash(body: unknown): string {
  return createHash('sha256').update(JSON.stringify(sortKeys(body))).digest('hex');
}

/** Same key and same body replay the original; same key with a different body is a conflict. */
export function assertSameRequest(storedHash: string, incomingHash: string): void {
  if (storedHash !== incomingHash) {
    throw conflict('idempotency_conflict', 'This key was already used for a different request.');
  }
}
