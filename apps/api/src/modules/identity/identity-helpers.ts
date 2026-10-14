import { z } from 'zod';
import { normalizePhone } from '../../common/phone';

/** Phone numbers are stored as digits with country code; emails lower-case. */
export function normalizeIdentifier(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.includes('@')) {
    const email = trimmed.toLowerCase();
    return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) && email.length <= 254 ? email : null;
  }
  return normalizePhone(trimmed);
}

/** At least 10 characters (FR-008); bcrypt ignores bytes past 72, so longer input is refused. */
export const newPasswordSchema = z
  .string()
  .min(10, 'Use at least 10 characters.')
  .max(72, 'Use at most 72 characters.')
  .refine((value) => value.trim() === value, 'Remove spaces at the start and end.');

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, 'Enter a valid email address.');

/** Shows enough to recognise a contact without exposing it in full. */
export function maskPhone(phone: string | null): string | null {
  if (phone === null) return null;
  return phone.startsWith('92') && phone.length === 12 ? `+92 ${phone.slice(2, 5)} ***${phone.slice(-4)}` : `+${phone.slice(0, 2)}***${phone.slice(-4)}`;
}

export function maskEmail(email: string | null): string | null {
  if (email === null) return null;
  const [name = '', domain = ''] = email.split('@');
  return `${name.slice(0, 1)}***@${domain}`;
}

export function maskIdentifier(phone: string | null, email: string | null): string {
  return maskPhone(phone) ?? maskEmail(email) ?? '';
}

/** A WhatsApp click-to-send link. A person presses send; nothing is sent automatically. */
export function whatsappUrl(phone: string | null, message: string): string {
  return `https://wa.me/${phone ?? ''}?text=${encodeURIComponent(message)}`;
}

const SUPPORTED_ZONES = new Set(Intl.supportedValuesOf('timeZone'));
// Intl's list omits a few canonical aliases such as UTC.
SUPPORTED_ZONES.add('UTC');
const SUPPORTED_CURRENCIES = new Set(Intl.supportedValuesOf('currency'));

export const timezoneSchema = z.string().refine((zone) => SUPPORTED_ZONES.has(zone), 'Choose a valid time zone.');
export const currencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .refine((code) => SUPPORTED_CURRENCIES.has(code), 'Choose a valid currency.');
export const languageSchema = z.enum(['en', 'ur']);
export const dateFormatSchema = z.enum(['dd/MM/yyyy', 'yyyy-MM-dd', 'MM/dd/yyyy']);
