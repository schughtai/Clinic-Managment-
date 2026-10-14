import { ref } from 'vue';
import { ur } from './locale-ur';

export type Locale = 'en' | 'ur';

const STORAGE_KEY = 'clinic.locale';

function stored(): Locale | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'en' || value === 'ur' ? value : null;
  } catch {
    return null;
  }
}

export const locale = ref<Locale>(stored() ?? 'en');

function apply(value: Locale): void {
  document.documentElement.lang = value;
  document.documentElement.dir = value === 'ur' ? 'rtl' : 'ltr';
}

export function setLocale(value: Locale, remember = true): void {
  locale.value = value;
  apply(value);
  if (remember) {
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch {
      // Private browsing can block storage. The choice then lasts until the page is closed.
    }
  }
}

/** Uses the clinic's language until the person has chosen their own. */
export function adoptClinicLocale(clinicLocale: Locale): void {
  if (stored() === null) setLocale(clinicLocale, false);
  else apply(locale.value);
}

/**
 * The English text is the key, so a missing Urdu line simply shows in English.
 * Placeholders look like {name} and are filled from the second argument.
 */
export function t(text: string, params?: Record<string, string | number>): string {
  const base = locale.value === 'ur' ? (ur[text] ?? text) : text;
  if (params === undefined) return base;
  return base.replace(/\{(\w+)\}/g, (_match, name: string) => String(params[name] ?? ''));
}

apply(locale.value);
