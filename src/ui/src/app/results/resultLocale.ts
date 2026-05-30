import { localeText, normalizeLocale, type SupportedLocale } from '../../i18n';

export type ResultLocale = SupportedLocale;
export type ResultCopy = Record<ResultLocale, string>;

export function resultLocale(locale: SupportedLocale | undefined, fallback: ResultLocale = 'en-US'): ResultLocale {
  return locale === undefined ? fallback : normalizeLocale(locale);
}

export function resultText(locale: SupportedLocale | undefined, copy: ResultCopy): string {
  return localeText(resultLocale(locale), copy);
}

export function resultCountText(locale: SupportedLocale | undefined, count: number, copy: {
  zh: (count: number) => string;
  en: (count: number) => string;
}): string {
  return resultLocale(locale) === 'zh-CN' ? copy.zh(count) : copy.en(count);
}
