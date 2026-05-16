import type { AgentStreamEvent, SendAgentMessageInput } from '../../domain';
import { makeId, nowIso } from '../../domain';
import {
  WORKSPACE_RUNTIME_EVENT_TYPE,
  compactCapabilityForBackend,
  normalizeRuntimeCompactCapability,
  normalizeRuntimeContextCompactionStatus,
  normalizeRuntimeContextWindowSource,
  normalizeRuntimeContextWindowStatus,
  runtimeInteractionProgressPresentation,
  runtimeStreamEventLabel,
  workspaceRuntimeResultCompletion,
} from '@sciforge-ui/runtime-contract';
import { runtimeInteractionProgressEventFromCompactRecord } from '@sciforge-ui/runtime-contract/events';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const entries = value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
  return entries.length ? entries : undefined;
}

export function withConfiguredContextWindowLimit(event: AgentStreamEvent, maxContextWindowTokens: number): AgentStreamEvent {
  const state = event.contextWindowState;
  if (!state || state.windowTokens !== undefined || !maxContextWindowTokens) return event;
  const ratio = state.usedTokens !== undefined ? state.usedTokens / maxContextWindowTokens : state.ratio;
  return {
    ...event,
    contextWindowState: {
      ...state,
      window: maxContextWindowTokens,
      windowTokens: maxContextWindowTokens,
      ratio,
      status: normalizeRuntimeContextWindowStatus(state.status, ratio, state.autoCompactThreshold),
    },
  };
}

export function contextWindowTelemetryEvent(
  input: SendAgentMessageInput,
  requestBodyText: string,
  detail: string,
): AgentStreamEvent {
  const rawBytes = new TextEncoder().encode(requestBodyText).length;
  const rawTokens = Math.max(1, Math.ceil(requestBodyText.length / 4));
  const windowTokens = input.config.maxContextWindowTokens || undefined;
  const ratio = windowTokens ? rawTokens / windowTokens : undefined;
  const autoCompactThreshold = 0.82;
  return {
    ...toolEvent('contextWindowState', detail),
    label: '上下文窗口',
    contextWindowState: {
      backend: input.config.agentBackend,
      provider: input.config.modelProvider,
      model: input.config.modelName,
      usedTokens: rawTokens,
      window: windowTokens,
      windowTokens,
      ratio,
      source: 'agentserver-estimate',
      status: normalizeRuntimeContextWindowStatus(undefined, ratio, autoCompactThreshold),
      compactCapability: compactCapabilityForBackend(input.config.agentBackend),
      autoCompactThreshold,
      watchThreshold: 0.68,
      nearLimitThreshold: 0.86,
      budget: {
        rawBytes,
        rawTokens,
      },
    },
  };
}

export function workspaceResultCompletion(result: Record<string, unknown>): { status: 'completed' | 'failed'; reason?: string } {
  return workspaceRuntimeResultCompletion(result);
}

export async function readWorkspaceToolStream(
  response: Response,
  onEvent: (event: unknown) => void,
): Promise<{ result?: unknown; error?: string }> {
  if (!response.body) {
    const text = await response.text();
    let json: unknown = text;
    try {
      json = JSON.parse(text);
    } catch {
      // Keep raw text for diagnostics.
    }
    if (isRecord(json) && json.ok === true) return { result: json.result };
    return { error: isRecord(json) ? asString(json.error) || asString(json.message) : text || `HTTP ${response.status}` };
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: unknown;
  let error: string | undefined;
  function consumeLine(rawLine: string) {
    const line = rawLine.trim();
    if (!line) return;
    const envelope = JSON.parse(line) as unknown;
    if (!isRecord(envelope)) return;
    if ('event' in envelope) onEvent(envelope.event);
    if ('result' in envelope) result = envelope.result;
    if ('error' in envelope) error = asString(envelope.error) || JSON.stringify(envelope.error);
  }
  for (;;) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    while (buffer.includes('\n')) {
      const index = buffer.indexOf('\n');
      consumeLine(buffer.slice(0, index));
      buffer = buffer.slice(index + 1);
    }
    if (done) break;
  }
  if (buffer.trim()) consumeLine(buffer);
  return { result, error };
}

