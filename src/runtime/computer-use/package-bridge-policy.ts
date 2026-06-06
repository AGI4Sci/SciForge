import {
  computerUseRequiresSavedVisibleArtifact,
  computerUseVisibleArtifactGapReason,
} from '../../../packages/actions/computer-use/runtime-policy.js';
import type { GenericVisionAction } from './types.js';
import type { VirtualRemoteVisibleArtifact } from './virtual-remote-session.js';
import { finalVisibleArtifactForTrace } from './package-bridge-final-artifacts.js';

export type PackageBridgeFinalVisibleArtifactPolicyInput = {
  packageResult: Record<string, unknown>;
  task: string;
  executedActions: GenericVisionAction[];
  visibleArtifacts: VirtualRemoteVisibleArtifact[];
};

export type PackageBridgeVisibleArtifactPolicyInput = {
  task: string;
  executedActions: GenericVisionAction[];
  finalAttempt?: boolean;
  finalVisibleArtifact?: VirtualRemoteVisibleArtifact;
};

export type PackageBridgeAcceptanceEvidenceInput = {
  status?: unknown;
  evidenceTier?: unknown;
  executionMode?: unknown;
  productPathClassification?: Record<string, unknown>;
  packageDiagnosticOnly?: unknown;
  diagnosticOnly?: unknown;
  userAcceptanceEligible?: unknown;
  realWindowEvidence?: unknown;
  currentBundleOnly?: unknown;
  [key: string]: unknown;
};

export type PackageBridgeAcceptanceEvidenceTier = 'package-diagnostic' | 'product-smoke';

export type PackageBridgeAcceptanceEvidenceClassification = {
  tier: PackageBridgeAcceptanceEvidenceTier;
  canSatisfyProductSmoke: boolean;
  reasons: string[];
};

export function applyPackageBridgeFinalVisibleArtifactPolicy(
  input: PackageBridgeFinalVisibleArtifactPolicyInput,
): Record<string, unknown> {
  const { packageResult } = input;
  if (stringAt(packageResult, 'status') !== 'completed') return packageResult;
  const finalGap = packageBridgeVisibleArtifactPolicy({
    task: input.task,
    executedActions: input.executedActions,
    finalAttempt: true,
    finalVisibleArtifact: finalVisibleArtifactForTrace(input.visibleArtifacts, {
      requireSaved: computerUseRequiresSavedVisibleArtifact(input.task),
    }),
  });
  if (!finalGap) return packageResult;
  return {
    ...packageResult,
    status: 'failed-with-reason',
    reason: finalGap,
    failureDiagnostics: {
      ...recordAt(packageResult, 'failureDiagnostics'),
      failedStage: 'visible-artifact-final-guard',
      reason: finalGap,
    },
  };
}

export function packageBridgeVisibleArtifactPolicy(
  input: PackageBridgeVisibleArtifactPolicyInput,
) {
  const gap = computerUseVisibleArtifactGapReason(input.task, input.executedActions, {
    finalAttempt: input.finalAttempt,
  });
  if (!gap) return undefined;
  if (input.finalAttempt && input.finalVisibleArtifact) return undefined;
  return gap;
}

export function classifyPackageBridgeAcceptanceEvidence(
  input: PackageBridgeAcceptanceEvidenceInput,
): PackageBridgeAcceptanceEvidenceClassification {
  const productPathClassification = recordAt(input, 'productPathClassification');
  const explicitTier = stringAt(productPathClassification, 'tier') || stringAt(input, 'evidenceTier');
  const packageDiagnosticOnly = (
    input.packageDiagnosticOnly === true
    || productPathClassification?.packageDiagnosticOnly === true
    || explicitTier === 'package-diagnostic'
  );
  const currentBundleOnly = input.currentBundleOnly === true || productPathClassification?.currentBundleOnly === true;
  const productSmokeBlockers = packageBridgeProductSmokeBlockers(
    input,
    productPathClassification,
    explicitTier,
    packageDiagnosticOnly,
    currentBundleOnly,
  );
  const productSmokeCandidate = explicitTier === 'product-smoke'
    && productSmokeBlockers.length === 0;
  const tier: PackageBridgeAcceptanceEvidenceTier = productSmokeCandidate ? 'product-smoke' : 'package-diagnostic';
  const reasons = [
    tier === 'package-diagnostic' ? 'package-diagnostic-evidence-cannot-satisfy-product-smoke' : '',
    ...productSmokeBlockers,
  ].filter(Boolean);

  return {
    tier,
    canSatisfyProductSmoke: tier === 'product-smoke',
    reasons: uniqueStrings(reasons),
  };
}

