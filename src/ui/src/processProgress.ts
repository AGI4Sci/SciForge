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
  status: 'running' | 'completed' | 'failed';
}

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
  if (model.nextStep) parts.push(`下一步 ${model.nextStep}`);
  return parts.join(' · ');
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
    status: normalizeStatus(asString(progress.status), phase),
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
