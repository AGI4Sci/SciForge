import type { AgentCompactCapability, AgentContextWindowSource } from './stream';

export type RuntimeAgentBackendFailureKind =
  | 'context-window'
  | 'network'
  | 'model'
  | 'tool'
  | 'acceptance'
  | 'auth'
  | 'timeout'
  | 'schema'
  | 'missing-input'
  | 'http-429'
  | 'rate-limit'
  | 'retry-budget'
  | 'too-many-failed-attempts'
  | 'unknown';

export interface RuntimeAgentBackendCapabilities {
  contextWindowTelemetry: boolean;
  nativeCompaction: boolean;
  compactionDuringTurn: boolean;
  rateLimitTelemetry: boolean;
  sessionRotationSafe: boolean;
}

export interface RuntimeAgentBackendFailureDiagnostic {
  kind: RuntimeAgentBackendFailureKind;
  categories: RuntimeAgentBackendFailureKind[];
  backend?: string;
  provider?: string;
  model?: string;
  httpStatus?: number;
  retryAfterMs?: number;
  resetAt?: string;
  message: string;
  title?: string;
  userReason?: string;
  recoverActions?: string[];
  nextStep?: string;
  evidenceRefs?: string[];
}

export interface RuntimeLlmEndpointConfig {
  provider?: string;
  baseUrl?: string;
  apiKey?: string;
  modelName?: string;
}

export interface RuntimeCapabilityEvolutionFailureClassificationInput {
  validationFailureCode?: string;
  composedFailureCode?: string;
  failureReason?: string;
  fallbackReason?: string;
  schemaErrors?: string[];
  exitCode?: number;
}

export const SUPPORTED_RUNTIME_AGENT_BACKENDS = ['openteam_agent', 'claude-code', 'codex', 'hermes-agent', 'openclaw', 'gemini'] as const;
export type RuntimeAgentBackend = typeof SUPPORTED_RUNTIME_AGENT_BACKENDS[number];
export type RuntimeBackendContextWindowSource = 'native' | 'provider-usage' | 'agentserver-estimate' | 'unknown';
export const RUNTIME_AGENTSERVER_MANAGED_COMPACTION_BACKENDS = ['openteam_agent'] as const;

const PROVIDER_BY_BACKEND: Record<string, string> = {
  openteam_agent: 'self-hosted',
  'hermes-agent': 'hermes',
};

const PROVIDER_LABEL_BY_BACKEND: Record<string, string> = {
  codex: 'OpenAI',
  openteam_agent: 'OpenTeam',
  'claude-code': 'Anthropic',
  gemini: 'Google',
  'hermes-agent': 'Hermes',
  openclaw: 'OpenClaw',
};

const CAPABILITIES_BY_BACKEND: Record<string, RuntimeAgentBackendCapabilities> = {
  codex: {
    contextWindowTelemetry: true,
    nativeCompaction: true,
    compactionDuringTurn: true,
    rateLimitTelemetry: true,
    sessionRotationSafe: true,
  },
  'hermes-agent': {
    contextWindowTelemetry: true,
    nativeCompaction: true,
    compactionDuringTurn: false,
    rateLimitTelemetry: true,
    sessionRotationSafe: true,
  },
  gemini: {
    contextWindowTelemetry: true,
    nativeCompaction: false,
    compactionDuringTurn: false,
    rateLimitTelemetry: true,
    sessionRotationSafe: true,
  },
  openteam_agent: {
    contextWindowTelemetry: true,
    nativeCompaction: false,
    compactionDuringTurn: false,
    rateLimitTelemetry: true,
    sessionRotationSafe: true,
  },
  'claude-code': {
    contextWindowTelemetry: false,
    nativeCompaction: false,
    compactionDuringTurn: false,
    rateLimitTelemetry: true,
    sessionRotationSafe: true,
  },
  openclaw: {
    contextWindowTelemetry: false,
    nativeCompaction: false,
    compactionDuringTurn: false,
    rateLimitTelemetry: true,
    sessionRotationSafe: true,
  },
};

const DEFAULT_AGENT_BACKEND_CAPABILITIES: RuntimeAgentBackendCapabilities = {
  contextWindowTelemetry: false,
  nativeCompaction: false,
  compactionDuringTurn: false,
  rateLimitTelemetry: false,
  sessionRotationSafe: true,
};

