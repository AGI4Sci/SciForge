import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import {
  DEFAULT_LOCALE,
  documentLangForLocale,
  localeText,
  normalizeLocale,
  type SupportedLocale,
} from './i18n';

type LocaleCopy = Record<SupportedLocale, string>;

type I18nContextValue = {
  locale: SupportedLocale;
  t: (copy: LocaleCopy) => string;
};

const defaultValue: I18nContextValue = {
  locale: DEFAULT_LOCALE,
  t: (copy) => localeText(DEFAULT_LOCALE, copy),
};

const I18nContext = createContext<I18nContextValue>(defaultValue);

export function I18nProvider({
  locale,
  children,
}: {
  locale?: SupportedLocale;
  children: ReactNode;
}) {
  const normalizedLocale = normalizeLocale(locale);
  const value = useMemo<I18nContextValue>(() => ({
    locale: normalizedLocale,
    t: (copy) => localeText(normalizedLocale, copy),
  }), [normalizedLocale]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.lang = documentLangForLocale(normalizedLocale);
  }, [normalizedLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}
