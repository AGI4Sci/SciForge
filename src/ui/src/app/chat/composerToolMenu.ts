import type { SupportedLocale } from '../../i18n';
import { scenarios } from '../../data';
import type { SciForgeConfig } from '../../domain';
import { uiModuleRegistry } from '../../uiModuleRegistry';
import { chatText } from './chatI18n';

export type ComposerToolMenuItemId =
  | 'plan'
  | 'debug'
  | 'multitask'
  | 'ask'
  | 'image'
  | 'models'
  | 'skills'
  | 'mcp-servers'
  | 'pick-context'
  | 'attach-file';

export interface ComposerToolMenuItem {
  id: ComposerToolMenuItemId;
  label: string;
  commandPrefix?: string;
  group: 'agent' | 'context' | 'sciforge';
}

export interface ComposerPublicModel {
  label: string;
  speed: string;
  state: 'ready' | 'unset';
}

export type ComposerModelIntentId =
  | 'auto'
  | 'max'
  | 'assistant-auto'
  | 'assistant-fast'
  | 'assistant-balanced'
  | 'assistant-deep';

export interface ComposerModelSelectionIntent {
  id: ComposerModelIntentId;
  label: string;
  speed: string;
  mode: 'auto' | 'max' | 'assistant';
  capabilityTier: 'auto' | 'max' | 'fast' | 'balanced' | 'deep';
}

export type ComposerCapabilityKind = 'domain-skill' | 'pipeline-skill' | 'tool-skill' | 'app-skill' | 'mcp-server' | 'connector';

export interface ComposerAgentHostCatalogItem {
  label?: string;
  title?: string;
  name?: string;
  capabilityId?: string;
  moduleId?: string;
  detail?: string;
  description?: string;
  summary?: string;
  kind?: string;
  type?: string;
  source?: string;
  toolType?: string;
  group?: 'skills' | 'mcp';
}

export interface ComposerCapabilityMenuItem {
  id: string;
  label: string;
  detail: string;
  commandPrefix: string;
  group: 'skills' | 'mcp';
  kind: ComposerCapabilityKind;
}

export interface ComposerCapabilityMenu {
  skills: ComposerCapabilityMenuItem[];
  mcpServers: ComposerCapabilityMenuItem[];
}

export function buildComposerToolMenu(locale?: SupportedLocale): ComposerToolMenuItem[] {
  return [
    { id: 'plan', label: chatText(locale, { 'zh-CN': 'Plan', 'en-US': 'Plan' }), commandPrefix: '/plan ', group: 'agent' },
    { id: 'debug', label: chatText(locale, { 'zh-CN': 'Debug', 'en-US': 'Debug' }), commandPrefix: '/debug ', group: 'agent' },
    { id: 'multitask', label: chatText(locale, { 'zh-CN': 'Multitask', 'en-US': 'Multitask' }), commandPrefix: '/multitask ', group: 'agent' },
    { id: 'ask', label: chatText(locale, { 'zh-CN': 'Ask', 'en-US': 'Ask' }), commandPrefix: '/ask ', group: 'agent' },
    { id: 'image', label: chatText(locale, { 'zh-CN': 'Image', 'en-US': 'Image' }), group: 'context' },
    { id: 'models', label: chatText(locale, { 'zh-CN': 'Models', 'en-US': 'Models' }), group: 'context' },
    { id: 'skills', label: chatText(locale, { 'zh-CN': 'Skills', 'en-US': 'Skills' }), commandPrefix: '/skills ', group: 'context' },
    { id: 'mcp-servers', label: chatText(locale, { 'zh-CN': 'MCP Servers', 'en-US': 'MCP Servers' }), commandPrefix: '/mcp ', group: 'context' },
    { id: 'pick-context', label: chatText(locale, { 'zh-CN': 'Pick visible context', 'en-US': 'Pick visible context' }), group: 'sciforge' },
    { id: 'attach-file', label: chatText(locale, { 'zh-CN': 'Attach file', 'en-US': 'Attach file' }), group: 'sciforge' },
  ];
}

