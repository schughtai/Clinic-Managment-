import { describe, expect, it } from 'vitest';
import { assertSameRequest, requestHash, requireIdempotencyKey } from './idempotency';

describe('idempotency', () => {
  it('requires a well-formed key', () => {
    expect(() => requireIdempotencyKey(undefined)).toThrow();
    expect(() => requireIdempotencyKey('short')).toThrow();
    expect(requireIdempotencyKey('pay-2026-10-14-0001')).toBe('pay-2026-10-14-0001');
  });

  it('hashes the same body the same way regardless of key order', () => {
    expect(requestHash({ a: 1, b: { c: 2, d: 3 } })).toBe(requestHash({ b: { d: 3, c: 2 }, a: 1 }));
    expect(requestHash({ a: 1 })).not.toBe(requestHash({ a: 2 }));
  });

  it('refuses a reused key with a different body', () => {
    const stored = requestHash({ amountMinor: 1000 });
    expect(() => assertSameRequest(stored, requestHash({ amountMinor: 1000 }))).not.toThrow();
    expect(() => assertSameRequest(stored, requestHash({ amountMinor: 2000 }))).toThrow();
  });
});
