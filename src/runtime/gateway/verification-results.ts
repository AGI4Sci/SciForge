import type { VerificationResult, VerificationVerdict } from '../runtime-types.js';
import { isRecord, toStringList } from '../gateway-utils.js';

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