export function packageBridgeEvidenceSatisfiesProductSmoke(
  input: PackageBridgeAcceptanceEvidenceInput,
) {
  return classifyPackageBridgeAcceptanceEvidence(input).canSatisfyProductSmoke;
}

function packageBridgeProductSmokeBlockers(
  input: PackageBridgeAcceptanceEvidenceInput,
  productPathClassification: Record<string, unknown> | undefined,
  explicitTier: string | undefined,
  packageDiagnosticOnly: boolean,
  currentBundleOnly: boolean,
) {
  if (explicitTier !== 'product-smoke') {
    return packageDiagnosticOnly ? ['package-diagnostic-only'] : [];
  }

  const blockers = [
    input.status !== 'completed' ? 'not-completed-product-smoke-status' : '',
    input.userAcceptanceEligible !== true ? 'missing-user-acceptance-eligibility' : '',
    input.diagnosticOnly !== false || productPathClassification?.diagnosticOnly === true
      ? 'diagnostic-only-product-path'
      : '',
    packageDiagnosticOnly ? 'package-diagnostic-only' : '',
    input.realWindowEvidence !== true ? 'missing-real-window-evidence' : '',
    currentBundleOnly !== true ? 'missing-current-bundle-only' : '',
    ...missingProductPathClassificationRefs(productPathClassification),
    ...missingProductPathHops(productPathClassification),
    ...missingDisplayRefs(input),
    ...missingActorCursorRefs(input),
    ...missingUserControlRefs(input),
    ...missingPlatformSidecarIsolationRefs(input),
    ...missingIndependentActionLedgerRefs(input),
    ...missingReplayBundleRefs(input),
  ].filter(Boolean);

  return uniqueStrings(blockers);
}

function missingProductPathClassificationRefs(productPathClassification: Record<string, unknown> | undefined) {
  return [
    !stringAt(productPathClassification, 'currentBundleRef') ? 'missing-current-bundle-ref' : '',
    !stringAt(productPathClassification, 'appServerRunRef') ? 'missing-app-server-run-ref' : '',
    !stringAt(productPathClassification, 'nativePluginInvocationRef') ? 'missing-native-plugin-invocation-ref' : '',
    !stringAt(productPathClassification, 'sciforgeComputerUseRunTaskRef')
      ? 'missing-sciforge-computer-use-run-task-ref'
      : '',
    !stringAt(productPathClassification, 'platformSidecarIsolationReportRef')
      ? 'missing-platform-sidecar-isolation-ref'
      : '',
  ].filter(Boolean);
}

function missingProductPathHops(productPathClassification: Record<string, unknown> | undefined) {
  const hops = new Set(stringArray(productPathClassification?.hops).map(normalizeToken));
  return [
    !hops.has('codex-app-server') ? 'missing-codex-app-server-hop' : '',
    !hops.has('codex-native-plugin') ? 'missing-codex-native-plugin-hop' : '',
    !hops.has('sciforge-computer-use') ? 'missing-sciforge-computer-use-hop' : '',
    ![...hops].some((hop) => (
      hop === 'platform-sidecar'
      || hop === 'native-platform-sidecar'
      || hop === 'native-multi-screen-sidecar'
    )) ? 'missing-native-platform-sidecar-hop' : '',
  ].filter(Boolean);
}

