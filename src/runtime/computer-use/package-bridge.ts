import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type { GatewayRequest, ToolPayload, WorkspaceRuntimeCallbacks } from '../runtime-types.js';
import { isRecord } from '../gateway-utils.js';
import type { AgentCliAdapter } from '../codex/agent-cli-adapter.js';
import { emitWorkspaceRuntimeEvent } from '../workspace-runtime-events.js';
import { normalizePlatformAction } from './actions.js';
import {
  createFocusedCropRefs,
} from './capture.js';
import {
  type VirtualRemoteVisibleArtifact,
} from './virtual-remote-session.js';
import type { ComputerUseConfig, FocusRegion, GenericVisionAction, LoopStep, ScreenshotRef, WindowTargetResolution } from './types.js';
import { sanitizeId, workspaceRel } from './utils.js';
import {
  resolveWindowTarget,
  toTraceWindowTarget,
} from './window-target.js';
import {
  attachPackageBridgeCompletionGradeWorkEvidence,
  materializePackageBridgeCompletionGradeEvidence,
  writePackageBridgeEvidenceFiles,
} from './package-bridge-evidence.js';
import {
  promotePackageResultFinalArtifactRefs,
} from './package-bridge-final-artifacts.js';
import {
  maybeProducePackageBridgeL3CompletionEvidence,
  type PackageBridgeL3CompletionProducer,
} from './package-bridge-l3.js';
import {
  materializePackageBridgeRunTaskInvocation,
  materializePackageBridgeRuntimeSelectionDetail,
} from './package-bridge-request.js';
import { materializePackageBridgeResult } from './package-bridge-result.js';
import {
  type HostPortCall,
} from './package-bridge-stdio.js';
import { dispatchPackageBridgeHostPortCall } from './package-bridge-host-ports.js';
import { runComputerUsePackageProcess } from './package-bridge-process.js';
import { attachPackageResultHostActions } from './package-bridge-presentation.js';
import { packagePlanToGenericAction } from './package-bridge-action-conversion.js';
import { capturePackageBridgePort } from './package-bridge-capture-port.js';
import {
  executePackageBridgePort,
} from './package-bridge-execute-port.js';
import { planPackageBridgePort } from './package-bridge-plan-port.js';
import { emitPackageBridgeEventPort } from './package-bridge-trace-port.js';
import { writePackageBridgeTracePort } from './package-bridge-write-trace-port.js';
import {
  visionSenseRuntimeEventTypes,
} from '../../../packages/observe/vision/computer-use-runtime-policy.js';
import {
  genericLoopPayload,
  VISION_TOOL_ID,
  writeGenericLoopPayloadValidationRepairAuditSink,
} from '../vision-sense/computer-use-trace-output.js';
import {
  writePackageBridgeTrace,
} from './package-bridge-trace.js';
import { buildFocusRegionFromVisionSense, refineActionGroundingWithFocusRegion, resolveActionGrounding } from '../vision-sense/computer-use-grounding.js';
import { verifyPackageBridgePort } from './package-bridge-verify-port.js';

type PackageBridgeState = {
  runId: string;
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
  latestObservation?: Record<string, unknown>;
  plannerTraceSteps: LoopStep[];
  visionHistorySteps: LoopStep[];
  captureIndex: number;
  missingPlannerAfterCaptured: boolean;
  tracePath?: string;
  virtualRemoteSessionRef?: string;
  visibleArtifacts: VirtualRemoteVisibleArtifact[];
};

export type ComputerUsePackageBridgeOptions = {
  codexPlannerAdapter?: AgentCliAdapter;
  l3CompletionProducer?: PackageBridgeL3CompletionProducer;
};

let codexPlannerAdapterForTests: AgentCliAdapter | undefined;

export function setComputerUsePackageBridgeCodexPlannerAdapterForTests(adapter: AgentCliAdapter | undefined) {
  codexPlannerAdapterForTests = adapter;
}

