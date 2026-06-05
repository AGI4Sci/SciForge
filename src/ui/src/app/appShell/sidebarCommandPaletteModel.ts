import { scenarios, type PageId } from '../../data';
import type { ScenarioInstanceId, SciForgeConfig } from '../../domain';
import { localeText, type SupportedLocale } from '../../i18n';
import { uiModuleRegistry } from '../../uiModuleRegistry';
import type {
  SidebarPublicAgentCandidate,
  SidebarPublicAgentCandidateKind,
  SidebarSearchAction,
  SidebarSearchKind,
  SidebarSearchMatch,
} from './ShellPanels';
import type { SidebarCursorAgentThreadState } from './sidebarCursorAgentModel';

const DEFAULT_LOCALE: SupportedLocale = 'en-US';

export interface SidebarCommandPaletteAgentCandidateInput {
  projectId?: string;
  sessionId?: string;
  scenarioId?: ScenarioInstanceId;
  threadState?: SidebarCursorAgentThreadState;
  candidate: SidebarPublicAgentCandidate;
}

function text(locale: SupportedLocale | undefined, copy: Record<SupportedLocale, string>) {
  return localeText(locale ?? DEFAULT_LOCALE, copy);
}

export function buildSidebarCommandPaletteMatches(
  needle: string,
  options: {
    locale?: SupportedLocale;
    config?: SciForgeConfig;
    agentCandidates?: SidebarCommandPaletteAgentCandidateInput[];
  } = {},
): SidebarSearchMatch[] {
  const locale = options.locale;
  return [
    ...sidebarActionSearchMatches(needle, locale),
    ...sidebarStaticModeSearchMatches(needle, locale),
    ...sidebarModelSearchMatches(needle, locale),
    ...sidebarAgentCandidateSearchMatches(needle, options.agentCandidates ?? [], locale),
    ...sidebarSkillSearchMatches(needle, locale),
    ...sidebarMcpSearchMatches(needle, options.config, locale),
  ];
}

function sidebarActionSearchMatches(needle: string, locale?: SupportedLocale): SidebarSearchMatch[] {
  return sidebarSearchActions(locale).filter((item) => containsNeedle(item.haystack, needle)).map((item) => ({
    id: `sidebar-action:${item.action}`,
    label: item.label,
    detail: item.detail,
    page: item.page,
    kind: item.kind,
    action: item.action,
    shortcut: item.shortcut,
  }));
}

