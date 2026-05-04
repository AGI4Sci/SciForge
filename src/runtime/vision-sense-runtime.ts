import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type { GatewayRequest, ToolPayload, WorkspaceRuntimeCallbacks } from './runtime-types.js';
import { isRecord, toStringList, uniqueStrings } from './gateway-utils.js';
import { emitWorkspaceRuntimeEvent } from './workspace-runtime-events.js';
import { groundingForAction, highRiskBlockReason, parseGenericActions, platformActionIssue, platformLauncherGuidance, trimLeadingWaitActions } from './computer-use/actions.js';
import { captureDisplays, pixelDiffForScreenshotSets, toTraceScreenshotRef, validateRuntimeTraceScreenshots } from './computer-use/capture.js';
import { executeGenericDesktopAction, executorBoundary } from './computer-use/executor.js';
import type { ComputerUseConfig as VisionSenseConfig, GenericVisionAction, GroundingResolution, LoopStep, PlannerContractIssue, ScreenshotRef, TraceWindowTarget, VisionPlannerConfig } from './computer-use/types.js';
import { booleanConfig, detectCaptureDisplays, envOrValue, extractChatCompletionContent, extractJsonObject, isDarwinPlatform, numberConfig, parseDisplayList, parseJson, platformLabel, sanitizeId, sha256, stringConfig, supportsBuiltinDesktopBridge, workspaceRel } from './computer-use/utils.js';
import { inputChannelDescription, isWindowLocalCoordinateSpace, parseWindowTarget, resolveWindowTarget, schedulerStepMetadata, stepInputChannelMetadata, toTraceWindowTarget, windowTargetTraceConfig } from './computer-use/window-target.js';

const VISION_TOOL_ID = 'local.vision-sense';

export async function tryRunVisionSenseRuntime(
  request: GatewayRequest,
  callbacks: WorkspaceRuntimeCallbacks = {},
): Promise<ToolPayload | undefined> {
  if (!visionSenseSelected(request)) return undefined;
  if (!looksLikeComputerUseRequest(request.prompt)) return undefined;

  const workspace = resolve(request.workspacePath || process.cwd());
  const config = await loadVisionSenseConfig(workspace, request);
  emitWorkspaceRuntimeEvent(callbacks, {
    type: 'vision-sense-runtime-selected',
    source: 'workspace-runtime',
    toolName: VISION_TOOL_ID,
    status: 'running',
    message: 'Selected generic vision-sense Computer Use loop.',
    detail: JSON.stringify({
      dryRun: config.dryRun,
      captureDisplays: config.captureDisplays,
      windowTarget: windowTargetTraceConfig(config.windowTarget),
      plannedActions: config.plannedActions.length,
    }),
  });

  if (!config.desktopBridgeEnabled) {
    return genericBridgeBlockedPayload(
      request,
      workspace,
      'local.vision-sense is selected, but the generic desktop bridge is disabled. Enable SCIFORGE_VISION_DESKTOP_BRIDGE=1 or .sciforge/config.json visionSense.desktopBridgeEnabled=true.',
      { selectedRuntime: 'vision-sense-generic-computer-use-loop', selectedToolId: VISION_TOOL_ID },
    );
  }

  return runGenericVisionComputerUseLoop(request, workspace, config, callbacks);
}

function visionSenseSelected(request: GatewayRequest) {
  const selected = uniqueStrings([
    ...(request.selectedToolIds ?? []),
    ...toStringList(request.uiState?.selectedToolIds),
  ]);
  return selected.includes(VISION_TOOL_ID);
}

function looksLikeComputerUseRequest(prompt: string) {
  return /computer\s*use|gui|desktop|screen|screenshot|mouse|keyboard|click|type|scroll|drag|browser|word|powerpoint|ppt|电脑|桌面|屏幕|截图|鼠标|键盘|点击|输入|滚动|拖拽|操作|使用|打开|创建|保存|文档|演示文稿|应用/i.test(prompt);
}

