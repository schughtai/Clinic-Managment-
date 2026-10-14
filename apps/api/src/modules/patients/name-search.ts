import { nameKey, nameWords } from '../../common/name-key';

/**
 * Turns a search box entry into name tokens that match `patients.name_key`. Every token must match
 * part of the stored key, so "muhammad ali" finds "Mohammad Ali" and "Mohd Alie".
 */
export function nameSearchTokens(query: string): string[] {
  return nameKey(query)
    .split(' ')
    .filter((token) => token.length > 0);
}

/** The key stored with each patient, built from the English and Urdu names together. */
export function patientNameKey(nameEn: string | undefined, nameUr: string | undefined): string {
  return nameKey(joinNames(nameEn, nameUr));
}

/** The words used for full-text lookups (kept alongside the key). */
export function patientNameWords(nameEn: string | undefined, nameUr: string | undefined): string[] {
  return nameWords(joinNames(nameEn, nameUr));
}

function joinNames(nameEn: string | undefined, nameUr: string | undefined): string {
  return [nameEn, nameUr].filter((value): value is string => Boolean(value)).join(' ');
}
