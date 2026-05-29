import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { GatewayRequest } from '../runtime-types.js';
import { isRecord } from '../gateway-utils.js';
import { normalizeGenericActionRisk } from './actions.js';
import { toTraceScreenshotRef } from './capture.js';
import { executorBoundary } from './executor.js';
import { independentInputAdapterExecutionBoundary } from './independent-input-adapter.js';
import {
  COMPUTER_USE_ACTION_PROVIDER_ID,
  computerUseHostPortsContract,
  type ComputerUseActionProviderRequest,
} from './host-adapter.js';
import {
  finalArtifactRefsForTrace,
  finalVisibleArtifactForTrace,
  finalWindowScreenshotRef,
} from './package-bridge-final-artifacts.js';
import { materializePackageBridgeTraceRequest } from './package-bridge-request.js';
import type { ComputerUseConfig, FocusRegion, GenericVisionAction, LoopStep, ScreenshotRef, WindowTargetResolution } from './types.js';
import { workspaceRel } from './utils.js';
import type { VirtualRemoteVisibleArtifact } from './virtual-remote-session.js';
import {
  inputChannelContract,
  inputChannelDescription,
  schedulerRunMetadata,
  schedulerStepMetadata,
  stepInputChannelMetadata,
  toTraceWindowTarget,
  windowTargetTraceConfig,
} from './window-target.js';
import {
  visionSenseTraceContractPolicy,
  visionSenseTraceIds,
} from '../../../packages/observe/vision/computer-use-runtime-policy.js';
import { VISION_TOOL_ID } from '../vision-sense/computer-use-trace-output.js';
import {
  pixelDiffForScreenshotSets,
} from './capture.js';
import {
  localCoordinateMetadata,
  mappedCoordinateMetadata,
  windowConsistencyMetadata,
  windowLifecycleTrace,
} from '../vision-sense/computer-use-window-session.js';
import { tuiHostRunTaskChainPath } from './package-bridge-evidence.js';

export const PACKAGE_BRIDGE_TRACE_SCHEMA = 'sciforge.computer-use.package-bridge-trace.v1';

export type PackageBridgeTraceState = {
  runId: string;
  runDir: string;
  targetResolution: WindowTargetResolution;
  screenshotLedger: ScreenshotRef[];
  captureRefsByObservationRef: Map<string, ScreenshotRef[]>;
  focusRegionByObservationRef: Map<string, FocusRegion>;
  beforeFocusRefsByObservationRef: Map<string, ScreenshotRef[]>;
  afterFocusRefsByObservationRef: Map<string, ScreenshotRef[]>;
  actionQueue: GenericVisionAction[];
  executedActions: GenericVisionAction[];
  plannerTraceSteps: LoopStep[];
  visionHistorySteps: LoopStep[];
  missingPlannerAfterCaptured: boolean;
  tracePath?: string;
  virtualRemoteSessionRef?: string;
  visibleArtifacts: VirtualRemoteVisibleArtifact[];
};

export type PackageBridgeTraceInput = {
  workspace: string;
  config: ComputerUseConfig;
  state: PackageBridgeTraceState;
  request?: GatewayRequest;
  actionProviderRequest?: ComputerUseActionProviderRequest;
  packageResult: Record<string, unknown>;
  createdAt?: string;
  completedAt?: string;
};