export function buildComposerCapabilityMenu(options: {
  locale?: SupportedLocale;
  toolProviderRoutes?: SciForgeConfig['toolProviderRoutes'];
  agentHostCatalog?: ComposerAgentHostCatalogItem[];
} = {}): ComposerCapabilityMenu {
  const locale = options.locale;
  const domainSkillDetail = chatText(locale, { 'zh-CN': '领域技能', 'en-US': 'Domain skill' });
  const pipelineSkillDetail = chatText(locale, { 'zh-CN': '流程技能', 'en-US': 'Pipeline skill' });
  const toolSkillDetail = chatText(locale, { 'zh-CN': '工具技能', 'en-US': 'Tool skill' });
  const appSkillDetail = chatText(locale, { 'zh-CN': '应用技能', 'en-US': 'App skill' });
  const mcpDetail = chatText(locale, { 'zh-CN': 'MCP 服务器', 'en-US': 'MCP server' });
  const connectorDetail = chatText(locale, { 'zh-CN': '连接器', 'en-US': 'Connector' });
  const agentHostCatalog = composerCapabilitiesFromAgentHostCatalog(options.agentHostCatalog ?? [], {
    domainSkillDetail,
    pipelineSkillDetail,
    toolSkillDetail,
    appSkillDetail,
    mcpDetail,
    connectorDetail,
  });
  const skills = uniqueComposerCapabilities([
    ...agentHostCatalog.filter((item) => item.group === 'skills'),
    ...scenarios.map((scenario) => makeComposerCapability({
      group: 'skills',
      kind: 'domain-skill',
      label: titleFromPublicId(scenario.domain),
      detail: domainSkillDetail,
      command: 'skills',
    })),
    ...scenarios.map((scenario) => makeComposerCapability({
      group: 'skills',
      kind: 'pipeline-skill',
      label: publicCapabilityLabel(scenario.name, scenario.domain, 48),
      detail: pipelineSkillDetail,
      command: 'skills',
    })),
    ...scenarios.flatMap((scenario) => scenario.tools.map((tool) => makeComposerCapability({
      group: 'skills',
      kind: 'tool-skill',
      label: publicCapabilityLabel(tool, scenario.domain, 48),
      detail: toolSkillDetail,
      command: 'skills',
    }))),
    ...uiModuleRegistry.map((module) => makeComposerCapability({
      group: 'skills',
      kind: 'app-skill',
      label: publicCapabilityLabel(module.title, module.componentId, 48),
      detail: appSkillDetail,
      command: 'skills',
    })),
  ]).slice(0, 24);
  const routeEntries = Object.entries(options.toolProviderRoutes ?? {})
    .filter(([, route]) => route.source === 'mcp' || /mcp/i.test(`${route.capabilityId ?? ''} ${route.primaryProviderId ?? ''}`))
    .map(([key, route]) => makeComposerCapability({
      group: 'mcp',
      kind: 'mcp-server',
      label: publicCapabilityLabel(route.capabilityId || route.primaryProviderId || key, chatText(locale, { 'zh-CN': 'MCP 服务器', 'en-US': 'MCP server' }), 48),
      detail: mcpDetail,
      command: 'mcp',
    }));
  const dynamicMcpServers = agentHostCatalog.filter((item) => item.group === 'mcp');
  const mcpServers = uniqueComposerCapabilities([
    ...dynamicMcpServers,
    ...(routeEntries.length ? routeEntries : dynamicMcpServers.length ? [] : [
      makeComposerCapability({
        group: 'mcp',
        kind: 'mcp-server',
        label: chatText(locale, { 'zh-CN': 'MCP 服务器', 'en-US': 'MCP servers' }),
        detail: mcpDetail,
        command: 'mcp',
      }),
    ]),
  ]).slice(0, 8);
  return { skills, mcpServers };
}

export function filterComposerToolMenuItems(items: ComposerToolMenuItem[], query: string) {
  const normalized = normalizeSearchQuery(query);
  if (!normalized) return items;
  return items.filter((item) => containsSearchText(`${item.label} ${item.id} ${item.group}`, normalized));
}

export function filterComposerCapabilityMenuItems(items: ComposerCapabilityMenuItem[], query: string) {
  const normalized = normalizeSearchQuery(query);
  if (!normalized) return items;
  return items.filter((item) => containsSearchText(`${item.label} ${item.detail} ${item.kind} ${item.group}`, normalized));
}

export function applyComposerToolDirective(input: string, item: { commandPrefix?: string }) {
  if (!item.commandPrefix) return input;
  const current = input.trimStart();
  if (current.startsWith(item.commandPrefix.trim())) return input;
  return `${item.commandPrefix}${current}`.trimEnd();
}

export function publicComposerModel(context: { model: string } | undefined, locale?: SupportedLocale): ComposerPublicModel {
  const model = context?.model.trim() ?? '';
  if (!model) {
    return {
      label: chatText(locale, { 'zh-CN': 'Assistant', 'en-US': 'Assistant' }),
      speed: chatText(locale, { 'zh-CN': '未配置', 'en-US': 'Unset' }),
      state: 'unset',
    };
  }
  return {
    label: publicModelLabel(model),
    speed: publicModelSpeed(model, locale),
    state: 'ready',
  };
}

