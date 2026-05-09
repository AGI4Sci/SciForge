import type { VerificationResult, VerificationVerdict } from '../runtime-types.js';
import { isRecord, toStringList } from '../gateway-utils.js';
import { contractValidationFailureFromErrors } from './payload-validation.js';

export function normalizeRuntimeVerificationResults(value: unknown): VerificationResult[] {
  const values = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return values.flatMap((entry) => {
    if (Array.isArray(entry)) return normalizeRuntimeVerificationResults(entry);
    if (!isRecord(entry)) return [];
    const verdict = normalizeRuntimeVerificationVerdict(entry.verdict);
    if (!verdict) return [];
    return [{
      id: typeof entry.id === 'string' ? entry.id : undefined,
      verdict,
      reward: typeof entry.reward === 'number' ? entry.reward : 0,
      confidence: typeof entry.confidence === 'number' ? entry.confidence : 0,
      critique: typeof entry.critique === 'string' ? entry.critique : typeof entry.reason === 'string' ? entry.reason : '',
      evidenceRefs: toStringList(entry.evidenceRefs),
      repairHints: toStringList(entry.repairHints),
      diagnostics: isRecord(entry.diagnostics) ? entry.diagnostics : undefined,
    }];
  });
}

export function normalizeRuntimeVerificationResultsOrUndefined(value: unknown) {
  const results = normalizeRuntimeVerificationResults(value);
  return results.length ? results : undefined;
}

export function normalizeRuntimeVerificationVerdict(value: unknown): VerificationVerdict | undefined {
  return value === 'pass' || value === 'fail' || value === 'uncertain' || value === 'needs-human' || value === 'unverified'
    ? value
    : undefined;
}

export function contractValidationFailureFromVerificationResults(
  value: unknown,
  options: {
    capabilityId: string;
    relatedRefs?: string[];
  },
) {
  const failures = normalizeRuntimeVerificationResults(value)
    .filter((result) => result.verdict === 'fail' || result.verdict === 'needs-human');
  if (!failures.length) return undefined;
  return contractValidationFailureFromErrors(failures.map((result, index) => {
    const id = result.id ? `${result.id} ` : '';
    const critique = result.critique ? `: ${result.critique}` : '';
    return `verificationResults[${index}] ${id}verdict=${result.verdict}${critique}`;
  }), {
    capabilityId: options.capabilityId,
    failureKind: 'verifier',
    schemaPath: 'src/runtime/gateway/verification-results.ts#normalizeRuntimeVerificationResults',
    contractId: 'sciforge.verification-result.v1',
    expected: 'Required verifier path supplies verdict=pass or explicit human approval before completion',
    actual: failures.map((result) => ({
      id: result.id,
      verdict: result.verdict,
      critique: result.critique,
      evidenceRefs: result.evidenceRefs,
      repairHints: result.repairHints,
    })),
    relatedRefs: options.relatedRefs,
  });
}
