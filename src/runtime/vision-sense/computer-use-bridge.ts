import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type { GatewayRequest, ToolPayload, WorkspaceRuntimeCallbacks } from '../runtime-types.js';
import { captureDisplays, pixelDiffForScreenshotSets, toTraceScreenshotRef, validateRuntimeTraceScreenshots } from '../computer-use/capture.js';
import { executorBoundary } from '../computer-use/executor.js';
import type { ComputerUseConfig as VisionSenseConfig, LoopStep, ScreenshotRef } from '../computer-use/types.js';
import { sanitizeId, workspaceRel } from '../computer-use/utils.js';
import { inputChannelContract, inputChannelDescription, resolveWindowTarget, schedulerRunMetadata, toTraceWindowTarget, windowTargetTraceConfig } from '../computer-use/window-target.js';
import { visionSensePlannerOnlyEvidencePolicy, visionSenseTraceContractPolicy, visionSenseTraceIds } from '../../../packages/observe/vision/computer-use-runtime-policy.js';
import { runComputerUseActionLoop } from './computer-use-action-loop.js';
import { appendPlannerStep, nextPlannerActions } from './computer-use-plan.js';
import { shouldCompleteFromFileRefsOnlyPolicy } from './computer-use-policy-bridge.js';
import { genericBridgeBlockedPayload, genericLoopPayload, VISION_TOOL_ID } from './computer-use-trace-output.js';
import { windowConsistencyMetadata, windowLifecycleTrace } from './computer-use-window-session.js';

