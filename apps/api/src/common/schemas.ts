import { z } from 'zod';
import { normalizePhone } from './phone';

/** A phone number in any common local or international form, stored as digits with country code. */
export const phoneSchema = z
  .string()
  .trim()
  .max(40)
  .transform((value, context) => {
    const normalized = normalizePhone(value);
    if (normalized === null) {
      context.addIssue({ code: 'custom', message: 'Enter a valid phone number, for example 0300 1234567.' });
      return z.NEVER;
    }
    return normalized;
  });

/** Eight to 72 characters. bcrypt ignores everything past 72 bytes, so longer input is refused. */
export const passwordSchema = z
  .string()
  .min(8, 'Use at least 8 characters.')
  .max(72, 'Use at most 72 characters.')
  .refine((value) => value.trim() === value, 'Remove spaces at the start and end.');

export const nameSchema = z.string().trim().min(1, 'Required.').max(120);
