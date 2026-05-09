import {
  VERIFICATION_RESULT_CONTRACT_ID,
  type RuntimeVerificationResult,
} from './verification-result';

export type RuntimeVerificationMode = 'none' | 'lightweight' | 'automatic' | 'human' | 'hybrid' | 'unverified';
export type RuntimeVerificationRiskLevel = 'low' | 'medium' | 'high';
export type RuntimeHumanApprovalPolicy = 'none' | 'optional' | 'required';

export interface RuntimeVerificationPolicy {
  required: boolean;
  mode: RuntimeVerificationMode;
  riskLevel: RuntimeVerificationRiskLevel;
  reason: string;
  selectedVerifierIds?: string[];
  humanApprovalPolicy?: RuntimeHumanApprovalPolicy;
  unverifiedReason?: string;
}

export interface RuntimeVerificationPolicyRequest {
  prompt?: unknown;
  riskLevel?: unknown;
  verificationPolicy?: RuntimeVerificationPolicy | Record<string, unknown>;
  selectedVerifierIds?: unknown;
  uiState?: Record<string, unknown>;
  humanApprovalPolicy?: unknown;
  humanApproval?: unknown;
  actionSideEffects?: unknown;
  selectedActionIds?: unknown;
}

export interface RuntimeVerificationPolicyPayload {
  verificationPolicy?: RuntimeVerificationPolicy | Record<string, unknown>;
  executionUnits?: unknown;
}

export interface RuntimeHumanApprovalSnapshot {
  approved: boolean;
  ref?: string;
  by?: string;
  at?: string;
}

export interface RuntimeVerificationGate {
  blocked: boolean;
  reason?: string;
  result: RuntimeVerificationResult;
}

export const VERIFICATION_POLICY_CONTRACT_ID = 'sciforge.verification-policy.v1';
export const VERIFICATION_POLICY_SCHEMA_PATH = 'packages/contracts/runtime/verification-policy.ts#evaluateRuntimeVerificationGate';

export function normalizeRuntimeVerificationPolicy(
  request: RuntimeVerificationPolicyRequest,
  payload?: RuntimeVerificationPolicyPayload,
): RuntimeVerificationPolicy {
  const explicitRecord = isRecord(request.verificationPolicy)
    ? request.verificationPolicy
    : isRecord(payload?.verificationPolicy)
      ? payload.verificationPolicy
      : undefined;
  const explicit = explicitRecord ? normalizeExplicitVerificationPolicy(explicitRecord) : undefined;
  const riskLevel = explicit?.riskLevel ?? inferVerificationRiskLevel(request, payload);
  const selectedVerifierIds = uniqueStrings([
    ...toStringList(request.selectedVerifierIds),
    ...(explicit?.selectedVerifierIds ?? []),
    ...toStringList(request.uiState?.selectedVerifierIds),
  ]);
  const defaultReason = defaultVerificationReason(riskLevel);

  if (explicitRecord) {
    const mode = explicit?.mode ?? (riskLevel === 'high' ? 'hybrid' : 'lightweight');
    return {
      ...explicitRecord,
      required: riskLevel === 'high' ? true : explicit?.required ?? false,
      mode: riskLevel === 'high' && mode === 'none' ? 'hybrid' : mode,
      riskLevel,
      reason: explicit?.reason ?? defaultReason,
      selectedVerifierIds,
      humanApprovalPolicy: riskLevel === 'high'
        ? (explicit?.humanApprovalPolicy === 'none' ? 'required' : explicit?.humanApprovalPolicy ?? 'required')
        : explicit?.humanApprovalPolicy,
      unverifiedReason: explicit?.unverifiedReason,
    };
  }

  return {
    required: riskLevel === 'high',
    mode: riskLevel === 'high' ? 'hybrid' : 'lightweight',
    riskLevel,
    reason: defaultReason,
    selectedVerifierIds,
    humanApprovalPolicy: riskLevel === 'high' ? 'required' : 'optional',
  };
}