function sidebarSearchActions(locale?: SupportedLocale): Array<{
  action: SidebarSearchAction;
  label: string;
  detail: string;
  page: PageId;
  kind: SidebarSearchKind;
  haystack: string;
  shortcut?: string;
}> {
  const newAgentLabel = text(locale, { 'zh-CN': '新建智能体', 'en-US': 'New Agent' });
  const automationsLabel = text(locale, { 'zh-CN': '自动化', 'en-US': 'Automations' });
  const customizeLabel = text(locale, { 'zh-CN': '自定义', 'en-US': 'Customize' });
  const marketplaceLabel = text(locale, { 'zh-CN': '打开插件市场', 'en-US': 'Open Marketplace' });
  const repositoriesLabel = text(locale, { 'zh-CN': '仓库', 'en-US': 'Repositories' });
  const feedbackLabel = text(locale, { 'zh-CN': '反馈', 'en-US': 'Feedback' });
  const settingsLabel = text(locale, { 'zh-CN': '设置', 'en-US': 'Settings' });
  const openFilesLabel = text(locale, { 'zh-CN': '打开文件', 'en-US': 'Open Files' });
  const searchFilesLabel = text(locale, { 'zh-CN': '搜索文件', 'en-US': 'Search in Files' });
  const mcpSettingsLabel = text(locale, { 'zh-CN': '打开 MCP 设置', 'en-US': 'Open MCP Settings' });
  const actionDetail = text(locale, { 'zh-CN': '侧边栏动作', 'en-US': 'Sidebar action' });
  const agentDetail = text(locale, { 'zh-CN': '智能体动作', 'en-US': 'Agent action' });
  const fileDetail = text(locale, { 'zh-CN': '文件动作', 'en-US': 'File action' });
  const settingDetail = text(locale, { 'zh-CN': '设置', 'en-US': 'Setting' });
  const sectionDetail = text(locale, { 'zh-CN': '侧边栏区块', 'en-US': 'Sidebar section' });
  return [{
    action: 'new-agent',
    label: newAgentLabel,
    detail: agentDetail,
    page: 'workbench',
    kind: 'agent',
    shortcut: '⌘N',
    haystack: `${newAgentLabel} New Agent new chat agent composer 智能体 新建 聊天`,
  }, {
    action: 'open-automations',
    label: automationsLabel,
    detail: actionDetail,
    page: 'components',
    kind: 'action',
    haystack: `${automationsLabel} Automations automation scheduled reminders monitors follow ups 自动化 提醒 监控 定时任务`,
  }, {
    action: 'open-customize',
    label: customizeLabel,
    detail: text(locale, { 'zh-CN': '应用入口', 'en-US': 'App entry' }),
    page: 'components',
    kind: 'skill',
    haystack: `${customizeLabel} Customize Marketplace plugins skills rules subagents apps channels tools MCP 自定义 插件市场 技能 规则 子智能体 应用 频道 工具`,
  }, {
    action: 'open-marketplace',
    label: marketplaceLabel,
    detail: text(locale, { 'zh-CN': '应用入口', 'en-US': 'App entry' }),
    page: 'components',
    kind: 'skill',
    haystack: `${marketplaceLabel} Marketplace plugins skills rules subagents apps channels tools MCP 插件市场 技能 规则 子智能体 应用 频道 工具`,
  }, {
    action: 'open-repositories',
    label: repositoriesLabel,
    detail: sectionDetail,
    page: 'workbench',
    kind: 'project',
    haystack: `${repositoriesLabel} Repositories repository repos projects workspaces 仓库 项目 工作区`,
  }, {
    action: 'open-feedback',
    label: feedbackLabel,
    detail: actionDetail,
    page: 'feedback',
    kind: 'action',
    haystack: `${feedbackLabel} feedback repair inbox annotation github issue bug 反馈 修复 标注`,
  }, {
    action: 'open-settings',
    label: settingsLabel,
    detail: settingDetail,
    page: 'settings',
    kind: 'setting',
    shortcut: '⌘,',
    haystack: `${settingsLabel} settings preferences model account status 设置 偏好 模型 账户`,
  }, {
    action: 'open-files',
    label: openFilesLabel,
    detail: fileDetail,
    page: 'workbench',
    kind: 'file',
    shortcut: '⌘G',
    haystack: `${openFilesLabel} files workspace references open file explorer 文件 打开 工作区 引用`,
  }, {
    action: 'search-files',
    label: searchFilesLabel,
    detail: fileDetail,
    page: 'workbench',
    kind: 'file',
    shortcut: '⇧⌘F',
    haystack: `${searchFilesLabel} file search find grep references 搜索文件 查找`,
  }, {
    action: 'group-by-workspace',
    label: text(locale, { 'zh-CN': '按工作区分组', 'en-US': 'Group by Workspace' }),
    detail: sectionDetail,
    page: 'workbench',
    kind: 'project',
    haystack: 'Group by Workspace repositories projects workspace group 分组 工作区 仓库',
  }, {
    action: 'group-by-updated',
    label: text(locale, { 'zh-CN': '按更新时间分组', 'en-US': 'Group by Updated' }),
    detail: sectionDetail,
    page: 'workbench',
    kind: 'thread',
    haystack: 'Group by Updated sort updated recent time 分组 更新时间 最近',
  }, {
    action: 'group-by-status',
    label: text(locale, { 'zh-CN': '按状态分组', 'en-US': 'Group by Status' }),
    detail: sectionDetail,
    page: 'workbench',
    kind: 'thread',
    haystack: 'Group by Status done running failed blocked draft archived status 分组 状态',
  }, {
    action: 'group-by-environment',
    label: text(locale, { 'zh-CN': '按环境分组', 'en-US': 'Group by Environment' }),
    detail: sectionDetail,
    page: 'workbench',
    kind: 'project',
    haystack: 'Group by Environment local remote workspace env status 分组 环境 本地',
  }, {
    action: 'open-mcp-settings',
    label: mcpSettingsLabel,
    detail: settingDetail,
    page: 'settings',
    kind: 'mcp',
    haystack: `${mcpSettingsLabel} MCP server tools settings connector tool provider mcp 设置 服务器 工具`,
  }];
}

function sidebarStaticModeSearchMatches(needle: string, locale?: SupportedLocale): SidebarSearchMatch[] {
  return [
    { label: text(locale, { 'zh-CN': '规划模式', 'en-US': 'Plan Mode' }), haystack: 'Plan Mode plan research design planning 规划 计划' },
    { label: text(locale, { 'zh-CN': '问答模式', 'en-US': 'Ask Mode' }), haystack: 'Ask Mode ask question answer qa 问答 提问' },
    { label: text(locale, { 'zh-CN': '调试模式', 'en-US': 'Debug Mode' }), haystack: 'Debug Mode debug repair inspect runtime 调试 修复' },
    { label: text(locale, { 'zh-CN': '多任务模式', 'en-US': 'Multitask Mode' }), haystack: 'Multitask Mode multi agent parallel workflow 多任务 多智能体' },
  ].filter((item) => containsNeedle(`${item.label} ${item.haystack}`, needle)).map((item) => ({
    id: `mode:${commandPaletteMatchId('mode', item.label)}`,
    label: item.label,
    detail: text(locale, { 'zh-CN': '聊天模式', 'en-US': 'Chat mode' }),
    page: 'workbench',
    kind: 'mode',
  }));
}