export function materializePackageBridgeTrace(params: PackageBridgeTraceInput) {
  const now = new Date().toISOString();
  const finalVisibleArtifact = finalVisibleArtifactForTrace(params.state.visibleArtifacts);
  const finalArtifactRefs = finalArtifactRefsForTrace(params.state.visibleArtifacts);
  const finalArtifactRef = finalVisibleArtifact?.artifactRef;
  const finalVisibleScreenshotRef = finalWindowScreenshotRef(params.state.screenshotLedger);
  return {
    schemaVersion: visionSenseTraceIds.traceSchema,
    runId: params.state.runId,
    tool: VISION_TOOL_ID,
    runtime: visionSenseTraceIds.workspaceRuntime,
    packageBridge: {
      schemaVersion: PACKAGE_BRIDGE_TRACE_SCHEMA,
      runtime: 'sciforge.workspace-runtime.computer-use-package-bridge',
      actionProvider: COMPUTER_USE_ACTION_PROVIDER_ID,
      hostPortProtocol: 'stdio-jsonl',
      tuiHostRunTaskChainRef: workspaceRel(params.workspace, tuiHostRunTaskChainPath(params.state.runDir)),
    },
    actionProvider: COMPUTER_USE_ACTION_PROVIDER_ID,
    executionBoundary: params.config.dryRun ? 'dry-run-generic-gui-executor' : independentInputAdapterExecutionBoundary(params.config) ?? executorBoundary(params.config),
    createdAt: params.createdAt ?? now,
    completedAt: params.completedAt ?? now,
    request: params.request && params.actionProviderRequest
      ? materializePackageBridgeTraceRequest(params.request, params.actionProviderRequest)
      : undefined,
    artifactRefs: params.state.visibleArtifacts.map((artifact) => artifact.artifactRef),
    finalArtifactRef,
    finalArtifactRefs,
    finalVisibleScreenshotRef,
    cuUserAcceptance: finalArtifactRef || finalVisibleScreenshotRef ? {
      finalArtifactRef,
      finalArtifactRefs,
      finalVisibleScreenshotRef,
      visibleArtifactRefs: params.state.visibleArtifacts.map((artifact) => artifact.artifactRef),
    } : undefined,
    config: {
      captureDisplays: params.config.captureDisplays,
      desktopPlatform: params.config.desktopPlatform,
      windowTarget: params.state.targetResolution.ok
        ? toTraceWindowTarget(params.state.targetResolution)
        : {
            ...windowTargetTraceConfig(params.state.targetResolution.target),
            status: 'unresolved',
            diagnostics: params.state.targetResolution.diagnostics,
          },
      outputDir: workspaceRel(params.workspace, params.state.runDir),
      maxSteps: params.config.maxSteps,
      dryRun: params.config.dryRun,
      allowHighRiskActions: params.config.allowHighRiskActions,
      schedulerLockTimeoutMs: params.config.schedulerLockTimeoutMs,
      schedulerStaleLockMs: params.config.schedulerStaleLockMs,
      inputAdapter: params.config.inputAdapter,
      independentInputAdapterProvider: params.config.independentInputAdapterProvider,
      allowSharedSystemInput: params.config.allowSharedSystemInput,
      showVisualCursor: params.config.showVisualCursor,
      completionPolicy: params.config.completionPolicy,
      visibleTextExtraction: params.config.visibleTextExtraction,
      testActionFixtureMode: params.config.testActionFixtureMode,
      testOnlyPlannedActionCount: params.config.testActionFixtureMode ? params.config.testOnlyPlannedActions.length : 0,
    },
    hostPorts: computerUseHostPortsContract(params.config),
    imageMemory: {
      ...visionSenseTraceContractPolicy.imageMemory,
      refs: params.state.screenshotLedger.map(toTraceScreenshotRef),
    },
    virtualRemoteSession: params.state.virtualRemoteSessionRef ? {
      schemaVersion: 'sciforge.computer-use.virtual-remote-session-trace.v1',
      sessionRef: params.state.virtualRemoteSessionRef,
      visibleArtifactRefs: params.state.visibleArtifacts.map((artifact) => artifact.artifactRef),
      visibleArtifacts: params.state.visibleArtifacts,
    } : undefined,
    genericComputerUse: {
      actionSchema: visionSenseTraceContractPolicy.genericActionSchema,
      actionProvider: COMPUTER_USE_ACTION_PROVIDER_ID,
      hostPorts: computerUseHostPortsContract(params.config),
      appSpecificShortcuts: visionSenseTraceContractPolicy.appSpecificShortcuts,
      inputChannel: inputChannelDescription(params.config, params.state.targetResolution),
      inputChannelContract: inputChannelContract(params.config, params.state.targetResolution),
      coordinateContract: visionSenseTraceContractPolicy.coordinateContract(
        params.state.targetResolution.ok ? params.state.targetResolution.coordinateSpace : params.config.windowTarget.coordinateSpace,
      ),
      verifierContract: visionSenseTraceContractPolicy.verifierContract,
      inputIsolation: params.state.targetResolution.ok ? params.state.targetResolution.inputIsolation : params.config.windowTarget.inputIsolation,
      requires: visionSenseTraceContractPolicy.requires,
    },
    windowLifecycle: windowLifecycleTrace(
      params.state.targetResolution.ok
        ? toTraceWindowTarget(params.state.targetResolution)
        : {
            ...windowTargetTraceConfig(params.config.windowTarget),
            captureKind: 'display',
            source: 'display-fallback',
          },
      params.state.screenshotLedger,
    ),
    scheduler: {
      ...schedulerRunMetadata(params.state.targetResolution, params.config),
      executorLock: {
        provider: 'filesystem-lease',
        pathRoot: '/tmp/sciforge-computer-use-locks',
        timeoutMs: params.config.schedulerLockTimeoutMs ?? 60000,
        staleLockMs: params.config.schedulerStaleLockMs ?? 120000,
        appliesTo: params.config.dryRun
          ? 'none-dry-run'
          : independentInputAdapterExecutionBoundary(params.config) ?? 'real-gui-executor',
      },
    },
    validation: {
      ok: params.state.screenshotLedger.every((ref) => Boolean(ref.bytes && ref.sha256 && ref.width && ref.height)),
      checkedRefs: params.state.screenshotLedger.map((ref) => ref.path),
      missingRefs: params.state.screenshotLedger
        .filter((ref) => !ref.bytes || !ref.sha256 || !ref.width || !ref.height)
        .map((ref) => ref.path),
      invalidRefs: [],
      diagnostics: [],
      noInlineImages: !/data:image\/|;base64,/.test(JSON.stringify(params.packageResult)),
    },
    steps: packageResultStepsToVisionSteps(params.packageResult, params.state, params.config),
    packageResult: params.packageResult,
  };
}

