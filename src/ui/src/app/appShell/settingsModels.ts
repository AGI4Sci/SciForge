import { localeText, type SupportedLocale } from '../../i18n';
import { sanitizePublicTextRequired } from '../../publicProjectionSanitizer';

export type ConfigSaveState = {
  status: 'idle' | 'saving' | 'saved' | 'error';
  message?: string;
  savedAt?: string;
};

export function settingsSaveStateText(state: ConfigSaveState, locale?: SupportedLocale) {
  const saveErrorFallback = localeText(locale, {
    'zh-CN': '无法保存 config.local.json。请检查 Workspace Writer。',
    'en-US': 'Could not save config.local.json. Check Workspace Writer.',
  });
  if (state.status === 'saving') return localeText(locale, {
    'zh-CN': '正在保存到 config.local.json...',
    'en-US': 'Saving to config.local.json...',
  });
  if (state.status === 'error') return state.message
    ? sanitizePublicTextRequired(state.message, saveErrorFallback)
    : saveErrorFallback;
  if (state.status === 'saved') {
    const time = state.savedAt ? new Date(state.savedAt).toLocaleTimeString(undefined, { hour12: false }) : '';
    const saved = localeText(locale, {
      'zh-CN': '已保存到 config.local.json',
      'en-US': 'Saved to config.local.json',
    });
    return time ? `${saved} (${time})` : saved;
  }
  return localeText(locale, {
    'zh-CN': '修改后点击保存，写入 config.local.json。',
    'en-US': 'After changes, click Save to write config.local.json.',
  });
}

export function secretPresenceLabel(value: string | undefined, label = 'secret', locale?: SupportedLocale) {
  return value?.trim()
    ? localeText(locale, {
      'zh-CN': `${label}: 已配置（已隐藏）`,
      'en-US': `${label}: present (masked)`,
    })
    : localeText(locale, {
      'zh-CN': `${label}: 未配置`,
      'en-US': `${label}: missing`,
    });
}

export function secretInputPlaceholder(value: string | undefined, emptyPlaceholder: string, locale?: SupportedLocale) {
  return value?.trim()
    ? localeText(locale, {
      'zh-CN': '已配置。输入新值可替换；留空会保留已隐藏的 secret。',
      'en-US': 'Configured. Enter a new value to replace it, or leave blank to keep the masked secret.',
    })
    : emptyPlaceholder;
}

export function maskedSecretValue(value: string | undefined) {
  return value?.trim() ? '********' : '';
}
