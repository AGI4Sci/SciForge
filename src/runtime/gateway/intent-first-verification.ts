import type { GatewayRequest, ToolPayload, WorkspaceRuntimeCallbacks, WorkspaceRuntimeEvent } from '../runtime-types.js';
import { isRecord } from '../gateway-utils.js';
import { emitWorkspaceRuntimeEvent } from '../workspace-runtime-events.js';
import {
  actionSideEffectsHaveHighRiskSignal,
  explicitIntentConstraintsForText,
  intentTextHasHighRiskSignal,
  requestedActionTypeForIntentText,
  type IntentRequestedActionType,
  type VerifyRouteMode,
} from '@sciforge-ui/runtime-contract/intent-first-verification-policy';
import {
  BACKGROUND_COMPLETION_CONTRACT_ID,
  WORKSPACE_RUNTIME_SOURCE,
  type BackgroundCompletionRef,
  type BackgroundCompletionRuntimeEvent,
} from '@sciforge-ui/runtime-contract/events';
import {
  buildReleaseGateAudit,
  normalizeReleaseGatePolicy,
  releaseGateAllowsSync,
  releaseGateHasRequiredVerifyCommand,
  type ReleaseGateAudit,
  type ReleaseGatePolicy,
  type ReleaseGateStepInput,
  type ReleaseGateStepKind,
} from '@sciforge-ui/runtime-contract/release-gate';

export const INTENT_FIRST_VERIFICATION_SCHEMA_VERSION = 'sciforge.intent-first-verification.v1' as const;
export const INTENT_MATCH_LOG_KIND = 'intent-match-check' as const;
export const BACKGROUND_WORK_VERIFY_LOG_KIND = 'background-work-verify' as const;
export const INTENT_FIRST_VERIFY_PROVIDER = 'sciforge-intent-first-verify' as const;

export type IntentMatchVerdict = 'pass' | 'warning' | 'fail';
export type VerifyLevel = 'intent' | 'work-background' | 'careful' | 'release';
export type VerifyBlockingPolicy = 'non-blocking' | 'user-requested-wait' | 'high-risk' | 'release';
export type VerifyJobStatus = 'queued' | 'running' | 'passed' | 'failed' | 'cancelled' | 'skipped';
export type {
  IntentRequestedActionType,
  VerifyRouteMode,
};

export interface IntentMatchCheck {
  schemaVersion: typeof INTENT_FIRST_VERIFICATION_SCHEMA_VERSION;
  id: string;
  verdict: IntentMatchVerdict;
  latestUserIntent: string;
  requestedActionType: IntentRequestedActionType;
  explicitConstraints: string[];
  answerCoverage: 'covered' | 'partial' | 'missing';
  overActionGuard: 'ok' | 'risk';
  uncertaintyNote?: string;
  diagnostics: string[];
}

export interface VerifyRoutingDecision {
  schemaVersion: typeof INTENT_FIRST_VERIFICATION_SCHEMA_VERSION;
  mode: VerifyRouteMode;
  level: VerifyLevel;
  blockingPolicy: VerifyBlockingPolicy;
  reason: string;
}

export interface VerifyJob {
  schemaVersion: typeof INTENT_FIRST_VERIFICATION_SCHEMA_VERSION;
  id: string;
  scope: 'response' | 'work' | 'heavy';
  level: VerifyLevel;
  status: VerifyJobStatus;
  blockingPolicy: VerifyBlockingPolicy;
  command?: string;
  targetRefs: string[];
  evidenceRefs: string[];
  releaseGate?: ReleaseGateAudit;
  failureSummary?: string;
  recommendedFix?: string;
}

export interface VerifyVerdict {
  schemaVersion: typeof INTENT_FIRST_VERIFICATION_SCHEMA_VERSION;
  jobId: string;
  verdict: 'passed' | 'failed' | 'not-run' | 'pending';
  evidenceRefs: string[];
  failureSummary?: string;
  recommendedFix?: string;
}

export interface VerifyLineageRecord {
  schemaVersion: typeof INTENT_FIRST_VERIFICATION_SCHEMA_VERSION;
  jobId: string;
  targetRefs: string[];
  evidenceRefs: string[];
  verdictRef?: string;
  eventRef?: string;
  followUpRequired: boolean;
}

export interface IntentFirstVerificationEnvelope {
  schemaVersion: typeof INTENT_FIRST_VERIFICATION_SCHEMA_VERSION;
  intentCheck: IntentMatchCheck;
  routing: VerifyRoutingDecision;
  jobs: VerifyJob[];
  verdicts: VerifyVerdict[];
  lineage: VerifyLineageRecord[];
}

