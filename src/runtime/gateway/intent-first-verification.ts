import type { GatewayRequest, ToolPayload } from '../runtime-types.js';
import { isRecord } from '../gateway-utils.js';
import {
  actionSideEffectsHaveHighRiskSignal,
  explicitIntentConstraintsForText,
  intentTextHasHighRiskSignal,
  requestedActionTypeForIntentText,
  verifyRouteModeForIntentText,
  type IntentRequestedActionType,
  type VerifyRouteMode,
} from '@sciforge-ui/runtime-contract/intent-first-verification-policy';

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
  targetRefs: string[];
  evidenceRefs: string[];
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

export interface IntentFirstVerificationEnvelope {
  schemaVersion: typeof INTENT_FIRST_VERIFICATION_SCHEMA_VERSION;
  intentCheck: IntentMatchCheck;
  routing: VerifyRoutingDecision;
  jobs: VerifyJob[];
  verdicts: VerifyVerdict[];
}

export function attachIntentFirstVerification(payload: ToolPayload, request: GatewayRequest): ToolPayload {
  const intentCheck = buildIntentMatchCheck(request, payload);
  const routing = verifyRoutingDecision(request);
  const jobs = buildVerifyJobs(payload, routing);
  const verdicts = jobs.map((job): VerifyVerdict => ({
    schemaVersion: INTENT_FIRST_VERIFICATION_SCHEMA_VERSION,
    jobId: job.id,
    verdict: job.status === 'skipped' ? 'not-run' : 'pending',
    evidenceRefs: job.evidenceRefs,
    recommendedFix: job.recommendedFix,
  }));
  const envelope: IntentFirstVerificationEnvelope = {
    schemaVersion: INTENT_FIRST_VERIFICATION_SCHEMA_VERSION,
    intentCheck,
    routing,
    jobs,
    verdicts,
  };
  const hasPendingWorkVerify = jobs.some((job) => job.status === 'queued' || job.status === 'running');
  const workStatus = verificationWorkStatus(jobs, routing);

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
        status: intentCheck.verdict === 'fail' ? 'failed-with-reason' : hasPendingWorkVerify ? 'partial' : 'success',
        provider: INTENT_FIRST_VERIFY_PROVIDER,
        input: {
          requestedActionType: intentCheck.requestedActionType,
          route: routing.mode,
          level: routing.level,
        },
        resultCount: 1,
        outputSummary: hasPendingWorkVerify
          ? 'Intent match check completed; work verification is represented as a separate pending verify job.'
          : intentCheck.verdict === 'pass'
            ? 'Intent match check passed without requiring work verification.'
          : `Intent match check ${intentCheck.verdict}: ${intentCheck.diagnostics.join('; ')}`,
        evidenceRefs: jobs.flatMap((job) => job.evidenceRefs),
        recoverActions: intentCheck.verdict === 'fail' ? ['Revise the answer to match the latest user intent before doing more work.'] : [],
        diagnostics: [
          `answerCoverage=${intentCheck.answerCoverage}`,
          `overActionGuard=${intentCheck.overActionGuard}`,
          `verifyRoute=${routing.mode}`,
          `blockingPolicy=${routing.blockingPolicy}`,
        ],
        rawRef: `intent-match:${intentCheck.id}`,
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
      },
    },
  };
}

function verificationWorkStatus(jobs: VerifyJob[], routing: VerifyRoutingDecision) {
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
  const prompt = latestIntentText(request).toLowerCase();
  const explicitMode = stringField(policy.mode) ?? stringField(policy.route) ?? stringField(policy.level);
  const mode = normalizeRouteMode(explicitMode)
    ?? promptRouteMode(prompt)
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

export function buildVerifyJobs(payload: ToolPayload, routing: VerifyRoutingDecision): VerifyJob[] {
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

function promptRouteMode(prompt: string): VerifyRouteMode | undefined {
  return verifyRouteModeForIntentText(prompt);
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