async function loadVisionSenseConfig(workspace: string, request: GatewayRequest): Promise<VisionSenseConfig> {
  const fileConfig = await readWorkspaceVisionConfig(workspace);
  const requestConfig = isRecord(request.uiState?.visionSenseConfig) ? request.uiState.visionSenseConfig : {};
  const displayValue = envOrValue(process.env.SCIFORGE_VISION_CAPTURE_DISPLAYS, requestConfig.captureDisplays, fileConfig.captureDisplays);
  const captureDisplays = parseDisplayList(displayValue);
  const defaultCaptureDisplays = captureDisplays.length ? captureDisplays : await detectCaptureDisplays();
  const desktopPlatform = stringConfig(
    process.env.SCIFORGE_VISION_DESKTOP_PLATFORM,
    requestConfig.desktopPlatform,
    requestConfig.executorPlatform,
    fileConfig.desktopPlatform,
    fileConfig.executorPlatform,
    process.platform,
  ) as string;
  const windowTarget = parseWindowTarget(requestConfig, fileConfig);
  return {
    desktopBridgeEnabled: booleanConfig(
      process.env.SCIFORGE_VISION_DESKTOP_BRIDGE,
      requestConfig.desktopBridgeEnabled,
      fileConfig.desktopBridgeEnabled,
      supportsBuiltinDesktopBridge(desktopPlatform),
    ),
    dryRun: booleanConfig(
      process.env.SCIFORGE_VISION_DESKTOP_BRIDGE_DRY_RUN,
      requestConfig.dryRun,
      fileConfig.dryRun,
      false,
    ),
    captureDisplays: defaultCaptureDisplays,
    desktopPlatform,
    windowTarget,
    runId: stringConfig(process.env.SCIFORGE_VISION_RUN_ID, requestConfig.runId, fileConfig.runId),
    outputDir: stringConfig(process.env.SCIFORGE_VISION_OUTPUT_DIR, requestConfig.outputDir, fileConfig.outputDir),
    maxSteps: numberConfig(process.env.SCIFORGE_VISION_MAX_STEPS, requestConfig.maxSteps, fileConfig.maxSteps) ?? 8,
    allowHighRiskActions: booleanConfig(
      process.env.SCIFORGE_VISION_ALLOW_HIGH_RISK_ACTIONS,
      requestConfig.allowHighRiskActions,
      fileConfig.allowHighRiskActions,
      false,
    ),
    executorCoordinateScale: numberConfig(process.env.SCIFORGE_VISION_EXECUTOR_COORDINATE_SCALE, requestConfig.executorCoordinateScale, fileConfig.executorCoordinateScale),
    planner: {
      baseUrl: stringConfig(
        process.env.SCIFORGE_VISION_PLANNER_BASE_URL,
        requestConfig.plannerBaseUrl,
        fileConfig.plannerBaseUrl,
        fileConfig.modelBaseUrl,
        request.llmEndpoint?.baseUrl,
      ),
      apiKey: stringConfig(
        process.env.SCIFORGE_VISION_PLANNER_API_KEY,
        requestConfig.plannerApiKey,
        fileConfig.plannerApiKey,
        fileConfig.apiKey,
        request.llmEndpoint?.apiKey,
      ),
      model: stringConfig(
        process.env.SCIFORGE_VISION_PLANNER_MODEL,
        requestConfig.plannerModel,
        fileConfig.plannerModel,
        fileConfig.modelName,
        request.llmEndpoint?.modelName,
        request.modelName,
      ),
      timeoutMs: numberConfig(process.env.SCIFORGE_VISION_PLANNER_TIMEOUT_MS, requestConfig.plannerTimeoutMs, fileConfig.plannerTimeoutMs) ?? 60000,
      maxTokens: numberConfig(process.env.SCIFORGE_VISION_PLANNER_MAX_TOKENS, requestConfig.plannerMaxTokens, fileConfig.plannerMaxTokens) ?? 512,
    },
    grounder: {
      baseUrl: stringConfig(process.env.SCIFORGE_VISION_KV_GROUND_URL, requestConfig.grounderBaseUrl, fileConfig.grounderBaseUrl),
      timeoutMs: numberConfig(process.env.SCIFORGE_VISION_KV_GROUND_TIMEOUT_MS, requestConfig.grounderTimeoutMs, fileConfig.grounderTimeoutMs) ?? 30000,
      allowServiceLocalPaths: booleanConfig(
        process.env.SCIFORGE_VISION_KV_GROUND_ALLOW_SERVICE_LOCAL_PATHS,
        requestConfig.grounderAllowServiceLocalPaths,
        fileConfig.grounderAllowServiceLocalPaths,
        false,
      ),
      localPathPrefix: stringConfig(process.env.SCIFORGE_VISION_KV_GROUND_LOCAL_PATH_PREFIX, requestConfig.grounderLocalPathPrefix, fileConfig.grounderLocalPathPrefix),
      remotePathPrefix: stringConfig(process.env.SCIFORGE_VISION_KV_GROUND_REMOTE_PATH_PREFIX, requestConfig.grounderRemotePathPrefix, fileConfig.grounderRemotePathPrefix),
      visionBaseUrl: stringConfig(
        process.env.SCIFORGE_VISION_GROUNDER_LLM_BASE_URL,
        requestConfig.visualGrounderBaseUrl,
        fileConfig.visualGrounderBaseUrl,
        process.env.SCIFORGE_VISION_PLANNER_BASE_URL,
        requestConfig.plannerBaseUrl,
        fileConfig.plannerBaseUrl,
        fileConfig.modelBaseUrl,
        request.llmEndpoint?.baseUrl,
      ),
      visionApiKey: stringConfig(
        process.env.SCIFORGE_VISION_GROUNDER_LLM_API_KEY,
        requestConfig.visualGrounderApiKey,
        fileConfig.visualGrounderApiKey,
        process.env.SCIFORGE_VISION_PLANNER_API_KEY,
        requestConfig.plannerApiKey,
        fileConfig.plannerApiKey,
        fileConfig.apiKey,
        request.llmEndpoint?.apiKey,
      ),
      visionModel: stringConfig(
        process.env.SCIFORGE_VISION_GROUNDER_LLM_MODEL,
        requestConfig.visualGrounderModel,
        fileConfig.visualGrounderModel,
        process.env.SCIFORGE_VISION_PLANNER_MODEL,
        requestConfig.plannerModel,
        fileConfig.plannerModel,
        fileConfig.modelName,
        request.llmEndpoint?.modelName,
        request.modelName,
      ),
      visionTimeoutMs: numberConfig(process.env.SCIFORGE_VISION_GROUNDER_LLM_TIMEOUT_MS, requestConfig.visualGrounderTimeoutMs, fileConfig.visualGrounderTimeoutMs) ?? 60000,
      visionMaxTokens: numberConfig(process.env.SCIFORGE_VISION_GROUNDER_LLM_MAX_TOKENS, requestConfig.visualGrounderMaxTokens, fileConfig.visualGrounderMaxTokens) ?? 384,
    },
    plannedActions: parseGenericActions(envOrValue(process.env.SCIFORGE_VISION_ACTIONS_JSON, requestConfig.actions, fileConfig.actions)),
  };
}

async function readWorkspaceVisionConfig(workspace: string): Promise<Record<string, unknown>> {
  const configPath = join(workspace, '.sciforge', 'config.json');
  try {
    const parsed = JSON.parse(await readFile(configPath, 'utf8')) as unknown;
    if (isRecord(parsed)) {
      return isRecord(parsed.visionSense) ? { ...parsed, ...parsed.visionSense } : parsed;
    }
  } catch {
    return {};
  }
  return {};
}

