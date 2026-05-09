import type {
  GatewayRequest,
  WorkspaceRuntimeContextWindowSource,
  WorkspaceRuntimeEvent,
} from '../runtime-types.js';
import { isRecord, toStringList } from '../gateway-utils.js';
import { redactSecretText, retryAfterMsFromText } from './backend-failure-diagnostics.js';
import { collectWorkEvidenceFromBackendEvent } from './work-evidence-types.js';

export function normalizeAgentServerWorkspaceEvent(raw: unknown): WorkspaceRuntimeEvent {
  const record = isRecord(raw) ? raw : {};
  const rawType = typeof record.type === 'string' ? record.type : typeof record.kind === 'string' ? record.kind : 'agentserver-event';
  const type = normalizeAgentServerWorkspaceEventType(rawType, record);
  const toolName = typeof record.toolName === 'string' ? record.toolName : undefined;
  const usage = normalizeWorkspaceTokenUsage(record.usage)
    ?? normalizeWorkspaceTokenUsage(isRecord(record.output) ? record.output.usage : undefined)
    ?? normalizeWorkspaceTokenUsage(isRecord(record.result) ? record.result.usage : undefined)
    ?? normalizeWorkspaceTokenUsage(isRecord(record.result) && isRecord(record.result.output) ? record.result.output.usage : undefined);
  const contextCompaction = normalizeWorkspaceContextCompaction(
    record.contextCompaction ?? record.compaction ?? record.context_compaction ?? record.context_compressor ?? record.contextCompressor,
    type,
    record,
  );
  const rateLimit = normalizeWorkspaceRateLimit(
    record.rateLimit ?? record.rate_limit ?? record.rateLimitDiagnostics ?? record.rate_limit_diagnostics ?? hermesCompatRateLimitRecord(record),
    record,
  );
  const workEvidence = collectWorkEvidenceFromBackendEvent(raw);
  const contextWindowState = normalizeWorkspaceContextWindowState(
    workspaceContextWindowCandidate(record),
    type,
    record,
  );
  const baseDetail = typeof record.detail === 'string'
    ? record.detail
    : typeof record.message === 'string'
      ? record.message
      : typeof record.text === 'string'
        ? record.text
        : typeof record.output === 'string'
          ? record.output.slice(0, 600)
          : Array.isArray(record.plan)
            ? record.plan.join(' -> ')
            : record.error !== undefined
              ? summarizeEventValue(record.error)
              : record.result !== undefined
                ? summarizeEventValue(record.result)
                : undefined;
  const usageDetail = formatWorkspaceTokenUsage(usage);
  const detail = [baseDetail, usageDetail].filter(Boolean).join(' | ') || undefined;
  return {
    type,
    source: 'agentserver',
    toolName,
    message: toolName ? `${type}: ${toolName}` : type,
    detail,
    text: typeof record.text === 'string' ? record.text : undefined,
    output: typeof record.output === 'string' ? record.output.slice(0, 2000) : undefined,
    usage,
    contextWindowState,
    contextCompaction,
    rateLimit,
    workEvidence: workEvidence.length ? workEvidence : undefined,
    raw,
  };
}

export function withRequestContextWindowLimit(event: WorkspaceRuntimeEvent, request: GatewayRequest): WorkspaceRuntimeEvent {
  const state = event.contextWindowState;
  const limit = request.maxContextWindowTokens;
  if (!state || state.windowTokens !== undefined || limit === undefined) return event;
  const ratio = state.usedTokens !== undefined ? state.usedTokens / limit : state.ratio;
  return {
    ...event,
    contextWindowState: {
      ...state,
      window: limit,
      windowTokens: limit,
      ratio,
      status: normalizeWorkspaceContextStatus(state.status, ratio, state.autoCompactThreshold),
    },
  };
}

