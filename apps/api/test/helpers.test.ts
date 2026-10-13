import { describe, expect, it } from 'vitest';
import { percentOf, priceInvoice, statusFor } from '../src/common/money';
import { nameKey, nameWords, wordKey } from '../src/common/name-key';
import { formatPhone, normalizePhone } from '../src/common/phone';

describe('normalizePhone', () => {
  it.each([
    ['0300 1234567', '923001234567'],
    ['0300-1234567', '923001234567'],
    ['+92 300 1234567', '923001234567'],
    ['0092 300 1234567', '923001234567'],
    ['923001234567', '923001234567'],
    ['3001234567', '923001234567'],
    ['(0321) 7654321', '923217654321'],
    ['+44 7700 900123', '447700900123'],
  ])('turns %s into %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each(['', '   ', 'abc', '12345', '0300123', '+1', '030012345678901234'])('rejects %j', (input) => {
    expect(normalizePhone(input)).toBeNull();
  });

  it('formats Pakistani numbers for display', () => {
    expect(formatPhone('923001234567')).toBe('+92 300 1234567');
    expect(formatPhone('447700900123')).toBe('+447700900123');
  });
});

describe('nameKey', () => {
  it('treats common Roman Urdu spellings of Muhammad as the same word', () => {
    const keys = ['Muhammad', 'Mohammad', 'Mohammed', 'Muhammed', 'Mohd', 'MD'].map(wordKey);
    expect(new Set(keys).size).toBe(1);
  });

  it.each([
    ['Fatima', 'Fatimah'],
    ['Fatima', 'Fatema'],
    ['Qasim', 'Kasim'],
    ['Waqas', 'Vaqas'],
    ['Shahid', 'Shahid'],
    ['Khan', 'Khaan'],
    ['Hussain', 'Husain'],
  ])('matches %s with %s', (left, right) => {
    expect(wordKey(left)).toBe(wordKey(right));
  });

  it('keeps clearly different names apart', () => {
    expect(wordKey('Imran')).not.toBe(wordKey('Ali'));
    expect(wordKey('Zainab')).not.toBe(wordKey('Zubair'));
    expect(wordKey('Hamza')).not.toBe(wordKey('Hassan'));
  });

  it('builds a space-prefixed key per word', () => {
    expect(nameKey('Muhammad Ali Khan')).toBe(' mmd al Kn');
    expect(nameKey('  ')).toBe(' ');
  });

  it('splits on punctuation and ignores accents', () => {
    expect(nameWords("Abdul-Rahman O'Neil")).toEqual(['abdul', 'rahman', 'o', 'neil']);
    expect(wordKey('Zoë')).toBe(wordKey('Zoe'));
  });

  it('keeps Urdu script words and ignores optional marks', () => {
    expect(wordKey('علی')).toBe('علی');
    expect(wordKey('عَلی')).toBe('علی');
    expect(nameKey('محمد علی')).toBe(' محمد علی');
  });
});

describe('money', () => {
  it('rounds percentages half up to whole rupees', () => {
    expect(percentOf(150, 1)).toBe(2); // 1.5 rounds up
    expect(percentOf(1234, 10)).toBe(123); // 123.4 rounds down
    expect(percentOf(1235, 10)).toBe(124); // 123.5 rounds up
    expect(percentOf(1000, 12.5)).toBe(125);
    expect(percentOf(0, 50)).toBe(0);
    expect(percentOf(999, 100)).toBe(999);
  });

  it('rejects invalid percentages and amounts', () => {
    expect(() => percentOf(100, -1)).toThrow(RangeError);
    expect(() => percentOf(100, 101)).toThrow(RangeError);
    expect(() => percentOf(-5, 10)).toThrow(RangeError);
    expect(() => percentOf(10.5, 10)).toThrow(RangeError);
  });

  it('prices an invoice with line totals and a discount', () => {
    const totals = priceInvoice(
      [
        { description: 'Consultation', quantity: 1, unitPrice: 1500 },
        { description: 'Injection', quantity: 2, unitPrice: 250 },
      ],
      { kind: 'percent', value: 10 },
    );
    expect(totals.subtotal).toBe(2000);
    expect(totals.discount).toBe(200);
    expect(totals.total).toBe(1800);
    expect(totals.lines.map((line) => line.amount)).toEqual([1500, 500]);
  });

  it('supports a fixed discount and no discount', () => {
    const lines = [{ description: 'Visit', quantity: 1, unitPrice: 1000 }];
    expect(priceInvoice(lines, { kind: 'amount', value: 300 }).total).toBe(700);
    expect(priceInvoice(lines, undefined).total).toBe(1000);
  });

  it('never allows a discount above the subtotal', () => {
    const lines = [{ description: 'Visit', quantity: 1, unitPrice: 1000 }];
    expect(() => priceInvoice(lines, { kind: 'amount', value: 1001 })).toThrow(RangeError);
    expect(priceInvoice(lines, { kind: 'amount', value: 1000 }).total).toBe(0);
  });

  it('derives the invoice status from totals', () => {
    expect(statusFor(1000, 0)).toBe('unpaid');
    expect(statusFor(1000, 400)).toBe('partial');
    expect(statusFor(1000, 1000)).toBe('paid');
    expect(statusFor(0, 0)).toBe('paid');
  });
});