async function runGenericVisionComputerUseLoop(
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
  const targetResolution = await resolveWindowTarget(config);

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
      },
      failureReason,
    });
  }

  if (!actionQueue.length && dynamicPlannerEnabled && executionStatus !== 'failed-with-reason') {
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
    actionQueue.push(...planned.actions.slice(0, config.maxSteps));
    if (!planned.ok) {
      executionStatus = 'failed-with-reason';
      failureReason = planned.reason;
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
      },
      failureReason,
    });
  }

  if (actionQueue.length && executionStatus !== 'failed-with-reason') {
    for (let index = 0; index < config.maxSteps && actionQueue.length; index += 1) {
      const action = actionQueue.shift() as GenericVisionAction;
      const stepNumber = String(index + 1).padStart(3, '0');
      const beforeRefs = await captureDisplays(workspace, runDir, `step-${stepNumber}-before`, config, targetResolution);
      screenshotLedger.push(...beforeRefs);
      const platformBlockReason = platformActionIssue(action, config);
      if (platformBlockReason) {
        const afterRefs = await captureDisplays(workspace, runDir, `step-${stepNumber}-after`, config, targetResolution);
        screenshotLedger.push(...afterRefs);
        executionStatus = 'failed-with-reason';
        failureReason = platformBlockReason;
        steps.push({
          id: `step-${stepNumber}-blocked-platform-${action.type}`,
          kind: 'gui-execution',
          status: 'blocked',
          beforeScreenshotRefs: beforeRefs.map(toTraceScreenshotRef),
          afterScreenshotRefs: afterRefs.map(toTraceScreenshotRef),
          plannedAction: action,
          grounding: groundingForAction(action),
          execution: {
            executor: config.dryRun ? 'dry-run-generic-gui-executor' : executorBoundary(config),
            inputChannel: inputChannelDescription(config, targetResolution),
            windowTarget: targetResolution.ok ? toTraceWindowTarget(targetResolution) : undefined,
            status: 'blocked',
            blockedReason: platformBlockReason,
          },
          scheduler: schedulerStepMetadata(targetResolution, `step-${stepNumber}`),
          verifier: {
            status: 'blocked',
            reason: 'platform-incompatible Computer Use action',
            pixelDiff: pixelDiffForScreenshotSets(beforeRefs, afterRefs),
          },
          failureReason,
        });
        break;
      }
      const riskBlockReason = highRiskBlockReason(action, config);
      if (riskBlockReason) {
        const afterRefs = await captureDisplays(workspace, runDir, `step-${stepNumber}-after`, config, targetResolution);
        screenshotLedger.push(...afterRefs);
        executionStatus = 'failed-with-reason';
        failureReason = riskBlockReason;
        steps.push({
          id: `step-${stepNumber}-blocked-${action.type}`,
          kind: 'gui-execution',
          status: 'blocked',
          beforeScreenshotRefs: beforeRefs.map(toTraceScreenshotRef),
          afterScreenshotRefs: afterRefs.map(toTraceScreenshotRef),
          plannedAction: action,
          grounding: groundingForAction(action),
          execution: {
            executor: config.dryRun ? 'dry-run-generic-gui-executor' : executorBoundary(config),
            inputChannel: inputChannelDescription(config, targetResolution),
            windowTarget: targetResolution.ok ? toTraceWindowTarget(targetResolution) : undefined,
            status: 'blocked',
            blockedReason: riskBlockReason,
          },
          scheduler: schedulerStepMetadata(targetResolution, `step-${stepNumber}`),
          verifier: {
            status: 'blocked',
            reason: 'high-risk action requires upstream confirmation',
            pixelDiff: pixelDiffForScreenshotSets(beforeRefs, afterRefs),
          },
          failureReason,
        });
        break;
      }
      const groundingResolution = await resolveActionGrounding(action, beforeRefs, config);
      if (!groundingResolution.ok) {
        const afterRefs = await captureDisplays(workspace, runDir, `step-${stepNumber}-after`, config, targetResolution);
        screenshotLedger.push(...afterRefs);
        executionStatus = 'failed-with-reason';
        failureReason = groundingResolution.reason;
        steps.push({
          id: `step-${stepNumber}-blocked-grounding-${action.type}`,
          kind: 'gui-execution',
          status: 'blocked',
          beforeScreenshotRefs: beforeRefs.map(toTraceScreenshotRef),
          afterScreenshotRefs: afterRefs.map(toTraceScreenshotRef),
          plannedAction: groundingResolution.action,
          grounding: groundingResolution.grounding,
          execution: {
            executor: config.dryRun ? 'dry-run-generic-gui-executor' : executorBoundary(config),
            inputChannel: inputChannelDescription(config, targetResolution),
            windowTarget: targetResolution.ok ? toTraceWindowTarget(targetResolution) : undefined,
            status: 'blocked',
            blockedReason: groundingResolution.reason,
          },
          scheduler: schedulerStepMetadata(targetResolution, `step-${stepNumber}`),
          verifier: {
            status: 'blocked',
            reason: 'grounding did not produce executable coordinates',
            pixelDiff: pixelDiffForScreenshotSets(beforeRefs, afterRefs),
          },
          failureReason,
        });
        break;
      }
      const executableAction = groundingResolution.action;
      emitWorkspaceRuntimeEvent(callbacks, {
        type: 'vision-sense-generic-action',
        source: 'workspace-runtime',
        toolName: VISION_TOOL_ID,
        status: 'running',
        message: `Executing generic Computer Use action ${index + 1}/${config.maxSteps}: ${executableAction.type}`,
      });
      const result = config.dryRun
        ? { exitCode: 0, stdout: 'dry-run', stderr: '' }
        : await executeGenericDesktopAction(executableAction, config, targetResolution);
      const afterRefs = await captureDisplays(workspace, runDir, `step-${stepNumber}-after`, config, targetResolution);
      screenshotLedger.push(...afterRefs);
      const ok = result.exitCode === 0;
      if (!ok) {
        executionStatus = 'failed-with-reason';
        failureReason = result.stderr || result.stdout || `Generic action ${action.type} failed with exit ${result.exitCode}`;
      }
      steps.push({
        id: `step-${stepNumber}-execute-${executableAction.type}`,
        kind: 'gui-execution',
        status: ok ? 'done' : 'failed',
        beforeScreenshotRefs: beforeRefs.map(toTraceScreenshotRef),
        afterScreenshotRefs: afterRefs.map(toTraceScreenshotRef),
        plannedAction: executableAction,
        grounding: groundingResolution.grounding ?? groundingForAction(executableAction),
        windowTarget: targetResolution.ok ? toTraceWindowTarget(targetResolution) : undefined,
        localCoordinate: localCoordinateMetadata(groundingResolution.grounding, executableAction, beforeRefs[0]),
        mappedCoordinate: mappedCoordinateMetadata(groundingResolution.grounding, executableAction),
        inputChannel: stepInputChannelMetadata(config, targetResolution),
        execution: {
          executor: config.dryRun ? 'dry-run-generic-gui-executor' : executorBoundary(config),
          inputChannel: inputChannelDescription(config, targetResolution),
          windowTarget: targetResolution.ok ? toTraceWindowTarget(targetResolution) : undefined,
          status: ok ? 'done' : 'failed',
          exitCode: result.exitCode,
          stdout: result.stdout.trim() || undefined,
          stderr: result.stderr.trim() || undefined,
        },
        scheduler: schedulerStepMetadata(targetResolution, `step-${stepNumber}`),
        verifier: {
          status: ok ? 'checked' : 'skipped-after-execution-failure',
          method: 'pixel-diff',
          pixelDiff: pixelDiffForScreenshotSets(beforeRefs, afterRefs),
        },
        failureReason: ok ? undefined : failureReason,
      });
      if (!ok) break;
      if (dynamicPlannerEnabled && actionQueue.length === 0 && index + 1 < config.maxSteps) {
        dynamicPlannerRan = true;
        const planned = await appendPlannerStep({
          id: `step-${stepNumber}-replan`,
          task: request.prompt,
          screenshotRefs: afterRefs,
          steps,
          config,
        });
        plannerReportedDone = planned.done;
        if (!planned.ok) {
          executionStatus = 'failed-with-reason';
          failureReason = planned.reason;
          break;
        }
        actionQueue.push(...planned.actions.slice(0, config.maxSteps - index - 1));
        if (!actionQueue.length || planned.done) break;
      }
    }
  }

  if (dynamicPlannerEnabled && dynamicPlannerRan && !plannerReportedDone && executionStatus !== 'failed-with-reason') {
    executionStatus = 'failed-with-reason';
    failureReason = [
      `VisionPlanner reached maxSteps=${config.maxSteps} without confirming the task is complete.`,
      'The runtime executed only generic Computer Use actions and stopped with a recoverable failure instead of claiming success.',
      'Increase maxSteps or improve the planner/grounder so it can complete and verify the visible task state.',
    ].join(' ');
    const lastStep = [...steps].reverse().find((step) => step.kind === 'gui-execution' || step.kind === 'planning');
    if (lastStep && !lastStep.failureReason) {
      lastStep.verifier = {
        ...(lastStep.verifier ?? {}),
        status: 'blocked',
        reason: 'maxSteps exhausted before planner reported done=true',
      };
      lastStep.failureReason = failureReason;
    }
  }

  const completedAt = new Date().toISOString();
  const traceValidation = validateRuntimeTraceScreenshots(screenshotLedger);
  const trace = {
    schemaVersion: 'sciforge.vision-trace.v1',
    runId,
    tool: VISION_TOOL_ID,
    runtime: 'sciforge.workspace-runtime.vision-sense-generic-loop',
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
    },
    imageMemory: {
      policy: 'file-ref-only',
      reason: 'Multi-turn memory keeps screenshot paths, hashes, dimensions, and display ids; it never stores inline image payloads.',
      refs: screenshotLedger.map(toTraceScreenshotRef),
    },
    genericComputerUse: {
      actionSchema: ['open_app', 'click', 'double_click', 'drag', 'type_text', 'press_key', 'hotkey', 'scroll', 'wait'],
      appSpecificShortcuts: [],
      inputChannel: inputChannelDescription(config, targetResolution),
      coordinateContract: {
        planner: 'target descriptions only',
        grounderOutput: 'target-window screenshot coordinates',
        executorInput: targetResolution.ok ? targetResolution.coordinateSpace : config.windowTarget.coordinateSpace,
      },
      inputIsolation: targetResolution.ok ? targetResolution.inputIsolation : config.windowTarget.inputIsolation,
      requires: ['WindowTargetProvider', 'VisionPlanner', 'Grounder', 'GuiExecutor', 'Verifier'],
    },
    scheduler: {
      mode: 'serialized-window-actions',
      lockId: targetResolution.ok ? targetResolution.schedulerLockId : 'unresolved-window-target',
      policy: 'one real GUI action stream per target window; planner/grounder analysis may run in parallel, executor actions are serialized by window lock',
      targetWindow: targetResolution.ok ? toTraceWindowTarget(targetResolution) : windowTargetTraceConfig(config.windowTarget),
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

async function appendPlannerStep(params: {
  id: string;
  task: string;
  screenshotRefs: ScreenshotRef[];
  steps: LoopStep[];
  config: VisionSenseConfig;
}) {
  const plannerResult = await planGenericActionsFromScreenshot(params.task, params.screenshotRefs[0], params.config);
  const hasActions = plannerResult.ok && plannerResult.actions.length > 0;
  params.steps.push({
    id: params.id,
    kind: 'planning',
    status: plannerResult.ok && (hasActions || plannerResult.done) ? 'done' : 'blocked',
    beforeScreenshotRefs: params.screenshotRefs.map(toTraceScreenshotRef),
    verifier: {
      status: plannerResult.ok ? 'checked' : 'blocked',
      reason: plannerResult.ok
        ? plannerResult.done
          ? plannerResult.reason || 'planner reported task done'
          : hasActions
            ? 'planner emitted generic action plan'
            : 'planner emitted no actions'
        : plannerResult.reason,
    },
    execution: {
      planner: 'openai-compatible-vision-planner',
      model: params.config.planner.model,
      status: plannerResult.ok && (hasActions || plannerResult.done) ? 'done' : 'blocked',
      rawResponse: plannerResult.rawResponse,
    },
    failureReason: plannerResult.ok && (hasActions || plannerResult.done) ? undefined : plannerResult.reason || 'VisionPlanner emitted no executable generic actions.',
  });
  return plannerResult;
}

async function resolveActionGrounding(
  action: GenericVisionAction,
  beforeRefs: ScreenshotRef[],
  config: VisionSenseConfig,
): Promise<GroundingResolution> {
  if (action.type === 'click' || action.type === 'double_click') {
    if (typeof action.x === 'number' && typeof action.y === 'number') {
      const executorPoint = screenshotToExecutorPoint(action.x, action.y, beforeRefs[0], config);
      const executableAction = { ...action, x: executorPoint.x, y: executorPoint.y };
      return {
        ok: true,
        action: executableAction,
        grounding: {
          ...groundingForAction(action),
          screenshotX: action.x,
          screenshotY: action.y,
          executorX: executorPoint.x,
          executorY: executorPoint.y,
          executorCoordinateScale: executorPoint.scale,
          coordinateSpace: executorPoint.coordinateSpace,
          windowTarget: beforeRefs[0]?.windowTarget,
        },
      };
    }
    if (!action.targetDescription) {
      return {
        ok: false,
        action,
        grounding: { status: 'failed', reason: 'missing targetDescription and coordinates' },
        reason: `Generic ${action.type} action requires either x/y coordinates or targetDescription for Grounder.`,
      };
    }
    const grounded = await groundTargetDescription(action.targetDescription, beforeRefs, config);
    if (!grounded.ok) {
      return {
        ok: false,
        action,
        grounding: grounded.grounding,
        reason: grounded.reason,
      };
    }
    const executorPoint = screenshotToExecutorPoint(grounded.x, grounded.y, beforeRefs[0], config);
    const groundedAction = { ...action, x: executorPoint.x, y: executorPoint.y };
    return {
      ok: true,
      action: groundedAction,
      grounding: {
        ...grounded.grounding,
        screenshotX: grounded.x,
        screenshotY: grounded.y,
        executorX: executorPoint.x,
        executorY: executorPoint.y,
        executorCoordinateScale: executorPoint.scale,
        coordinateSpace: executorPoint.coordinateSpace,
        windowTarget: beforeRefs[0]?.windowTarget,
      },
    };
  }

  if (action.type === 'drag') {
    const hasEndpoints = [action.fromX, action.fromY, action.toX, action.toY].every((value) => typeof value === 'number');
    if (hasEndpoints) {
      const fromExecutor = screenshotToExecutorPoint(action.fromX as number, action.fromY as number, beforeRefs[0], config);
      const toExecutor = screenshotToExecutorPoint(action.toX as number, action.toY as number, beforeRefs[0], config);
      const executableAction = { ...action, fromX: fromExecutor.x, fromY: fromExecutor.y, toX: toExecutor.x, toY: toExecutor.y };
      return {
        ok: true,
        action: executableAction,
        grounding: {
          ...groundingForAction(action),
          screenshotFromX: action.fromX,
          screenshotFromY: action.fromY,
          screenshotToX: action.toX,
          screenshotToY: action.toY,
          executorFromX: fromExecutor.x,
          executorFromY: fromExecutor.y,
          executorToX: toExecutor.x,
          executorToY: toExecutor.y,
          executorCoordinateScale: fromExecutor.scale,
          coordinateSpace: fromExecutor.coordinateSpace,
          windowTarget: beforeRefs[0]?.windowTarget,
        },
      };
    }
    if (!action.fromTargetDescription || !action.toTargetDescription) {
      return {
        ok: false,
        action,
        grounding: { status: 'failed', reason: 'missing drag endpoint target descriptions and coordinates' },
        reason: 'Generic drag action requires explicit from/to coordinates or fromTargetDescription and toTargetDescription for Grounder.',
      };
    }
    const from = await groundTargetDescription(action.fromTargetDescription, beforeRefs, config);
    if (!from.ok) return { ok: false, action, grounding: from.grounding, reason: from.reason };
    const to = await groundTargetDescription(action.toTargetDescription, beforeRefs, config);
    if (!to.ok) return { ok: false, action, grounding: to.grounding, reason: to.reason };
    const fromExecutor = screenshotToExecutorPoint(from.x, from.y, beforeRefs[0], config);
    const toExecutor = screenshotToExecutorPoint(to.x, to.y, beforeRefs[0], config);
    const groundedAction = { ...action, fromX: fromExecutor.x, fromY: fromExecutor.y, toX: toExecutor.x, toY: toExecutor.y };
    return {
      ok: true,
      action: groundedAction,
      grounding: {
        status: 'provided',
        from: from.grounding,
        to: to.grounding,
        targetDescription: action.targetDescription,
        executorCoordinateScale: fromExecutor.scale,
        coordinateSpace: fromExecutor.coordinateSpace,
        windowTarget: beforeRefs[0]?.windowTarget,
      },
    };
  }

  return { ok: true, action, grounding: groundingForAction(action) };
}

function screenshotToExecutorPoint(x: number, y: number, screenshot: ScreenshotRef | undefined, config: VisionSenseConfig) {
  const scale = config.executorCoordinateScale ?? inferExecutorCoordinateScale(screenshot, config);
  const bounds = isWindowLocalCoordinateSpace(screenshot?.windowTarget?.coordinateSpace) ? screenshot?.windowTarget?.bounds : undefined;
  return {
    x: (x + (bounds?.x ?? 0)) / scale,
    y: (y + (bounds?.y ?? 0)) / scale,
    scale,
    coordinateSpace: screenshot?.windowTarget?.coordinateSpace ?? config.windowTarget.coordinateSpace,
  };
}

function inferExecutorCoordinateScale(screenshot: ScreenshotRef | undefined, config: VisionSenseConfig) {
  if (!screenshot?.width || !screenshot.height) return 1;
  if (isDarwinPlatform(config.desktopPlatform) && screenshot.width >= 2500 && screenshot.height >= 1200) return 2;
  return 1;
}

async function planGenericActionsFromScreenshot(
  task: string,
  screenshot: ScreenshotRef | undefined,
  config: VisionSenseConfig,
): Promise<{ ok: true; actions: GenericVisionAction[]; done: boolean; reason?: string; rawResponse: unknown } | { ok: false; actions: []; done: false; reason: string; rawResponse?: unknown }> {
  if (!screenshot) return { ok: false, actions: [], done: false, reason: 'VisionPlanner could not run because no screenshot was captured.' };
  const firstAttempt = await requestGenericPlannerActions(task, screenshot, config);
  if (!firstAttempt.ok && firstAttempt.retryableContractViolation) {
    const retry = await requestGenericPlannerActions(
      task,
      screenshot,
      config,
      plannerRetryInstruction(firstAttempt.contractIssue, config),
    );
    return retry.ok ? retry : firstAttempt;
  }
  if (!firstAttempt.ok) return firstAttempt;
  if (!firstAttempt.done && (firstAttempt.actions.length === 0 || firstAttempt.actions.every((action) => action.type === 'wait'))) {
    const retry = await requestGenericPlannerActions(
      task,
      screenshot,
      config,
      'The current screenshot has already been captured. Do not return an empty action list or wait as the only action unless done=true. For an underspecified GUI sub-task, choose a conservative non-destructive screen action from the current screenshot, such as scroll on the main visible content, press Escape to dismiss transient overlays, use Alt+Tab to recover a hidden window, or click a clearly described visible low-risk target. Return at least one non-wait action: click, double_click, drag, type_text, press_key, hotkey, or scroll; or set done=true with actions=[] if the task is complete.',
    );
    if (!retry.ok) return retry;
    if (!retry.done && (retry.actions.length === 0 || retry.actions.every((action) => action.type === 'wait'))) {
      if (isHighRiskGuiRequest(task)) {
        return {
          ok: true,
          actions: [{
            type: 'click',
            targetDescription: 'the visible high-risk control requested by the task',
            riskLevel: 'high',
            requiresConfirmation: true,
          }],
          done: false,
          reason: 'High-risk GUI request must fail closed before executor until upstream confirmation is present.',
          rawResponse: retry.rawResponse,
        };
      }
      return {
        ok: false,
        actions: [],
        done: false,
        reason: 'VisionPlanner retried but still emitted no non-wait executable generic actions.',
        rawResponse: retry.rawResponse,
      };
    }
    return retry;
  }
  return firstAttempt;
}

function isHighRiskGuiRequest(text: string) {
  return /delete|send|pay|authorize|publish|submit|删除|发送|支付|授权|发布|提交|登录授权|外部表单/i.test(text);
}

async function requestGenericPlannerActions(
  task: string,
  screenshot: ScreenshotRef,
  config: VisionSenseConfig,
  extraInstruction?: string,
): Promise<{ ok: true; actions: GenericVisionAction[]; done: boolean; reason?: string; rawResponse: unknown } | { ok: false; actions: []; done: false; reason: string; rawResponse?: unknown; retryableContractViolation?: boolean; contractIssue?: PlannerContractIssue }> {
  const imageBytes = await readFile(screenshot.absPath);
  const imageBase64 = imageBytes.toString('base64');
  const response = await postOpenAiChatCompletion(config.planner, [
    {
      role: 'system',
      content: [
        'You are SciForge VisionPlanner for generic Computer Use.',
        'Return only JSON. Do not read DOM or accessibility. Do not output application-private APIs, scripts, selectors, files, or shortcuts that depend on one app.',
        `Execution environment: ${plannerEnvironmentDescription(config)}.`,
        `Window target contract: ${plannerWindowTargetDescription(config)}.`,
        `Use only keys and modifiers supported by desktopPlatform="${config.desktopPlatform}". Do not use keys from another operating system family.`,
        'When an app must be opened, prefer open_app with appName. If open_app is unavailable for the configured executor, use the operating system app launcher visible from the current screenshot, expressed as generic keyboard/mouse actions. Do not assume a desktop icon exists unless it is visibly present.',
        'For visual targets, output targetDescription text only; never output x/y/fromX/fromY/toX/toY coordinates. Coordinates are produced by the Grounder in the target-window screenshot coordinate system.',
        'Allowed action types: open_app, click, double_click, drag, type_text, press_key, hotkey, scroll, wait.',
        'Return {"done": boolean, "reason": string, "actions": [...]}. Set done=true only when the supplied screenshot shows the requested GUI task is complete; otherwise return the next generic action.',
        'The supplied screenshot is the observation state. Do not use wait as the only action to request another observation.',
        'High-risk send/delete/pay/authorize/publish/submit actions must be marked riskLevel="high" and requiresConfirmation=true.',
        extraInstruction,
      ].join(' '),
    },
    {
      role: 'user',
      content: [
        { type: 'text', text: `Task: ${task}\nReturn {"done":false,"reason":"...","actions":[...]} with one or a few generic next actions. Stop before final high-risk actions unless explicitly confirmed by upstream.` },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${imageBase64}` } },
      ],
    },
  ]);
  if (!response.ok) return { ok: false, actions: [], done: false, reason: `VisionPlanner request failed: ${response.error}` };
  const content = extractChatCompletionContent(response.body);
  if (!content) return { ok: false, actions: [], done: false, reason: 'VisionPlanner response did not include message content.', rawResponse: response.body };
  const json = extractJsonObject(content);
  if (!isRecord(json) && !Array.isArray(json)) return { ok: false, actions: [], done: false, reason: 'VisionPlanner response was not valid JSON.', rawResponse: response.body };
  const rawActions = isRecord(json) && Array.isArray(json.actions) ? json.actions : Array.isArray(json) ? json : [];
  const done = isRecord(json) && typeof json.done === 'boolean' ? json.done : false;
  const reason = isRecord(json) && typeof json.reason === 'string' ? json.reason : undefined;
  const coordinateViolation = rawActions.find((action) => isRecord(action) && ['x', 'y', 'fromX', 'fromY', 'toX', 'toY'].some((key) => key in action));
  if (coordinateViolation) {
    return {
      ok: false,
      actions: [],
      done: false,
      reason: 'VisionPlanner output coordinates, which violates the generic planner contract. Coordinates must come from Grounder.',
      rawResponse: response.body,
      retryableContractViolation: true,
      contractIssue: 'coordinate-output',
    };
  }
  const actions = parseGenericActions(rawActions);
  const platformIssue = actions.map((action) => platformActionIssue(action, config)).find(Boolean);
  if (platformIssue) {
    return {
      ok: false,
      actions: [],
      done: false,
      reason: platformIssue,
      rawResponse: response.body,
      retryableContractViolation: true,
      contractIssue: 'platform-incompatible-action',
    };
  }
  return { ok: true, actions: trimLeadingWaitActions(actions, done), done, reason, rawResponse: response.body };
}

function plannerRetryInstruction(issue: PlannerContractIssue | undefined, config: VisionSenseConfig) {
  if (issue === 'platform-incompatible-action') {
    return [
      'Your previous JSON used an action that cannot be executed in the current operating system.',
      `Rewrite for ${plannerEnvironmentDescription(config)} using only supported keys/modifiers and generic visible GUI actions.`,
      platformLauncherGuidance(config.desktopPlatform),
    ].join(' ');
  }
  return 'Your previous JSON violated the planner contract by including screen coordinates. Rewrite the plan without x/y/fromX/fromY/toX/toY. Use targetDescription, fromTargetDescription, and toTargetDescription so the Grounder can produce coordinates.';
}

function plannerEnvironmentDescription(config: VisionSenseConfig) {
  return `${platformLabel(config.desktopPlatform)} desktop controlled by screenshots plus generic mouse/keyboard events`;
}

function plannerWindowTargetDescription(config: VisionSenseConfig) {
  const target = config.windowTarget;
  if (!target.enabled || target.mode === 'display') return 'display capture fallback; coordinates are interpreted in screen/display space';
  return [
    `mode=${target.mode}`,
    `required=${target.required}`,
    `coordinateSpace=${target.coordinateSpace}`,
    `inputIsolation=${target.inputIsolation}`,
    target.appName ? `appName=${JSON.stringify(target.appName)}` : '',
    target.title ? `title=${JSON.stringify(target.title)}` : '',
    target.windowId !== undefined ? `windowId=${target.windowId}` : '',
  ].filter(Boolean).join(' ');
}

function localCoordinateMetadata(grounding: Record<string, unknown> | undefined, action: GenericVisionAction, screenshot: ScreenshotRef | undefined) {
  const space = isWindowLocalCoordinateSpace(screenshot?.windowTarget?.coordinateSpace) ? 'window' : 'screen';
  if (action.type === 'click' || action.type === 'double_click') {
    return {
      space,
      x: numberConfig(grounding?.screenshotX, action.x),
      y: numberConfig(grounding?.screenshotY, action.y),
      screenshotRef: screenshot?.path,
    };
  }
  if (action.type === 'drag') {
    return {
      space,
      fromX: numberConfig(grounding?.screenshotFromX, action.fromX),
      fromY: numberConfig(grounding?.screenshotFromY, action.fromY),
      toX: numberConfig(grounding?.screenshotToX, action.toX),
      toY: numberConfig(grounding?.screenshotToY, action.toY),
      screenshotRef: screenshot?.path,
    };
  }
  return { space, screenshotRef: screenshot?.path };
}

function mappedCoordinateMetadata(grounding: Record<string, unknown> | undefined, action: GenericVisionAction) {
  if (action.type === 'click' || action.type === 'double_click') {
    return {
      space: 'executor',
      x: numberConfig(grounding?.executorX, action.x),
      y: numberConfig(grounding?.executorY, action.y),
      scale: numberConfig(grounding?.executorCoordinateScale),
    };
  }
  if (action.type === 'drag') {
    return {
      space: 'executor',
      fromX: numberConfig(grounding?.executorFromX, action.fromX),
      fromY: numberConfig(grounding?.executorFromY, action.fromY),
      toX: numberConfig(grounding?.executorToX, action.toX),
      toY: numberConfig(grounding?.executorToY, action.toY),
      scale: numberConfig(grounding?.executorCoordinateScale),
    };
  }
  return { space: 'executor' };
}

async function postOpenAiChatCompletion(planner: VisionPlannerConfig, messages: Array<Record<string, unknown>>) {
  if (!planner.baseUrl || !planner.apiKey || !planner.model) {
    return { ok: false as const, error: 'planner baseUrl/apiKey/model are required' };
  }
  const url = planner.baseUrl.replace(/\/+$/, '').endsWith('/chat/completions')
    ? planner.baseUrl.replace(/\/+$/, '')
    : `${planner.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), planner.timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${planner.apiKey}`,
      },
      body: JSON.stringify({
        model: planner.model,
        messages,
        temperature: 0,
        max_tokens: planner.maxTokens,
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    });
    const text = await response.text();
    const parsed = text ? parseJson(text) : {};
    if (!response.ok) return { ok: false as const, error: `HTTP ${response.status}: ${text.slice(0, 500)}` };
    return { ok: true as const, body: isRecord(parsed) ? parsed : { value: parsed } };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timeout);
  }
}

async function groundTargetDescription(
  targetDescription: string,
  beforeRefs: ScreenshotRef[],
  config: VisionSenseConfig,
): Promise<{ ok: true; x: number; y: number; grounding: Record<string, unknown> } | { ok: false; reason: string; grounding: Record<string, unknown> }> {
  const screenshot = beforeRefs[0];
  if (!screenshot) {
    return {
      ok: false,
      reason: 'Grounder could not run because no before screenshot was captured.',
      grounding: { status: 'failed', targetDescription, reason: 'missing screenshot' },
    };
  }
  if (!config.grounder.baseUrl) {
    return groundTargetWithVisionModel(targetDescription, screenshot, config);
  }
  const imagePath = resolveGrounderImagePath(screenshot, config);
  if (!imagePath.ok) {
    return {
      ok: false,
      reason: imagePath.reason,
      grounding: { status: 'failed', targetDescription, screenshotRef: screenshot.path, reason: imagePath.reason },
    };
  }

  const startedAt = Date.now();
  const response = await postJsonWithTimeout(
    `${config.grounder.baseUrl.replace(/\/+$/, '')}/predict/`,
    {
      image_path: imagePath.path,
      text_prompt: targetDescription,
      coordinate_space: screenshot.windowTarget?.coordinateSpace ?? 'screen',
      window_target: screenshot.windowTarget,
    },
    config.grounder.timeoutMs,
  );
  if (!response.ok) {
    return {
      ok: false,
      reason: `Grounder request failed: ${response.error}`,
      grounding: { status: 'failed', targetDescription, screenshotRef: screenshot.path, imagePath: imagePath.path, error: response.error },
    };
  }
  const coordinates = parseGrounderCoordinates(response.body);
  if (!coordinates) {
    return {
      ok: false,
      reason: 'Grounder response did not include usable coordinates.',
      grounding: { status: 'failed', targetDescription, screenshotRef: screenshot.path, imagePath: imagePath.path, rawResponse: response.body },
    };
  }
  return {
    ok: true,
    x: coordinates.x,
    y: coordinates.y,
    grounding: {
      status: 'ok',
      provider: 'kv-ground',
      targetDescription,
      screenshotRef: screenshot.path,
      imagePath: imagePath.path,
      x: coordinates.x,
      y: coordinates.y,
      latencyMs: Date.now() - startedAt,
      rawResponse: response.body,
    },
  };
}

async function groundTargetWithVisionModel(
  targetDescription: string,
  screenshot: ScreenshotRef,
  config: VisionSenseConfig,
): Promise<{ ok: true; x: number; y: number; grounding: Record<string, unknown> } | { ok: false; reason: string; grounding: Record<string, unknown> }> {
  if (!config.grounder.visionBaseUrl || !config.grounder.visionApiKey || !config.grounder.visionModel) {
    return {
      ok: false,
      reason: [
        'No Grounder is configured. Set SCIFORGE_VISION_KV_GROUND_URL for KV-Ground,',
        'or configure SCIFORGE_VISION_GROUNDER_LLM_BASE_URL/API_KEY/MODEL for an OpenAI-compatible visual Grounder.',
      ].join(' '),
      grounding: { status: 'failed', targetDescription, screenshotRef: screenshot.path, reason: 'missing grounder provider' },
    };
  }
  const startedAt = Date.now();
  const imageBase64 = (await readFile(screenshot.absPath)).toString('base64');
  const response = await postOpenAiChatCompletion(
    {
      baseUrl: config.grounder.visionBaseUrl,
      apiKey: config.grounder.visionApiKey,
      model: config.grounder.visionModel,
      timeoutMs: config.grounder.visionTimeoutMs,
      maxTokens: config.grounder.visionMaxTokens,
    },
    [
      {
        role: 'system',
        content: [
          'You are SciForge Grounder for generic Computer Use.',
          'Return only JSON with pixel coordinates in the supplied target-window screenshot coordinate system.',
          'Do not use DOM, accessibility, selectors, app APIs, or private shortcuts.',
          'Schema: {"coordinates":[x,y],"confidence":0..1,"reason":"short visual evidence"}.',
        ].join(' '),
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: `Locate this visual target: ${targetDescription}\nScreenshot size metadata: width=${screenshot.width ?? 'unknown'} height=${screenshot.height ?? 'unknown'}.\nWindow target metadata: ${JSON.stringify(screenshot.windowTarget ?? { mode: 'display', coordinateSpace: 'screen' })}.` },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${imageBase64}` } },
        ],
      },
    ],
  );
  if (!response.ok) {
    return {
      ok: false,
      reason: `OpenAI-compatible visual Grounder request failed: ${response.error}`,
      grounding: { status: 'failed', provider: 'openai-compatible-vision-grounder', targetDescription, screenshotRef: screenshot.path, error: response.error },
    };
  }
  const content = extractChatCompletionContent(response.body);
  const json = typeof content === 'string' ? extractJsonObject(content) : undefined;
  const coordinates = parseGrounderCoordinates(isRecord(json) ? json : response.body);
  if (!coordinates) {
    return {
      ok: false,
      reason: 'OpenAI-compatible visual Grounder response did not include usable coordinates.',
      grounding: { status: 'failed', provider: 'openai-compatible-vision-grounder', targetDescription, screenshotRef: screenshot.path, rawResponse: response.body },
    };
  }
  return {
    ok: true,
    x: coordinates.x,
    y: coordinates.y,
    grounding: {
      status: 'ok',
      provider: 'openai-compatible-vision-grounder',
      targetDescription,
      screenshotRef: screenshot.path,
      x: coordinates.x,
      y: coordinates.y,
      latencyMs: Date.now() - startedAt,
      rawResponse: response.body,
    },
  };
}

