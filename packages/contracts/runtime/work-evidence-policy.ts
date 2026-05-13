import {
  bibliographicVerificationPolicyScopeEnabled,
  valueDeclaresBibliographicVerificationPolicy,
} from './artifact-policy';
import { collectWorkEvidence, type WorkEvidence } from './work-evidence';

export interface WorkEvidencePolicyPayload {
  message?: unknown;
  confidence?: unknown;
  claimType?: unknown;
  evidenceLevel?: unknown;
  reasoningTrace?: unknown;
  claims?: unknown;
  uiManifest?: unknown;
  executionUnits?: unknown;
  artifacts?: unknown;
  workEvidence?: unknown;
}

export interface WorkEvidencePolicyRequest {
  prompt?: unknown;
  skillDomain?: unknown;
  expectedArtifactTypes?: unknown;
  selectedComponentIds?: unknown;
  selectedCapabilityIds?: unknown;
  expectedEvidenceKinds?: unknown;
  externalIoRequired?: unknown;
}

export interface WorkEvidencePolicyFinding {
  kind:
    | 'external-empty-result-without-diagnostics'
    | 'verified-claim-without-evidence'
    | 'command-failed-but-successful-payload'
    | 'fetch-failure-swallowed-by-success'
    | 'external-io-without-durable-evidence-ref'
    | 'referenced-artifact-without-data-contract'
    | 'verified-bibliographic-record-without-evidence';
  severity: 'repair-needed' | 'failed-with-reason';
  reason: string;
}

export const WORK_EVIDENCE_POLICY_CONTRACT_ID = 'sciforge.work-evidence.v1';
export const WORK_EVIDENCE_POLICY_SCHEMA_PATH = 'packages/contracts/runtime/work-evidence-policy.ts#evaluateWorkEvidencePolicy';

export function evaluateWorkEvidencePolicy(
  payload: WorkEvidencePolicyPayload,
  request: WorkEvidencePolicyRequest = {},
): WorkEvidencePolicyFinding | undefined {
  const verifiedClaimWithoutEvidence = claimVerifiedWithoutEvidence(payload);
  if (verifiedClaimWithoutEvidence) {
    return {
      kind: 'verified-claim-without-evidence',
      severity: payloadHasExplicitFailureEvidence(payload) ? 'failed-with-reason' : 'repair-needed',
      reason: 'A claim is marked verified but has no evidenceRefs, rawRef, or WorkEvidence evidence references.',
    };
  }

  if (commandFailedButPayloadSuccessful(payload)) {
    return {
      kind: 'command-failed-but-successful-payload',
      severity: 'repair-needed',
      reason: 'A command reports a non-zero exitCode while the payload is marked as successful or high confidence.',
    };
  }

  if (fetchFailureSwallowedBySuccess(payload)) {
    return {
      kind: 'fetch-failure-swallowed-by-success',
      severity: 'repair-needed',
      reason: 'A fetch timeout, HTTP 429, or rate-limit signal appears in the payload while the final result is still high-confidence success without recovery evidence.',
    };
  }

  if (externalIoWithoutDurableEvidenceRef(payload)) {
    return {
      kind: 'external-io-without-durable-evidence-ref',
      severity: 'repair-needed',
      reason: 'External I/O WorkEvidence is marked successful, partial, or empty but does not include durable evidenceRefs or rawRef.',
    };
  }

  if (referencedArtifactWithoutDataContract(payload)) {
    return {
      kind: 'referenced-artifact-without-data-contract',
      severity: 'repair-needed',
      reason: 'uiManifest references an artifact that is missing both a dataRef and a schema contract.',
    };
  }

  if (verifiedBibliographicRecordWithoutEvidence(payload, request)) {
    return {
      kind: 'verified-bibliographic-record-without-evidence',
      severity: payloadHasExplicitFailureEvidence(payload) ? 'failed-with-reason' : 'repair-needed',
      reason: 'A bibliographic record is marked verified but has no durable provider/raw/evidence refs from an identifier lookup or citation verification run.',
    };
  }

  const emptyExternalRetrieval = externalEmptyResultWithoutDiagnostics(payload, request);
  if (emptyExternalRetrieval) {
    return {
      kind: 'external-empty-result-without-diagnostics',
      severity: 'repair-needed',
      reason: [
        'External retrieval returned zero results while the task marked itself completed.',
        'Treat this as repair-needed until the task records provider status, query/url, retry/fallback attempts, rate-limit diagnostics, or an explicit failed-with-reason payload.',
      ].join(' '),
    };
  }
  return undefined;
}