export interface IntentFirstVerificationOptions {
  callbacks?: WorkspaceRuntimeCallbacks;
  runWorkVerify?: boolean;
  now?: () => string;
}

export function attachIntentFirstVerification(
  payload: ToolPayload,
  request: GatewayRequest,
  options: IntentFirstVerificationOptions = {},
): ToolPayload {
  const intentCheck = buildIntentMatchCheck(request, payload);
  const routing = verifyRoutingDecision(request);
  const initialJobs = buildVerifyJobs(payload, routing, request);
  const workVerify = options.runWorkVerify || options.callbacks
    ? runBackgroundWorkVerify(payload, request, initialJobs, routing, options)
    : pendingWorkVerify(initialJobs);
  const jobs = workVerify.jobs;
  const verdicts = workVerify.verdicts;
  const lineage = workVerify.lineage;
  const envelope: IntentFirstVerificationEnvelope = {
    schemaVersion: INTENT_FIRST_VERIFICATION_SCHEMA_VERSION,
    intentCheck,
    routing,
    jobs,
    verdicts,
    lineage,
  };
  const hasPendingWorkVerify = jobs.some((job) => job.status === 'queued' || job.status === 'running');
  const failedWorkVerify = jobs.find((job) => job.status === 'failed');
  const releaseGate = jobs.find((job) => job.releaseGate)?.releaseGate;
  const workStatus = verificationWorkStatus(jobs, routing);
  const recoverActions = uniqueStrings([
    ...(intentCheck.verdict === 'fail' ? ['Revise the answer to match the latest user intent before doing more work.'] : []),
    ...jobs.map((job) => job.recommendedFix).filter((action): action is string => Boolean(action)),
  ]);

  return {
    ...payload,
    logs: [
      ...(payload.logs ?? []),
      {
        kind: INTENT_MATCH_LOG_KIND,
        ref: `intent-match:${intentCheck.id}`,
        data: intentCheck,
      },
      ...jobs.map((job) => ({
        kind: BACKGROUND_WORK_VERIFY_LOG_KIND,
        ref: `verify-job:${job.id}`,
        data: job,
      })),
    ],
    workEvidence: [
      ...(payload.workEvidence ?? []),
      {
        kind: 'other',
        status: intentCheck.verdict === 'fail' || failedWorkVerify ? 'failed-with-reason' : hasPendingWorkVerify ? 'partial' : 'success',
        provider: INTENT_FIRST_VERIFY_PROVIDER,
        input: {
          requestedActionType: intentCheck.requestedActionType,
          route: routing.mode,
          level: routing.level,
        },
        resultCount: 1,
        outputSummary: failedWorkVerify
          ? failedWorkVerify.failureSummary ?? 'Background work verification found a failure that needs follow-up.'
          : hasPendingWorkVerify
          ? 'Intent match check completed; work verification is represented as a separate pending verify job.'
          : intentCheck.verdict === 'pass'
            ? 'Intent match check passed; lightweight work verification did not find a blocking failure.'
          : `Intent match check ${intentCheck.verdict}: ${intentCheck.diagnostics.join('; ')}`,
        evidenceRefs: uniqueStrings([
          ...jobs.flatMap((job) => job.evidenceRefs),
          ...lineage.flatMap((entry) => [entry.verdictRef, entry.eventRef]).filter((ref): ref is string => Boolean(ref)),
        ]),
        failureReason: failedWorkVerify?.failureSummary,
        recoverActions,
        nextStep: failedWorkVerify?.recommendedFix,
        diagnostics: [
          `answerCoverage=${intentCheck.answerCoverage}`,
          `overActionGuard=${intentCheck.overActionGuard}`,
          `verifyRoute=${routing.mode}`,
          `blockingPolicy=${routing.blockingPolicy}`,
          `workVerify=${workStatus}`,
          releaseGate ? `releaseGate=${releaseGate.status}` : '',
        ].filter(Boolean),
        rawRef: failedWorkVerify ? `verify-job:${failedWorkVerify.id}` : `intent-match:${intentCheck.id}`,
      },
    ],
    displayIntent: {
      ...(isRecord(payload.displayIntent) ? payload.displayIntent : {}),
      intentFirstVerification: envelope,
      verificationStatus: {
        schemaVersion: INTENT_FIRST_VERIFICATION_SCHEMA_VERSION,
        response: intentCheck.verdict === 'pass' ? 'intent checked' : 'intent needs attention',
        work: workStatus,
        blocking: routing.blockingPolicy !== 'non-blocking',
        releaseGate: releaseGate
          ? {
            status: releaseGate.status,
            syncAllowed: releaseGate.syncAllowed,
            requiredCommand: releaseGate.requiredCommand,
            missing: releaseGate.missing,
          }
          : undefined,
      },
    },
  };
}

