import { Archive, Cpu, FolderOpen, Inbox, Palette, Plug, Settings, type LucideIcon } from 'lucide-react';

export type SettingsSectionId = 'general' | 'appearance' | 'workspace' | 'models' | 'connections' | 'feedback' | 'archived';

export type SettingsSectionNavItem = {
  id: SettingsSectionId;
  label: string;
  description: string;
  icon: LucideIcon;
};

export const settingsSectionNavItems: SettingsSectionNavItem[] = [
  { id: 'general', label: '常规', description: '超时、上下文与 vision 默认行为', icon: Settings },
  { id: 'appearance', label: '外观', description: '界面主题与显示偏好', icon: Palette },
  { id: 'workspace', label: '工作区', description: 'Workspace 路径、Writer 与 Peer 实例', icon: FolderOpen },
  { id: 'models', label: '模型', description: 'Runtime provider、模型与 API key', icon: Cpu },
  { id: 'connections', label: '连接', description: 'Codex Runtime 与健康检查', icon: Plug },
  { id: 'feedback', label: '反馈', description: 'GitHub 反馈收件箱同步', icon: Inbox },
  { id: 'archived', label: '已归档', description: '查看、恢复或删除已归档对话', icon: Archive },
];

export function settingsSectionLabel(sectionId: SettingsSectionId) {
  return settingsSectionNavItems.find((item) => item.id === sectionId)?.label ?? '设置';
}