function externalIoWithoutDurableEvidenceRef(payload: WorkEvidencePolicyPayload) {
  return collectWorkEvidence(payload).some((evidence) => {
    if (!externalRetrievalKind(evidence.kind)) return false;
    if (!['success', 'partial', 'empty'].includes(normalizePolicyToken(evidence.status))) return false;
    return evidence.evidenceRefs.length === 0 && !evidence.rawRef;
  });
}

function externalEmptyResultWithoutDiagnostics(payload: WorkEvidencePolicyPayload, request: WorkEvidencePolicyRequest) {
  if (!requestRequiresExternalRetrievalEvidence(request)) return false;
  if (payloadHasExplicitFailureEvidence(payload)) return false;
  if (workEvidenceHasProviderDiagnostics(payload)) return false;
  return collectWorkEvidence(payload).some((evidence) =>
    externalRetrievalKind(evidence.kind)
    && ['success', 'empty'].includes(normalizePolicyToken(evidence.status))
    && evidence.resultCount === 0
  );
}

const EXTERNAL_RETRIEVAL_EVIDENCE_KIND_SET = new Set(['retrieval', 'fetch', 'external-io', 'provider-lookup', 'identifier-lookup']);
const EXTERNAL_RETRIEVAL_CAPABILITY_ID_SET = new Set([
  'literature.retrieval',
  'pdf.extraction',
  'citation.verification',
  'web.search',
  'web.fetch',
  'metadata-search',
  'full-text-download',
]);

function requestRequiresExternalRetrievalEvidence(request: WorkEvidencePolicyRequest) {
  if (truthyPolicyFlag(request.externalIoRequired)) return true;
  return policyTokensInSet(request.expectedEvidenceKinds, EXTERNAL_RETRIEVAL_EVIDENCE_KIND_SET)
    || policyTokensInSet(request.selectedCapabilityIds, EXTERNAL_RETRIEVAL_CAPABILITY_ID_SET);
}

function externalRetrievalKind(kind: string) {
  return EXTERNAL_RETRIEVAL_EVIDENCE_KIND_SET.has(normalizePolicyToken(kind));
}

function payloadHasExplicitFailureEvidence(payload: WorkEvidencePolicyPayload) {
  if (workEvidenceHasFailureOrRecovery(payload)) return true;
  if ((Array.isArray(payload.executionUnits) ? payload.executionUnits : [])
    .some((unit) => isRecord(unit) && isFailureStatus(unit.status))) {
    return true;
  }
  return false;
}

function claimVerifiedWithoutEvidence(payload: WorkEvidencePolicyPayload) {
  const workEvidence = collectWorkEvidence(payload);
  const payloadRefs = collectEvidenceRefs(payload, workEvidence);
  if (verifiedText(payload.claimType) && payloadRefs.length === 0) return true;
  if (verifiedText(payload.evidenceLevel) && payloadRefs.length === 0) return true;

  const claims = Array.isArray(payload.claims) ? payload.claims : [];
  return claims.some((claim) => {
    if (!isRecord(claim)) return false;
    if (!recordClaimsVerified(claim)) return false;
    return !recordHasDirectEvidenceRefs(claim) && !hasBoundWorkEvidenceRefs(claim, workEvidence);
  });
}

function commandFailedButPayloadSuccessful(payload: WorkEvidencePolicyPayload) {
  return recordsInPayload(payload).some((record) => hasNonZeroExitCode(record)) && payloadMarkedSuccessful(payload);
}