export async function writePackageBridgeTrace(params: PackageBridgeTraceInput) {
  const tracePath = join(params.state.runDir, 'vision-trace.json');
  params.state.tracePath = tracePath;
  const trace = materializePackageBridgeTrace(params);
  await writeFile(tracePath, `${JSON.stringify(trace, null, 2)}\n`, 'utf8');
  return tracePath;
}

export function packageResultStepsToVisionSteps(
  packageResult: Record<string, unknown>,
  state: PackageBridgeTraceState,
  config: ComputerUseConfig,
): LoopStep[] {
  if (!state.targetResolution.ok) {
    return [{
      id: 'step-000-blocked-window-target',
      kind: 'planning',
      status: 'blocked',
      verifier: {
        status: 'blocked',
        reason: 'target window contract could not be resolved',
        diagnostics: state.targetResolution.diagnostics,
        windowTarget: windowTargetTraceConfig(state.targetResolution.target),
        windowConsistency: windowConsistencyMetadata([], [], config),
      },
      failureReason: state.targetResolution.reason,
    }];
  }
  const packageSteps = Array.isArray(packageResult.steps) ? packageResult.steps.filter(isRecord) : [];
  const steps = packageSteps.filter((step) => {
    const action = recordAt(step, 'action');
    return Boolean(stringAt(action, 'kind') ?? stringAt(action, 'type'));
  });
  if (!steps.length && state.visionHistorySteps.some((step) => step.kind === 'gui-execution')) {
    return state.visionHistorySteps;
  }
  if (!steps.length && state.missingPlannerAfterCaptured) {
    const beforeRefs = refsByName(state, 'step-000-before');
    const afterRefs = refsByName(state, 'step-000-after');
    return [{
      id: 'step-000-plan',
      kind: 'planning',
      status: 'blocked',
      beforeScreenshotRefs: beforeRefs.map(toTraceScreenshotRef),
      afterScreenshotRefs: afterRefs.map(toTraceScreenshotRef),
      verifier: {
        status: 'blocked',
        reason: stringAt(packageResult, 'reason') || 'missing Runtime Codex planner/Grounder action plan',
        pixelDiff: pixelDiffForScreenshotSets(beforeRefs, afterRefs),
        windowConsistency: windowConsistencyMetadata(beforeRefs, afterRefs, config),
      },
      execution: {
        planner: 'computer-use-package-host-port-planner',
        status: 'blocked',
        rawResponse: {
          done: false,
          actions: [],
          reason: stringAt(packageResult, 'reason') || 'Computer Use package planner emitted no action.',
        },
      },
      failureReason: stringAt(packageResult, 'reason') || 'Computer Use package planner emitted no action.',
    }];
  }
  const actionSteps = steps.map((step, index): LoopStep => {
    const actionRecord = recordAt(step, 'action') ?? {};
    const beforeObservationRef = stringAt(step, 'beforeRef') ?? '';
    const beforeRefs = state.captureRefsByObservationRef.get(beforeObservationRef) ?? refsForStepIndex(state, index, 'before');
    const afterRefs = state.captureRefsByObservationRef.get(stringAt(step, 'afterRef') ?? '') ?? refsForStepIndex(state, index, 'after');
    const focusRegion = state.focusRegionByObservationRef.get(beforeObservationRef);
    const beforeFocusRefs = state.beforeFocusRefsByObservationRef.get(beforeObservationRef) ?? [];
    const afterFocusRefs = state.afterFocusRefsByObservationRef.get(beforeObservationRef) ?? [];
    const grounding = normalizeTraceGrounding(recordAt(step, 'grounding') ?? {});
    const status = step.status === 'done' ? 'done' : step.status === 'blocked' ? 'blocked' : 'failed';
    const action = preservePackageBlockedRisk(
      packageTraceActionToGenericAction(actionRecord, grounding),
      step,
      status,
    );
    const execution = recordAt(step, 'execution');
    const executionMetadata = recordAt(execution, 'metadata');
    const executorLease = isRecord(executionMetadata?.schedulerLease) ? executionMetadata.schedulerLease : undefined;
    const verification = recordAt(step, 'verification');
    const pixelDiff = pixelDiffForScreenshotSets(beforeRefs, afterRefs);
    const focusPixelDiff = beforeFocusRefs.length && afterFocusRefs.length
      ? pixelDiffForScreenshotSets(beforeFocusRefs, afterFocusRefs)
      : undefined;
    const windowConsistency = windowConsistencyMetadata(beforeRefs, afterRefs, config);
    const planningFeedback = packageVerifierPlanningFeedback(action, grounding, pixelDiff, windowConsistency, status);
    const regionSemantic = packageRegionSemanticVerifier(action, grounding, pixelDiff, status);
    const maxStepsExhausted = stringAt(packageResult, 'status') === 'max-steps' && index === steps.length - 1;
    const visualFocus = focusRegion ? {
      ...visionSenseTraceContractPolicy.visualFocus,
      region: focusRegion,
      beforeFocusScreenshotRefs: beforeFocusRefs.map(toTraceScreenshotRef),
      afterFocusScreenshotRefs: afterFocusRefs.map(toTraceScreenshotRef),
      pixelDiff: focusPixelDiff,
      fineGrounding: isRecord(grounding.fineGrounding) ? grounding.fineGrounding : undefined,
    } : undefined;
    return {
      id: `step-${String(index + 1).padStart(3, '0')}-${status === 'blocked' ? 'blocked' : 'execute'}-${action.type}`,
      kind: 'gui-execution',
      status,
      beforeScreenshotRefs: beforeRefs.map(toTraceScreenshotRef),
      afterScreenshotRefs: afterRefs.map(toTraceScreenshotRef),
      plannedAction: action,
      grounding,
      windowTarget: state.targetResolution.ok ? toTraceWindowTarget(state.targetResolution) : undefined,
      localCoordinate: localCoordinateMetadata(grounding, action, beforeRefs[0]),
      mappedCoordinate: mappedCoordinateMetadata(grounding, action),
      inputChannel: stepInputChannelMetadata(config, state.targetResolution),
      visualFocus,
      execution: execution ? {
        executor: config.dryRun ? 'dry-run-generic-gui-executor' : independentInputAdapterExecutionBoundary(config) ?? executorBoundary(config),
        inputChannel: inputChannelDescription(config, state.targetResolution),
        windowTarget: state.targetResolution.ok ? toTraceWindowTarget(state.targetResolution) : undefined,
        status: execution.ok === false ? 'failed' : 'done',
        exitCode: numberAt(executionMetadata?.exitCode) ?? (execution.ok === false ? 1 : 0),
        stdout: stringAt(executionMetadata, 'stdout'),
        stderr: stringAt(executionMetadata, 'stderr'),
        schedulerLease: executorLease,
        independentInputAdapter: executionMetadata?.independentInputAdapter,
        virtualRemoteSessionRef: stringAt(executionMetadata, 'virtualRemoteSessionRef'),
        visibleArtifactRefs: stringList(executionMetadata?.visibleArtifactRefs),
      } : undefined,
      scheduler: {
        ...schedulerStepMetadata(state.targetResolution, `step-${String(index + 1).padStart(3, '0')}`, config),
        executorLease,
      },
      verifier: {
        status: verification?.ok === false ? 'blocked' : 'checked',
        method: 'computer-use-package-host-port-verifier',
        reason: maxStepsExhausted ? 'maxSteps exhausted before planner reported done=true' : stringAt(verification, 'reason'),
        pixelDiff,
        focusRegionPixelDiff: focusPixelDiff,
        windowConsistency,
        regionSemantic,
        planningFeedback,
        packageVerification: verification,
      },
      failureReason: stringAt(step, 'failureReason') ?? stringAt(step, 'failure_reason') ?? undefined,
    };
  });
  return mergePlannerAndActionTraceSteps(state.plannerTraceSteps, actionSteps);
}