export async function runComputerUsePackageBridge(
  request: GatewayRequest,
  workspace: string,
  config: ComputerUseConfig,
  callbacks: WorkspaceRuntimeCallbacks = {},
  options: ComputerUsePackageBridgeOptions = {},
): Promise<ToolPayload> {
  const runId = sanitizeId(config.runId || `computer-use-package-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 17)}`);
  const runDir = resolve(config.outputDir || join(workspace, '.sciforge', 'vision-runs', runId));
  await mkdir(runDir, { recursive: true });
  const fixtureActions = config.testActionFixtureMode
    ? config.testOnlyPlannedActions.map((action) => normalizePlatformAction(action, config))
    : [];
  const state: PackageBridgeState = {
    runId,
    runDir,
    targetResolution: await resolveWindowTarget(config),
    screenshotLedger: [],
    captureRefsByObservationRef: new Map(),
    focusRegionByObservationRef: new Map(),
    beforeFocusRefsByObservationRef: new Map(),
    afterFocusRefsByObservationRef: new Map(),
    actionQueue: fixtureActions,
    executedActions: [],
    dynamicPlannerEnabled: !config.testActionFixtureMode,
    plannerReportedDone: false,
    latestObservation: undefined,
    plannerTraceSteps: [],
    visionHistorySteps: [],
    captureIndex: 0,
    missingPlannerAfterCaptured: false,
    visibleArtifacts: [],
  };
  const packageInvocation = materializePackageBridgeRunTaskInvocation(request, config, workspace);

  emitWorkspaceRuntimeEvent(callbacks, {
    type: visionSenseRuntimeEventTypes.runtimeSelected,
    source: 'workspace-runtime',
    toolName: VISION_TOOL_ID,
    status: 'running',
    message: 'Calling Computer Use package run_task through TUI Host stdio host ports.',
    detail: JSON.stringify(materializePackageBridgeRuntimeSelectionDetail(packageInvocation, {
      runId,
      testActionFixtureMode: config.testActionFixtureMode,
      testOnlyPlannedActions: fixtureActions.length,
      planner: state.dynamicPlannerEnabled ? 'runtime-codex-tui-text-planner' : 'test-only-fixture-actions',
    })),
  });

  if (!state.targetResolution.ok) {
    const packageResult = {
      schemaVersion: 'sciforge.computer-use.result.v1',
      status: 'failed-with-reason',
      reason: state.targetResolution.reason,
      failureDiagnostics: {
        failedStage: 'window-target',
        diagnostics: state.targetResolution.diagnostics,
      },
      traceRefs: [],
      metrics: { actionCount: 0, stepCount: 1, observationCount: 0 },
      steps: [],
    };
    const tracePath = await writePackageBridgeTrace({
      workspace,
      config,
      state,
      request,
      actionProviderRequest: packageInvocation.request,
      packageResult,
    });
    const payload = genericLoopPayload({
      request,
      workspace,
      runId,
      tracePath,
      screenshotRefs: state.screenshotLedger,
      status: 'failed-with-reason',
      failureReason: state.targetResolution.reason,
      actionCount: 0,
      maxSteps: config.maxSteps,
      dryRun: config.dryRun,
      desktopPlatform: config.desktopPlatform,
      createdAt: new Date().toISOString(),
    });
    const tuiHostActions = attachPackageResultHostActions(payload, packageResult, callbacks, { workspace, state, toolName: VISION_TOOL_ID });
    await writePackageBridgeEvidenceFiles({
      actionProviderRequest: packageInvocation.request,
      config,
      packageResult,
      payload,
      state,
      workspace,
      tuiHostActions,
    });
    await writeGenericLoopPayloadValidationRepairAuditSink(payload, { workspacePath: workspace });
    return payload;
  }

  const rawPackageResult = await runPythonPackageTask(packageInvocation.request, {
    workspace,
    config,
    callbacks,
    state,
    codexPlannerAdapter: options.codexPlannerAdapter ?? codexPlannerAdapterForTests,
  });
  promotePackageResultFinalArtifactRefs(rawPackageResult, workspace, state);
  const materializedResult = materializePackageBridgeResult({
    packageResult: rawPackageResult,
    task: request.prompt,
    executedActions: state.executedActions,
    visibleArtifacts: state.visibleArtifacts,
    screenshotLedger: state.screenshotLedger,
  });
  const { packageResult } = materializedResult;
  const tracePath = await writePackageBridgeTrace({
    workspace,
    config,
    state,
    request,
    actionProviderRequest: packageInvocation.request,
    packageResult,
  });
  const payload = genericLoopPayload({
    request,
    workspace,
    runId,
    tracePath,
    screenshotRefs: state.screenshotLedger,
    status: materializedResult.payloadStatus,
    failureReason: materializedResult.failureReason,
    actionCount: numberAt(recordAt(packageResult, 'metrics')?.actionCount) ?? state.executedActions.length,
    maxSteps: config.maxSteps,
    dryRun: config.dryRun,
    desktopPlatform: config.desktopPlatform,
    windowTarget: state.targetResolution.ok ? toTraceWindowTarget(state.targetResolution) : undefined,
    visibleArtifacts: state.visibleArtifacts,
    finalArtifactRef: materializedResult.finalArtifactRef,
    finalArtifactRefs: materializedResult.finalArtifactRefs,
    finalVisibleScreenshotRef: materializedResult.finalVisibleScreenshotRef,
    createdAt: new Date().toISOString(),
  });
  const l3CompletionProduction = await maybeProducePackageBridgeL3CompletionEvidence({
    config,
    defaultProducerOptIn: packageInvocation.completionProducerOptIn,
    finalArtifactRef: materializedResult.finalArtifactRef,
    packageResult,
    producer: options.l3CompletionProducer,
    state,
    workspace,
  });
  const completionGrade = await materializePackageBridgeCompletionGradeEvidence({
    actionProviderRequest: packageInvocation.request,
    config,
    packageResult,
    payload,
    producerDiagnosticRef: l3CompletionProduction.producerDiagnosticRef,
    state,
    workspace,
  });
  attachPackageBridgeCompletionGradeWorkEvidence(payload, completionGrade);
  const tuiHostActions = attachPackageResultHostActions(payload, packageResult, callbacks, { workspace, state, toolName: VISION_TOOL_ID });
  await writePackageBridgeEvidenceFiles({
    actionProviderRequest: packageInvocation.request,
    config,
    completionGrade,
    packageResult,
    payload,
    state,
    workspace,
    tuiHostActions,
  });
  if (!materializedResult.succeeded) {
    await writeGenericLoopPayloadValidationRepairAuditSink(payload, { workspacePath: workspace });
  }
  return payload;
}