function fetchFailureSwallowedBySuccess(payload: WorkEvidencePolicyPayload) {
  const structuredFailure = collectWorkEvidence(payload).some((evidence) =>
    externalRetrievalKind(evidence.kind) && isFailureStatus(evidence.status)
  ) || (Array.isArray(payload.executionUnits) ? payload.executionUnits : []).filter(isRecord).some((unit) =>
    unit.externalDependencyStatus === 'transient-unavailable'
    || isFailureStatus(unit.status)
  );
  if (!structuredFailure) return false;
  if (!highConfidenceSuccess(payload)) return false;
  if (collectWorkEvidence(payload).some((evidence) => isFailureStatus(evidence.status))) return true;
  return !hasRecoveryEvidence(payload);
}

function referencedArtifactWithoutDataContract(payload: WorkEvidencePolicyPayload) {
  const referencedIds = referencedArtifactIds(payload.uiManifest);
  if (referencedIds.size === 0) return false;
  const artifacts = (Array.isArray(payload.artifacts) ? payload.artifacts : []).filter(isRecord);
  const byId = new Map<string, Record<string, unknown>>();
  for (const artifact of artifacts) {
    const id = artifactId(artifact);
    if (id) byId.set(normalizeArtifactRefId(id), artifact);
    const type = stringField(artifact.type);
    if (type && !byId.has(normalizeArtifactRefId(type))) byId.set(normalizeArtifactRefId(type), artifact);
  }
  for (const referencedId of referencedIds) {
    const artifact = byId.get(referencedId);
    if (!artifact || !hasArtifactDataContract(artifact)) return true;
  }
  return false;
}

function verifiedBibliographicRecordWithoutEvidence(payload: WorkEvidencePolicyPayload, request: WorkEvidencePolicyRequest) {
  const workEvidence = collectWorkEvidence(payload);
  const artifacts = Array.isArray(payload.artifacts) ? payload.artifacts.filter(isRecord) : [];
  const gatedRecords = [
    ...artifacts.flatMap((artifact) => bibliographicArtifactScopeEnabled(artifact, request)
      ? recordsInValue(isRecord(artifact.data) || Array.isArray(artifact.data) ? artifact.data : artifact)
      : []),
    ...recordsInValue(payload).filter(recordDeclaresBibliographicRecordContract),
  ];
  return uniqueRecords(gatedRecords).some((record) => {
    if (!recordClaimsBibliographicVerified(record)) return false;
    return !hasBibliographicVerificationEvidence(record, workEvidence);
  });
}

function bibliographicArtifactScopeEnabled(artifact: Record<string, unknown>, request: WorkEvidencePolicyRequest) {
  if (valueDeclaresBibliographicVerificationPolicy(artifact, 'artifact')) return true;
  if (requestEnablesBibliographicScope(request)) return true;
  const metadata = isRecord(artifact.metadata) ? artifact.metadata : {};
  const schema = isRecord(artifact.schema) ? artifact.schema : {};
  return valueDeclaresBibliographicVerificationPolicy(metadata, 'policy')
    || valueDeclaresBibliographicVerificationPolicy(schema, 'schema');
}

function requestEnablesBibliographicScope(request: WorkEvidencePolicyRequest) {
  return bibliographicVerificationPolicyScopeEnabled({
    skillDomain: request.skillDomain,
    expectedArtifactTypes: request.expectedArtifactTypes,
    selectedComponentIds: request.selectedComponentIds,
    selectedCapabilityIds: request.selectedCapabilityIds,
  });
}

function recordDeclaresBibliographicRecordContract(record: Record<string, unknown>) {
  return valueDeclaresBibliographicVerificationPolicy(record, 'record');
}

function recordClaimsBibliographicVerified(record: Record<string, unknown>) {
  return ['verification_status', 'verificationStatus', 'citationVerificationStatus', 'bibliographicVerificationStatus']
    .some((key) => verifiedText(record[key]))
    || (stringField(record.verified_title) && (truthyMatch(record.title_match) || truthyMatch(record.identifier_match)));
}

function hasBibliographicVerificationEvidence(record: Record<string, unknown>, workEvidence: WorkEvidence[]) {
  return workEvidence.some((evidence) => bibliographicWorkEvidenceMatchesRecord(evidence, record) && workEvidenceHasDurableRefs(evidence));
}

function recordBibliographicIdentifier(record: Record<string, unknown>) {
  return stringField(record.doi)
    ?? stringField(record.pmid)
    ?? stringField(record.trialId)
    ?? stringField(record.trial_id)
    ?? stringField(record.identifier);
}

