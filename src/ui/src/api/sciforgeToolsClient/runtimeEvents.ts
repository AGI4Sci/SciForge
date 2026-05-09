import type { AgentStreamEvent, SendAgentMessageInput } from '../../domain';
import { makeId, nowIso } from '../../domain';

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
      status: normalizeContextWindowStatus(state.status, ratio, state.autoCompactThreshold),
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
      status: normalizeContextWindowStatus(undefined, ratio, autoCompactThreshold),
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
  const failure = firstBlockingResultReason(result);
  return failure ? { status: 'failed', reason: failure } : { status: 'completed' };
}

function firstBlockingResultReason(result: Record<string, unknown>) {
  const units = arrayRecords(result.executionUnits);
  for (const unit of units) {
    const status = String(unit.status || '').trim().toLowerCase();
    if (status === 'repair-needed' || status === 'failed-with-reason' || status === 'failed') {
      return asString(unit.failureReason)
        || asString(unit.message)
        || `${asString(unit.id) || 'execution unit'} status=${status}`;
    }
  }
  const artifacts = arrayRecords(result.artifacts);
  for (const artifact of artifacts) {
    const metadata = isRecord(artifact.metadata) ? artifact.metadata : {};
    const data = isRecord(artifact.data) ? artifact.data : {};
    const status = String(metadata.status || data.status || '').trim().toLowerCase();
    if (status === 'repair-needed' || status === 'failed-with-reason' || status === 'failed') {
      return asString(metadata.failureReason)
        || asString(data.failureReason)
        || `${asString(artifact.id) || asString(artifact.type) || 'artifact'} status=${status}`;
    }
  }
  const message = asString(result.message);
  if (message && /\brepair-needed\b|\bfailed-with-reason\b/i.test(message) && shouldTreatMessageAsBlocking(message, units, artifacts)) {
    return message.slice(0, 240);
  }
  return undefined;
}

function shouldTreatMessageAsBlocking(message: string, units: Record<string, unknown>[], artifacts: Record<string, unknown>[]) {
  if (/^\s*(?:repair-needed|failed-with-reason|failed)\s*$/i.test(message)) return true;
  if (looksLikeBlockingDiagnosticMessage(message)) return true;
  return !hasSuccessfulResultEvidence(units, artifacts);
}

function looksLikeBlockingDiagnosticMessage(message: string) {
  return /^(?:SciForge runtime gateway needs repair|Agent backend .* failed|AgentServer .* failed|No validated local skill|Task output failed|AgentServer .* did not|Generated artifacts did not)/i.test(message)
    || /\b(?:execution unit|artifact|research-report|paper-list)\s+status=(?:repair-needed|failed-with-reason|failed)\b/i.test(message);
}

function hasSuccessfulResultEvidence(units: Record<string, unknown>[], artifacts: Record<string, unknown>[]) {
  const hasCompletedUnit = units.some((unit) => {
    const status = String(unit.status || '').trim().toLowerCase();
    return status === 'done' || status === 'record-only' || status === 'self-healed' || status === 'completed' || status === 'success';
  });
  const hasUsableArtifact = artifacts.some((artifact) => {
    const metadata = isRecord(artifact.metadata) ? artifact.metadata : {};
    const data = isRecord(artifact.data) ? artifact.data : {};
    const status = String(metadata.status || data.status || '').trim().toLowerCase();
    return status !== 'repair-needed'
      && status !== 'failed-with-reason'
      && status !== 'failed'
      && Boolean(asString(artifact.id) || asString(artifact.type));
  });
  return hasCompletedUnit || hasUsableArtifact;
}