async function runPythonPackageTask(
  actionProviderRequest: Record<string, unknown>,
  context: {
    workspace: string;
    config: ComputerUseConfig;
    callbacks: WorkspaceRuntimeCallbacks;
    state: PackageBridgeState;
    codexPlannerAdapter?: AgentCliAdapter;
  },
): Promise<Record<string, unknown>> {
  // The stdio process runner is the bridge to packages/actions/computer-use (sciforge_computer_use).
  return runComputerUsePackageProcess({
    actionProviderRequest,
    callbacks: context.callbacks,
    handleHostPortCall: (call) => handleHostPortCall(call, context),
  });
}

async function handleHostPortCall(
  call: HostPortCall,
  context: {
    workspace: string;
    config: ComputerUseConfig;
    callbacks: WorkspaceRuntimeCallbacks;
    state: PackageBridgeState;
    codexPlannerAdapter?: AgentCliAdapter;
  },
): Promise<unknown> {
  return dispatchPackageBridgeHostPortCall(call, {
    callbacks: context.callbacks,
    handlers: {
      capture: (hostPortCall) => capturePackageBridgePort(hostPortCall, context),
      plan: (hostPortCall) => planPackageBridgePort(hostPortCall, context),
      locate: (hostPortCall) => locatePort(hostPortCall, context),
      execute: (hostPortCall) => executePackageBridgePort(hostPortCall, {
        ...context,
        packagePlanToGenericAction,
      }),
      verify: (hostPortCall) => verifyPackageBridgePort(hostPortCall, {
        ...context,
        packagePlanToGenericAction,
      }),
      writeTrace: (hostPortCall) => writePackageBridgeTracePort(hostPortCall, context),
      emitEvent: (hostPortCall) => emitEventPort(hostPortCall, context),
    },
  });
}

