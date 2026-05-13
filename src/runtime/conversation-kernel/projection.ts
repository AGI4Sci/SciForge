import type {
  ConversationEventLog,
  ConversationProjection,
  ConversationRef,
  ConversationState,
  VerificationState,
} from './types';
import { eventRefs, eventSummary } from './event-log';
import { replayConversationState } from './state-machine';

export function projectConversation(log: ConversationEventLog, state: ConversationState = replayConversationState(log)): ConversationProjection {
  const currentTurnEvent = [...log.events].reverse().find((event) => event.type === 'TurnReceived');
  const answerEvent = [...log.events].reverse().find((event) =>
    event.type === 'Satisfied'
    || event.type === 'DegradedResult'
    || event.type === 'ExternalBlocked'
    || event.type === 'RepairNeeded'
    || event.type === 'NeedsHuman'
  );
  const artifacts = uniqueRefs(log.events.flatMap((event) => event.storage === 'ref' ? event.payload.refs : []));
  const auditRefs = uniqueStrings(log.events.flatMap(eventRefs));

  return {
    schemaVersion: 'sciforge.conversation-projection.v1',
    conversationId: log.conversationId,
    currentTurn: currentTurnEvent
      ? {
          id: currentTurnEvent.turnId ?? currentTurnEvent.id,
          prompt: typeof currentTurnEvent.payload.prompt === 'string' ? currentTurnEvent.payload.prompt : undefined,
        }
      : undefined,
    visibleAnswer: answerEvent
      ? {
          status: state.status,
          text: typeof answerEvent.payload.text === 'string' ? answerEvent.payload.text : undefined,
          artifactRefs: answerEvent.storage === 'ref' ? answerEvent.payload.refs.map((ref) => ref.ref) : stringArray(answerEvent.payload.artifactRefs),
          diagnostic: state.failureOwner?.reason,
        }
      : undefined,
    activeRun: state.activeRunId ? { id: state.activeRunId, status: state.status } : undefined,
    artifacts,
    executionProcess: log.events.map((event) => ({
      eventId: event.id,
      type: event.type,
      summary: eventSummary(event),
      timestamp: event.timestamp,
    })),
    recoverActions: recoverActionsForState(state),
    verificationState: state.verification ?? defaultVerification(),
    backgroundState: state.background,
    auditRefs,
    diagnostics: state.diagnostics,
  };
}

function recoverActionsForState(state: ConversationState): string[] {
  if (state.failureOwner) return [state.failureOwner.nextStep];
  if (state.status === 'background-running') return ['Open checkpoint refs while background revision continues.'];
  if (state.status === 'degraded-result') return ['Reuse available refs or request a supplement for missing evidence.'];
  return [];
}

function defaultVerification(): VerificationState {
  return { status: 'unverified' };
}

function uniqueRefs(refs: ConversationRef[]): ConversationRef[] {
  const seen = new Set<string>();
  const out: ConversationRef[] = [];
  for (const ref of refs) {
    if (seen.has(ref.ref)) continue;
    seen.add(ref.ref);
    out.push(ref);
  }
  return out;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}
