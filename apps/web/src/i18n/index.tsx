import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ur } from './ur';

export type Locale = 'en' | 'ur';
export type Translate = (text: string, params?: Record<string, string | number>) => string;

const STORAGE_KEY = 'clinic.locale';

function storedLocale(): Locale | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'en' || value === 'ur' ? value : null;
  } catch {
    return null;
  }
}

/**
 * The English text is the key, so a line without an Urdu translation simply shows in English.
 * Placeholders look like {name}.
 */
export function translate(locale: Locale, text: string, params?: Record<string, string | number>): string {
  const base = locale === 'ur' ? (ur[text] ?? text) : text;
  if (params === undefined) return base;
  return base.replace(/\{(\w+)\}/g, (_match, name: string) => String(params[name] ?? ''));
}

interface LocaleState {
  locale: Locale;
  /** True when the person picked a language themselves rather than inheriting the organization's. */
  chosen: boolean;
  setLocale: (locale: Locale) => void;
  /** Uses the organization's default language until the person chooses one. */
  adoptDefault: (locale: Locale) => void;
  t: Translate;
}

const LocaleContext = createContext<LocaleState | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const initial = storedLocale();
  const [locale, setState] = useState<Locale>(initial ?? 'en');
  const [chosen, setChosen] = useState(initial !== null);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === 'ur' ? 'rtl' : 'ltr';
  }, [locale]);

  const setLocale = useCallback((value: Locale) => {
    setState(value);
    setChosen(true);
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch {
      // Private browsing can block storage; the choice then lasts until the tab closes.
    }
  }, []);

  const adoptDefault = useCallback(
    (value: Locale) => {
      if (!chosen) setState(value);
    },
    [chosen],
  );

  const t = useCallback<Translate>((text, params) => translate(locale, text, params), [locale]);
  const value = useMemo(() => ({ locale, chosen, setLocale, adoptDefault, t }), [locale, chosen, setLocale, adoptDefault, t]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleState {
  const value = useContext(LocaleContext);
  if (value === null) throw new Error('useLocale must be used inside LocaleProvider');
  return value;
}

export function useT(): Translate {
  return useLocale().t;
}