function verificationWorkStatus(jobs: VerifyJob[], routing: VerifyRoutingDecision) {
  if (jobs.some((job) => job.status === 'failed')) return 'verify failed';
  if (jobs.some((job) => job.status === 'passed')) return 'verify passed';
  if (jobs.some((job) => job.status === 'running') || routing.blockingPolicy !== 'non-blocking') return 'verify waiting';
  if (jobs.some((job) => job.status === 'queued')) return 'background verify queued';
  if (jobs.some((job) => job.status === 'skipped')) return 'not verified';
  return 'not required';
}

export function buildIntentMatchCheck(request: GatewayRequest, payload?: ToolPayload): IntentMatchCheck {
  const latestUserIntent = latestIntentText(request);
  const explicitConstraints = explicitConstraintsFor(request);
  const requestedActionType = requestedActionTypeFor(latestUserIntent);
  const message = typeof payload?.message === 'string' ? payload.message.trim() : '';
  const answerCoverage = message ? 'covered' : latestUserIntent ? 'missing' : 'partial';
  const overActionGuard = overActionRisk(request, latestUserIntent, requestedActionType) ? 'risk' : 'ok';
  const uncertaintyNote = uncertaintyNoteFor(payload);
  const diagnostics = [
    answerCoverage === 'missing' ? 'payload message is empty' : '',
    overActionGuard === 'risk' ? 'request implies external or irreversible action; verify must not be silently skipped' : '',
    uncertaintyNote ? `uncertainty=${uncertaintyNote}` : '',
  ].filter(Boolean);
  const verdict: IntentMatchVerdict = answerCoverage === 'missing'
    ? 'fail'
    : overActionGuard === 'risk' || uncertaintyNote
      ? 'warning'
      : 'pass';

  return {
    schemaVersion: INTENT_FIRST_VERIFICATION_SCHEMA_VERSION,
    id: stableId('intent', latestUserIntent || message || request.skillDomain),
    verdict,
    latestUserIntent,
    requestedActionType,
    explicitConstraints,
    answerCoverage,
    overActionGuard,
    uncertaintyNote,
    diagnostics,
  };
}

export function verifyRoutingDecision(request: GatewayRequest): VerifyRoutingDecision {
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  const policy = isRecord(uiState.verifyPolicy) ? uiState.verifyPolicy : isRecord(uiState.verificationRouting) ? uiState.verificationRouting : {};
  const explicitMode = stringField(policy.mode) ?? stringField(policy.route) ?? stringField(policy.level);
  const mode = normalizeRouteMode(explicitMode)
    ?? releaseGateRouteModeFromStructuredState(request)
    ?? 'background';
  const riskBlocking = highRiskRequest(request);
  const blockingPolicy: VerifyBlockingPolicy = mode === 'release'
    ? 'release'
    : mode === 'wait'
      ? 'user-requested-wait'
      : riskBlocking
        ? 'high-risk'
        : 'non-blocking';
  const level: VerifyLevel = mode === 'release'
    ? 'release'
    : mode === 'careful' || mode === 'wait'
      ? 'careful'
      : mode === 'skip'
        ? 'intent'
        : 'work-background';
  return {
    schemaVersion: INTENT_FIRST_VERIFICATION_SCHEMA_VERSION,
    mode,
    level,
    blockingPolicy,
    reason: reasonForRoute(mode, blockingPolicy),
  };
}

export function buildVerifyJobs(payload: ToolPayload, routing: VerifyRoutingDecision, request?: GatewayRequest): VerifyJob[] {
  if (routing.mode === 'skip') {
    return [{
      schemaVersion: INTENT_FIRST_VERIFICATION_SCHEMA_VERSION,
      id: 'verify-job-skipped',
      scope: 'work',
      level: 'intent',
      status: 'skipped',
      blockingPolicy: routing.blockingPolicy,
      targetRefs: [],
      evidenceRefs: [],
      recommendedFix: 'Run background, careful, or release verify if the user asks for stronger assurance.',
    }];
  }
  if (routing.mode === 'release') {
    const releaseGate = releaseGateAuditForPayload(payload, request);
    const requiredCommand = releaseGate.requiredCommand;
    const targetRefs = uniqueStrings([
      ...targetRefsForPayload(payload),
      `release-gate:${requiredCommand}`,
    ]);
    return [{
      schemaVersion: INTENT_FIRST_VERIFICATION_SCHEMA_VERSION,
      id: stableId('verify-release', targetRefs.join('|')),
      scope: 'heavy',
      level: 'release',
      status: 'running',
      blockingPolicy: 'release',
      command: requiredCommand,
      targetRefs,
      evidenceRefs: uniqueStrings([
        ...targetRefs,
        ...releaseGate.auditRefs,
        ...releaseGate.gitRefs,
        ...releaseGate.steps.flatMap((step) => step.evidenceRefs),
      ]),
      releaseGate,
      recommendedFix: releaseGate.nextActions[0] ?? `Run ${requiredCommand} before completing the external sync action.`,
    }];
  }
  const targetRefs = targetRefsForPayload(payload);
  if (!targetRefs.length) return [];
  return [{
    schemaVersion: INTENT_FIRST_VERIFICATION_SCHEMA_VERSION,
    id: stableId('verify-work', targetRefs.join('|')),
    scope: routing.level === 'release' ? 'heavy' : 'work',
    level: routing.level,
    status: routing.blockingPolicy === 'non-blocking' ? 'queued' : 'running',
    blockingPolicy: routing.blockingPolicy,
    targetRefs,
    evidenceRefs: targetRefs,
    recommendedFix: routing.blockingPolicy === 'non-blocking'
      ? 'Continue with the user-visible result while background work verification runs.'
      : 'Wait for the requested verification level before presenting the result as fully verified.',
  }];
}

