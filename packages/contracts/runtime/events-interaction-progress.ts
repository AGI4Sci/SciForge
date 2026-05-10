import type {
  RunTerminationReason,
  RunTerminationRecord,
} from './events-run-termination';
import {
  isRunTerminationRecord,
  normalizeRunTermination,
  normalizeRunTerminationReasonValue,
} from './events-run-termination';

export const PROCESS_PROGRESS_EVENT_TYPE = 'process-progress' as const;
export const INTERACTION_PROGRESS_EVENT_SCHEMA_VERSION = 'sciforge.interaction-progress-event.v1' as const;
export const INTERACTION_REQUEST_EVENT_TYPE = 'interaction-request' as const;
export const CLARIFICATION_NEEDED_EVENT_TYPE = 'clarification-needed' as const;
export const HUMAN_APPROVAL_REQUIRED_EVENT_TYPE = 'human-approval-required' as const;
export const GUIDANCE_QUEUED_EVENT_TYPE = 'guidance-queued' as const;
export const RUN_CANCELLED_EVENT_TYPE = 'run-cancelled' as const;
export const USER_INTERRUPT_EVENT_TYPE = 'user-interrupt' as const;
export const GUIDANCE_QUEUE_RUN_ORCHESTRATION_CONTRACT = 'guidance-queue/run-orchestration' as const;
export const PROCESS_EVENTS_SCHEMA_VERSION = 'sciforge.process-events.v1' as const;

export const PROCESS_PROGRESS_PHASE = {
  READ: 'read',
  WRITE: 'write',
  EXECUTE: 'execute',
  WAIT: 'wait',
  PLAN: 'plan',
  COMPLETE: 'complete',
  ERROR: 'error',
  OBSERVE: 'observe',
} as const;

export const PROCESS_PROGRESS_PHASES = Object.values(PROCESS_PROGRESS_PHASE);

export const PROCESS_PROGRESS_STATUS = {
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
} as const;

export const PROCESS_PROGRESS_STATUSES = Object.values(PROCESS_PROGRESS_STATUS);

export const PROCESS_PROGRESS_REASON = {
  BACKEND_WAITING: 'backend-waiting',
  REQUEST_ACCEPTED_BEFORE_BACKEND_STREAM: 'request-accepted-before-backend-stream',
} as const;

export const RUNTIME_HEALTH_STATUS = {
  CHECKING: 'checking',
  ONLINE: 'online',
  OFFLINE: 'offline',
  OPTIONAL: 'optional',
  NOT_CONFIGURED: 'not-configured',
} as const;

export const RUNTIME_HEALTH_STATUSES = Object.values(RUNTIME_HEALTH_STATUS);

export type ProcessProgressPhase = typeof PROCESS_PROGRESS_PHASE[keyof typeof PROCESS_PROGRESS_PHASE];
export type ProcessProgressReason = typeof PROCESS_PROGRESS_REASON[keyof typeof PROCESS_PROGRESS_REASON];
export type ProcessProgressStatus = typeof PROCESS_PROGRESS_STATUS[keyof typeof PROCESS_PROGRESS_STATUS];
export type RuntimeInteractionProgressEventType =
  | typeof PROCESS_PROGRESS_EVENT_TYPE
  | typeof INTERACTION_REQUEST_EVENT_TYPE
  | typeof CLARIFICATION_NEEDED_EVENT_TYPE
  | typeof HUMAN_APPROVAL_REQUIRED_EVENT_TYPE
  | typeof GUIDANCE_QUEUED_EVENT_TYPE
  | typeof RUN_CANCELLED_EVENT_TYPE;
export type RuntimeInteractionProgressStatus = 'pending' | 'running' | 'blocked' | 'completed' | 'failed' | 'cancelled';
export type RuntimeInteractionProgressImportance = 'low' | 'normal' | 'high' | 'blocking';
export type RuntimeInteractionKind = 'clarification' | 'human-approval' | 'guidance' | string;
export type RuntimeHealthStatus = typeof RUNTIME_HEALTH_STATUS[keyof typeof RUNTIME_HEALTH_STATUS];

