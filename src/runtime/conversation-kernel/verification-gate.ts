import type { ConversationEvent, ConversationKernelDiagnostic, VerificationState } from './types';

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

export function validateVerificationRecordedEvent(event: ConversationEvent): ConversationKernelDiagnostic | undefined {
  if (event.type !== 'VerificationRecorded') return undefined;
  const verifierRef = event.storage === 'ref' && Array.isArray(event.payload.refs) ? event.payload.refs[0]?.ref : undefined;
  if (verifierRef) return undefined;
  return {
    severity: 'error',
    code: 'verification-ref-required',
    eventId: event.id,
    message: 'VerificationRecorded must carry a verifier evidence ref; otherwise projection remains unverified.',
  };
}
