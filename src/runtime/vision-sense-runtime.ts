import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

import type { GatewayRequest, ToolPayload, WorkspaceRuntimeCallbacks } from './runtime-types.js';
import { isRecord, toStringList, uniqueStrings } from './gateway-utils.js';
import { emitWorkspaceRuntimeEvent } from './workspace-runtime-events.js';
import { groundingForAction, highRiskBlockReason, normalizePlatformAction, parseGenericActions, platformActionIssue, platformLauncherGuidance, trimLeadingWaitActions } from './computer-use/actions.js';
import { captureDisplays, createFocusedCropRefs, pixelDiffForScreenshotSets, toTraceScreenshotRef, validateRuntimeTraceScreenshots } from './computer-use/capture.js';
import { executeGenericDesktopAction, executorBoundary } from './computer-use/executor.js';
import type { ComputerUseConfig as VisionSenseConfig, FocusRegion, GenericVisionAction, GroundingResolution, LoopStep, PlannerContractIssue, ScreenshotRef, TraceWindowTarget, VisionPlannerConfig } from './computer-use/types.js';
import { booleanConfig, detectCaptureDisplays, envOrValue, extractChatCompletionContent, extractJsonObject, isDarwinPlatform, numberConfig, parseDisplayList, parseJson, platformLabel, runCommand, sanitizeId, sha256, stringConfig, supportsBuiltinDesktopBridge, workspaceRel } from './computer-use/utils.js';
import { inputChannelContract, inputChannelDescription, isWindowLocalCoordinateSpace, parseWindowTarget, resolveWindowTarget, schedulerRunMetadata, schedulerStepMetadata, stepInputChannelMetadata, toTraceWindowTarget, windowTargetTraceConfig } from './computer-use/window-target.js';

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

function normalizeGrounderUploadStrategy(value: string | undefined): 'scp' | 'inline' | undefined {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'scp') return 'scp';
  if (normalized === 'inline' || normalized === 'base64') return 'inline';
  return undefined;
}

