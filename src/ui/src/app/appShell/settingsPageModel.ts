import { Archive, Cpu, FolderOpen, Inbox, Palette, Plug, Settings, type LucideIcon } from 'lucide-react';
import { localeText, type SupportedLocale } from '../../i18n';

export type SettingsSectionId = 'general' | 'appearance' | 'workspace' | 'models' | 'connections' | 'feedback' | 'archived';

export type SettingsSectionNavItem = {
  id: SettingsSectionId;
  label: string;
  description: string;
  icon: LucideIcon;
};

type SettingsSectionDefinition = {
  id: SettingsSectionId;
  label: Record<SupportedLocale, string>;
  description: Record<SupportedLocale, string>;
  icon: LucideIcon;
};

const settingsSectionDefinitions: SettingsSectionDefinition[] = [
  {
    id: 'general',
    label: { 'zh-CN': '通用', 'en-US': 'General' },
    description: { 'zh-CN': '超时、上下文和 vision 默认设置', 'en-US': 'Timeouts, context, and vision defaults' },
    icon: Settings,
  },
  {
    id: 'appearance',
    label: { 'zh-CN': '外观', 'en-US': 'Appearance' },
    description: { 'zh-CN': '主题、语言和显示偏好', 'en-US': 'Theme, language, and display preferences' },
    icon: Palette,
  },
  {
    id: 'workspace',
    label: { 'zh-CN': '工作区', 'en-US': 'Workspace' },
    description: { 'zh-CN': '工作区目录、writer 和 peer 实例', 'en-US': 'Workspace folder, writer, and peer instances' },
    icon: FolderOpen,
  },
  {
    id: 'models',
    label: { 'zh-CN': '模型', 'en-US': 'Models' },
    description: { 'zh-CN': 'Runtime provider、模型和 API key', 'en-US': 'Runtime provider, model, and API key' },
    icon: Cpu,
  },
  {
    id: 'connections',
    label: { 'zh-CN': '连接', 'en-US': 'Connections' },
    description: { 'zh-CN': 'Runtime 连接和健康检查', 'en-US': 'Runtime connection and health checks' },
    icon: Plug,
  },
  {
    id: 'feedback',
    label: { 'zh-CN': '反馈', 'en-US': 'Feedback' },
    description: { 'zh-CN': 'GitHub feedback inbox 同步', 'en-US': 'GitHub feedback inbox sync' },
    icon: Inbox,
  },
  {
    id: 'archived',
    label: { 'zh-CN': '归档', 'en-US': 'Archived' },
    description: { 'zh-CN': '查看、恢复或删除已归档对话', 'en-US': 'View, restore, or delete archived chats' },
    icon: Archive,
  },
];

export const settingsSectionNavItems: SettingsSectionNavItem[] = settingsSectionNavItemsForLocale('en-US');

export function settingsSectionNavItemsForLocale(locale?: SupportedLocale): SettingsSectionNavItem[] {
  return settingsSectionDefinitions.map((item) => ({
    id: item.id,
    label: localeText(locale, item.label),
    description: localeText(locale, item.description),
    icon: item.icon,
  }));
}

export function settingsSectionLabel(sectionId: SettingsSectionId, locale?: SupportedLocale) {
  return settingsSectionNavItemsForLocale(locale).find((item) => item.id === sectionId)?.label ?? localeText(locale, {
    'zh-CN': '设置',
    'en-US': 'Settings',
  });
}
