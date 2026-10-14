import { describe, expect, it } from 'vitest';
import { freeSlots, storedRange, weekdayOf, zonedToUtc, type SlotInput } from './slots';

const KARACHI = 'Asia/Karachi';
const MONDAY = '2030-01-07'; // a Monday
const hours = [{ day: 1, opens: '09:00', closes: '13:00' }];
const base: SlotInput = {
  localDate: MONDAY,
  timezone: KARACHI,
  hours,
  blocked: [],
  booked: [],
  durationMinutes: 15,
  bufferMinutes: 0,
};
const at = (hhmm: string) => zonedToUtc(MONDAY, hhmm, KARACHI);

describe('time conversion', () => {
  it('converts Karachi wall-clock time (UTC+5, no daylight saving)', () => {
    expect(new Date(zonedToUtc(MONDAY, '09:00', KARACHI)).toISOString()).toBe('2030-01-07T04:00:00.000Z');
  });

  it('finds the weekday of a local date', () => {
    expect(weekdayOf(MONDAY)).toBe(1);
    expect(weekdayOf('2030-01-06')).toBe(0);
  });
});

describe('free slots', () => {
  it('offers every step inside working hours for a 15-minute appointment', () => {
    const slots = freeSlots(base);
    expect(slots).toHaveLength((13 - 9) * 4);
    expect(slots[0]).toBe(at('09:00'));
    expect(slots.at(-1)).toBe(at('12:45'));
  });

  it('never offers a slot that would run past closing time', () => {
    const slots = freeSlots({ ...base, durationMinutes: 30 });
    expect(slots.at(-1)).toBe(at('12:30'));
  });

  it('removes slots that overlap an existing booking, including its buffer', () => {
    const booked = [storedRange(at('10:00'), 15, 10)]; // occupies 10:00–10:25
    const slots = freeSlots({ ...base, booked });
    expect(slots).not.toContain(at('10:00'));
    expect(slots).not.toContain(at('10:15'));
    expect(slots).toContain(at('10:30'));
  });

  it('removes slots during leave and holidays', () => {
    const blocked = [{ start: at('11:00'), end: at('12:00') }];
    const slots = freeSlots({ ...base, blocked });
    expect(slots).not.toContain(at('11:00'));
    expect(slots).not.toContain(at('11:45'));
    expect(slots).toContain(at('12:00'));
  });

  it('offers nothing on a day without hours', () => {
    expect(freeSlots({ ...base, localDate: '2030-01-06' })).toEqual([]);
  });

  it('offers nothing when a whole-day leave covers the day', () => {
    const blocked = [{ start: at('00:00') - 86_400_000, end: at('23:59') + 86_400_000 }];
    expect(freeSlots({ ...base, blocked })).toEqual([]);
  });

  it('skips starts before the cut-off time', () => {
    const slots = freeSlots({ ...base, notBefore: at('10:30') });
    expect(slots[0]).toBe(at('10:30'));
  });

  it('refuses out-of-range durations and buffers', () => {
    expect(() => freeSlots({ ...base, durationMinutes: 1 })).toThrow();
    expect(() => freeSlots({ ...base, bufferMinutes: 90 })).toThrow();
  });

  it('keeps a buffer between two back-to-back appointments', () => {
    // An existing 20-minute appointment at 09:00 with a 10-minute buffer holds 09:00–09:30.
    const booked = [storedRange(at('09:00'), 20, 10)];
    const slots = freeSlots({ ...base, durationMinutes: 20, bufferMinutes: 10, stepMinutes: 10, booked });
    expect(slots).not.toContain(at('09:00'));
    expect(slots).not.toContain(at('09:20'));
    expect(slots).toContain(at('09:30'));
  });
});
