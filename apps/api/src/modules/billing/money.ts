/**
 * Money is exact integer minor units with an explicit currency (constitution IV). Only whole
 * integers reach this code; no floating point is used for stored amounts.
 */

export const CURRENCIES = ['PKR', 'AED', 'SAR', 'MYR', 'GBP', 'USD'] as const;
export type Currency = (typeof CURRENCIES)[number];

export interface Amount {
  amountMinor: bigint;
  currency: Currency;
}

export class MoneyError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function assertSameCurrency(a: Amount, b: Amount): void {
  if (a.currency !== b.currency) {
    throw new MoneyError('currency_mismatch', 'Amounts must be in the same currency.');
  }
}

export function add(a: Amount, b: Amount): Amount {
  assertSameCurrency(a, b);
  return { amountMinor: a.amountMinor + b.amountMinor, currency: a.currency };
}

export function subtract(a: Amount, b: Amount): Amount {
  assertSameCurrency(a, b);
  const result = a.amountMinor - b.amountMinor;
  if (result < 0n) throw new MoneyError('negative_amount', 'The result cannot be negative.');
  return { amountMinor: result, currency: a.currency };
}

/**
 * A percentage discount in basis points (1000 = 10.00%), rounded half up once, on the line or
 * invoice it applies to (v2 money rules, v1 decision 0004).
 */
export function percentOff(base: bigint, basisPoints: number): bigint {
  if (!Number.isInteger(basisPoints) || basisPoints < 0 || basisPoints > 10_000) {
    throw new MoneyError('invalid_percent', 'The discount must be between 0 and 100 percent.');
  }
  return (base * BigInt(basisPoints) + 5000n) / 10_000n;
}

/** Parses a user-entered major amount (for example "1500" or "1500.50") into minor units. */
export function parseMajor(input: string, minorDigits: number): bigint {
  const trimmed = input.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    throw new MoneyError('invalid_amount', 'Enter an amount such as 1500 or 1500.50.');
  }
  const [whole = '0', fraction = ''] = trimmed.split('.');
  if (fraction.length > minorDigits) {
    throw new MoneyError('invalid_amount', 'Too many decimal places for this currency.');
  }
  return BigInt(whole) * 10n ** BigInt(minorDigits) + BigInt(fraction.padEnd(minorDigits, '0'));
}

/** Every currency in the list uses two minor digits (paisa, fils, halala, cents, pence). */
export function minorDigitsFor(_currency: Currency): number {
  return 2;
}

/** Invoice totals: lines minus discounts minus invoice discount plus tax, never below zero. */
export function invoiceTotal(
  lines: Array<{ quantity: number; unitPriceMinor: bigint; discountMinor: bigint }>,
  invoiceDiscountMinor: bigint,
  taxMinor: bigint,
) {
  let subtotal = 0n;
  let lineDiscounts = 0n;
  for (const line of lines) {
    const gross = BigInt(line.quantity) * line.unitPriceMinor;
    if (line.discountMinor > gross) throw new MoneyError('discount_too_large', 'A line discount cannot exceed its price.');
    subtotal += gross;
    lineDiscounts += line.discountMinor;
  }
  const discount = lineDiscounts + invoiceDiscountMinor;
  const total = subtotal - discount + taxMinor;
  if (total < 0n) throw new MoneyError('negative_total', 'The total cannot be negative.');
  return { subtotalMinor: subtotal, discountMinor: discount, taxMinor, totalMinor: total };
}
