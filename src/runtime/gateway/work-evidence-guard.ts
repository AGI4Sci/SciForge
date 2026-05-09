import type { GatewayRequest, ToolPayload } from '../runtime-types.js';
import { isRecord } from '../gateway-utils.js';
import { collectWorkEvidence, type WorkEvidence } from './work-evidence-types.js';
import { contractValidationFailureFromRepairReason } from './payload-validation.js';

export interface WorkEvidenceGuardFinding {
  kind:
    | 'external-empty-result-without-diagnostics'
    | 'verified-claim-without-evidence'
    | 'command-failed-but-successful-payload'
    | 'fetch-failure-swallowed-by-success'
    | 'external-io-without-durable-evidence-ref'
    | 'referenced-artifact-without-data-contract';
  severity: 'repair-needed' | 'failed-with-reason';
  reason: string;
}

export function contractValidationFailureFromWorkEvidenceFinding(
  finding: WorkEvidenceGuardFinding,
  options: Parameters<typeof contractValidationFailureFromRepairReason>[1],
) {
  return contractValidationFailureFromRepairReason(finding.reason, options);
}

export function evaluateToolPayloadEvidence(payload: ToolPayload, request: GatewayRequest): WorkEvidenceGuardFinding | undefined {
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

function externalIoWithoutDurableEvidenceRef(payload: ToolPayload) {
  return collectWorkEvidence(payload).some((evidence) => {
    if (!/^(retrieval|fetch)$/i.test(String(evidence.kind))) return false;
    if (!/^(success|partial|empty)$/i.test(String(evidence.status))) return false;
    return evidence.evidenceRefs.length === 0 && !evidence.rawRef;
  });
}

function externalEmptyResultWithoutDiagnostics(payload: ToolPayload, request: GatewayRequest) {
  if (!isExternalRetrievalRequest(request)) return false;
  if (payloadHasExplicitFailureEvidence(payload)) return false;
  if (workEvidenceHasProviderDiagnostics(payload)) return false;
  const haystack = collectPayloadText(payload).join('\n').toLowerCase();
  if (!haystack) return false;
  return mentionsExternalRetrieval(haystack) && saysZeroResults(haystack);
}

function isExternalRetrievalRequest(request: GatewayRequest) {
  const prompt = String(request.prompt || '').toLowerCase();
  return /\b(doi|pmid|paper|papers|literature|latest|recent|last\s+\d+\s+(?:day|days|week|weeks)|web|api|search|fetch|retrieve)\b|论文|文献|最近|最新|近\s*\d+\s*(?:天|周)|一周|检索|搜索|调研|抓取/.test(prompt);
}

function mentionsExternalRetrieval(text: string) {
  return /\b(doi|pmid|web|api|http|provider|source|query|url|retriev|search|fetch|download)\b|文献|论文|检索|搜索|抓取|下载/.test(text);
}

function saysZeroResults(text: string) {
  return [
    /\bretrieved\s+0\s+(?:paper|papers|record|records|result|results|entr(?:y|ies)|item|items)\b/,
    /\bfound\s+0\s+(?:paper|papers|record|records|result|results|entr(?:y|ies)|item|items)\b/,
    /\b0\s+(?:paper|papers|record|records|result|results|entr(?:y|ies)|item|items)\b/,
    /检索到\s*(?:\*\*)?0(?:\*\*)?\s*(?:篇|条|个)/,
    /找到\s*(?:\*\*)?0(?:\*\*)?\s*(?:篇|条|个)/,
    /共\s*(?:检索到|找到)?\s*(?:\*\*)?0(?:\*\*)?\s*(?:篇|条|个)/,
  ].some((pattern) => pattern.test(text));
}

function payloadHasExplicitFailureEvidence(payload: ToolPayload) {
  if (workEvidenceHasFailureOrRecovery(payload)) return true;
  if (String(payload.claimType || '').toLowerCase().includes('error')) return true;
  if ((Array.isArray(payload.executionUnits) ? payload.executionUnits : [])
    .some((unit) => isRecord(unit) && /failed|error|repair-needed/i.test(String(unit.status || '')))) {
    return true;
  }
  const haystack = collectPayloadText(payload).join('\n').toLowerCase();
  return /failed-with-reason|repair-needed|rate exceeded|rate limit|http\s*429|too many requests|provider status|http status|status code|fallback (?:query|attempt|provider)|(?:tried|attempted) fallback|secondary provider|retry|api may be unreachable|network.*(?:failed|error)|timeout|timed out|no results after fallback|empty result after fallback/.test(haystack);
}

function claimVerifiedWithoutEvidence(payload: ToolPayload) {
  const workEvidence = collectWorkEvidence(payload);
  const payloadRefs = collectEvidenceRefs(payload, workEvidence);
  if (verifiedText(payload.claimType) && payloadRefs.length === 0) return true;
  if (verifiedText(payload.evidenceLevel) && payloadRefs.length === 0) return true;

  const claims = Array.isArray(payload.claims) ? payload.claims : [];
  return claims.some((claim) => {
    if (!isRecord(claim)) return false;
    if (!recordClaimsVerified(claim)) return false;
    return collectEvidenceRefs(claim, workEvidence).length === 0 && !hasEvidenceBearingRef(claim);
  });
}

function commandFailedButPayloadSuccessful(payload: ToolPayload) {
  return recordsInPayload(payload).some((record) => hasNonZeroExitCode(record)) && payloadMarkedSuccessful(payload);
}

function fetchFailureSwallowedBySuccess(payload: ToolPayload) {
  const text = collectPayloadText(payload).join('\n').toLowerCase();
  if (!/(?:http\s*)?429|too many requests|rate[-\s]?limit|timed?\s*out|timeout/.test(text)) return false;
  if (!highConfidenceSuccess(payload)) return false;
  if (collectWorkEvidence(payload).some((evidence) => /failed|repair-needed/i.test(evidence.status))) return true;
  return !hasRecoveryEvidence(payload);
}

function referencedArtifactWithoutDataContract(payload: ToolPayload) {
  const referencedIds = referencedArtifactIds(payload.uiManifest);
  if (referencedIds.size === 0) return false;
  return (Array.isArray(payload.artifacts) ? payload.artifacts : []).some((artifact) => {
    if (!isRecord(artifact)) return false;
    const id = artifactId(artifact);
    return id !== undefined && referencedIds.has(id) && !hasArtifactDataContract(artifact);
  });
}

function referencedArtifactIds(uiManifest: Array<Record<string, unknown>>) {
  const ids = new Set<string>();
  for (const record of recordsInValue(uiManifest)) {
    for (const key of ['artifactId', 'artifactRef', 'artifact', 'dataArtifactId', 'sourceArtifactId']) {
      const value = stringField(record[key]);
      if (value) ids.add(value);
    }
  }
  return ids;
}

function hasArtifactDataContract(artifact: Record<string, unknown>) {
  return Boolean(
    stringField(artifact.dataRef)
    || stringField(artifact.data_ref)
    || artifact.schema !== undefined
    || artifact.schemaRef !== undefined
    || artifact.schema_ref !== undefined
    || (isRecord(artifact.metadata) && (artifact.metadata.schema !== undefined || artifact.metadata.schemaRef !== undefined))
  );
}

function artifactId(artifact: Record<string, unknown>) {
  return stringField(artifact.id) ?? stringField(artifact.artifactId) ?? stringField(artifact.ref) ?? stringField(artifact.name);
}

function payloadMarkedSuccessful(payload: ToolPayload) {
  const statuses = recordsInPayload(payload)
    .map((record) => stringField(record.status))
    .filter((value): value is string => Boolean(value));
  const hasFailure = statuses.some((status) => /failed|error|repair-needed|needs-human/i.test(status));
  const hasSuccess = statuses.some((status) => /done|success|succeeded|completed|pass/i.test(status));
  return !hasFailure && (hasSuccess || highConfidenceSuccess(payload));
}

function highConfidenceSuccess(payload: ToolPayload) {
  if (Number(payload.confidence || 0) < 0.8) return false;
  if (/failed|error|repair-needed|failed-with-reason/i.test(String(payload.claimType || ''))) return false;
  const haystack = collectPayloadText({
    message: payload.message,
    claimType: payload.claimType,
    evidenceLevel: payload.evidenceLevel,
    reasoningTrace: payload.reasoningTrace,
  }).join('\n').toLowerCase();
  return /\bsuccess(?:ful|fully)?\b|\bcompleted\b|\bdone\b|\bpass(?:ed)?\b|高置信|成功|完成|已完成|验证通过/.test(haystack)
    || /high|verified|pass/.test(String(payload.evidenceLevel || '').toLowerCase());
}

function workEvidenceHasProviderDiagnostics(payload: ToolPayload) {
  return collectWorkEvidence(payload).some((evidence) => {
    if (evidence.provider && evidence.status) return true;
    if (evidence.failureReason) return true;
    return evidence.recoverActions.length > 0;
  });
}

function workEvidenceHasFailureOrRecovery(payload: ToolPayload) {
  return collectWorkEvidence(payload).some((evidence) => {
    return /failed|repair-needed|partial|empty/i.test(evidence.status)
      || Boolean(evidence.failureReason)
      || evidence.recoverActions.length > 0;
  });
}

function hasRecoveryEvidence(payload: ToolPayload) {
  const workEvidence = collectWorkEvidence(payload);
  if (workEvidence.some((evidence) => evidence.recoverActions.length > 0 || /partial/i.test(evidence.status))) {
    return true;
  }
  const text = collectPayloadText(payload).join('\n').toLowerCase();
  return /fallback|retry|retried|recovered|degraded|failed-with-reason|repair-needed|降级|重试|恢复|补救/.test(text);
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

function recordClaimsVerified(record: Record<string, unknown>) {
  return ['status', 'verdict', 'verificationStatus', 'verification', 'evidenceLevel']
    .some((key) => verifiedText(record[key]));
}

function verifiedText(value: unknown) {
  return /(?:^|\b)(verified|validated|confirmed|pass(?:ed)?)(?:\b|$)|已验证|验证通过|已核验|已确认/.test(String(value || '').toLowerCase());
}

function hasNonZeroExitCode(record: Record<string, unknown>) {
  const code = record.exitCode ?? record.exit_code;
  if (typeof code === 'number') return Number.isFinite(code) && code !== 0;
  if (typeof code === 'string' && /^-?\d+$/.test(code.trim())) return Number(code) !== 0;
  return false;
}

function recordsInPayload(payload: ToolPayload) {
  return recordsInValue(payload);
}

function recordsInValue(value: unknown, depth = 0): Record<string, unknown>[] {
  if (depth > 6 || value === undefined || value === null) return [];
  if (Array.isArray(value)) return value.flatMap((entry) => recordsInValue(entry, depth + 1));
  if (!isRecord(value)) return [];
  return [value, ...Object.values(value).flatMap((entry) => recordsInValue(entry, depth + 1))];
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
