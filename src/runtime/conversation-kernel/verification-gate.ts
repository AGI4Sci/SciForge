import type { ConversationKernelDiagnostic, VerificationState } from './types';

export function validateVerificationGate(input: {
  required: boolean;
  verification: VerificationState | undefined;
}): ConversationKernelDiagnostic | undefined {
  if (!input.required) return undefined;
  if (input.verification?.status === 'verified' && input.verification.verifierRef) return undefined;
  return {
    severity: 'error',
    code: 'verification-ref-required',
    message: 'Verified state requires a verifier evidence ref; otherwise the result must be presented as unverified.',
  };
}