export interface RuntimeRequestAcceptedProgressCopy {
  detail: string;
  waitingFor: string;
  nextStep: string;
  reason: typeof PROCESS_PROGRESS_REASON.REQUEST_ACCEPTED_BEFORE_BACKEND_STREAM;
}

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
  reason?: ProcessProgressReason | string;
  recoveryHint?: string;
  canAbort?: boolean;
  canContinue?: boolean;
  status: ProcessProgressStatus;
}

export interface RuntimeInteractionRequest {
  id?: string;
  kind: RuntimeInteractionKind;
  required?: boolean;
}

export interface RuntimeInteractionProgressBudget {
  elapsedMs?: number;
  remainingMs?: number;
  retryCount?: number;
  maxRetries?: number;
  maxWallMs?: number;
}

export interface RuntimeInteractionProgressEvent {
  schemaVersion: typeof INTERACTION_PROGRESS_EVENT_SCHEMA_VERSION;
  type: RuntimeInteractionProgressEventType;
  runState?: string;
  requestId?: string;
  runId?: string;
  traceRef?: string;
  phase?: string;
  status?: RuntimeInteractionProgressStatus;
  importance?: RuntimeInteractionProgressImportance;
  reason?: string;
  cancellationReason?: RunTerminationReason;
  budget?: RuntimeInteractionProgressBudget;
  interaction?: RuntimeInteractionRequest;
  termination?: RunTerminationRecord;
}

export interface RuntimeInteractionProgressPresentation {
  label: string;
  detail: string;
  phase?: string;
  status?: RuntimeInteractionProgressStatus;
  reason?: string;
  interaction?: RuntimeInteractionRequest;
  termination?: RunTerminationRecord;
}

export const STANDARD_INTERACTION_PROGRESS_EVENT_TYPES: readonly RuntimeInteractionProgressEventType[] = [
  PROCESS_PROGRESS_EVENT_TYPE,
  INTERACTION_REQUEST_EVENT_TYPE,
  CLARIFICATION_NEEDED_EVENT_TYPE,
  HUMAN_APPROVAL_REQUIRED_EVENT_TYPE,
  GUIDANCE_QUEUED_EVENT_TYPE,
  RUN_CANCELLED_EVENT_TYPE,
];

export function compactRuntimePromptSummary(prompt: string, limit = 160) {
  return prompt.replace(/\s+/g, ' ').trim().slice(0, limit);
}

export function runtimeRequestAcceptedProgressCopy(prompt: string): RuntimeRequestAcceptedProgressCopy {
  const compactPrompt = compactRuntimePromptSummary(prompt);
  return {
    detail: compactPrompt
      ? `正在把本轮请求交给 workspace runtime：${compactPrompt}`
      : '正在把本轮请求交给 workspace runtime。',
    waitingFor: 'workspace runtime 首个事件',
    nextStep: '收到后端事件后继续展示读取、执行、写入和验证进展。',
    reason: PROCESS_PROGRESS_REASON.REQUEST_ACCEPTED_BEFORE_BACKEND_STREAM,
  };
}

export function runtimeInteractionProgressEventFromUnknown(value: unknown): RuntimeInteractionProgressEvent | undefined {
  const record = isRecord(value) ? value : undefined;
  if (!record || record.schemaVersion !== INTERACTION_PROGRESS_EVENT_SCHEMA_VERSION) return undefined;
  const type = asString(record.type);
  if (!isRuntimeInteractionProgressEventType(type)) return undefined;
  const cancellationReason = normalizeRunTerminationReasonValue(asString(record.cancellationReason));
  const termination = isRunTerminationRecord(record.termination)
    ? record.termination
    : cancellationReason
      ? normalizeRunTermination({ cancellationReason, detail: asString(record.reason) })
      : undefined;
  return {
    schemaVersion: INTERACTION_PROGRESS_EVENT_SCHEMA_VERSION,
    type,
    runState: asString(record.runState),
    requestId: asString(record.requestId),
    runId: asString(record.runId),
    traceRef: asString(record.traceRef),
    phase: asString(record.phase),
    status: normalizeRuntimeInteractionProgressStatus(asString(record.status)),
    importance: normalizeRuntimeInteractionProgressImportance(asString(record.importance)),
    reason: asString(record.reason),
    cancellationReason,
    budget: normalizeRuntimeInteractionProgressBudget(record.budget),
    interaction: normalizeRuntimeInteractionRequest(record.interaction),
    termination,
  };
}

