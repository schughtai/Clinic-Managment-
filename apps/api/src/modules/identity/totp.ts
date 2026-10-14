import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** Time-based one-time codes (RFC 6238) as used by authenticator apps: SHA-1, 6 digits, 30 seconds. */

export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function newTotpSecret(): Buffer {
  return randomBytes(20);
}

export function base32Encode(data: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of data) {
    value = ((value << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index === -1) throw new Error('Invalid base32 text.');
    value = ((value << 5) | index) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** HOTP (RFC 4226) for one counter value. Digits and algorithm vary only for the RFC test vectors. */
export function hotp(secret: Buffer, counter: bigint, digits = TOTP_DIGITS, algorithm: 'sha1' | 'sha256' | 'sha512' = 'sha1'): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(counter);
  const digest = createHmac(algorithm, secret).update(message).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) | (digest[offset + 1]! << 16) | (digest[offset + 2]! << 8) | digest[offset + 3]!;
  return String(binary % 10 ** digits).padStart(digits, '0');
}

export function stepAt(unixSeconds: number): bigint {
  return BigInt(Math.floor(unixSeconds / TOTP_STEP_SECONDS));
}

export function totpAt(secret: Buffer, unixSeconds: number): string {
  return hotp(secret, stepAt(unixSeconds));
}

/**
 * Checks a code against the current step and one step either side (clock drift). Returns the
 * matched step so the caller can refuse its reuse, or null.
 */
export function verifyTotp(secret: Buffer, code: string, unixSeconds: number, lastUsedStep: bigint | null): bigint | null {
  if (!/^[0-9]{6}$/.test(code)) return null;
  const current = stepAt(unixSeconds);
  for (const step of [current - 1n, current, current + 1n]) {
    if (lastUsedStep !== null && step <= lastUsedStep) continue;
    if (timingSafeEqual(Buffer.from(hotp(secret, step)), Buffer.from(code))) return step;
  }
  return null;
}

/** The link authenticator apps read from a QR code. */
export function otpauthUri(secret: Buffer, issuer: string, account: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret: base32Encode(secret),
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
