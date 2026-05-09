import { buildContextWindowMeterModel } from './contextWindow';
import type { AgentStreamEvent } from './domain';
import {
  classifyWorkEvent,
  emptyWorkEventCounts,
  formatRawWorkEventOutput,
  structuredWorkEventSummary,
  summarizeGeneratedTaskFiles,
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
  const operationKind = classifyWorkEvent(event, presentation.detail, presentation.shortDetail);
  const detail = structured?.detail || presentation.shortDetail || presentation.detail || presentation.usageDetail;
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
      const kind = classifyWorkEvent(event, presentation.detail, presentation.shortDetail);
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
  if (next.type !== 'text-delta') return [...events, next];
  const detail = normalizeStreamTextDelta(next.detail).trim();
  if (!detail) return events;
  const last = events.at(-1);
  if (!last || last.type !== 'text-delta') return [...events, { ...next, detail }];
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
        type: 'text-delta',
        coalesced: true,
        latest: next.raw ?? { detail },
      },
    },
  ];
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
  const structuredDetail = structuredWorkEventSummary(event)?.detail;
  if (structuredDetail) return structuredDetail;
  const rawDetail = detailFromRawToolEvent(event);
  if (rawDetail) return rawDetail;
  const progressDetail = detailFromRawProgressEvent(event);
  if (progressDetail) return progressDetail;
  if (!event.detail) return '';
  const detail = event.type === 'text-delta'
    ? normalizeStreamTextDelta(event.detail)
    : tidyReadableText(event.detail);
  const usageDetail = formatAgentTokenUsage(event.usage);
  return usageDetail ? detail.replace(` | ${usageDetail}`, '').replace(usageDetail, '').trim() : detail;
}

function streamEventImportance(event: AgentStreamEvent, detail: string): StreamEventImportance {
  const type = event.type.toLowerCase();
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
  if (type === 'text-delta') {
    return isScriptOrArtifactGenerationDetail(detail) ? 'key' : 'background';
  }
  if (type === 'usage-update') return 'background';
  if (type === 'process-progress') return 'key';
  if (/(current-plan|run-plan|stage-start|tool-call|project-tool-start|project-tool-done|repair-start|acceptance-repair|guidance-queued|backend-silent|status)/.test(type)) {
    return 'key';
  }
  if (/(tool-result|result|completed|done)/.test(type)) {
    return /failed|repair|blocked|completed|done|成功|失败|修复|中断/i.test(detail) ? 'key' : 'background';
  }
  return detail.length > 400 ? 'background' : 'key';
}

function streamEventTypeLabel(type: string, event?: AgentStreamEvent, detail = '') {
  const structured = event ? structuredWorkEventSummary(event) : undefined;
  if (structured?.stage) return 'Stage';
  if (structured?.project) return 'Project';
  if (type === 'contextWindowState') return '上下文窗口';
  if (type === 'contextCompaction') return '上下文压缩';
  if (type === 'text-delta') return isScriptOrArtifactGenerationDetail(detail) ? '生成脚本/任务' : '生成内容';
  if (type === 'tool-call') return toolEventActionLabel(event, detail, '工具调用');
  if (type === 'tool-result') return toolEventActionLabel(event, detail, '工具结果');
  if (type === 'run-plan') return '执行计划';
  if (type === 'stage-start') return '阶段开始';
  if (type === 'usage-update') return '用量';
  if (type === 'process-progress') return '工作过程';
  return type;
}

function streamEventTone(type: string, importance: StreamEventImportance, event?: AgentStreamEvent): StreamEventTone {
  const structured = event ? structuredWorkEventSummary(event) : undefined;
  const status = (structured?.stage?.status || structured?.project?.status || '').toLowerCase();
  if (structured?.failure || status === 'failed' || status === 'blocked') return 'danger';
  if (status === 'done' || status === 'success' || status === 'completed') return 'success';
  if (structured?.recoverActions.length) return 'warning';
  if (type.includes('error') || type.includes('failed')) return 'danger';
  if (type === 'contextCompaction') return 'warning';
  if (type.includes('silent') || type.includes('guidance') || type.includes('permission')) return 'warning';
  if (type === 'contextWindowState') return 'info';
  if (type.includes('result') || type.includes('completed') || type.includes('done')) return 'success';
  if (importance !== 'key') return 'muted';
  return 'info';
}

function streamEventUiClass(type: string, importance: StreamEventImportance) {
  const classes: string[] = [importance];
  if (type === 'contextWindowState' || type === 'contextCompaction') classes.push('context');
  if (type === 'tool-call' || type === 'tool-result') classes.push('tool');
  if (importance === 'key' && (type === 'text-delta' || type === 'tool-call' || type === 'tool-result')) classes.push('artifact-work');
  if (type === 'text-delta' || importance !== 'key') classes.push('thinking');
  if (type === 'run-plan' || type === 'stage-start') classes.push('plan');
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
  return /(?:taskFiles|entrypoint|write_file|wrote \d+ bytes|cat\s*>\s*.*\.(?:py|js|ts|r|sh)|\.sciforge\/tasks|\/tasks\/|\.py\b|\.R\b|\.sh\b|research-report|paper-list|evidence-matrix|ToolPayload|AgentServerGenerationResponse)/i.test(value);
}

function toolEventActionLabel(event: AgentStreamEvent | undefined, detail: string, fallback: string) {
  const raw = isRecord(event?.raw) ? event.raw : {};
  const toolName = typeof raw.toolName === 'string' ? raw.toolName : '';
  const haystack = `${toolName}\n${detail}`;
  if (/write_file|cat\s*>|wrote \d+ bytes|\.py\b|\.R\b|\.sh\b/i.test(haystack)) return event?.type === 'tool-result' ? '写入完成' : '写入脚本';
  if (/run_command|python3?|bash|sh\s+-lc|npm|pytest|tsx/i.test(haystack)) return event?.type === 'tool-result' ? '命令结果' : '执行命令';
  return fallback;
}

function detailFromRawToolEvent(event: AgentStreamEvent) {
  if (event.type !== 'tool-call' && event.type !== 'tool-result') return '';
  const raw = isRecord(event.raw) ? event.raw : {};
  const toolName = typeof raw.toolName === 'string' ? raw.toolName : '';
  const detail = typeof raw.detail === 'string' ? raw.detail : event.detail || '';
  const output = typeof raw.output === 'string' ? raw.output : '';
  const generatedTaskSummary = summarizeGeneratedTaskFiles(detail || output || event.detail || '');
  if (generatedTaskSummary) return generatedTaskSummary;
  if (toolName === 'write_file' || /write_file/i.test(detail)) {
    const parsed = parseJsonObject(detail);
    const path = typeof parsed?.path === 'string' ? parsed.path : extractPathLike(detail);
    const content = typeof parsed?.content === 'string' ? parsed.content : '';
    if (event.type === 'tool-result') return tidyReadableText(`写入完成${path ? `：${path}` : ''}${output ? `\n${output}` : ''}`);
    return tidyReadableText(`正在写入脚本${path ? `：${path}` : ''}${content ? `\n${previewCode(content)}` : ''}`);
  }
  if (/cat\s*>\s*.+?\.(?:py|js|ts|r|sh)\b/i.test(detail)) {
    const path = extractPathLike(detail);
    return tidyReadableText(`${event.type === 'tool-result' ? '脚本写入完成' : '正在写入脚本'}${path ? `：${path}` : ''}${output ? `\n${output}` : ''}`);
  }
  if (output && /Traceback|Error|Exception|failed|失败|timeout/i.test(output)) {
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
