import type { AgentCompactCapability } from './stream';

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

export const SUPPORTED_RUNTIME_AGENT_BACKENDS = ['openteam_agent', 'claude-code', 'codex', 'hermes-agent', 'openclaw', 'gemini'] as const;
export type RuntimeAgentBackend = typeof SUPPORTED_RUNTIME_AGENT_BACKENDS[number];
export type RuntimeBackendContextWindowSource = 'native' | 'provider-usage' | 'agentserver-estimate' | 'unknown';

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

export function runtimeAgentBackendConfigurationFailureIsBlocking(reason: string) {
  return /User-side model configuration|llmEndpoint|openteam\.json defaults|Model Provider|Model Base URL|Model Name/i.test(reason);
}

export function runtimeAgentBackendFailureCategories(text: string, httpStatus?: number): RuntimeAgentBackendFailureKind[] {
  const lower = text.toLowerCase();
  const categories: RuntimeAgentBackendFailureKind[] = [];
  if (/\b(fetch|network|econnrefused|econnreset|enotfound|etimedout|socket|dns|connection refused|connection reset|offline)\b/i.test(text)) categories.push('network');
  if (/\b(timeout|timed out|abort|cancelled|canceled)\b/i.test(text)) categories.push('timeout');
  if (/\b(unauthorized|forbidden|credential|api[-_ ]?key|token|permission denied|access denied|401|403)\b/i.test(text)) categories.push('auth');
  if (/contextwindowexceeded|context window exceeded|context_length|maximum context|token limit|context.*overflow/i.test(text)) categories.push('context-window');
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
