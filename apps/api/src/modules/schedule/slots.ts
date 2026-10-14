/**
 * Free appointment slots for one practitioner at one facility on one local date (FR-014).
 * Pure functions so the rules are unit-tested without a database. Times are compared in UTC;
 * opening hours are local to the facility timezone.
 */

export interface Range {
  start: number; // epoch milliseconds, UTC
  end: number; // exclusive
}

export interface WorkingRange {
  /** 0 = Sunday ... 6 = Saturday, in the facility's local calendar. */
  day: number;
  opens: string; // HH:MM local
  closes: string; // HH:MM local
}

export interface SlotInput {
  localDate: string; // YYYY-MM-DD in the facility timezone
  timezone: string;
  hours: WorkingRange[];
  /** Full-day holidays at the facility or leave periods (absolute UTC ranges). */
  blocked: Range[];
  /** Active bookings for the practitioner, already including their buffer. */
  booked: Range[];
  durationMinutes: number;
  bufferMinutes: number;
  /** Step between suggested starts. */
  stepMinutes?: number;
  /** Starts before this instant are not offered (for "now" on today). */
  notBefore?: number;
}

const MINUTE = 60_000;

/** Converts a wall-clock time in a timezone to epoch milliseconds, with DST handled by Intl. */
export function zonedToUtc(localDate: string, hhmm: string, timezone: string): number {
  const [year, month, day] = localDate.split('-').map(Number) as [number, number, number];
  const [hour, minute] = hhmm.split(':').map(Number) as [number, number];
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const offset = zoneOffsetMinutes(guess, timezone);
  let utc = guess - offset * MINUTE;
  // A second pass corrects for the offset changing across the boundary.
  const corrected = zoneOffsetMinutes(utc, timezone);
  if (corrected !== offset) utc = guess - corrected * MINUTE;
  return utc;
}

function zoneOffsetMinutes(epoch: number, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(epoch));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - Math.floor(epoch / 1000) * 1000) / MINUTE);
}

/** The weekday (0 = Sunday) of a local calendar date. */
export function weekdayOf(localDate: string): number {
  const [year, month, day] = localDate.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** Working ranges for the date's weekday, as UTC ranges. Overlapping hours are refused upstream. */
export function workingRangesFor(input: SlotInput): Range[] {
  const day = weekdayOf(input.localDate);
  return input.hours
    .filter((h) => h.day === day)
    .map((h) => ({
      start: zonedToUtc(input.localDate, h.opens, input.timezone),
      end: zonedToUtc(input.localDate, h.closes, input.timezone),
    }))
    .filter((r) => r.end > r.start);
}

export function overlaps(a: Range, b: Range): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * Free starts. An appointment occupies [start, start + duration + buffer); the next one may not
 * begin before the previous one's buffer ends. The whole appointment must fit inside working hours.
 */
export function freeSlots(input: SlotInput): number[] {
  if (input.durationMinutes < 5 || input.durationMinutes > 240) throw new Error('duration out of range');
  if (input.bufferMinutes < 0 || input.bufferMinutes > 60) throw new Error('buffer out of range');
  const step = (input.stepMinutes ?? 15) * MINUTE;
  const length = input.durationMinutes * MINUTE;
  const buffer = input.bufferMinutes * MINUTE;
  const working = workingRangesFor(input);
  const slots: number[] = [];

  for (const window of working) {
    for (let start = window.start; start + length <= window.end; start += step) {
      if (input.notBefore !== undefined && start < input.notBefore) continue;
      const occupied: Range = { start, end: start + length + buffer };
      // The buffer after the appointment must also be free, so it counts against bookings.
      if (input.blocked.some((range) => overlaps(range, occupied))) continue;
      if (input.booked.some((range) => overlaps(range, occupied))) continue;
      slots.push(start);
    }
  }
  return slots;
}

/** The stored range for an appointment: its own time plus the buffer that follows it. */
export function storedRange(start: number, durationMinutes: number, bufferMinutes: number): Range {
  return { start, end: start + (durationMinutes + bufferMinutes) * MINUTE };
}
