import { collectRuntimeRefsFromValue, runtimePayloadKeyLooksLikeBodyCarrier } from '@sciforge-ui/runtime-contract/references';

const sensitiveKeyPattern = /(?:^|[_-])(?:endpoint|baseurl|invokeurl|invokepath|url|authorization|auth|token|secret|password|credential|apikey|api_key|workspacepath|workspaceroots|runtimeLocation|workerId|stdout|stderr|rawOutput|providerRawOutput)(?:$|[_-])/i;
const sensitiveTextPattern = /\bhttps?:\/\/[^\s"'<>]+|\.sciforge\/(?:sessions\/)?[^\s"'<>]*(?:logs|stdout|stderr|raw)[^\s"'<>]*|\b(?:authorization|bearer|token|secret|api[_-]?key|password|credential)\b|RAW_[A-Z0-9_]+|Invalid token|Unauthorized|Forbidden/i;

export function sanitizeRuntimeDebugValue(value: unknown, key = '', depth = 0): unknown {
  if (value === undefined || value === null) return value;
  if (sensitiveKeyPattern.test(key)) return summarizeRuntimeDebugBody(value);
  if (typeof value === 'string') {
    if (runtimePayloadKeyLooksLikeBodyCarrier(key) || sensitiveTextPattern.test(value)) return summarizeRuntimeDebugBody(value);
    return value.length > 1000 ? summarizeRuntimeDebugBody(value) : value;
  }
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    if (depth > 5) return { omitted: 'max-depth', length: value.length };
    return value.slice(0, 80).map((item) => sanitizeRuntimeDebugValue(item, key, depth + 1));
  }
  if (runtimePayloadKeyLooksLikeBodyCarrier(key)) return summarizeRuntimeDebugBody(value);
  if (depth > 5) return { omitted: 'max-depth', keys: Object.keys(value as Record<string, unknown>).slice(0, 16) };
  const out: Record<string, unknown> = {};
  for (const [childKey, child] of Object.entries(value as Record<string, unknown>)) {
    out[childKey] = sanitizeRuntimeDebugValue(child, childKey, depth + 1);
  }
  return out;
}

export function formatSanitizedRuntimeDebugValue(value: unknown) {
  try {
    return JSON.stringify(sanitizeRuntimeDebugValue(value), null, 2);
  } catch {
    return String(summarizeRuntimeDebugBody(String(value)));
  }
}

export function runtimeDebugValueHasRawLeak(value: unknown): boolean {
  return sensitiveTextPattern.test(typeof value === 'string' ? value : JSON.stringify(value ?? ''));
}

function summarizeRuntimeDebugBody(value: unknown) {
  const refs = collectRuntimeRefsFromValue(value, { maxDepth: 4, maxRefs: 16, includeIds: true })
    .filter((ref) => !/^https?:\/\//i.test(ref));
  if (typeof value === 'string') {
    return {
      omitted: 'runtime-debug-sensitive-body',
      chars: value.length,
      refs,
    };
  }
  if (typeof value === 'object' && value !== null) {
    return {
      omitted: 'runtime-debug-sensitive-object',
      keys: Object.keys(value as Record<string, unknown>).slice(0, 16),
      refs,
    };
  }
  return { omitted: 'runtime-debug-sensitive-value', refs };
}