export function pendingWorkVerify(jobs: VerifyJob[]) {
  return {
    jobs,
    verdicts: jobs.map((job): VerifyVerdict => ({
      schemaVersion: INTENT_FIRST_VERIFICATION_SCHEMA_VERSION,
      jobId: job.id,
      verdict: job.status === 'skipped' ? 'not-run' : 'pending',
      evidenceRefs: job.evidenceRefs,
      recommendedFix: job.recommendedFix,
    })),
    lineage: jobs.map((job): VerifyLineageRecord => ({
      schemaVersion: INTENT_FIRST_VERIFICATION_SCHEMA_VERSION,
      jobId: job.id,
      targetRefs: job.targetRefs,
      evidenceRefs: job.evidenceRefs,
      followUpRequired: false,
    })),
  };
}

export function runBackgroundWorkVerify(
  payload: ToolPayload,
  request: GatewayRequest,
  jobs: VerifyJob[],
  routing: VerifyRoutingDecision,
  options: IntentFirstVerificationOptions = {},
) {
  const now = options.now ?? (() => new Date().toISOString());
  const completedAt = now();
  const runId = verifyRunIdForRequest(request);
  const evaluation = evaluatePayloadForWorkVerify(payload);
  const finalJobs = jobs.map((job): VerifyJob => {
    if (job.status === 'skipped') return job;
    if (!job.targetRefs.length) return job;
    if (job.level === 'release') {
      const releaseGate = releaseGateAuditForPayload(payload, request);
      const releaseEvidenceRefs = uniqueStrings([
        ...job.evidenceRefs,
        ...releaseGate.auditRefs,
        ...releaseGate.gitRefs,
        ...releaseGate.steps.flatMap((step) => step.evidenceRefs),
      ]);
      if (releaseGate.status === 'failed') {
        return {
          ...job,
          status: 'failed',
          evidenceRefs: releaseEvidenceRefs,
          releaseGate,
          failureSummary: releaseGate.failureReasons.join('; ') || 'Release verification failed.',
          recommendedFix: releaseGate.nextActions[0],
        };
      }
      if (releaseGateAllowsSync(releaseGate)) {
        return {
          ...job,
          status: 'passed',
          evidenceRefs: releaseEvidenceRefs,
          releaseGate,
          recommendedFix: releaseGate.nextActions[0],
        };
      }
      return {
        ...job,
        status: 'running',
        evidenceRefs: releaseEvidenceRefs,
        releaseGate,
        recommendedFix: releaseGate.nextActions[0],
      };
    }
    return {
      ...job,
      status: evaluation.failureSummary ? 'failed' : 'passed',
      failureSummary: evaluation.failureSummary,
      recommendedFix: evaluation.failureSummary ? evaluation.recommendedFix : job.recommendedFix,
    };
  });
  const verdicts = finalJobs.map((job): VerifyVerdict => {
    const verdict = job.status === 'skipped'
      ? 'not-run'
      : job.status === 'failed'
        ? 'failed'
        : job.status === 'passed'
          ? 'passed'
          : 'pending';
    return {
      schemaVersion: INTENT_FIRST_VERIFICATION_SCHEMA_VERSION,
      jobId: job.id,
      verdict,
      evidenceRefs: job.evidenceRefs,
      failureSummary: job.failureSummary,
      recommendedFix: job.recommendedFix,
    };
  });
  const lineage = finalJobs.map((job): VerifyLineageRecord => {
    const verdictRef = job.status === 'passed' || job.status === 'failed' ? `verification:${job.id}` : undefined;
    const eventRef = verdictRef ? `run:${runId}#${job.id}` : undefined;
    return {
      schemaVersion: INTENT_FIRST_VERIFICATION_SCHEMA_VERSION,
      jobId: job.id,
      targetRefs: job.targetRefs,
      evidenceRefs: job.evidenceRefs,
      verdictRef,
      eventRef,
      followUpRequired: job.status === 'failed',
    };
  });

  for (const job of finalJobs) {
    if (job.status !== 'passed' && job.status !== 'failed') continue;
    emitBackgroundWorkVerifyEvent({
      callbacks: options.callbacks,
      completedAt,
      job,
      request,
      routing,
      runId,
      verdict: verdicts.find((entry) => entry.jobId === job.id),
    });
  }

  return { jobs: finalJobs, verdicts, lineage };
}