export function evaluateRuntimeVerificationGate(
  payload: RuntimeVerificationPolicyPayload,
  request: RuntimeVerificationPolicyRequest,
  policy: RuntimeVerificationPolicy,
  providedResults: RuntimeVerificationResult[] = [],
): RuntimeVerificationGate {
  const decisive = mostDecisiveVerificationResult(providedResults);
  const approval = normalizeHumanApproval(request.humanApproval ?? request.uiState?.humanApproval);
  const highRiskAction = policy.riskLevel === 'high' || hasHighRiskActionSignal(request, payload);
  if (decisive?.verdict === 'pass') return { blocked: false, result: decisive };
  if (approval?.approved) {
    return {
      blocked: false,
      result: {
        id: decisive?.id,
        verdict: 'pass',
        reward: 1,
        confidence: 0.9,
        critique: 'Human approval satisfied the verification gate.',
        evidenceRefs: uniqueStrings([approval.ref, ...(decisive?.evidenceRefs ?? [])].filter((value): value is string => typeof value === 'string' && value.length > 0)),
        repairHints: decisive?.repairHints ?? [],
        diagnostics: { source: 'human-approval', approval },
      },
    };
  }
  if (highRiskAction && actionProviderSelfReportsSuccess(payload)) {
    const reason = policy.selectedVerifierIds?.length
      ? 'High-risk action did not receive a passing verifier result or explicit human approval.'
      : 'High-risk action has no verifier or explicit human approval; action provider self-reported success cannot close the run.';
    return {
      blocked: true,
      reason,
      result: decisive ?? {
        verdict: policy.selectedVerifierIds?.length ? 'fail' : 'needs-human',
        reward: -1,
        confidence: 0.98,
        critique: reason,
        evidenceRefs: executionUnitRefs(payload),
        repairHints: [
          'Attach a verifier result with verdict=pass, or collect explicit human approval before marking the high-risk action complete.',
          'If no verifier exists, return needs-human instead of a successful action payload.',
        ],
        diagnostics: {
          riskLevel: 'high',
          selectedVerifierIds: policy.selectedVerifierIds ?? [],
          actionProviderSelfReportedSuccess: true,
        },
      },
    };
  }
  if (decisive) return { blocked: policy.required, result: decisive };
  return {
    blocked: false,
    result: {
      verdict: 'unverified',
      reward: 0,
      confidence: 0,
      critique: policy.reason,
      evidenceRefs: executionUnitRefs(payload),
      repairHints: policy.required ? ['Run an appropriate verifier or request human approval.'] : [],
      diagnostics: {
        riskLevel: policy.riskLevel,
        mode: policy.mode,
        required: policy.required,
        visibleUnverified: true,
      },
    },
  };
}

export function createRuntimeVerificationArtifact(
  result: RuntimeVerificationResult,
  policy: RuntimeVerificationPolicy,
  verificationRel: string,
  nonBlocking = false,
): Record<string, unknown> {
  return {
    id: result.id ?? 'verification-result',
    type: 'verification-result',
    dataRef: verificationRel,
    schemaVersion: VERIFICATION_RESULT_CONTRACT_ID,
    metadata: {
      verdict: result.verdict,
      policy: `${policy.mode}/${policy.riskLevel}`,
      visible: true,
      nonBlocking,
      unverifiedIsNotPass: result.verdict === 'unverified' ? true : undefined,
    },
    data: { result, policy },
  };
}

export function verificationIsNonBlocking(
  request: RuntimeVerificationPolicyRequest,
  policy: RuntimeVerificationPolicy,
) {
  const latency = isRecord(request.uiState?.latencyPolicy) ? request.uiState.latencyPolicy : {};
  return latency.blockOnVerification === false
    && policy.riskLevel !== 'high'
    && policy.humanApprovalPolicy !== 'required'
    && !policy.required;
}

export function mostDecisiveVerificationResult(results: RuntimeVerificationResult[]) {
  return results.find((result) => result.verdict === 'fail')
    ?? results.find((result) => result.verdict === 'needs-human')
    ?? results.find((result) => result.verdict === 'pass')
    ?? results.find((result) => result.verdict === 'uncertain')
    ?? results.find((result) => result.verdict === 'unverified');
}

