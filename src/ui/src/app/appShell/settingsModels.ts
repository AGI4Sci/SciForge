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