function preservePackageBlockedRisk(
  action: GenericVisionAction,
  step: Record<string, unknown>,
  status: 'done' | 'blocked' | 'failed',
): GenericVisionAction {
  if (status !== 'blocked') return action;
  const reason = stringAt(step, 'failureReason') ?? stringAt(step, 'failure_reason') ?? '';
  if (!/confirm|approval|high-risk|高风险|确认|授权/i.test(reason)) return action;
  return {
    ...action,
    riskLevel: 'high',
    requiresConfirmation: true,
  };
}

function mergePlannerAndActionTraceSteps(plannerSteps: LoopStep[], actionSteps: LoopStep[]) {
  if (!plannerSteps.length) return actionSteps;
  const remaining = new Map(plannerSteps.map((step) => [step.id, step]));
  const merged: LoopStep[] = [];
  const pushPlanner = (id: string) => {
    const step = remaining.get(id);
    if (!step) return;
    merged.push(step);
    remaining.delete(id);
  };
  pushPlanner('step-000-plan');
  for (const actionStep of actionSteps) {
    merged.push(actionStep);
    const match = /^step-(\d{3})-/.exec(actionStep.id);
    if (match) pushPlanner(`step-${match[1]}-replan`);
  }
  merged.push(...remaining.values());
  return merged;
}