export function publicModelChoices(locale?: SupportedLocale): ComposerPublicModel[] {
  return [
    { label: chatText(locale, { 'zh-CN': 'Assistant Auto', 'en-US': 'Assistant Auto' }), speed: chatText(locale, { 'zh-CN': 'Auto', 'en-US': 'Auto' }), state: 'ready' },
    { label: chatText(locale, { 'zh-CN': 'Assistant Fast', 'en-US': 'Assistant Fast' }), speed: chatText(locale, { 'zh-CN': 'Fast', 'en-US': 'Fast' }), state: 'ready' },
    { label: chatText(locale, { 'zh-CN': 'Assistant Balanced', 'en-US': 'Assistant Balanced' }), speed: chatText(locale, { 'zh-CN': 'Medium', 'en-US': 'Medium' }), state: 'ready' },
    { label: chatText(locale, { 'zh-CN': 'Assistant Deep', 'en-US': 'Assistant Deep' }), speed: chatText(locale, { 'zh-CN': 'High', 'en-US': 'High' }), state: 'ready' },
  ];
}

export function composerModelSelectionIntents(locale?: SupportedLocale): ComposerModelSelectionIntent[] {
  const [assistantAuto, assistantFast, assistantBalanced, assistantDeep] = publicModelChoices(locale);
  return [
    {
      id: 'auto',
      label: chatText(locale, { 'zh-CN': 'Auto', 'en-US': 'Auto' }),
      speed: chatText(locale, { 'zh-CN': 'Auto', 'en-US': 'Auto' }),
      mode: 'auto',
      capabilityTier: 'auto',
    },
    {
      id: 'max',
      label: chatText(locale, { 'zh-CN': 'MAX Mode', 'en-US': 'MAX Mode' }),
      speed: chatText(locale, { 'zh-CN': 'High', 'en-US': 'High' }),
      mode: 'max',
      capabilityTier: 'max',
    },
    modelIntent('assistant-auto', assistantAuto, 'auto'),
    modelIntent('assistant-fast', assistantFast, 'fast'),
    modelIntent('assistant-balanced', assistantBalanced, 'balanced'),
    modelIntent('assistant-deep', assistantDeep, 'deep'),
  ];
}

function modelIntent(id: ComposerModelIntentId, model: ComposerPublicModel | undefined, tier: ComposerModelSelectionIntent['capabilityTier']): ComposerModelSelectionIntent {
  return {
    id,
    label: model?.label ?? 'Assistant',
    speed: model?.speed ?? 'Medium',
    mode: 'assistant',
    capabilityTier: tier,
  };
}

function publicModelLabel(model: string) {
  if (/composer/i.test(model)) return 'Composer';
  if (/codex/i.test(model)) return 'Codex';
  if (/gpt/i.test(model)) return 'GPT';
  if (/opus/i.test(model)) return 'Opus';
  if (/sonnet/i.test(model)) return 'Sonnet';
  return 'Assistant';
}

function publicModelSpeed(model: string, locale?: SupportedLocale) {
  if (/fast|flash|turbo|mini/i.test(model)) return chatText(locale, { 'zh-CN': 'Fast', 'en-US': 'Fast' });
  if (/high|deep|max|opus/i.test(model)) return chatText(locale, { 'zh-CN': 'High', 'en-US': 'High' });
  return chatText(locale, { 'zh-CN': 'Medium', 'en-US': 'Medium' });
}

function makeComposerCapability(input: {
  label: string;
  detail: string;
  command: 'skills' | 'mcp';
  group: 'skills' | 'mcp';
  kind: ComposerCapabilityKind;
}): ComposerCapabilityMenuItem {
  const label = publicCapabilityLabel(input.label, input.command === 'mcp' ? 'MCP server' : 'Capability', 48);
  const command = input.command === 'mcp' ? 'mcp' : 'skills';
  return {
    id: `${input.kind}:${stablePublicId(`${input.detail}:${label}`)}`,
    label,
    detail: input.detail,
    commandPrefix: `/${command} ${label} `,
    group: input.group,
    kind: input.kind,
  };
}