function missingDisplayRefs(input: PackageBridgeAcceptanceEvidenceInput) {
  const displayGroup = recordAt(input, 'virtualDisplayGroup') ?? recordAt(input, 'displayGroup');
  const screens = [
    ...records(input.screens),
    ...records(displayGroup?.screens),
  ];
  const hasDisplayGroup = Boolean(
    stringAt(input, 'displayGroupRef')
    || stringAt(displayGroup, 'ref')
    || stringAt(displayGroup, 'displayGroupRef')
    || stringAt(displayGroup, 'displayGroupId'),
  );
  const hasScreen = Boolean(
    stringAt(input, 'screenRef')
    || screens.some((screen) => stringAt(screen, 'ref') || stringAt(screen, 'screenRef') || stringAt(screen, 'screenId')),
  );
  const hasWindow = Boolean(
    stringAt(input, 'targetWindowRef')
    || stringAt(input, 'windowRef')
    || screens.some((screen) => stringAt(screen, 'targetWindowRef') || stringAt(screen, 'windowRef')),
  );
  return [
    !hasDisplayGroup ? 'missing-display-group-ref' : '',
    !hasScreen ? 'missing-screen-ref' : '',
    !hasWindow ? 'missing-window-ref' : '',
  ].filter(Boolean);
}

function missingActorCursorRefs(input: PackageBridgeAcceptanceEvidenceInput) {
  const cursors = [
    ...records(input.actorCursorProvenance),
    ...records(input.actorCursors),
    ...records(input.visibleCursorRefs),
    ...records(recordAt(input, 'virtualDesktopSession')?.actorCursors),
  ];
  const hasActorCursor = cursors.some((cursor) => (
    stringAt(cursor, 'actorId')
    && stringAt(cursor, 'cursorId')
    && stringAt(cursor, 'screenId')
    && (
      stringAt(cursor, 'ref')
      || stringAt(cursor, 'cursorEventLogRef')
      || stringAt(cursor, 'actorCursorLogRef')
    )
  ));
  return hasActorCursor ? [] : ['missing-actor-cursor-ref'];
}

function missingUserControlRefs(input: PackageBridgeAcceptanceEvidenceInput) {
  const control = recordAt(input, 'userControlPlane')
    ?? recordAt(input, 'userControl')
    ?? recordAt(input, 'sessionPermission');
  const hasStopRef = Boolean(stringAt(control, 'stopRef') || stringAt(control, 'cancelLeaseRef'));
  const hasUserControl = Boolean(
    stringAt(control, 'sessionPermissionRef')
    && stringArray(control?.allowedAppRefs).length > 0
    && stringArray(control?.allowedWindowRefs).length > 0
    && stringArray(control?.forbiddenAppRefs).length > 0
    && (stringAt(control, 'inputModalityPolicyRef') || stringAt(recordAt(control, 'inputModalityPolicy'), 'ref'))
    && stringAt(control, 'riskPreviewRef')
    && stringAt(control, 'dataVisibilityRef')
    && hasStopRef
    && stringAt(control, 'approvalMode')
  );
  return hasUserControl ? [] : ['missing-user-control-ref'];
}

function missingPlatformSidecarIsolationRefs(input: PackageBridgeAcceptanceEvidenceInput) {
  const report = recordAt(input, 'platformSidecarIsolationReport')
    ?? recordAt(input, 'platformSidecarIsolation')
    ?? recordAt(input, 'platformSidecar');
  const status = stringAt(report, 'status');
  const backendKind = normalizeToken(
    stringAt(report, 'backendKind')
    || stringAt(report, 'sidecarKind')
    || stringAt(report, 'kind')
    || '',
  );
  const hasNativeSidecar = (
    (status === 'present' || status === 'passed')
    && (
      backendKind === 'platform-sidecar'
      || backendKind === 'native-platform-sidecar'
      || backendKind === 'native-multi-screen-sidecar'
    )
    && stringAt(report, 'reportRef')
    && stringAt(report, 'captureRef')
    && stringAt(report, 'stateRef')
    && stringAt(report, 'preflightRef')
    && stringAt(report, 'executorAdapterRef')
  );
  return hasNativeSidecar ? [] : ['missing-platform-sidecar-isolation'];
}

