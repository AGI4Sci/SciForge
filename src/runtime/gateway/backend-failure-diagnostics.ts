import {
  runtimeAgentBackendFailureCategories,
  runtimeAgentBackendFailureIsContextWindowExceeded,
  runtimeAgentBackendIsRateLimitKind,
  runtimeAgentBackendProviderFailureMessage,
  runtimeAgentBackendRateLimitRecoverActions,
  runtimeAgentBackendRecoverActions,
  runtimeAgentBackendSanitizedFailureUserReason,
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
  return runtimeAgentBackendProviderFailureMessage(diagnostic, finalFailure);
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
  if (providerDiagnostic) return runtimeAgentBackendSanitizedFailureUserReason(providerDiagnostic, false);
  return redactSecretText(firstLine
    .replace(/request id:\s*[^),\s]+/gi, 'request id: redacted')
    .replace(/url:\s*\S+/gi, 'url: redacted')
    .replace(/https?:\/\/[^\s|,)]+/gi, 'redacted-url'))
    .slice(0, 320);
}

export function isContextWindowExceededError(text: string) {
  return runtimeAgentBackendFailureIsContextWindowExceeded(text);
}

export function isRateLimitError(text: string) {
  return runtimeAgentBackendFailureCategories(text).some(runtimeAgentBackendIsRateLimitKind);
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
