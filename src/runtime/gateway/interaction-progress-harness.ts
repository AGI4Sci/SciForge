import type {
  HarnessInteractionProgressEvent,
  HarnessInteractionProgressEventType,
  HarnessProgressEventImportance,
  HarnessProgressPhaseStatus,
  HarnessRunCancellationReason,
  HarnessRunState,
  ProgressInteractionRequest,
  ProgressPlan,
} from '../../../packages/agent-harness/src/contracts.js';
import { normalizeRunTermination } from '@sciforge-ui/runtime-contract';

export const STANDARD_INTERACTION_PROGRESS_EVENT_TYPES: readonly HarnessInteractionProgressEventType[] = [
  'process-progress',
  'interaction-request',
  'clarification-needed',
  'human-approval-required',
  'guidance-queued',
  'run-cancelled',
];

export interface InteractionProgressProjectionInput {
  progressPlan: ProgressPlan;
  type: HarnessInteractionProgressEventType;
  requestId?: string;
  runId?: string;
  traceRef?: string;
  phase?: string;
  status?: HarnessProgressPhaseStatus;
  importance?: HarnessProgressEventImportance;
  reason?: string;
  cancellationReason?: HarnessRunCancellationReason;
  interaction?: ProgressInteractionRequest;
  budget?: HarnessInteractionProgressEvent['budget'];
}

export function projectInteractionProgressEvent(input: InteractionProgressProjectionInput): HarnessInteractionProgressEvent {
  assertStandardEventType(input.type);
  const phase = input.phase ?? firstProgressPhase(input.progressPlan);
  const cancellationReason = input.cancellationReason ?? cancellationReasonForEvent(input.progressPlan, input.type);
  const termination = cancellationReason
    ? normalizeRunTermination({ cancellationReason, detail: input.reason })
    : undefined;
  const event: HarnessInteractionProgressEvent = {
    schemaVersion: 'sciforge.interaction-progress-event.v1',
    type: input.type,
    runState: termination?.runState ?? runStateForEventType(input.type, cancellationReason),
    requestId: input.requestId,
    runId: input.runId,
    traceRef: input.traceRef,
    phase,
    status: input.status ?? termination?.progressStatus ?? statusForEventType(input.type),
    importance: input.importance ?? importanceForEventType(input.type),
    reason: input.reason,
    budget: input.budget,
    cancellationReason,
    termination,
    interaction: input.interaction ?? interactionForEventType(input.type),
  };
  return stripUndefined(event);
}

export function projectRunStateFromInteractionProgressEvent(event: HarnessInteractionProgressEvent): HarnessRunState {
  if (event.termination?.runState) return event.termination.runState;
  return runStateForEventType(event.type, event.cancellationReason);
}

function assertStandardEventType(type: HarnessInteractionProgressEventType): void {
  if (!STANDARD_INTERACTION_PROGRESS_EVENT_TYPES.includes(type)) {
    throw new Error(`Unsupported interaction progress event type: ${type}`);
  }
}

function firstProgressPhase(progressPlan: ProgressPlan): string {
  return progressPlan.phaseNames?.[0] ?? progressPlan.visibleMilestones[0] ?? 'run';
}

function cancellationReasonForEvent(progressPlan: ProgressPlan, type: HarnessInteractionProgressEventType): HarnessRunCancellationReason | undefined {
  if (type !== 'run-cancelled') return undefined;
  return progressPlan.cancelPolicy?.userCancellation ?? 'user-cancelled';
}

function statusForEventType(type: HarnessInteractionProgressEventType): HarnessProgressPhaseStatus {
  if (type === 'run-cancelled') return 'cancelled';
  if (type === 'interaction-request' || type === 'clarification-needed' || type === 'human-approval-required') return 'blocked';
  return 'running';
}

function importanceForEventType(type: HarnessInteractionProgressEventType): HarnessProgressEventImportance {
  if (type === 'human-approval-required') return 'blocking';
  if (type === 'clarification-needed' || type === 'interaction-request' || type === 'run-cancelled') return 'high';
  return 'normal';
}

function interactionForEventType(type: HarnessInteractionProgressEventType): ProgressInteractionRequest | undefined {
  if (type === 'clarification-needed') return { id: 'clarification', kind: 'clarification', required: true };
  if (type === 'human-approval-required') return { id: 'human-approval', kind: 'human-approval', required: true };
  if (type === 'guidance-queued') return { id: 'guidance', kind: 'guidance', required: false };
  if (type === 'interaction-request') return { id: 'interaction', kind: 'clarification', required: true };
  return undefined;
}

function runStateForEventType(type: HarnessInteractionProgressEventType, cancellationReason?: HarnessRunCancellationReason): HarnessRunState {
  if (type === 'run-cancelled') return cancellationReason === 'backend-error' ? 'failed' : 'cancelled';
  if (type === 'human-approval-required' || type === 'clarification-needed' || type === 'interaction-request') return 'awaiting-interaction';
  if (type === 'guidance-queued') return 'guidance-queued';
  return 'running';
}

function stripUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}