function sidebarModelSearchMatches(needle: string, locale?: SupportedLocale): SidebarSearchMatch[] {
  const entries = [{
    label: text(locale, { 'zh-CN': '模型设置', 'en-US': 'Model settings' }),
    haystack: 'model settings provider routing context token 模型 设置 路由 上下文',
  }, {
    label: text(locale, { 'zh-CN': '上下文窗口', 'en-US': 'Context window' }),
    haystack: 'context window token model budget 上下文 窗口 模型',
  }];
  return entries.filter((item) => containsNeedle(`${item.label} ${item.haystack}`, needle)).map((item) => ({
    id: `model:${commandPaletteMatchId('model', item.label)}`,
    label: item.label,
    detail: text(locale, { 'zh-CN': '模型入口', 'en-US': 'Model entry' }),
    page: 'settings',
    kind: 'model',
    action: 'open-settings',
  }));
}

function sidebarSkillSearchMatches(needle: string, locale?: SupportedLocale): SidebarSearchMatch[] {
  type SidebarCapabilityMatch = {
    label: string;
    haystack: string;
    detail: string;
    page: PageId;
    scenarioId?: ScenarioInstanceId;
  };
  const scenarioSkills: SidebarCapabilityMatch[] = scenarios.flatMap((scenario) => scenario.tools.map((tool) => ({
    label: publicSearchLine(tool, tool, 52),
    haystack: `${tool} ${scenario.name} ${scenario.domain} skill tool capability 科学 技能 工具 能力`,
    detail: text(locale, { 'zh-CN': '科学技能', 'en-US': 'Scientific skill' }),
    page: 'workbench',
    scenarioId: scenario.id as ScenarioInstanceId,
  })));
  const componentSkills: SidebarCapabilityMatch[] = uiModuleRegistry.map((module) => ({
    label: publicSearchLine(module.title, module.componentId, 52),
    haystack: `${module.title} ${module.componentId} ${module.description} component skill view app artifact 组件 技能 视图`,
    detail: text(locale, { 'zh-CN': '应用技能', 'en-US': 'App skill' }),
    page: 'components',
  }));
  return uniqueCapabilityMatches([...scenarioSkills, ...componentSkills])
    .filter((item) => item.label && containsNeedle(`${item.label} ${item.haystack}`, needle))
    .slice(0, 8)
    .map((item) => ({
      id: `skill:${commandPaletteMatchId('skill', `${item.label}:${item.detail}`)}`,
      label: item.label,
      detail: item.detail,
      page: item.page,
      kind: 'skill',
      scenarioId: item.scenarioId,
    }));
}

function sidebarMcpSearchMatches(
  needle: string,
  config: SciForgeConfig | undefined,
  locale?: SupportedLocale,
): SidebarSearchMatch[] {
  const routes = Object.entries(config?.toolProviderRoutes ?? {})
    .filter(([, route]) => route.source === 'mcp' || /mcp/i.test(`${route.capabilityId ?? ''} ${route.primaryProviderId ?? ''}`))
    .map(([key, route]) => {
      const label = publicSearchLine(route.capabilityId || route.primaryProviderId || key, key, 56);
      return {
        label,
        haystack: `${label} ${key} MCP server tool connector capability mcp 工具 服务器 连接器`,
      };
    })
    .filter((item) => item.label);
  const defaults = routes.length ? routes : [{
    label: text(locale, { 'zh-CN': 'MCP 服务器', 'en-US': 'MCP servers' }),
    haystack: 'MCP servers tool connectors settings mcp server 工具 服务器 连接器',
  }];
  return defaults.filter((item) => containsNeedle(`${item.label} ${item.haystack}`, needle)).map((item) => ({
    id: `mcp:${commandPaletteMatchId('mcp', item.label)}`,
    label: item.label,
    detail: text(locale, { 'zh-CN': 'MCP 入口', 'en-US': 'MCP entry' }),
    page: 'settings',
    kind: 'mcp',
    action: 'open-mcp-settings',
  }));
}

