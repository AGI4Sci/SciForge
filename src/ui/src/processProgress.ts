import type { AgentStreamEvent } from './domain';

export type ProcessProgressPhase = 'read' | 'write' | 'execute' | 'wait' | 'plan' | 'complete' | 'error' | 'observe';

export interface ProcessProgressModel {
  phase: ProcessProgressPhase;
  title: string;
  detail: string;
  reading: string[];
  writing: string[];
  waitingFor?: string;
  nextStep?: string;
  lastEvent?: {
    label: string;
    detail: string;
    createdAt?: string;
  };
  reason?: string;
  recoveryHint?: string;
  canAbort?: boolean;
  canContinue?: boolean;
  status: 'running' | 'completed' | 'failed';
}

export const SILENT_STREAM_WAIT_THRESHOLD_MS = 60_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

export function progressModelFromEvent(event: AgentStreamEvent): ProcessProgressModel | undefined {
  const raw = isRecord(event.raw) ? event.raw : {};
  const progress = isRecord(raw.progress) ? raw.progress : isRecord(raw.raw) && isRecord(raw.raw.progress) ? raw.raw.progress : undefined;
  if (progress) return normalizeProgressModel(progress, event);
  if (event.type === 'process-progress') return normalizeProgressModel(raw, event);
  return undefined;
}

export function latestProgressModel(events: AgentStreamEvent[]) {
  for (const event of [...events].reverse()) {
    const model = progressModelFromEvent(event);
    if (model) return model;
  }
  return undefined;
}

export function formatProgressHeadline(model: ProcessProgressModel | undefined, fallback?: string) {
  if (!model) return fallback;
  const parts = [model.title];
  if (model.reading.length) parts.push(`读 ${model.reading[0]}`);
  if (model.writing.length) parts.push(`写 ${model.writing[0]}`);
  if (model.waitingFor) parts.push(`等 ${model.waitingFor}`);
  if (model.lastEvent) parts.push(`最近 ${model.lastEvent.label}: ${model.lastEvent.detail}`);
  if (model.nextStep) parts.push(`下一步 ${model.nextStep}`);
  return parts.join(' · ');
}

export function buildSilentStreamProgressEvent({
  events,
  nowMs,
  backend,
  thresholdMs = SILENT_STREAM_WAIT_THRESHOLD_MS,
}: {
  events: AgentStreamEvent[];
  nowMs: number;
  backend?: string;
  thresholdMs?: number;
}): AgentStreamEvent | undefined {
  const lastEvent = latestNonSyntheticEvent(events);
  const latestAtMs = lastEvent ? Date.parse(lastEvent.createdAt) : undefined;
  const elapsedMs = Number.isFinite(latestAtMs) ? nowMs - (latestAtMs as number) : thresholdMs;
  if (elapsedMs < thresholdMs) return undefined;
  const lastEventSummary = lastEvent ? summarizeLastEvent(lastEvent) : undefined;
  const elapsedSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const detail = lastEventSummary
    ? `HTTP stream 仍在等待；已 ${elapsedSeconds}s 没有收到新事件。最近事件：${lastEventSummary.label} - ${lastEventSummary.detail}`
    : `HTTP stream 仍在等待；已 ${elapsedSeconds}s 没有收到新事件，尚无可展示的后端事件。`;
  return {
    id: 'evt-silent-stream-wait',
    type: 'process-progress',
    label: '等待',
    detail,
    createdAt: new Date(nowMs).toISOString(),
    raw: {
      type: 'process-progress',
      progress: {
        phase: 'wait',
        title: '正在等待后端返回新事件',
        detail,
        waitingFor: '后端返回新事件',
        nextStep: '收到新事件后继续执行；也可以安全中止当前 stream 或继续补充指令排队。',
        lastEvent: lastEventSummary,
        reason: 'backend-waiting',
        recoveryHint: '保留最近真实事件和等待原因，下一轮可基于这些线索继续或恢复。',
        canAbort: true,
        canContinue: true,
        status: 'running',
      },
      silentStreamWaiting: true,
      backend,
      elapsedMs,
      thresholdMs,
      streamOpen: true,
    },
  };
}

