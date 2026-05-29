import { isRecord } from '../gateway-utils.js';
import { groundingForAction } from './actions.js';
import {
  createFocusedCropRefs,
  pixelDiffForScreenshotSets,
  toTraceScreenshotRef,
} from './capture.js';
import { executorBoundary } from './executor.js';
import { independentInputAdapterExecutionBoundary } from './independent-input-adapter.js';
import { computerUseArtifactIntentText } from './package-bridge-execute-port.js';
import {
  finalVisibleArtifactForTrace,
} from './package-bridge-final-artifacts.js';
import {
  packageBridgeLedgerCompletionQuotaIssue,
  packageBridgeVisibleArtifactPolicy,
} from './package-bridge-policy.js';
import type { HostPortCall } from './package-bridge-stdio.js';
import {
  packageRegionSemanticVerifier,
  packageVerifierPlanningFeedback,
} from './package-bridge-trace.js';
import type { ComputerUseConfig, FocusRegion, GenericVisionAction, LoopStep, ScreenshotRef, WindowTargetResolution } from './types.js';
import type { VirtualRemoteVisibleArtifact } from './virtual-remote-session.js';
import {
  inputChannelDescription,
  schedulerStepMetadata,
  toTraceWindowTarget,
} from './window-target.js';
import { actionLedgerCompletion } from '../vision-sense/computer-use-plan.js';
import {
  windowConsistencyMetadata,
} from '../vision-sense/computer-use-window-session.js';
import {
  visionSenseTraceContractPolicy,
} from '../../../packages/observe/vision/computer-use-runtime-policy.js';

type PackageBridgeVerifyState = {
  runDir: string;
  targetResolution: WindowTargetResolution;
  screenshotLedger: ScreenshotRef[];
  captureRefsByObservationRef: Map<string, ScreenshotRef[]>;
  focusRegionByObservationRef: Map<string, FocusRegion>;
  beforeFocusRefsByObservationRef: Map<string, ScreenshotRef[]>;
  afterFocusRefsByObservationRef: Map<string, ScreenshotRef[]>;
  actionQueue: GenericVisionAction[];
  activeAction?: GenericVisionAction;
  executedActions: GenericVisionAction[];
  dynamicPlannerEnabled: boolean;
  plannerReportedDone: boolean;
  plannerAcceptanceContract?: Record<string, unknown>;
  visionHistorySteps: LoopStep[];
  visibleArtifacts: VirtualRemoteVisibleArtifact[];
};

type PackagePlanToGenericAction = (
  plan: Record<string, unknown>,
  activeAction?: GenericVisionAction,
  grounding?: Record<string, unknown>,
) => GenericVisionAction;