async function locatePort(
  call: HostPortCall,
  context: { workspace: string; config: ComputerUseConfig; state: PackageBridgeState },
) {
  const { workspace, config, state } = context;
  const observation = recordArg(call, 0);
  state.latestObservation = observation;
  const target = recordArg(call, 1);
  const observationRef = stringAt(observation, 'ref') ?? '';
  const beforeRefs = state.captureRefsByObservationRef.get(observationRef) ?? state.screenshotLedger.slice(-1);
  const action = packagePlanToGenericAction({ kind: state.activeAction?.type, target }, state.activeAction);
  const grounded = await resolveActionGrounding(action, beforeRefs, config);
  if (!grounded.ok) {
    return {
      ok: false,
      reason: grounded.reason,
      metadata: grounded.grounding,
    };
  }
  let resolvedAction = grounded.action;
  let grounding = grounded.grounding ?? {};
  const focusRegion = await buildFocusRegionFromVisionSense(beforeRefs[0], grounding);
  if (focusRegion) {
    const historyLength = Array.isArray(call.args?.[2]) ? call.args[2].length : state.executedActions.length;
    const prefix = `step-${String(historyLength + 1).padStart(3, '0')}-before`;
    const beforeFocusRefs = await createFocusedCropRefs(workspace, state.runDir, prefix, beforeRefs, focusRegion, config);
    state.screenshotLedger.push(...beforeFocusRefs);
    state.focusRegionByObservationRef.set(observationRef, focusRegion);
    state.beforeFocusRefsByObservationRef.set(observationRef, beforeFocusRefs);
    if (shouldRunFineGroundingPass(grounding)) {
      const refined = await refineActionGroundingWithFocusRegion({
        action: resolvedAction,
        grounding,
        focusRegion,
        beforeRef: beforeRefs[0],
        focusRefs: beforeFocusRefs,
        config,
      });
      if (!refined.ok) {
        return {
          ok: false,
          reason: refined.reason,
          metadata: refined.grounding,
        };
      }
      resolvedAction = refined.action;
      grounding = refined.grounding ?? grounding;
    }
  }
  const historyLength = Array.isArray(call.args?.[2]) ? call.args[2].length : state.executedActions.length;
  const groundingRef = await writePackageBridgeGroundingRef({
    workspace,
    state,
    stepIndex: historyLength + 1,
    observationRef,
    beforeRefs,
    action: resolvedAction,
    grounding,
  });
  state.activeAction = {
    ...resolvedAction,
    grounding: { ...grounding, groundingRef, sourceObservationRef: observationRef },
    beforeEvidenceRefs: uniqueStrings([
      observationRef,
      ...beforeRefs.map((ref) => ref.path),
    ]),
    groundingRefs: [groundingRef],
  };
  return {
    ok: true,
    x: numberAt(grounding.executorX) ?? numberAt(grounding.x) ?? numberAt(grounding.localX),
    y: numberAt(grounding.executorY) ?? numberAt(grounding.y) ?? numberAt(grounding.localY),
    coordinateSpace: stringAt(grounding, 'coordinateSpace') ?? 'observation',
    confidence: numberAt(grounding.confidence),
    reason: stringAt(grounding, 'reason') ?? '',
    metadata: { ...grounding, groundingRef, sourceObservationRef: observationRef },
  };
}

async function writePackageBridgeGroundingRef(params: {
  workspace: string;
  state: PackageBridgeState;
  stepIndex: number;
  observationRef: string;
  beforeRefs: ScreenshotRef[];
  action: GenericVisionAction;
  grounding: Record<string, unknown>;
}) {
  const path = join(params.state.runDir, `step-${String(params.stepIndex).padStart(3, '0')}-grounding.json`);
  const ref = workspaceRel(params.workspace, path);
  await writeFile(path, `${JSON.stringify({
    schemaVersion: 'sciforge.computer-use.grounding-diagnostic.v1',
    ref,
    sourceObservationRef: params.observationRef,
    beforeEvidenceRefs: [
      params.observationRef,
      ...params.beforeRefs.map((beforeRef) => beforeRef.path),
    ],
    actionType: params.action.type,
    targetDescription: params.action.targetDescription,
    targetRegionDescription: params.action.targetRegionDescription,
    grounding: params.grounding,
    windowTarget: params.state.targetResolution.ok ? toTraceWindowTarget(params.state.targetResolution) : undefined,
    writtenAt: new Date().toISOString(),
  }, null, 2)}\n`, 'utf8');
  return ref;
}

function emitEventPort(
  call: HostPortCall,
  context: { callbacks: WorkspaceRuntimeCallbacks },
) {
  return emitPackageBridgeEventPort(call, context);
}

function shouldRunFineGroundingPass(grounding: Record<string, unknown>) {
  return stringAt(grounding, 'provider') === 'kv-ground';
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

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}