export async function runGenericVisionComputerUseLoop(
  request: GatewayRequest,
  workspace: string,
  config: VisionSenseConfig,
  callbacks: WorkspaceRuntimeCallbacks,
): Promise<ToolPayload> {
  const runId = sanitizeId(config.runId || `generic-cu-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`);
  const runDir = resolve(config.outputDir || join(workspace, '.sciforge', 'vision-runs', runId));
  await mkdir(runDir, { recursive: true });
  const createdAt = new Date().toISOString();
  const steps: LoopStep[] = [];
  const screenshotLedger: ScreenshotRef[] = [];
  let targetResolution = await resolveWindowTarget(config);

  let executionStatus: 'done' | 'failed-with-reason' = 'done';
  let failureReason = '';
  const dynamicPlannerEnabled = !config.plannedActions.length && Boolean(config.planner.baseUrl && config.planner.apiKey && config.planner.model);
  const actionQueue = config.plannedActions.slice(0, config.maxSteps);
  let plannerReportedDone = false;
  let dynamicPlannerRan = false;

  if (!targetResolution.ok) {
    executionStatus = 'failed-with-reason';
    failureReason = targetResolution.reason;
    steps.push({
      id: 'step-000-blocked-window-target',
      kind: 'planning',
      status: 'blocked',
      verifier: {
        status: 'blocked',
        reason: 'target window contract could not be resolved',
        diagnostics: targetResolution.diagnostics,
        windowTarget: windowTargetTraceConfig(targetResolution.target),
        windowConsistency: windowConsistencyMetadata([], [], config),
      },
      failureReason,
    });
  }

  if (!actionQueue.length && await shouldCompleteFromFileRefsOnlyPolicy(request.prompt) && executionStatus !== 'failed-with-reason') {
    dynamicPlannerRan = true;
    const plannerRefs = await captureDisplays(workspace, runDir, 'step-000-planner', config, targetResolution);
    screenshotLedger.push(...plannerRefs);
    plannerReportedDone = true;
    steps.push({
      id: 'step-000-plan',
      kind: 'planning',
      status: 'done',
      beforeScreenshotRefs: plannerRefs.map(toTraceScreenshotRef),
      verifier: {
        status: 'checked',
        reason: visionSensePlannerOnlyEvidencePolicy.verifierReason,
        windowConsistency: windowConsistencyMetadata(plannerRefs, plannerRefs, config),
      },
      execution: {
        planner: visionSensePlannerOnlyEvidencePolicy.plannerId,
        status: 'done',
        rawResponse: {
          done: true,
          actions: [],
          reason: visionSensePlannerOnlyEvidencePolicy.rawReason,
        },
      },
    });
  }

  if (!actionQueue.length && dynamicPlannerEnabled && executionStatus !== 'failed-with-reason' && !plannerReportedDone) {
    dynamicPlannerRan = true;
    const plannerRefs = await captureDisplays(workspace, runDir, 'step-000-planner', config, targetResolution);
    screenshotLedger.push(...plannerRefs);
    const planned = await appendPlannerStep({
      id: 'step-000-plan',
      task: request.prompt,
      screenshotRefs: plannerRefs,
      steps,
      config,
    });
    plannerReportedDone = planned.done;
    actionQueue.push(...nextPlannerActions(planned.actions, config.maxSteps));
    if (!planned.ok) {
      const fallbackActions = nextPlannerActions(config.completionPolicy?.fallbackActions ?? [], config.maxSteps);
      if (fallbackActions.length) {
        const plannerStep = steps[steps.length - 1];
        plannerStep.status = 'done';
        plannerStep.failureReason = undefined;
        plannerStep.verifier = {
          ...(plannerStep.verifier ?? {}),
          status: 'checked',
          reason: `VisionPlanner failed (${planned.reason}); using structured completionPolicy fallback action.`,
        };
        actionQueue.push(...fallbackActions);
      } else {
        executionStatus = 'failed-with-reason';
        failureReason = planned.reason;
      }
    } else if (!actionQueue.length && !planned.done) {
      executionStatus = 'failed-with-reason';
      failureReason = 'VisionPlanner emitted no executable generic actions.';
      steps[steps.length - 1].failureReason = failureReason;
    }
  }

  if (!actionQueue.length && !plannerReportedDone && executionStatus !== 'failed-with-reason') {
    const beforeRefs = await captureDisplays(workspace, runDir, 'step-000-before', config, targetResolution);
    const afterRefs = await captureDisplays(workspace, runDir, 'step-000-after', config, targetResolution);
    screenshotLedger.push(...beforeRefs, ...afterRefs);
    executionStatus = 'failed-with-reason';
    failureReason = [
      'Generic Vision Computer Use loop is active, but no planner/grounder actions were provided.',
      'SciForge must provide a VisionPlanner + Grounder that emits generic actions such as open_app/click/type_text/press_key/hotkey/scroll/drag/wait.',
      'The runtime captured real screenshot refs and stopped instead of using app-specific shortcuts or AgentServer repository scans.',
    ].join(' ');
    steps.push({
      id: 'step-001-plan',
      kind: 'planning',
      status: 'blocked',
      beforeScreenshotRefs: beforeRefs.map(toTraceScreenshotRef),
      afterScreenshotRefs: afterRefs.map(toTraceScreenshotRef),
      verifier: {
        status: 'blocked',
        reason: 'missing VisionPlanner/Grounder action plan',
        pixelDiff: pixelDiffForScreenshotSets(beforeRefs, afterRefs),
        windowConsistency: windowConsistencyMetadata(beforeRefs, afterRefs, config),
      },
      failureReason,
    });
  }

  const loopResult = await runComputerUseActionLoop({
    request,
    workspace,
    runDir,
    config,
    callbacks,
    steps,
    screenshotLedger,
    actionQueue,
    targetResolution,
    dynamicPlannerEnabled,
    plannerReportedDone,
    dynamicPlannerRan,
    executionStatus,
    failureReason,
  });
  targetResolution = loopResult.targetResolution;
  executionStatus = loopResult.executionStatus;
  failureReason = loopResult.failureReason;
  plannerReportedDone = loopResult.plannerReportedDone;
  dynamicPlannerRan = loopResult.dynamicPlannerRan;

  const completedAt = new Date().toISOString();
  const traceValidation = validateRuntimeTraceScreenshots(screenshotLedger);
  const trace = {
    schemaVersion: visionSenseTraceIds.traceSchema,
    runId,
    tool: VISION_TOOL_ID,
    runtime: visionSenseTraceIds.workspaceRuntime,
    executionBoundary: config.dryRun ? 'dry-run-generic-gui-executor' : executorBoundary(config),
    createdAt,
    completedAt,
    request: {
      text: request.prompt,
      selectedToolIds: request.selectedToolIds,
    },
    config: {
      captureDisplays: config.captureDisplays,
      desktopPlatform: config.desktopPlatform,
      windowTarget: targetResolution.ok
        ? toTraceWindowTarget(targetResolution)
        : {
            ...windowTargetTraceConfig(targetResolution.target),
            status: 'unresolved',
            diagnostics: targetResolution.diagnostics,
          },
      outputDir: workspaceRel(workspace, runDir),
      maxSteps: config.maxSteps,
      dryRun: config.dryRun,
      allowHighRiskActions: config.allowHighRiskActions,
      schedulerLockTimeoutMs: config.schedulerLockTimeoutMs,
      schedulerStaleLockMs: config.schedulerStaleLockMs,
      inputAdapter: config.inputAdapter,
      allowSharedSystemInput: config.allowSharedSystemInput,
      showVisualCursor: config.showVisualCursor,
      completionPolicy: config.completionPolicy,
    },
    imageMemory: {
      ...visionSenseTraceContractPolicy.imageMemory,
      refs: screenshotLedger.map(toTraceScreenshotRef),
    },
    genericComputerUse: {
      actionSchema: visionSenseTraceContractPolicy.genericActionSchema,
      appSpecificShortcuts: visionSenseTraceContractPolicy.appSpecificShortcuts,
      inputChannel: inputChannelDescription(config, targetResolution),
      inputChannelContract: inputChannelContract(config, targetResolution),
      coordinateContract: visionSenseTraceContractPolicy.coordinateContract(
        targetResolution.ok ? targetResolution.coordinateSpace : config.windowTarget.coordinateSpace,
      ),
      verifierContract: visionSenseTraceContractPolicy.verifierContract,
      inputIsolation: targetResolution.ok ? targetResolution.inputIsolation : config.windowTarget.inputIsolation,
      requires: visionSenseTraceContractPolicy.requires,
    },
    windowLifecycle: windowLifecycleTrace(
      targetResolution.ok
        ? toTraceWindowTarget(targetResolution)
        : {
            ...windowTargetTraceConfig(config.windowTarget),
            captureKind: 'display',
            source: 'display-fallback',
          },
      screenshotLedger,
    ),
    scheduler: {
      ...schedulerRunMetadata(targetResolution, config),
      executorLock: {
        provider: 'filesystem-lease',
        pathRoot: '/tmp/sciforge-computer-use-locks',
        timeoutMs: config.schedulerLockTimeoutMs ?? 60000,
        staleLockMs: config.schedulerStaleLockMs ?? 120000,
        appliesTo: config.dryRun ? 'none-dry-run' : 'real-gui-executor',
      },
    },
    validation: traceValidation,
    steps,
  };
  const tracePath = join(runDir, 'vision-trace.json');
  await writeFile(tracePath, `${JSON.stringify(trace, null, 2)}\n`, 'utf8');

  return genericLoopPayload({
    request,
    workspace,
    runId,
    tracePath,
    screenshotRefs: screenshotLedger,
    status: executionStatus,
    failureReason,
    actionCount: steps.filter((step) => step.kind === 'gui-execution').length,
    dryRun: config.dryRun,
    desktopPlatform: config.desktopPlatform,
    windowTarget: targetResolution.ok ? toTraceWindowTarget(targetResolution) : undefined,
  });
}


export { genericBridgeBlockedPayload };