export function normalizeWorkspaceRuntimeEvent(raw: unknown): AgentStreamEvent {
  const record = isRecord(raw) ? raw : {};
  const interactionProgressRecord = runtimeInteractionProgressEventFromCompactRecord(record);
  const interactionProgress = interactionProgressRecord ? runtimeInteractionProgressPresentation(interactionProgressRecord) : undefined;
  const type = interactionProgressRecord?.type ?? (asString(record.type) || asString(record.kind) || WORKSPACE_RUNTIME_EVENT_TYPE);
  const source = asString(record.source);
  const toolName = asString(record.toolName);
  const usage = normalizeTokenUsage(record.usage)
    ?? normalizeTokenUsage(isRecord(record.output) ? record.output.usage : undefined)
    ?? normalizeTokenUsage(isRecord(record.result) ? record.result.usage : undefined)
    ?? normalizeTokenUsage(isRecord(record.result) && isRecord(record.result.output) ? record.result.output.usage : undefined);
  const contextWindowState = normalizeContextWindowState(contextWindowCandidate(record), type, record);
  const contextCompaction = normalizeContextCompaction(record.contextCompaction ?? record.compaction ?? record.context_compaction, type, record);
  const workEvidence = normalizeWorkEvidenceRecords(record.workEvidence ?? record.work_evidence);
  const rawFallbackDetail = rawEventDetailFallback(record);
  const baseDetail = interactionProgress?.detail
    || safeVisibleDetail(record.detail, rawFallbackDetail)
    || safeVisibleDetail(record.message, rawFallbackDetail)
    || safeVisibleDetail(record.text, rawFallbackDetail)
    || safeVisibleDetail(record.output, rawFallbackDetail)
    || safeVisibleDetail(record.status, rawFallbackDetail)
    || safeVisibleDetail(record.error, rawFallbackDetail)
    || rawFallbackDetail;
  const usageDetail = formatTokenUsage(usage);
  const detail = [baseDetail, usageDetail].filter(Boolean).join(' | ') || undefined;
  return {
    id: makeId('evt'),
    type,
    label: interactionProgress?.label ?? runtimeStreamEventLabel(type, source, toolName),
    detail,
    usage,
    contextWindowState,
    contextCompaction,
    workEvidence,
    createdAt: nowIso(),
    raw,
  };
}

function rawEventDetailFallback(record: Record<string, unknown>) {
  if (!Object.keys(record).length) return undefined;
  const rawShaped = ['payload', 'raw', 'stdoutRef', 'stderrRef', 'rawRef', 'runtimeEventsRef'].some((key) => key in record);
  if (!rawShaped) return undefined;
  return 'Runtime event recorded; structured details are available in the run audit.';
}

function safeVisibleDetail(value: unknown, rawFallback: string | undefined) {
  const text = asString(value);
  if (!text) return undefined;
  if (rawFallback && (isLowInformationStatus(text) || looksPrivateRuntimeText(text))) return rawFallback;
  return text;
}

function isLowInformationStatus(value: string) {
  return /^(?:failed|error|ok|true|false|null|undefined)$/i.test(value.trim());
}