const COMPACT_CAPABILITY_BY_BACKEND: Record<string, AgentCompactCapability> = {
  codex: 'native',
  openteam_agent: 'agentserver',
  'hermes-agent': 'agentserver',
  gemini: 'session-rotate',
  'claude-code': 'handoff-only',
  openclaw: 'handoff-only',
};

const TITLE_BY_FAILURE_KIND: Record<RuntimeAgentBackendFailureKind, string> = {
  'context-window': '上下文窗口超限',
  network: '网络或连接失败',
  model: '模型/提供方失败',
  tool: '工具执行失败',
  acceptance: '验收未通过',
  auth: '认证或权限失败',
  timeout: '请求超时或被取消',
  schema: '响应结构不符合契约',
  'missing-input': '缺少必要输入或引用',
  'http-429': '模型限流',
  'rate-limit': '模型限流',
  'retry-budget': '重试预算耗尽',
  'too-many-failed-attempts': '重试预算耗尽',
  unknown: '运行失败',
};

const NEXT_STEP_BY_FAILURE_KIND: Record<RuntimeAgentBackendFailureKind, string> = {
  'context-window': '压缩上下文或减少日志/artifact 后重试。',
  network: '确认服务可达后重试同一请求。',
  model: '保留本轮证据，换可用模型/提供方或稍后重试。',
  tool: '打开工具日志，修复依赖、命令或输入后重跑。',
  acceptance: '基于失败的验收项做 repair，不把当前输出标为成功。',
  auth: '补齐凭据或权限后重试。',
  timeout: '使用已有失败证据继续，必要时缩小任务范围后重试。',
  schema: '要求后端按 ToolPayload/contract 重新返回结构化结果。',
  'missing-input': '补充缺失输入、文件或引用后继续。',
  'http-429': '等待限流/重试预算 reset 后用紧凑上下文重试。',
  'rate-limit': '等待限流/重试预算 reset 后用紧凑上下文重试。',
  'retry-budget': '停止自动重试，等待预算恢复或换可用模型。',
  'too-many-failed-attempts': '停止自动重试，等待预算恢复或换可用模型。',
  unknown: '查看失败证据并决定补输入、换路由或手动重跑。',
};

export function runtimeAgentBackendSupported(backend: string | undefined): backend is RuntimeAgentBackend {
  return Boolean(backend && (SUPPORTED_RUNTIME_AGENT_BACKENDS as readonly string[]).includes(backend));
}

export function runtimeAgentBackendProvider(backend: string) {
  return PROVIDER_BY_BACKEND[backend] ?? (backend || undefined);
}

export function runtimeAgentBackendProviderLabel(backend: string) {
  return PROVIDER_LABEL_BY_BACKEND[backend] ?? 'unknown';
}

export function runtimeAgentBackendCapabilities(backend: string): RuntimeAgentBackendCapabilities {
  return CAPABILITIES_BY_BACKEND[backend] ?? DEFAULT_AGENT_BACKEND_CAPABILITIES;
}

export function compactCapabilityForAgentBackend(backend: string): AgentCompactCapability {
  return COMPACT_CAPABILITY_BY_BACKEND[backend] ?? 'unknown';
}

export function runtimeAgentBackendUsesAgentServerManagedCompaction(backend: string) {
  return (RUNTIME_AGENTSERVER_MANAGED_COMPACTION_BACKENDS as readonly string[]).includes(backend);
}

export function fallbackCompactCapabilityForRuntimeAgentBackend(
  backend: string,
  capabilities: Pick<RuntimeAgentBackendCapabilities, 'nativeCompaction' | 'sessionRotationSafe'>,
): AgentCompactCapability {
  if (capabilities.nativeCompaction) return 'native';
  const capability = compactCapabilityForAgentBackend(backend);
  if (capability !== 'unknown') return capability;
  return capabilities.sessionRotationSafe ? 'handoff-only' : 'none';
}