function bibliographicWorkEvidenceMatchesRecord(evidence: WorkEvidence, record: Record<string, unknown>) {
  if (!bibliographicEvidenceKind(evidence.kind)) return false;
  const recordKeys = new Set(bibliographicRecordBindingKeys(record).map(normalizeBindingText));
  const evidenceKeys = bibliographicEvidenceBindingKeys(evidence).map(normalizeBindingText);
  return evidenceKeys.some((key) => key && recordKeys.has(key));
}

function workEvidenceHasDurableRefs(evidence: WorkEvidence) {
  return evidence.evidenceRefs.some((ref) => ref.trim().length > 0) || Boolean(evidence.rawRef);
}

function bibliographicRecordBindingKeys(record: Record<string, unknown>) {
  return [
    recordBibliographicIdentifier(record),
    stringField(record.id),
    stringField(record.paperId),
    stringField(record.paper_id),
    stringField(record.recordId),
    stringField(record.record_id),
  ].filter((entry): entry is string => Boolean(entry && entry.trim().length >= 3));
}

const BIBLIOGRAPHIC_EVIDENCE_KIND_SET = new Set([
  'citation-verification',
  'bibliographic-verification',
  'identifier-lookup',
  'literature-retrieval',
  'retrieval',
  'fetch',
]);

function bibliographicEvidenceKind(kind: string) {
  return BIBLIOGRAPHIC_EVIDENCE_KIND_SET.has(kind.trim().toLowerCase());
}

function bibliographicEvidenceBindingKeys(evidence: WorkEvidence) {
  const input = isRecord(evidence.input) ? evidence.input : {};
  return [
    stringField(input.doi),
    stringField(input.pmid),
    stringField(input.trialId),
    stringField(input.trial_id),
    stringField(input.identifier),
    stringField(input.recordId),
    stringField(input.record_id),
    stringField(input.paperId),
    stringField(input.paper_id),
    stringField(input.sourceRecordId),
    stringField(input.source_record_id),
    stringField((evidence as WorkEvidence & Record<string, unknown>).recordId),
    stringField((evidence as WorkEvidence & Record<string, unknown>).paperId),
    stringField((evidence as WorkEvidence & Record<string, unknown>).identifier),
  ].filter((entry): entry is string => Boolean(entry && entry.trim().length >= 3));
}