function normalizeProgressModel(progress: Record<string, unknown>, event: AgentStreamEvent): ProcessProgressModel {
  const phase = normalizePhase(asString(progress.phase) ?? event.type);
  const detail = asString(progress.detail) ?? event.detail;
  return {
    phase,
    title: asString(progress.title) ?? titleForPhase(phase, event.label),
    detail: detail || titleForPhase(phase, event.label),
    reading: asStringArray(progress.reading),
    writing: asStringArray(progress.writing),
    waitingFor: asString(progress.waitingFor) ?? asString(progress.waiting_for),
    nextStep: asString(progress.nextStep) ?? asString(progress.next_step),
    lastEvent: normalizeLastEvent(progress.lastEvent) ?? normalizeLastEvent(progress.last_event),
    reason: asString(progress.reason),
    recoveryHint: asString(progress.recoveryHint) ?? asString(progress.recovery_hint),
    canAbort: progress.canAbort === true || progress.can_abort === true,
    canContinue: progress.canContinue === true || progress.can_continue === true,
    status: normalizeStatus(asString(progress.status), phase),
  };
}

function latestNonSyntheticEvent(events: AgentStreamEvent[]) {
  for (const event of [...events].reverse()) {
    const raw = isRecord(event.raw) ? event.raw : {};
    if (raw.silentStreamWaiting === true) continue;
    if (event.type === 'process-progress' && isRecord(raw.progress) && raw.progress.reason === 'backend-waiting') continue;
    if (event.type === 'queued' || event.type === 'guidance-queued' || event.type === 'user-interrupt') continue;
    return event;
  }
  return undefined;
}

function summarizeLastEvent(event: AgentStreamEvent) {
  return {
    label: event.label || event.type || '事件',
    detail: (event.detail || event.type || event.label || '后端事件').trim().slice(0, 180),
    createdAt: event.createdAt,
  };
}

function normalizeLastEvent(value: unknown): ProcessProgressModel['lastEvent'] | undefined {
  if (!isRecord(value)) return undefined;
  const label = asString(value.label) ?? asString(value.type);
  const detail = asString(value.detail) ?? asString(value.message) ?? asString(value.text);
  if (!label || !detail) return undefined;
  return {
    label,
    detail,
    createdAt: asString(value.createdAt) ?? asString(value.created_at),
  };
}

function normalizePhase(value: string): ProcessProgressPhase {
  const lowered = value.toLowerCase();
  if (/write|写/.test(lowered)) return 'write';
  if (/read|读/.test(lowered)) return 'read';
  if (/wait|silent|pending|等待|配额/.test(lowered)) return 'wait';
  if (/plan|next|stage|计划|下一步/.test(lowered)) return 'plan';
  if (/complete|done|success|完成/.test(lowered)) return 'complete';
  if (/error|fail|traceback|失败|报错/.test(lowered)) return 'error';
  if (/execute|run|command|执行|运行/.test(lowered)) return 'execute';
  return 'observe';
}

function normalizeStatus(value: string | undefined, phase: ProcessProgressPhase): ProcessProgressModel['status'] {
  if (phase === 'error' || /fail|error|失败/.test(value ?? '')) return 'failed';
  if (phase === 'complete' || /done|complete|success|完成/.test(value ?? '')) return 'completed';
  return 'running';
}

function titleForPhase(phase: ProcessProgressPhase, fallback: string) {
  if (phase === 'read') return '正在读取';
  if (phase === 'write') return '正在写入';
  if (phase === 'execute') return '正在执行';
  if (phase === 'wait') return '正在等待';
  if (phase === 'plan') return '正在规划下一步';
  if (phase === 'complete') return '阶段完成';
  if (phase === 'error') return '遇到阻断';
  return fallback || '正在观察后端状态';
}
