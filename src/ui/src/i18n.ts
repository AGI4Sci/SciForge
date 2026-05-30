export type SupportedLocale = 'zh-CN' | 'en-US';

export const DEFAULT_LOCALE: SupportedLocale = 'en-US';

export const SUPPORTED_LOCALES: Array<{ id: SupportedLocale; label: string; nativeLabel: string }> = [
  { id: 'zh-CN', label: 'Chinese', nativeLabel: '中文' },
  { id: 'en-US', label: 'English', nativeLabel: 'English' },
];

export function normalizeLocale(value: unknown): SupportedLocale {
  if (value === 'en' || value === 'en-US') return 'en-US';
  if (value === 'zh' || value === 'zh-CN' || value === 'zh-Hans' || value === 'zh-Hans-CN') return 'zh-CN';
  return DEFAULT_LOCALE;
}

export function localeText(locale: SupportedLocale | undefined, text: Record<SupportedLocale, string>) {
  return text[normalizeLocale(locale)] ?? text[DEFAULT_LOCALE];
}

export function documentLangForLocale(locale: SupportedLocale | undefined) {
  return normalizeLocale(locale) === 'en-US' ? 'en' : 'zh-CN';
}
