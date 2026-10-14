import { describe, expect, it } from 'vitest';
import { invoiceTotal, MoneyError, parseMajor, percentOff } from './money';

describe('money', () => {
  it('rounds percentage discounts half up once', () => {
    expect(percentOff(150000n, 1000)).toBe(15000n); // 10% of 1500.00
    expect(percentOff(1n, 5000)).toBe(1n); // 50% of one paisa rounds up
    expect(percentOff(3n, 3333)).toBe(1n);
  });

  it('parses major amounts exactly', () => {
    expect(parseMajor('1500', 2)).toBe(150000n);
    expect(parseMajor('1500.5', 2)).toBe(150050n);
    expect(() => parseMajor('1500.505', 2)).toThrow(MoneyError);
    expect(() => parseMajor('-5', 2)).toThrow(MoneyError);
  });

  it('totals the example from the quickstart', () => {
    const total = invoiceTotal(
      [
        { quantity: 1, unitPriceMinor: 150000n, discountMinor: 0n },
        { quantity: 1, unitPriceMinor: 50000n, discountMinor: 0n },
      ],
      20000n,
      0n,
    );
    expect(total.subtotalMinor).toBe(200000n);
    expect(total.totalMinor).toBe(180000n);
  });

  it('refuses negative totals and over-large line discounts', () => {
    expect(() => invoiceTotal([{ quantity: 1, unitPriceMinor: 100n, discountMinor: 0n }], 200n, 0n)).toThrow(MoneyError);
    expect(() => invoiceTotal([{ quantity: 1, unitPriceMinor: 100n, discountMinor: 200n }], 0n, 0n)).toThrow(MoneyError);
  });
});
