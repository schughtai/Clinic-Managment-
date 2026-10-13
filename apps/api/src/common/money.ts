/** Money is whole Pakistani rupees held in integers. See docs/decisions/0004-money.md. */

export type Rupees = number;

export function isRupees(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

/** Percentage of an amount, rounded half up to whole rupees. */
export function percentOf(amount: Rupees, percent: number): Rupees {
  if (!isRupees(amount) || !Number.isFinite(percent) || percent < 0 || percent > 100) {
    throw new RangeError('Invalid amount or percentage.');
  }
  // Work in integer hundredths of a percent to avoid floating point drift.
  const basisPoints = Math.round(percent * 100);
  return Math.floor((amount * basisPoints + 5_000) / 10_000);
}

export interface LineInput {
  description: string;
  quantity: number;
  unitPrice: Rupees;
}

export interface PricedLine extends LineInput {
  amount: Rupees;
}

export interface InvoiceTotals {
  lines: PricedLine[];
  subtotal: Rupees;
  discount: Rupees;
  total: Rupees;
}

export type DiscountInput =
  | { kind: 'amount'; value: Rupees }
  | { kind: 'percent'; value: number }
  | undefined;

/** Prices an invoice. The discount can never exceed the subtotal. */
export function priceInvoice(lines: readonly LineInput[], discount: DiscountInput): InvoiceTotals {
  const priced = lines.map((line) => ({ ...line, amount: line.quantity * line.unitPrice }));
  const subtotal = priced.reduce((sum, line) => sum + line.amount, 0);
  let discountAmount = 0;
  if (discount !== undefined) {
    discountAmount = discount.kind === 'amount' ? discount.value : percentOf(subtotal, discount.value);
  }
  if (discountAmount > subtotal) {
    throw new RangeError('Discount is larger than the invoice subtotal.');
  }
  return { lines: priced, subtotal, discount: discountAmount, total: subtotal - discountAmount };
}

export type OpenInvoiceStatus = 'unpaid' | 'partial' | 'paid';

export function statusFor(total: Rupees, paid: Rupees): OpenInvoiceStatus {
  if (paid >= total) return 'paid';
  return paid === 0 ? 'unpaid' : 'partial';
}