function missingIndependentActionLedgerRefs(input: PackageBridgeAcceptanceEvidenceInput) {
  const completionEvidence = recordAt(input, 'completionEvidence') ?? {};
  const ledger = recordAt(input, 'evidenceLedger') ?? recordAt(input, 'actionLedger');
  const actionLedgerRef = firstString(input, ['actionLedgerRef', 'mutatingActionLedgerRef', 'evidenceActionLedgerRef'])
    || firstString(ledger ?? {}, ['ref', 'actionLedgerRef'])
    || firstString(completionEvidence, ['actionLedgerRef', 'executorCommandEventLogRef', 'inputEventLogRef', 'evidenceLogRef']);
  const evidenceIndexRef = firstString(input, ['evidenceIndexRef', 'evidenceRefsIndexRef', 'currentRunEvidenceIndexRef'])
    || firstString(recordAt(input, 'evidenceIndex') ?? {}, ['ref', 'indexRef'])
    || firstString(completionEvidence, ['evidenceIndexRef', 'evidenceSnapshotRef']);
  const ledgerRecords = [
    ...records(ledger?.actions),
    ...records(ledger?.actionRecords),
    ...records(ledger?.mutatingActions),
    ...records(ledger?.entries),
    ...records(ledger?.records),
    ...records(input.evidenceLedgerActions),
  ];
  const hasIndependentRecord = ledgerRecords.some((record) => (
    firstString(record, ['executorEventRef', 'executeEventRef', 'eventRef', 'ref'])
    && (
      stringArray(record.beforeEvidenceRefs).length > 0
      || stringArray(record.afterEvidenceRefs).length > 0
      || stringArray(record.verificationRefs).length > 0
      || stringArray(record.artifactRefs).length > 0
    )
  ));
  return actionLedgerRef && evidenceIndexRef && hasIndependentRecord ? [] : ['missing-independent-action-ledger-ref'];
}

function missingReplayBundleRefs(input: PackageBridgeAcceptanceEvidenceInput) {
  const replay = recordAt(input, 'replayBundle')
    ?? recordAt(input, 'replayManifest')
    ?? recordAt(input, 'visibleReplay');
  const frames = records(replay?.frames);
  const hasRealFrame = frames.some((frame) => (
    frame.placeholder !== true
    && stringAt(frame, 'screenId')
    && stringAt(frame, 'screenshotRef')
    && stringArray(frame.cursorOverlayRefs).length > 0
  ));
  const hasReplayBundle = Boolean(
    (stringAt(replay, 'ref') || stringAt(input, 'replayRef'))
    && hasRealFrame
    && stringArray(replay?.cursorOverlayRefs).length > 0
    && stringArray(replay?.leaseOwnerRefs).length > 0
    && stringArray(replay?.beforeEvidenceRefs).length > 0
    && stringArray(replay?.afterEvidenceRefs).length > 0
  );
  return hasReplayBundle ? [] : ['missing-replay-bundle-ref'];
}

export function normalizePackageBridgeBlockedReason(
  packageResult: Record<string, unknown>,
  status: string | undefined,
) {
  const reason = stringAt(packageResult, 'reason')
    || stringAt(packageResult, 'message')
    || `Computer Use package returned status=${status || 'unknown'}.`;
  if (status === 'max-steps') {
    return reason.replace(/\bmax_steps=/g, 'maxSteps=');
  }
  if (status === 'needs-confirmation' && /high-risk|confirmation/i.test(reason)) {
    return `High-risk Computer Use action blocked: ${reason}`;
  }
  return reason;
}

