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
import { isRuntimeAuditOnlyEvent, runtimeAuditOnlyEventSummary, runtimeTextLooksAuditOnly } from '../../runtimeAuditEvents';

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
  if ((response.headers.get('content-type') ?? '').toLowerCase().includes('text/event-stream')) {
    return readWorkspaceToolSse(response, onEvent);
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

async function readWorkspaceToolSse(
  response: Response,
  onEvent: (event: unknown) => void,
): Promise<{ result?: unknown; error?: string }> {
  if (!response.body) return { error: `HTTP ${response.status}` };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: unknown;
  let error: string | undefined;
  let guiPresent: Record<string, unknown> | undefined;
  const genericMessages: string[] = [];
  function consumeBlock(block: string) {
    const lines = block.split(/\r?\n/);
    const eventName = lines
      .map((line) => /^event:\s*(.*)$/.exec(line)?.[1]?.trim())
      .find((value): value is string => Boolean(value)) ?? 'message';
    const dataText = lines
      .map((line) => /^data:\s?(.*)$/.exec(line)?.[1])
      .filter((value): value is string => value !== undefined)
      .join('\n')
      .trim();
    if (!dataText) return;
    let data: unknown = dataText;
    try {
      data = JSON.parse(dataText) as unknown;
    } catch {
      // Keep text-only SSE data as diagnostics.
    }
    if (eventName === 'error' || eventName === 'failed') {
      error = isRecord(data) ? asString(data.error) || asString(data.message) || JSON.stringify(data) : String(data);
      onEvent(data);
      return;
    }
    onEvent(data);
    if (isRecord(data)) {
      if ((eventName === 'message_delta' || data.type === 'message_delta') && asString(data.text)) {
        genericMessages.push(asString(data.text)!);
      }
      if ((eventName === 'message' || data.type === 'message') && asString(data.text)) {
        genericMessages.push(asString(data.text)!);
      }
      if (eventName === 'gui_present' || data.type === 'gui_present') {
        guiPresent = data;
      }
    }
    if (eventName === 'done' || (isRecord(data) && data.type === 'done')) {
      if (guiPresent) {
        result = withGuiPresentRuntimeResult(data, guiPresent);
        return;
      }
      const nativeMessage = genericMessages.join('\n').trim();
      if (isRuntimeCodexDoneEvent(data) && nativeMessage) {
        result = withNativeCodexMessageRuntimeResult(data, nativeMessage);
        return;
      }
      if (!isRuntimeCodexDoneEvent(data)) {
        result = withVisibleRuntimeMessage(data, nativeMessage);
        return;
      }
      const failed = runtimeCodexMissingGuiPresentFailure(data);
      onEvent(failed);
      error = failed.message;
    }
  }
  for (;;) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    while (/\r?\n\r?\n/.test(buffer)) {
      const match = /\r?\n\r?\n/.exec(buffer);
      if (!match) break;
      consumeBlock(buffer.slice(0, match.index));
      buffer = buffer.slice(match.index + match[0].length);
    }
    if (done) break;
  }
  if (buffer.trim()) consumeBlock(buffer);
  return { result, error };
}

function withVisibleRuntimeMessage(result: unknown, message: string): unknown {
  if (!message.trim() || !isRecord(result)) return result;
  const output = isRecord(result.output) ? result.output : {};
  return {
    ...result,
    message,
    output: {
      ...output,
      message,
    },
  };
}

function withGuiPresentRuntimeResult(result: unknown, guiPresent: Record<string, unknown>): unknown {
  if (!isRecord(result)) return result;
  const presentation = guiPresentationFromEvent(guiPresent, result);
  if (!presentation.text.trim()) return result;
  const output = isRecord(result.output) ? result.output : {};
  const commandId = asString(result.commandId) ?? asString(guiPresent.commandId);
  const auditRefs = asStringArray(result.evidenceRefs) ?? asStringArray(guiPresent.evidenceRefs) ?? [];
  return {
    ...result,
    message: presentation.text,
    guiPresentation: presentation,
    displayIntent: {
      source: presentation.source,
      conversationProjection: {
        schemaVersion: 'sciforge.conversation-projection.v1',
        conversationId: commandId ? `runtime-codex:${commandId}` : 'runtime-codex:gui-present',
        visibleAnswer: {
          status: 'satisfied',
          text: presentation.text,
          artifactRefs: presentation.ref ? [presentation.ref] : [],
        },
        artifacts: presentation.ref ? [{
          ref: presentation.ref,
          label: presentation.title ?? presentation.ref,
          mime: presentation.hint ?? 'markdown',
        }] : [],
        executionProcess: [{
          eventId: `${commandId ?? 'runtime-codex'}:gui-present`,
          type: 'GuiPresent',
          summary: `Runtime Codex rendered completion through ${presentation.source}.`,
          timestamp: asString(result.timestamp) ?? new Date().toISOString(),
        }],
        recoverActions: [],
        verificationState: { status: 'pass', verifierRef: presentation.source },
        auditRefs,
        diagnostics: [],
      },
    },
    output: {
      ...output,
      message: presentation.text,
      guiPresentation: presentation,
    },
  };
}

