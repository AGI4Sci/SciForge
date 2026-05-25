import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { delimiter, join, resolve } from 'node:path';

import type { GatewayRequest, ToolPayload, WorkspaceRuntimeCallbacks } from '../runtime-types.js';
import { isRecord } from '../gateway-utils.js';
import type { AgentCliAdapter } from '../codex/agent-cli-adapter.js';
import { emitWorkspaceRuntimeEvent } from '../workspace-runtime-events.js';
import { groundingForAction, normalizePlatformAction } from './actions.js';
import {
  captureDisplays,
  createFocusedCropRefs,
  extractVisibleTextsFromScreenshotRefs,
  pixelDiffForScreenshotSets,
  toTraceScreenshotRef,
} from './capture.js';
import { executeGenericDesktopAction, executorBoundary } from './executor.js';
import {
  executeIndependentInputAdapterAction,
  hasExecutableIndependentInputAdapter,
  independentInputAdapterExecutionBoundary,
} from './independent-input-adapter.js';
import {
  collectVirtualRemoteSessionArtifacts,
  collectVirtualRemoteSessionVisibleTexts,
  readVirtualRemoteSessionState,
  type VirtualRemoteVisibleArtifact,
} from './virtual-remote-session.js';
import type { ComputerUseConfig, FocusRegion, GenericVisionAction, LoopStep, ScreenshotRef, WindowTargetResolution } from './types.js';
import { sanitizeId, workspaceRel } from './utils.js';
import {
  inputChannelContract,
  inputChannelDescription,
  resolveWindowTarget,
  schedulerRunMetadata,
  schedulerStepMetadata,
  stepInputChannelMetadata,
  toTraceWindowTarget,
  windowTargetTraceConfig,
} from './window-target.js';
import {
  computerUseHostPortsContract,
  computerUseResultToTuiHostActions,
  gatewayRequestToComputerUseRequest,
} from './host-adapter.js';
import {
  visionSenseRuntimeEventTypes,
  visionSenseTraceContractPolicy,
  visionSenseTraceIds,
} from '../../../packages/observe/vision/computer-use-runtime-policy.js';
import {
  computerUseActionObservationContextBlockReason,
  computerUseVisibleArtifactGapReason,
} from '../../../packages/actions/computer-use/runtime-policy.js';
import {
  genericLoopPayload,
  VISION_TOOL_ID,
  writeGenericLoopPayloadValidationRepairAuditSink,
} from '../vision-sense/computer-use-trace-output.js';
import {
  bindWindowTargetFromOpenAppAction,
  localCoordinateMetadata,
  mappedCoordinateMetadata,
  windowConsistencyMetadata,
  windowLifecycleTrace,
} from '../vision-sense/computer-use-window-session.js';
import { buildFocusRegionFromVisionSense, refineActionGroundingWithFocusRegion, resolveActionGrounding } from '../vision-sense/computer-use-grounding.js';
import { actionLedgerCompletion, appendPlannerStep, nextPlannerActions } from '../vision-sense/computer-use-plan.js';

const HOST_PORT_RESULT_SCHEMA = 'sciforge.computer-use.host-port-result.v1';
const PACKAGE_BRIDGE_TRACE_SCHEMA = 'sciforge.computer-use.package-bridge-trace.v1';

type HostPortCall = {
  type: 'hostPortCall';
  id: string;
  port: string;
  args?: unknown[];
  kwargs?: Record<string, unknown>;
};

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
  const runId = sanitizeId(config.runId || `computer-use-package-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`);
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
  const actionProviderRequest = normalizePackageBridgeApprovalRequest(
    gatewayRequestToComputerUseRequest(request, config, workspace),
  );

  emitWorkspaceRuntimeEvent(callbacks, {
    type: visionSenseRuntimeEventTypes.runtimeSelected,
    source: 'workspace-runtime',
    toolName: VISION_TOOL_ID,
    status: 'running',
    message: 'Calling Computer Use package run_task through TUI Host stdio host ports.',
    detail: JSON.stringify({
      actionProviderRequest,
      hostPorts: computerUseHostPortsContract(config),
      bridge: 'python-package-stdio-host-ports',
      runId,
      testActionFixtureMode: config.testActionFixtureMode,
      testOnlyPlannedActions: fixtureActions.length,
      planner: state.dynamicPlannerEnabled ? 'runtime-codex-tui-text-planner' : 'test-only-fixture-actions',
    }),
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
    await writeGenericLoopPayloadValidationRepairAuditSink(payload, { workspacePath: workspace });
    return payload;
  }

  const rawPackageResult = await runPythonPackageTask(actionProviderRequest, {
    workspace,
    config,
    callbacks,
    state,
    codexPlannerAdapter: options.codexPlannerAdapter ?? codexPlannerAdapterForTests,
  });
  const packageResult = withFinalVisibleArtifactGuard(rawPackageResult, request, state);
  const tracePath = await writePackageBridgeTrace({
    workspace,
    config,
    state,
    request,
    packageResult,
  });
  const status = stringAt(packageResult, 'status');
  const succeeded = status === 'completed';
  const failureReason = succeeded ? '' : packageBridgeFailureReason(packageResult, status);
  const payload = genericLoopPayload({
    request,
    workspace,
    runId,
    tracePath,
    screenshotRefs: state.screenshotLedger,
    status: succeeded ? 'done' : 'failed-with-reason',
    failureReason,
    actionCount: numberAt(recordAt(packageResult, 'metrics')?.actionCount) ?? state.executedActions.length,
    maxSteps: config.maxSteps,
    dryRun: config.dryRun,
    desktopPlatform: config.desktopPlatform,
    windowTarget: state.targetResolution.ok ? toTraceWindowTarget(state.targetResolution) : undefined,
    visibleArtifacts: state.visibleArtifacts,
    createdAt: new Date().toISOString(),
  });
  attachPackageResultHostActions(payload, packageResult, callbacks);
  if (!succeeded) {
    await writeGenericLoopPayloadValidationRepairAuditSink(payload, { workspacePath: workspace });
  }
  return payload;
}