export function runtimeAgentBackendFallbackCompactionStrategy(
  backend: string,
  capabilities: Pick<RuntimeAgentBackendCapabilities, 'sessionRotationSafe'>,
) {
  if (compactCapabilityForAgentBackend(backend) === 'session-rotate' && capabilities.sessionRotationSafe) return 'session-rotate';
  return capabilities.sessionRotationSafe ? 'handoff-slimming' : 'none';
}

export function runtimeAgentBackendFallbackCompactionMessage(backend: string) {
  return compactCapabilityForAgentBackend(backend) === 'session-rotate'
    ? 'Gemini SDK/API has no native compaction/reset; using AgentServer context compaction and session rotation fallback.'
    : 'Backend has no native compaction; using compact handoff context for this turn.';
}

export function runtimeAgentBackendHandoffFallbackCompactCapability(backend: string) {
  return compactCapabilityForAgentBackend(backend) === 'session-rotate' ? 'session-rotate' : 'handoff-only';
}

export function runtimeAgentBackendConfigurationFailureIsBlocking(reason: string) {
  return /User-side model configuration|llmEndpoint|openteam\.json defaults|Model Provider|Model Base URL|Model Name/i.test(reason);
}

export function runtimeAgentBackendConfigurationRecoverActions(reason: string) {
  if (!runtimeAgentBackendConfigurationFailureIsBlocking(reason)) return undefined;
  return [
    'Open SciForge settings and fill Model Provider, Model Base URL, Model Name, and API Key.',
    'Save config.local.json, then retry the same prompt so SciForge forwards the request-selected llmEndpoint.',
    'Do not rely on AgentServer openteam.json defaults for generated workspace tasks.',
  ];
}

export function runtimeAgentBackendConfigurationNextStep(reason: string) {
  return runtimeAgentBackendConfigurationFailureIsBlocking(reason)
    ? 'Configure the user-side model endpoint in SciForge settings, then retry the same prompt.'
    : undefined;
}

export function normalizeRuntimeLlmEndpoint(value: unknown): RuntimeLlmEndpointConfig | undefined {
  if (!isRuntimePolicyRecord(value)) return undefined;
  const provider = trimmedPolicyString(value.provider);
  const baseUrl = cleanRuntimeLlmEndpointUrl(value.baseUrl);
  const apiKey = trimmedPolicyString(value.apiKey);
  const modelName = trimmedPolicyString(value.modelName);
  if (!baseUrl && !apiKey && !modelName) return undefined;
  return {
    provider,
    baseUrl,
    apiKey,
    modelName,
  };
}

export function runtimeAgentBackendFailureCategories(text: string, httpStatus?: number): RuntimeAgentBackendFailureKind[] {
  const lower = text.toLowerCase();
  const categories: RuntimeAgentBackendFailureKind[] = [];
  if (/\b(fetch|network|econnrefused|econnreset|enotfound|etimedout|socket|dns|connection refused|connection reset|offline)\b/i.test(text)) categories.push('network');
  if (/\b(timeout|timed out|abort|cancelled|canceled)\b/i.test(text)) categories.push('timeout');
  if (/\b(unauthorized|forbidden|credential|api[-_ ]?key|token|permission denied|access denied|401|403)\b/i.test(text)) categories.push('auth');
  if (runtimeAgentBackendContextWindowFailureTextMatches(text)) categories.push('context-window');
  if (!categories.includes('context-window') && /\b(model|provider|llm|completion|response)\b/i.test(text) && /\b(failed|error|unavailable|invalid|refused|empty)\b/i.test(text)) categories.push('model');
  if (/\b(tool|command|process|exit code|stderr|stdout|executable|dependency|module not found|enoent)\b/i.test(text)) categories.push('tool');
  if (/\b(schema|payload|json|parse|validation|contract)\b/i.test(text)) categories.push('schema');
  if (/\b(missing|required|not found|unreadable)\b/i.test(text) && /\b(input|file|artifact|ref|path|credential)\b/i.test(text)) categories.push('missing-input');
  if (/\b(acceptance|verifier|verification|gate|rubric)\b/i.test(text) && /\b(fail|failed|missing|blocked|repair)\b/i.test(text)) categories.push('acceptance');
  if (httpStatus === 429 || /\b429\b|too many requests/.test(lower)) categories.push('http-429', 'rate-limit');
  if (/rate[\s-]?limit|retry-after|reset/i.test(text)) categories.push('rate-limit');
  if (/responseTooManyFailedAttempts|too many failed attempts/i.test(text)) categories.push('too-many-failed-attempts', 'retry-budget');
  if (/exceeded retry limit|retry budget|too many retries|max retries/i.test(text)) categories.push('retry-budget');
  return uniquePolicyStrings(categories) as RuntimeAgentBackendFailureKind[];
}