export async function verifyPackageBridgePort(
  call: HostPortCall,
  context: {
    workspace: string;
    config: ComputerUseConfig;
    state: PackageBridgeVerifyState;
    packagePlanToGenericAction: PackagePlanToGenericAction;
  },
) {
  const { workspace, config, state } = context;
  const request = recordArg(call, 0);
  const plannerAcceptanceContract = recordAt(recordAt(request, 'metadata'), 'plannerAcceptanceContract') ?? state.plannerAcceptanceContract;
  const before = recordArg(call, 1);
  const after = recordArg(call, 2);
  const action = context.packagePlanToGenericAction(recordArg(call, 3), state.activeAction);
  const execution = recordArg(call, 4);
  const beforeObservationRef = stringAt(before, 'ref') ?? '';
  const beforeRefs = state.captureRefsByObservationRef.get(beforeObservationRef) ?? [];
  const afterRefs = state.captureRefsByObservationRef.get(stringAt(after, 'ref') ?? '') ?? [];
  const focusRegion = state.focusRegionByObservationRef.get(beforeObservationRef);
  if (focusRegion && afterRefs.length && !state.afterFocusRefsByObservationRef.has(beforeObservationRef)) {
    const stepNumber = String(state.executedActions.length).padStart(3, '0');
    const afterFocusRefs = await createFocusedCropRefs(workspace, state.runDir, `step-${stepNumber}-after`, afterRefs, focusRegion, config);
    state.screenshotLedger.push(...afterFocusRefs);
    state.afterFocusRefsByObservationRef.set(beforeObservationRef, afterFocusRefs);
  }
  const beforeFocusRefs = state.beforeFocusRefsByObservationRef.get(beforeObservationRef) ?? [];
  const afterFocusRefs = state.afterFocusRefsByObservationRef.get(beforeObservationRef) ?? [];
  const executionOk = execution.ok !== false;
  const artifactIntentText = computerUseArtifactIntentText(request);
  const artifactGap = packageBridgeVisibleArtifactPolicy({
    task: artifactIntentText,
    executedActions: state.executedActions,
  });
  const pixelDiff = pixelDiffForScreenshotSets(beforeRefs, afterRefs);
  const focusPixelDiff = beforeFocusRefs.length && afterFocusRefs.length
    ? pixelDiffForScreenshotSets(beforeFocusRefs, afterFocusRefs)
    : undefined;
  const windowConsistency = windowConsistencyMetadata(beforeRefs, afterRefs, config);
  const historyGrounding = groundingForAction(action) ?? {};
  const historyStatus = executionOk ? 'done' : 'failed';
  const planningFeedback = packageVerifierPlanningFeedback(action, historyGrounding, pixelDiff, windowConsistency, historyStatus);
  const regionSemantic = packageRegionSemanticVerifier(action, historyGrounding, pixelDiff, historyStatus);
  const executionMetadata = recordAt(execution, 'metadata');
  const executorLease = isRecord(executionMetadata?.schedulerLease) ? executionMetadata.schedulerLease : undefined;
  const visualFocus = focusRegion ? {
    ...visionSenseTraceContractPolicy.visualFocus,
    region: focusRegion,
    beforeFocusScreenshotRefs: beforeFocusRefs.map(toTraceScreenshotRef),
    afterFocusScreenshotRefs: afterFocusRefs.map(toTraceScreenshotRef),
    pixelDiff: focusPixelDiff,
    fineGrounding: isRecord(historyGrounding.fineGrounding) ? historyGrounding.fineGrounding : undefined,
  } : undefined;
  const pushHistoryStep = (verification: Record<string, unknown>) => {
    const stepNumber = String(state.executedActions.length).padStart(3, '0');
    state.visionHistorySteps.push({
      id: `step-${stepNumber}-execute-${action.type}`,
      kind: 'gui-execution',
      status: executionOk ? 'done' : 'failed',
      beforeScreenshotRefs: beforeRefs.map(toTraceScreenshotRef),
      afterScreenshotRefs: afterRefs.map(toTraceScreenshotRef),
      plannedAction: action,
      grounding: historyGrounding,
      visualFocus,
      execution: {
        executor: config.dryRun ? 'dry-run-generic-gui-executor' : independentInputAdapterExecutionBoundary(config) ?? executorBoundary(config),
        inputChannel: inputChannelDescription(config, state.targetResolution),
        windowTarget: state.targetResolution.ok ? toTraceWindowTarget(state.targetResolution) : undefined,
        status: executionOk ? 'done' : 'failed',
        exitCode: numberAt(executionMetadata?.exitCode) ?? (executionOk ? 0 : 1),
        stdout: stringAt(executionMetadata, 'stdout'),
        stderr: stringAt(executionMetadata, 'stderr'),
        schedulerLease: executorLease,
        independentInputAdapter: executionMetadata?.independentInputAdapter,
      },
      scheduler: {
        ...schedulerStepMetadata(state.targetResolution, `step-${stepNumber}`, config),
        executorLease,
      },
      verifier: {
        status: executionOk ? 'checked' : 'skipped-after-execution-failure',
        method: 'computer-use-package-host-port-verifier',
        reason: stringAt(verification, 'reason'),
        pixelDiff,
        focusRegionPixelDiff: focusPixelDiff,
        windowConsistency,
        regionSemantic,
        planningFeedback,
      },
      failureReason: executionOk ? undefined : stringAt(execution, 'message') || 'Computer Use package bridge executor failed.',
    });
  };
  if (executionOk && artifactGap) {
    const verification = {
      ok: false,
      done: false,
      reason: artifactGap,
      changed: false,
      metadata: {
        method: 'package-bridge-visible-artifact-policy',
        pixelDiff,
        focusRegionPixelDiff: focusPixelDiff,
        visualFocus,
      },
    };
    pushHistoryStep(verification);
    return verification;
  }
  let ledgerCompletion: Awaited<ReturnType<typeof actionLedgerCompletion>> | undefined;
  if (executionOk) {
    ledgerCompletion = await actionLedgerCompletion(artifactIntentText, [
      ...state.visionHistorySteps,
      {
        id: `step-${String(state.executedActions.length).padStart(3, '0')}-execute-${action.type}`,
        kind: 'gui-execution',
        status: 'done',
        plannedAction: action,
        verifier: {
          status: 'checked',
          pixelDiff,
          focusRegionPixelDiff: focusPixelDiff,
          windowConsistency,
          planningFeedback,
          regionSemantic,
          visualFocus,
        },
      },
    ]);
  }
  const ledgerCompletionQuotaIssue = ledgerCompletion?.complete
    ? packageBridgeLedgerCompletionQuotaIssue(plannerAcceptanceContract, state.executedActions, config.maxSteps)
    : undefined;
  const ledgerCompletionArtifactIssue = ledgerCompletion?.complete && !ledgerCompletionQuotaIssue
    ? packageBridgeVisibleArtifactPolicy({
      task: artifactIntentText,
      executedActions: state.executedActions,
      finalAttempt: true,
      finalVisibleArtifact: finalVisibleArtifactForTrace(state.visibleArtifacts),
    })
    : undefined;
  const ledgerCompletionAccepted = Boolean(ledgerCompletion?.complete && !ledgerCompletionQuotaIssue && !ledgerCompletionArtifactIssue);
  if (ledgerCompletionAccepted) {
    state.actionQueue.length = 0;
    state.plannerReportedDone = true;
  }
  const fixtureQueueExhaustedArtifactGap = executionOk && !state.dynamicPlannerEnabled && state.actionQueue.length === 0 && !ledgerCompletionAccepted
    ? packageBridgeVisibleArtifactPolicy({
      task: artifactIntentText,
      executedActions: state.executedActions,
      finalAttempt: true,
      finalVisibleArtifact: finalVisibleArtifactForTrace(state.visibleArtifacts),
    })
    : '';
  if (fixtureQueueExhaustedArtifactGap) {
    const verification = {
      ok: false,
      done: false,
      reason: fixtureQueueExhaustedArtifactGap,
      changed: false,
      metadata: {
        method: 'package-bridge-visible-artifact-policy',
        pixelDiff,
        focusRegionPixelDiff: focusPixelDiff,
        visualFocus,
        finalAttempt: true,
      },
    };
    pushHistoryStep(verification);
    return verification;
  }
  const done = executionOk && (ledgerCompletionAccepted || (!state.dynamicPlannerEnabled && (state.actionQueue.length === 0 || (
    config.completionPolicy?.mode === 'one-successful-non-wait-action' && action.type !== 'wait'
  ))));
  const verification = {
    ok: executionOk,
    done,
    reason: executionOk
      ? ledgerCompletionQuotaIssue
        ? ledgerCompletionQuotaIssue
        : ledgerCompletionArtifactIssue
        ? ledgerCompletionArtifactIssue
        : ledgerCompletionAccepted
        ? ledgerCompletion?.reason || 'action-ledger completion policy satisfied'
        : done
        ? 'Computer Use package bridge verifier accepted final action.'
        : 'Computer Use package bridge verifier accepted action; more actions remain.'
      : stringAt(execution, 'message') || 'Computer Use package bridge executor failed.',
    changed: pixelDiff.possiblyNoEffect === false,
    metadata: {
      method: 'host-port-screenshot-ledger',
      pixelDiff,
      focusRegionPixelDiff: focusPixelDiff,
      regionSemantic,
      planningFeedback,
      visualFocus,
      ledgerCompletion: ledgerCompletion?.complete ? ledgerCompletion : undefined,
      ledgerCompletionQuotaIssue,
      ledgerCompletionArtifactIssue,
      beforeScreenshotRefs: beforeRefs.map(toTraceScreenshotRef),
      afterScreenshotRefs: afterRefs.map(toTraceScreenshotRef),
      queuedActionsRemaining: state.actionQueue.length,
    },
  };
  pushHistoryStep(verification);
  return verification;
}

function recordArg(call: HostPortCall, index: number): Record<string, unknown> {
  const value = call.args?.[index];
  return isRecord(value) ? value : {};
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

function numberAt(value: unknown) {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(numeric) ? numeric : undefined;
}