function looksPrivateRuntimeText(value: string) {
  return /^[{[]/.test(value.trim())
    || /\b(?:stdoutRef|stderrRef|rawRef|runtimeEventsRef)\b/i.test(value)
    || /\bhttps?:\/\/[^\s"'<>]+/i.test(value)
    || /\b(?:Invalid token|Unauthorized|Forbidden)\b/i.test(value);
}

function normalizeWorkEvidenceRecords(value: unknown): AgentStreamEvent['workEvidence'] | undefined {
  if (!Array.isArray(value)) return undefined;
  const records = value.filter(isWorkEvidenceRecord);
  return records.length ? records : undefined;
}

function isWorkEvidenceRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const schema = asString(value.schemaVersion);
  if (schema?.startsWith('sciforge.task-')) return false;
  return Boolean(asString(value.kind))
    && Boolean(asString(value.status))
    && Array.isArray(value.evidenceRefs)
    && Array.isArray(value.recoverActions);
}

function normalizeContextWindowState(value: unknown, type: string, fallback: Record<string, unknown>): AgentStreamEvent['contextWindowState'] | undefined {
  const record = isRecord(value) ? value : type === 'contextWindowState' && isRecord(fallback) ? fallback : undefined;
  if (!record) return undefined;
  const usage = isRecord(record.usage) ? record.usage : record;
  const input = asNumber(record.input) ?? asNumber(record.inputTokens) ?? asNumber(usage.input) ?? asNumber(usage.promptTokens);
  const output = asNumber(record.output) ?? asNumber(record.outputTokens) ?? asNumber(usage.output) ?? asNumber(usage.completionTokens);
  const cacheRead = asNumber(record.cacheRead) ?? asNumber(record.cacheReadTokens) ?? asNumber(usage.cacheRead);
  const cacheWrite = asNumber(record.cacheWrite) ?? asNumber(record.cacheWriteTokens) ?? asNumber(usage.cacheWrite);
  const cache = asNumber(record.cache) ?? asNumber(record.cacheTokens) ?? asNumber(usage.cache) ?? (
    cacheRead !== undefined || cacheWrite !== undefined ? (cacheRead ?? 0) + (cacheWrite ?? 0) : undefined
  );
  const explicitUsedTokens = asNumber(record.usedTokens)
    ?? asNumber(record.used_tokens)
    ?? asNumber(record.used)
    ?? asNumber(record.contextWindowTokens)
    ?? asNumber(record.currentContextWindowTokens)
    ?? asNumber(record.context_window_tokens)
    ?? asNumber(record.current_context_window_tokens)
    ?? asNumber(record.contextLength)
    ?? asNumber(record.context_length)
    ?? asNumber(record.currentContextLength)
    ?? asNumber(record.current_context_length)
    ?? asNumber(record.tokens);
  const usedTokens = explicitUsedTokens;
  const windowTokens = asNumber(record.windowTokens) ?? asNumber(record.window) ?? asNumber(record.contextWindowLimit) ?? asNumber(record.context_window_limit) ?? asNumber(record.limit) ?? asNumber(record.contextWindow);
  const ratio = clampRatio(asNumber(record.ratio) ?? asNumber(record.contextWindowRatio) ?? (
    usedTokens !== undefined && windowTokens ? usedTokens / windowTokens : undefined
  ));
  const hasUsage = input !== undefined || output !== undefined || cache !== undefined || asNumber(usage.total) !== undefined;
  const hasContextTelemetry = usedTokens !== undefined || windowTokens !== undefined || ratio !== undefined;
  const explicitSource = asString(record.source) ?? asString(record.contextWindowSource) ?? asString(record.context_window_source);
  const normalizedSource = explicitSource ? normalizeRuntimeContextWindowSource(explicitSource) : 'unknown';
  const source = explicitSource
    ? (normalizedSource === 'unknown' && hasUsage ? 'provider-usage' : normalizedSource)
    : (hasUsage ? 'provider-usage' : 'unknown');
  const state = {
    backend: asString(record.backend) ?? asString(usage.provider),
    provider: asString(record.provider) ?? asString(usage.provider),
    model: asString(record.model) ?? asString(usage.model),
    usedTokens,
    input,
    output,
    cache,
    window: windowTokens,
    windowTokens,
    ratio,
    source,
    status: normalizeRuntimeContextWindowStatus(asString(record.status), ratio, clampRatio(asNumber(record.autoCompactThreshold))),
    compactCapability: normalizeRuntimeCompactCapability(asString(record.compactCapability) ?? asString(record.compactionCapability)),
    budget: normalizeContextBudget(record.budget),
    auditRefs: asStringArray(record.auditRefs),
    autoCompactThreshold: clampRatio(asNumber(record.autoCompactThreshold)),
    watchThreshold: clampRatio(asNumber(record.watchThreshold)),
    nearLimitThreshold: clampRatio(asNumber(record.nearLimitThreshold)),
    lastCompactedAt: asString(record.lastCompactedAt),
    pendingCompact: typeof record.pendingCompact === 'boolean' ? record.pendingCompact : undefined,
  };
  if (state.compactCapability === 'unknown' && state.backend) {
    state.compactCapability = compactCapabilityForBackend(state.backend);
  }
  return hasContextTelemetry
    ? state
    : undefined;
}

function contextWindowCandidate(record: Record<string, unknown>): unknown {
  return record.contextWindowState
    ?? record.contextWindow
    ?? record.context_window
    ?? (isExplicitContextWindowRecord(record.usage) ? record.usage : undefined);
}

function isExplicitContextWindowRecord(value: unknown): value is Record<string, unknown> {
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

function normalizeContextCompaction(value: unknown, type: string, fallback: Record<string, unknown>): AgentStreamEvent['contextCompaction'] | undefined {
  const record = isRecord(value) ? value : type === 'contextCompaction' && isRecord(fallback) ? fallback : undefined;
  if (!record) return undefined;
  const isTag = record.kind === 'compaction' || record.kind === 'partial_compaction';
  const completedAt = asString(record.completedAt) ?? (isTag ? asString(record.createdAt) : undefined);
  const lastCompactedAt = asString(record.lastCompactedAt) ?? completedAt;
  const message = asString(record.message) ?? asString(record.userVisibleSummary) ?? asString(record.detail)
    ?? (isTag ? `${record.kind === 'partial_compaction' ? 'partial' : 'full'} compaction tag ${asString(record.id) ?? ''}`.trim() : undefined);
  return {
    status: normalizeRuntimeContextCompactionStatus(asString(record.status), {
      ok: asBoolean(record.ok) ?? (isTag ? true : undefined),
      completedAt,
      lastCompactedAt,
      message,
    }),
    source: normalizeRuntimeContextWindowSource(asString(record.source)),
    backend: asString(record.backend),
    compactCapability: normalizeRuntimeCompactCapability(asString(record.compactCapability) ?? asString(record.compactionCapability) ?? (isTag ? 'agentserver' : undefined)),
    before: normalizeContextWindowState(record.before, 'contextWindowState', {}),
    after: normalizeContextWindowState(record.after, 'contextWindowState', {}),
    auditRefs: asStringArray(record.auditRefs) ?? (isTag && asString(record.id) ? [`agentserver-compaction:${asString(record.id)}`] : undefined),
    startedAt: asString(record.startedAt),
    completedAt,
    lastCompactedAt,
    reason: asString(record.reason) ?? (isTag ? 'agentserver-compact' : undefined),
    message,
  };
}

function normalizeContextBudget(value: unknown): NonNullable<AgentStreamEvent['contextWindowState']>['budget'] | undefined {
  if (!isRecord(value)) return undefined;
  return {
    rawRef: asString(value.rawRef),
    rawSha1: asString(value.rawSha1),
    rawBytes: asNumber(value.rawBytes),
    normalizedBytes: asNumber(value.normalizedBytes),
    maxPayloadBytes: asNumber(value.maxPayloadBytes),
    rawTokens: asNumber(value.rawTokens),
    normalizedTokens: asNumber(value.normalizedTokens),
    savedTokens: asNumber(value.savedTokens),
    normalizedBudgetRatio: clampRatio(asNumber(value.normalizedBudgetRatio)),
    decisions: Array.isArray(value.decisions) ? value.decisions.filter(isRecord) : undefined,
  };
}

function clampRatio(value?: number) {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.min(1.5, value));
}

function normalizeTokenUsage(value: unknown): AgentStreamEvent['usage'] | undefined {
  if (!isRecord(value)) return undefined;
  const usage = {
    input: asNumber(value.input),
    output: asNumber(value.output),
    total: asNumber(value.total),
    cacheRead: asNumber(value.cacheRead),
    cacheWrite: asNumber(value.cacheWrite),
    provider: asString(value.provider),
    model: asString(value.model),
    source: asString(value.source),
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

function formatTokenUsage(usage: AgentStreamEvent['usage'] | undefined) {
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

export function toolEvent(type: string, detail: string, rawExtras: Record<string, unknown> = {}): AgentStreamEvent {
  return {
    id: makeId('evt'),
    type,
    label: '项目工具',
    detail,
    createdAt: nowIso(),
    raw: { type, detail, ...rawExtras },
  };
}