export function normalizeHumanApproval(value: unknown): RuntimeHumanApprovalSnapshot | undefined {
  if (!isRecord(value)) return undefined;
  const approved = value.approved === true || value.status === 'approved' || value.verdict === 'approved' || value.decision === 'accept';
  return {
    approved,
    ref: typeof value.ref === 'string' ? value.ref : typeof value.approvalRef === 'string' ? value.approvalRef : undefined,
    by: typeof value.by === 'string' ? value.by : undefined,
    at: typeof value.at === 'string' ? value.at : typeof value.approvedAt === 'string' ? value.approvedAt : undefined,
  };
}

export function inferVerificationRiskLevel(
  request: RuntimeVerificationPolicyRequest,
  payload?: RuntimeVerificationPolicyPayload,
): RuntimeVerificationRiskLevel {
  const candidates = [
    request.riskLevel,
    request.verificationPolicy,
    payload?.verificationPolicy,
    request.uiState?.riskLevel,
    request.uiState?.actionRiskLevel,
    request.uiState?.safetyPolicy,
    request.uiState?.capabilityBrief,
    request.uiState?.conversationPolicy,
    request.uiState?.latencyPolicy,
    request.uiState?.executionModeDecision,
    request.uiState?.executionModePlan,
    ...toRecordList(request.uiState?.selectedActions),
    ...executionUnitRecords(payload),
  ];
  if (candidates.some((candidate) => recordOrTextIncludesRisk(candidate, 'high'))) return 'high';
  if (hasStructuredHighRiskActionSignal(request, payload)) return 'high';
  if (candidates.some((candidate) => recordOrTextIncludesRisk(candidate, 'medium'))) return 'medium';
  return 'low';
}

function normalizeExplicitVerificationPolicy(record: Record<string, unknown>): Partial<RuntimeVerificationPolicy> {
  return {
    required: typeof record.required === 'boolean' ? record.required : undefined,
    mode: normalizeVerificationMode(record.mode),
    riskLevel: normalizeVerificationRiskLevel(record.riskLevel),
    reason: typeof record.reason === 'string' ? record.reason : undefined,
    selectedVerifierIds: toStringList(record.selectedVerifierIds),
    humanApprovalPolicy: normalizeHumanApprovalPolicy(record.humanApprovalPolicy),
    unverifiedReason: typeof record.unverifiedReason === 'string' ? record.unverifiedReason : undefined,
  };
}

function defaultVerificationReason(riskLevel: RuntimeVerificationRiskLevel) {
  return riskLevel === 'high'
    ? 'Runtime inferred a high-risk action; verifier or explicit human approval is required.'
    : 'No strong verifier was selected; runtime records an explicit unverified result instead of treating it as pass.';
}

function normalizeVerificationMode(value: unknown): RuntimeVerificationMode | undefined {
  return value === 'none' || value === 'lightweight' || value === 'automatic' || value === 'human' || value === 'hybrid' || value === 'unverified'
    ? value
    : undefined;
}

function normalizeVerificationRiskLevel(value: unknown): RuntimeVerificationRiskLevel | undefined {
  return value === 'low' || value === 'medium' || value === 'high' ? value : undefined;
}

function normalizeHumanApprovalPolicy(value: unknown): RuntimeHumanApprovalPolicy | undefined {
  return value === 'none' || value === 'optional' || value === 'required' ? value : undefined;
}

function hasHighRiskActionSignal(request: RuntimeVerificationPolicyRequest, payload: RuntimeVerificationPolicyPayload) {
  return inferVerificationRiskLevel(request, payload) === 'high';
}

function recordOrTextIncludesRisk(value: unknown, risk: RuntimeVerificationRiskLevel) {
  if (value === risk) return true;
  if (typeof value === 'string') return value.toLowerCase() === risk;
  if (!isRecord(value)) return false;
  const clipped = JSON.stringify(clipForContractJson(value, 3)).toLowerCase();
  return clipped.includes(`"risklevel":"${risk}"`)
    || clipped.includes(`"risk_level":"${risk}"`)
    || clipped.includes(`"risk":"${risk}"`);
}