function refsByName(state: PackageBridgeTraceState, fragment: string) {
  return state.screenshotLedger.filter((ref) => ref.id.includes(fragment) || ref.path.includes(fragment));
}

function refsForStepIndex(state: PackageBridgeTraceState, index: number, phase: 'before' | 'after') {
  const stepNumber = String(index + 1).padStart(3, '0');
  return refsByName(state, `step-${stepNumber}-${phase}`);
}

function normalizeTraceGrounding(grounding: Record<string, unknown>) {
  const metadata = recordAt(grounding, 'metadata') ?? {};
  return {
    ...metadata,
    ...grounding,
  };
}

function packageTraceActionToGenericAction(action: Record<string, unknown>, grounding: Record<string, unknown> = {}): GenericVisionAction {
  const type = (stringAt(action, 'kind') ?? 'wait') as GenericVisionAction['type'];
  const targetDescription = stringAt(action, 'target');
  const targetRegionDescription = stringAt(action, 'targetRegion');
  const riskLevel = parseRiskLevel(stringAt(action, 'riskLevel'));
  const base = {
    targetDescription,
    targetRegionDescription,
    riskLevel,
    requiresConfirmation: action.requiresConfirmation === true,
  };
  const x = numberAt(action.x) ?? numberAt(grounding.x) ?? numberAt(grounding.executorX) ?? numberAt(grounding.localX);
  const y = numberAt(action.y) ?? numberAt(grounding.y) ?? numberAt(grounding.executorY) ?? numberAt(grounding.localY);
  if (type === 'click') return normalizeGenericActionRisk({ ...base, type: 'click', x, y });
  if (type === 'double_click') return normalizeGenericActionRisk({ ...base, type: 'double_click', x, y });
  if (type === 'drag') {
    return normalizeGenericActionRisk({
      ...base,
      type: 'drag',
      fromX: numberAt(action.fromX)
        ?? numberAt(grounding.executorFromX)
        ?? numberAt(grounding.localFromX),
      fromY: numberAt(action.fromY)
        ?? numberAt(grounding.executorFromY)
        ?? numberAt(grounding.localFromY),
      toX: numberAt(action.toX)
        ?? numberAt(grounding.executorToX)
        ?? numberAt(grounding.localToX),
      toY: numberAt(action.toY)
        ?? numberAt(grounding.executorToY)
        ?? numberAt(grounding.localToY),
      fromTargetDescription: stringAt(action, 'fromTargetDescription') ?? stringAt(grounding, 'fromTargetDescription'),
      toTargetDescription: stringAt(action, 'toTargetDescription') ?? stringAt(grounding, 'toTargetDescription'),
    });
  }
  if (type === 'type_text') return normalizeGenericActionRisk({ ...base, type: 'type_text', text: stringAt(action, 'text') ?? '' });
  if (type === 'press_key') return normalizeGenericActionRisk({ ...base, type: 'press_key', key: stringAt(action, 'key') ?? '' });
  if (type === 'hotkey') return normalizeGenericActionRisk({ ...base, type: 'hotkey', keys: stringList(action.keys) });
  if (type === 'scroll') return normalizeGenericActionRisk({ ...base, type: 'scroll', direction: scrollDirection(stringAt(action, 'direction')), amount: numberAt(action.amount) });
  if (type === 'open_app') return normalizeGenericActionRisk({ ...base, type: 'open_app', appName: stringAt(action, 'appName') ?? '' });
  return normalizeGenericActionRisk({ ...base, type: 'wait' });
}