function resolveGrounderImagePath(ref: ScreenshotRef, config: VisionSenseConfig): { ok: true; path: string } | { ok: false; reason: string } {
  if (config.grounder.allowServiceLocalPaths) return { ok: true, path: ref.absPath };
  const localPrefix = config.grounder.localPathPrefix;
  const remotePrefix = config.grounder.remotePathPrefix;
  if (localPrefix && remotePrefix && ref.absPath.startsWith(localPrefix)) {
    return { ok: true, path: `${remotePrefix.replace(/\/+$/, '')}/${ref.absPath.slice(localPrefix.length).replace(/^\/+/, '')}` };
  }
  return {
    ok: false,
    reason: [
      'Grounder image path is local-only and no service-readable mapping is configured.',
      'Set SCIFORGE_VISION_KV_GROUND_ALLOW_SERVICE_LOCAL_PATHS=1 when the service shares the same filesystem,',
      'or configure SCIFORGE_VISION_KV_GROUND_LOCAL_PATH_PREFIX and SCIFORGE_VISION_KV_GROUND_REMOTE_PATH_PREFIX.',
    ].join(' '),
  };
}

async function postJsonWithTimeout(url: string, body: Record<string, unknown>, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    const parsed = text ? parseJson(text) : {};
    if (!response.ok) {
      return { ok: false as const, error: `HTTP ${response.status}: ${text.slice(0, 500)}` };
    }
    return { ok: true as const, body: isRecord(parsed) ? parsed : { value: parsed } };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timeout);
  }
}