function latestIntentText(request: GatewayRequest) {
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  const currentPrompt = stringField(uiState.currentPrompt);
  return currentPrompt ?? request.prompt ?? '';
}

function explicitConstraintsFor(request: GatewayRequest) {
  return explicitIntentConstraintsForText(latestIntentText(request));
}

function requestedActionTypeFor(text: string): IntentRequestedActionType {
  return requestedActionTypeForIntentText(text);
}

function overActionRisk(request: GatewayRequest, text: string, actionType: IntentRequestedActionType) {
  if (actionType === 'external-action') return true;
  if (highRiskRequest(request)) return true;
  return intentTextHasHighRiskSignal(text);
}

function uncertaintyNoteFor(payload?: ToolPayload) {
  if (!payload) return undefined;
  if (typeof payload.confidence === 'number' && payload.confidence < 0.6) return 'low-confidence';
  if (payload.verificationResults?.some((result) => result.verdict === 'uncertain' || result.verdict === 'fail')) return 'verification-not-pass';
  if (payload.claims?.some((claim) => isRecord(claim) && stringField(claim.verificationStatus) === 'unverified')) return 'unverified-claim';
  return undefined;
}

function normalizeRouteMode(value: string | undefined): VerifyRouteMode | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (['skip', 'none', 'off'].includes(normalized)) return 'skip';
  if (['background', 'work-background', 'async'].includes(normalized)) return 'background';
  if (['wait', 'blocking'].includes(normalized)) return 'wait';
  if (['careful', 'deep', 'targeted'].includes(normalized)) return 'careful';
  if (['release', 'full'].includes(normalized)) return 'release';
  return undefined;
}

function releaseGatePolicyInputForRequest(request: GatewayRequest) {
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  const releaseGate = isRecord(uiState.releaseGate) ? uiState.releaseGate : {};
  const policy = isRecord(releaseGate.policy)
    ? releaseGate.policy
    : isRecord(uiState.releaseGatePolicy)
      ? uiState.releaseGatePolicy
      : undefined;
  return policy;
}

function releaseGateRouteModeFromStructuredState(request: GatewayRequest): VerifyRouteMode | undefined {
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  if (isRecord(uiState.releaseGate)) return 'release';
  const policy = releaseGatePolicyInputForRequest(request);
  if (policy) return 'release';
  return undefined;
}

function highRiskRequest(request: GatewayRequest) {
  if (request.riskLevel === 'high') return true;
  return actionSideEffectsHaveHighRiskSignal(Array.isArray(request.actionSideEffects) ? request.actionSideEffects : []);
}

function reasonForRoute(mode: VerifyRouteMode, blockingPolicy: VerifyBlockingPolicy) {
  if (blockingPolicy === 'high-risk') return 'High-risk request requires verification to block before claiming completion.';
  if (blockingPolicy === 'user-requested-wait') return 'User explicitly asked to wait for verification.';
  if (blockingPolicy === 'release') return 'Release-level verification was requested.';
  if (mode === 'skip') return 'User or policy selected intent-only verification.';
  return 'Default route keeps work verification in the background and preserves answer-first latency.';
}

function targetRefsForPayload(payload: ToolPayload) {
  return uniqueStrings([
    ...(payload.artifacts ?? []).flatMap((artifact) => refsFromRecord(artifact)),
    ...(payload.executionUnits ?? []).flatMap((unit) => refsFromRecord(unit)),
    ...(payload.objectReferences ?? []).flatMap((reference) => refsFromRecord(reference)),
  ]);
}