export function runtimeInteractionProgressEventFromCompactRecord(value: unknown): RuntimeInteractionProgressEvent | undefined {
  const normalized = runtimeInteractionProgressEventFromUnknown(value);
  if (normalized) return normalized;
  const record = isRecord(value) ? value : undefined;
  if (!record) return undefined;
  const type = asString(record.type);
  if (!isRuntimeInteractionProgressEventType(type)) return undefined;
  const detail = asString(record.detail) ?? asString(record.summary);
  const structured = parseRuntimeInteractionProgressDetail(detail);
  if (!structured) return undefined;
  const cancellationReason = normalizeRunTerminationReasonValue(asString(record.cancellationReason) ?? structured?.cancellation);
  const interaction = normalizeRuntimeInteractionRequest(record.interaction)
    ?? normalizeRuntimeInteractionRequest(structured?.interaction ? { kind: structured.interaction.kind, required: structured.interaction.required } : undefined);
  const termination = isRunTerminationRecord(record.termination)
    ? record.termination
    : cancellationReason
      ? normalizeRunTermination({ cancellationReason, detail: asString(record.reason) ?? structured?.reason })
      : undefined;
  return {
    schemaVersion: INTERACTION_PROGRESS_EVENT_SCHEMA_VERSION,
    type,
    runState: asString(record.runState),
    requestId: asString(record.requestId),
    runId: asString(record.runId),
    traceRef: asString(record.traceRef),
    phase: asString(record.phase) ?? structured?.phase,
    status: normalizeRuntimeInteractionProgressStatus(asString(record.status) ?? structured?.status),
    importance: normalizeRuntimeInteractionProgressImportance(asString(record.importance)),
    reason: asString(record.reason) ?? structured?.reason,
    cancellationReason,
    budget: normalizeRuntimeInteractionProgressBudget(record.budget),
    interaction,
    termination,
  };
}

export function runtimeInteractionProgressPresentation(value: unknown): RuntimeInteractionProgressPresentation | undefined {
  const event = runtimeInteractionProgressEventFromUnknown(value);
  if (!event) return undefined;
  const phase = event.phase ?? event.type;
  const parts = [
    `Phase: ${phase}`,
    event.status ? `Status: ${event.status}` : '',
    event.reason ? `Reason: ${event.reason}` : '',
    event.cancellationReason ? `Cancellation: ${event.cancellationReason}` : '',
    event.interaction ? `Interaction: ${event.interaction.kind}${event.interaction.required === undefined ? '' : event.interaction.required ? ' required' : ' optional'}` : '',
    runtimeInteractionProgressBudgetSummary(event.budget),
  ].filter(Boolean);
  return {
    label: interactionProgressEventLabel(event.type),
    detail: parts.join('\n'),
    phase: event.phase,
    status: event.status,
    reason: event.reason,
    interaction: event.interaction,
    termination: event.termination,
  };
}

export function runtimeInteractionProgressBudgetSummary(budget: RuntimeInteractionProgressBudget | undefined) {
  if (!budget) return '';
  const parts = [
    budget.elapsedMs !== undefined ? `elapsed ${budget.elapsedMs}ms` : '',
    budget.remainingMs !== undefined ? `remaining ${budget.remainingMs}ms` : '',
    budget.retryCount !== undefined || budget.maxRetries !== undefined
      ? `retries ${budget.retryCount ?? '?'}/${budget.maxRetries ?? '?'}`
      : '',
    budget.maxWallMs !== undefined ? `max wall ${budget.maxWallMs}ms` : '',
  ].filter(Boolean);
  return parts.length ? `Budget: ${parts.join(', ')}` : '';
}

