export type RuntimeVerificationVerdict = 'pass' | 'fail' | 'uncertain' | 'needs-human' | 'unverified';

export interface RuntimeVerificationResult {
  id?: string;
  verdict: RuntimeVerificationVerdict;
  reward?: number;
  confidence: number;
  critique?: string;
  evidenceRefs: string[];
  repairHints: string[];
  diagnostics?: Record<string, unknown>;
}

export const VERIFICATION_RESULT_CONTRACT_ID = 'sciforge.verification-result.v1';
export const VERIFICATION_RESULT_SCHEMA_PATH = 'packages/contracts/runtime/verification-result.ts#normalizeRuntimeVerificationResults';
export const VERIFICATION_RESULT_ARTIFACT_TYPE = 'verification-result' as const;

export interface RuntimeVerificationArtifactRecord {
  id?: unknown;
  type?: unknown;
  dataRef?: unknown;
  metadata?: unknown;
  data?: unknown;
}

export function normalizeRuntimeVerificationResults(value: unknown): RuntimeVerificationResult[] {
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

export function normalizeRuntimeVerificationVerdict(value: unknown): RuntimeVerificationVerdict | undefined {
  return value === 'pass' || value === 'fail' || value === 'uncertain' || value === 'needs-human' || value === 'unverified'
    ? value
    : undefined;
}

export function failedRuntimeVerificationResults(value: unknown) {
  return normalizeRuntimeVerificationResults(value)
    .filter((result) => result.verdict === 'fail' || result.verdict === 'needs-human');
}

export function verificationResultFailureMessages(value: unknown) {
  return failedRuntimeVerificationResults(value).map((result, index) => {
    const id = result.id ? `${result.id} ` : '';
    const critique = result.critique ? `: ${result.critique}` : '';
    return `verificationResults[${index}] ${id}verdict=${result.verdict}${critique}`;
  });
}

export function verificationResultFailureActual(value: unknown) {
  return failedRuntimeVerificationResults(value).map((result) => ({
    id: result.id,
    verdict: result.verdict,
    critique: result.critique,
    evidenceRefs: result.evidenceRefs,
    repairHints: result.repairHints,
  }));
}

export function isRuntimeVerificationResultArtifact(value: unknown): value is RuntimeVerificationArtifactRecord {
  if (!isRecord(value)) return false;
  return String(value.type || value.id || '') === VERIFICATION_RESULT_ARTIFACT_TYPE;
}

export function runtimeVerificationResultArtifacts(value: unknown): RuntimeVerificationArtifactRecord[] {
  return Array.isArray(value) ? value.filter(isRuntimeVerificationResultArtifact) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toStringList(value: unknown) {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0) : [];
}
