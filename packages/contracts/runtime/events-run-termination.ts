import type { RunStatus } from './messages';

export type RunTerminationReason = 'user-cancelled' | 'system-aborted' | 'timeout' | 'backend-error';
export type RunTerminationActor = 'user' | 'system' | 'backend';

export interface RunTerminationRecord {
  schemaVersion: 'sciforge.run-termination.v1';
  reason: RunTerminationReason;
  actor: RunTerminationActor;
  progressStatus: 'cancelled' | 'failed';
  runState: 'cancelled' | 'failed';
  sessionStatus: Extract<RunStatus, 'cancelled' | 'failed'>;
  retryable: boolean;
  detail?: string;
}

export interface RunTerminationNormalizationInput {
  cancellationReason?: string;
  detail?: string;
  userRequested?: boolean;
  aborted?: boolean;
  timedOut?: boolean;
  backendError?: boolean;
}

export function normalizeRunTermination(input: RunTerminationNormalizationInput = {}): RunTerminationRecord {
  const detail = input.detail?.trim();
  const reason = normalizeRunTerminationReason(input);
  const failed = reason === 'backend-error';
  return {
    schemaVersion: 'sciforge.run-termination.v1',
    reason,
    actor: runTerminationActor(reason),
    progressStatus: failed ? 'failed' : 'cancelled',
    runState: failed ? 'failed' : 'cancelled',
    sessionStatus: reason === 'user-cancelled' ? 'cancelled' : 'failed',
    retryable: reason !== 'user-cancelled',
    ...(detail ? { detail } : {}),
  };
}

export function normalizeRunTerminationReason(input: RunTerminationNormalizationInput = {}): RunTerminationReason {
  const explicit = normalizeRunTerminationReasonValue(input.cancellationReason);
  if (explicit) return explicit;
  const detail = input.detail ?? input.cancellationReason ?? '';
  if (input.userRequested) return 'user-cancelled';
  if (input.timedOut || /\b(timeout|timed out|deadline|time limit|超时)\b/i.test(detail)) return 'timeout';
  if (input.backendError || /\b(backend|agentserver|workspace runtime|http\s*5\d\d|schema|contract|error|failed|failure|后端|失败)\b/i.test(detail)) return 'backend-error';
  if (input.aborted || /abort|aborted|cancelled|canceled|disconnect|network|system|系统|网络|中断/i.test(detail)) return 'system-aborted';
  return 'backend-error';
}

export function isRunTerminationRecord(value: unknown): value is RunTerminationRecord {
  if (!isRecord(value)) return false;
  return value.schemaVersion === 'sciforge.run-termination.v1'
    && normalizeRunTerminationReasonValue(asString(value.reason)) !== undefined
    && (value.actor === 'user' || value.actor === 'system' || value.actor === 'backend');
}

export function normalizeRunTerminationReasonValue(value: string | undefined): RunTerminationReason | undefined {
  if (value === 'user-cancelled' || value === 'system-aborted' || value === 'timeout' || value === 'backend-error') return value;
  if (!value) return undefined;
  if (/user|manual|requested cancel|已中断|用户|人工/i.test(value)) return 'user-cancelled';
  if (/\b(timeout|timed out|deadline|time limit|超时)\b/i.test(value)) return 'timeout';
  if (/\b(backend|agentserver|workspace runtime|http\s*5\d\d|schema|contract|error|failed|failure|后端|失败)\b/i.test(value)) return 'backend-error';
  if (/abort|aborted|cancelled|canceled|disconnect|network|system|系统|网络|中断/i.test(value)) return 'system-aborted';
  return undefined;
}

function runTerminationActor(reason: RunTerminationReason): RunTerminationActor {
  if (reason === 'user-cancelled') return 'user';
  if (reason === 'backend-error') return 'backend';
  return 'system';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}