export function normalizeAgentServerWorkspaceEventType(type: string, record: Record<string, unknown>) {
  const lower = type.toLowerCase();
  if (lower === 'text_delta' || lower === 'token_delta' || lower === 'content_delta') return 'text-delta';
  if (lower === 'context_compressor' || lower === 'context-compressor') return 'contextCompaction';
  if (lower === 'ratelimit' || lower === 'rate_limit' || lower === 'rate-limit') return 'rateLimit';
  if (lower.includes('context_compressor') || record.context_compressor || record.contextCompressor) return 'contextCompaction';
  if (lower.includes('rate-limit') || lower.includes('rate_limit') || record.rate_limit || record.rateLimit || record.rate_limit_reset || record.rate_limit_reset_at) return 'rateLimit';
  return type;
}

export function normalizeWorkspaceContextWindowState(
  value: unknown,
  type: string,
  fallback: Record<string, unknown>,
): WorkspaceRuntimeEvent['contextWindowState'] | undefined {
  const record = isRecord(value) ? value : type === 'contextWindowState' && isRecord(fallback) ? fallback : undefined;
  if (!record) return undefined;
  const usage = isRecord(record.usage) ? record.usage : record;
  const input = firstFiniteNumber(record.input, record.inputTokens, record.prompt_tokens, usage.input, usage.inputTokens, usage.promptTokens, usage.prompt_tokens);
  const output = firstFiniteNumber(record.output, record.outputTokens, record.completion_tokens, usage.output, usage.outputTokens, usage.completionTokens, usage.completion_tokens);
  const cacheRead = firstFiniteNumber(record.cacheRead, record.cache_read, record.cacheReadTokens, usage.cacheRead, usage.cache_read, usage.cacheReadTokens);
  const cacheWrite = firstFiniteNumber(record.cacheWrite, record.cache_write, record.cacheWriteTokens, usage.cacheWrite, usage.cache_write, usage.cacheWriteTokens);
  const cache = firstFiniteNumber(record.cache, record.cacheTokens, record.cache_tokens, usage.cache, usage.cacheTokens, usage.cache_tokens)
    ?? (cacheRead !== undefined || cacheWrite !== undefined ? (cacheRead ?? 0) + (cacheWrite ?? 0) : undefined);
  const usedTokens = finiteNumber(record.usedTokens)
    ?? finiteNumber(record.used_tokens)
    ?? finiteNumber(record.used)
    ?? finiteNumber(record.contextWindowTokens)
    ?? finiteNumber(record.context_window_tokens)
    ?? finiteNumber(record.currentContextWindowTokens)
    ?? finiteNumber(record.current_context_window_tokens)
    ?? finiteNumber(record.contextLength)
    ?? finiteNumber(record.context_length)
    ?? finiteNumber(record.currentContextLength)
    ?? finiteNumber(record.current_context_length)
    ?? finiteNumber(record.tokens);
  const windowTokens = finiteNumber(record.windowTokens)
    ?? finiteNumber(record.window_tokens)
    ?? finiteNumber(record.window)
    ?? finiteNumber(record.contextWindowLimit)
    ?? finiteNumber(record.context_window_limit)
    ?? finiteNumber(record.limit)
    ?? finiteNumber(record.contextWindow)
    ?? finiteNumber(record.maxContextLength)
    ?? finiteNumber(record.max_context_length)
    ?? finiteNumber(record.contextLimit)
    ?? finiteNumber(record.context_limit);
  const ratio = finiteNumber(record.ratio)
    ?? finiteNumber(record.contextWindowRatio)
    ?? finiteNumber(record.context_window_ratio)
    ?? finiteNumber(record.usageRatio)
    ?? finiteNumber(record.usage_ratio)
    ?? (usedTokens !== undefined && windowTokens ? usedTokens / windowTokens : undefined);
  const rawAutoCompactThreshold = finiteNumber(record.autoCompactThreshold)
    ?? finiteNumber(record.auto_compact_threshold)
    ?? finiteNumber(record.compressionThreshold)
    ?? finiteNumber(record.compression_threshold);
  const autoCompactThreshold = rawAutoCompactThreshold && rawAutoCompactThreshold > 1 && windowTokens
    ? rawAutoCompactThreshold / windowTokens
    : rawAutoCompactThreshold;
  const hasUsage = input !== undefined || output !== undefined || cache !== undefined || finiteNumber(usage.total) !== undefined;
  const hasContextTelemetry = usedTokens !== undefined || windowTokens !== undefined || ratio !== undefined;
  const explicitSource = stringField(record.source) ?? stringField(record.contextWindowSource) ?? stringField(record.context_window_source);
  const source = explicitSource
    ? (normalizeWorkspaceContextSource(explicitSource) === 'unknown' && hasUsage ? 'provider-usage' : normalizeWorkspaceContextSource(explicitSource))
    : (hasUsage ? 'provider-usage' : 'unknown');
  const state = {
    backend: stringField(record.backend) ?? stringField(fallback.backend) ?? stringField(usage.provider),
    provider: stringField(record.provider) ?? stringField(usage.provider),
    model: stringField(record.model) ?? stringField(usage.model),
    usedTokens,
    input,
    output,
    cache,
    window: windowTokens,
    windowTokens,
    ratio,
    source,
    status: normalizeWorkspaceContextStatus(stringField(record.status), ratio, autoCompactThreshold),
    compactCapability: normalizeWorkspaceCompactCapability(stringField(record.compactCapability) ?? stringField(record.compactionCapability)),
    budget: isRecord(record.budget) ? record.budget : undefined,
    auditRefs: toStringList(record.auditRefs),
    autoCompactThreshold,
    watchThreshold: finiteNumber(record.watchThreshold),
    nearLimitThreshold: finiteNumber(record.nearLimitThreshold),
    lastCompactedAt: stringField(record.lastCompactedAt) ?? stringField(record.last_compacted_at) ?? stringField(record.lastCompressedAt) ?? stringField(record.last_compressed_at),
    pendingCompact: typeof record.pendingCompact === 'boolean' ? record.pendingCompact : undefined,
  };
  if (state.compactCapability === 'unknown' && state.backend) {
    state.compactCapability = compactCapabilityForBackend(state.backend);
  }
  return hasContextTelemetry ? state : undefined;
}