function parseCompletionPolicy(value: unknown): VisionSenseConfig['completionPolicy'] {
  if (!isRecord(value)) return undefined;
  const mode = stringConfig(value.mode, value.completionMode, value.kind);
  if (mode === 'one-successful-non-wait-action' || mode === 'planner-confirmed') {
    return {
      mode,
      reason: stringConfig(value.reason),
      fallbackActions: parseGenericActions(value.fallbackActions),
    };
  }
  return undefined;
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
  const dryRun = booleanConfig(
    requestConfig.dryRun,
    process.env.SCIFORGE_VISION_DESKTOP_BRIDGE_DRY_RUN,
    fileConfig.dryRun,
    false,
  );
  return {
    desktopBridgeEnabled: booleanConfig(
      requestConfig.desktopBridgeEnabled,
      process.env.SCIFORGE_VISION_DESKTOP_BRIDGE,
      fileConfig.desktopBridgeEnabled,
      supportsBuiltinDesktopBridge(desktopPlatform),
    ),
    dryRun,
    captureDisplays: defaultCaptureDisplays,
    desktopPlatform,
    windowTarget,
    runId: stringConfig(requestConfig.runId, process.env.SCIFORGE_VISION_RUN_ID, fileConfig.runId),
    outputDir: stringConfig(requestConfig.outputDir, process.env.SCIFORGE_VISION_OUTPUT_DIR, fileConfig.outputDir),
    maxSteps: numberConfig(requestConfig.maxSteps, process.env.SCIFORGE_VISION_MAX_STEPS, fileConfig.maxSteps) ?? 8,
    allowHighRiskActions: booleanConfig(
      process.env.SCIFORGE_VISION_ALLOW_HIGH_RISK_ACTIONS,
      requestConfig.allowHighRiskActions,
      fileConfig.allowHighRiskActions,
      false,
    ),
    executorCoordinateScale: numberConfig(process.env.SCIFORGE_VISION_EXECUTOR_COORDINATE_SCALE, requestConfig.executorCoordinateScale, fileConfig.executorCoordinateScale),
    schedulerLockTimeoutMs: numberConfig(
      requestConfig.schedulerLockTimeoutMs,
      process.env.SCIFORGE_VISION_SCHEDULER_LOCK_TIMEOUT_MS,
      fileConfig.schedulerLockTimeoutMs,
    ),
    schedulerStaleLockMs: numberConfig(
      requestConfig.schedulerStaleLockMs,
      process.env.SCIFORGE_VISION_SCHEDULER_STALE_LOCK_MS,
      fileConfig.schedulerStaleLockMs,
    ),
    inputAdapter: stringConfig(
      requestConfig.inputAdapter,
      requestConfig.independentInputAdapter,
      process.env.SCIFORGE_VISION_INPUT_ADAPTER,
      fileConfig.inputAdapter,
      fileConfig.independentInputAdapter,
    ),
    allowSharedSystemInput: booleanConfig(
      requestConfig.allowSharedSystemInput,
      process.env.SCIFORGE_VISION_ALLOW_SHARED_SYSTEM_INPUT,
      fileConfig.allowSharedSystemInput,
      false,
    ),
    showVisualCursor: booleanConfig(
      process.env.SCIFORGE_VISION_SHOW_CURSOR,
      envOrValue(requestConfig.showVisualCursor, requestConfig.visualCursor),
      envOrValue(fileConfig.showVisualCursor, fileConfig.visualCursor),
      !dryRun,
    ),
    completionPolicy: parseCompletionPolicy(envOrValue(requestConfig.completionPolicy, fileConfig.completionPolicy)),
    planner: {
      baseUrl: stringConfig(
        process.env.SCIFORGE_VISION_PLANNER_BASE_URL,
        requestConfig.plannerBaseUrl,
        fileConfig.plannerBaseUrl,
        configStringAt(fileConfig, ['llm', 'baseUrl']),
        configStringAt(fileConfig, ['llmEndpoint', 'baseUrl']),
        fileConfig.modelBaseUrl,
        request.llmEndpoint?.baseUrl,
      ),
      apiKey: stringConfig(
        process.env.SCIFORGE_VISION_PLANNER_API_KEY,
        requestConfig.plannerApiKey,
        fileConfig.plannerApiKey,
        configStringAt(fileConfig, ['llm', 'apiKey']),
        configStringAt(fileConfig, ['llmEndpoint', 'apiKey']),
        fileConfig.apiKey,
        request.llmEndpoint?.apiKey,
      ),
      model: stringConfig(
        process.env.SCIFORGE_VISION_PLANNER_MODEL,
        requestConfig.plannerModel,
        requestConfig.visionPlannerModel,
        requestConfig.vlmModel,
        requestConfig.visionModel,
        fileConfig.plannerModel,
        fileConfig.visionPlannerModel,
        fileConfig.vlmModel,
        fileConfig.visionModel,
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
      upload: {
        strategy: normalizeGrounderUploadStrategy(stringConfig(process.env.SCIFORGE_VISION_KV_GROUND_UPLOAD_STRATEGY, requestConfig.grounderUploadStrategy, fileConfig.grounderUploadStrategy)),
        host: stringConfig(process.env.SCIFORGE_VISION_KV_GROUND_UPLOAD_HOST, requestConfig.grounderUploadHost, fileConfig.grounderUploadHost),
        user: stringConfig(process.env.SCIFORGE_VISION_KV_GROUND_UPLOAD_USER, requestConfig.grounderUploadUser, fileConfig.grounderUploadUser) ?? 'root',
        port: numberConfig(process.env.SCIFORGE_VISION_KV_GROUND_UPLOAD_PORT, requestConfig.grounderUploadPort, fileConfig.grounderUploadPort) ?? 22,
        remoteDir: stringConfig(process.env.SCIFORGE_VISION_KV_GROUND_UPLOAD_REMOTE_DIR, requestConfig.grounderUploadRemoteDir, fileConfig.grounderUploadRemoteDir),
        identityFile: stringConfig(process.env.SCIFORGE_VISION_KV_GROUND_UPLOAD_IDENTITY_FILE, requestConfig.grounderUploadIdentityFile, fileConfig.grounderUploadIdentityFile),
        remoteUrlPrefix: stringConfig(process.env.SCIFORGE_VISION_KV_GROUND_UPLOAD_REMOTE_URL_PREFIX, requestConfig.grounderUploadRemoteUrlPrefix, fileConfig.grounderUploadRemoteUrlPrefix),
      },
      visionBaseUrl: stringConfig(
        process.env.SCIFORGE_VISION_GROUNDER_LLM_BASE_URL,
        requestConfig.visualGrounderBaseUrl,
        fileConfig.visualGrounderBaseUrl,
        process.env.SCIFORGE_VISION_PLANNER_BASE_URL,
        requestConfig.plannerBaseUrl,
        fileConfig.plannerBaseUrl,
        configStringAt(fileConfig, ['llm', 'baseUrl']),
        configStringAt(fileConfig, ['llmEndpoint', 'baseUrl']),
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
        configStringAt(fileConfig, ['llm', 'apiKey']),
        configStringAt(fileConfig, ['llmEndpoint', 'apiKey']),
        fileConfig.apiKey,
        request.llmEndpoint?.apiKey,
      ),
      visionModel: stringConfig(
        process.env.SCIFORGE_VISION_GROUNDER_LLM_MODEL,
        requestConfig.visualGrounderModel,
        requestConfig.grounderVisionModel,
        requestConfig.plannerModel,
        requestConfig.visionPlannerModel,
        requestConfig.vlmModel,
        requestConfig.visionModel,
        fileConfig.visualGrounderModel,
        fileConfig.grounderVisionModel,
        process.env.SCIFORGE_VISION_PLANNER_MODEL,
        fileConfig.plannerModel,
        fileConfig.visionPlannerModel,
        fileConfig.vlmModel,
        fileConfig.visionModel,
      ),
      visionTimeoutMs: numberConfig(process.env.SCIFORGE_VISION_GROUNDER_LLM_TIMEOUT_MS, requestConfig.visualGrounderTimeoutMs, fileConfig.visualGrounderTimeoutMs) ?? 60000,
      visionMaxTokens: numberConfig(process.env.SCIFORGE_VISION_GROUNDER_LLM_MAX_TOKENS, requestConfig.visualGrounderMaxTokens, fileConfig.visualGrounderMaxTokens) ?? 384,
    },
    plannedActions: parseGenericActions(envOrValue(requestConfig.actions, process.env.SCIFORGE_VISION_ACTIONS_JSON, fileConfig.actions)),
  };
}

async function readWorkspaceVisionConfig(workspace: string): Promise<Record<string, unknown>> {
  const rootConfig = await readVisionConfigFile(resolve('config.local.json'));
  const workspaceConfig = await readVisionConfigFile(join(workspace, '.sciforge', 'config.json'));
  const rootWorkspace = configStringAt(rootConfig, ['sciforge', 'workspacePath']);
  const shouldUseRootConfig = rootWorkspace ? resolve(rootWorkspace) === resolve(workspace) : resolve(workspace) === resolve('workspace');
  return shouldUseRootConfig ? { ...rootConfig, ...workspaceConfig } : workspaceConfig;
}

async function readVisionConfigFile(configPath: string): Promise<Record<string, unknown>> {
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

function configStringAt(config: Record<string, unknown>, path: string[]) {
  let cursor: unknown = config;
  for (const key of path) {
    if (!isRecord(cursor)) return undefined;
    cursor = cursor[key];
  }
  return typeof cursor === 'string' && cursor.trim() ? cursor.trim() : undefined;
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

  if (actionQueue.length && executionStatus !== 'failed-with-reason') {
    let consecutiveNoEffectNonWaitActions = 0;
    for (let index = 0; index < config.maxSteps && actionQueue.length; index += 1) {
      const originalAction = actionQueue.shift() as GenericVisionAction;
      const action = normalizePlatformAction(originalAction, config);
      const stepNumber = String(index + 1).padStart(3, '0');
      targetResolution = await resolveWindowTarget(config);
      if (!targetResolution.ok) {
        executionStatus = 'failed-with-reason';
        failureReason = targetResolution.reason;
        steps.push({
          id: `step-${stepNumber}-blocked-window-target`,
          kind: 'planning',
          status: 'blocked',
          verifier: {
            status: 'blocked',
            reason: 'target window contract could not be resolved before action execution',
            diagnostics: targetResolution.diagnostics,
            windowTarget: windowTargetTraceConfig(targetResolution.target),
            windowConsistency: windowConsistencyMetadata([], [], config),
          },
          failureReason,
        });
        break;
      }
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
          scheduler: schedulerStepMetadata(targetResolution, `step-${stepNumber}`, config),
          verifier: {
            status: 'blocked',
            reason: 'platform-incompatible Computer Use action',
            pixelDiff: pixelDiffForScreenshotSets(beforeRefs, afterRefs),
            windowConsistency: windowConsistencyMetadata(beforeRefs, afterRefs, config),
          },
          failureReason,
        });
        break;
      }
      const riskBlockReason = highRiskBlockReason(action, config);
      if (riskBlockReason) {
        const afterRefs = await captureDisplays(workspace, runDir, `step-${stepNumber}-after`, config, targetResolution);
        screenshotLedger.push(...afterRefs);
        const fallbackActions = nextPlannerActions(config.completionPolicy?.fallbackActions ?? [], config.maxSteps - index - 1);
        const continueWithFallback = fallbackActions.length > 0;
        if (!continueWithFallback) {
          executionStatus = 'failed-with-reason';
          failureReason = riskBlockReason;
        }
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
          scheduler: schedulerStepMetadata(targetResolution, `step-${stepNumber}`, config),
          verifier: {
            status: 'blocked',
            reason: 'high-risk action requires upstream confirmation',
            pixelDiff: pixelDiffForScreenshotSets(beforeRefs, afterRefs),
            windowConsistency: windowConsistencyMetadata(beforeRefs, afterRefs, config),
          },
          failureReason: continueWithFallback ? undefined : failureReason,
        });
        if (continueWithFallback) {
          actionQueue.unshift(...fallbackActions);
          continue;
        }
        break;
      }
      let groundingResolution = await resolveActionGrounding(action, beforeRefs, config);
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
          scheduler: schedulerStepMetadata(targetResolution, `step-${stepNumber}`, config),
          verifier: {
            status: 'blocked',
            reason: 'grounding did not produce executable coordinates',
            pixelDiff: pixelDiffForScreenshotSets(beforeRefs, afterRefs),
            windowConsistency: windowConsistencyMetadata(beforeRefs, afterRefs, config),
          },
          failureReason,
        });
        break;
      }
      let executableAction = groundingResolution.action;
      const focusRegion = await buildFocusRegionFromVisionSense(beforeRefs[0], groundingResolution.grounding);
      const beforeFocusRefs = focusRegion
        ? await createFocusedCropRefs(workspace, runDir, `step-${stepNumber}-before`, beforeRefs, focusRegion, config)
        : [];
      screenshotLedger.push(...beforeFocusRefs);
      if (focusRegion && beforeFocusRefs.length) {
        const refinedGrounding = await refineActionGroundingWithFocusRegion({
          action: executableAction,
          grounding: groundingResolution.grounding,
          focusRegion,
          beforeRef: beforeRefs[0],
          focusRefs: beforeFocusRefs,
          config,
        });
        if (refinedGrounding.ok) {
          groundingResolution = refinedGrounding;
          executableAction = refinedGrounding.action;
        } else if (groundingResolution.grounding) {
          groundingResolution = {
            ...groundingResolution,
            grounding: {
              ...groundingResolution.grounding,
              fineGrounding: refinedGrounding.grounding,
              fineGroundingFallback: refinedGrounding.reason,
            },
          };
        }
      }
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
      const schedulerLease = isRecord((result as { schedulerLease?: unknown }).schedulerLease) ? (result as { schedulerLease?: Record<string, unknown> }).schedulerLease : undefined;
      const afterTargetResolution = await resolveWindowTarget(config);
      const afterRefs = await captureDisplays(workspace, runDir, `step-${stepNumber}-after`, config, afterTargetResolution);
      targetResolution = afterTargetResolution;
      screenshotLedger.push(...afterRefs);
      const afterFocusRefs = focusRegion
        ? await createFocusedCropRefs(workspace, runDir, `step-${stepNumber}-after`, afterRefs, focusRegion, config)
        : [];
      screenshotLedger.push(...afterFocusRefs);
      const ok = result.exitCode === 0;
      const verifierPixelDiff = pixelDiffForScreenshotSets(beforeRefs, afterRefs);
      const focusPixelDiff = beforeFocusRefs.length && afterFocusRefs.length
        ? pixelDiffForScreenshotSets(beforeFocusRefs, afterFocusRefs)
        : undefined;
      const noVisibleEffect = !config.dryRun && ok && executableAction.type !== 'wait' && verifierPixelDiff.possiblyNoEffect === true;
      const windowConsistency = windowConsistencyMetadata(beforeRefs, afterRefs, config);
      const visualFocus = focusRegion ? {
        strategy: 'coarse-to-fine-focus-region',
        algorithmProvider: 'sciforge_vision_sense.coarse_to_fine',
        region: focusRegion,
        beforeFocusScreenshotRefs: beforeFocusRefs.map(toTraceScreenshotRef),
        afterFocusScreenshotRefs: afterFocusRefs.map(toTraceScreenshotRef),
        pixelDiff: focusPixelDiff,
        fineGrounding: isRecord(groundingResolution.grounding?.fineGrounding) ? groundingResolution.grounding.fineGrounding : undefined,
      } : undefined;
      if (!ok) {
        executionStatus = 'failed-with-reason';
        failureReason = result.stderr || result.stdout || `Generic action ${action.type} failed with exit ${result.exitCode}`;
      }
      const planningFeedback = await buildVerifierPlanningFeedbackFromVisionSense({
        action: executableAction,
        status: ok ? 'done' : 'failed',
        grounding: groundingResolution.grounding ?? groundingForAction(executableAction),
        pixelDiff: verifierPixelDiff,
        windowConsistency,
        visualFocus,
        failureReason: ok ? undefined : failureReason,
      });
      const regionSemantic = await buildRegionSemanticVerifierFromVisionSense({
        action: executableAction,
        status: ok ? 'done' : 'failed',
        grounding: groundingResolution.grounding ?? groundingForAction(executableAction),
        pixelDiff: verifierPixelDiff,
        focusPixelDiff,
        visualFocus,
        failureReason: ok ? undefined : failureReason,
      });
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
        visualFocus,
        execution: {
          executor: config.dryRun ? 'dry-run-generic-gui-executor' : executorBoundary(config),
          inputChannel: inputChannelDescription(config, targetResolution),
          windowTarget: targetResolution.ok ? toTraceWindowTarget(targetResolution) : undefined,
          status: ok ? 'done' : 'failed',
          exitCode: result.exitCode,
          stdout: result.stdout.trim() || undefined,
          stderr: result.stderr.trim() || undefined,
        },
        scheduler: {
          ...schedulerStepMetadata(targetResolution, `step-${stepNumber}`, config),
          executorLease: schedulerLease,
        },
        verifier: {
          status: ok ? 'checked' : 'skipped-after-execution-failure',
          method: 'window-pixel-diff',
          pixelDiff: verifierPixelDiff,
          focusRegionPixelDiff: focusPixelDiff,
          windowConsistency,
          regionSemantic,
          planningFeedback,
        },
        failureReason: ok ? undefined : failureReason,
      });
      if (!ok) break;
      if (executableAction.type !== 'wait') {
        consecutiveNoEffectNonWaitActions = noVisibleEffect ? consecutiveNoEffectNonWaitActions + 1 : 0;
        if (consecutiveNoEffectNonWaitActions >= 3) {
          executionStatus = 'failed-with-reason';
          failureReason = `Generic Computer Use loop stopped after ${consecutiveNoEffectNonWaitActions} consecutive non-wait actions produced no visible window effect. Replan away from the repeated target or improve grounding.`;
          const lastStep = steps[steps.length - 1];
          lastStep.verifier = {
            ...(lastStep.verifier ?? {}),
            status: 'blocked',
            reason: failureReason,
          };
          lastStep.failureReason = failureReason;
          break;
        }
      }
      if (config.completionPolicy?.mode === 'one-successful-non-wait-action' && executableAction.type !== 'wait') {
        plannerReportedDone = true;
        break;
      }
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
        actionQueue.push(...nextPlannerActions(planned.actions, config.maxSteps - index - 1));
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
      schedulerLockTimeoutMs: config.schedulerLockTimeoutMs,
      schedulerStaleLockMs: config.schedulerStaleLockMs,
      inputAdapter: config.inputAdapter,
      allowSharedSystemInput: config.allowSharedSystemInput,
      showVisualCursor: config.showVisualCursor,
      completionPolicy: config.completionPolicy,
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
      inputChannelContract: inputChannelContract(config, targetResolution),
      coordinateContract: {
        planner: 'target descriptions only',
        grounderOutput: 'target-window screenshot coordinates',
        executorInput: targetResolution.ok ? targetResolution.coordinateSpace : config.windowTarget.coordinateSpace,
        localCoordinateFrame: 'window screenshot pixels before executor mapping',
        mappedCoordinateFrame: 'desktop executor coordinates after window-origin and scale mapping',
      },
      verifierContract: {
        screenshotScope: 'target-window',
        beforeAfterWindowConsistency: 'required-or-structured-window-lifecycle-diagnostics',
        completionEvidence: 'window-local screenshots plus pixel diff, no DOM/accessibility',
      },
      inputIsolation: targetResolution.ok ? targetResolution.inputIsolation : config.windowTarget.inputIsolation,
      requires: ['WindowTargetProvider', 'VisionPlanner', 'Grounder', 'GuiExecutor', 'Verifier'],
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

