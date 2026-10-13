import { locale } from './i18n';

const TZ = 'Asia/Karachi';

function tag(): string {
  return locale.value === 'ur' ? 'ur-PK' : 'en-GB';
}

export function money(amount: number): string {
  return `Rs ${amount.toLocaleString(tag())}`;
}

export function dateTime(iso: string): string {
  return new Date(iso).toLocaleString(tag(), { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function dateOnly(iso: string): string {
  return new Date(iso).toLocaleDateString(tag(), { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' });
}

export function timeOnly(iso: string): string {
  return new Date(iso).toLocaleTimeString(tag(), { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
}

/** Today's calendar date in the clinic's time zone, as YYYY-MM-DD. */
export function todayLocal(offsetDays = 0): string {
  const shifted = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(shifted);
}

export function phoneText(digits: string | null): string {
  if (digits === null) return '';
  if (digits.startsWith('92') && digits.length === 12) return `0${digits.slice(2, 5)} ${digits.slice(5)}`;
  return `+${digits}`;
}

export function genderLabel(value: string | null): string {
  return value === null ? '' : value === 'male' ? 'Male' : value === 'female' ? 'Female' : 'Other';
}
