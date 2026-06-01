import { buildContextWindowMeterModel } from './contextWindow';
import {
  CONTEXT_COMPACTION_EVENT_TYPE,
  CONTEXT_WINDOW_STATE_EVENT_TYPE,
  OUTPUT_EVENT_TYPE,
  PROCESS_PROGRESS_EVENT_TYPE,
  RUN_PLAN_EVENT_TYPE,
  STAGE_START_EVENT_TYPE,
  TEXT_DELTA_EVENT_TYPE,
  TOOL_CALL_EVENT_TYPE,
  TOOL_RESULT_EVENT_TYPE,
  USAGE_UPDATE_EVENT_TYPE,
  runtimeStreamCompletionDetailIsKey,
  runtimeStreamEventTypeIsCompletion,
  runtimeStreamEventTypeIsKeyWorkStatus,
  runtimeTextLooksLikeGeneratedWorkDetail,
  runtimeToolEventActionKind,
  runtimeToolOutputLooksLikeFailure,
  runtimeInteractionProgressEventFromUnknown,
  runtimeInteractionProgressPresentation,
  summarizeRuntimeGeneratedTaskFiles,
} from '@sciforge-ui/runtime-contract';
import { runtimeInteractionProgressEventFromCompactRecord } from '@sciforge-ui/runtime-contract/events';
import type { RuntimeInteractionProgressEvent } from '@sciforge-ui/runtime-contract';
import type { AgentStreamEvent } from './domain';
import { joinAssistantTextFragments } from './assistantText';
import { isRuntimeAuditOnlyEvent, runtimeAuditOnlyEventSummary, runtimeTextLooksAuditOnly } from './runtimeAuditEvents';
import { sanitizeRuntimeDebugValue } from './runtimeDebugScrubber';
import {
  classifyWorkEvent,
  emptyWorkEventCounts,
  formatRawWorkEventOutput,
  structuredWorkEventSummary,
  summarizeWorkEvent,
  summarizeWorklog,
  type StructuredWorkEventSummary,
  type WorkEventKind,
} from './workEventAtoms';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export type StreamEventImportance = 'key' | 'background' | 'debug';
export type StreamEventTone = 'info' | 'warning' | 'danger' | 'success' | 'muted';
export type StreamWorklogOperationKind = WorkEventKind;
export type BackendPresentationProfileId = 'sciforge-default' | 'codex-cli-like' | 'claude-code-like' | 'cursor-agent-like';

export interface StreamEventPresentationOptions {
  profile?: BackendPresentationProfileId;
}

export interface StreamEventPresentation {
  typeLabel: string;
  detail: string;
  shortDetail: string;
  usageDetail: string;
  importance: StreamEventImportance;
  tone: StreamEventTone;
  uiClass: string;
  initiallyCollapsed: boolean;
  visibleInRunningMessage: boolean;
}

export interface StreamWorklogEntry {
  event: AgentStreamEvent;
  presentation: StreamEventPresentation;
  operationKind: StreamWorklogOperationKind;
  operationLine: string;
  rawOutput: string;
  rawInitiallyCollapsed: boolean;
  structured?: StructuredWorkEventSummary;
}

export interface StreamWorklogPresentation {
  summary: string;
  entries: StreamWorklogEntry[];
  operationCounts: Record<StreamWorklogOperationKind, number> & { total: number };
  counts: ReturnType<typeof streamEventCounts>;
  initiallyCollapsed: boolean;
}

export const DEFAULT_LIVE_STREAM_EVENT_LIMIT = 160;

const LIVE_STREAM_DETAIL_LIMIT = 2_400;
const LIVE_STREAM_TEXT_DELTA_LIMIT = 1_600;
const LIVE_STREAM_RAW_STRING_LIMIT = 1_200;
const LIVE_STREAM_RAW_ARRAY_LIMIT = 24;
const LIVE_STREAM_RAW_KEY_LIMIT = 32;
const LIVE_STREAM_TOTAL_JSON_LIMIT = 120_000;

export function appendLiveStreamEvent(
  events: AgentStreamEvent[],
  next: AgentStreamEvent,
  options: { limit?: number; totalJsonLimit?: number } = {},
): AgentStreamEvent[] {
  return boundLiveStreamEvents(
    coalesceStreamEvents(events, sanitizeStreamEventForLiveState(next)),
    options,
  );
}

export function boundLiveStreamEvents(
  events: AgentStreamEvent[],
  options: { limit?: number; totalJsonLimit?: number } = {},
): AgentStreamEvent[] {
  const limit = options.limit ?? DEFAULT_LIVE_STREAM_EVENT_LIMIT;
  const totalJsonLimit = options.totalJsonLimit ?? LIVE_STREAM_TOTAL_JSON_LIMIT;
  let bounded = events
    .slice(-limit)
    .map(sanitizeStreamEventForLiveState);
  while (bounded.length > 12 && serializedLength(bounded) > totalJsonLimit) {
    bounded = bounded.slice(Math.max(1, Math.floor(bounded.length / 4)));
  }
  return bounded;
}

export function sanitizeStreamEventForLiveState(event: AgentStreamEvent): AgentStreamEvent {
  return {
    ...event,
    label: sanitizeLiveText(event.label, 220) || event.type,
    detail: sanitizeStreamEventDetail(event),
    usage: event.usage ? {
      input: event.usage.input,
      output: event.usage.output,
      total: event.usage.total,
      cacheRead: event.usage.cacheRead,
      cacheWrite: event.usage.cacheWrite,
      source: sanitizeLiveText(event.usage.source, 80),
    } : undefined,
    contextWindowState: event.contextWindowState ? {
      ...event.contextWindowState,
      backend: sanitizeLiveText(event.contextWindowState.backend, 80),
      provider: undefined,
      model: undefined,
      auditRefs: sanitizeLiveStringList(event.contextWindowState.auditRefs, 12),
    } : undefined,
    contextCompaction: event.contextCompaction ? {
      ...event.contextCompaction,
      backend: sanitizeLiveText(event.contextCompaction.backend, 80),
      auditRefs: sanitizeLiveStringList(event.contextCompaction.auditRefs, 12),
      message: sanitizeLiveText(event.contextCompaction.message, 500),
      reason: sanitizeLiveText(event.contextCompaction.reason, 260),
    } : undefined,
    workEvidence: sanitizeLiveWorkEvidence(event.workEvidence),
    raw: sanitizeLiveRawValue(event.raw),
  };
}

