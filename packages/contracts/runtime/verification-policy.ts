import {
  VERIFICATION_RESULT_CONTRACT_ID,
  type RuntimeVerificationResult,
} from './verification-result';
import {
  buildReleaseGateAudit,
  releaseGateAllowsSync,
  releaseGateHasSyncActionSignal,
  normalizeReleaseGatePolicy,
  releaseGateHasRequiredVerifyCommand,
  type ReleaseGatePolicy,
  type ReleaseGateStepInput,
  type ReleaseGateStepKind,
} from './release-gate';

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
  userExplicitVerification?: unknown;
}

export interface RuntimeVerificationPolicyPayload {
  verificationPolicy?: RuntimeVerificationPolicy | Record<string, unknown>;
  executionUnits?: unknown;
  artifacts?: unknown;
  displayIntent?: unknown;
  logs?: unknown;
  message?: unknown;
  claimType?: unknown;
  evidenceLevel?: unknown;
  verificationResults?: unknown;
  workEvidence?: unknown;
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
  const directContextNonBlocking = directContextReadOnlyAnswerCanUseNonBlockingVerification(
    request,
    payload,
    riskLevel,
    selectedVerifierIds,
  );

  if (explicitRecord) {
    const mode = explicit?.mode ?? (riskLevel === 'high' ? 'hybrid' : 'lightweight');
    const normalized: RuntimeVerificationPolicy = {
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
    if (directContextNonBlocking) return relaxDirectContextVerificationPolicy(normalized);
    if (softHarnessVerificationCanUseNonBlockingLatency(request, normalized, payload)) {
      return relaxSoftHarnessVerificationPolicy(normalized);
    }
    return normalized;
  }

  return {
    required: directContextNonBlocking ? false : riskLevel === 'high',
    mode: riskLevel === 'high' ? 'hybrid' : 'lightweight',
    riskLevel,
    reason: directContextNonBlocking ? directContextVisibleVerificationReason(defaultReason) : defaultReason,
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
  const nonBlocking = verificationIsNonBlocking(request, policy, payload);
  const requiredForGate = policy.required && !nonBlocking;
  const approval = normalizeHumanApproval(request.humanApproval ?? request.uiState?.humanApproval);
  const highRiskAction = policy.riskLevel === 'high' || hasHighRiskActionSignal(request, payload);
  const releaseGate = releaseGateRequirement(payload, request);
  if (releaseGate.required && releaseGate.actionCompleted) {
    const evidenceRefs = uniqueStrings([
      ...executionUnitRefs(payload),
      ...releaseGate.audit.auditRefs,
      ...releaseGate.audit.gitRefs,
      ...releaseGate.audit.steps.flatMap((step) => step.evidenceRefs),
    ]);
    if (releaseGateAllowsSync(releaseGate.audit)) {
      return {
        blocked: false,
        result: {
          id: `release-gate:${releaseGate.audit.gateId}`,
          verdict: 'pass',
          reward: 1,
          confidence: 0.95,
          critique: 'Release gate passed before the external sync action.',
          evidenceRefs,
          repairHints: [],
          diagnostics: {
            source: 'release-gate',
            releaseGate: releaseGate.audit,
          },
        },
      };
    }
    const reason = releaseGate.audit.failureReasons[0]
      ?? releaseGate.audit.nextActions[0]
      ?? `Release gate has not passed; ${releaseGate.audit.policy.syncActionLabel} is blocked.`;
    return {
      blocked: true,
      reason,
      result: {
        id: `release-gate:${releaseGate.audit.gateId}`,
        verdict: releaseGate.audit.status === 'failed' ? 'fail' : 'needs-human',
        reward: -1,
        confidence: 0.99,
        critique: reason,
        evidenceRefs,
        repairHints: releaseGate.audit.nextActions,
        diagnostics: {
          source: 'release-gate',
          requiredCommand: releaseGate.audit.requiredCommand,
          releaseGate: releaseGate.audit,
        },
      },
    };
  }
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
  if (decisive) return { blocked: requiredForGate, result: decisive };
  return {
    blocked: false,
    result: {
      verdict: 'unverified',
      reward: 0,
      confidence: 0,
      critique: policy.reason,
      evidenceRefs: executionUnitRefs(payload),
      repairHints: requiredForGate ? ['Run an appropriate verifier or request human approval.'] : [],
      diagnostics: {
        riskLevel: policy.riskLevel,
        mode: policy.mode,
        required: requiredForGate,
        nonBlocking,
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
  payload?: RuntimeVerificationPolicyPayload,
) {
  const latencyNonBlocking = verificationLatencyIsNonBlocking(request);
  const directContextReadOnly = directContextReadOnlyAnswerCanUseNonBlockingVerification(
    request,
    payload,
    policy.riskLevel,
    policy.selectedVerifierIds ?? [],
  );
  const softHarnessRequired = softHarnessVerificationCanUseNonBlockingLatency(request, policy, payload);
  return (latencyNonBlocking || directContextReadOnly)
    && policy.riskLevel !== 'high'
    && policy.humanApprovalPolicy !== 'required'
    && (!policy.required || softHarnessRequired);
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
  if (structuredActionSignalsHaveHighRisk(request)) return true;
  return executionUnitRecords(payload).some((unit) => executionUnitHasHighRiskActionSignal(unit));
}

function directContextReadOnlyAnswerCanUseNonBlockingVerification(
  request: RuntimeVerificationPolicyRequest,
  payload: RuntimeVerificationPolicyPayload | undefined,
  riskLevel: RuntimeVerificationRiskLevel,
  selectedVerifierIds: string[],
) {
  if (!isDirectContextFastPathPayload(payload)) return false;
  if (riskLevel === 'high') return false;
  if (hasStructuredHighRiskActionSignal(request, payload)) return false;
  if (directContextRequestRequiresVerification(request, selectedVerifierIds)) return false;
  return true;
}

function relaxDirectContextVerificationPolicy(policy: RuntimeVerificationPolicy): RuntimeVerificationPolicy {
  if (!policy.required && policy.humanApprovalPolicy !== 'required') {
    return {
      ...policy,
      reason: directContextVisibleVerificationReason(policy.reason),
    };
  }
  return {
    ...policy,
    required: false,
    humanApprovalPolicy: policy.humanApprovalPolicy === 'required' ? 'optional' : policy.humanApprovalPolicy,
    reason: directContextVisibleVerificationReason(policy.reason),
  };
}

function relaxSoftHarnessVerificationPolicy(policy: RuntimeVerificationPolicy): RuntimeVerificationPolicy {
  return {
    ...policy,
    required: false,
    humanApprovalPolicy: policy.humanApprovalPolicy === 'required' ? 'optional' : policy.humanApprovalPolicy,
    reason: /non-blocking background verification/i.test(policy.reason)
      ? policy.reason
      : `${policy.reason}; non-blocking background verification follows latency policy`,
  };
}

function softHarnessVerificationCanUseNonBlockingLatency(
  request: RuntimeVerificationPolicyRequest,
  policy: RuntimeVerificationPolicy,
  payload?: RuntimeVerificationPolicyPayload,
) {
  if (!verificationLatencyIsNonBlocking(request)) return false;
  if (!isSoftAgentHarnessVerificationPolicy(policy)) return false;
  if (policy.riskLevel === 'high' || policy.humanApprovalPolicy === 'required') return false;
  if (hasStructuredHighRiskActionSignal(request, payload)) return false;
  if (blockingVerificationExplicitlyRequested(request)) return false;
  return true;
}

function isSoftAgentHarnessVerificationPolicy(policy: RuntimeVerificationPolicy) {
  if (policy.mode !== 'lightweight') return false;
  if (policy.riskLevel === 'high') return false;
  return /contractRef=runtime:\/\/agent-harness\/contracts\/|profileId=[^;]+|intensity=light|Harness policy consumed/i.test(policy.reason);
}

function verificationLatencyIsNonBlocking(request: RuntimeVerificationPolicyRequest) {
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  const conversationPolicy = isRecord(uiState.conversationPolicy) ? uiState.conversationPolicy : {};
  const conversationPolicySummary = isRecord(uiState.conversationPolicySummary) ? uiState.conversationPolicySummary : {};
  const latencyPolicy = isRecord(uiState.latencyPolicy)
    ? uiState.latencyPolicy
    : isRecord(conversationPolicy.latencyPolicy)
      ? conversationPolicy.latencyPolicy
      : isRecord(conversationPolicySummary.latencyPolicy)
        ? conversationPolicySummary.latencyPolicy
        : {};
  return latencyPolicy.blockOnVerification === false;
}

function directContextVisibleVerificationReason(reason: string) {
  return /direct-context fast path records visible verification/i.test(reason)
    ? reason
    : `${reason}; direct-context fast path records visible verification without blocking read-only answers`;
}

function directContextRequestRequiresVerification(
  request: RuntimeVerificationPolicyRequest,
  selectedVerifierIds: string[],
) {
  if (selectedVerifierIds.length > 0) return true;
  if (toStringList(request.selectedActionIds).length > 0) return true;
  if (toStringList(request.actionSideEffects).length > 0) return true;
  return blockingVerificationExplicitlyRequested(request);
}

function blockingVerificationExplicitlyRequested(request: RuntimeVerificationPolicyRequest) {
  const explicitMode = stringField(request.userExplicitVerification);
  if (explicitMode && !['none', 'unverified'].includes(explicitMode.toLowerCase())) return true;
  if (humanApprovalIsRequired(request.humanApprovalPolicy) || humanApprovalIsRequired(request.uiState?.humanApprovalPolicy)) return true;
  return explicitVerificationRequestPattern().test(String(request.prompt ?? ''));
}

function explicitVerificationRequestPattern() {
  return /\b(required verification|required verifier|verification required|must verify|verify before|human approval|release gate)\b|必须.{0,16}验证|验证.{0,16}必须|不能.{0,16}声称.{0,16}(完成|success|satisfied)|标记.{0,8}blocker|blocker/i;
}

function humanApprovalIsRequired(value: unknown) {
  if (value === 'required') return true;
  if (!isRecord(value)) return false;
  return value.required === true
    || value.mode === 'required'
    || value.policy === 'required'
    || value.humanApprovalPolicy === 'required';
}

function isDirectContextFastPathPayload(payload: RuntimeVerificationPolicyPayload | undefined) {
  if (!payload) return false;
  if (executionUnitRecords(payload).some((unit) => directContextRecordSignal(unit))) return true;
  if (toRecordList(payload.artifacts).some((artifact) => directContextRecordSignal(artifact))) return true;
  const claimType = stringField(payload.claimType);
  const evidenceLevel = stringField(payload.evidenceLevel);
  return claimType === 'context-summary' && evidenceLevel === 'current-session-context';
}

function directContextRecordSignal(record: Record<string, unknown>) {
  const metadata = isRecord(record.metadata) ? record.metadata : {};
  return [
    stringField(record.tool),
    stringField(record.outputRef),
    stringField(record.id),
    stringField(record.type),
    stringField(record.dataRef),
    stringField(record.ref),
    stringField(metadata.source),
  ].some((value) => typeof value === 'string' && /direct-context-fast-path|sciforge\.direct-context-fast-path/.test(value));
}

function executionUnitHasHighRiskActionSignal(unit: Record<string, unknown>) {
  return looksLikeActionProvider(unit) && (
    unit.riskLevel === 'high'
    || unit.risk === 'high'
    || structuredSideEffectIsHighRisk(unit.sideEffectClass)
    || structuredSideEffectIsHighRisk(unit.actionKind)
  );
}

const HIGH_RISK_ACTION_TOKENS = new Set([
  'delete',
  'remove',
  'destroy',
  'drop',
  'publish',
  'send',
  'push',
  'deploy',
  'merge',
  'release',
  'payment',
  'pay',
  'purchase',
  'authorize',
  'credential',
  'secret',
  'external-write',
  'production',
]);

function structuredActionSignalsHaveHighRisk(request: RuntimeVerificationPolicyRequest) {
  return [
    request.actionSideEffects,
    request.selectedActionIds,
    request.uiState?.actionSideEffects,
    request.uiState?.selectedActionIds,
    request.uiState?.selectedActions,
  ].some(structuredSideEffectIsHighRisk)
    || request.humanApprovalPolicy === 'required'
    || request.uiState?.humanApprovalPolicy === 'required';
}

function structuredSideEffectIsHighRisk(value: unknown): boolean {
  if (typeof value === 'string') return HIGH_RISK_ACTION_TOKENS.has(value.trim().toLowerCase());
  if (Array.isArray(value)) return value.some(structuredSideEffectIsHighRisk);
  if (!isRecord(value)) return false;
  return value.riskLevel === 'high'
    || value.risk === 'high'
    || structuredSideEffectIsHighRisk(value.kind)
    || structuredSideEffectIsHighRisk(value.type)
    || structuredSideEffectIsHighRisk(value.sideEffectClass);
}

function actionProviderSelfReportsSuccess(payload: RuntimeVerificationPolicyPayload) {
  return executionUnitRecords(payload).some((unit) => isSuccessfulStatus(unit.status) && looksLikeActionProvider(unit));
}

function looksLikeActionProvider(unit: Record<string, unknown>) {
  return unit.actionProvider === true
    || unit.externalAction === true
    || unit.sideEffectClass === 'external-write'
    || unit.sideEffectClass === 'production'
    || typeof unit.actionKind === 'string';
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

function releaseGateRequirement(
  payload: RuntimeVerificationPolicyPayload,
  request: RuntimeVerificationPolicyRequest,
) {
  const policy = releaseGatePolicyForRuntime(payload, request);
  const audit = releaseGateAuditForRuntime(payload, request, policy);
  const actionCompleted = releaseSyncActionCompleted(payload, policy);
  const required = actionCompleted || Boolean(explicitReleaseGateRecord(payload, request)) || releaseGateRequested(request, payload, policy);
  return { audit, actionCompleted, required };
}

function releaseGateAuditForRuntime(
  payload: RuntimeVerificationPolicyPayload,
  request: RuntimeVerificationPolicyRequest,
  policy: ReleaseGatePolicy,
) {
  const explicit = explicitReleaseGateRecord(payload, request);
  const git = gitRecord(request);
  return buildReleaseGateAudit({
    policy,
    gateId: stringField(explicit?.gateId) ?? stringField(explicit?.id),
    changeSummary: stringField(explicit?.changeSummary) ?? stringField(explicit?.summary),
    currentBranch: stringField(explicit?.currentBranch) ?? stringField(git?.currentBranch) ?? stringField(git?.branch),
    targetRemote: stringField(explicit?.targetRemote) ?? stringField(git?.targetRemote) ?? stringField(git?.remote),
    targetBranch: stringField(explicit?.targetBranch) ?? stringField(git?.targetBranch),
    steps: uniqueReleaseGateSteps([
      ...releaseGateStepsFromUnknown(explicit?.steps),
      ...executionUnitRecords(payload).flatMap((unit) => releaseGateStepsFromExecutionUnit(unit, policy)),
      ...toRecordList(payload.workEvidence).flatMap((entry) => releaseGateStepsFromWorkEvidence(entry, policy)),
      ...toRecordList(payload.verificationResults).flatMap((result) => releaseGateStepsFromVerificationResult(result, policy)),
    ]),
    serviceHealth: Array.isArray(explicit?.serviceHealth)
      ? explicit.serviceHealth.filter(isRecord).map((service) => ({
        name: stringField(service.name) ?? 'service',
        status: stringField(service.status) ?? 'unknown',
        url: stringField(service.url),
        evidenceRefs: toStringList(service.evidenceRefs),
      }))
      : undefined,
    auditRefs: uniqueStrings([
      ...toStringList(explicit?.auditRefs),
    ]),
    gitRefs: uniqueStrings([
      ...toStringList(explicit?.gitRefs),
      ...toStringList(git?.gitRefs),
    ]),
    createdAt: stringField(explicit?.createdAt),
  });
}

function releaseGatePolicyForRuntime(
  payload: RuntimeVerificationPolicyPayload,
  request: RuntimeVerificationPolicyRequest,
) {
  const explicit = explicitReleaseGateRecord(payload, request);
  return normalizeReleaseGatePolicy(
    isRecord(explicit?.policy) ? explicit.policy : isRecord(request.uiState?.releaseGatePolicy) ? request.uiState.releaseGatePolicy : undefined,
  );
}

function explicitReleaseGateRecord(
  payload: RuntimeVerificationPolicyPayload,
  request: RuntimeVerificationPolicyRequest,
) {
  const displayIntent = isRecord(payload.displayIntent) ? payload.displayIntent : {};
  const verificationStatus = isRecord(displayIntent.verificationStatus) ? displayIntent.verificationStatus : {};
  return [
    isRecord(displayIntent.releaseGate) ? displayIntent.releaseGate : undefined,
    isRecord(verificationStatus.releaseGate) ? verificationStatus.releaseGate : undefined,
    isRecord(request.uiState?.releaseGate) ? request.uiState.releaseGate : undefined,
  ].find((record): record is Record<string, unknown> => Boolean(record));
}

function releaseGateRequested(
  request: RuntimeVerificationPolicyRequest,
  payload: RuntimeVerificationPolicyPayload,
  policy: ReleaseGatePolicy,
) {
  void policy;
  return routeModeFromRecord(request.verificationPolicy) === 'release'
    || routeModeFromRecord(request.uiState?.verifyPolicy) === 'release'
    || routeModeFromRecord(request.uiState?.verificationRouting) === 'release'
    || routeModeFromRecord(payload.verificationPolicy) === 'release';
}

function releaseSyncActionCompleted(payload: RuntimeVerificationPolicyPayload, policy: ReleaseGatePolicy) {
  return executionUnitRecords(payload).some((unit) =>
    isSuccessfulStatus(unit.status)
    && releaseSyncActionSignal(unit, policy)
  );
}

function routeModeFromRecord(value: unknown) {
  if (!isRecord(value)) return undefined;
  const mode = stringField(value.mode) ?? stringField(value.route) ?? stringField(value.level);
  return mode?.trim().toLowerCase();
}

function releaseSyncActionSignal(unit: Record<string, unknown>, policy: ReleaseGatePolicy) {
  return [
    stringField(unit.syncActionSignal),
    stringField(unit.releaseSyncAction),
    stringField(unit.actionKind),
    stringField(unit.command),
  ].some((value) => releaseGateHasSyncActionSignal(value, policy));
}

function releaseGateStepsFromUnknown(value: unknown): ReleaseGateStepInput[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).flatMap((entry) => {
    const kind = releaseGateStepKind(entry.kind);
    if (!kind) return [];
    return [{
      kind,
      status: stringField(entry.status),
      command: stringField(entry.command),
      summary: stringField(entry.summary),
      failureReason: stringField(entry.failureReason),
      evidenceRefs: toStringList(entry.evidenceRefs),
    }];
  });
}

function releaseGateStepsFromExecutionUnit(unit: Record<string, unknown>, policy: ReleaseGatePolicy): ReleaseGateStepInput[] {
  const status = releaseGateStepStatusFromRuntimeStatus(unit.status);
  const refs = refsFromRecord(unit);
  const explicit = releaseGateStepRecord(unit);
  const kind = releaseGateStepKind(explicit.kind);
  if (!kind) return [];
  if (kind === 'release-verify' && !releaseGateHasRequiredVerifyCommand(explicit.command, policy)) return [];
  return [{
    kind,
    status,
    command: explicit.command,
    summary: explicit.summary ?? stringField(unit.outputSummary),
    failureReason: explicit.failureReason ?? stringField(unit.failureReason) ?? stringField(unit.error),
    evidenceRefs: refs.length ? refs : [`execution-unit:${stringField(unit.id) ?? 'release-gate-step'}`],
  }];
}

function releaseGateStepsFromWorkEvidence(entry: Record<string, unknown>, policy: ReleaseGatePolicy): ReleaseGateStepInput[] {
  const evidenceRefs = toStringList(entry.evidenceRefs);
  const status = releaseGateStepStatusFromRuntimeStatus(entry.status);
  const explicit = releaseGateStepRecord(entry);
  const kind = releaseGateStepKind(explicit.kind);
  if (!kind) return [];
  if (kind === 'release-verify' && !releaseGateHasRequiredVerifyCommand(explicit.command, policy)) return [];
  return [{
    kind,
    status,
    command: explicit.command,
    summary: explicit.summary ?? stringField(entry.outputSummary),
    failureReason: explicit.failureReason ?? stringField(entry.failureReason),
    evidenceRefs,
  }];
}

function releaseGateStepsFromVerificationResult(result: Record<string, unknown>, policy: ReleaseGatePolicy): ReleaseGateStepInput[] {
  const evidenceRefs = toStringList(result.evidenceRefs);
  const explicit = releaseGateStepRecord(result);
  const kind = releaseGateStepKind(explicit.kind);
  if (kind !== 'release-verify') return [];
  if (!releaseGateHasRequiredVerifyCommand(explicit.command, policy)) return [];
  const verdict = stringField(result.verdict);
  return [{
    kind: 'release-verify',
    status: verdict === 'pass' ? 'passed' : verdict === 'fail' || verdict === 'needs-human' ? 'failed' : 'pending',
    command: explicit.command,
    failureReason: verdict === 'pass' ? undefined : stringField(result.critique),
    evidenceRefs,
  }];
}

function releaseGateStepRecord(record: Record<string, unknown>) {
  const nested = isRecord(record.releaseGateStep) ? record.releaseGateStep : {};
  return {
    kind: stringField(nested.kind),
    command: stringField(nested.command),
    summary: stringField(nested.summary),
    failureReason: stringField(nested.failureReason),
  };
}

function releaseGateStepKind(value: unknown): ReleaseGateStepKind | undefined {
  return value === 'change-summary'
    || value === 'git-target'
    || value === 'release-verify'
    || value === 'service-restart'
    || value === 'audit-record'
    || value === 'external-sync'
    ? value
    : undefined;
}

function releaseGateStepStatusFromRuntimeStatus(value: unknown) {
  const status = String(value ?? '').trim().toLowerCase();
  if (status === 'done' || status === 'success' || status === 'passed' || status === 'self-healed') return 'passed';
  if (status === 'failed' || status === 'failed-with-reason' || status === 'repair-needed' || status === 'needs-human') return 'failed';
  if (status === 'skipped') return 'skipped';
  return 'pending';
}

function uniqueReleaseGateSteps(steps: ReleaseGateStepInput[]) {
  const seen = new Set<string>();
  return steps.filter((step) => {
    const key = `${step.kind}:${step.command ?? ''}:${(step.evidenceRefs ?? []).join('|')}:${step.status ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function gitRecord(request: RuntimeVerificationPolicyRequest) {
  return isRecord(request.uiState?.git) ? request.uiState.git : isRecord(request.uiState?.gitState) ? request.uiState.gitState : undefined;
}

function refsFromRecord(record: Record<string, unknown>) {
  return [
    stringField(record.ref),
    stringField(record.dataRef),
    stringField(record.path),
    stringField(record.outputRef),
    stringField(record.stdoutRef),
    stringField(record.stderrRef),
    stringField(record.rawRef),
  ].filter((ref): ref is string => Boolean(ref));
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

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function uniqueStrings(values: Array<string | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}
