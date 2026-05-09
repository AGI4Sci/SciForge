import {
  normalizeRuntimeVerificationResults as normalizeRuntimeVerificationResultsFromContract,
  normalizeRuntimeVerificationResultsOrUndefined as normalizeRuntimeVerificationResultsOrUndefinedFromContract,
  normalizeRuntimeVerificationVerdict as normalizeRuntimeVerificationVerdictFromContract,
  VERIFICATION_RESULT_CONTRACT_ID,
  VERIFICATION_RESULT_SCHEMA_PATH,
  verificationResultFailureActual,
  verificationResultFailureMessages,
} from '@sciforge-ui/runtime-contract/verification-result';
import type { VerificationResult, VerificationVerdict } from '../runtime-types.js';
import { contractValidationFailureFromErrors } from './payload-validation.js';

export function normalizeRuntimeVerificationResults(value: unknown): VerificationResult[] {
  return normalizeRuntimeVerificationResultsFromContract(value) as VerificationResult[];
}

export function normalizeRuntimeVerificationResultsOrUndefined(value: unknown) {
  return normalizeRuntimeVerificationResultsOrUndefinedFromContract(value) as VerificationResult[] | undefined;
}

export function normalizeRuntimeVerificationVerdict(value: unknown): VerificationVerdict | undefined {
  return normalizeRuntimeVerificationVerdictFromContract(value) as VerificationVerdict | undefined;
}

export function contractValidationFailureFromVerificationResults(
  value: unknown,
  options: {
    capabilityId: string;
    relatedRefs?: string[];
  },
) {
  const errors = verificationResultFailureMessages(value);
  if (!errors.length) return undefined;
  return contractValidationFailureFromErrors(errors, {
    capabilityId: options.capabilityId,
    failureKind: 'verifier',
    schemaPath: VERIFICATION_RESULT_SCHEMA_PATH,
    contractId: VERIFICATION_RESULT_CONTRACT_ID,
    expected: 'Required verifier path supplies verdict=pass or explicit human approval before completion',
    actual: verificationResultFailureActual(value),
    relatedRefs: options.relatedRefs,
  });
}