function interactionProgressEventLabel(type: RuntimeInteractionProgressEventType) {
  if (type === PROCESS_PROGRESS_EVENT_TYPE) return '过程';
  if (type === CLARIFICATION_NEEDED_EVENT_TYPE) return '需要澄清';
  if (type === HUMAN_APPROVAL_REQUIRED_EVENT_TYPE) return '需要确认';
  if (type === INTERACTION_REQUEST_EVENT_TYPE) return '需要交互';
  if (type === GUIDANCE_QUEUED_EVENT_TYPE) return '引导已排队';
  if (type === RUN_CANCELLED_EVENT_TYPE) return '运行取消';
  return 'Workspace Runtime';
}

function isRuntimeInteractionProgressEventType(value: string | undefined): value is RuntimeInteractionProgressEventType {
  return Boolean(value && STANDARD_INTERACTION_PROGRESS_EVENT_TYPES.includes(value as RuntimeInteractionProgressEventType));
}

function normalizeRuntimeInteractionProgressStatus(value: string | undefined): RuntimeInteractionProgressStatus | undefined {
  if (value === 'pending' || value === 'running' || value === 'blocked' || value === 'completed' || value === 'failed' || value === 'cancelled') return value;
  return undefined;
}

function normalizeRuntimeInteractionProgressImportance(value: string | undefined): RuntimeInteractionProgressImportance | undefined {
  if (value === 'low' || value === 'normal' || value === 'high' || value === 'blocking') return value;
  return undefined;
}

function normalizeRuntimeInteractionRequest(value: unknown): RuntimeInteractionRequest | undefined {
  const record = isRecord(value) ? value : undefined;
  const kind = asString(record?.kind);
  if (!record || !kind) return undefined;
  return {
    id: asString(record.id),
    kind,
    required: typeof record.required === 'boolean' ? record.required : undefined,
  };
}

function parseRuntimeInteractionProgressDetail(value: string | undefined): {
  phase?: string;
  status?: string;
  reason?: string;
  cancellation?: string;
  interaction?: { kind: RuntimeInteractionKind; required?: boolean };
} | undefined {
  if (!value || (!/\bPhase:\s*/.test(value) && !/\bStatus:\s*/.test(value) && !/\bInteraction:\s*/.test(value) && !/\bCancellation:\s*/.test(value))) {
    return undefined;
  }
  const interactionText = firstStructuredField(value, 'Interaction');
  const interaction = interactionText ? parseInteractionField(interactionText) : undefined;
  const parsed = {
    phase: firstStructuredField(value, 'Phase'),
    status: firstStructuredField(value, 'Status'),
    reason: firstStructuredField(value, 'Reason'),
    cancellation: firstStructuredField(value, 'Cancellation'),
    interaction,
  };
  return Object.values(parsed).some((entry) => entry !== undefined) ? parsed : undefined;
}

function parseInteractionField(value: string): { kind: RuntimeInteractionKind; required?: boolean } | undefined {
  const [kind, modifier] = value.trim().split(/\s+/, 2);
  if (!kind) return undefined;
  return {
    kind,
    required: modifier === 'required' ? true : modifier === 'optional' ? false : undefined,
  };
}

function firstStructuredField(value: string, name: string) {
  const match = value.match(new RegExp(`${name}:\\s*([^\\n]+)`));
  return match?.[1]?.trim();
}

function normalizeRuntimeInteractionProgressBudget(value: unknown): RuntimeInteractionProgressBudget | undefined {
  const record = isRecord(value) ? value : undefined;
  if (!record) return undefined;
  const budget = {
    elapsedMs: finiteNumber(record.elapsedMs),
    remainingMs: finiteNumber(record.remainingMs),
    retryCount: nonNegativeInteger(record.retryCount),
    maxRetries: nonNegativeInteger(record.maxRetries),
    maxWallMs: finiteNumber(record.maxWallMs),
  };
  return Object.values(budget).some((entry) => entry !== undefined) ? budget : undefined;
}

function finiteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : undefined;
}

function nonNegativeInteger(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}