export function normalizeWorkspaceContextCompaction(
  value: unknown,
  type: string,
  fallback: Record<string, unknown>,
): WorkspaceRuntimeEvent['contextCompaction'] | undefined {
  const record = isRecord(value) ? value : type === 'contextCompaction' && isRecord(fallback) ? fallback : undefined;
  if (!record) return undefined;
  const status = normalizeWorkspaceCompactionStatus(stringField(record.status) ?? stringField(record.result));
  const completedAt = stringField(record.completedAt) ?? stringField(record.completed_at) ?? stringField(record.compressedAt) ?? stringField(record.compressed_at);
  const lastCompactedAt = stringField(record.lastCompactedAt) ?? stringField(record.last_compacted_at) ?? stringField(record.lastCompressedAt) ?? stringField(record.last_compressed_at) ?? completedAt;
  return {
    status,
    source: normalizeWorkspaceContextSource(stringField(record.source) ?? 'native'),
    backend: stringField(record.backend) ?? stringField(fallback.backend) ?? 'hermes-agent',
    compactCapability: normalizeWorkspaceCompactCapability(stringField(record.compactCapability) ?? stringField(record.compactionCapability) ?? 'native'),
    startedAt: stringField(record.startedAt) ?? stringField(record.started_at),
    completedAt,
    lastCompactedAt,
    reason: stringField(record.reason) ?? stringField(record.trigger),
    message: stringField(record.message) ?? stringField(record.summary),
  };
}