function composerCapabilitiesFromAgentHostCatalog(
  items: ComposerAgentHostCatalogItem[],
  labels: {
    domainSkillDetail: string;
    pipelineSkillDetail: string;
    toolSkillDetail: string;
    appSkillDetail: string;
    mcpDetail: string;
    connectorDetail: string;
  },
) {
  return items.flatMap((item) => {
    const kind = composerCapabilityKindForAgentHostItem(item);
    const group = kind === 'mcp-server' || kind === 'connector' ? 'mcp' : 'skills';
    const label = item.label ?? item.title ?? item.name ?? item.capabilityId ?? item.moduleId;
    const detail = publicCapabilityDetail(item.detail ?? item.description ?? item.summary ?? detailForCapabilityKind(kind, labels), detailForCapabilityKind(kind, labels), 64);
    const capability = makeComposerCapability({
      group,
      kind,
      label: label ?? detailForCapabilityKind(kind, labels),
      detail,
      command: group === 'mcp' ? 'mcp' : 'skills',
    });
    return capability.label === 'Capability' && group === 'skills' ? [] : [capability];
  });
}

function composerCapabilityKindForAgentHostItem(item: ComposerAgentHostCatalogItem): ComposerCapabilityKind {
  const transportText = `${item.group ?? ''} ${item.source ?? ''} ${item.toolType ?? ''}`.toLocaleLowerCase();
  const text = `${item.group ?? ''} ${item.kind ?? ''} ${item.type ?? ''} ${item.toolType ?? ''} ${item.moduleId ?? ''} ${item.capabilityId ?? ''}`.toLocaleLowerCase();
  if (/\bconnector\b/.test(text) || /\bconnector\b/.test(transportText)) return 'connector';
  if (/\bmcp\b|server/.test(transportText) || /\bmcp\b|server/.test(text)) return 'mcp-server';
  if (/domain/.test(text)) return 'domain-skill';
  if (/pipeline|workflow|plan/.test(text)) return 'pipeline-skill';
  if (/app|component|ui|module/.test(text)) return 'app-skill';
  return 'tool-skill';
}

function detailForCapabilityKind(
  kind: ComposerCapabilityKind,
  labels: {
    domainSkillDetail: string;
    pipelineSkillDetail: string;
    toolSkillDetail: string;
    appSkillDetail: string;
    mcpDetail: string;
    connectorDetail: string;
  },
) {
  if (kind === 'domain-skill') return labels.domainSkillDetail;
  if (kind === 'pipeline-skill') return labels.pipelineSkillDetail;
  if (kind === 'app-skill') return labels.appSkillDetail;
  if (kind === 'mcp-server') return labels.mcpDetail;
  if (kind === 'connector') return labels.connectorDetail;
  return labels.toolSkillDetail;
}

function uniqueComposerCapabilities(items: ComposerCapabilityMenuItem[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.group}:${item.kind}:${item.label}`.toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return item.label.trim().length > 0;
  });
}

function publicCapabilityLabel(value: string | undefined, fallback: string, maxLength: number) {
  const safeFallback = compactLine(fallback, maxLength);
  const compact = compactLine(value || fallback, maxLength);
  if (containsInternalTerm(safeFallback)) return 'Capability';
  if (!compact || containsInternalTerm(compact)) return safeFallback || 'Capability';
  return compact;
}

function publicCapabilityDetail(value: string | undefined, fallback: string, maxLength: number) {
  const safeFallback = compactLine(fallback, maxLength);
  const compact = compactLine(value || fallback, maxLength);
  if (!compact || containsInternalTerm(compact)) return safeFallback || 'Capability';
  return compact;
}

function titleFromPublicId(value: string) {
  return publicCapabilityLabel(value, 'Capability', 48)
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toLocaleUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function compactLine(value: string | undefined, maxLength: number) {
  const compact = (value ?? '').replace(/\s+/g, ' ').trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function normalizeSearchQuery(query: string) {
  return query.replace(/\s+/g, ' ').trim().toLocaleLowerCase();
}

function containsSearchText(value: string, normalizedQuery: string) {
  return value.toLocaleLowerCase().includes(normalizedQuery);
}

function containsInternalTerm(value: string) {
  return /\b(?:ExecutionUnit|execution-unit|provider|model|profile|runtime\s+codex|live-runtime-codex|native-message|raw\s+JSONL|stdout|stderr|ConversationProjection|ArtifactDelivery|codex-command|run\s+id|workspace\s+command|manifest|schema)\b/i.test(value)
    || /\brun-[a-z0-9][a-z0-9_-]*\b/i.test(value)
    || /https?:\/\/|(?:^|\s)(?:\/Users|\/Applications|\/Volumes|\/private|\/var\/folders|\/tmp)\/|\b(?:Authorization|api\s*key|secret|token|credential|password)\b|\bsk-[A-Za-z0-9._-]+/i.test(value);
}

function stablePublicId(raw: string) {
  let hash = 2166136261;
  for (let index = 0; index < raw.length; index += 1) {
    hash ^= raw.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