function parseGrounderCoordinates(value: unknown): { x: number; y: number } | undefined {
  const source = isRecord(value) ? value.coordinates : value;
  if (Array.isArray(source) && source.length >= 2) {
    const x = numberConfig(source[0]);
    const y = numberConfig(source[1]);
    return x === undefined || y === undefined ? undefined : { x, y };
  }
  if (isRecord(source)) {
    const x = numberConfig(source.x);
    const y = numberConfig(source.y);
    return x === undefined || y === undefined ? undefined : { x, y };
  }
  return undefined;
}

function genericLoopPayload(params: {
  request: GatewayRequest;
  workspace: string;
  runId: string;
  tracePath: string;
  screenshotRefs: ScreenshotRef[];
  status: 'done' | 'failed-with-reason';
  failureReason: string;
  actionCount: number;
  dryRun: boolean;
  desktopPlatform: string;
  windowTarget?: TraceWindowTarget;
}): ToolPayload {
  const traceRel = workspaceRel(params.workspace, params.tracePath);
  const allRefs = params.screenshotRefs;
  const beforeRef = allRefs.find((ref) => ref.id.includes('-before-'));
  const afterRef = [...allRefs].reverse().find((ref) => ref.id.includes('-after-'));
  const isDone = params.status === 'done';
  return {
    message: isDone
      ? `vision-sense generic Computer Use loop completed ${params.actionCount} action(s). Trace: ${traceRel}.`
      : `vision-sense generic Computer Use loop stopped with failed-with-reason: ${params.failureReason}`,
    confidence: isDone ? 0.72 : 0.35,
    claimType: 'execution',
    evidenceLevel: 'runtime',
    reasoningTrace: [
      'local.vision-sense was selected and routed to the generic Computer Use loop.',
      'The runtime uses app-agnostic screenshot refs and generic mouse/keyboard action schema.',
      params.failureReason || `Executed ${params.actionCount} generic action(s).`,
      'No app-specific shortcut or AgentServer repository scan was used.',
    ].filter(Boolean).join('\n'),
    claims: [{
      text: isDone
        ? 'SciForge executed generic Computer Use actions and wrote file-ref-only visual memory.'
        : params.failureReason,
      type: isDone ? 'execution' : 'failure',
      confidence: isDone ? 0.72 : 0.35,
      evidenceLevel: 'runtime',
      supportingRefs: [traceRel],
      opposingRefs: [],
    }],
    uiManifest: [
      { componentId: 'execution-unit-table', title: 'Execution units', artifactRef: 'vision-sense-generic-execution', priority: 1 },
      { componentId: 'unknown-artifact-inspector', title: 'Vision trace', artifactRef: 'vision-sense-trace', priority: 2 },
    ],
    executionUnits: [{
      id: `EU-vision-sense-${params.runId}`,
      tool: VISION_TOOL_ID,
      status: params.status,
      params: JSON.stringify({ prompt: params.request.prompt, runId: params.runId, actionCount: params.actionCount, windowTarget: params.windowTarget }),
      hash: sha256(Buffer.from(`${params.runId}:${traceRel}:${params.status}`, 'utf8')).slice(0, 12),
      time: new Date().toISOString(),
      environment: params.dryRun
        ? `SciForge dry-run generic GUI executor (${platformLabel(params.desktopPlatform)})`
        : `${platformLabel(params.desktopPlatform)} screenshot + generic GUI executor`,
      inputData: [params.request.prompt],
      outputArtifacts: [traceRel],
      artifacts: [traceRel],
      codeRef: 'src/runtime/vision-sense-runtime.ts',
      outputRef: traceRel,
      screenshotRef: afterRef?.path,
      beforeScreenshotRef: beforeRef?.path,
      failureReason: params.failureReason || undefined,
      routeDecision: { selectedRuntime: 'vision-sense-generic-computer-use-loop', selectedToolId: VISION_TOOL_ID },
      requiredInputs: params.status === 'done' ? undefined : ['WindowTargetProvider', 'VisionPlanner', 'Grounder', 'GuiExecutor', 'Verifier'],
      recoverActions: params.status === 'done' ? undefined : [
        'Provide a generic VisionPlanner that emits the action schema recorded in the trace.',
        'Configure KV-Ground or another Grounder so target descriptions become target-window coordinates.',
        'Keep app-specific APIs out of the primary path; only mouse/keyboard executor actions should be required.',
      ],
    }],
    artifacts: [{
      id: 'vision-sense-trace',
      type: 'vision-trace',
      path: traceRel,
      dataRef: traceRel,
      producerTool: VISION_TOOL_ID,
      schemaVersion: 'sciforge.vision-trace.v1',
      metadata: {
        runId: params.runId,
        imageMemoryPolicy: 'file-ref-only',
        screenshotRefs: allRefs.map(toTraceScreenshotRef),
        windowTarget: params.windowTarget,
        noInlineImages: true,
        appSpecificShortcuts: [],
      },
    }],
  };
}