export function runtimeCapabilityEvolutionFailureCode(
  input: RuntimeCapabilityEvolutionFailureClassificationInput,
): string | undefined {
  if (input.validationFailureCode) return input.validationFailureCode;
  if (input.composedFailureCode) return input.composedFailureCode;
  const text = [
    input.failureReason ?? '',
    input.fallbackReason ?? '',
    ...(input.schemaErrors ?? []),
  ].join(' ');
  if (input.schemaErrors?.length || /schema|contract|payload|validation/i.test(text)) return 'schema-invalid';
  if (/timeout|timed out|cancelled/i.test(text)) return 'timeout';
  if (/missing artifact|artifact/i.test(text)) return 'missing-artifact';
  const categories = runtimeAgentBackendFailureCategories(text);
  if (runtimeCapabilityEvolutionProviderUnavailable(text, categories)) return 'provider-unavailable';
  if (typeof input.exitCode === 'number' && input.exitCode !== 0) return 'execution-failed';
  if (/confidence/i.test(text)) return 'low-confidence';
  return input.failureReason ? 'validation-failed' : undefined;
}

export function withRuntimeAgentBackendUserFacingDiagnostic(
  diagnostic: RuntimeAgentBackendFailureDiagnostic,
): RuntimeAgentBackendFailureDiagnostic {
  const primary = diagnostic.categories[0] ?? diagnostic.kind;
  return {
    ...diagnostic,
    title: diagnostic.title ?? TITLE_BY_FAILURE_KIND[primary],
    userReason: diagnostic.userReason ?? `${TITLE_BY_FAILURE_KIND[primary]}：${diagnostic.message}`,
    recoverActions: diagnostic.recoverActions ?? runtimeAgentBackendRecoverActions(diagnostic),
    nextStep: diagnostic.nextStep ?? NEXT_STEP_BY_FAILURE_KIND[primary],
  };
}

export function runtimeAgentBackendIsRateLimitKind(kind: RuntimeAgentBackendFailureKind) {
  return kind === 'http-429'
    || kind === 'rate-limit'
    || kind === 'retry-budget'
    || kind === 'too-many-failed-attempts';
}

export function runtimeAgentBackendDiagnosticIsRateLimited(
  diagnostic: Pick<RuntimeAgentBackendFailureDiagnostic, 'categories'>,
) {
  return diagnostic.categories.some(runtimeAgentBackendIsRateLimitKind);
}

export function runtimeAgentBackendFailureIsContextWindowExceeded(text: string) {
  const categories = runtimeAgentBackendFailureCategories(text);
  return categories.includes('context-window') && !categories.some(runtimeAgentBackendIsRateLimitKind);
}

export function runtimeAgentBackendProviderFailureMessage(
  diagnostic: RuntimeAgentBackendFailureDiagnostic,
  finalFailure: boolean,
) {
  const labels = diagnostic.categories.join(', ');
  const provider = [diagnostic.provider, diagnostic.model].filter(Boolean).join('/') || diagnostic.backend || 'unknown provider';
  const retryAfter = diagnostic.retryAfterMs !== undefined ? ` retryAfterMs=${diagnostic.retryAfterMs}.` : '';
  const resetAt = diagnostic.resetAt ? ` resetAt=${diagnostic.resetAt}.` : '';
  const retry = finalFailure
    ? ' SciForge already performed the single allowed compact/slim retry and will not retry again automatically.'
    : ' SciForge will back off, compact/slim the handoff, and retry once.';
  return `AgentServer/provider failure classified as ${labels} for ${provider}.${retryAfter}${resetAt}${retry} Detail: ${diagnostic.message}`;
}