export function presentStreamEvent(event: AgentStreamEvent, options: StreamEventPresentationOptions = {}): StreamEventPresentation {
  const profile = resolveBackendPresentationProfile(event, options.profile);
  const detail = readableStreamEventDetail(event);
  const usageDetail = formatAgentTokenUsage(event.usage);
  const importance = streamEventImportance(event, detail, profile);
  const typeLabel = streamEventTypeLabel(event.type, event, detail, profile);
  const tone = streamEventTone(event.type, importance, event);
  return {
    typeLabel,
    detail,
    shortDetail: shortStreamEventDetail(detail || usageDetail || event.label || typeLabel),
    usageDetail,
    importance,
    tone,
    uiClass: streamEventUiClass(event.type, importance),
    initiallyCollapsed: streamEventInitiallyCollapsed(event, importance, profile),
    visibleInRunningMessage: streamEventVisibleInRunningMessage(event, importance, detail, usageDetail, profile),
  };
}

export function presentStreamWorklog(
  events: AgentStreamEvent[],
  options: {
    limit?: number;
    guidanceCount?: number;
    counts?: ReturnType<typeof streamEventCounts>;
    profile?: BackendPresentationProfileId;
  } = {},
): StreamWorklogPresentation {
  const counts = options.counts ?? streamEventCounts(events, { profile: options.profile });
  const operationCounts = worklogOperationCounts(events, options.profile);
  const entries = latestWorklogEntries(events, options.limit ?? 48, options.profile);
  return {
    summary: summarizeStructuredWorklog(entries) || summarizeWorklog(operationCounts, counts, options.guidanceCount ?? 0),
    entries,
    operationCounts,
    counts,
    initiallyCollapsed: true,
  };
}