function genericBridgeBlockedPayload(
  request: GatewayRequest,
  workspace: string,
  reason: string,
  routeDecision: Record<string, unknown>,
): ToolPayload {
  const runId = sanitizeId(`generic-cu-blocked-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`);
  const expectedTrace = workspaceRel(workspace, join(workspace, '.sciforge', 'vision-runs', runId, 'vision-trace.json'));
  return {
    message: `vision-sense generic Computer Use bridge is not ready: ${reason}`,
    confidence: 0.25,
    claimType: 'fact',
    evidenceLevel: 'runtime',
    reasoningTrace: [
      'local.vision-sense was selected for a Computer Use request.',
      reason,
      `Expected generic trace shape: ${expectedTrace} with screenshot refs, generic actions, executor result, and verifier result.`,
      'No app-specific shortcut or AgentServer fallback was used.',
    ].join('\n'),
    claims: [{
      text: reason,
      type: 'failure',
      confidence: 0.25,
      evidenceLevel: 'runtime',
      supportingRefs: [VISION_TOOL_ID],
      opposingRefs: [],
    }],
    uiManifest: [
      { componentId: 'execution-unit-table', title: 'Execution units', artifactRef: 'vision-sense-generic-execution', priority: 1 },
    ],
    executionUnits: [{
      id: `EU-${runId}`,
      tool: VISION_TOOL_ID,
      status: 'failed-with-reason',
      params: JSON.stringify({ prompt: request.prompt, selectedToolIds: request.selectedToolIds }),
      hash: sha256(Buffer.from(`${runId}:${reason}`, 'utf8')).slice(0, 12),
      time: new Date().toISOString(),
      environment: 'SciForge workspace runtime gateway',
      inputData: [request.prompt],
      outputArtifacts: [],
      artifacts: [],
      failureReason: reason,
      routeDecision,
      requiredInputs: ['ScreenCaptureProvider', 'VisionPlanner', 'Grounder', 'GuiExecutor', 'Verifier'],
      recoverActions: [
        'Enable the generic desktop bridge with SCIFORGE_VISION_DESKTOP_BRIDGE=1 or .sciforge/config.json visionSense.desktopBridgeEnabled=true.',
        'Configure capture displays with SCIFORGE_VISION_CAPTURE_DISPLAYS=1,2 or visionSense.captureDisplays.',
        'Provide a planner/grounder that emits app-agnostic mouse and keyboard actions.',
      ],
      nextStep: 'Configure the generic vision loop dependencies, then rerun the same request.',
    }],
    artifacts: [],
  };
}