export function packageBridgeLedgerCompletionQuotaIssue(
  plannerAcceptanceContract: Record<string, unknown> | undefined,
  executedActions: GenericVisionAction[],
  maxSteps: number,
) {
  const issue = packageBridgeAcceptanceProgressQuotaIssue(plannerAcceptanceContract, executedActions, maxSteps);
  if (!issue) return undefined;
  return `Action-ledger completion policy is satisfied, but ${issue}`;
}

export function packageBridgeAcceptanceProgressQuotaIssue(
  plannerAcceptanceContract: Record<string, unknown> | undefined,
  executedActions: GenericVisionAction[],
  maxSteps: number,
) {
  const progress = recordAt(plannerAcceptanceContract, 'acceptanceProgress');
  if (!progress) return undefined;
  const remainingStepBudget = Math.max(0, maxSteps - executedActions.length);
  if (remainingStepBudget <= 0) return undefined;
  const actionTarget = positiveQuota(numberAt(progress.suggestedCurrentRoundActionTarget));
  const nonWaitTarget = positiveQuota(numberAt(progress.suggestedCurrentRoundNonWaitActionTarget));
  const actionCount = executedActions.length;
  const nonWaitActionCount = executedActions.filter((action) => action.type !== 'wait').length;
  const issues = [
    actionTarget !== undefined && actionCount < actionTarget
      ? `actions=${actionCount}/${actionTarget}`
      : '',
    nonWaitTarget !== undefined && nonWaitActionCount < nonWaitTarget
      ? `nonWaitActions=${nonWaitActionCount}/${nonWaitTarget}`
      : '',
  ].filter(Boolean);
  if (!issues.length) return undefined;
  return `current-round acceptance quota is not met yet (${issues.join(', ')}); continue with another safe generic action or return structured failure if no safe visible action remains.`;
}

export function packageBridgeAcceptanceProgressCompletion(
  plannerAcceptanceContract: Record<string, unknown> | undefined,
  executedActions: GenericVisionAction[],
) {
  const progress = recordAt(plannerAcceptanceContract, 'acceptanceProgress');
  if (!progress) return undefined;
  const actionTarget = positiveQuota(numberAt(progress.suggestedCurrentRoundActionTarget));
  const nonWaitTarget = positiveQuota(numberAt(progress.suggestedCurrentRoundNonWaitActionTarget));
  if (actionTarget === undefined && nonWaitTarget === undefined) return undefined;
  const actionCount = executedActions.length;
  const nonWaitActionCount = executedActions.filter((action) => action.type !== 'wait').length;
  const actionSatisfied = actionTarget === undefined || actionCount >= actionTarget;
  const nonWaitSatisfied = nonWaitTarget === undefined || nonWaitActionCount >= nonWaitTarget;
  if (!actionSatisfied || !nonWaitSatisfied) return undefined;
  return {
    status: 'satisfied',
    reason: [
      'current-round acceptance progress satisfied',
      actionTarget !== undefined ? `actions=${actionCount}/${actionTarget}` : undefined,
      nonWaitTarget !== undefined ? `nonWaitActions=${nonWaitActionCount}/${nonWaitTarget}` : undefined,
    ].filter(Boolean).join(' '),
  };
}

function positiveQuota(value: number | undefined) {
  if (value === undefined || value <= 0) return undefined;
  return Math.ceil(value);
}

function recordAt(value: unknown, key: string) {
  if (!isRecord(value)) return undefined;
  const item = value[key];
  return isRecord(item) ? item : undefined;
}

function stringAt(value: unknown, key: string) {
  if (!isRecord(value)) return undefined;
  const item = value[key];
  return typeof item === 'string' && item.trim() ? item : undefined;
}

function firstString(value: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const item = stringAt(value, key);
    if (item) return item;
  }
  return undefined;
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function records(value: unknown) {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function normalizeToken(value: string) {
  return value.trim().toLowerCase().replace(/[_\s]+/g, '-');
}

function numberAt(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}
