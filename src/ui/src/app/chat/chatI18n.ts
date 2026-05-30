import { localeText, type SupportedLocale } from '../../i18n';

export type ChatLocale = SupportedLocale;
export type ChatCopy = Record<SupportedLocale, string>;

const FALLBACK_TEST_LOCALE: SupportedLocale = 'en-US';

export function chatText(locale: SupportedLocale | undefined, copy: ChatCopy) {
  return localeText(locale ?? FALLBACK_TEST_LOCALE, copy);
}

export function chatCount(locale: SupportedLocale | undefined, count: number, copy: { zh: string; enSingular: string; enPlural: string }) {
  return chatText(locale, {
    'zh-CN': `${count} ${copy.zh}`,
    'en-US': `${count} ${count === 1 ? copy.enSingular : copy.enPlural}`,
  });
}