function evaluatePayloadForWorkVerify(payload: ToolPayload) {
  const failedExecutionUnit = toRecordList(payload.executionUnits).find((unit) => {
    const status = stringField(unit.status)?.toLowerCase();
    const exitCode = typeof unit.exitCode === 'number' ? unit.exitCode : undefined;
    return status === 'failed'
      || status === 'failed-with-reason'
      || status === 'repair-needed'
      || status === 'needs-human'
      || (exitCode !== undefined && exitCode !== 0);
  });
  if (failedExecutionUnit) {
    const unitId = stringField(failedExecutionUnit.id) ?? 'execution-unit';
    const reason = stringField(failedExecutionUnit.failureReason)
      ?? stringField(failedExecutionUnit.error)
      ?? `Execution unit ${unitId} did not complete successfully.`;
    return {
      failureSummary: reason,
      recommendedFix: `Inspect ${unitId}, repair the failed work, and rerun background verification.`,
    };
  }

  const failedWorkEvidence = payload.workEvidence?.find((entry) =>
    ['failed', 'failed-with-reason', 'repair-needed'].includes(String(entry.status || '').toLowerCase())
  );
  if (failedWorkEvidence) {
    return {
      failureSummary: failedWorkEvidence.failureReason ?? failedWorkEvidence.outputSummary ?? 'Work evidence reports a failure.',
      recommendedFix: failedWorkEvidence.nextStep ?? failedWorkEvidence.recoverActions[0] ?? 'Repair the failed evidence source and rerun background verification.',
    };
  }

  const failedVerification = payload.verificationResults?.find((result) => result.verdict === 'fail' || result.verdict === 'needs-human');
  if (failedVerification) {
    return {
      failureSummary: failedVerification.critique ?? `Verification result ${failedVerification.id ?? 'unknown'} did not pass.`,
      recommendedFix: failedVerification.repairHints[0] ?? 'Address the verification failure and rerun the verifier.',
    };
  }

  return {};
}

function releaseGateAuditForPayload(payload: ToolPayload, request?: GatewayRequest) {
  const explicit = releaseGateRecord(payload, request);
  const policy = releaseGatePolicyForPayload(payload, request);
  const steps = uniqueReleaseGateSteps([
    ...releaseGateStepsFromUnknown(explicit?.steps),
    ...payload.executionUnits.flatMap((unit) => releaseGateStepsFromExecutionUnit(unit, policy)),
    ...(payload.workEvidence ?? []).flatMap((entry) => releaseGateStepsFromWorkEvidence(entry, policy)),
    ...(payload.verificationResults ?? []).flatMap((result) => releaseGateStepsFromVerificationResult(result, policy)),
  ]);
  return buildReleaseGateAudit({
    policy,
    gateId: stringField(explicit?.gateId) ?? stringField(explicit?.id),
    changeSummary: stringField(explicit?.changeSummary) ?? stringField(explicit?.summary),
    currentBranch: stringField(explicit?.currentBranch) ?? stringField(gitRecord(request)?.currentBranch) ?? stringField(gitRecord(request)?.branch),
    targetRemote: stringField(explicit?.targetRemote) ?? stringField(gitRecord(request)?.targetRemote) ?? stringField(gitRecord(request)?.remote),
    targetBranch: stringField(explicit?.targetBranch) ?? stringField(gitRecord(request)?.targetBranch),
    steps,
    serviceHealth: Array.isArray(explicit?.serviceHealth)
      ? explicit.serviceHealth.filter(isRecord).map((service) => ({
        name: stringField(service.name) ?? 'service',
        status: stringField(service.status) ?? 'unknown',
        url: stringField(service.url),
        evidenceRefs: stringList(service.evidenceRefs),
      }))
      : undefined,
    auditRefs: uniqueStrings([
      ...stringList(explicit?.auditRefs),
    ]),
    gitRefs: uniqueStrings([
      ...stringList(explicit?.gitRefs),
      ...stringList(gitRecord(request)?.gitRefs),
    ]),
    createdAt: stringField(explicit?.createdAt),
  });
}

function releaseGatePolicyForPayload(payload: ToolPayload, request?: GatewayRequest) {
  const explicit = releaseGateRecord(payload, request);
  const uiState = isRecord(request?.uiState) ? request.uiState : {};
  return normalizeReleaseGatePolicy(
    isRecord(explicit?.policy) ? explicit.policy : isRecord(uiState.releaseGatePolicy) ? uiState.releaseGatePolicy : undefined,
  );
}

function releaseGateRecord(payload: ToolPayload, request?: GatewayRequest) {
  const displayIntent = isRecord(payload.displayIntent) ? payload.displayIntent : {};
  const verificationStatus = isRecord(displayIntent.verificationStatus) ? displayIntent.verificationStatus : {};
  const requestReleaseGate = isRecord(request?.uiState?.releaseGate) ? request?.uiState?.releaseGate : undefined;
  return [
    isRecord(displayIntent.releaseGate) ? displayIntent.releaseGate : undefined,
    isRecord(verificationStatus.releaseGate) ? verificationStatus.releaseGate : undefined,
    requestReleaseGate,
  ].find((record): record is Record<string, unknown> => Boolean(record));
}

