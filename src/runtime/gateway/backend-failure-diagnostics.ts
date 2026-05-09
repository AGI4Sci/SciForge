import { isRecord, uniqueStrings } from '../gateway-utils.js';

export type AgentServerBackendFailureKind =
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

export interface AgentServerBackendFailureDiagnostic {
  kind: AgentServerBackendFailureKind;
  categories: AgentServerBackendFailureKind[];
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

export function classifyAgentServerBackendFailure(
  message: string,
  context: {
    httpStatus?: number;
    headers?: Headers;
    backend?: string;
    provider?: string;
    model?: string;
    evidenceRefs?: string[];
  } = {},
): AgentServerBackendFailureDiagnostic | undefined {
  const text = parseJsonErrorMessage(message) || message;
  const lower = text.toLowerCase();
  const categories: AgentServerBackendFailureKind[] = [];
  if (/\b(fetch|network|econnrefused|econnreset|enotfound|etimedout|socket|dns|connection refused|connection reset|offline)\b/i.test(text)) categories.push('network');
  if (/\b(timeout|timed out|abort|cancelled|canceled)\b/i.test(text)) categories.push('timeout');
  if (/\b(unauthorized|forbidden|credential|api[-_ ]?key|token|permission denied|access denied|401|403)\b/i.test(text)) categories.push('auth');
  if (/\b(model|provider|llm|completion|response)\b/i.test(text) && /\b(failed|error|unavailable|invalid|refused|empty)\b/i.test(text)) categories.push('model');
  if (/\b(tool|command|process|exit code|stderr|stdout|executable|dependency|module not found|enoent)\b/i.test(text)) categories.push('tool');
  if (/\b(schema|payload|json|parse|validation|contract)\b/i.test(text)) categories.push('schema');
  if (/\b(missing|required|not found|unreadable)\b/i.test(text) && /\b(input|file|artifact|ref|path|credential)\b/i.test(text)) categories.push('missing-input');
  if (/\b(acceptance|verifier|verification|gate|rubric)\b/i.test(text) && /\b(fail|failed|missing|blocked|repair)\b/i.test(text)) categories.push('acceptance');
  if (/contextwindowexceeded|context window exceeded|context_length|maximum context|token limit|context.*overflow/i.test(text)) categories.push('context-window');
  if (context.httpStatus === 429 || /\b429\b|too many requests/.test(lower)) categories.push('http-429', 'rate-limit');
  if (/rate[\s-]?limit|retry-after|reset/i.test(text)) categories.push('rate-limit');
  if (/responseTooManyFailedAttempts|too many failed attempts/i.test(text)) categories.push('too-many-failed-attempts', 'retry-budget');
  if (/exceeded retry limit|retry budget|too many retries|max retries/i.test(text)) categories.push('retry-budget');
  const uniqueCategories = uniqueStrings(categories) as AgentServerBackendFailureKind[];
  if (!uniqueCategories.length) return undefined;
  const diagnostic = {
    kind: uniqueCategories[0],
    categories: uniqueCategories,
    backend: context.backend,
    provider: context.provider,
    model: context.model,
    httpStatus: context.httpStatus,
    retryAfterMs: retryAfterMsFromHeaders(context.headers) ?? retryAfterMsFromText(text),
    resetAt: rateLimitResetAtFromHeaders(context.headers) ?? rateLimitResetAtFromText(text),
    message: sanitizeBackendFailureDetail(text),
    evidenceRefs: context.evidenceRefs,
  } satisfies AgentServerBackendFailureDiagnostic;
  return withUserFacingDiagnostic(diagnostic);
}

export function diagnosticForFailure(
  message: string,
  context: {
    httpStatus?: number;
    headers?: Headers;
    backend?: string;
    provider?: string;
    model?: string;
    evidenceRefs?: string[];
  } = {},
): AgentServerBackendFailureDiagnostic {
  return classifyAgentServerBackendFailure(message, context) ?? withUserFacingDiagnostic({
    kind: 'unknown',
    categories: ['unknown'],
    backend: context.backend,
    provider: context.provider,
    model: context.model,
    httpStatus: context.httpStatus,
    message: sanitizeBackendFailureDetail(parseJsonErrorMessage(message) || message),
    evidenceRefs: context.evidenceRefs,
  });
}

export function withUserFacingDiagnostic(diagnostic: AgentServerBackendFailureDiagnostic): AgentServerBackendFailureDiagnostic {
  const primary = diagnostic.categories[0] ?? diagnostic.kind;
  const titleByKind: Record<AgentServerBackendFailureKind, string> = {
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
  const nextStepByKind: Record<AgentServerBackendFailureKind, string> = {
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
  return {
    ...diagnostic,
    title: diagnostic.title ?? titleByKind[primary],
    userReason: diagnostic.userReason ?? `${titleByKind[primary]}：${diagnostic.message}`,
    recoverActions: diagnostic.recoverActions ?? recoverActionsForDiagnostic(diagnostic),
    nextStep: diagnostic.nextStep ?? nextStepByKind[primary],
  };
}

export function recoverActionsForDiagnostic(diagnostic: Pick<AgentServerBackendFailureDiagnostic, 'categories' | 'retryAfterMs' | 'resetAt'>) {
  const categories = new Set(diagnostic.categories);
  if (categories.has('http-429') || categories.has('rate-limit') || categories.has('retry-budget') || categories.has('too-many-failed-attempts')) {
    return rateLimitRecoverActions(diagnostic as AgentServerBackendFailureDiagnostic);
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

export function providerRateLimitDiagnosticMessage(diagnostic: AgentServerBackendFailureDiagnostic, finalFailure: boolean) {
  const labels = diagnostic.categories.join(', ');
  const provider = [diagnostic.provider, diagnostic.model].filter(Boolean).join('/') || diagnostic.backend || 'unknown provider';
  const retryAfter = diagnostic.retryAfterMs !== undefined ? ` retryAfterMs=${diagnostic.retryAfterMs}.` : '';
  const resetAt = diagnostic.resetAt ? ` resetAt=${diagnostic.resetAt}.` : '';
  const retry = finalFailure
    ? ' SciForge already performed the single allowed compact/slim retry and will not retry again automatically.'
    : ' SciForge will back off, compact/slim the handoff, and retry once.';
  return `AgentServer/provider failure classified as ${labels} for ${provider}.${retryAfter}${resetAt}${retry} Detail: ${diagnostic.message}`;
}

export function rateLimitRecoverActions(diagnostic: AgentServerBackendFailureDiagnostic) {
  const wait = diagnostic.retryAfterMs
    ? `Wait at least ${Math.ceil(diagnostic.retryAfterMs / 1000)}s or until provider retry-after/reset before rerunning.`
    : 'Wait for the provider rate-limit or retry budget to reset before rerunning.';
  return [
    wait,
    'Reduce concurrent AgentServer runs or switch to a model/provider with available quota.',
    'Keep follow-up context compact by relying on workspace refs instead of resending full logs/artifacts.',
  ];
}

export function boundedRateLimitBackoffMs(diagnostic: AgentServerBackendFailureDiagnostic) {
  const configuredMax = Number(process.env.SCIFORGE_AGENTSERVER_RATE_LIMIT_BACKOFF_MAX_MS || 1500);
  const max = Number.isFinite(configuredMax) ? Math.max(0, Math.min(10_000, configuredMax)) : 1500;
  const requested = diagnostic.retryAfterMs ?? 250;
  return Math.min(max, Math.max(0, requested));
}

export function parseJsonErrorMessage(text: string) {
  try {
    const parsed = JSON.parse(text);
    if (isRecord(parsed.error) && typeof parsed.error.message === 'string') {
      return parsed.error.message;
    }
    if (typeof parsed.message === 'string') return parsed.message;
  } catch {
    // Not JSON; keep the raw text for sanitization.
  }
  return undefined;
}

export function sanitizeAgentServerError(text: string) {
  const firstLine = text.split('\n').map((line) => line.trim()).find(Boolean) || text;
  const providerDiagnostic = classifyAgentServerBackendFailure(firstLine);
  if (providerDiagnostic?.categories.some((category) => category === 'http-429' || category === 'rate-limit' || category === 'retry-budget' || category === 'too-many-failed-attempts')) {
    return providerRateLimitDiagnosticMessage(providerDiagnostic, false);
  }
  if (providerDiagnostic?.userReason) return providerDiagnostic.userReason;
  if (/429|too many requests|responseTooManyFailedAttempts|exceeded retry limit/i.test(firstLine)) {
    return '上游模型/AgentServer 返回 429 Too Many Requests 或 exceeded retry limit；这更像速率限制/重试预算耗尽，不是典型 context window 超限。请稍后重试，或降低并发与本轮上下文体积。';
  }
  if (/context window|maximum context|context length|token limit/i.test(firstLine)) {
    return '上游模型报告 context window/token limit 超限；需要压缩历史上下文、减少 artifacts/logs，或改用更大上下文模型。';
  }
  return redactSecretText(firstLine
    .replace(/request id:\s*[^),\s]+/gi, 'request id: redacted')
    .replace(/url:\s*\S+/gi, 'url: redacted')
    .replace(/https?:\/\/[^\s|,)]+/gi, 'redacted-url'))
    .slice(0, 320);
}

export function isContextWindowExceededError(text: string) {
  return /contextWindowExceeded|context window|maximum context|context length|token limit|tokens? exceeded|context.*exceed|input.*too long/i.test(text)
    && !isRateLimitError(text);
}

export function isRateLimitError(text: string) {
  return /429|too many requests|responseTooManyFailedAttempts|exceeded retry limit|rate.?limit/i.test(text);
}

export function retryAfterMsFromText(text: string) {
  const seconds = text.match(/retry-after["'\s:=]+(\d+(?:\.\d+)?)/i)?.[1]
    ?? text.match(/retry after\s+(\d+(?:\.\d+)?)\s*(?:s|sec|seconds)?/i)?.[1];
  if (!seconds) return undefined;
  const parsed = Number(seconds);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed * 1000)) : undefined;
}

export function redactSecretText(text: string) {
  return text
    .replace(/(api[-_]?key|token|authorization|secret|password|credential)(["'\s]*[:=]\s*["']?)([^"',\s)]+)/gi, '$1$2[redacted]')
    .replace(/\b(sk|pk|ak)-[A-Za-z0-9_-]{12,}\b/g, '$1-[redacted]');
}

function retryAfterMsFromHeaders(headers?: Headers) {
  const value = headers?.get('retry-after');
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, Math.round(seconds * 1000));
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : undefined;
}

function rateLimitResetAtFromHeaders(headers?: Headers) {
  return headers?.get('x-ratelimit-reset') ?? headers?.get('x-rate-limit-reset') ?? undefined;
}

function rateLimitResetAtFromText(text: string) {
  return text.match(/(?:resetAt|reset_at|rate limit reset)["'\s:=]+([0-9T:.\-+Z]+)/i)?.[1];
}

function sanitizeBackendFailureDetail(text: string) {
  return redactSecretText(text
    .replace(/request id:\s*[^),\s]+/gi, 'request id: redacted')
    .replace(/url:\s*\S+/gi, 'url: redacted')
    .replace(/https?:\/\/[^\s|,)]+/gi, 'redacted-url'))
    .slice(0, 320);
}
