import {
  runtimeAgentBackendFailureCategories,
  runtimeAgentBackendRateLimitRecoverActions,
  runtimeAgentBackendRecoverActions,
  redactRuntimeAgentBackendSecretText,
  sanitizeRuntimeAgentBackendFailureDetail,
  withRuntimeAgentBackendUserFacingDiagnostic,
  type RuntimeAgentBackendFailureDiagnostic,
  type RuntimeAgentBackendFailureKind,
} from '@sciforge-ui/runtime-contract/agent-backend-policy';
import { isRecord } from '../gateway-utils.js';

export type AgentServerBackendFailureKind = RuntimeAgentBackendFailureKind;
export type AgentServerBackendFailureDiagnostic = RuntimeAgentBackendFailureDiagnostic;

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
  const uniqueCategories = runtimeAgentBackendFailureCategories(text, context.httpStatus);
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
  return withRuntimeAgentBackendUserFacingDiagnostic(diagnostic);
}

export function recoverActionsForDiagnostic(diagnostic: Pick<AgentServerBackendFailureDiagnostic, 'categories' | 'retryAfterMs' | 'resetAt'>) {
  return runtimeAgentBackendRecoverActions(diagnostic);
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
  return runtimeAgentBackendRateLimitRecoverActions(diagnostic);
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
  return redactRuntimeAgentBackendSecretText(text);
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
  return sanitizeRuntimeAgentBackendFailureDetail(text);
}