function normalizeBindingText(value: string) {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizePolicyToken(value: unknown) {
  return typeof value === 'string'
    ? value.toLowerCase().trim().replaceAll(/[\s_]+/g, '-')
    : '';
}

function policyTokensInSet(value: unknown, allowed: Set<string>) {
  if (typeof value === 'string') return allowed.has(value.trim().toLowerCase());
  return Array.isArray(value) && value.some((entry) => typeof entry === 'string' && allowed.has(entry.trim().toLowerCase()));
}

function truthyPolicyFlag(value: unknown) {
  if (value === true) return true;
  return typeof value === 'string' && /^(true|required|yes)$/i.test(value.trim());
}

function uniqueRecords(records: Array<Record<string, unknown>>) {
  const seen = new Set<Record<string, unknown>>();
  return records.filter((record) => {
    if (seen.has(record)) return false;
    seen.add(record);
    return true;
  });
}

function truthyMatch(value: unknown) {
  if (typeof value === 'boolean') return value;
  return /^(true|yes|match|matched|pass|passed)$/i.test(String(value || '').trim());
}

function referencedArtifactIds(uiManifest: unknown) {
  const ids = new Set<string>();
  for (const record of recordsInValue(uiManifest)) {
    for (const key of ['artifactId', 'artifactRef', 'artifact', 'dataArtifactId', 'sourceArtifactId']) {
      const value = stringField(record[key]);
      if (value && artifactRefRequiresDataContract(value)) ids.add(normalizeArtifactRefId(value));
    }
  }
  return ids;
}

function artifactRefRequiresDataContract(value: string) {
  const normalized = value.trim().toLowerCase();
  return !(
    normalized.startsWith('runtime:')
    || normalized.startsWith('runtime://')
    || normalized.startsWith('presentation:')
    || normalized.startsWith('result-presentation:')
    || normalized.startsWith('view:')
    || normalized.startsWith('execution-unit:')
    || normalized === 'runtime-result'
    || normalized.endsWith('-runtime-result')
  );
}

function hasArtifactDataContract(artifact: Record<string, unknown>) {
  return Boolean(
    stringField(artifact.dataRef)
    || stringField(artifact.data_ref)
    || stringField(artifact.path)
    || stringField(artifact.ref)
    || hasNonEmptyInlineData(artifact.data)
    || artifact.schema !== undefined
    || artifact.schemaRef !== undefined
    || artifact.schema_ref !== undefined
    || (isRecord(artifact.metadata) && (artifact.metadata.schema !== undefined || artifact.metadata.schemaRef !== undefined))
  );
}

function artifactId(artifact: Record<string, unknown>) {
  return stringField(artifact.id) ?? stringField(artifact.artifactId) ?? stringField(artifact.ref) ?? stringField(artifact.name);
}

function normalizeArtifactRefId(value: string) {
  return value.trim().replace(/^artifact::?/i, '');
}

function hasNonEmptyInlineData(value: unknown) {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (isRecord(value)) return Object.keys(value).length > 0;
  return typeof value === 'number' || typeof value === 'boolean';
}

function payloadMarkedSuccessful(payload: WorkEvidencePolicyPayload) {
  const statuses = recordsInPayload(payload)
    .map((record) => stringField(record.status))
    .filter((value): value is string => Boolean(value));
  const hasFailure = statuses.some(isFailureStatus);
  const hasSuccess = statuses.some(isSuccessStatus);
  return !hasFailure && (hasSuccess || highConfidenceSuccess(payload));
}

function highConfidenceSuccess(payload: WorkEvidencePolicyPayload) {
  if (Number(payload.confidence || 0) < 0.8) return false;
  if (isFailureStatus(payload.claimType)) return false;
  return isSuccessStatus(payload.evidenceLevel)
    || (Array.isArray(payload.executionUnits) ? payload.executionUnits : []).filter(isRecord).some((unit) => isSuccessStatus(unit.status));
}

function workEvidenceHasProviderDiagnostics(payload: WorkEvidencePolicyPayload) {
  return collectWorkEvidence(payload).some((evidence) => {
    if (evidence.provider && evidence.status) return true;
    if (evidence.failureReason) return true;
    return evidence.recoverActions.length > 0;
  });
}

function workEvidenceHasFailureOrRecovery(payload: WorkEvidencePolicyPayload) {
  return collectWorkEvidence(payload).some((evidence) => {
    return ['failed', 'failed-with-reason', 'repair-needed', 'partial', 'empty'].includes(normalizePolicyToken(evidence.status))
      || Boolean(evidence.failureReason)
      || evidence.recoverActions.length > 0;
  });
}

function hasRecoveryEvidence(payload: WorkEvidencePolicyPayload) {
  const workEvidence = collectWorkEvidence(payload);
  if (workEvidence.some((evidence) => evidence.recoverActions.length > 0 || normalizePolicyToken(evidence.status) === 'partial')) {
    return true;
  }
  return false;
}

function collectEvidenceRefs(value: unknown, workEvidence: WorkEvidence[] = []) {
  const refs = new Set<string>();
  for (const record of recordsInValue(value)) {
    for (const key of ['evidenceRefs', 'evidence_refs', 'references', 'sourceRefs', 'source_refs']) {
      const entry = record[key];
      if (Array.isArray(entry)) {
        for (const ref of entry) {
          if (typeof ref === 'string' && ref.trim()) refs.add(ref.trim());
        }
      }
    }
    for (const key of ['rawRef', 'raw_ref', 'dataRef', 'data_ref', 'sourceRef', 'source_ref']) {
      const ref = stringField(record[key]);
      if (ref) refs.add(ref);
    }
  }
  for (const evidence of workEvidence) {
    for (const ref of evidence.evidenceRefs) refs.add(ref);
    if (evidence.rawRef) refs.add(evidence.rawRef);
  }
  return Array.from(refs);
}

function hasEvidenceBearingRef(record: Record<string, unknown>) {
  return ['rawRef', 'raw_ref', 'dataRef', 'data_ref', 'sourceRef', 'source_ref'].some((key) => stringField(record[key]));
}

function recordHasDirectEvidenceRefs(record: Record<string, unknown>) {
  return collectEvidenceRefs(record).length > 0 || hasEvidenceBearingRef(record);
}

function hasBoundWorkEvidenceRefs(record: Record<string, unknown>, workEvidence: WorkEvidence[]) {
  return workEvidence.some((evidence) => genericWorkEvidenceMatchesRecord(evidence, record) && workEvidenceHasDurableRefs(evidence));
}

function genericWorkEvidenceMatchesRecord(evidence: WorkEvidence, record: Record<string, unknown>) {
  const bindingKeys = genericRecordBindingKeys(record);
  if (!bindingKeys.length) return false;
  const evidenceKeys = genericWorkEvidenceBindingKeys(evidence).map(normalizeBindingText);
  return bindingKeys.map(normalizeBindingText).some((key) => evidenceKeys.includes(key));
}

function genericRecordBindingKeys(record: Record<string, unknown>) {
  return [
    stringField(record.id),
    stringField(record.ref),
    stringField(record.claimId),
    stringField(record.claim_id),
    stringField(record.claimRef),
    stringField(record.claim_ref),
    stringField(record.recordId),
    stringField(record.record_id),
    stringField(record.artifactId),
    stringField(record.artifact_id),
  ].filter((entry): entry is string => Boolean(entry && entry.trim().length >= 3));
}

function genericWorkEvidenceBindingKeys(evidence: WorkEvidence) {
  const input = isRecord(evidence.input) ? evidence.input : {};
  return [
    evidence.id,
    stringField(input.id),
    stringField(input.ref),
    stringField(input.claimId),
    stringField(input.claim_id),
    stringField(input.claimRef),
    stringField(input.claim_ref),
    stringField(input.recordId),
    stringField(input.record_id),
    stringField(input.artifactId),
    stringField(input.artifact_id),
    stringField((evidence as WorkEvidence & Record<string, unknown>).recordId),
    stringField((evidence as WorkEvidence & Record<string, unknown>).claimId),
  ].filter((entry): entry is string => Boolean(entry && entry.trim().length >= 3));
}

function recordClaimsVerified(record: Record<string, unknown>) {
  return ['status', 'verdict', 'verificationStatus', 'verification', 'evidenceLevel']
    .some((key) => verifiedText(record[key]));
}

function verifiedText(value: unknown) {
  return ['verified', 'validated', 'confirmed', 'pass', 'passed'].includes(normalizePolicyToken(value));
}

function isFailureStatus(value: unknown) {
  return ['failed', 'error', 'failed-with-reason', 'repair-needed', 'needs-human'].includes(normalizePolicyToken(value));
}

function isSuccessStatus(value: unknown) {
  return ['done', 'success', 'succeeded', 'completed', 'pass', 'passed', 'verified'].includes(normalizePolicyToken(value));
}

function hasNonZeroExitCode(record: Record<string, unknown>) {
  const code = record.exitCode ?? record.exit_code;
  if (typeof code === 'number') return Number.isFinite(code) && code !== 0;
  if (typeof code === 'string' && /^-?\d+$/.test(code.trim())) return Number(code) !== 0;
  return false;
}

function recordsInPayload(payload: WorkEvidencePolicyPayload) {
  return recordsInValue(payload);
}

function recordsInValue(value: unknown, depth = 0): Record<string, unknown>[] {
  if (depth > 6 || value === undefined || value === null) return [];
  if (Array.isArray(value)) return value.flatMap((entry) => recordsInValue(entry, depth + 1));
  if (!isRecord(value)) return [];
  return [value, ...Object.values(value).flatMap((entry) => recordsInValue(entry, depth + 1))];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function collectPayloadText(value: unknown, depth = 0): string[] {
  if (depth > 6 || value === undefined || value === null) return [];
  if (typeof value === 'string') return [value];
  if (typeof value === 'number' || typeof value === 'boolean') return [String(value)];
  if (Array.isArray(value)) return value.flatMap((entry) => collectPayloadText(entry, depth + 1));
  if (!isRecord(value)) return [];
  return Object.values(value).flatMap((entry) => collectPayloadText(entry, depth + 1));
}