function gitRecord(request: GatewayRequest | undefined) {
  if (!isRecord(request?.uiState)) return undefined;
  return isRecord(request.uiState.git) ? request.uiState.git : isRecord(request.uiState.gitState) ? request.uiState.gitState : undefined;
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
      evidenceRefs: stringList(entry.evidenceRefs),
    }];
  });
}

function releaseGateStepsFromExecutionUnit(unit: Record<string, unknown>, policy: ReleaseGatePolicy): ReleaseGateStepInput[] {
  if (!isRecord(unit)) return [];
  const status = releaseGateStepStatusFromRuntimeStatus(unit.status);
  const refs = refsFromRecord(unit);
  const explicit = releaseGateStepRecord(unit);
  const kind = releaseGateStepKind(explicit.kind);
  if (!kind) return [];
  if (kind === 'release-verify' && !releaseGateHasRequiredVerifyCommand(explicit.command, policy)) return [];
  const fallbackRef = stringField(unit.id) ? `execution-unit:${stringField(unit.id)}` : 'execution-unit:release-gate-step';
  return [{
    kind,
    status,
    command: explicit.command,
    summary: explicit.summary ?? stringField(unit.outputSummary),
    failureReason: explicit.failureReason ?? stringField(unit.failureReason) ?? stringField(unit.error),
    evidenceRefs: refs.length ? refs : [fallbackRef],
  }];
}

function releaseGateStepsFromWorkEvidence(entry: {
  kind: string;
  status: string;
  provider?: string;
  input?: Record<string, unknown> | string;
  outputSummary?: string;
  evidenceRefs: string[];
  failureReason?: string;
}, policy: ReleaseGatePolicy): ReleaseGateStepInput[] {
  const status = releaseGateStepStatusFromRuntimeStatus(entry.status);
  const explicit = releaseGateStepRecord(entry as unknown as Record<string, unknown>);
  const kind = releaseGateStepKind(explicit.kind);
  if (!kind) return [];
  if (kind === 'release-verify' && !releaseGateHasRequiredVerifyCommand(explicit.command, policy)) return [];
  return [{
    kind,
    status,
    command: explicit.command,
    summary: explicit.summary ?? entry.outputSummary,
    failureReason: explicit.failureReason ?? entry.failureReason,
    evidenceRefs: entry.evidenceRefs,
  }];
}

