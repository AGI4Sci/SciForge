export type ConfigSaveState = {
  status: 'idle' | 'saving' | 'saved' | 'error';
  message?: string;
  savedAt?: string;
};

export function settingsSaveStateText(state: ConfigSaveState) {
  if (state.status === 'saving') return '正在保存到 config.local.json...';
  if (state.status === 'error') return state.message || 'config.local.json 保存失败，请检查 Workspace Writer。';
  if (state.status === 'saved') {
    const time = state.savedAt ? new Date(state.savedAt).toLocaleTimeString('zh-CN', { hour12: false }) : '';
    return time ? `已保存到 config.local.json（${time}）` : '已保存到 config.local.json';
  }
  return '修改后点击“保存并生效”，SciForge 会写入 config.local.json。';
}

export function secretPresenceLabel(value: string | undefined, label = 'secret') {
  return value?.trim() ? `${label}: present (masked)` : `${label}: missing`;
}

export function secretInputPlaceholder(value: string | undefined, emptyPlaceholder: string) {
  return value?.trim() ? '已配置；输入新值会替换，留空保持 masked secret 不变' : emptyPlaceholder;
}

export function maskedSecretValue(value: string | undefined) {
  return value?.trim() ? '********' : '';
}