function sidebarAgentCandidateSearchMatches(
  needle: string,
  candidates: SidebarCommandPaletteAgentCandidateInput[],
  locale?: SupportedLocale,
): SidebarSearchMatch[] {
  return candidates
    .map((input) => sidebarPublicAgentCandidateMatchInput(input, locale))
    .filter((input): input is NonNullable<typeof input> => Boolean(input))
    .filter((input) => containsNeedle(`${input.label} ${input.detail} ${input.refs.join(' ')} ${input.candidate.kind} ${input.scenarioId ?? ''}`, needle))
    .map((input) => ({
      id: `agent-result:${commandPaletteMatchId('agent', `${input.projectId ?? ''}:${input.sessionId ?? ''}:${input.candidate.kind}:${input.refs.join('|')}:${input.label}`)}`,
      label: input.label,
      detail: `${sidebarPublicAgentCandidateKindLabel(input.candidate.kind, locale)} · ${input.detail}`,
      page: 'workbench' as const,
      kind: 'agent-result' as const,
      scenarioId: input.scenarioId,
      projectId: input.projectId,
      sessionId: input.sessionId,
      threadState: input.threadState,
      candidateKind: input.candidate.kind,
      candidateRef: input.refs[0],
    }));
}

function sidebarPublicAgentCandidateMatchInput(input: SidebarCommandPaletteAgentCandidateInput, locale?: SupportedLocale) {
  const candidate = input.candidate;
  if (publicCandidateValueIsUnsafe(candidate.label) || publicCandidateValueIsUnsafe(candidate.detail)) return undefined;
  const refs = candidate.refs.map(publicCandidateRef).filter(Boolean).slice(0, 2);
  if (!refs.length) return undefined;
  const label = publicSearchLine(candidate.label, publicCandidateLabelFromRef(refs[0] ?? '') || 'Agent result', 56);
  if (!label) return undefined;
  const refDetail = `${text(locale, { 'zh-CN': '引用', 'en-US': 'Refs' })}: ${refs.join(', ')}`;
  const detail = publicSearchLine(candidate.detail, refDetail, 96);
  if (!detail) return undefined;
  return {
    ...input,
    label,
    detail,
    refs,
  };
}

function sidebarPublicAgentCandidateKindLabel(kind: SidebarPublicAgentCandidateKind, locale?: SupportedLocale): string {
  if (kind === 'background-task') return text(locale, { 'zh-CN': '后台任务', 'en-US': 'Background task' });
  if (kind === 'resume-candidate') return text(locale, { 'zh-CN': '恢复候选', 'en-US': 'Resume candidate' });
  return text(locale, { 'zh-CN': '子智能体结果', 'en-US': 'Sub-agent result' });
}

function publicCandidateRef(value: string | undefined) {
  const ref = (value ?? '').trim();
  if (!ref || containsInternalTerm(ref)) return '';
  if (!/^(?:subagent|run|artifact|checkpoint|message|execution-unit):[A-Za-z0-9][A-Za-z0-9._:-]*$/i.test(ref)) return '';
  return ref;
}

function publicCandidateLabelFromRef(ref: string) {
  return publicSearchLine(ref.replace(/^[a-z-]+:/i, '').replace(/[-_.]+/g, ' '), 'Agent result', 56);
}

function publicCandidateValueIsUnsafe(value: string | undefined) {
  const compact = compactLine(value, 160);
  if (!compact) return false;
  return containsInternalTerm(compact)
    || /\b(?:raw|provider|stdout|stderr|token|secret|authorization|credential|password)\b/i.test(compact);
}

function publicSearchLine(value: string | undefined, fallback: string, maxLength: number) {
  const compact = compactLine(value || fallback, maxLength);
  const safeFallback = compactLine(fallback, maxLength);
  if (containsInternalTerm(safeFallback)) return 'Capability';
  if (!compact || containsInternalTerm(compact)) return safeFallback || 'Capability';
  return compact;
}

function uniqueCapabilityMatches<T extends { label: string; detail: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.detail}:${item.label}`.toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function compactLine(value: string | undefined, maxLength: number) {
  const compact = (value ?? '').replace(/\s+/g, ' ').trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function containsNeedle(value: string, needle: string) {
  return value.toLocaleLowerCase().includes(needle);
}

function containsInternalTerm(value: string) {
  return /\b(?:ExecutionUnit|execution-unit|provider|model|profile|runtime\s+codex|live-runtime-codex|native-message|raw\s+JSONL|stdout|stderr|ConversationProjection|ArtifactDelivery|codex-command|run\s+id|workspace\s+command)\b/i.test(value)
    || /\brun-[a-z0-9][a-z0-9_-]*\b/i.test(value)
    || /https?:\/\/|(?:^|\s)(?:\/Users|\/Applications|\/Volumes|\/private|\/var\/folders|\/tmp)\/|\b(?:Authorization|api\s*key|secret|token|credential|password)\b|\bsk-[A-Za-z0-9._-]+/i.test(value);
}

function commandPaletteMatchId(prefix: string, raw: string) {
  let hash = 2166136261;
  for (let index = 0; index < raw.length; index += 1) {
    hash ^= raw.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}:${(hash >>> 0).toString(36)}`;
}
