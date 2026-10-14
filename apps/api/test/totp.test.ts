import { describe, expect, it } from 'vitest';
import { open, seal } from '../src/modules/identity/crypto-box';
import { hashToken, isTokenShaped, newToken } from '../src/modules/identity/tokens';
import { base32Decode, base32Encode, hotp, otpauthUri, stepAt, totpAt, verifyTotp } from '../src/modules/identity/totp';

// RFC 6238 Appendix B seeds (ASCII digits repeated to the key length of each algorithm).
const SEED_SHA1 = Buffer.from('12345678901234567890', 'ascii');
const SEED_SHA256 = Buffer.from('12345678901234567890123456789012', 'ascii');
const SEED_SHA512 = Buffer.from('1234567890123456789012345678901234567890123456789012345678901234', 'ascii');

const VECTORS: Array<[number, string, string, string]> = [
  [59, '94287082', '46119246', '90693936'],
  [1111111109, '07081804', '68084774', '25091201'],
  [1111111111, '14050471', '67062674', '99943326'],
  [1234567890, '89005924', '91819424', '93441116'],
  [2000000000, '69279037', '90698825', '38618901'],
  [20000000000, '65353130', '77737706', '47863826'],
];

describe('TOTP', () => {
  it.each(VECTORS)('matches RFC 6238 at %i seconds', (time, sha1, sha256, sha512) => {
    const step = stepAt(time);
    expect(hotp(SEED_SHA1, step, 8, 'sha1')).toBe(sha1);
    expect(hotp(SEED_SHA256, step, 8, 'sha256')).toBe(sha256);
    expect(hotp(SEED_SHA512, step, 8, 'sha512')).toBe(sha512);
  });

  it('uses the last 6 digits for authenticator codes', () => {
    expect(totpAt(SEED_SHA1, 59)).toBe('287082');
  });

  it('accepts one step of drift either side and nothing further', () => {
    const now = 1_700_000_000;
    expect(verifyTotp(SEED_SHA1, totpAt(SEED_SHA1, now - 30), now, null)).toBe(stepAt(now) - 1n);
    expect(verifyTotp(SEED_SHA1, totpAt(SEED_SHA1, now + 30), now, null)).toBe(stepAt(now) + 1n);
    expect(verifyTotp(SEED_SHA1, totpAt(SEED_SHA1, now - 90), now, null)).toBeNull();
  });

  it('refuses a code from a step already used', () => {
    const now = 1_700_000_000;
    const code = totpAt(SEED_SHA1, now);
    const step = verifyTotp(SEED_SHA1, code, now, null);
    expect(step).not.toBeNull();
    expect(verifyTotp(SEED_SHA1, code, now, step)).toBeNull();
  });

  it('refuses malformed codes', () => {
    expect(verifyTotp(SEED_SHA1, '12345', 59, null)).toBeNull();
    expect(verifyTotp(SEED_SHA1, 'abcdef', 59, null)).toBeNull();
  });

  it('round-trips base32 and builds an otpauth link', () => {
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
    expect(base32Decode('MZXW6YTBOI').toString()).toBe('foobar');
    expect(base32Decode(base32Encode(SEED_SHA512)).equals(SEED_SHA512)).toBe(true);
    const uri = otpauthUri(SEED_SHA1, 'Clinic', 'owner@example.test');
    expect(uri).toMatch(/^otpauth:\/\/totp\/Clinic%3Aowner%40example\.test\?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=Clinic/);
  });
});

describe('tokens and sealing', () => {
  it('creates 43-character URL-safe tokens and stable hashes', () => {
    const token = newToken();
    expect(isTokenShaped(token)).toBe(true);
    expect(isTokenShaped('short')).toBe(false);
    expect(hashToken(token).equals(hashToken(token))).toBe(true);
  });

  it('seals and opens, and detects tampering or a wrong key', () => {
    const key = Buffer.alloc(32, 7);
    const sealed = seal(key, Buffer.from('secret'));
    expect(open(key, sealed).toString()).toBe('secret');
    const tampered = Buffer.from(sealed);
    tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 1;
    expect(() => open(key, tampered)).toThrow();
    expect(() => open(Buffer.alloc(32, 8), sealed)).toThrow();
  });
});
