import type { BackgroundState, ConversationKernelDiagnostic } from './types';

export function validateBackgroundContinuation(state: BackgroundState | undefined): ConversationKernelDiagnostic | undefined {
  if (!state || state.status === 'cancelled') return undefined;
  if (state.checkpointRefs.length > 0 && state.revisionPlan) return undefined;
  return {
    severity: 'error',
    code: 'background-checkpoint-required',
    message: 'Background continuation must expose checkpoint refs and a revision plan before it can be restored.',
  };
}