function withFinalVisibleArtifactGuard(
  packageResult: Record<string, unknown>,
  request: GatewayRequest,
  state: PackageBridgeState,
): Record<string, unknown> {
  if (stringAt(packageResult, 'status') !== 'completed') return packageResult;
  const finalGap = computerUseVisibleArtifactGapReason(request.prompt, state.executedActions, { finalAttempt: true });
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
  const packageDir = resolve('packages/actions/computer-use');
  const python = process.env.SCIFORGE_COMPUTER_USE_PACKAGE_PYTHON
    || process.env.SCIFORGE_VISION_SENSE_PYTHON
    || 'python3';
  const child = spawn(python, [
    '-m',
    'sciforge_computer_use',
    '--request-json',
    JSON.stringify(actionProviderRequest),
    '--host-port-stdio',
  ], {
    cwd: packageDir,
    env: {
      ...process.env,
      PYTHONPATH: [packageDir, process.env.PYTHONPATH].filter(Boolean).join(delimiter),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stdoutBuffer = '';
  let stderr = '';
  let finalResult: Record<string, unknown> | undefined;
  const pending = new Set<Promise<void>>();

  const handleLine = (line: string) => {
    if (!line.trim()) return;
    let message: unknown;
    try {
      message = JSON.parse(line) as unknown;
    } catch {
      stderr = [stderr, `Non-JSON stdout from Computer Use package: ${line}`].filter(Boolean).join('\n');
      return;
    }
    if (!isRecord(message)) return;
    if (message.type === 'hostPortCall') {
      const task = handleHostPortCall(message as HostPortCall, context)
        .then((result) => writeHostPortResult(child, String(message.id), true, result))
        .catch((error) => writeHostPortResult(child, String(message.id), false, undefined, error instanceof Error ? error.message : String(error)))
        .finally(() => pending.delete(task));
      pending.add(task);
      return;
    }
    if (message.type === 'finalResult' && isRecord(message.result)) {
      finalResult = message.result;
    }
  };

  child.stdout.on('data', (chunk) => {
    stdoutBuffer += String(chunk);
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() ?? '';
    for (const line of lines) handleLine(line);
  });
  child.stderr.on('data', (chunk) => {
    stderr += String(chunk);
  });

  const close = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveClose) => {
    child.on('close', (code, signal) => resolveClose({ code, signal }));
    child.on('error', (error) => {
      stderr = [stderr, error.message].filter(Boolean).join('\n');
      resolveClose({ code: 127, signal: null });
    });
  });
  if (stdoutBuffer.trim()) handleLine(stdoutBuffer);
  if (pending.size) await Promise.allSettled([...pending]);
  if (finalResult) return finalResult;
  return {
    schemaVersion: 'sciforge.computer-use.result.v1',
    status: 'failed-with-reason',
    reason: [
      'Computer Use package process exited without finalResult.',
      `exitCode=${close.code ?? 'signal'}`,
      close.signal ? `signal=${close.signal}` : undefined,
      stderr.trim() || undefined,
    ].filter(Boolean).join(' '),
    message: stderr.trim(),
    failureDiagnostics: { failedStage: 'package-bridge', stderr: stderr.trim() },
    traceRefs: [],
    metrics: {},
  };
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
  switch (call.port) {
    case 'capture':
      return capturePort(call, context);
    case 'plan':
      return planPort(call, context);
    case 'locate':
      return locatePort(call, context);
    case 'execute':
      return executePort(call, context);
    case 'verify':
      return verifyPort(call, context);
    case 'writeTrace':
      return writeTracePort(call, context);
    case 'emitEvent':
      return emitEventPort(call, context);
    default:
      throw new Error(`Unsupported Computer Use host port: ${call.port}`);
  }
}

async function capturePort(
  call: HostPortCall,
  context: {
    workspace: string;
    config: ComputerUseConfig;
    state: PackageBridgeState;
  },
) {
  const { workspace, config, state } = context;
  const query = typeof call.kwargs?.query === 'string' ? call.kwargs.query : undefined;
  const historyLength = Array.isArray(call.args?.[1]) ? call.args[1].length : 0;
  state.targetResolution = await resolveWindowTarget(config);
  const isMissingPlannerInitialCapture = state.captureIndex === 0 && !query && state.actionQueue.length === 0;
  state.captureIndex += 1;
  const prefix = isMissingPlannerInitialCapture
    ? 'step-000-before'
    : `step-${String(historyLength + 1).padStart(3, '0')}-${query === 'after-action' ? 'after' : 'before'}`;
  const refs = await captureDisplays(workspace, state.runDir, prefix, config, state.targetResolution);
  state.screenshotLedger.push(...refs);
  const visibleTextExtraction = await extractVisibleTextsFromScreenshotRefs(refs, config);
  const virtualSession = hasExecutableIndependentInputAdapter(config)
    ? await readVirtualRemoteSessionState(state.runDir)
    : undefined;
  const virtualVisibleTexts = collectVirtualRemoteSessionVisibleTexts(virtualSession);
  const virtualArtifacts = collectVirtualRemoteSessionArtifacts(virtualSession);
  if (virtualSession) state.virtualRemoteSessionRef = workspaceRel(workspace, join(state.runDir, 'virtual-remote-session.json'));
  state.visibleArtifacts = mergeVisibleArtifacts(state.visibleArtifacts, virtualArtifacts);
  const visibleTexts = uniqueStrings([
    ...visibleTextExtraction.visibleTexts,
    ...virtualVisibleTexts,
  ]);
  const primary = refs[0];
  const observation = {
    ref: primary?.path ?? workspaceRel(workspace, join(state.runDir, `${prefix}.png`)),
    summary: [
      `Captured ${refs.length} screenshot ref(s) for ${query ?? 'before-action'}.`,
      state.targetResolution.ok ? `target=${state.targetResolution.captureKind}:${state.targetResolution.source}` : state.targetResolution.reason,
      visibleTexts.length
        ? `visibleText=${visibleTexts.slice(0, 8).join(' | ')}`
        : undefined,
      virtualArtifacts.length
        ? `visibleArtifacts=${virtualArtifacts.map((artifact) => artifact.artifactRef).join(' | ')}`
        : undefined,
    ].filter(Boolean).join(' '),
    visibleTexts,
    windowTarget: state.targetResolution.ok ? toTraceWindowTarget(state.targetResolution) : undefined,
    artifacts: {
      screenshotRefs: refs.map(toTraceScreenshotRef),
      virtualRemoteSessionRef: state.virtualRemoteSessionRef,
      visibleArtifactRefs: virtualArtifacts.map((artifact) => artifact.artifactRef),
      visibleArtifacts: virtualArtifacts,
    },
    metadata: {
      query,
      screenshotRefs: refs.map(toTraceScreenshotRef),
      visibleTexts,
      visibleTextExtractionDiagnostics: visibleTextExtraction.diagnostics,
      virtualRemoteSessionRef: state.virtualRemoteSessionRef,
      visibleArtifactRefs: virtualArtifacts.map((artifact) => artifact.artifactRef),
    },
  };
  state.captureRefsByObservationRef.set(observation.ref, refs);
  state.latestObservation = observation;
  return observation;
}

async function planPort(
  call: HostPortCall,
  context: { workspace: string; config: ComputerUseConfig; state: PackageBridgeState; codexPlannerAdapter?: AgentCliAdapter },
) {
  const { workspace, config, state } = context;
  if (!state.actionQueue.length && state.dynamicPlannerEnabled && !state.plannerReportedDone) {
    const requestArg = recordArg(call, 0);
    const observation = recordArg(call, 1);
    state.latestObservation = observation;
    const observationRefs = state.captureRefsByObservationRef.get(stringAt(observation, 'ref') ?? '') ?? state.screenshotLedger.slice(-Math.max(1, config.captureDisplays.length));
    const stepIndex = state.executedActions.length;
    const plannerStepId = stepIndex === 0
      ? 'step-000-plan'
      : `step-${String(stepIndex).padStart(3, '0')}-replan`;
    const historyLength = state.visionHistorySteps.length;
    const planned = await appendPlannerStep({
      id: plannerStepId,
      task: stringAt(requestArg, 'task') ?? '',
      observation,
      screenshotRefs: observationRefs,
      steps: state.visionHistorySteps,
      config,
      workspace,
      codexPlannerAdapter: context.codexPlannerAdapter,
    });
    const newPlannerSteps = state.visionHistorySteps
      .slice(historyLength)
      .filter((step) => step.kind === 'planning');
    state.plannerTraceSteps.push(...newPlannerSteps);
    state.plannerReportedDone = planned.done;
    if (!planned.ok) {
      state.activeAction = undefined;
      return { done: false, reason: planned.reason };
    } else if (planned.done) {
      state.activeAction = undefined;
      return { done: true, reason: planned.reason || 'Codex text planner reported task done.' };
    } else {
      state.actionQueue.push(...nextPlannerActions(planned.actions, config.maxSteps - state.executedActions.length));
    }
  }
  const next = state.actionQueue.shift();
  if (!next) {
    state.activeAction = undefined;
    if (!state.missingPlannerAfterCaptured) {
      state.targetResolution = await resolveWindowTarget(config);
      const refs = await captureDisplays(workspace, state.runDir, 'step-000-after', config, state.targetResolution);
      state.screenshotLedger.push(...refs);
      const primary = refs[0];
      if (primary) state.captureRefsByObservationRef.set(primary.path, refs);
      state.missingPlannerAfterCaptured = true;
    }
    return {
      done: false,
      reason: state.dynamicPlannerEnabled
        ? [
            'Generic Computer Use loop is active, but the Runtime Codex text planner emitted no action.',
            'SciForge must provide a Runtime Codex planner plus Grounder that emits generic visible GUI actions.',
          ].join(' ')
        : [
            'Computer Use test-only fixture action queue is exhausted.',
            'Production planning must use the Runtime Codex TUI text planner host port.',
          ].join(' '),
    };
  }
  state.activeAction = normalizePlatformAction(next, config);
  return genericActionToPackagePlan(state.activeAction);
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
  state.activeAction = { ...resolvedAction, grounding };
  return {
    ok: true,
    x: numberAt(grounding.executorX) ?? numberAt(grounding.x) ?? numberAt(grounding.localX),
    y: numberAt(grounding.executorY) ?? numberAt(grounding.y) ?? numberAt(grounding.localY),
    coordinateSpace: stringAt(grounding, 'coordinateSpace') ?? 'observation',
    confidence: numberAt(grounding.confidence),
    reason: stringAt(grounding, 'reason') ?? '',
    metadata: grounding,
  };
}

async function executePort(
  call: HostPortCall,
  context: { workspace: string; config: ComputerUseConfig; state: PackageBridgeState },
) {
  const { workspace, config, state } = context;
  const action = packagePlanToGenericAction(recordArg(call, 0), state.activeAction, recordArg(call, 1));
  state.activeAction = action;
  const observationSummary = stringAt(state.latestObservation, 'summary');
  const visibleTexts = [
    ...stringList(state.latestObservation?.visibleTexts),
    ...stringList(recordAt(state.latestObservation, 'metadata')?.visibleTexts),
  ];
  const contextBlockReason = computerUseActionObservationContextBlockReason({
    actionType: action.type,
    text: action.type === 'type_text' ? action.text : undefined,
    targetDescription: action.targetDescription,
    targetRegionDescription: action.targetRegionDescription,
    targetAppName: state.targetResolution.ok ? state.targetResolution.appName : undefined,
    targetTitle: state.targetResolution.ok ? state.targetResolution.title : undefined,
    observationSummary,
    visibleTexts,
    visibleTextExtractionEnabled: Boolean(config.visibleTextExtraction?.enabled),
  });
  if (contextBlockReason) {
    return {
      ok: false,
      message: contextBlockReason,
      blocked: true,
      metadata: {
        executor: config.dryRun ? 'dry-run-generic-gui-executor' : executorBoundary(config),
        exitCode: 125,
        stderr: contextBlockReason,
        inputChannel: inputChannelDescription(config, state.targetResolution),
        windowTarget: state.targetResolution.ok ? toTraceWindowTarget(state.targetResolution) : undefined,
      },
    };
  }
  const result = config.dryRun
    ? { exitCode: 0, stdout: 'dry-run package bridge', stderr: '' }
    : hasExecutableIndependentInputAdapter(config)
      ? await executeIndependentInputAdapterAction(action, config, state.targetResolution, {
          workspace,
          runDir: state.runDir,
          stepIndex: state.executedActions.length,
        })
      : await executeGenericDesktopAction(action, config, state.targetResolution);
  state.executedActions.push(action);
  if (result.exitCode === 0 && !hasExecutableIndependentInputAdapter(config)) {
    bindWindowTargetFromOpenAppAction(config, action);
  }
  const rawIndependentAdapterMetadata = (result as { independentInputAdapter?: unknown }).independentInputAdapter;
  const independentAdapterMetadata = isRecord(rawIndependentAdapterMetadata)
    ? rawIndependentAdapterMetadata
    : undefined;
  const virtualArtifacts = recordList(independentAdapterMetadata?.visibleArtifacts).filter(isVirtualRemoteVisibleArtifact);
  state.visibleArtifacts = mergeVisibleArtifacts(state.visibleArtifacts, virtualArtifacts);
  const virtualRemoteSessionRef = stringAt(independentAdapterMetadata, 'virtualRemoteSessionRef');
  if (virtualRemoteSessionRef) state.virtualRemoteSessionRef = virtualRemoteSessionRef;
  return {
    ok: result.exitCode === 0,
    message: result.stderr || result.stdout || `exitCode=${result.exitCode}`,
    blocked: result.exitCode !== 0,
    metadata: {
      executor: config.dryRun ? 'dry-run-generic-gui-executor' : independentInputAdapterExecutionBoundary(config) ?? executorBoundary(config),
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      inputChannel: inputChannelDescription(config, state.targetResolution),
      windowTarget: state.targetResolution.ok ? toTraceWindowTarget(state.targetResolution) : undefined,
      schedulerLease: isRecord((result as { schedulerLease?: unknown }).schedulerLease) ? (result as { schedulerLease?: unknown }).schedulerLease : undefined,
      independentInputAdapter: independentAdapterMetadata,
      virtualRemoteSessionRef: state.virtualRemoteSessionRef,
      visibleArtifactRefs: state.visibleArtifacts.map((artifact) => artifact.artifactRef),
      visibleArtifacts: state.visibleArtifacts,
    },
  };
}

async function verifyPort(
  call: HostPortCall,
  context: { workspace: string; config: ComputerUseConfig; state: PackageBridgeState },
) {
  const { workspace, config, state } = context;
  const request = recordArg(call, 0);
  const before = recordArg(call, 1);
  const after = recordArg(call, 2);
  const action = packagePlanToGenericAction(recordArg(call, 3), state.activeAction);
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
  const artifactGap = computerUseVisibleArtifactGapReason(stringAt(request, 'task') ?? '', state.executedActions);
  const pixelDiff = pixelDiffForScreenshotSets(beforeRefs, afterRefs);
  const focusPixelDiff = beforeFocusRefs.length && afterFocusRefs.length
    ? pixelDiffForScreenshotSets(beforeFocusRefs, afterFocusRefs)
    : undefined;
  const windowConsistency = windowConsistencyMetadata(beforeRefs, afterRefs, config);
  const historyGrounding = groundingForAction(action) ?? {};
  const historyStatus = executionOk ? 'done' : 'failed';
  const planningFeedback = packageVerifierPlanningFeedback(action, historyGrounding, pixelDiff, windowConsistency, historyStatus);
  const regionSemantic = packageRegionSemanticVerifier(action, historyGrounding, pixelDiff, historyStatus);
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
        exitCode: numberAt(recordAt(execution, 'metadata')?.exitCode) ?? (executionOk ? 0 : 1),
        stdout: stringAt(recordAt(execution, 'metadata'), 'stdout'),
        stderr: stringAt(recordAt(execution, 'metadata'), 'stderr'),
        independentInputAdapter: recordAt(execution, 'metadata')?.independentInputAdapter,
      },
      scheduler: schedulerStepMetadata(state.targetResolution, `step-${stepNumber}`, config),
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
    ledgerCompletion = await actionLedgerCompletion(stringAt(request, 'task') ?? '', [
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
  if (ledgerCompletion?.complete) {
    state.actionQueue.length = 0;
    state.plannerReportedDone = true;
  }
  const fixtureQueueExhaustedArtifactGap = executionOk && !state.dynamicPlannerEnabled && state.actionQueue.length === 0 && !ledgerCompletion?.complete
    ? computerUseVisibleArtifactGapReason(stringAt(request, 'task') ?? '', state.executedActions, { finalAttempt: true })
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
  const done = executionOk && (ledgerCompletion?.complete || (!state.dynamicPlannerEnabled && (state.actionQueue.length === 0 || (
    config.completionPolicy?.mode === 'one-successful-non-wait-action' && action.type !== 'wait'
  ))));
  const verification = {
    ok: executionOk,
    done,
    reason: executionOk
      ? ledgerCompletion?.complete
        ? ledgerCompletion.reason || 'action-ledger completion policy satisfied'
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
      beforeScreenshotRefs: beforeRefs.map(toTraceScreenshotRef),
      afterScreenshotRefs: afterRefs.map(toTraceScreenshotRef),
      queuedActionsRemaining: state.actionQueue.length,
    },
  };
  pushHistoryStep(verification);
  return verification;
}

async function writeTracePort(
  call: HostPortCall,
  context: {
    workspace: string;
    config: ComputerUseConfig;
    callbacks: WorkspaceRuntimeCallbacks;
    state: PackageBridgeState;
  },
) {
  const packageResult = recordArg(call, 0);
  return workspaceRel(context.workspace, await writePackageBridgeTrace({
    ...context,
    request: undefined,
    packageResult,
  }));
}

function emitEventPort(
  call: HostPortCall,
  context: { callbacks: WorkspaceRuntimeCallbacks },
) {
  const event = recordArg(call, 0);
  emitWorkspaceRuntimeEvent(context.callbacks, {
    type: stringAt(event, 'type') ?? 'computer-use.package.event',
    source: 'computer-use-package-bridge',
    toolName: VISION_TOOL_ID,
    status: stringAt(event, 'status') ?? 'running',
    message: stringAt(event, 'reason') ?? stringAt(event, 'task') ?? stringAt(event, 'type'),
    detail: JSON.stringify(event),
  });
  return { ok: true };
}

async function writePackageBridgeTrace(params: {
  workspace: string;
  config: ComputerUseConfig;
  state: PackageBridgeState;
  request?: GatewayRequest;
  packageResult: Record<string, unknown>;
}) {
  const tracePath = join(params.state.runDir, 'vision-trace.json');
  params.state.tracePath = tracePath;
  const trace = {
    schemaVersion: visionSenseTraceIds.traceSchema,
    runId: params.state.runId,
    tool: VISION_TOOL_ID,
    runtime: visionSenseTraceIds.workspaceRuntime,
    packageBridge: {
      schemaVersion: PACKAGE_BRIDGE_TRACE_SCHEMA,
      runtime: 'sciforge.workspace-runtime.computer-use-package-bridge',
      actionProvider: 'action.sciforge.computer-use',
      hostPortProtocol: 'stdio-jsonl',
    },
    actionProvider: 'action.sciforge.computer-use',
    executionBoundary: params.config.dryRun ? 'dry-run-generic-gui-executor' : independentInputAdapterExecutionBoundary(params.config) ?? executorBoundary(params.config),
    createdAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    request: params.request ? {
      text: params.request.prompt,
      selectedToolIds: params.request.selectedToolIds,
      computerUseRequest: gatewayRequestToComputerUseRequest(params.request, params.config, params.workspace),
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
      actionProvider: 'action.sciforge.computer-use',
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
  await writeFile(tracePath, `${JSON.stringify(trace, null, 2)}\n`, 'utf8');
  return tracePath;
}

function packageResultStepsToVisionSteps(
  packageResult: Record<string, unknown>,
  state: PackageBridgeState,
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
    const grounding = normalizeTraceGrounding(recordAt(step, 'grounding') ?? {}, actionRecord);
    const action = packageTraceActionToGenericAction(actionRecord, grounding);
    const execution = recordAt(step, 'execution');
    const verification = recordAt(step, 'verification');
    const status = step.status === 'done' ? 'done' : step.status === 'blocked' ? 'blocked' : 'failed';
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
        exitCode: numberAt(recordAt(execution, 'metadata')?.exitCode) ?? (execution.ok === false ? 1 : 0),
        stdout: stringAt(recordAt(execution, 'metadata'), 'stdout'),
        stderr: stringAt(recordAt(execution, 'metadata'), 'stderr'),
        independentInputAdapter: recordAt(execution, 'metadata')?.independentInputAdapter,
        virtualRemoteSessionRef: stringAt(recordAt(execution, 'metadata'), 'virtualRemoteSessionRef'),
        visibleArtifactRefs: stringList(recordAt(execution, 'metadata')?.visibleArtifactRefs),
      } : undefined,
      scheduler: schedulerStepMetadata(state.targetResolution, `step-${String(index + 1).padStart(3, '0')}`, config),
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

function refsByName(state: PackageBridgeState, fragment: string) {
  return state.screenshotLedger.filter((ref) => ref.id.includes(fragment) || ref.path.includes(fragment));
}

function refsForStepIndex(state: PackageBridgeState, index: number, phase: 'before' | 'after') {
  const stepNumber = String(index + 1).padStart(3, '0');
  return refsByName(state, `step-${stepNumber}-${phase}`);
}

function mergeVisibleArtifacts(
  existing: VirtualRemoteVisibleArtifact[],
  next: VirtualRemoteVisibleArtifact[],
) {
  const merged = new Map(existing.map((artifact) => [artifact.artifactRef, artifact]));
  for (const artifact of next) merged.set(artifact.artifactRef, artifact);
  return [...merged.values()];
}

function isVirtualRemoteVisibleArtifact(record: Record<string, unknown>): record is VirtualRemoteVisibleArtifact {
  return typeof record.artifactRef === 'string'
    && typeof record.dataRef === 'string'
    && typeof record.path === 'string'
    && typeof record.id === 'string'
    && typeof record.title === 'string'
    && typeof record.appId === 'string'
    && record.delivery === 'virtual-remote-session-artifact'
    && Array.isArray(record.visibleTexts)
    && Array.isArray(record.sourceActionIds);
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}

function normalizeTraceGrounding(grounding: Record<string, unknown>, action: Record<string, unknown>) {
  const metadata = recordAt(grounding, 'metadata') ?? {};
  return {
    ...metadata,
    ...grounding,
  };
}

function shouldRunFineGroundingPass(grounding: Record<string, unknown>) {
  return stringAt(grounding, 'provider') === 'kv-ground';
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
  if (type === 'click') return { ...base, type: 'click', x, y };
  if (type === 'double_click') return { ...base, type: 'double_click', x, y };
  if (type === 'drag') {
    return {
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
    };
  }
  if (type === 'type_text') return { ...base, type: 'type_text', text: stringAt(action, 'text') ?? '' };
  if (type === 'press_key') return { ...base, type: 'press_key', key: stringAt(action, 'key') ?? '' };
  if (type === 'hotkey') return { ...base, type: 'hotkey', keys: stringList(action.keys) };
  if (type === 'scroll') return { ...base, type: 'scroll', direction: scrollDirection(stringAt(action, 'direction')), amount: numberAt(action.amount) };
  if (type === 'open_app') return { ...base, type: 'open_app', appName: stringAt(action, 'appName') ?? '' };
  return { ...base, type: 'wait' };
}

function packageVerifierPlanningFeedback(
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

function packageRegionSemanticVerifier(
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

function attachPackageResultHostActions(
  payload: ToolPayload,
  packageResult: Record<string, unknown>,
  callbacks: WorkspaceRuntimeCallbacks,
) {
  const tuiHostActions = computerUseResultToTuiHostActions({
    ...packageResult,
    message: payload.message,
    executionUnits: payload.executionUnits,
    workEvidence: payload.workEvidence,
    artifacts: payload.artifacts,
  });
  if (!tuiHostActions.length) return;
  payload.objectReferences = [
    ...(payload.objectReferences ?? []),
    {
      id: 'ref:computer-use-tui-host-actions',
      type: 'computer-use-tui-host-actions',
      data: {
        schemaVersion: 'sciforge.computer-use.tui-host-actions.bundle.v1',
        actions: tuiHostActions,
      },
    },
  ];
  payload.logs = [
    ...(payload.logs ?? []),
    {
      kind: 'computer-use-tui-host-actions',
      ref: 'audit:computer-use-tui-host-actions',
      actions: tuiHostActions,
    },
  ];
  emitWorkspaceRuntimeEvent(callbacks, {
    type: 'computer-use.tui-host-actions',
    source: 'computer-use-package-bridge',
    toolName: VISION_TOOL_ID,
    status: 'done',
    message: 'Computer Use package result mapped to TUI Host gui.present/gui.ask_user action metadata.',
    detail: JSON.stringify({ actions: tuiHostActions }),
  });
}

function writeHostPortResult(
  child: ReturnType<typeof spawn>,
  id: string,
  ok: boolean,
  result?: unknown,
  error?: string,
) {
  const stdin = child.stdin;
  if (!stdin) return;
  stdin.write(`${JSON.stringify({
    schemaVersion: HOST_PORT_RESULT_SCHEMA,
    type: 'hostPortResult',
    id,
    ok,
    result,
    error,
  })}\n`);
}

function genericActionToPackagePlan(action: GenericVisionAction): Record<string, unknown> {
  return {
    kind: action.type,
    target: actionTarget(action),
    text: 'text' in action ? action.text : undefined,
    key: 'key' in action ? action.key : undefined,
    keys: 'keys' in action ? action.keys : undefined,
    direction: 'direction' in action ? action.direction : undefined,
    amount: 'amount' in action ? action.amount : undefined,
    appName: 'appName' in action ? action.appName : undefined,
    riskLevel: action.riskLevel,
    requiresConfirmation: action.requiresConfirmation,
    metadata: {
      targetDescription: action.targetDescription,
      targetRegionDescription: action.targetRegionDescription,
      hasHostPlannedCoordinates: hasPlannedCoordinates(action),
      confirmationText: action.confirmationText,
    },
  };
}

function packagePlanToGenericAction(
  plan: Record<string, unknown>,
  activeAction?: GenericVisionAction,
  grounding?: Record<string, unknown>,
): GenericVisionAction {
  const type = (stringAt(plan, 'kind') ?? stringAt(plan, 'type') ?? activeAction?.type ?? 'wait') as GenericVisionAction['type'];
  const target = recordAt(plan, 'target');
  const targetDescription = stringAt(target, 'description') ?? stringAt(plan, 'targetDescription') ?? activeAction?.targetDescription;
  const targetRegionDescription = stringAt(target, 'region_description') ?? stringAt(target, 'targetRegionDescription') ?? activeAction?.targetRegionDescription;
  const riskLevel = parseRiskLevel(stringAt(plan, 'risk_level') ?? stringAt(plan, 'riskLevel') ?? activeAction?.riskLevel);
  const base = {
    targetDescription,
    targetRegionDescription,
    riskLevel,
    requiresConfirmation: Boolean(plan.requires_confirmation ?? plan.requiresConfirmation ?? activeAction?.requiresConfirmation),
    confirmationText: stringAt(plan, 'confirmationText') ?? activeAction?.confirmationText,
  };
  const groundingMetadata = recordAt(grounding, 'metadata');
  const x = numberAt(grounding?.x)
    ?? numberAt(groundingMetadata?.executorX)
    ?? (activeAction && 'x' in activeAction ? numberAt(activeAction.x) : undefined);
  const y = numberAt(grounding?.y)
    ?? numberAt(groundingMetadata?.executorY)
    ?? (activeAction && 'y' in activeAction ? numberAt(activeAction.y) : undefined);
  if (type === 'click') return { ...base, type: 'click', x, y };
  if (type === 'double_click') return { ...base, type: 'double_click', x, y };
  if (type === 'drag') {
    const fromX = numberAt(grounding?.x)
      ?? numberAt(groundingMetadata?.executorFromX)
      ?? numberAt(groundingMetadata?.localFromX)
      ?? (activeAction && 'fromX' in activeAction ? numberAt(activeAction.fromX) : undefined);
    const fromY = numberAt(grounding?.y)
      ?? numberAt(groundingMetadata?.executorFromY)
      ?? numberAt(groundingMetadata?.localFromY)
      ?? (activeAction && 'fromY' in activeAction ? numberAt(activeAction.fromY) : undefined);
    const toX = numberAt(groundingMetadata?.executorToX)
      ?? numberAt(groundingMetadata?.localToX)
      ?? (activeAction && 'toX' in activeAction ? numberAt(activeAction.toX) : undefined);
    const toY = numberAt(groundingMetadata?.executorToY)
      ?? numberAt(groundingMetadata?.localToY)
      ?? (activeAction && 'toY' in activeAction ? numberAt(activeAction.toY) : undefined);
    return {
      ...base,
      type,
      fromX,
      fromY,
      toX,
      toY,
      fromTargetDescription: activeAction && 'fromTargetDescription' in activeAction ? activeAction.fromTargetDescription : undefined,
      toTargetDescription: activeAction && 'toTargetDescription' in activeAction ? activeAction.toTargetDescription : undefined,
    };
  }
  if (type === 'type_text') return { ...base, type, text: stringAt(plan, 'text') ?? (activeAction && 'text' in activeAction ? activeAction.text : '') };
  if (type === 'press_key') return { ...base, type, key: stringAt(plan, 'key') ?? (activeAction && 'key' in activeAction ? activeAction.key : '') };
  if (type === 'hotkey') return { ...base, type, keys: stringList(plan.keys).length ? stringList(plan.keys) : activeAction && 'keys' in activeAction ? activeAction.keys : [] };
  if (type === 'scroll') return { ...base, type, direction: scrollDirection(stringAt(plan, 'direction') ?? (activeAction && 'direction' in activeAction ? activeAction.direction : 'down')), amount: numberAt(plan.amount) };
  if (type === 'open_app') return { ...base, type, appName: stringAt(plan, 'appName') ?? stringAt(plan, 'app_name') ?? (activeAction && 'appName' in activeAction ? activeAction.appName : '') };
  return { ...base, type: 'wait', ms: activeAction && 'ms' in activeAction ? activeAction.ms : 500 };
}

function actionTarget(action: GenericVisionAction) {
  if (action.type === 'drag') {
    const description = action.fromTargetDescription ?? action.targetDescription;
    const regionDescription = action.toTargetDescription ?? action.targetRegionDescription;
    if (description || regionDescription) {
      return {
        description: description ?? regionDescription,
        region_description: regionDescription,
      };
    }
  }
  const description = action.targetDescription ?? ('appName' in action ? action.appName : undefined);
  if (!description) return undefined;
  return {
    description,
    region_description: action.targetRegionDescription,
  };
}

function hasPlannedCoordinates(action: GenericVisionAction) {
  return ('x' in action && typeof action.x === 'number')
    || ('fromX' in action && typeof action.fromX === 'number');
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

function stringList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function recordList(value: unknown) {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function scrollDirection(value: string | undefined): 'up' | 'down' | 'left' | 'right' {
  return value === 'up' || value === 'left' || value === 'right' ? value : 'down';
}

function parseRiskLevel(value: string | undefined): 'low' | 'medium' | 'high' | undefined {
  return value === 'low' || value === 'medium' || value === 'high' ? value : undefined;
}

function packageBridgeFailureReason(packageResult: Record<string, unknown>, status: string | undefined) {
  const reason = stringAt(packageResult, 'reason') || stringAt(packageResult, 'message') || `Computer Use package returned status=${status || 'unknown'}.`;
  if (status === 'max-steps') {
    return reason.replace(/\bmax_steps=/g, 'maxSteps=');
  }
  if (status === 'needs-confirmation' && /high-risk|confirmation/i.test(reason)) {
    return `High-risk Computer Use action blocked: ${reason}`;
  }
  return reason;
}

function normalizePackageBridgeApprovalRequest(request: ReturnType<typeof gatewayRequestToComputerUseRequest>) {
  if (request.approvalRef !== 'approval:vision-sense-dry-run-smoke') return request;
  return {
    ...request,
    riskPolicy: 'fail-closed' as const,
    approvalRef: undefined,
    metadata: {
      ...request.metadata,
      ignoredApprovalRef: request.approvalRef,
      ignoredApprovalReason: 'vision-sense dry-run smoke approval does not authorize high-risk Computer Use actions',
    },
  };
}