export function runtimeAgentBackendSanitizedFailureUserReason(
  diagnostic: RuntimeAgentBackendFailureDiagnostic,
  finalFailure = false,
) {
  if (runtimeAgentBackendDiagnosticIsRateLimited(diagnostic)) {
    return runtimeAgentBackendProviderFailureMessage(diagnostic, finalFailure);
  }
  if (diagnostic.categories.includes('context-window')) {
    return '上游模型报告 context window/token limit 超限；需要压缩历史上下文、减少 artifacts/logs，或改用更大上下文模型。';
  }
  return diagnostic.userReason ?? `${TITLE_BY_FAILURE_KIND[diagnostic.categories[0] ?? diagnostic.kind]}：${diagnostic.message}`;
}

export function runtimeAgentBackendRecoverActions(
  diagnostic: Pick<RuntimeAgentBackendFailureDiagnostic, 'categories' | 'retryAfterMs' | 'resetAt'>,
) {
  const categories = new Set(diagnostic.categories);
  if (categories.has('http-429') || categories.has('rate-limit') || categories.has('retry-budget') || categories.has('too-many-failed-attempts')) {
    return runtimeAgentBackendRateLimitRecoverActions(diagnostic);
  }
  if (categories.has('network')) return ['检查 AgentServer/网络是否可达。', '保留本轮 evidence refs，服务恢复后重试同一请求。'];
  if (categories.has('auth')) return ['检查模型或工具凭据/权限配置。', '凭据修复后重试，避免在 prompt 中粘贴密钥。'];
  if (categories.has('tool')) return ['打开 stdoutRef/stderrRef/outputRef 查看工具证据。', '修复依赖、命令、路径或输入后重跑该 execution unit。'];
  if (categories.has('acceptance')) return ['按 acceptance failures 运行 repair。', '保留失败摘要和证据引用，下一轮从失败点继续。'];
  if (categories.has('schema')) return ['要求后端重新返回符合 ToolPayload/contract 的结构化 payload。', '保留原始 outputRef 作为协议失败证据。'];
  if (categories.has('context-window')) return ['减少传入历史、日志和 artifact 体积。', '优先使用 workspace refs/currentReferenceDigests，再重试。'];
  if (categories.has('missing-input')) return ['补充缺失文件、artifact、ref 或凭据。', '若 ref 不存在，改用最近可用的输出或日志引用。'];
  if (categories.has('timeout')) return ['缩小任务范围或延长超时后重试。', '下一轮使用已记录的 attempt history 继续，不从头解释失败。'];
  if (categories.has('model')) return ['稍后重试或切换到可用模型/提供方。', '保持上下文紧凑，只传 workspace refs 和失败摘要。'];
  return ['查看失败摘要和证据引用。', '补充缺失输入、换路由或手动重跑。'];
}

export function runtimeAgentBackendRateLimitRecoverActions(
  diagnostic: Pick<RuntimeAgentBackendFailureDiagnostic, 'retryAfterMs' | 'resetAt'>,
) {
  const wait = diagnostic.retryAfterMs
    ? `Wait at least ${Math.ceil(diagnostic.retryAfterMs / 1000)}s or until provider retry-after/reset before rerunning.`
    : 'Wait for the provider rate-limit or retry budget to reset before rerunning.';
  return [
    wait,
    'Reduce concurrent AgentServer runs or switch to a model/provider with available quota.',
    'Keep follow-up context compact by relying on workspace refs instead of resending full logs/artifacts.',
  ];
}

function runtimeCapabilityEvolutionProviderUnavailable(text: string, categories: RuntimeAgentBackendFailureKind[]) {
  return categories.some((category) => category === 'network'
    || category === 'model'
    || category === 'auth'
    || category === 'http-429'
    || category === 'rate-limit'
    || category === 'retry-budget'
    || category === 'too-many-failed-attempts')
    || runtimeAgentBackendConfigurationFailureIsBlocking(text)
    || /provider|base url|AgentServer|ECONNREFUSED|429|rate/i.test(text);
}

function runtimeAgentBackendContextWindowFailureTextMatches(text: string) {
  return /contextwindowexceeded|context window(?: exceeded)?|context_length|context length|maximum context|token limit|tokens? exceeded|context.*(?:overflow|exceed)|input.*too long/i.test(text);
}