function releaseGateStepsFromVerificationResult(result: {
  id?: string;
  verdict: string;
  critique?: string;
  evidenceRefs: string[];
}, policy: ReleaseGatePolicy): ReleaseGateStepInput[] {
  const explicit = releaseGateStepRecord(result as unknown as Record<string, unknown>);
  const kind = releaseGateStepKind(explicit.kind);
  if (kind !== 'release-verify') return [];
  if (!releaseGateHasRequiredVerifyCommand(explicit.command, policy)) return [];
  return [{
    kind: 'release-verify' as const,
    status: result.verdict === 'pass' ? 'passed' : result.verdict === 'fail' || result.verdict === 'needs-human' ? 'failed' : 'pending',
    command: explicit.command,
    failureReason: result.verdict === 'pass' ? undefined : result.critique,
    evidenceRefs: result.evidenceRefs,
  }];
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

function releaseGateStepRecord(record: Record<string, unknown>) {
  const nested = isRecord(record.releaseGateStep) ? record.releaseGateStep : {};
  return {
    kind: stringField(nested.kind),
    command: stringField(nested.command),
    summary: stringField(nested.summary),
    failureReason: stringField(nested.failureReason),
  };
}

function emitBackgroundWorkVerifyEvent(input: {
  callbacks?: WorkspaceRuntimeCallbacks;
  completedAt: string;
  job: VerifyJob;
  request: GatewayRequest;
  routing: VerifyRoutingDecision;
  runId: string;
  verdict?: VerifyVerdict;
}) {
  const event = backgroundWorkVerifyEvent(input);
  emitWorkspaceRuntimeEvent(input.callbacks, {
    type: event.type,
    source: WORKSPACE_RUNTIME_SOURCE,
    status: event.status,
    message: event.message,
    detail: event.failureReason ?? event.nextStep ?? event.finalResponse,
    workEvidence: event.workEvidence as WorkspaceRuntimeEvent['workEvidence'],
    raw: event,
  });
}

function backgroundWorkVerifyEvent(input: {
  completedAt: string;
  job: VerifyJob;
  request: GatewayRequest;
  routing: VerifyRoutingDecision;
  runId: string;
  verdict?: VerifyVerdict;
}): BackgroundCompletionRuntimeEvent {
  const failed = input.job.status === 'failed';
  const verificationId = input.job.id;
  const evidenceRefs = input.verdict?.evidenceRefs ?? input.job.evidenceRefs;
  const status = failed ? 'failed' : 'completed';
  const failureReason = input.job.failureSummary;
  const nextStep = input.job.recommendedFix;
  const backgroundEvent: BackgroundCompletionRuntimeEvent = {
    contract: BACKGROUND_COMPLETION_CONTRACT_ID,
    type: 'background-stage-update',
    runId: input.runId,
    stageId: input.job.id,
    ref: `run:${input.runId}#${input.job.id}`,
    status,
    prompt: latestIntentText(input.request),
    message: failed
      ? 'Background work verification found a repairable failure.'
      : 'Background work verification completed without finding a blocking failure.',
    finalResponse: failed ? undefined : 'Background work verification passed.',
    createdAt: input.completedAt,
    completedAt: input.completedAt,
    failureReason,
    recoverActions: nextStep ? [nextStep] : [],
    nextStep,
    refs: backgroundRefsForJob(input.job, input.runId),
    verificationResults: [{
      id: verificationId,
      verdict: failed ? 'fail' : 'pass',
      confidence: failed ? 0.9 : 0.72,
      critique: failureReason ?? 'Lightweight background work verification found target refs and no failed execution evidence.',
      evidenceRefs,
      repairHints: nextStep ? [nextStep] : [],
      diagnostics: {
        schemaVersion: INTENT_FIRST_VERIFICATION_SCHEMA_VERSION,
        route: input.routing.mode,
        level: input.routing.level,
        blockingPolicy: input.routing.blockingPolicy,
      },
    }],
    workEvidence: [{
      kind: 'validate',
      id: `work-evidence-${verificationId}`,
      status: failed ? 'failed-with-reason' : 'success',
      provider: INTENT_FIRST_VERIFY_PROVIDER,
      input: {
        jobId: input.job.id,
        level: input.job.level,
        scope: input.job.scope,
      },
      resultCount: evidenceRefs.length,
      outputSummary: failureReason ?? 'Background work verification completed.',
      failureReason,
      evidenceRefs,
      recoverActions: nextStep ? [nextStep] : [],
      nextStep,
      diagnostics: [
        `jobStatus=${input.job.status}`,
        `blockingPolicy=${input.job.blockingPolicy}`,
      ],
      rawRef: `verify-job:${input.job.id}`,
    }],
    raw: {
      schemaVersion: INTENT_FIRST_VERIFICATION_SCHEMA_VERSION,
      routing: input.routing,
      job: input.job,
      verdict: input.verdict,
    },
  };
  return backgroundEvent;
}

function backgroundRefsForJob(job: VerifyJob, runId: string): BackgroundCompletionRef[] {
  return [
    { ref: `verify-job:${job.id}`, kind: 'verification', runId, stageId: job.id, title: `Verify job ${job.id}` },
    ...job.targetRefs.map((ref): BackgroundCompletionRef => ({
      ref,
      kind: refKind(ref),
      runId,
      stageId: job.id,
    })),
  ];
}

function refKind(ref: string): BackgroundCompletionRef['kind'] {
  if (ref.startsWith('artifact:')) return 'artifact';
  if (ref.startsWith('execution-unit:')) return 'execution-unit';
  if (ref.startsWith('file:') || ref.startsWith('.')) return 'file';
  if (ref.startsWith('http://') || ref.startsWith('https://')) return 'url';
  if (ref.startsWith('work-evidence:')) return 'work-evidence';
  if (ref.startsWith('verification:')) return 'verification';
  return 'file';
}

function verifyRunIdForRequest(request: GatewayRequest) {
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  return stringField(uiState.activeRunId)
    ?? stringField(uiState.runId)
    ?? (stringField(uiState.sessionId) ? `verify-${stringField(uiState.sessionId)}` : undefined)
    ?? stableId('verify-run', latestIntentText(request) || request.skillDomain);
}

function refsFromRecord(value: unknown) {
  if (!isRecord(value)) return [];
  return ['ref', 'dataRef', 'path', 'outputRef', 'stdoutRef', 'stderrRef', 'rawRef']
    .map((key) => stringField(value[key]))
    .filter((ref): ref is string => Boolean(ref));
}

function stableId(prefix: string, value: string) {
  let hash = 0;
  for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return `${prefix}-${hash.toString(16).padStart(8, '0')}`;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0) : [];
}

function toRecordList(value: unknown) {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}
