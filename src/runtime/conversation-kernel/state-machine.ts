import type {
  ConversationEvent,
  ConversationEventLog,
  ConversationKernelStatus,
  ConversationState,
} from './types';
import { classifyFailureOwner } from './failure-classifier';

const terminalStatuses = new Set<ConversationKernelStatus>([
  'satisfied',
  'degraded-result',
  'external-blocked',
  'repair-needed',
  'needs-human',
]);

export function replayConversationState(log: ConversationEventLog): ConversationState {
  let state: ConversationState = {
    schemaVersion: 'sciforge.conversation-state.v1',
    conversationId: log.conversationId,
    status: 'idle',
    terminal: false,
    diagnostics: [],
    verification: { status: 'unverified' },
  };

  for (const event of log.events) {
    state = applyConversationEvent(state, event);
  }

  return {
    ...state,
    terminal: terminalStatuses.has(state.status),
  };
}

export function applyConversationEvent(state: ConversationState, event: ConversationEvent): ConversationState {
  const next: ConversationState = {
    ...state,
    currentTurnId: event.turnId ?? state.currentTurnId,
    activeRunId: event.runId ?? state.activeRunId,
  };

  switch (event.type) {
    case 'TurnReceived':
      return { ...next, status: 'planned', terminal: false };
    case 'Planned':
    case 'HarnessDecisionRecorded':
      return { ...next, status: 'planned', terminal: false };
    case 'Dispatched':
      return { ...next, status: 'dispatched', terminal: false };
    case 'PartialReady':
      return { ...next, status: 'partial-ready', terminal: false };
    case 'OutputMaterialized':
      return { ...next, status: 'output-materialized', terminal: false };
    case 'Validated':
      return { ...next, status: 'validated', terminal: false };
    case 'Satisfied':
      return { ...next, status: 'satisfied', terminal: true };
    case 'DegradedResult':
      return { ...next, status: 'degraded-result', terminal: true };
    case 'ExternalBlocked':
      return withFailure(next, 'external-blocked', event, 'external-provider');
    case 'RepairNeeded':
      return withFailure(next, 'repair-needed', event);
    case 'NeedsHuman':
      return { ...next, status: 'needs-human', terminal: true };
    case 'BackgroundRunning':
      return {
        ...next,
        status: 'background-running',
        terminal: false,
        background: backgroundFromEvent(event, 'running'),
      };
    case 'BackgroundCompleted':
      return {
        ...next,
        status: 'degraded-result',
        terminal: true,
        background: backgroundFromEvent(event, 'completed'),
      };
    case 'VerificationRecorded':
      return {
        ...next,
        verification: verificationFromEvent(event),
      };
  }
}

function withFailure(
  state: ConversationState,
  status: ConversationKernelStatus,
  event: ConversationEvent,
  layerHint?: Parameters<typeof classifyFailureOwner>[0]['layerHint'],
): ConversationState {
  const reason = typeof event.payload.reason === 'string'
    ? event.payload.reason
    : typeof event.payload.failureReason === 'string'
      ? event.payload.failureReason
      : undefined;
  const evidenceRefs = event.storage === 'ref'
    ? event.payload.refs.map((ref) => ref.ref)
    : Array.isArray(event.payload.evidenceRefs)
      ? event.payload.evidenceRefs.filter((ref): ref is string => typeof ref === 'string')
      : [];
  const failureOwner = classifyFailureOwner({ reason, evidenceRefs, layerHint });
  return {
    ...state,
    status,
    terminal: true,
    failureOwner,
    diagnostics: [
      ...state.diagnostics,
      {
        severity: 'error',
        code: failureOwner.ownerLayer,
        eventId: event.id,
        message: failureOwner.reason,
      },
    ],
  };
}

function backgroundFromEvent(event: ConversationEvent, fallbackStatus: NonNullable<ConversationState['background']>['status']) {
  const checkpointRefs = event.storage === 'ref'
    ? event.payload.refs.map((ref) => ref.ref)
    : Array.isArray(event.payload.checkpointRefs)
      ? event.payload.checkpointRefs.filter((ref): ref is string => typeof ref === 'string')
      : [];
  return {
    status: event.type === 'BackgroundCompleted' ? 'completed' as const : fallbackStatus,
    checkpointRefs,
    revisionPlan: typeof event.payload.revisionPlan === 'string' ? event.payload.revisionPlan : undefined,
  };
}

function verificationFromEvent(event: ConversationEvent): NonNullable<ConversationState['verification']> {
  const verifierRef = event.storage === 'ref' ? event.payload.refs[0]?.ref : stringOrUndefined(event.payload.verifierRef);
  const verdict = stringOrUndefined(event.payload.verdict);
  if (verdict === 'failed') return { status: 'failed', verifierRef, verdict };
  if (verifierRef) return { status: 'verified', verifierRef, verdict };
  return { status: 'not-required', verdict };
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