export function latestWorklogEntries(events: AgentStreamEvent[], limit: number, profile?: BackendPresentationProfileId): StreamWorklogEntry[] {
  const seen = new Set<string>();
  return events
    .map((event) => worklogEntryForEvent(event, { profile }))
    .filter((entry) => {
      const progressKey = isRecord(entry.event.raw) && isRecord(entry.event.raw.progress)
        ? [entry.event.raw.progress.phase, entry.event.raw.progress.title, entry.event.raw.progress.detail].join(':')
        : '';
      if (!entry.presentation.detail && !entry.presentation.usageDetail && !progressKey) return false;
      if (entry.presentation.importance === 'debug') return false;
      const key = `${entry.event.type}:${entry.operationKind}:${entry.presentation.shortDetail}:${progressKey}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(-limit);
}

export function worklogEntryForEvent(event: AgentStreamEvent, options: StreamEventPresentationOptions = {}): StreamWorklogEntry {
  const presentation = presentStreamEvent(event, options);
  const structured = structuredWorkEventSummary(event);
  const interactionProgress = interactionProgressSummary(event);
  const operationKind = interactionProgress?.operationKind ?? classifyWorkEvent(event, presentation.detail, presentation.shortDetail);
  const detail = interactionProgress?.detail || structured?.detail || presentation.shortDetail || presentation.detail || presentation.usageDetail;
  return {
    event,
    presentation,
    operationKind,
    operationLine: summarizeWorkEvent(operationKind, detail),
    rawOutput: formatRawWorkEventOutput(event),
    rawInitiallyCollapsed: true,
    structured,
  };
}

export function latestRunningEvent(events: AgentStreamEvent[], options: StreamEventPresentationOptions = {}) {
  const latestKey = [...events].reverse().find((event) => presentStreamEvent(event, options).visibleInRunningMessage);
  if (latestKey) return presentStreamEvent(latestKey, options).detail || presentStreamEvent(latestKey, options).usageDetail;
  const latestBackground = [...events].reverse().find((event) => {
    const presentation = presentStreamEvent(event, options);
    return presentation.importance !== 'debug' && readableStreamEventDetail(event);
  });
  return latestBackground ? 'Working in the background. Activity is folded below.' : undefined;
}

export function streamEventCounts(events: AgentStreamEvent[], options: StreamEventPresentationOptions = {}) {
  return events.reduce(
    (counts, event) => {
      const presentation = presentStreamEvent(event, options);
      counts.total += 1;
      counts[presentation.importance] += 1;
      return counts;
    },
    { total: 0, key: 0, background: 0, debug: 0 },
  );
}

function worklogOperationCounts(events: AgentStreamEvent[], profile?: BackendPresentationProfileId) {
  return events.reduce(
    (memo, event) => {
      const presentation = presentStreamEvent(event, { profile });
      const kind = interactionProgressSummary(event)?.operationKind ?? classifyWorkEvent(event, presentation.detail, presentation.shortDetail);
      memo.total += 1;
      memo[kind] += 1;
      return memo;
    },
    emptyWorkEventCounts(),
  );
}

function summarizeStructuredWorklog(entries: StreamWorklogEntry[]) {
  const latestProject = [...entries].reverse().find((entry) => entry.structured?.project)?.structured?.project;
  const latestStage = [...entries].reverse().find((entry) => entry.structured?.stage)?.structured?.stage;
  if (!latestProject && !latestStage) return '';
  const project = latestProject
    ? `Project ${latestProject.title || latestProject.id || 'project'}${latestProject.status ? ` · ${latestProject.status}` : ''}${latestProject.progress ? ` · ${latestProject.progress}` : ''}`
    : '';
  const stage = latestStage
    ? `Stage ${latestStage.index !== undefined ? `${latestStage.index + 1} ` : ''}${latestStage.title || latestStage.kind || latestStage.id || 'stage'}${latestStage.status ? ` · ${latestStage.status}` : ''}`
    : '';
  return [project, stage].filter(Boolean).join(' · ');
}

export function formatAgentTokenUsage(usage: AgentStreamEvent['usage'] | undefined) {
  if (!usage) return '';
  const parts = [
    usage.input !== undefined ? `in ${usage.input}` : '',
    usage.output !== undefined ? `out ${usage.output}` : '',
    usage.total !== undefined ? `total ${usage.total}` : '',
    usage.cacheRead !== undefined ? `cache read ${usage.cacheRead}` : '',
    usage.cacheWrite !== undefined ? `cache write ${usage.cacheWrite}` : '',
  ].filter(Boolean);
  const suffix = usage.source ? usage.source : '';
  return `tokens ${parts.join(', ')}${suffix ? ` (${suffix})` : ''}`;
}

export function coalesceStreamEvents(events: AgentStreamEvent[], next: AgentStreamEvent) {
  if (next.type !== TEXT_DELTA_EVENT_TYPE) return [...events, next];
  const detail = truncateMiddle(normalizeStreamTextDelta(next.detail).trim(), LIVE_STREAM_TEXT_DELTA_LIMIT);
  if (!detail) return events;
  const last = events.at(-1);
  if (!last || last.type !== TEXT_DELTA_EVENT_TYPE) return [...events, { ...next, detail }];
  if (isScriptOrArtifactGenerationDetail(last.detail || '') || isScriptOrArtifactGenerationDetail(detail)) {
    return [...events, { ...next, detail }];
  }
  const mergedDetail = mergeTextDeltaDetail(last.detail || '', detail);
  return [
    ...events.slice(0, -1),
    {
      ...next,
      id: last.id,
      label: last.label || next.label,
      detail: mergedDetail.length > 1200 ? `${mergedDetail.slice(-1200).replace(/^\S+\s+/, '')}` : mergedDetail,
      raw: {
        type: TEXT_DELTA_EVENT_TYPE,
        coalesced: true,
        latest: next.raw ?? { detail },
      },
    },
  ];
}

function sanitizeStreamEventDetail(event: AgentStreamEvent) {
  if (event.detail === undefined) return undefined;
  if (event.type === TEXT_DELTA_EVENT_TYPE || event.type === OUTPUT_EVENT_TYPE || event.type === 'message_delta' || event.type === 'assistant_delta') {
    const detail = normalizeStreamTextDelta(event.detail).trim();
    if (runtimeTextLooksAuditOnly(detail) || looksLikeRawRuntimePayloadText(detail)) return runtimeAuditOnlyEventSummary(event);
    return truncateMiddle(detail, LIVE_STREAM_TEXT_DELTA_LIMIT);
  }
  if (isRawRuntimeAuditEvent(event) || runtimeTextLooksAuditOnly(event.detail) || looksLikeRawRuntimePayloadText(event.detail)) {
    return runtimeAuditOnlyEventSummary(event);
  }
  return sanitizeLiveText(event.detail, LIVE_STREAM_DETAIL_LIMIT);
}

function sanitizeLiveWorkEvidence(value: AgentStreamEvent['workEvidence']): AgentStreamEvent['workEvidence'] {
  if (!Array.isArray(value)) return undefined;
  const records = value
    .slice(-LIVE_STREAM_RAW_ARRAY_LIMIT)
    .map((record) => sanitizeLiveRawValue(record))
    .filter(isRecord);
  return records.length ? records : undefined;
}

function sanitizeLiveRawValue(value: unknown, depth = 0): unknown {
  if (value === undefined || value === null) return value;
  const sanitized = sanitizeRuntimeDebugValue(value);
  return boundSanitizedRuntimeValue(sanitized, depth);
}

function boundSanitizedRuntimeValue(value: unknown, depth = 0): unknown {
  if (value === undefined || value === null) return value;
  if (typeof value === 'string') {
    if (looksLikeRawRuntimePayloadText(value)) return textDigest('runtime-debug-sensitive-body', value);
    return sanitizeLiveText(value, LIVE_STREAM_RAW_STRING_LIMIT);
  }
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    const entries = value.slice(-LIVE_STREAM_RAW_ARRAY_LIMIT).map((entry) => boundSanitizedRuntimeValue(entry, depth + 1));
    return value.length > LIVE_STREAM_RAW_ARRAY_LIMIT
      ? [{ omitted: 'earlier-runtime-items', count: value.length - LIVE_STREAM_RAW_ARRAY_LIMIT }, ...entries]
      : entries;
  }
  if (depth > 5) {
    return {
      omitted: 'runtime-debug-max-depth',
      keys: Object.keys(value as Record<string, unknown>).slice(0, 16),
    };
  }
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>).slice(0, LIVE_STREAM_RAW_KEY_LIMIT)) {
    const next = boundSanitizedRuntimeValue(entry, depth + 1);
    if (next !== undefined) out[key] = next;
  }
  const omittedKeyCount = Object.keys(value as Record<string, unknown>).length - Object.keys(out).length;
  if (omittedKeyCount > 0) out.__omittedKeyCount = omittedKeyCount;
  return out;
}

function sanitizeLiveStringList(value: string[] | undefined, limit: number) {
  if (!Array.isArray(value)) return undefined;
  const entries = value
    .map((entry) => sanitizeLiveText(entry, 200))
    .filter((entry): entry is string => Boolean(entry))
    .slice(0, limit);
  return entries.length ? entries : undefined;
}

function sanitizeLiveText(value: string | undefined, limit: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{6,}/gi, 'Bearer [redacted]')
    .replace(/\b(?:ghp|gho|ghu|ghs|ghr|github_pat|sk|rk|pk|pat|token)[_-][A-Za-z0-9_-]{12,}\b/gi, '[redacted]')
    .replace(
      /\b(api[-_]?key|apiKey|access[-_]?token|auth[-_]?token|token|secret|password|credential|authorization)\b(\s*[:=]\s*["']?)([^"',\s);}\]]+)/gi,
      (_match, label: string, separator: string) => `${label}${separator}[redacted]`,
    )
    .replace(/https?:\/\/[^\s"'<>\\)]+/gi, '[redacted-url]')
    .replace(/\/(?:Applications|Users|home|private|var|tmp|Volumes)\/[^\s"'<>\\)]+/gi, '[redacted-path]')
    .replace(/\b[A-Za-z]:\\Users\\[^\s"'<>]+/gi, '[redacted-path]')
    .replace(/\b[A-Za-z0-9+/]{240,}={0,2}\b/g, '[redacted-long-token]')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
  if (!text) return undefined;
  return truncateMiddle(text, limit);
}

function looksLikeRawRuntimePayloadText(value: string | undefined) {
  const text = value?.trim();
  if (!text) return false;
  return /<!doctype\s+html|<html\b|<body\b|<script\b|cf-ray|cloudflare/i.test(text)
    || /\bRAW_[A-Z0-9_]+\b/.test(text)
    || /\b(?:stdoutRef|stderrRef|rawRef|runtimeEventsRef|raw_jsonl|provider_sse|providerRawOutput|rawOutput)\b/i.test(text)
    || /\b(?:Invalid token|Unauthorized|Forbidden)\b/i.test(text)
    || ((text.startsWith('{') || text.startsWith('[')) && /"?(?:raw|stdout|stderr|provider|payload|body|html|authorization|token|secret|password)"?\s*:/.test(text));
}

function textDigest(kind: string, value: string) {
  return {
    omitted: kind,
    chars: value.length,
    hash: stableTextHash(value),
  };
}

function stableTextHash(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function truncateMiddle(value: string, limit: number) {
  if (value.length <= limit) return value;
  const headLength = Math.max(0, Math.floor(limit * 0.7));
  const tailLength = Math.max(0, limit - headLength - 24);
  const head = value.slice(0, headLength).replace(/\s+\S*$/, '');
  const tail = value.slice(-tailLength);
  return `${head}\n...\n${tail}`;
}

function serializedLength(value: unknown) {
  try {
    return JSON.stringify(value).length;
  } catch {
    return LIVE_STREAM_TOTAL_JSON_LIMIT + 1;
  }
}

export function assistantDraftFromStreamEvents(events: AgentStreamEvent[]) {
  let draft = '';
  for (const event of events) {
    const delta = assistantDraftDeltaFromStreamEvent(event);
    if (!delta) continue;
    draft = mergeTextDeltaDetail(draft, delta);
    if (draft.length > 6_000) draft = draft.slice(-6_000).replace(/^\S+\s+/, '');
  }
  return draft;
}

export function assistantDraftDeltaFromStreamEvent(event: AgentStreamEvent) {
  const type = event.type.toLowerCase();
  if (type !== TEXT_DELTA_EVENT_TYPE && type !== OUTPUT_EVENT_TYPE && type !== 'message_delta' && type !== 'assistant_delta') return '';
  const detail = readableStreamEventDetail(event) || assistantDeltaTextFromRaw(event);
  if (!detail || isScriptOrArtifactGenerationDetail(detail) || looksLikeTransportJson(detail)) return '';
  return detail;
}

function assistantDeltaTextFromRaw(event: AgentStreamEvent) {
  const raw = isRecord(event.raw) ? event.raw : {};
  const native = isRecord(raw.native) ? raw.native : raw;
  const nestedRaw = isRecord(raw.raw) ? raw.raw : {};
  const nestedEvent = isRecord(nestedRaw.event) ? nestedRaw.event : {};
  return stringField(native.text)
    ?? stringField(native.delta)
    ?? stringField(native.message)
    ?? stringField(raw.text)
    ?? stringField(raw.delta)
    ?? stringField(raw.message)
    ?? stringField(nestedEvent.text)
    ?? stringField(nestedEvent.delta)
    ?? stringField(nestedEvent.message)
    ?? '';
}

export function readableStreamEventDetail(event: AgentStreamEvent) {
  const runningChatAuditDetail = readableRunningChatAuditDetail(event);
  if (runningChatAuditDetail !== undefined) return runningChatAuditDetail;
  if (isRawRuntimeAuditEvent(event)) return runtimeAuditOnlyEventSummary(event);
  if (event.contextWindowState) {
    const state = event.contextWindowState;
    const meter = buildContextWindowMeterModel(state, false);
    return `Context ${meter.ratioLabel} used. ${meter.compactLine}. Last compacted ${state.lastCompactedAt || 'never'}.`;
  }
  if (event.contextCompaction) {
    const compaction = event.contextCompaction;
    return [compaction.status, compaction.message || compaction.reason, compaction.lastCompactedAt ? `last ${compaction.lastCompactedAt}` : '']
      .filter(Boolean)
      .join(' · ');
  }
  const interactionProgressDetail = interactionProgressSummary(event)?.detail;
  if (interactionProgressDetail) return interactionProgressDetail;
  const structuredDetail = structuredWorkEventSummary(event)?.detail;
  if (structuredDetail) return structuredDetail;
  const rawDetail = detailFromRawToolEvent(event);
  if (rawDetail) return rawDetail;
  const progressDetail = detailFromRawProgressEvent(event);
  if (progressDetail) return progressDetail;
  if (!event.detail) return '';
  const detail = event.type === TEXT_DELTA_EVENT_TYPE
    ? normalizeStreamTextDelta(event.detail)
    : tidyReadableText(event.detail);
  const usageDetail = formatAgentTokenUsage(event.usage);
  return usageDetail ? detail.replace(` | ${usageDetail}`, '').replace(usageDetail, '').trim() : detail;
}

function streamEventImportance(event: AgentStreamEvent, detail: string, profile: BackendPresentationProfileId = 'sciforge-default'): StreamEventImportance {
  const type = event.type.toLowerCase();
  const interactionProgress = interactionProgressSummary(event);
  const runningChatAuditImportance = streamImportanceForRunningChatAudit(event);
  if (runningChatAuditImportance) return runningChatAuditImportance;
  const profileImportance = streamImportanceForBackendProfile(event, profile);
  if (profileImportance) return profileImportance;
  if (isRawRuntimeAuditEvent(event)) return 'debug';
  if (interactionProgress) return interactionProgress.importance;
  const structured = structuredWorkEventSummary(event);
  if (structured) return 'key';
  if (type.includes('error') || type.includes('failed') || type.includes('interrupt') || type.includes('permission')) {
    return 'key';
  }
  if (event.contextCompaction) return 'key';
  if (event.contextWindowState) {
    const state = event.contextWindowState;
    const ratio = state.ratio ?? (state.usedTokens !== undefined && state.windowTokens ? state.usedTokens / state.windowTokens : undefined);
    if (state.pendingCompact || state.status === 'compacting' || state.status === 'blocked' || state.status === 'exceeded' || state.status === 'near-limit') {
      return 'key';
    }
    return ratio !== undefined && ratio >= (state.watchThreshold ?? 0.7) ? 'key' : 'background';
  }
  if (type === TEXT_DELTA_EVENT_TYPE) {
    return isScriptOrArtifactGenerationDetail(detail) ? 'key' : 'background';
  }
  if (type === USAGE_UPDATE_EVENT_TYPE) return 'background';
  if (type === PROCESS_PROGRESS_EVENT_TYPE) return 'key';
  if (runtimeStreamEventTypeIsKeyWorkStatus(type)) return 'key';
  if (runtimeStreamEventTypeIsCompletion(type)) {
    return runtimeStreamCompletionDetailIsKey(detail) ? 'key' : 'background';
  }
  return detail.length > 400 ? 'background' : 'key';
}

function readableRunningChatAuditDetail(event: AgentStreamEvent): string | undefined {
  const type = event.type.toLowerCase();
  if (type === CONTEXT_WINDOW_STATE_EVENT_TYPE.toLowerCase() && event.contextWindowState) {
    const state = event.contextWindowState;
    if (state.pendingCompact || state.status === 'compacting') return 'Context is near the limit; preparing compaction.';
    if (state.status === 'blocked' || state.status === 'exceeded') return 'Context is near the limit; compact or recover before continuing.';
    if (state.status === 'near-limit') return 'Context is near the limit; key context will be preserved first.';
    return '';
  }
  if (isRunningChatInternalEvent(event)) return '';
  return undefined;
}

function streamImportanceForRunningChatAudit(event: AgentStreamEvent): StreamEventImportance | undefined {
  const type = event.type.toLowerCase();
  if (type === CONTEXT_WINDOW_STATE_EVENT_TYPE.toLowerCase() && event.contextWindowState) {
    const state = event.contextWindowState;
    return state.pendingCompact
      || state.status === 'compacting'
      || state.status === 'blocked'
      || state.status === 'exceeded'
      || state.status === 'near-limit'
      ? 'key'
      : 'debug';
  }
  if (isRunningChatInternalEvent(event)) return 'debug';
  return undefined;
}

function isRunningChatInternalEvent(event: AgentStreamEvent) {
  const type = event.type.toLowerCase();
  if (new Set(['current-plan', 'project-tool-start', 'project-tool-done', 'codex-runtime-run']).has(type)) return true;
  const raw = isRecord(event.raw) ? event.raw : {};
  const detailText = [event.label, event.detail, raw.message, raw.detail]
    .map((item) => typeof item === 'string' ? item.toLowerCase() : '')
    .join(' ');
  if (/runtime codex native assistant message recorded|raw jsonl|folded in the run audit/.test(detailText)) return true;
  if (/sending this request to the workspace agent|first workspace agent event|已收到请求/.test(detailText)) return true;
  const role = [event.label, raw.presentationRole, raw.role, raw.displayRole]
    .map((item) => typeof item === 'string' ? item.toLowerCase() : '')
    .join(' ');
  if (/\b(?:audit|debug)\b/.test(role)) return true;
  if (type === 'status') {
    return /\b(?:agentserver|runtime codex|local model|calling local model|codex runtime)\b/.test(detailText);
  }
  return false;
}

function streamEventTypeLabel(type: string, event?: AgentStreamEvent, detail = '', profile: BackendPresentationProfileId = 'sciforge-default') {
  const profileLabel = event ? streamEventTypeLabelForBackendProfile(type, event, profile) : undefined;
  if (profileLabel) return profileLabel;
  const interactionProgress = event ? interactionProgressSummary(event) : undefined;
  if (interactionProgress) return interactionProgress.typeLabel;
  const structured = event ? structuredWorkEventSummary(event) : undefined;
  if (structured?.stage) return 'Stage';
  if (structured?.project) return 'Project';
  if (type === CONTEXT_WINDOW_STATE_EVENT_TYPE) return 'Context';
  if (type === CONTEXT_COMPACTION_EVENT_TYPE) return 'Context';
  if (type === TEXT_DELTA_EVENT_TYPE) return isScriptOrArtifactGenerationDetail(detail) ? 'Writing' : 'Assistant';
  if (type === TOOL_CALL_EVENT_TYPE) return toolEventActionLabel(event, detail, 'Tool');
  if (type === TOOL_RESULT_EVENT_TYPE) return toolEventActionLabel(event, detail, 'Result');
  if (type === RUN_PLAN_EVENT_TYPE) return 'Plan';
  if (type === STAGE_START_EVENT_TYPE) return 'Step started';
  if (type === USAGE_UPDATE_EVENT_TYPE) return 'Context';
  if (type === PROCESS_PROGRESS_EVENT_TYPE) return 'Activity';
  if (type === 'codex-runtime-run') return 'Codex Runtime';
  return type;
}

export function resolveBackendPresentationProfile(
  event: AgentStreamEvent | undefined,
  explicit?: BackendPresentationProfileId,
): BackendPresentationProfileId {
  if (explicit) return explicit;
  const raw = isRecord(event?.raw) ? event.raw : undefined;
  const backend = stringField(raw?.backend)
    ?? (isRecord(raw?.event) ? stringField(raw.event.backend) : undefined)
    ?? (isRecord(raw?.raw) ? stringField(raw.raw.backend) : undefined);
  if (backend === 'codex-app-server') return 'cursor-agent-like';
  if (backend === 'codex-exec-json') return 'codex-cli-like';
  if (backend === 'claude-stream-json') return 'claude-code-like';
  return 'sciforge-default';
}

function streamImportanceForBackendProfile(
  event: AgentStreamEvent,
  profile: BackendPresentationProfileId,
): StreamEventImportance | undefined {
  const type = event.type.toLowerCase();
  const raw = isRecord(event.raw) ? event.raw : {};
  const status = stringField(raw.status)?.toLowerCase() ?? '';
  if (profile === 'cursor-agent-like') {
    if (type === 'audit' || type === 'run_started' || status === 'raw-jsonl' || status === 'stderr') return 'debug';
    if (type === 'tool_started' || type === 'tool_completed' || type === 'message_delta' || type === 'assistant_delta') return 'background';
    if (type === 'approval_requested' || type === 'gui_ask_user') return 'key';
  }
  if (profile === 'codex-cli-like') {
    if (type === 'audit' || type === 'run_started' || status === 'raw-jsonl' || status === 'stderr') return 'debug';
    if (type === 'tool_started' || type === 'tool_completed') return 'background';
  }
  if (profile === 'claude-code-like') {
    if (type === 'audit' || type === 'run_started') return 'debug';
    if (type === 'approval_requested' || type === 'gui_ask_user') return 'key';
    if (type === 'tool_started' || type === 'tool_completed') return 'background';
    if (type === 'message_delta' || type === 'assistant_delta') return 'background';
  }
  return undefined;
}

function streamEventTypeLabelForBackendProfile(
  type: string,
  event: AgentStreamEvent,
  profile: BackendPresentationProfileId,
): string | undefined {
  const normalizedType = type.toLowerCase();
  if (profile === 'cursor-agent-like') {
    if (normalizedType === 'run_started') return 'Agent run';
    if (normalizedType === 'tool_started') return 'Action';
    if (normalizedType === 'tool_completed') return 'Action done';
    if (normalizedType === 'approval_requested' || normalizedType === 'gui_ask_user') return 'Approval';
    if (normalizedType === 'message_delta' || normalizedType === 'assistant_delta') return 'Assistant progress';
    if (normalizedType === 'message') return 'Assistant';
    if (normalizedType === 'audit') return 'Agent audit';
  }
  if (profile === 'codex-cli-like') {
    if (normalizedType === 'run_started') return 'Codex CLI';
    if (normalizedType === 'tool_started') return 'Codex tool';
    if (normalizedType === 'tool_completed') return 'Codex tool done';
    if (normalizedType === 'message_delta' || normalizedType === 'assistant_delta') return 'Codex delta';
    if (normalizedType === 'message') return 'Codex message';
    if (normalizedType === 'audit') return 'Codex audit';
  }
  if (profile === 'claude-code-like') {
    if (normalizedType === 'run_started') return 'Claude Code';
    if (normalizedType === 'tool_started') return 'Claude tool';
    if (normalizedType === 'tool_completed') return 'Claude tool done';
    if (normalizedType === 'approval_requested' || normalizedType === 'gui_ask_user') return 'Claude approval';
    if (normalizedType === 'approval_resolved') return 'Claude approval done';
    if (normalizedType === 'message_delta' || normalizedType === 'assistant_delta') return 'Claude delta';
    if (normalizedType === 'message') return 'Claude message';
  }
  if (resolveBackendPresentationProfile(event, undefined) !== 'sciforge-default' && normalizedType === 'audit') return 'Backend audit';
  return undefined;
}

function streamEventInitiallyCollapsed(
  event: AgentStreamEvent,
  importance: StreamEventImportance,
  profile: BackendPresentationProfileId,
) {
  if (profile === 'cursor-agent-like' && ['audit', 'run_started'].includes(event.type.toLowerCase())) return true;
  if (profile === 'codex-cli-like' && ['audit', 'run_started'].includes(event.type.toLowerCase())) return true;
  if (profile === 'claude-code-like' && event.type.toLowerCase() === 'audit') return true;
  return importance !== 'key';
}

function streamEventVisibleInRunningMessage(
  event: AgentStreamEvent,
  importance: StreamEventImportance,
  detail: string,
  usageDetail: string,
  profile: BackendPresentationProfileId,
) {
  if (profile === 'cursor-agent-like' && ['audit', 'run_started'].includes(event.type.toLowerCase())) return false;
  if (profile === 'codex-cli-like' && ['audit', 'run_started'].includes(event.type.toLowerCase())) return false;
  if (profile === 'claude-code-like' && event.type.toLowerCase() === 'audit') return false;
  return importance === 'key' && Boolean(detail || usageDetail);
}

function streamEventTone(type: string, importance: StreamEventImportance, event?: AgentStreamEvent): StreamEventTone {
  const interactionProgress = event ? interactionProgressSummary(event) : undefined;
  if (interactionProgress) return interactionProgress.tone;
  const structured = event ? structuredWorkEventSummary(event) : undefined;
  const status = (structured?.stage?.status || structured?.project?.status || '').toLowerCase();
  if (structured?.failure || status === 'failed' || status === 'blocked') return 'danger';
  if (status === 'done' || status === 'success' || status === 'completed') return 'success';
  if (structured?.recoverActions.length) return 'warning';
  if (type.includes('error') || type.includes('failed')) return 'danger';
  if (type === CONTEXT_COMPACTION_EVENT_TYPE) return 'warning';
  if (type.includes('silent') || type.includes('guidance') || type.includes('permission')) return 'warning';
  if (type === CONTEXT_WINDOW_STATE_EVENT_TYPE) return 'info';
  if (type.includes('result') || type.includes('completed') || type.includes('done')) return 'success';
  if (importance !== 'key') return 'muted';
  return 'info';
}

function streamEventUiClass(type: string, importance: StreamEventImportance) {
  const classes: string[] = [importance];
  const artifactWorkClass = ['artifact', 'work'].join('-');
  if (type === CONTEXT_WINDOW_STATE_EVENT_TYPE || type === CONTEXT_COMPACTION_EVENT_TYPE) classes.push('context');
  if (type === TOOL_CALL_EVENT_TYPE || type === TOOL_RESULT_EVENT_TYPE) classes.push('tool');
  if (importance === 'key' && (type === TEXT_DELTA_EVENT_TYPE || type === TOOL_CALL_EVENT_TYPE || type === TOOL_RESULT_EVENT_TYPE)) classes.push(artifactWorkClass);
  if (type === TEXT_DELTA_EVENT_TYPE || importance !== 'key') classes.push('thinking');
  if (type === RUN_PLAN_EVENT_TYPE || type === STAGE_START_EVENT_TYPE) classes.push('plan');
  if (type.includes('error') || type.includes('failed')) classes.push('error');
  return classes.join(' ');
}

function shortStreamEventDetail(value: string) {
  const normalized = tidyReadableText(value).replace(/\n+/g, ' ');
  if (normalized.length <= 180) return normalized;
  return `${normalized.slice(0, 132)} ... ${normalized.slice(-36)}`;
}

function mergeTextDeltaDetail(previous: string, next: string) {
  return tidyReadableText(joinAssistantTextFragments([previous, next]));
}

function normalizeStreamTextDelta(value?: string) {
  if (!value) return '';
  const extracted = extractProtocolText(value);
  return tidyReadableText(extracted || value);
}

function isScriptOrArtifactGenerationDetail(value: string) {
  return runtimeTextLooksLikeGeneratedWorkDetail(value);
}

function looksLikeTransportJson(value: string) {
  const trimmed = value.trim();
  return (trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'));
}

function isRawRuntimeAuditEvent(event: AgentStreamEvent) {
  if (isRuntimeAuditOnlyEvent(event)) return true;
  const raw = isRecord(event.raw) ? event.raw : {};
  const type = event.type.toLowerCase();
  const rawType = stringField(raw.type)?.toLowerCase() ?? '';
  const role = stringField(raw.presentationRole)?.toLowerCase() ?? stringField(raw.role)?.toLowerCase() ?? '';
  return role === 'audit'
    || type.includes('raw')
    || rawType.includes('raw')
    || ['stdout', 'stderr', 'jsonl', 'rawJsonl', 'rawRef', 'stdoutRef', 'stderrRef', 'runtimeEventsRef'].some((key) => key in raw);
}

function toolEventActionLabel(event: AgentStreamEvent | undefined, detail: string, fallback: string) {
  const raw = isRecord(event?.raw) ? event.raw : {};
  const toolName = typeof raw.toolName === 'string' ? raw.toolName : '';
  const action = runtimeToolEventActionKind({ toolName, detail });
  const isToolResult = event?.type === TOOL_RESULT_EVENT_TYPE;
  if (action === 'script-write') return isToolResult ? 'Write complete' : 'Writing';
  if (action === 'command') return isToolResult ? 'Command result' : 'Run command';
  return fallback;
}

function detailFromRawToolEvent(event: AgentStreamEvent) {
  if (event.type !== TOOL_CALL_EVENT_TYPE && event.type !== TOOL_RESULT_EVENT_TYPE) return '';
  const raw = isRecord(event.raw) ? event.raw : {};
  const toolName = typeof raw.toolName === 'string' ? raw.toolName : '';
  const detail = typeof raw.detail === 'string' ? raw.detail : event.detail || '';
  const output = typeof raw.output === 'string' ? raw.output : '';
  const generatedTaskSummary = summarizeRuntimeGeneratedTaskFiles(detail || output || event.detail || '');
  if (generatedTaskSummary) return generatedTaskSummary;
  const action = runtimeToolEventActionKind({ toolName, detail });
  if (action === 'script-write') {
    const parsed = parseJsonObject(detail);
    const path = typeof parsed?.path === 'string' ? parsed.path : extractPathLike(detail);
    const content = typeof parsed?.content === 'string' ? parsed.content : '';
    if (event.type === TOOL_RESULT_EVENT_TYPE) return tidyReadableText(`Write complete${path ? `: ${path}` : ''}${output ? `\n${output}` : ''}`);
    return tidyReadableText(`Writing${path ? `: ${path}` : ''}${content ? `\n${previewCode(content)}` : ''}`);
  }
  if (output && runtimeToolOutputLooksLikeFailure(output)) {
    return tidyReadableText(`${detail}\n${tailText(output, 1400)}`);
  }
  return '';
}

function detailFromRawProgressEvent(event: AgentStreamEvent) {
  const raw = isRecord(event.raw) ? event.raw : {};
  const progress = isRecord(raw.progress) ? raw.progress : undefined;
  if (!progress) return '';
  const title = typeof progress.title === 'string' ? progress.title : event.detail || event.label;
  const parts = [title];
  const reading = Array.isArray(progress.reading) ? progress.reading.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
  const writing = Array.isArray(progress.writing) ? progress.writing.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
  const waitingFor = typeof progress.waitingFor === 'string' ? progress.waitingFor : '';
  const nextStep = typeof progress.nextStep === 'string' ? progress.nextStep : '';
  if (reading.length) parts.push(`Reading: ${reading.join(', ')}`);
  if (writing.length) parts.push(`Writing: ${writing.join(', ')}`);
  if (waitingFor) parts.push(`Waiting for: ${waitingFor}`);
  if (nextStep) parts.push(`Next: ${nextStep}`);
  return tidyReadableText(parts.filter(Boolean).join('\n'));
}

function interactionProgressSummary(event: AgentStreamEvent): {
  detail: string;
  importance: StreamEventImportance;
  operationKind: WorkEventKind;
  tone: StreamEventTone;
  typeLabel: string;
} | undefined {
  const progress = interactionProgressRecord(event);
  if (!progress) return undefined;
  const presentation = runtimeInteractionProgressPresentation(progress);
  if (!presentation) return undefined;
  const type = progress.type;
  const phase = progress.phase;
  const status = progress.status;
  const importance = progress.importance;
  const interactionKind = progress.interaction?.kind;
  return {
    detail: presentation.detail,
    importance: streamImportanceForInteractionProgress(importance, status),
    operationKind: operationKindForInteractionProgress(type, phase, status, interactionKind),
    tone: toneForInteractionProgress(status, importance),
    typeLabel: presentation.label,
  };
}

function interactionProgressRecord(event: AgentStreamEvent): RuntimeInteractionProgressEvent | undefined {
  const raw = isRecord(event.raw) ? event.raw : undefined;
  return runtimeInteractionProgressEventFromUnknown(raw)
    ?? runtimeInteractionProgressEventFromCompactRecord(raw)
    ?? runtimeInteractionProgressEventFromCompactRecord(event);
}

function streamImportanceForInteractionProgress(importance: string | undefined, status: string | undefined): StreamEventImportance {
  if (status === 'blocked' || status === 'failed' || status === 'cancelled') return 'key';
  if (importance === 'low') return 'background';
  return 'key';
}

function toneForInteractionProgress(status: string | undefined, importance: string | undefined): StreamEventTone {
  if (status === 'failed' || status === 'cancelled') return 'danger';
  if (status === 'completed') return 'success';
  if (status === 'blocked' || importance === 'blocking') return 'warning';
  return importance === 'low' ? 'muted' : 'info';
}

function operationKindForInteractionProgress(
  type: string,
  phase: string | undefined,
  status: string | undefined,
  interactionKind: string | undefined,
): WorkEventKind {
  const normalizedType = type.toLowerCase();
  const normalizedPhase = (phase ?? '').toLowerCase();
  if (normalizedType === 'run-cancelled' || status === 'failed' || status === 'cancelled') return 'diagnostic';
  if (interactionKind || status === 'blocked' || normalizedType === 'guidance-queued') return 'wait';
  if (/repair|recover|retry/.test(normalizedPhase)) return 'recover';
  if (/verification|validate|verifier|acceptance/.test(normalizedPhase)) return 'validate';
  if (/context|read|reference/.test(normalizedPhase)) return 'read';
  if (/capabil|tool|dispatch|execute|action/.test(normalizedPhase)) return 'command';
  if (/plan|classify|select|profile|intent/.test(normalizedPhase)) return 'plan';
  if (/background|silence|wait|pending/.test(normalizedPhase)) return 'wait';
  if (/complete|result|output|emit/.test(normalizedPhase)) return 'emit';
  return normalizedType === PROCESS_PROGRESS_EVENT_TYPE ? 'other' : 'diagnostic';
}

function parseJsonObject(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function extractPathLike(value: string) {
  return value.match(/(?:^|["'\s])((?:\/|\.?\/)?[A-Za-z0-9._/@-]+\/[A-Za-z0-9._/@-]+\.(?:py|js|ts|r|R|sh|json|md))(?:["'\s]|$)/)?.[1];
}

function previewCode(value: string) {
  const lines = value
    .replace(/\\n/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .slice(0, 8);
  return lines.length ? lines.join('\n') : value.slice(0, 500);
}

function tailText(value: string, limit: number) {
  return value.length <= limit ? value : value.slice(-limit);
}

function extractProtocolText(value: string) {
  const parts: string[] = [];
  const textFieldPattern = /"text"\s*:\s*"((?:\\.|[^"\\])*)"/g;
  for (const match of value.matchAll(textFieldPattern)) {
    try {
      parts.push(JSON.parse(`"${match[1]}"`) as string);
    } catch {
      parts.push(match[1].replace(/\\"/g, '"').replace(/\\n/g, '\n'));
    }
  }
  if (!parts.length) return '';
  const protocolFragments = value.match(/"protocolVersion"\s*:\s*"v\d+"/g)?.length ?? 0;
  return protocolFragments || parts.length > 1 ? parts.join('') : '';
}

function tidyReadableText(value: string) {
  return value
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]{2,}/g, ' ').trim())
    .join('\n')
    .replace(/([A-Za-z0-9\u4e00-\u9fff])\n(?=[A-Za-z0-9\u4e00-\u9fff])/g, '$1 ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}
