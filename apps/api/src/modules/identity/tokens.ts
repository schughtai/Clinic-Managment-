import { createHash, randomBytes } from 'node:crypto';

/** A random secret for sessions, invitations and resets: 32 bytes, URL-safe. */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Only this hash is stored, so a database leak does not reveal usable tokens. */
export function hashToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

/** Tokens are always 43 base64url characters. Anything else is refused before touching the database. */
export function isTokenShaped(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
}