export function normalizeWorkspaceRateLimit(
  value: unknown,
  fallback: Record<string, unknown>,
): WorkspaceRuntimeEvent['rateLimit'] | undefined {
  const record = isRecord(value) ? value : {};
  const rateLimit = {
    limited: typeof record.limited === 'boolean'
      ? record.limited
      : typeof record.rate_limited === 'boolean'
        ? record.rate_limited
        : undefined,
    retryAfterMs: finiteNumber(record.retryAfterMs) ?? finiteNumber(record.retry_after_ms) ?? retryAfterMsFromText(JSON.stringify(record)),
    resetAt: stringField(record.resetAt)
      ?? stringField(record.reset_at)
      ?? stringField(record.rateLimitResetAt)
      ?? stringField(record.rate_limit_reset_at)
      ?? stringField(record.rate_limit_reset)
      ?? stringField(fallback.rate_limit_reset_at)
      ?? stringField(fallback.rate_limit_reset),
    provider: stringField(record.provider) ?? stringField(fallback.provider),
    model: stringField(record.model) ?? stringField(fallback.model),
    backend: stringField(record.backend) ?? stringField(fallback.backend),
    source: stringField(record.source) ?? 'agentserver',
  };
  return rateLimit.limited !== undefined || rateLimit.retryAfterMs !== undefined || rateLimit.resetAt ? rateLimit : undefined;
}

export function normalizeWorkspaceTokenUsage(value: unknown): WorkspaceRuntimeEvent['usage'] | undefined {
  if (!isRecord(value)) return undefined;
  const usage = {
    input: finiteNumber(value.input),
    output: finiteNumber(value.output),
    total: finiteNumber(value.total),
    cacheRead: finiteNumber(value.cacheRead),
    cacheWrite: finiteNumber(value.cacheWrite),
    provider: stringField(value.provider),
    model: stringField(value.model),
    source: stringField(value.source),
  };
  if (
    usage.input === undefined
    && usage.output === undefined
    && usage.total === undefined
    && usage.cacheRead === undefined
    && usage.cacheWrite === undefined
  ) {
    return undefined;
  }
  return usage;
}

function workspaceContextWindowCandidate(record: Record<string, unknown>): unknown {
  return record.contextWindowState
    ?? record.contextWindow
    ?? record.context_window
    ?? record.context_compressor
    ?? record.contextCompressor
    ?? (isExplicitWorkspaceContextWindowRecord(record.usage) ? record.usage : undefined);
}

function isExplicitWorkspaceContextWindowRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  return [
    'usedTokens',
    'used_tokens',
    'contextWindowTokens',
    'context_window_tokens',
    'currentContextWindowTokens',
    'current_context_window_tokens',
    'contextLength',
    'context_length',
    'currentContextLength',
    'current_context_length',
    'windowTokens',
    'window_tokens',
    'contextWindowLimit',
    'context_window_limit',
    'modelContextWindow',
    'model_context_window',
    'contextWindowRatio',
    'context_window_ratio',
    'contextWindowSource',
    'context_window_source',
  ].some((key) => key in value);
}

function hermesCompatRateLimitRecord(data: Record<string, unknown>): Record<string, unknown> {
  const hermes = firstRecord(data.hermes, data.hermesAgent, data.hermes_agent, data.compat, data.supervisorCompat, data.supervisor_compat);
  const event = firstRecord(data.event, data.payload, data.data);
  return firstRecord(
    data.rate_limit,
    data.rateLimit,
    data.rateLimitDiagnostics,
    data.rate_limit_diagnostics,
    hermes.rate_limit,
    hermes.rateLimit,
    event.rate_limit,
    event.rateLimit,
    event.rateLimitDiagnostics,
    event.rate_limit_diagnostics,
    data.rate_limit_reset || data.rate_limit_reset_at || data.retry_after_ms ? data : undefined,
    event.rate_limit_reset || event.rate_limit_reset_at || event.retry_after_ms ? event : undefined,
  );
}

function normalizeWorkspaceCompactionStatus(value?: string): NonNullable<WorkspaceRuntimeEvent['contextCompaction']>['status'] {
  if (value === 'started' || value === 'completed' || value === 'failed' || value === 'pending' || value === 'skipped') return value;
  if (value && /fail|error/i.test(value)) return 'failed';
  if (value && /start|running|compact/i.test(value) && !/complete|done|success|compressed/i.test(value)) return 'started';
  if (value && /skip|unsupported/i.test(value)) return 'skipped';
  if (value && /complete|done|success|compressed/i.test(value)) return 'completed';
  return 'completed';
}