function hasStructuredHighRiskActionSignal(
  request: RuntimeVerificationPolicyRequest,
  payload?: RuntimeVerificationPolicyPayload,
) {
  const text = structuredActionEvidenceText(request);
  if (highRiskActionToken(text)) return true;
  return executionUnitRecords(payload).some((unit) => executionUnitHasHighRiskActionSignal(unit));
}

function structuredActionEvidenceText(request: RuntimeVerificationPolicyRequest) {
  return [
    request.actionSideEffects,
    request.selectedActionIds,
    request.humanApprovalPolicy,
    request.uiState?.actionSideEffects,
    request.uiState?.selectedActionIds,
    request.uiState?.selectedActions,
    request.uiState?.humanApprovalPolicy,
  ].map(compactEvidenceText).join('\n').toLowerCase();
}

function executionUnitHasHighRiskActionSignal(unit: Record<string, unknown>) {
  return looksLikeActionProvider(unit) && highRiskActionToken(actionProviderEvidenceText(unit));
}

function highRiskActionToken(text: string) {
  return /\b(delete|remove|destroy|drop|publish|send|pay|purchase|authorize|credential|secret|external-write|production)\b|\u5220\u9664|\u53d1\u5e03|\u53d1\u9001|\u652f\u4ed8|\u6388\u6743|\u51ed\u636e|\u751f\u4ea7\u73af\u5883/.test(text.toLowerCase());
}

function actionProviderSelfReportsSuccess(payload: RuntimeVerificationPolicyPayload) {
  return executionUnitRecords(payload).some((unit) => isSuccessfulStatus(unit.status) && looksLikeActionProvider(unit));
}

function looksLikeActionProvider(unit: Record<string, unknown>) {
  return /action|computer-use|vision-sense|gui|browser|desktop|mouse|keyboard|executor|external|send|delete|publish|authorize|pay/.test(actionProviderEvidenceText(unit));
}

function actionProviderEvidenceText(unit: Record<string, unknown>) {
  return [
    unit.tool,
    unit.provider,
    unit.routeDecision,
    unit.params,
    unit.environment,
    unit.action,
    unit.kind,
  ].map(compactEvidenceText).join('\n').toLowerCase();
}

function compactEvidenceText(value: unknown) {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';
  return JSON.stringify(clipForContractJson(value, 2)) ?? '';
}

function isSuccessfulStatus(value: unknown) {
  const status = String(value || '').trim().toLowerCase();
  return status === 'done' || status === 'self-healed';
}

function executionUnitRefs(payload: RuntimeVerificationPolicyPayload) {
  return executionUnitRecords(payload)
    .map((unit) => typeof unit.id === 'string' ? `execution-unit:${unit.id}` : undefined)
    .filter((value): value is string => Boolean(value));
}

function executionUnitRecords(payload?: RuntimeVerificationPolicyPayload) {
  return toRecordList(payload?.executionUnits);
}

function clipForContractJson(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') {
    const normalized = value.replace(/\s+/g, ' ').trim();
    return normalized.length > 2400 ? `${normalized.slice(0, 2400)}... [truncated ${normalized.length - 2400} chars]` : normalized;
  }
  if (typeof value !== 'object' || value === null) return value;
  if (depth >= 5) return '[truncated-depth]';
  if (Array.isArray(value)) {
    const limit = depth <= 1 ? 24 : 12;
    const clipped = value.slice(0, limit).map((entry) => clipForContractJson(entry, depth + 1));
    if (value.length > limit) clipped.push(`[truncated ${value.length - limit} entries]`);
    return clipped;
  }
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (/api[-_]?key|token|authorization|secret|password|credential/i.test(key)) {
      out[key] = entry ? '[redacted]' : entry;
      continue;
    }
    out[key] = clipForContractJson(entry, depth + 1);
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toRecordList(value: unknown) {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function toStringList(value: unknown) {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0) : [];
}

function uniqueStrings(values: Array<string | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}