export function sanitizeRuntimeAgentBackendFailureDetail(text: string, limit = 320) {
  const redacted = redactRuntimeAgentBackendSecretText(text
    .replace(/request id:\s*[^),\s]+/gi, 'request id: redacted')
    .replace(/url:\s*\S+/gi, 'url: redacted')
    .replace(/https?:\/\/[^\s|,)]+/gi, 'redacted-url'));
  if (redacted.length <= limit) return redacted;
  const clipped = redacted.slice(0, limit);
  const compactEvidence = redacted.match(/\bcompact=(?:[^|]+)(?:\s+\|\s+retry(?:Result)?=[^|]+)?/i)?.[0];
  if (compactEvidence && !clipped.includes(compactEvidence)) {
    return `${clipped} | ${compactEvidence}`;
  }
  return clipped;
}

export function redactRuntimeAgentBackendSecretText(text: string) {
  return text
    .replace(/(api[-_]?key|token|authorization|secret|password|credential)(["'\s]*[:=]\s*["']?)([^"',\s)]+)/gi, '$1$2[redacted]')
    .replace(/\b(sk|pk|ak)-[A-Za-z0-9_-]{12,}\b/g, '$1-[redacted]');
}

export function normalizeRuntimeAgentBackendContextWindowSource(input: {
  value?: string;
  backend: string;
  capabilities: Pick<RuntimeAgentBackendCapabilities, 'nativeCompaction'>;
  hasContextWindowTelemetry: boolean;
  hasUsage: boolean;
}): RuntimeBackendContextWindowSource {
  const value = input.value;
  if (value === 'native') return 'native';
  if (value === 'provider-usage' || value === 'usage' || value === 'provider') return 'provider-usage';
  if (value === 'agentserver-estimate' || value === 'agentserver' || value === 'estimate' || value === 'handoff') return 'agentserver-estimate';
  if (input.hasContextWindowTelemetry && input.capabilities.nativeCompaction && (input.backend === 'codex' || input.backend === 'hermes-agent')) return 'native';
  if (input.hasUsage) return 'provider-usage';
  if (input.hasContextWindowTelemetry) return 'agentserver-estimate';
  return 'unknown';
}

export function normalizeRuntimeWorkspaceContextWindowSource(input: {
  value?: string;
  backend?: string;
  capabilities?: Partial<Pick<RuntimeAgentBackendCapabilities, 'nativeCompaction'>>;
  hasContextWindowTelemetry?: boolean;
  hasUsage?: boolean;
}): AgentContextWindowSource {
  return normalizeRuntimeAgentBackendContextWindowSource({
    value: input.value,
    backend: input.backend ?? '',
    capabilities: { nativeCompaction: input.capabilities?.nativeCompaction ?? false },
    hasContextWindowTelemetry: input.hasContextWindowTelemetry ?? false,
    hasUsage: input.hasUsage ?? false,
  });
}

export function normalizeRuntimeWorkspaceCompactCapability(value?: string): AgentCompactCapability {
  if (value === 'handoff-only') return 'handoff-slimming';
  if (
    value === 'native'
    || value === 'agentserver'
    || value === 'handoff-slimming'
    || value === 'session-rotate'
    || value === 'none'
    || value === 'unknown'
  ) return value;
  return 'unknown';
}

export function estimateRuntimeAgentBackendModelContextWindow(modelName?: string) {
  const model = (modelName ?? '').toLowerCase();
  if (!model) return undefined;
  if (/1m|1000k|gemini-1\.5-pro|gemini-2\./.test(model)) return 1_000_000;
  if (/400k|claude.*sonnet-4|claude.*opus-4/.test(model)) return 400_000;
  if (/200k|claude|gpt-4\.1|gpt-5|o3|o4/.test(model)) return 200_000;
  if (/128k|gpt-4o|gemini/.test(model)) return 128_000;
  if (/32k/.test(model)) return 32_000;
  if (/16k/.test(model)) return 16_000;
  return undefined;
}

function uniquePolicyStrings(values: string[]) {
  return Array.from(new Set(values));
}

function isRuntimePolicyRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function trimmedPolicyString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function cleanRuntimeLlmEndpointUrl(value: unknown) {
  const text = trimmedPolicyString(value);
  return text ? text.replace(/\/+$/, '') : undefined;
}