function arrayRecords(value: unknown) {
  return Array.isArray(value) ? value.filter(isRecord) : [];
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
  const type = asString(record.type) || asString(record.kind) || 'workspace-runtime-event';
  const source = asString(record.source);
  const toolName = asString(record.toolName);
  const usage = normalizeTokenUsage(record.usage)
    ?? normalizeTokenUsage(isRecord(record.output) ? record.output.usage : undefined)
    ?? normalizeTokenUsage(isRecord(record.result) ? record.result.usage : undefined)
    ?? normalizeTokenUsage(isRecord(record.result) && isRecord(record.result.output) ? record.result.output.usage : undefined);
  const contextWindowState = normalizeContextWindowState(contextWindowCandidate(record), type, record);
  const contextCompaction = normalizeContextCompaction(record.contextCompaction ?? record.compaction ?? record.context_compaction, type, record);
  const workEvidence = normalizeWorkEvidenceRecords(record.workEvidence ?? record.work_evidence);
  const baseDetail = asString(record.detail)
    || asString(record.message)
    || asString(record.text)
    || asString(record.output)
    || asString(record.status)
    || asString(record.error)
    || (Object.keys(record).length ? JSON.stringify(record) : undefined);
  const usageDetail = formatTokenUsage(usage);
  const detail = [baseDetail, usageDetail].filter(Boolean).join(' | ') || undefined;
  return {
    id: makeId('evt'),
    type,
    label: streamEventLabel(type, source, toolName),
    detail,
    usage,
    contextWindowState,
    contextCompaction,
    workEvidence,
    createdAt: nowIso(),
    raw,
  };
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
  const source = explicitSource
    ? (normalizeContextWindowSource(explicitSource) === 'unknown' && hasUsage ? 'provider-usage' : normalizeContextWindowSource(explicitSource))
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
    status: normalizeContextWindowStatus(asString(record.status), ratio, clampRatio(asNumber(record.autoCompactThreshold))),
    compactCapability: normalizeCompactCapability(asString(record.compactCapability) ?? asString(record.compactionCapability)),
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
    status: normalizeCompactionStatus(asString(record.status), {
      ok: asBoolean(record.ok) ?? (isTag ? true : undefined),
      completedAt,
      lastCompactedAt,
      message,
    }),
    source: normalizeContextWindowSource(asString(record.source)),
    backend: asString(record.backend),
    compactCapability: normalizeCompactCapability(asString(record.compactCapability) ?? asString(record.compactionCapability) ?? (isTag ? 'agentserver' : undefined)),
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

function normalizeContextWindowSource(value?: string): NonNullable<AgentStreamEvent['contextWindowState']>['source'] {
  if (value === 'native' || value === 'provider-usage' || value === 'agentserver-estimate' || value === 'agentserver' || value === 'estimate' || value === 'unknown') return value;
  if (value === 'usage' || value === 'provider') return 'provider-usage';
  if (value === 'backend') return 'native';
  if (value === 'handoff') return 'agentserver-estimate';
  return 'unknown';
}

function normalizeCompactCapability(value?: string): NonNullable<AgentStreamEvent['contextWindowState']>['compactCapability'] {
  if (value === 'native' || value === 'agentserver' || value === 'handoff-only' || value === 'handoff-slimming' || value === 'session-rotate' || value === 'none' || value === 'unknown') return value;
  return 'unknown';
}

function compactCapabilityForBackend(backend: string): NonNullable<AgentStreamEvent['contextWindowState']>['compactCapability'] {
  if (backend === 'codex') return 'native';
  if (backend === 'openteam_agent' || backend === 'hermes-agent') return 'agentserver';
  if (backend === 'gemini') return 'session-rotate';
  if (backend === 'claude-code' || backend === 'openclaw') return 'handoff-only';
  return 'unknown';
}

function normalizeContextWindowStatus(
  value: string | undefined,
  ratio: number | undefined,
  autoCompactThreshold: number | undefined,
): NonNullable<AgentStreamEvent['contextWindowState']>['status'] {
  if (ratio !== undefined && ratio >= 1) return 'exceeded';
  if (ratio !== undefined && ratio >= (autoCompactThreshold ?? 0.82) && (!value || value === 'healthy' || value === 'ok' || value === 'normal')) return 'near-limit';
  if (value === 'healthy' || value === 'watch' || value === 'near-limit' || value === 'exceeded' || value === 'compacting' || value === 'blocked' || value === 'unknown') return value;
  if (value && /exceeded|overflow|max|full/i.test(value)) return 'exceeded';
  if (value && /compact/i.test(value)) return 'compacting';
  if (value && /blocked|rate/i.test(value)) return 'blocked';
  if (value && /near|critical|warning/i.test(value)) return 'near-limit';
  if (value && /watch/i.test(value)) return 'watch';
  if (value && /healthy|ok|normal/i.test(value)) return 'healthy';
  if (ratio !== undefined && ratio >= (autoCompactThreshold ?? 0.82)) return 'near-limit';
  if (ratio !== undefined && ratio >= 0.68) return 'watch';
  return ratio === undefined ? 'unknown' : 'healthy';
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

function normalizeCompactionStatus(
  value?: string,
  inferred: { ok?: boolean; completedAt?: string; lastCompactedAt?: string; message?: string } = {},
): NonNullable<AgentStreamEvent['contextCompaction']>['status'] {
  if (value === 'started' || value === 'completed' || value === 'failed' || value === 'pending' || value === 'skipped') return value;
  if (value === 'compacted') return 'completed';
  if (value === 'unsupported') return 'skipped';
  if (value && /fail|error/i.test(value)) return 'failed';
  if (value && /skip|unsupported|handoff/i.test(value)) return 'skipped';
  if (value && /complete|done|success|compact(ed)?|compressed/i.test(value)) return 'completed';
  if (inferred.ok === true || inferred.completedAt || inferred.lastCompactedAt || (inferred.message && /complete|done|success|compact(ed)?|compressed|完成/i.test(inferred.message))) return 'completed';
  if (inferred.ok === false || (inferred.message && /fail|error|失败|未完成/i.test(inferred.message))) return 'failed';
  return 'pending';
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

function streamEventLabel(type: string, source?: string, toolName?: string) {
  if (type === 'contextWindowState') return '上下文窗口';
  if (type === 'contextCompaction') return '上下文压缩';
  if (type === 'run-plan') return '计划';
  if (type === 'stage-start') return '阶段';
  if (type === 'process-progress') return '过程';
  if (type === 'text-delta') return '思考';
  if (type === 'tool-call') return toolName ? `调用 ${toolName}` : '工具调用';
  if (type === 'tool-result') return toolName ? `结果 ${toolName}` : '工具结果';
  if (type === 'status') return source === 'agentserver' ? 'AgentServer 状态' : '运行状态';
  if (type.includes('error')) return '错误';
  if (type.includes('silent')) return '等待';
  return source === 'agentserver' ? 'AgentServer' : 'Workspace Runtime';
}


export function toolEvent(type: string, detail: string): AgentStreamEvent {
  return {
    id: makeId('evt'),
    type,
    label: '项目工具',
    detail,
    createdAt: nowIso(),
    raw: { type, detail },
  };
}
