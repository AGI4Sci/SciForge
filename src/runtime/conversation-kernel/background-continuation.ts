import type { BackgroundState, ConversationEvent, ConversationKernelDiagnostic } from './types';

export function validateBackgroundContinuation(state: BackgroundState | undefined): ConversationKernelDiagnostic | undefined {
  if (!state || state.status === 'cancelled') return undefined;
  const hasRestorePlan = state.checkpointRefs.length > 0 && state.revisionPlan.trim().length > 0;
  if (state.status === 'completed' && hasRestorePlan) return undefined;
  if (hasRestorePlan && state.foregroundPartialRef) return undefined;
  return {
    severity: 'error',
    code: 'background-checkpoint-required',
    message: 'Background continuation must record checkpoint refs, a revision plan, and the foreground partial ref before it can be restored.',
  };
}

export function validateBackgroundContinuationEvent(event: ConversationEvent): ConversationKernelDiagnostic | undefined {
  if (event.type !== 'BackgroundRunning' && event.type !== 'BackgroundCompleted') return undefined;

  const checkpointRefs = event.storage === 'ref' && Array.isArray(event.payload.refs)
    ? event.payload.refs.map((ref) => ref.ref).filter(Boolean)
    : [];
  const revisionPlan = stringField(event.payload.revisionPlan);
  const foregroundPartialRef = stringField(event.payload.foregroundPartialRef);

  const completed = event.type === 'BackgroundCompleted';
  const valid = checkpointRefs.length > 0 && revisionPlan && (completed || foregroundPartialRef);
  if (valid) return undefined;

  return {
    severity: 'error',
    code: 'background-checkpoint-required',
    eventId: event.id,
    message: completed
      ? 'BackgroundCompleted must record checkpoint refs and the revision plan that was completed.'
      : 'BackgroundRunning must record checkpoint refs, a revision plan, and the foreground partial ref.',
  };
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}