function normalizeWorkspaceContextSource(value?: string): WorkspaceRuntimeContextWindowSource {
  if (value === 'native' || value === 'agentserver' || value === 'estimate' || value === 'unknown') return value;
  if (value === 'usage' || value === 'provider' || value === 'provider-usage') return 'native';
  if (value === 'backend') return 'native';
  if (value === 'agentserver-estimate') return 'estimate';
  if (value === 'handoff') return 'agentserver';
  return 'unknown';
}

function normalizeWorkspaceCompactCapability(value?: string): NonNullable<WorkspaceRuntimeEvent['contextWindowState']>['compactCapability'] {
  if (value === 'handoff-only') return 'handoff-slimming';
  if (value === 'native' || value === 'agentserver' || value === 'handoff-slimming' || value === 'session-rotate' || value === 'none' || value === 'unknown') return value;
  return 'unknown';
}

function normalizeWorkspaceContextStatus(
  value: string | undefined,
  ratio: number | undefined,
  autoCompactThreshold: number | undefined,
): NonNullable<WorkspaceRuntimeEvent['contextWindowState']>['status'] {
  if (value === 'healthy' || value === 'watch' || value === 'near-limit' || value === 'exceeded' || value === 'compacting' || value === 'blocked' || value === 'unknown') return value;
  if (value && /exceeded|overflow|max|full/i.test(value)) return 'exceeded';
  if (value && /compact/i.test(value)) return 'compacting';
  if (value && /blocked|rate/i.test(value)) return 'blocked';
  if (value && /near|critical|warning/i.test(value)) return 'near-limit';
  if (value && /watch/i.test(value)) return 'watch';
  if (value && /healthy|ok|normal/i.test(value)) return 'healthy';
  if (ratio !== undefined && ratio >= 1) return 'exceeded';
  if (ratio !== undefined && ratio >= (autoCompactThreshold ?? 0.82)) return 'near-limit';
  if (ratio !== undefined && ratio >= 0.68) return 'watch';
  return ratio === undefined ? 'unknown' : 'healthy';
}

function compactCapabilityForBackend(backend: string): 'native' | 'agentserver' | 'handoff-only' | 'handoff-slimming' | 'session-rotate' | 'none' | 'unknown' {
  if (backend === 'codex') return 'native';
  if (backend === 'openteam_agent' || backend === 'hermes-agent') return 'agentserver';
  if (backend === 'gemini') return 'session-rotate';
  if (backend === 'claude-code' || backend === 'openclaw') return 'handoff-only';
  return 'unknown';
}

function formatWorkspaceTokenUsage(usage: WorkspaceRuntimeEvent['usage'] | undefined) {
  if (!usage) return undefined;
  const parts = [
    usage.input !== undefined ? `in ${usage.input}` : '',
    usage.output !== undefined ? `out ${usage.output}` : '',
    usage.total !== undefined ? `total ${usage.total}` : '',
    usage.cacheRead !== undefined ? `cache read ${usage.cacheRead}` : '',
    usage.cacheWrite !== undefined ? `cache write ${usage.cacheWrite}` : '',
  ].filter(Boolean);
  const model = [usage.provider, usage.model].filter(Boolean).join('/');
  const suffix = [model, usage.source].filter(Boolean).join(' ');
  return `tokens ${parts.join(', ')}${suffix ? ` (${suffix})` : ''}`;
}

function summarizeEventValue(value: unknown) {
  if (typeof value === 'string') return value.slice(0, 1200);
  try {
    return JSON.stringify(redactSecrets(value)).slice(0, 1200);
  } catch {
    return String(value).slice(0, 1200);
  }
}

function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (!isRecord(value)) return typeof value === 'string' ? redactSecretText(value) : value;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (/api[-_]?key|token|authorization|secret|password|credential/i.test(key)) {
      out[key] = entry ? '[redacted]' : entry;
      continue;
    }
    out[key] = redactSecrets(entry);
  }
  return out;
}

function finiteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function firstFiniteNumber(...values: unknown[]) {
  return values.map(finiteNumber).find((value): value is number => value !== undefined);
}

function firstRecord(...values: unknown[]) {
  return values.find(isRecord) ?? {};
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
