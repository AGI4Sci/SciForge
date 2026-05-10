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
  summarizeRuntimeGeneratedTaskFiles,
} from '@sciforge-ui/runtime-contract';
import type { AgentStreamEvent } from './domain';
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

const INTERACTION_PROGRESS_EVENT_SCHEMA_VERSION = 'sciforge.interaction-progress-event.v1';
const INTERACTION_PROGRESS_IMPORTANCE = new Set(['low', 'normal', 'high', 'blocking']);
const INTERACTION_PROGRESS_STATUSES = new Set(['pending', 'running', 'blocked', 'completed', 'failed', 'cancelled']);

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

export function presentStreamEvent(event: AgentStreamEvent): StreamEventPresentation {
  const detail = readableStreamEventDetail(event);
  const usageDetail = formatAgentTokenUsage(event.usage);
  const importance = streamEventImportance(event, detail);
  const typeLabel = streamEventTypeLabel(event.type, event, detail);
  const tone = streamEventTone(event.type, importance, event);
  return {
    typeLabel,
    detail,
    shortDetail: shortStreamEventDetail(detail || usageDetail || event.label || typeLabel),
    usageDetail,
    importance,
    tone,
    uiClass: streamEventUiClass(event.type, importance),
    initiallyCollapsed: importance !== 'key',
    visibleInRunningMessage: importance === 'key' && Boolean(detail || usageDetail),
  };
}

export function presentStreamWorklog(
  events: AgentStreamEvent[],
  options: {
    limit?: number;
    guidanceCount?: number;
    counts?: ReturnType<typeof streamEventCounts>;
  } = {},
): StreamWorklogPresentation {
  const counts = options.counts ?? streamEventCounts(events);
  const operationCounts = worklogOperationCounts(events);
  const entries = latestWorklogEntries(events, options.limit ?? 48);
  return {
    summary: summarizeStructuredWorklog(entries) || summarizeWorklog(operationCounts, counts, options.guidanceCount ?? 0),
    entries,
    operationCounts,
    counts,
    initiallyCollapsed: true,
  };
}

