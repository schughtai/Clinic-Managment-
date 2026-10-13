/**
 * Normalises a phone number to digits with the country code and no plus sign.
 * Pakistani local forms such as 0300 1234567 become 923001234567.
 * Returns null when the input cannot be a phone number.
 */
export function normalizePhone(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;
  const hasInternationalPrefix = trimmed.startsWith('+') || trimmed.startsWith('00');
  let digits = trimmed.replace(/\D/g, '');
  if (trimmed.startsWith('00')) digits = digits.slice(2);

  if (hasInternationalPrefix) {
    return /^[0-9]{8,15}$/.test(digits) ? digits : null;
  }
  if (digits.startsWith('92') && digits.length === 12) return digits;
  if (digits.startsWith('0') && digits.length === 11) return `92${digits.slice(1)}`;
  if (digits.startsWith('3') && digits.length === 10) return `92${digits}`;
  return null;
}

/** Formats normalised digits for display, for example +92 300 1234567. */
export function formatPhone(digits: string): string {
  if (digits.startsWith('92') && digits.length === 12) {
    return `+92 ${digits.slice(2, 5)} ${digits.slice(5)}`;
  }
  return `+${digits}`;
}
