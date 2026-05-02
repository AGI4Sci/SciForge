import { buildContextWindowMeterModel } from './contextWindow';
import type { AgentStreamEvent } from './domain';

export type StreamEventImportance = 'key' | 'background' | 'debug';
export type StreamEventTone = 'info' | 'warning' | 'danger' | 'success' | 'muted';

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

export function presentStreamEvent(event: AgentStreamEvent): StreamEventPresentation {
  const detail = readableStreamEventDetail(event);
  const usageDetail = formatAgentTokenUsage(event.usage);
  const importance = streamEventImportance(event, detail);
  const typeLabel = streamEventTypeLabel(event.type);
  const tone = streamEventTone(event.type, importance);
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
  if (!event.detail) return '';
  const detail = event.type === 'text-delta'
    ? normalizeStreamTextDelta(event.detail)
    : tidyReadableText(event.detail);
  const usageDetail = formatAgentTokenUsage(event.usage);
  return usageDetail ? detail.replace(` | ${usageDetail}`, '').replace(usageDetail, '').trim() : detail;
}

function streamEventImportance(event: AgentStreamEvent, detail: string): StreamEventImportance {
  const type = event.type.toLowerCase();
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
  if (type === 'usage-update' || type === 'text-delta') return 'background';
  if (/(current-plan|run-plan|stage-start|tool-call|project-tool-start|project-tool-done|repair-start|acceptance-repair|guidance-queued|backend-silent|status)/.test(type)) {
    return 'key';
  }
  if (/(tool-result|result|completed|done)/.test(type)) {
    return /failed|repair|blocked|completed|done|成功|失败|修复|中断/i.test(detail) ? 'key' : 'background';
  }
  return detail.length > 400 ? 'background' : 'key';
}

function streamEventTypeLabel(type: string) {
  if (type === 'contextWindowState') return '上下文窗口';
  if (type === 'contextCompaction') return '上下文压缩';
  if (type === 'text-delta') return '生成内容';
  if (type === 'tool-call') return '工具调用';
  if (type === 'tool-result') return '工具结果';
  if (type === 'run-plan') return '执行计划';
  if (type === 'stage-start') return '阶段开始';
  if (type === 'usage-update') return '用量';
  return type;
}

function streamEventTone(type: string, importance: StreamEventImportance): StreamEventTone {
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