export function latestWorklogEntries(events: AgentStreamEvent[], limit: number): StreamWorklogEntry[] {
  const seen = new Set<string>();
  return events
    .map(worklogEntryForEvent)
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

export function worklogEntryForEvent(event: AgentStreamEvent): StreamWorklogEntry {
  const presentation = presentStreamEvent(event);
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

export function latestRunningEvent(events: AgentStreamEvent[]) {
  const latestKey = [...events].reverse().find((event) => presentStreamEvent(event).visibleInRunningMessage);
  if (latestKey) return presentStreamEvent(latestKey).detail || presentStreamEvent(latestKey).usageDetail;
  const latestBackground = [...events].reverse().find((event) => readableStreamEventDetail(event));
  return latestBackground ? '后台正在探索或执行，过程日志已折叠。' : undefined;
}

export function streamEventCounts(events: AgentStreamEvent[]) {
  return events.reduce(
    (counts, event) => {
      const presentation = presentStreamEvent(event);
      counts.total += 1;
      counts[presentation.importance] += 1;
      return counts;
    },
    { total: 0, key: 0, background: 0, debug: 0 },
  );
}

function worklogOperationCounts(events: AgentStreamEvent[]) {
  return events.reduce(
    (memo, event) => {
      const presentation = presentStreamEvent(event);
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
  const model = [usage.provider, usage.model].filter(Boolean).join('/');
  const suffix = [model, usage.source].filter(Boolean).join(' ');
  return `tokens ${parts.join(', ')}${suffix ? ` (${suffix})` : ''}`;
}

export function coalesceStreamEvents(events: AgentStreamEvent[], next: AgentStreamEvent) {
  if (next.type !== TEXT_DELTA_EVENT_TYPE) return [...events, next];
  const detail = normalizeStreamTextDelta(next.detail).trim();
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
  if (type !== TEXT_DELTA_EVENT_TYPE && type !== OUTPUT_EVENT_TYPE) return '';
  const detail = readableStreamEventDetail(event);
  if (!detail || isScriptOrArtifactGenerationDetail(detail) || looksLikeTransportJson(detail)) return '';
  return detail;
}

export function readableStreamEventDetail(event: AgentStreamEvent) {
  if (event.contextWindowState) {
    const state = event.contextWindowState;
    const meter = buildContextWindowMeterModel(state, false);
    return `used/window ${meter.used}/${meter.windowSize}, ratio ${meter.ratioLabel}, source ${meter.sourceLabel}, status ${meter.statusLabel}, backend ${state.backend || 'unknown'}, ${meter.compactLine}, last ${state.lastCompactedAt || 'never'}`;
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

function streamEventImportance(event: AgentStreamEvent, detail: string): StreamEventImportance {
  const type = event.type.toLowerCase();
  const interactionProgress = interactionProgressSummary(event);
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

function streamEventTypeLabel(type: string, event?: AgentStreamEvent, detail = '') {
  const interactionProgress = event ? interactionProgressSummary(event) : undefined;
  if (interactionProgress) return interactionProgress.typeLabel;
  const structured = event ? structuredWorkEventSummary(event) : undefined;
  if (structured?.stage) return 'Stage';
  if (structured?.project) return 'Project';
  if (type === CONTEXT_WINDOW_STATE_EVENT_TYPE) return '上下文窗口';
  if (type === CONTEXT_COMPACTION_EVENT_TYPE) return '上下文压缩';
  if (type === TEXT_DELTA_EVENT_TYPE) return isScriptOrArtifactGenerationDetail(detail) ? '生成脚本/任务' : '生成内容';
  if (type === TOOL_CALL_EVENT_TYPE) return toolEventActionLabel(event, detail, '工具调用');
  if (type === TOOL_RESULT_EVENT_TYPE) return toolEventActionLabel(event, detail, '工具结果');
  if (type === RUN_PLAN_EVENT_TYPE) return '执行计划';
  if (type === STAGE_START_EVENT_TYPE) return '阶段开始';
  if (type === USAGE_UPDATE_EVENT_TYPE) return '用量';
  if (type === PROCESS_PROGRESS_EVENT_TYPE) return '工作过程';
  return type;
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
  if (!previous.trim()) return next;
  if (!next.trim()) return previous;
  if (/^[,.;:!?，。；：！？)\]}]/.test(next)) return tidyReadableText(`${previous}${next}`);
  if (/[(\[{]$/.test(previous)) return `${previous}${next}`;
  return tidyReadableText(`${previous} ${next}`);
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

function toolEventActionLabel(event: AgentStreamEvent | undefined, detail: string, fallback: string) {
  const raw = isRecord(event?.raw) ? event.raw : {};
  const toolName = typeof raw.toolName === 'string' ? raw.toolName : '';
  const action = runtimeToolEventActionKind({ toolName, detail });
  const isToolResult = event?.type === TOOL_RESULT_EVENT_TYPE;
  if (action === 'script-write') return isToolResult ? '写入完成' : '写入脚本';
  if (action === 'command') return isToolResult ? '命令结果' : '执行命令';
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
    if (event.type === TOOL_RESULT_EVENT_TYPE) return tidyReadableText(`写入完成${path ? `：${path}` : ''}${output ? `\n${output}` : ''}`);
    return tidyReadableText(`正在写入脚本${path ? `：${path}` : ''}${content ? `\n${previewCode(content)}` : ''}`);
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
  if (reading.length) parts.push(`正在读：${reading.join('、')}`);
  if (writing.length) parts.push(`正在写：${writing.join('、')}`);
  if (waitingFor) parts.push(`正在等：${waitingFor}`);
  if (nextStep) parts.push(`下一步：${nextStep}`);
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
  const type = stringField(progress.type) ?? event.type;
  const phase = stringField(progress.phase);
  const status = normalizedInteractionStatus(progress.status);
  const importance = normalizedInteractionImportance(progress.importance);
  const reason = stringField(progress.reason);
  const cancellationReason = stringField(progress.cancellationReason);
  const interaction = isRecord(progress.interaction) ? progress.interaction : undefined;
  const interactionKind = stringField(interaction?.kind);
  const interactionRequired = typeof interaction?.required === 'boolean' ? interaction.required : undefined;
  const parts = [
    `Phase: ${phase ?? type}`,
    status ? `Status: ${status}` : '',
    reason ? `Reason: ${reason}` : '',
    cancellationReason ? `Cancellation: ${cancellationReason}` : '',
    interactionKind ? `Interaction: ${interactionKind}${interactionRequired === undefined ? '' : interactionRequired ? ' required' : ' optional'}` : '',
    budgetSummary(isRecord(progress.budget) ? progress.budget : undefined),
  ].filter(Boolean);
  return {
    detail: parts.join('\n'),
    importance: streamImportanceForInteractionProgress(importance, status),
    operationKind: operationKindForInteractionProgress(type, phase, status, interactionKind),
    tone: toneForInteractionProgress(status, importance),
    typeLabel: labelForInteractionProgress(type),
  };
}

function interactionProgressRecord(event: AgentStreamEvent): Record<string, unknown> | undefined {
  const raw = isRecord(event.raw) ? event.raw : undefined;
  if (raw && raw.schemaVersion === INTERACTION_PROGRESS_EVENT_SCHEMA_VERSION && typeof raw.type === 'string') return raw;
  return undefined;
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

function labelForInteractionProgress(type: string) {
  if (type === 'clarification-needed') return '需要澄清';
  if (type === 'human-approval-required') return '需要确认';
  if (type === 'interaction-request') return '需要交互';
  if (type === 'guidance-queued') return '引导已排队';
  if (type === 'run-cancelled') return '运行取消';
  if (type === PROCESS_PROGRESS_EVENT_TYPE) return '工作过程';
  return type;
}

function budgetSummary(budget: Record<string, unknown> | undefined) {
  if (!budget) return '';
  const elapsedMs = numberField(budget.elapsedMs);
  const remainingMs = numberField(budget.remainingMs);
  const retryCount = numberField(budget.retryCount);
  const maxRetries = numberField(budget.maxRetries);
  const maxWallMs = numberField(budget.maxWallMs);
  const parts = [
    elapsedMs !== undefined ? `elapsed ${elapsedMs}ms` : '',
    remainingMs !== undefined ? `remaining ${remainingMs}ms` : '',
    retryCount !== undefined || maxRetries !== undefined ? `retries ${retryCount ?? '?'}/${maxRetries ?? '?'}` : '',
    maxWallMs !== undefined ? `max wall ${maxWallMs}ms` : '',
  ].filter(Boolean);
  return parts.length ? `Budget: ${parts.join(', ')}` : '';
}

function normalizedInteractionImportance(value: unknown) {
  const text = stringField(value)?.toLowerCase();
  return text && INTERACTION_PROGRESS_IMPORTANCE.has(text) ? text : undefined;
}

function normalizedInteractionStatus(value: unknown) {
  const text = stringField(value)?.toLowerCase();
  return text && INTERACTION_PROGRESS_STATUSES.has(text) ? text : undefined;
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

function numberField(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