async function appendPlannerStep(params: {
  id: string;
  task: string;
  screenshotRefs: ScreenshotRef[];
  steps: LoopStep[];
  config: VisionSenseConfig;
}) {
  const plannerStepTimeoutMs = Math.max(
    params.config.planner.timeoutMs + 10_000,
    params.config.planner.timeoutMs * 2 + 5_000,
  );
  const plannerResult = await withHardTimeout(
    planGenericActionsFromScreenshot(params.task, params.screenshotRefs[0], params.config, plannerRunHistory(params.steps)),
    plannerStepTimeoutMs,
    `VisionPlanner step timed out after ${plannerStepTimeoutMs}ms`,
  ).catch((error) => ({
    ok: false as const,
    actions: [],
    done: false as const,
    reason: error instanceof Error ? error.message : String(error),
    rawResponse: undefined,
  }));
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
          localX: action.x,
          localY: action.y,
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
    const coarseDescription = action.targetRegionDescription || action.targetDescription;
    const grounded = await groundTargetDescription(coarseDescription, beforeRefs, config);
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
        coarseTargetDescription: coarseDescription,
        targetRegionDescription: action.targetRegionDescription,
        targetDescription: action.targetDescription,
        screenshotX: grounded.x,
        screenshotY: grounded.y,
        localX: grounded.x,
        localY: grounded.y,
        executorX: executorPoint.x,
        executorY: executorPoint.y,
        executorCoordinateScale: executorPoint.scale,
        coordinateSpace: executorPoint.coordinateSpace,
        windowTarget: beforeRefs[0]?.windowTarget,
      },
    };
  }

  if (action.type === 'wait' && (action.targetRegionDescription || action.targetDescription)) {
    const targetDescription = (action.targetRegionDescription || action.targetDescription) as string;
    const grounded = await groundTargetDescription(targetDescription, beforeRefs, config);
    if (!grounded.ok) {
      return {
        ok: false,
        action,
        grounding: grounded.grounding,
        reason: grounded.reason,
      };
    }
    return {
      ok: true,
      action,
      grounding: {
        ...grounded.grounding,
        observationOnly: true,
        targetRegionDescription: action.targetRegionDescription,
        targetDescription: action.targetDescription,
        screenshotX: grounded.x,
        screenshotY: grounded.y,
        localX: grounded.x,
        localY: grounded.y,
        coordinateSpace: beforeRefs[0]?.windowTarget?.coordinateSpace ?? config.windowTarget.coordinateSpace,
        windowTarget: beforeRefs[0]?.windowTarget,
      },
    };
  }

  if (action.type === 'drag') {
    const hasEndpoints = [action.fromX, action.fromY, action.toX, action.toY].every((value) => typeof value === 'number');
    if (hasEndpoints) {
      const dragDistance = Math.hypot((action.toX as number) - (action.fromX as number), (action.toY as number) - (action.fromY as number));
      if (dragDistance < 24) {
        return {
          ok: false,
          action,
          grounding: { ...groundingForAction(action), status: 'failed', reason: 'drag endpoints too close to create a meaningful visible drag', dragDistance },
          reason: `Generic drag action endpoints are too close (${dragDistance.toFixed(1)}px). Use distinct visible start/end targets or choose a non-drag action.`,
        };
      }
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
          localFromX: action.fromX,
          localFromY: action.fromY,
          localToX: action.toX,
          localToY: action.toY,
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
    const dragDistance = Math.hypot(to.x - from.x, to.y - from.y);
    if (dragDistance < 24) {
      return {
        ok: false,
        action,
        grounding: {
          status: 'failed',
          reason: 'drag endpoints too close to create a meaningful visible drag',
          dragDistance,
          from: from.grounding,
          to: to.grounding,
          targetDescription: action.targetDescription,
        },
        reason: `Generic drag action grounded endpoints are too close (${dragDistance.toFixed(1)}px). Use distinct visible start/end targets or choose a non-drag action.`,
      };
    }
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
        localFromX: from.x,
        localFromY: from.y,
        localToX: to.x,
        localToY: to.y,
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
  const screenshotWidth = screenshot?.width;
  const screenshotHeight = screenshot?.height;
  if (bounds && screenshotWidth && screenshotHeight) {
    const expectedContentWidth = bounds.width * scale;
    const expectedContentHeight = bounds.height * scale;
    const shadowPaddingX = screenshotWidth > expectedContentWidth ? (screenshotWidth - expectedContentWidth) / 2 : 0;
    const shadowPaddingY = screenshotHeight > expectedContentHeight ? (screenshotHeight - expectedContentHeight) / 2 : 0;
    const contentImageWidth = Math.max(1, screenshotWidth - shadowPaddingX * 2);
    const contentImageHeight = Math.max(1, screenshotHeight - shadowPaddingY * 2);
    const localX = Math.max(0, Math.min(contentImageWidth, x - shadowPaddingX));
    const localY = Math.max(0, Math.min(contentImageHeight, y - shadowPaddingY));
    const mappedX = bounds.x + (localX / contentImageWidth) * bounds.width;
    const mappedY = bounds.y + (localY / contentImageHeight) * bounds.height;
    return {
      x: mappedX,
      y: mappedY,
      scale,
      screenshotToWindowScaleX: bounds.width / contentImageWidth,
      screenshotToWindowScaleY: bounds.height / contentImageHeight,
      shadowPaddingX,
      shadowPaddingY,
      coordinateSpace: screenshot?.windowTarget?.coordinateSpace ?? config.windowTarget.coordinateSpace,
    };
  }
  return {
    x: (x + (bounds?.x ?? 0)) / scale,
    y: (y + (bounds?.y ?? 0)) / scale,
    scale,
    coordinateSpace: screenshot?.windowTarget?.coordinateSpace ?? config.windowTarget.coordinateSpace,
  };
}

function windowConsistencyMetadata(beforeRefs: ScreenshotRef[], afterRefs: ScreenshotRef[], config: VisionSenseConfig) {
  const before = beforeRefs[0];
  const after = afterRefs[0];
  const beforeTarget = before?.windowTarget;
  const afterTarget = after?.windowTarget;
  const beforeIdentity = windowIdentity(beforeTarget);
  const afterIdentity = windowIdentity(afterTarget);
  const sameWindow = Boolean(beforeIdentity && afterIdentity && beforeIdentity === afterIdentity);
  const targetScope = config.windowTarget.enabled && config.windowTarget.mode !== 'display' ? 'window' : 'display';
  const scopeOk = targetScope === 'display'
    ? true
    : beforeRefs.every((ref) => ref.captureScope === 'window') && afterRefs.every((ref) => ref.captureScope === 'window');
  const lifecycle = [beforeTarget, afterTarget].filter(Boolean).map((target) => ({
    identity: windowIdentity(target),
    focused: target?.focused,
    minimized: target?.minimized,
    occluded: target?.occluded,
    bounds: target?.bounds,
    contentRect: target?.contentRect,
    displayId: target?.displayId,
    captureTimestamp: target?.captureTimestamp,
  }));
  return {
    status: scopeOk && (targetScope === 'display' || sameWindow) ? 'same-target-window' : 'window-lifecycle-changed-or-unverified',
    requiredScope: targetScope,
    beforeWindowIdentity: beforeIdentity,
    afterWindowIdentity: afterIdentity,
    sameWindow,
    scopeOk,
    beforeScreenshotRefs: beforeRefs.map((ref) => ref.path),
    afterScreenshotRefs: afterRefs.map((ref) => ref.path),
    lifecycle,
    recoveryPolicy: 'if identity/bounds/display/focus changes, re-resolve WindowTarget and re-capture before planning the next action',
  };
}

function windowLifecycleTrace(target: TraceWindowTarget, refs: ScreenshotRef[]) {
  const windowRefs = refs.filter((ref) => ref.captureScope === 'window' || ref.windowTarget?.captureKind === 'window');
  const identities = uniqueStrings(windowRefs.map((ref) => windowIdentity(ref.windowTarget)).filter((value): value is string => Boolean(value)));
  const displayIds = uniqueStrings(windowRefs.map((ref) => String(ref.displayId)).filter(Boolean));
  const lifecycleSamples = windowRefs.slice(-5).map((ref) => ({
    screenshotRef: ref.path,
    identity: windowIdentity(ref.windowTarget),
    displayId: ref.displayId,
    bounds: ref.windowTarget?.bounds,
    contentRect: ref.windowTarget?.contentRect,
    focused: ref.windowTarget?.focused,
    minimized: ref.windowTarget?.minimized,
    occluded: ref.windowTarget?.occluded,
    captureTimestamp: ref.captureTimestamp ?? ref.windowTarget?.captureTimestamp,
  }));
  return {
    targetIdentity: windowIdentity(target),
    observedIdentities: identities,
    observedDisplayIds: displayIds,
    sampleCount: windowRefs.length,
    status: identities.length <= 1 ? 'stable-or-single-window' : 'window-migrated-or-recovered',
    recoveryPolicy: 're-resolve target window by id/app/title when displayId, bounds, focus, minimized, or occlusion state changes',
    samples: lifecycleSamples,
  };
}

function windowIdentity(target: TraceWindowTarget | undefined) {
  if (!target) return undefined;
  return [
    target.windowId ?? target.title ?? target.appName ?? target.bundleId ?? 'unknown-window',
    target.bundleId ?? target.appName ?? 'unknown-app',
  ].join(':');
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
  runHistory?: string,
): Promise<{ ok: true; actions: GenericVisionAction[]; done: boolean; reason?: string; rawResponse: unknown } | { ok: false; actions: []; done: false; reason: string; rawResponse?: unknown }> {
  if (!screenshot) return { ok: false, actions: [], done: false, reason: 'VisionPlanner could not run because no screenshot was captured.' };
  const modelIssue = visionModelIssue(config.planner.model);
  if (modelIssue) return { ok: false, actions: [], done: false, reason: `VisionPlanner model is not configured as a VLM: ${modelIssue}` };
  const firstAttempt = await requestGenericPlannerActions(task, screenshot, config, undefined, runHistory);
  if (!firstAttempt.ok && firstAttempt.retryableContractViolation) {
    const retry = await requestGenericPlannerActions(
      task,
      screenshot,
      config,
      plannerRetryInstruction(firstAttempt.contractIssue, config),
      runHistory,
    );
    return retry.ok ? retry : firstAttempt;
  }
  if (!firstAttempt.ok) return firstAttempt;
  if (!firstAttempt.done && (firstAttempt.actions.length === 0 || firstAttempt.actions.every((action) => action.type === 'wait'))) {
    const retry = await requestGenericPlannerActions(
      task,
      screenshot,
      config,
      `The current screenshot has already been captured. Do not return an empty action list or wait as the only action unless done=true. For an underspecified GUI sub-task, choose a conservative non-destructive screen action from the current screenshot, such as scroll on the main visible content, press Escape to dismiss transient overlays, ${platformRecoveryGuidance(config)}, or click a clearly described visible low-risk target. Return at least one non-wait action: click, double_click, drag, type_text, press_key, hotkey, or scroll; or set done=true with actions=[] if the task is complete.`,
      runHistory,
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

function plannerRunHistory(steps: LoopStep[]) {
  const executed = steps
    .filter((step) => step.kind === 'gui-execution')
    .map((step, index) => {
      const action: Record<string, unknown> = isRecord(step.plannedAction) ? step.plannedAction : {};
      const type = typeof action.type === 'string' ? action.type : 'unknown';
      const target = typeof action.targetDescription === 'string' ? ` target="${action.targetDescription}"` : '';
      const key = typeof action.key === 'string' ? ` key="${action.key}"` : '';
      const direction = typeof action.direction === 'string' ? ` direction="${action.direction}"` : '';
      const status = typeof step.status === 'string' ? step.status : 'unknown';
      const verifier = isRecord(step.verifier) && typeof step.verifier.status === 'string' ? step.verifier.status : 'unknown';
      const pixelDiff = isRecord(step.verifier?.pixelDiff) ? step.verifier.pixelDiff : undefined;
      const noVisibleEffect = pixelDiff?.possiblyNoEffect === true ? ' no-visible-effect=true' : '';
      const feedback = verifierFeedbackForRunHistory(step);
      const focus = isRecord(step.visualFocus) && isRecord(step.visualFocus.region)
        ? ` focusRegion=${JSON.stringify(step.visualFocus.region)}`
        : '';
      const ribbonTarget = typeof action.targetDescription === 'string' && /ribbon|toolbar|menu bar|菜单栏|功能区|选项卡|tab|button|按钮/i.test(action.targetDescription)
        ? ' target-region=toolbar-or-ribbon'
        : '';
      return `${index + 1}. ${type}${key}${direction}${target}${ribbonTarget}${focus} -> status=${status}, verifier=${verifier}${noVisibleEffect}${feedback ? `; verifierFeedback=${feedback}` : ''}`;
    });
  if (!executed.length) {
    return [
      'No GUI actions have executed yet in this run.',
      'Use the current screenshot to choose the first generic action, or report done=true only if no GUI action is needed.',
    ].join('\n');
  }
  return [
    'Already executed generic GUI actions in this run:',
    ...executed,
    'Do not repeat the same action sequence unless the current screenshot clearly shows the prior action failed.',
    'For one-shot recovery/observation tasks, a completed non-wait action with verifier evidence is usually sufficient; return done=true with actions=[] when satisfied.',
  ].join('\n');
}

function verifierFeedbackForRunHistory(step: LoopStep) {
  const verifier = isRecord(step.verifier) ? step.verifier : {};
  const explicit = typeof verifier.planningFeedback === 'string' ? verifier.planningFeedback.trim() : '';
  if (explicit) return explicit;
  return '';
}

async function buildFocusRegionFromVisionSense(screenshot: ScreenshotRef | undefined, grounding: Record<string, unknown> | undefined): Promise<FocusRegion | undefined> {
  if (!screenshot || !grounding) return undefined;
  const result = await visionSenseCoarseToFineRequest({
    mode: 'focus-region',
    sourceRef: toTraceScreenshotRef(screenshot),
    grounding,
  });
  return isRecord(result) ? result as unknown as FocusRegion : undefined;
}

async function buildVerifierPlanningFeedbackFromVisionSense(params: {
  action: GenericVisionAction;
  status: 'done' | 'failed' | 'blocked';
  grounding?: Record<string, unknown>;
  pixelDiff?: Record<string, unknown>;
  windowConsistency?: Record<string, unknown>;
  visualFocus?: Record<string, unknown>;
  failureReason?: string;
}) {
  const result = await visionSenseCoarseToFineRequest({
    mode: 'verifier-feedback',
    action: params.action,
    status: params.status,
    grounding: params.grounding,
    pixelDiff: params.pixelDiff,
    windowConsistency: params.windowConsistency,
    visualFocus: params.visualFocus,
    failureReason: params.failureReason,
  });
  return typeof result === 'string' ? result : '';
}

async function buildRegionSemanticVerifierFromVisionSense(params: {
  action: GenericVisionAction;
  status: 'done' | 'failed' | 'blocked';
  grounding?: Record<string, unknown>;
  pixelDiff?: Record<string, unknown>;
  focusPixelDiff?: Record<string, unknown>;
  visualFocus?: Record<string, unknown>;
  failureReason?: string;
}) {
  const result = await visionSenseCoarseToFineRequest({
    mode: 'region-semantic-verifier',
    action: params.action,
    status: params.status,
    grounding: params.grounding,
    pixelDiff: params.pixelDiff,
    focusPixelDiff: params.focusPixelDiff,
    visualFocus: params.visualFocus,
    failureReason: params.failureReason,
  });
  return isRecord(result) ? result : undefined;
}

async function refineActionGroundingWithFocusRegion(params: {
  action: GenericVisionAction;
  grounding?: Record<string, unknown>;
  focusRegion: FocusRegion;
  beforeRef: ScreenshotRef | undefined;
  focusRefs: ScreenshotRef[];
  config: VisionSenseConfig;
}): Promise<GroundingResolution> {
  const { action, grounding, focusRegion, beforeRef, focusRefs, config } = params;
  const focusRef = focusRefs[0];
  const fineTargetDescription = action.targetDescription || action.targetRegionDescription;
  if (!focusRef || !beforeRef || !fineTargetDescription) {
    return { ok: true, action, grounding };
  }
  if (action.type !== 'click' && action.type !== 'double_click' && action.type !== 'wait') {
    return { ok: true, action, grounding };
  }
  const fine = await groundTargetDescription(fineTargetDescription, focusRefs, config);
  if (!fine.ok) {
    return {
      ok: false,
      action,
      grounding: {
        status: 'failed',
        provider: 'coarse-to-fine-focus-region',
        stage: 'fine',
        targetDescription: fineTargetDescription,
        focusRegion,
        focusScreenshotRef: focusRef.path,
        coarseGrounding: grounding,
        reason: fine.reason,
        fineGrounding: fine.grounding,
      },
      reason: fine.reason,
    };
  }
  const localX = focusRegion.x + fine.x;
  const localY = focusRegion.y + fine.y;
  const executorPoint = screenshotToExecutorPoint(localX, localY, beforeRef, config);
  const fineGrounding = {
    ...fine.grounding,
    status: 'ok',
    provider: `${String(fine.grounding.provider || 'grounder')}-focus-region`,
    stage: 'fine',
    targetDescription: fineTargetDescription,
    focusScreenshotRef: focusRef.path,
    focusRegion,
    cropLocalX: fine.x,
    cropLocalY: fine.y,
    windowLocalX: localX,
    windowLocalY: localY,
  };
  const mergedGrounding = {
    ...(grounding ?? {}),
    status: 'ok',
    provider: 'coarse-to-fine',
    coarseGrounding: grounding,
    fineGrounding,
    targetDescription: action.targetDescription,
    targetRegionDescription: action.targetRegionDescription,
    screenshotX: localX,
    screenshotY: localY,
    localX,
    localY,
    executorX: executorPoint.x,
    executorY: executorPoint.y,
    executorCoordinateScale: executorPoint.scale,
    coordinateSpace: executorPoint.coordinateSpace,
    windowTarget: beforeRef.windowTarget,
  };
  if (action.type === 'wait') {
    return {
      ok: true,
      action,
      grounding: {
        ...mergedGrounding,
        observationOnly: true,
      },
    };
  }
  return {
    ok: true,
    action: { ...action, x: executorPoint.x, y: executorPoint.y },
    grounding: mergedGrounding,
  };
}

async function visionSenseCoarseToFineRequest(request: Record<string, unknown>) {
  const python = process.env.SCIFORGE_VISION_SENSE_PYTHON || 'python3';
  const code = [
    'import sys',
    `sys.path.insert(0, ${JSON.stringify(resolve('packages/senses/vision-sense'))})`,
    'from sciforge_vision_sense.coarse_to_fine import main',
    'raise SystemExit(main([sys.argv[1]]))',
  ].join('; ');
  const result = await runCommand(python, ['-c', code, JSON.stringify(request)], { timeoutMs: 10000 });
  if (result.exitCode !== 0) return undefined;
  const parsed = parseJson(result.stdout.trim());
  if (!isRecord(parsed) || parsed.ok !== true) return undefined;
  return parsed.result;
}

function nextPlannerActions(actions: GenericVisionAction[], remainingBudget: number) {
  if (remainingBudget <= 0) return [];
  const firstNonWait = actions.findIndex((action) => action.type !== 'wait');
  const firstIndex = firstNonWait >= 0 ? firstNonWait : 0;
  const next = actions.slice(firstIndex, firstIndex + 1);
  const following = actions[firstIndex + 1];
  if (following?.type === 'wait' && remainingBudget > 1) next.push(following);
  return next;
}

async function requestGenericPlannerActions(
  task: string,
  screenshot: ScreenshotRef,
  config: VisionSenseConfig,
  extraInstruction?: string,
  runHistory?: string,
): Promise<{ ok: true; actions: GenericVisionAction[]; done: boolean; reason?: string; rawResponse: unknown } | { ok: false; actions: []; done: false; reason: string; rawResponse?: unknown; retryableContractViolation?: boolean; contractIssue?: PlannerContractIssue }> {
  const imageBytes = await readFile(screenshot.absPath);
  const imageBase64 = imageBytes.toString('base64');
  const appGuidance = await detectedApplicationGuidance(config);
  const response = await postOpenAiChatCompletion(config.planner, [
    {
      role: 'system',
      content: [
        'You are SciForge VisionPlanner for generic Computer Use.',
        'Return only JSON. Do not read DOM or accessibility. Do not output application-private APIs, scripts, selectors, files, or shortcuts that depend on one app.',
        `Execution environment: ${plannerEnvironmentDescription(config)}.`,
        `Window target contract: ${plannerWindowTargetDescription(config)}.`,
        `Current captured target: ${plannerCapturedTargetDescription(screenshot)}.`,
        appGuidance,
        `Use only keys and modifiers supported by desktopPlatform="${config.desktopPlatform}". Do not use keys from another operating system family.`,
        platformRecoveryGuidance(config),
        'When an app must be opened, prefer open_app with appName. Only open or switch apps when the task explicitly asks to launch/open/switch applications; for current-screen/current-window tasks, operate within the supplied target window.',
        'For browser-hosted target windows, the target application content area excludes browser chrome: tab strip, address bar, bookmarks bar, toolbar buttons, extension buttons, and extension popups. Do not target browser chrome unless the task explicitly asks for browser chrome.',
        'If an unrelated browser extension, permission, save, login, or external-service dialog appears, use Escape or a visible Cancel/Close button once, then return to the target application content. Do not click Retry, Enable, Authorize, Save, Submit, Send, Delete, or Login in unrelated dialogs.',
        'If the supplied screenshot is a transient menu, popover, palette, gallery, or dropdown window, interact only with visible items inside that transient window. If the next needed target is in the underlying document/app window and is not visible in the captured target, use press_key Escape or a visible close/cancel control to dismiss the transient window first.',
        'For visual targets, output targetDescription text only; never output x/y/fromX/fromY/toX/toY coordinates. Coordinates are produced by the Grounder in the target-window screenshot coordinate system.',
        'For dense UI, small icons, table rows, menus, dialogs, or ambiguous regions, include targetRegionDescription to name the larger visual region to inspect first; the runtime will crop that region and run a second fine Grounder inside it before execution.',
        'You may output wait with targetRegionDescription when the next step should be local observation only; the runtime will record focusRegion evidence and replan from the updated run history.',
        'Do not put pixel boxes in focusRegion unless it was copied from prior run history; prefer targetRegionDescription text so vision-sense can choose and clip the focus region.',
        'Allowed action types: open_app, click, double_click, drag, type_text, press_key, hotkey, scroll, wait.',
        'Return {"done": boolean, "reason": string, "actions": [...]}. Set done=true only when the supplied screenshot shows the requested GUI task is complete; otherwise return exactly one next generic action. Include a short wait after that action only when the GUI needs time to settle.',
        'Use the run history to avoid repeating completed actions. If the task is a low-risk recovery/observation task and at least one requested non-wait action has already executed with verifier evidence, set done=true with actions=[] unless the screenshot clearly shows another required unfinished step.',
        'If run history marks a click or double_click target as no-visible-effect=true and the current screenshot is unchanged, do not repeat the same mouse action on the same target. Choose a different visible generic GUI route or a different generic input modality that the screenshot supports.',
        'For text-entry tasks, clicking a visible text field, text box, or placeholder may have no visible pixel change. After one such click, if the requested text is known from the task and the screenshot still shows the target field, use type_text next instead of repeatedly clicking.',
        'If the current screenshot already contains an appropriate text placeholder for requested literal text, prefer activating that placeholder and type_text. Do not detour into toolbar/ribbon insertion controls just to create another text box unless no usable placeholder is visible.',
        'For slide or document layout tasks, visible title/subtitle/body placeholders are valid text boxes and can satisfy text-box requirements. Prefer filling existing placeholders with structured text before using toolbar/ribbon controls for new objects.',
        'If run history shows toolbar-or-ribbon actions with no-visible-effect=true, avoid toolbar/ribbon/menu controls in the next action. Work with the visible document/canvas content instead, or report done=true if the visible state already satisfies the task.',
        'The supplied screenshot is the observation state. Do not use wait as the only action to request another observation.',
        'High-risk send/delete/pay/authorize/publish/submit actions must be marked riskLevel="high" and requiresConfirmation=true.',
        extraInstruction,
      ].join(' '),
    },
    {
      role: 'user',
      content: [
        { type: 'text', text: `Task: ${task}\n${runHistory ? `Run history:\n${runHistory}\n` : ''}Return {"done":false,"reason":"...","actions":[one generic next action]} or {"done":true,"reason":"...","actions":[]} when the current screenshot plus run history show the task is complete. Stop before final high-risk actions unless explicitly confirmed by upstream.` },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${imageBase64}` } },
      ],
    },
  ]);
  if (!response.ok) return { ok: false, actions: [], done: false, reason: `VisionPlanner request failed: ${response.error}` };
  const content = extractChatCompletionContent(response.body);
  if (!content) {
    return {
      ok: false,
      actions: [],
      done: false,
      reason: 'VisionPlanner response did not include message content.',
      rawResponse: response.body,
      retryableContractViolation: true,
      contractIssue: 'empty-message-content',
    };
  }
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
  const actions = parseGenericActions(rawActions).map((action) => normalizePlatformAction(action, config));
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
  if (issue === 'empty-message-content') {
    return 'Your previous response had empty final message content. Return only the JSON object in final message content now; do not put the action plan only in reasoning_content, analysis, prose, markdown, or tool calls.';
  }
  return 'Your previous JSON violated the planner contract by including screen coordinates. Rewrite the plan without x/y/fromX/fromY/toX/toY. Use targetDescription, fromTargetDescription, and toTargetDescription so the Grounder can produce coordinates.';
}

function plannerEnvironmentDescription(config: VisionSenseConfig) {
  return `${platformLabel(config.desktopPlatform)} desktop controlled by screenshots plus generic mouse/keyboard events`;
}

function platformRecoveryGuidance(config: VisionSenseConfig) {
  if (isDarwinPlatform(config.desktopPlatform)) {
    return 'use Command+Tab for app/window recovery on macOS; treat task text that says Alt+Tab as the cross-platform intent for Command+Tab on darwin';
  }
  return 'use the platform-native app/window switch hotkey only when the task explicitly asks to switch/recover windows';
}

async function detectedApplicationGuidance(config: VisionSenseConfig) {
  if (!isDarwinPlatform(config.desktopPlatform)) return '';
  const candidates = [
    { name: 'Microsoft Word', paths: ['/Applications/Microsoft Word.app'] },
    { name: 'Microsoft PowerPoint', paths: ['/Applications/Microsoft PowerPoint.app'] },
    { name: 'Microsoft Excel', paths: ['/Applications/Microsoft Excel.app'] },
    { name: 'Keynote', paths: ['/Applications/Keynote.app', '/System/Applications/Keynote.app'] },
    { name: 'Pages', paths: ['/Applications/Pages.app', '/System/Applications/Pages.app'] },
    { name: 'TextEdit', paths: ['/System/Applications/TextEdit.app', '/Applications/TextEdit.app'] },
    { name: 'Finder', paths: ['/System/Library/CoreServices/Finder.app'] },
  ];
  const installed: string[] = [];
  const missing: string[] = [];
  for (const candidate of candidates) {
    if (await anyPathExists(candidate.paths)) {
      installed.push(candidate.name);
    } else {
      missing.push(candidate.name);
    }
  }
  return [
    `Detected installed GUI applications for this run: ${installed.length ? installed.join(', ') : 'unknown'}.`,
    missing.length ? `Do not choose these application names unless they are visibly present or explicitly opened by the user: ${missing.join(', ')}.` : '',
  ].filter(Boolean).join(' ');
}

async function anyPathExists(paths: string[]) {
  for (const path of paths) {
    try {
      const info = await stat(path);
      if (info.isDirectory()) return true;
    } catch {
      // Missing applications are expected on developer machines.
    }
  }
  return false;
}

function visionModelIssue(model: string | undefined) {
  if (!model) return 'set visionSense.plannerModel/SCIFORGE_VISION_PLANNER_MODEL or visionSense.visualGrounderModel/SCIFORGE_VISION_GROUNDER_LLM_MODEL to a vision-capable model such as qwen3.6-plus';
  const normalized = model.trim().toLowerCase();
  if (/deepseek[-_/]?v?4|deepseek[-_/]?v?3|deepseek[-_/]?r1/.test(normalized) && !/vision|vl|qwen-vl/.test(normalized)) {
    return `model "${model}" appears to be text-only; use a vision-capable model such as qwen3.6-plus for screenshot inputs`;
  }
  return '';
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

function plannerCapturedTargetDescription(screenshot: ScreenshotRef | undefined) {
  const target = screenshot?.windowTarget;
  if (!target) return 'no screenshot target metadata';
  return [
    target.title ? `title=${JSON.stringify(target.title)}` : '',
    target.appName ? `app=${JSON.stringify(target.appName)}` : '',
    target.bundleId ? `bundle=${JSON.stringify(target.bundleId)}` : '',
    target.captureKind ? `captureKind=${target.captureKind}` : '',
    target.bounds ? `bounds=${target.bounds.width}x${target.bounds.height}` : '',
    target.focused === true ? 'focused=true' : target.focused === false ? 'focused=false' : '',
  ].filter(Boolean).join(' ') || 'target metadata present';
}

function localCoordinateMetadata(grounding: Record<string, unknown> | undefined, action: GenericVisionAction, screenshot: ScreenshotRef | undefined) {
  const space = isWindowLocalCoordinateSpace(screenshot?.windowTarget?.coordinateSpace) ? 'window' : 'screen';
  if (action.type === 'click' || action.type === 'double_click') {
    const x = numberConfig(grounding?.screenshotX, grounding?.localX, action.x);
    const y = numberConfig(grounding?.screenshotY, grounding?.localY, action.y);
    return {
      space,
      coordinateSpace: screenshot?.windowTarget?.coordinateSpace ?? space,
      x,
      y,
      localX: x,
      localY: y,
      screenshotRef: screenshot?.path,
    };
  }
  if (action.type === 'drag') {
    const fromX = numberConfig(grounding?.screenshotFromX, grounding?.localFromX, action.fromX);
    const fromY = numberConfig(grounding?.screenshotFromY, grounding?.localFromY, action.fromY);
    const toX = numberConfig(grounding?.screenshotToX, grounding?.localToX, action.toX);
    const toY = numberConfig(grounding?.screenshotToY, grounding?.localToY, action.toY);
    return {
      space,
      coordinateSpace: screenshot?.windowTarget?.coordinateSpace ?? space,
      fromX,
      fromY,
      toX,
      toY,
      localFromX: fromX,
      localFromY: fromY,
      localToX: toX,
      localToY: toY,
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
  try {
    const response = await withHardTimeout(fetch(url, {
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
    }), planner.timeoutMs, `OpenAI-compatible chat completion timed out after ${planner.timeoutMs}ms`, () => controller.abort());
    const text = await withHardTimeout(
      response.text(),
      planner.timeoutMs,
      `OpenAI-compatible chat completion body timed out after ${planner.timeoutMs}ms`,
      () => controller.abort(),
    );
    const parsed = text ? parseJson(text) : {};
    if (!response.ok) return { ok: false as const, error: `HTTP ${response.status}: ${text.slice(0, 500)}` };
    return { ok: true as const, body: isRecord(parsed) ? parsed : { value: parsed } };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
  }
}

async function withHardTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string, onTimeout?: () => void): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      onTimeout?.();
      reject(new Error(message));
    }, Math.max(1, timeoutMs));
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
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
  const imagePath = await resolveGrounderImagePath(screenshot, config);
  if (!imagePath.ok) {
    return {
      ok: false,
      reason: imagePath.reason,
      grounding: { status: 'failed', targetDescription, screenshotRef: screenshot.path, reason: imagePath.reason },
    };
  }

  const startedAt = Date.now();
  const grounderPrompt = [
    'Locate the UI element for a mouse click in the supplied screenshot.',
    'Return click coordinates only; do not return typing commands, text content, or action plans.',
    `Target: ${targetDescription}`,
  ].join(' ');
  const response = await postJsonWithTimeout(
    `${config.grounder.baseUrl.replace(/\/+$/, '')}/predict/`,
    {
      ...(!imagePath.imageBase64 ? { image_path: imagePath.path } : {}),
      ...(imagePath.imageBase64 ? { image_base64: imagePath.imageBase64, image_mime_type: imagePath.imageMimeType ?? 'image/png' } : {}),
      text_prompt: grounderPrompt,
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
    const fallback = await groundTargetWithVisionModel(targetDescription, screenshot, config);
    if (fallback.ok) {
      return {
        ...fallback,
        grounding: {
          ...fallback.grounding,
          fallbackFrom: 'kv-ground',
          kvGroundFailure: 'response did not include usable coordinates',
          kvGroundRawResponse: response.body,
        },
      };
    }
    return {
      ok: false,
      reason: fallback.reason === 'No visual Grounder is configured.'
        ? 'Grounder response did not include usable coordinates.'
        : `Grounder response did not include usable coordinates; fallback visual Grounder also failed: ${fallback.reason}`,
      grounding: { status: 'failed', targetDescription, screenshotRef: screenshot.path, imagePath: imagePath.path, rawResponse: response.body, fallbackReason: fallback.reason },
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
      imageUploaded: imagePath.uploaded === true,
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
  const modelIssue = visionModelIssue(config.grounder.visionModel);
  if (modelIssue) {
    return {
      ok: false,
      reason: `OpenAI-compatible visual Grounder model is not configured as a VLM: ${modelIssue}`,
      grounding: { status: 'failed', provider: 'openai-compatible-vision-grounder', targetDescription, screenshotRef: screenshot.path, reason: 'text-only model configured for visual grounding' },
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

async function resolveGrounderImagePath(ref: ScreenshotRef, config: VisionSenseConfig): Promise<{ ok: true; path: string; uploaded?: boolean; imageBase64?: string; imageMimeType?: string } | { ok: false; reason: string }> {
  if (config.grounder.allowServiceLocalPaths) return { ok: true, path: ref.absPath };
  const localPrefix = config.grounder.localPathPrefix;
  const remotePrefix = config.grounder.remotePathPrefix;
  if (localPrefix && remotePrefix && ref.absPath.startsWith(localPrefix)) {
    return { ok: true, path: `${remotePrefix.replace(/\/+$/, '')}/${ref.absPath.slice(localPrefix.length).replace(/^\/+/, '')}` };
  }
  const uploadStrategy = config.grounder.upload?.strategy ?? 'inline';
  if (uploadStrategy === 'inline') {
    return {
      ok: true,
      path: `inline:image/png;sha256=${ref.sha256}`,
      uploaded: true,
      imageBase64: (await readFile(ref.absPath)).toString('base64'),
      imageMimeType: 'image/png',
    };
  }
  const uploaded = await uploadGrounderImage(ref, config);
  if (uploaded.ok) return uploaded;
  if (uploaded.reason !== 'not-configured') return { ok: false, reason: uploaded.reason };
  return {
    ok: false,
    reason: [
      'Grounder image path is local-only and no service-readable mapping is configured.',
      'Set SCIFORGE_VISION_KV_GROUND_ALLOW_SERVICE_LOCAL_PATHS=1 when the service shares the same filesystem,',
      'configure SCIFORGE_VISION_KV_GROUND_LOCAL_PATH_PREFIX and SCIFORGE_VISION_KV_GROUND_REMOTE_PATH_PREFIX,',
      'or configure SCIFORGE_VISION_KV_GROUND_UPLOAD_STRATEGY=scp with upload host/remote dir.',
    ].join(' '),
  };
}

async function uploadGrounderImage(ref: ScreenshotRef, config: VisionSenseConfig): Promise<{ ok: true; path: string; uploaded: true } | { ok: false; reason: string }> {
  const upload = config.grounder.upload;
  if (upload?.strategy !== 'scp') return { ok: false, reason: 'not-configured' };
  if (!upload.host || !upload.remoteDir) {
    return {
      ok: false,
      reason: 'KV-Ground SCP upload is configured but missing host or remoteDir. Set SCIFORGE_VISION_KV_GROUND_UPLOAD_HOST and SCIFORGE_VISION_KV_GROUND_UPLOAD_REMOTE_DIR.',
    };
  }
  const remoteName = `${sanitizeId(config.runId || 'vision-run')}-${sanitizeId(ref.id || basename(ref.absPath)) || 'screenshot'}.png`;
  const remotePath = `${upload.remoteDir.replace(/\/+$/, '')}/${remoteName}`;
  const args = [
    '-P',
    String(upload.port ?? 22),
    '-o',
    'BatchMode=yes',
    '-o',
    'StrictHostKeyChecking=accept-new',
  ];
  if (upload.identityFile) args.push('-i', upload.identityFile);
  args.push(ref.absPath, `${upload.user || 'root'}@${upload.host}:${remotePath}`);
  const result = await runCommand('scp', args, { timeoutMs: config.grounder.timeoutMs });
  if (result.exitCode !== 0) {
    return {
      ok: false,
      reason: `KV-Ground SCP upload failed before grounding: ${result.stderr || result.stdout || `exit ${result.exitCode}`}`,
    };
  }
  return {
    ok: true,
    path: upload.remoteUrlPrefix ? `${upload.remoteUrlPrefix.replace(/\/+$/, '')}/${remoteName}` : remotePath,
    uploaded: true,
  };
}

async function postJsonWithTimeout(url: string, body: Record<string, unknown>, timeoutMs: number) {
  const controller = new AbortController();
  try {
    const response = await withHardTimeout(fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    }), timeoutMs, `JSON request timed out after ${timeoutMs}ms`, () => controller.abort());
    const text = await withHardTimeout(
      response.text(),
      timeoutMs,
      `JSON response body timed out after ${timeoutMs}ms`,
      () => controller.abort(),
    );
    const parsed = text ? parseJson(text) : {};
    if (!response.ok) {
      return { ok: false as const, error: `HTTP ${response.status}: ${text.slice(0, 500)}` };
    }
    return { ok: true as const, body: isRecord(parsed) ? parsed : { value: parsed } };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
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