function withNativeCodexMessageRuntimeResult(result: unknown, message: string): unknown {
  if (!message.trim() || !isRecord(result)) return result;
  const output = isRecord(result.output) ? result.output : {};
  const commandId = asString(result.commandId);
  const auditRefs = asStringArray(result.evidenceRefs) ?? [];
  return {
    ...result,
    message,
    nativeCodexMessage: {
      schemaVersion: 'sciforge.runtime-codex-native-message.v1',
      source: commandId ? `codex.native-message:${commandId}` : 'codex.native-message',
      text: message,
      commandId,
      attemptId: asString(result.attemptId),
      provider: asString(result.provider),
      model: asString(result.model),
      profile: asString(result.profile),
      workspace: asString(result.workspace),
      codexSessionId: asString(result.codexSessionId),
      liveAcceptanceEligible: false,
    },
    displayIntent: {
      source: commandId ? `codex.native-message:${commandId}` : 'codex.native-message',
      conversationProjection: {
        schemaVersion: 'sciforge.conversation-projection.v1',
        conversationId: commandId ? `runtime-codex:${commandId}` : 'runtime-codex:native-message',
        visibleAnswer: {
          status: 'visible-not-live-acceptance',
          text: message,
          artifactRefs: [],
          liveAcceptanceEligible: false,
        },
        artifacts: [],
        executionProcess: [{
          eventId: `${commandId ?? 'runtime-codex'}:native-message`,
          type: 'NativeCodexMessage',
          summary: 'Runtime Codex completed with a native assistant message; tool process and raw diagnostics stay in the folded run audit.',
          timestamp: asString(result.timestamp) ?? new Date().toISOString(),
        }],
        recoverActions: [
          'Use gui.present on rerun only when the task needs a structured artifact projection beyond the native Codex assistant answer.',
        ],
        verificationState: {
          status: 'unverified',
          verdict: 'native-message',
          verifierRef: commandId ? `codex.native-message:${commandId}` : 'codex.native-message',
          liveAcceptanceEligible: false,
        },
        auditRefs,
        diagnostics: [],
      },
    },
    output: {
      ...output,
      message,
      nativeCodexMessage: true,
    },
  };
}

function guiPresentationFromEvent(event: Record<string, unknown>, result: Record<string, unknown>) {
  const raw = isRecord(event.raw) ? event.raw : {};
  const nested = isRecord(raw.presentation) ? raw.presentation : {};
  const text = asString(event.text)
    ?? asString(event.message)
    ?? asString(nested.text)
    ?? asString(result.message)
    ?? '';
  const commandId = asString(event.commandId) ?? asString(result.commandId);
  return {
    schemaVersion: 'sciforge.runtime-codex-gui-present.v1',
    source: asString(nested.source) ?? asString(raw.source) ?? (commandId ? `gui.present:${commandId}` : 'gui.present'),
    text,
    ref: asString(nested.ref),
    title: asString(nested.title),
    intent: asString(nested.intent),
    hint: asString(nested.hint),
    placement: isRecord(nested.placement) ? nested.placement : undefined,
    commandId,
    attemptId: asString(event.attemptId) ?? asString(result.attemptId),
    provider: asString(event.provider) ?? asString(result.provider),
    model: asString(event.model) ?? asString(result.model),
    profile: asString(event.profile) ?? asString(result.profile),
    workspace: asString(event.workspace) ?? asString(result.workspace),
  };
}

function runtimeCodexMissingGuiPresentFailure(result: unknown): { type: 'failed'; status: 'failed'; message: string; raw: Record<string, unknown> } {
  const record = isRecord(result) ? result : {};
  return {
    type: 'failed',
    status: 'failed',
    message: 'Runtime Codex completed without gui.present; SciForge failed closed instead of rendering raw provider text.',
    raw: {
      boundary: 'gui-present-required',
      exitCode: asNumber(record.exitCode) ?? 0,
      provider: asString(record.provider),
      model: asString(record.model),
      profile: asString(record.profile),
      workspace: asString(record.workspace),
      commandId: asString(record.commandId),
      attemptId: asString(record.attemptId),
      codexSessionId: asString(record.codexSessionId),
      evidenceRefs: asStringArray(record.evidenceRefs),
    },
  };
}

function isRuntimeCodexDoneEvent(value: unknown) {
  if (!isRecord(value)) return false;
  return isRuntimeCodexEventRecord(value);
}

function isRuntimeCodexEventRecord(value: Record<string, unknown>) {
  return value.schemaVersion === 'sciforge.codex.normalized-event.v1'
    || Boolean(asString(value.commandId)?.startsWith('codex-command-'))
    || asString(value.profile) === 'sciforge-runtime-deepseek'
    || /Runtime Codex/i.test(asString(value.message) ?? '');
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
  const auditOnlyDetail = isRuntimeAuditOnlyEvent(record) ? runtimeAuditOnlyEventSummary(record) : undefined;
  const providerMessageDetail = runtimeCodexProviderMessageSummary(record);
  const baseDetail = auditOnlyDetail
    || providerMessageDetail
    || interactionProgress?.detail
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

function runtimeCodexProviderMessageSummary(record: Record<string, unknown>) {
  const type = asString(record.type)?.toLowerCase();
  if (type !== 'message' && type !== 'message_delta') return undefined;
  if (!isRuntimeCodexEventRecord(record)) return undefined;
  return 'Runtime Codex native assistant message recorded; the final assistant answer can render as the primary reply, while raw JSONL, stderr, and plugin diagnostics stay folded in the run audit.';
}

function rawEventDetailFallback(record: Record<string, unknown>) {
  if (isRuntimeAuditOnlyEvent(record)) return runtimeAuditOnlyEventSummary(record);
  if (!Object.keys(record).length) return undefined;
  const rawShaped = ['payload', 'raw', 'stdout', 'stderr', 'jsonl', 'rawJsonl', 'stdoutRef', 'stderrRef', 'rawRef', 'runtimeEventsRef'].some((key) => key in record);
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
    || runtimeTextLooksAuditOnly(value)
    || /\b(?:stdout|stderr|jsonl|rawJsonl|stdoutRef|stderrRef|rawRef|runtimeEventsRef)\b/i.test(value)
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