export function packageVerifierPlanningFeedback(
  action: GenericVisionAction,
  grounding: Record<string, unknown>,
  pixelDiff: Record<string, unknown>,
  windowConsistency: Record<string, unknown>,
  status: 'done' | 'blocked' | 'failed',
) {
  const noVisibleEffect = pixelDiff.possiblyNoEffect === true;
  const ratios = Array.isArray(pixelDiff.pairs)
    ? pixelDiff.pairs
      .filter(isRecord)
      .map((pair) => numberAt(pair.changedByteRatio)?.toFixed(4) ?? 'unknown')
      .join(',')
    : 'unknown';
  const target = action.targetDescription ? ` target="${action.targetDescription}"` : '';
  const local = numberAt(grounding.localX) !== undefined && numberAt(grounding.localY) !== undefined
    ? ` local=${numberAt(grounding.localX)},${numberAt(grounding.localY)}`
    : '';
  const executor = numberAt(grounding.executorX) !== undefined && numberAt(grounding.executorY) !== undefined
    ? ` executor=${numberAt(grounding.executorX)},${numberAt(grounding.executorY)}`
    : '';
  const next = status === 'done' && noVisibleEffect
    ? `${action.type} produced no visible window effect; avoid repeating same target unless screenshot changed`
    : status === 'done'
      ? 'continue only if the visible task is not complete'
      : 'repair the blocked or failed action before retrying';
  return [
    `pixel=${noVisibleEffect ? 'no-visible-effect' : 'changed'} ratios=${ratios}`,
    `window=${stringAt(windowConsistency, 'status') ?? 'unknown'} sameWindow=${windowConsistency.sameWindow === true} scopeOk=${windowConsistency.scopeOk === true}`,
    `grounding=${stringAt(grounding, 'status') ?? 'ok'}${target}${local}${executor}`,
    `next=${next}`,
  ].join(' | ');
}

export function packageRegionSemanticVerifier(
  action: GenericVisionAction,
  grounding: Record<string, unknown>,
  pixelDiff: Record<string, unknown>,
  status: 'done' | 'blocked' | 'failed',
) {
  const noVisibleEffect = pixelDiff.possiblyNoEffect === true;
  const verdict = status !== 'done'
    ? 'action-not-applied'
    : noVisibleEffect
      ? 'focused-target-no-visible-effect'
      : 'focused-target-reacted';
  const nextPlannerHint = status !== 'done'
    ? 'repair the blocked or failed action before retrying'
    : noVisibleEffect
      ? 'switch modality, choose a different visible control, or request a wider focus region'
      : 'continue only if the visible task is not complete';
  return {
    schemaVersion: 'sciforge.vision-sense.region-semantic-verifier.v1',
    verdict,
    confidence: noVisibleEffect ? 0.78 : 0.72,
    targetDescription: action.targetDescription,
    actionType: action.type,
    focusChanged: !noVisibleEffect,
    windowChanged: !noVisibleEffect,
    possiblyNoEffect: noVisibleEffect,
    grounding: {
      localX: numberAt(grounding.localX),
      localY: numberAt(grounding.localY),
      executorX: numberAt(grounding.executorX),
      executorY: numberAt(grounding.executorY),
    },
    nextPlannerHint,
    summary: [
      `regionSemantic=${verdict}`,
      `action=${action.type}`,
      action.targetDescription ? `target="${action.targetDescription}"` : undefined,
      `next=${nextPlannerHint}`,
    ].filter(Boolean).join(' | '),
  };
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

function stringList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function scrollDirection(value: string | undefined): 'up' | 'down' | 'left' | 'right' {
  return value === 'up' || value === 'left' || value === 'right' ? value : 'down';
}

function parseRiskLevel(value: string | undefined): 'low' | 'medium' | 'high' | undefined {
  return value === 'low' || value === 'medium' || value === 'high' ? value : undefined;
}
