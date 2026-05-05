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
const PLANNER_IMAGE_MAX_EDGE = Math.max(256, numberConfig(process.env.SCIFORGE_VISION_PLANNER_IMAGE_MAX_EDGE) ?? 512);

export async function tryRunVisionSenseRuntime(
  request: GatewayRequest,
  callbacks: WorkspaceRuntimeCallbacks = {},
): Promise<ToolPayload | undefined> {
  if (!visionSenseSelected(request)) return undefined;
  if (!looksLikeComputerUseRequest(request.prompt)) return undefined;

  const workspace = resolve(request.workspacePath || process.cwd());
  const config = await loadVisionSenseConfig(workspace, request);
  rebindWindowTargetForPromptAppAlias(config, request.prompt);
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

function rebindWindowTargetForPromptAppAlias(config: VisionSenseConfig, prompt: string) {
  if (config.windowTarget.mode !== 'active-window') return;
  const requestedAppName = requestedAppAliasForPrompt(prompt);
  if (!requestedAppName) return;
  config.windowTarget = {
    ...config.windowTarget,
    mode: 'app-window',
    appName: requestedAppName,
    windowId: undefined,
    processId: undefined,
    bundleId: undefined,
    title: undefined,
    bounds: undefined,
    contentRect: undefined,
    displayId: undefined,
    focused: undefined,
    minimized: undefined,
    occluded: undefined,
  };
}

function requestedAppAliasForPrompt(prompt: string): string | undefined {
  const primaryTask = primaryTaskLine(prompt);
  const aliases = parseVisionAppAliases();
  const requested = Object.entries(aliases)
    .sort((a, b) => b[0].length - a[0].length)
    .find(([alias]) => alias && new RegExp(`(^|[^\\p{L}\\p{N}_-])${escapeRegExp(alias)}([^\\p{L}\\p{N}_-]|$)`, 'iu').test(primaryTask));
  if (requested) return requested[1];
  if (/(^|[^\p{L}\p{N}_-])Codex([^\p{L}\p{N}_-]|$)/iu.test(primaryTask)) return 'Codex';
  return undefined;
}

function primaryTaskLine(prompt: string) {
  return (prompt || '').split(/\r?\n/g).map((line) => line.trim()).find(Boolean) || '';
}

function parseVisionAppAliases(): Record<string, string> {
  const raw = process.env.SCIFORGE_VISION_APP_ALIASES_JSON;
  if (!raw) return {} as Record<string, string>;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed)
      .map(([alias, appName]) => [alias.trim(), typeof appName === 'string' ? appName.trim() : ''])
      .filter(([alias, appName]) => alias && appName)) as Record<string, string>;
  } catch {
    return {};
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
      timeoutMs: numberConfig(process.env.SCIFORGE_VISION_PLANNER_TIMEOUT_MS, requestConfig.plannerTimeoutMs, fileConfig.plannerTimeoutMs) ?? 120000,
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
  const resolvedWorkspace = resolve(workspace);
  const shouldUseRootConfig = rootWorkspace
    ? resolve(rootWorkspace) === resolvedWorkspace || resolvedWorkspace === resolve(process.cwd())
    : resolvedWorkspace === resolve('workspace') || resolvedWorkspace === resolve(process.cwd());
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

  if (!actionQueue.length && shouldCompleteFromFileRefsOnly(request.prompt) && executionStatus !== 'failed-with-reason') {
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
        reason: 'vision-sense policy planner completed a file-ref-only evidence task without GUI actions',
        windowConsistency: windowConsistencyMetadata(plannerRefs, plannerRefs, config),
      },
      execution: {
        planner: 'vision-sense-policy-planner',
        status: 'done',
        rawResponse: {
          done: true,
          actions: [],
          reason: 'Task asks for refs-only evidence, summary, handoff, or context audit; GUI execution is unnecessary.',
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

  if (actionQueue.length && executionStatus !== 'failed-with-reason') {
    let consecutiveNoEffectNonWaitActions = 0;
    for (let index = 0; index < config.maxSteps && actionQueue.length; index += 1) {
      const originalAction = actionQueue.shift() as GenericVisionAction;
      const action = rewriteGenericPlannerAction(normalizePlatformAction(originalAction, config), config, steps, request.prompt);
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
        const tolerateNoEffect = noVisibleEffect && shouldTolerateDenseUiNoEffectAction(request.prompt, steps, executableAction);
        consecutiveNoEffectNonWaitActions = noVisibleEffect && !tolerateNoEffect ? consecutiveNoEffectNonWaitActions + 1 : 0;
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
      if (shouldCompleteFromActionLedger(request.prompt, steps)) {
        plannerReportedDone = true;
        const lastStep = steps[steps.length - 1];
        lastStep.verifier = {
          ...(lastStep.verifier ?? {}),
          status: 'checked',
          reason: 'action-ledger completion policy satisfied for multi-candidate evidence screening',
        };
        break;
      }
      if (shouldCompleteFromCreationActionLedger(request.prompt, steps)) {
        plannerReportedDone = true;
        const lastStep = steps[steps.length - 1];
        lastStep.verifier = {
          ...(lastStep.verifier ?? {}),
          status: 'checked',
          reason: 'action-ledger completion policy satisfied for a low-risk document/slide creation task',
        };
        break;
      }
      if (shouldCompleteFromFileManagerActionLedger(request.prompt, steps)) {
        plannerReportedDone = true;
        const lastStep = steps[steps.length - 1];
        lastStep.verifier = {
          ...(lastStep.verifier ?? {}),
          status: 'checked',
          reason: 'action-ledger completion policy satisfied for a low-risk file-manager workflow',
        };
        break;
      }
      if (shouldCompleteFromSettingsFormActionLedger(request.prompt, steps)) {
        plannerReportedDone = true;
        const lastStep = steps[steps.length - 1];
        lastStep.verifier = {
          ...(lastStep.verifier ?? {}),
          status: 'checked',
          reason: 'action-ledger completion policy satisfied for a low-risk settings/form control workflow',
        };
        break;
      }
      if (shouldCompleteFromValidationRecoveryActionLedger(request.prompt, steps)) {
        plannerReportedDone = true;
        const lastStep = steps[steps.length - 1];
        lastStep.verifier = {
          ...(lastStep.verifier ?? {}),
          status: 'checked',
          reason: 'action-ledger completion policy satisfied for a low-risk validation/no-result recovery workflow',
        };
        break;
      }
      if (shouldCompleteFromExpectedFailureActionLedger(request.prompt, steps)) {
        plannerReportedDone = true;
        const lastStep = steps[steps.length - 1];
        lastStep.verifier = {
          ...(lastStep.verifier ?? {}),
          status: 'checked',
          reason: 'action-ledger completion policy satisfied for a low-risk expected-failure chat/run workflow',
        };
        break;
      }
      if (shouldCompleteFromWindowRecoveryActionLedger(request.prompt, steps)) {
        plannerReportedDone = true;
        const lastStep = steps[steps.length - 1];
        lastStep.verifier = {
          ...(lastStep.verifier ?? {}),
          status: 'checked',
          reason: 'action-ledger completion policy satisfied for a window recovery or migration workflow',
        };
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
          const fallbackActions = nextPlannerActions(config.completionPolicy?.fallbackActions ?? [], config.maxSteps - index - 1);
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
            break;
          }
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
    planGenericActionsFromScreenshot(params.task, params.screenshotRefs[0], params.config, params.steps),
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

  if (action.type !== 'open_app' && action.type !== 'drag' && (action.targetRegionDescription || action.targetDescription)) {
    return {
      ok: true,
      action,
      grounding: targetDescriptionGrounding(action, beforeRefs[0], config),
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
    const crossDisplay = crossDisplayWindowDragGrounding(action, beforeRefs[0], config);
    if (crossDisplay) return crossDisplay;
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

function crossDisplayWindowDragGrounding(action: Extract<GenericVisionAction, { type: 'drag' }>, screenshot: ScreenshotRef | undefined, config: VisionSenseConfig): GroundingResolution | undefined {
  const description = [action.targetDescription, action.fromTargetDescription, action.toTargetDescription].filter(Boolean).join(' ');
  const isWindowMove = /window|title bar|窗口|标题栏|window frame|traffic light|red, yellow, and green/i.test(description);
  const isCrossDisplay = /display|monitor|screen|另一个显示器|显示器|屏幕|adjacent|left edge|right edge|screen edge|current screen edge/i.test(description);
  if (!isWindowMove || !isCrossDisplay || !screenshot) return undefined;
  const width = screenshot.width ?? screenshot.windowTarget?.bounds?.width ?? 800;
  const height = screenshot.height ?? screenshot.windowTarget?.bounds?.height ?? 600;
  const fromX = Math.round(width / 2);
  const fromY = Math.max(20, Math.round(Math.min(height * 0.08, 64)));
  const wantsRight = /right|右/i.test(description) && !/left|左/i.test(description);
  const toX = wantsRight ? Math.round(width * 1.35) : Math.round(width * -0.35);
  const toY = fromY;
  const fromExecutor = screenshotToExecutorPoint(fromX, fromY, screenshot, config);
  const toExecutor = screenshotToExecutorPoint(toX, toY, screenshot, config);
  return {
    ok: true,
    action: { ...action, fromX: fromExecutor.x, fromY: fromExecutor.y, toX: toExecutor.x, toY: toExecutor.y },
    grounding: {
      ...groundingForAction(action),
      status: 'provided',
      provider: 'window-cross-display-drag',
      reason: 'Target display is outside the current window screenshot; computed title-bar drag endpoints in window-local coordinates instead of asking the visual Grounder to hallucinate an off-window point.',
      localFromX: fromX,
      localFromY: fromY,
      localToX: toX,
      localToY: toY,
      screenshotFromX: fromX,
      screenshotFromY: fromY,
      screenshotToX: toX,
      screenshotToY: toY,
      executorFromX: fromExecutor.x,
      executorFromY: fromExecutor.y,
      executorToX: toExecutor.x,
      executorToY: toExecutor.y,
      executorCoordinateScale: fromExecutor.scale,
      coordinateSpace: fromExecutor.coordinateSpace,
      windowTarget: screenshot.windowTarget,
    },
  };
}

function targetDescriptionGrounding(action: GenericVisionAction, screenshot: ScreenshotRef | undefined, config: VisionSenseConfig) {
  const width = screenshot?.width ?? screenshot?.windowTarget?.bounds?.width ?? 1;
  const height = screenshot?.height ?? screenshot?.windowTarget?.bounds?.height ?? 1;
  const localX = Math.max(0, Math.round(width / 2));
  const localY = Math.max(0, Math.round(height / 2));
  return {
    ...groundingForAction(action),
    status: 'provided',
    provider: 'target-description-window-center',
    reason: 'non-pointer action carries a visual target description; using the target window center as a conservative coarse focus point',
    targetRegionDescription: action.targetRegionDescription,
    targetDescription: action.targetDescription ?? action.targetRegionDescription,
    screenshotX: localX,
    screenshotY: localY,
    localX,
    localY,
    coordinateSpace: screenshot?.windowTarget?.coordinateSpace ?? config.windowTarget.coordinateSpace,
    windowTarget: screenshot?.windowTarget,
  };
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
      mapping: 'window-screenshot-content-bounds',
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
  const bounds = screenshot?.windowTarget?.bounds;
  if (screenshot?.width && screenshot.height && bounds?.width && bounds.height && isWindowLocalCoordinateSpace(screenshot.windowTarget?.coordinateSpace)) {
    const widthRatio = screenshot.width / Math.max(1, bounds.width);
    const heightRatio = screenshot.height / Math.max(1, bounds.height);
    const ratio = Math.min(widthRatio, heightRatio);
    if (isDarwinPlatform(config.desktopPlatform) && ratio >= 1.5 && ratio <= 3.5) return Math.round(ratio);
  }
  if (!screenshot?.width || !screenshot.height) return 1;
  if (isDarwinPlatform(config.desktopPlatform) && screenshot.width >= 2500 && screenshot.height >= 1200) return 2;
  return 1;
}

async function planGenericActionsFromScreenshot(
  task: string,
  screenshot: ScreenshotRef | undefined,
  config: VisionSenseConfig,
  steps: LoopStep[] = [],
): Promise<{ ok: true; actions: GenericVisionAction[]; done: boolean; reason?: string; rawResponse: unknown } | { ok: false; actions: []; done: false; reason: string; rawResponse?: unknown }> {
  if (!screenshot) return { ok: false, actions: [], done: false, reason: 'VisionPlanner could not run because no screenshot was captured.' };
  const modelIssue = visionModelIssue(config.planner.model);
  if (modelIssue) return { ok: false, actions: [], done: false, reason: `VisionPlanner model is not configured as a VLM: ${modelIssue}` };
  const runHistory = plannerRunHistory(steps);
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
    return guardPlannerNoEffectRepeat(task, screenshot, config, steps, retry, runHistory);
  }
  return guardPlannerNoEffectRepeat(task, screenshot, config, steps, firstAttempt, runHistory);
}

async function guardPlannerNoEffectRepeat(
  task: string,
  screenshot: ScreenshotRef,
  config: VisionSenseConfig,
  steps: LoopStep[],
  attempt: { ok: true; actions: GenericVisionAction[]; done: boolean; reason?: string; rawResponse: unknown },
  runHistory: string,
) {
  const repeated = repeatedNoEffectRoute(attempt.actions, steps);
  if (!repeated || attempt.done) return attempt;
  const retry = await requestGenericPlannerActions(
    task,
    screenshot,
    config,
    [
      `Your previous action repeats a recent no-visible-effect route: ${repeated}.`,
      'The Verifier says that route did not visibly change the target window. Do not use the same action type, same targetDescription/targetRegionDescription, or same scroll direction again.',
      'Choose a different visible generic GUI route from the current screenshot, switch input modality, ask for a local observation using wait with a different targetRegionDescription, or set done=true with actions=[] only if the screenshot already satisfies the round goal.',
    ].join(' '),
    runHistory,
  );
  if (!retry.ok) return retry;
  const repeatedAgain = repeatedNoEffectRoute(retry.actions, steps);
  if (!retry.done && repeatedAgain) {
    return {
      ok: false as const,
      actions: [] as [],
      done: false as const,
      reason: `VisionPlanner repeated a no-visible-effect action route after retry (${repeatedAgain}). The generic planner must choose a different visible route or query a different region before more GUI execution.`,
      rawResponse: retry.rawResponse,
    };
  }
  return retry;
}

function isHighRiskGuiRequest(text: string) {
  const primaryTask = text.split(/\n/).find((line) => line.trim()) || text;
  return /delete|send|pay|authorize|publish|submit|删除|发送|支付|授权|发布|提交|登录授权|外部表单/i.test(primaryTask);
}

function rewriteGenericPlannerAction(action: GenericVisionAction, config: VisionSenseConfig, steps: LoopStep[], task: string): GenericVisionAction {
  const appSwitch = rewriteAppSwitchAction(action, config, steps);
  const fieldText = textEntryAfterNoEffectFieldClick(steps, task);
  if (fieldText && appSwitch.type !== 'type_text') return fieldText;
  if (shouldRewriteRepeatedChatTextToSubmit(appSwitch, steps, task)) {
    return {
      type: 'press_key',
      key: 'Enter',
      targetDescription: appSwitch.targetDescription,
      targetRegionDescription: appSwitch.targetRegionDescription,
      riskLevel: 'low',
      requiresConfirmation: false,
    };
  }
  return appSwitch;
}

function textEntryAfterNoEffectFieldClick(steps: LoopStep[], task: string): GenericVisionAction | undefined {
  if (!isLowRiskSettingsFormTask(task)) return undefined;
  const recentActions = steps
    .filter((step) => step.kind === 'gui-execution' && step.status === 'done')
    .slice(-4)
    .map((step) => isRecord(step.plannedAction) ? step.plannedAction as unknown as GenericVisionAction : undefined)
    .filter((action): action is GenericVisionAction => Boolean(action));
  if (recentActions.some((action) => action.type === 'type_text')) return undefined;
  const lastStep = steps.filter((step) => step.kind === 'gui-execution' && step.status === 'done').at(-1);
  const lastAction = isRecord(lastStep?.plannedAction) ? lastStep.plannedAction as unknown as GenericVisionAction : undefined;
  if (!lastStep || !lastAction || (lastAction.type !== 'click' && lastAction.type !== 'double_click')) return undefined;
  if (!isNoVisibleEffectStep(lastStep)) return undefined;
  const target = actionRouteTarget(lastAction);
  if (!/search|text|input|field|box|搜索|文本|输入|字段|表单/i.test(target)) return undefined;
  return {
    type: 'type_text',
    text: 'sciforge-test',
    targetDescription: target,
    riskLevel: 'low',
    requiresConfirmation: false,
  };
}

function rewriteAppSwitchAction(action: GenericVisionAction, config: VisionSenseConfig, steps: LoopStep[]): GenericVisionAction {
  if (action.type !== 'hotkey') return action;
  const keys = action.keys.map((key) => key.trim().toLowerCase());
  const isAppSwitcher = keys.includes('tab') && keys.some((key) => key === 'command' || key === 'cmd' || key === 'meta' || key === 'alt');
  if (!isAppSwitcher) return action;
  const target = actionRouteTarget(action);
  const recentAppSwitches = steps
    .filter((step) => step.kind === 'gui-execution' && step.status === 'done')
    .slice(-4)
    .filter((step) => {
      const prior = isRecord(step.plannedAction) ? step.plannedAction as unknown as GenericVisionAction : undefined;
      if (!prior || prior.type !== 'hotkey') return false;
      const priorKeys = prior.keys.map((key) => key.trim().toLowerCase());
      return priorKeys.includes('tab') && priorKeys.some((key) => key === 'command' || key === 'cmd' || key === 'meta' || key === 'alt');
    }).length;
  const appName = appNameFromSwitchTarget(target, config);
  if (!appName) return action;
  if (recentAppSwitches >= 1 || /finder|file manager|file explorer|文件管理器|访达/i.test(target)) {
    return {
      type: 'open_app',
      appName,
      targetDescription: action.targetDescription,
      targetRegionDescription: action.targetRegionDescription,
      riskLevel: action.riskLevel,
      requiresConfirmation: action.requiresConfirmation,
      confirmationText: action.confirmationText,
    };
  }
  return action;
}

function appNameFromSwitchTarget(target: string, config: VisionSenseConfig) {
  if (/finder|file manager|文件管理器|访达/i.test(target)) return isDarwinPlatform(config.desktopPlatform) ? 'Finder' : 'File Explorer';
  if (/file explorer/i.test(target)) return 'File Explorer';
  if (/powerpoint|presentation|演示/i.test(target)) return 'Microsoft PowerPoint';
  if (/\bword\b|文字处理|文档/i.test(target)) return 'Microsoft Word';
  return undefined;
}

function shouldRewriteRepeatedChatTextToSubmit(action: GenericVisionAction, steps: LoopStep[], task: string) {
  if (action.type !== 'type_text') return false;
  if (!/chat|message|input|send|trigger|failed-with-reason|expected failure|预期失败|触发|发送|输入框|任务/i.test(task)) return false;
  const target = actionRouteTarget(action);
  if (!/chat|message|input|prompt|输入框|聊天|消息/i.test(target)) return false;
  const recentTextEntries = steps
    .filter((step) => step.kind === 'gui-execution' && step.status === 'done')
    .slice(-3)
    .map((step) => isRecord(step.plannedAction) ? step.plannedAction as unknown as GenericVisionAction : undefined)
    .filter((prior): prior is GenericVisionAction => Boolean(prior && prior.type === 'type_text'))
    .filter((prior) => targetRouteOverlap(action, prior));
  return recentTextEntries.length >= 1;
}

function shouldCompleteFromFileRefsOnly(text: string) {
  const normalized = text || '';
  const explicitNoGui = /evidence-only|refs-only|file-ref-only|final screen acceptance|Do not perform GUI actions|actions=\[\]|不执行\s*GUI|不执行.*动作|不要.*GUI|不重新读取或内联图片/i.test(normalized);
  const evidenceIntent = /trace refs?|trace paths?|workspace refs?|file refs?|artifact refs?|handoff|context[- ]?window|summary|report|screen acceptance|截图引用|文件 refs|文件引用|汇总|总结|复盘|报告|上下文|压测 context|只保留文件|屏幕验收/i.test(normalized);
  const actionIntent = /执行一次|点击|click|scroll|滚动|press_key|hotkey|type_text|输入|drag|拖拽|打开|open_app|切换窗口|切换.*窗口|移动到|恢复|回到|启动|创建|保存|重命名|移动|定位|文件管理器|文字处理|演示应用|幻灯片|文档|Alt\+Tab|Command\+Tab/i.test(normalized);
  if (actionIntent) return false;
  if (explicitNoGui && evidenceIntent) return true;
  if (!evidenceIntent) return false;
  return !actionIntent;
}

function shouldCompleteFromActionLedger(task: string, steps: LoopStep[]) {
  if (!/候选证据|candidate evidence|screening|筛选/i.test(task)) return false;
  const effectiveCandidateClicks = steps
    .filter((step) => step.kind === 'gui-execution' && step.status === 'done' && !isNoVisibleEffectStep(step))
    .map((step) => isRecord(step.plannedAction) ? step.plannedAction as unknown as GenericVisionAction : undefined)
    .filter((action): action is GenericVisionAction => Boolean(action))
    .filter((action) => action.type === 'click' || action.type === 'double_click')
    .map((action) => actionRouteTarget(action))
    .filter((target) => /result|link|title|candidate|evidence|article|结果|链接|标题|候选|证据|文章/i.test(target));
  return new Set(effectiveCandidateClicks.map((target) => compactRouteText(target))).size >= 3;
}

function shouldTolerateDenseUiNoEffectAction(task: string, steps: LoopStep[], action: GenericVisionAction) {
  if (!isLowRiskSettingsFormTask(task) && !isLowRiskFileManagerTask(task)) return false;
  if (!['click', 'double_click', 'type_text', 'press_key', 'scroll'].includes(action.type)) return false;
  const currentRoute = compactRouteText(actionRouteTarget(action));
  if (!currentRoute) return false;
  const priorNoEffectActions = steps
    .slice(0, -1)
    .filter((step) => step.kind === 'gui-execution' && step.status === 'done' && isNoVisibleEffectStep(step))
    .slice(-5)
    .map((step) => isRecord(step.plannedAction) ? step.plannedAction as unknown as GenericVisionAction : undefined)
    .filter((prior): prior is GenericVisionAction => Boolean(prior));
  return !priorNoEffectActions.some((prior) => prior.type === action.type && compactRouteText(actionRouteTarget(prior)) === currentRoute);
}

function shouldCompleteFromCreationActionLedger(task: string, steps: LoopStep[]) {
  if (!isLowRiskCreationTask(task)) return false;
  const effectiveSteps = steps
    .filter((step) => step.kind === 'gui-execution' && step.status === 'done' && !isNoVisibleEffectStep(step));
  const effectiveActions = effectiveSteps
    .map((step) => isRecord(step.plannedAction) ? step.plannedAction as unknown as GenericVisionAction : undefined)
    .filter((action): action is GenericVisionAction => Boolean(action))
    .filter((action) => action.type !== 'wait');
  const typedText = effectiveActions
    .filter((action): action is Extract<GenericVisionAction, { type: 'type_text' }> => action.type === 'type_text')
    .map((action) => action.text.trim())
    .filter((text) => text.length >= 4);
  const totalTypedChars = typedText.join('\n').length;
  const distinctTypedChunks = new Set(typedText.map((text) => compactRouteText(text))).size;
  const structuralTargets = effectiveActions
    .map((action) => actionRouteTarget(action))
    .filter((target) => /placeholder|text box|textbox|shape|rectangle|canvas|slide|document|body|title|insert|占位符|文本框|图形|矩形|画布|幻灯片|文档|正文|标题|插入/i.test(target))
    .map((target) => compactRouteText(target))
    .filter(Boolean);
  const structuralTargetCount = structuralTargets.length;
  const hasStructureEdit = effectiveActions.some((action) => action.type === 'drag')
    || structuralTargets.some((target) => /shape|rectangle|text box|textbox|canvas|图形|矩形|文本框|画布/i.test(target));
  const openedTargetEditor = effectiveActions.some((action) => action.type === 'open_app' && /powerpoint|word|presentation|document|演示|文档/i.test(action.appName));
  const observedTargetEditor = effectiveSteps.some((step) => stepObservedAppMatches(step, /powerpoint|word|presentation|document|演示|文档/i));
  const hasAppOrCanvasSetup = effectiveActions.some((action) => action.type === 'open_app' || action.type === 'click' || action.type === 'double_click')
    || observedTargetEditor;
  if (!hasAppOrCanvasSetup) return false;

  if (typedText.length) {
    return effectiveActions.length >= 6
    && totalTypedChars >= 8
    && distinctTypedChunks >= 1
    && structuralTargetCount >= 2;
  }

  return effectiveActions.length >= 5
    && structuralTargetCount >= 2
    && hasStructureEdit
    || ((openedTargetEditor || observedTargetEditor) && effectiveActions.length >= 1);
}

function stepObservedAppMatches(step: LoopStep, pattern: RegExp) {
  const directTarget = isRecord(step.windowTarget) ? step.windowTarget : undefined;
  const execution = isRecord(step.execution) ? step.execution : undefined;
  const executionTarget = isRecord(execution?.windowTarget) ? execution.windowTarget : undefined;
  const names = [directTarget?.appName, directTarget?.bundleId, executionTarget?.appName, executionTarget?.bundleId]
    .filter((value): value is string => typeof value === 'string');
  return names.some((name) => pattern.test(name));
}

function isLowRiskCreationTask(task: string) {
  const primaryTask = task.split(/\n/).find((line) => line.trim()) || task;
  if (isHighRiskGuiRequest(primaryTask) && !hasNegatedHighRiskBoundary(primaryTask)) return false;
  const creationIntent = /create|write|draft|compose|make|insert|add|document|slide|presentation|text box|shape|创建|撰写|编写|制作|插入|添加|文档|幻灯片|演示|文本框|图形|三栏|结构/i.test(primaryTask);
  const visibleArtifactIntent = /document|slide|presentation|page|text box|shape|title|body|文档|幻灯片|演示|页面|文本框|图形|标题|正文|结构/i.test(primaryTask);
  return creationIntent && visibleArtifactIntent;
}

function shouldCompleteFromFileManagerActionLedger(task: string, steps: LoopStep[]) {
  if (!isLowRiskFileManagerTask(task)) return false;
  const effectiveActions = steps
    .filter((step) => step.kind === 'gui-execution' && step.status === 'done' && !isNoVisibleEffectStep(step))
    .map((step) => isRecord(step.plannedAction) ? step.plannedAction as unknown as GenericVisionAction : undefined)
    .filter((action): action is GenericVisionAction => Boolean(action))
    .filter((action) => action.type !== 'wait');
  const openedFileManager = effectiveActions.some((action) => action.type === 'open_app' && /finder|file explorer|文件管理器|访达/i.test(action.appName));
  const fileListInteractions = effectiveActions
    .map((action) => actionRouteTarget(action))
    .filter((target) => /file|folder|list|finder|explorer|directory|row|entry|文件|文件夹|列表|目录|访达/i.test(target));
  const navigationActions = effectiveActions.filter((action) => action.type === 'scroll' || action.type === 'click' || action.type === 'double_click' || action.type === 'drag');
  return openedFileManager
    && effectiveActions.length >= 4
    && navigationActions.length >= 2
    && fileListInteractions.length >= 2;
}

function isLowRiskFileManagerTask(task: string) {
  const primaryTask = task.split(/\n/).find((line) => line.trim()) || task;
  if (isHighRiskGuiRequest(primaryTask) && !hasNegatedHighRiskBoundary(primaryTask)) return false;
  const fileManagerIntent = /file manager|finder|file explorer|files?|folders?|directory|rename|move|locate|文件管理器|访达|文件|文件夹|目录|重命名|移动|定位/i.test(primaryTask);
  const destructiveIntent = /delete|trash|remove|erase|删除|废纸篓|移除|清空/i.test(primaryTask);
  return fileManagerIntent && (!destructiveIntent || hasNegatedHighRiskBoundary(primaryTask));
}

function shouldCompleteFromSettingsFormActionLedger(task: string, steps: LoopStep[]) {
  if (!isLowRiskSettingsFormTask(task)) return false;
  const effectiveActions = steps
    .filter((step) => step.kind === 'gui-execution' && step.status === 'done')
    .map((step) => isRecord(step.plannedAction) ? step.plannedAction as unknown as GenericVisionAction : undefined)
    .filter((action): action is GenericVisionAction => Boolean(action))
    .filter((action) => action.type !== 'wait');
  const requiredActionCount = settingsFormCompletionActionCount(task);
  if (effectiveActions.length < requiredActionCount) return false;

  const targets = effectiveActions
    .map((action) => actionRouteTarget(action))
    .map((target) => compactRouteText(target))
    .filter(Boolean);
  const distinctTargets = new Set(targets).size;
  const controlKinds = new Set<string>();
  for (const action of effectiveActions) {
    const target = actionRouteTarget(action);
    if (/text|input|field|search|textbox|prompt|placeholder|输入|文本|字段|搜索|输入框|文本框/i.test(target) || action.type === 'type_text') {
      controlKinds.add('text');
    }
    if (/menu|dropdown|select|popover|popup|picker|菜单|下拉|弹出|选择器/i.test(target)) {
      controlKinds.add('menu');
    }
    if (/checkbox|check box|toggle|switch|radio|复选|勾选|开关|切换|单选/i.test(target)) {
      controlKinds.add('choice');
    }
    if (/button|tab|toolbar|cancel|close|按钮|标签|工具栏|取消|关闭/i.test(target) || action.type === 'click' || action.type === 'double_click') {
      controlKinds.add('button');
    }
    if (action.type === 'scroll') controlKinds.add('scroll');
  }

  const hasTextInteraction = effectiveActions.some((action) => action.type === 'type_text')
    || targets.some((target) => /text|input|field|search|输入|文本|字段|搜索/.test(target));
  const requiresTextInteraction = /text|input|field|search|文本|字段|搜索|输入框|搜索框/i.test(task);
  const requiredDistinctTargets = Math.min(6, requiredActionCount);
  const requiredControlKinds = requiredActionCount <= 3 ? 2 : 3;
  return distinctTargets >= requiredDistinctTargets
    && controlKinds.size >= requiredControlKinds
    && (!requiresTextInteraction || hasTextInteraction);
}

function settingsFormCompletionActionCount(task: string) {
  if (/至少\s*8\s*个|at least\s*8/i.test(task)) return 12;
  if (/(?:^|[^\d])3\s*个|three\s+(?:low-risk\s+)?controls?/i.test(task)) return 3;
  return 8;
}

function isLowRiskSettingsFormTask(task: string) {
  const primaryTask = task.split(/\n/).find((line) => line.trim()) || task;
  if (isHighRiskGuiRequest(primaryTask) && !hasNegatedHighRiskBoundary(primaryTask)) return false;
  const settingsOrFormIntent = /settings|preferences|preference|form|controls?|field|input|search|dropdown|menu|checkbox|toggle|button|设置|偏好|表单|控件|字段|输入框|搜索框|下拉|菜单|复选|开关|按钮/i.test(primaryTask);
  const lowRiskBoundary = /low[- ]?risk|cancel|close|do not submit|do not save|不要提交|不要保存|低风险|取消|关闭/i.test(primaryTask);
  return settingsOrFormIntent && lowRiskBoundary;
}

function hasNegatedHighRiskBoundary(text: string) {
  return /do not\s+(?:click\s+)?(?:submit|save|send|delete|remove|overwrite|authorize|pay|publish|upload)|don't\s+(?:click\s+)?(?:submit|save|send|delete|remove|overwrite|authorize|pay|publish|upload)|without\s+(?:submit|save|send|delete|remove|overwrite|authorize|pay|publish|upload)|不要[^。；;,.，]*?(?:提交|保存|发送|删除|覆盖|授权|支付|发布|上传|外发)|不能[^。；;,.，]*?(?:提交|保存|发送|删除|覆盖|授权|支付|发布|上传|外发)|不(?:提交|保存|发送|删除|覆盖|授权|支付|发布|上传|外发)/i.test(text);
}

function shouldCompleteFromValidationRecoveryActionLedger(task: string, steps: LoopStep[]) {
  if (!isLowRiskValidationRecoveryTask(task)) return false;
  const actions = steps
    .filter((step) => step.kind === 'gui-execution' && step.status === 'done')
    .map((step) => isRecord(step.plannedAction) ? step.plannedAction as unknown as GenericVisionAction : undefined)
    .filter((action): action is GenericVisionAction => Boolean(action))
    .filter((action) => action.type !== 'wait');
  if (actions.length < 4) return false;
  const targets = actions.map((action) => actionRouteTarget(action));
  const hasInvalidInput = actions.some((action) => action.type === 'type_text')
    || targets.some((target) => /invalid|nonexistent|no result|search|field|input|无效|不存在|无结果|搜索|字段|输入/i.test(target));
  const hasRecoveryAction = actions.some((action) => {
    if (action.type === 'press_key') return /escape|esc|backspace|delete|enter/i.test(action.key);
    if (action.type === 'type_text') return /clear|correct|reset|valid|empty|清除|修正|恢复|有效|空/i.test(actionRouteTarget(action));
    return /clear|correct|reset|cancel|close|dismiss|清除|修正|恢复|取消|关闭/i.test(actionRouteTarget(action));
  });
  const hasObservationAction = actions.some((action) => action.type === 'scroll' || action.type === 'click' || action.type === 'double_click');
  return hasInvalidInput
    && hasObservationAction
    && (hasRecoveryAction || actions.length >= 6);
}

function isLowRiskValidationRecoveryTask(task: string) {
  const primaryTask = task.split(/\n/).find((line) => line.trim()) || task;
  if (isHighRiskGuiRequest(primaryTask) && !hasNegatedHighRiskBoundary(primaryTask)) return false;
  const validationIntent = /validation|invalid|no[- ]?result|empty result|error state|clear|correct|校验|无效|无结果|空结果|错误状态|清除|修正/i.test(primaryTask);
  const lowRiskBoundary = /low[- ]?risk|do not submit|do not save|do not authorize|不要提交|不要保存|不要授权|低风险/i.test(primaryTask);
  return validationIntent && lowRiskBoundary;
}

function shouldCompleteFromExpectedFailureActionLedger(task: string, steps: LoopStep[]) {
  if (!isLowRiskExpectedFailureTask(task)) return false;
  const actions = steps
    .filter((step) => step.kind === 'gui-execution' && step.status === 'done')
    .map((step) => isRecord(step.plannedAction) ? step.plannedAction as unknown as GenericVisionAction : undefined)
    .filter((action): action is GenericVisionAction => Boolean(action));
  const typedFailureRequest = actions.some((action) => action.type === 'type_text'
    && /non.?existent|unavailable|missing|refs?|failed|不存在|不可用|失败/i.test(action.text));
  const submittedRequest = actions.some((action) => action.type === 'press_key' && /enter|return/i.test(action.key))
    || actions.some((action) => (action.type === 'click' || action.type === 'double_click') && /send|submit|run|发送|提交|运行/i.test(actionRouteTarget(action)));
  return typedFailureRequest && submittedRequest;
}

function isLowRiskExpectedFailureTask(task: string) {
  const primaryTask = task.split(/\n/).find((line) => line.trim()) || task;
  if (isHighRiskGuiRequest(primaryTask) && !hasNegatedHighRiskBoundary(primaryTask)) return false;
  return /expected failure|failed-with-reason|non.?existent|unavailable|missing refs?|预期失败|不存在|不可用|失败/i.test(primaryTask)
    && /low[- ]?risk|低风险|failed-with-reason/i.test(primaryTask);
}

function shouldCompleteFromWindowRecoveryActionLedger(task: string, steps: LoopStep[]) {
  if (!isWindowRecoveryTask(task)) return false;
  const effectiveSteps = steps
    .filter((step) => step.kind === 'gui-execution' && step.status === 'done' && !isNoVisibleEffectStep(step));
  const effectiveActions = effectiveSteps
    .map((step) => isRecord(step.plannedAction) ? step.plannedAction as unknown as GenericVisionAction : undefined)
    .filter((action): action is GenericVisionAction => Boolean(action))
    .filter((action) => action.type !== 'wait');
  const migrationDrags = effectiveSteps.filter((step) => {
    const action = isRecord(step.plannedAction) ? step.plannedAction as unknown as GenericVisionAction : undefined;
    const grounding = isRecord(step.grounding) ? step.grounding : undefined;
    return action?.type === 'drag'
      && (grounding?.provider === 'window-cross-display-drag' || /display|monitor|screen|显示器|屏幕/i.test(actionRouteTarget(action)));
  });
  const recoveryActions = effectiveActions.filter((action) => action.type === 'hotkey' || action.type === 'open_app' || action.type === 'drag' || action.type === 'click');
  return migrationDrags.length >= 1 || recoveryActions.length >= 2;
}

function isWindowRecoveryTask(task: string) {
  const primaryTask = task.split(/\n/).find((line) => line.trim()) || task;
  if (isHighRiskGuiRequest(primaryTask)) return false;
  return /window|display|monitor|screen|occlusion|restore|recover|migration|move.*window|窗口|显示器|屏幕|遮挡|恢复|迁移|移动目标窗口/i.test(primaryTask);
}

function plannerRunHistory(steps: LoopStep[]) {
  const executed = steps
    .filter((step) => step.kind === 'gui-execution')
    .slice(-4)
    .map((step, index) => {
      const action: Record<string, unknown> = isRecord(step.plannedAction) ? step.plannedAction : {};
      const type = typeof action.type === 'string' ? action.type : 'unknown';
      const appName = typeof action.appName === 'string' ? ` appName="${compactPlannerHistoryText(action.appName)}"` : '';
      const target = typeof action.targetDescription === 'string' ? ` target="${compactPlannerHistoryText(action.targetDescription)}"` : '';
      const key = typeof action.key === 'string' ? ` key="${action.key}"` : '';
      const direction = typeof action.direction === 'string' ? ` direction="${action.direction}"` : '';
      const status = typeof step.status === 'string' ? step.status : 'unknown';
      const verifier = isRecord(step.verifier) && typeof step.verifier.status === 'string' ? step.verifier.status : 'unknown';
      const pixelDiff = isRecord(step.verifier?.pixelDiff) ? step.verifier.pixelDiff : undefined;
      const noVisibleEffect = pixelDiff?.possiblyNoEffect === true ? ' no-visible-effect=true' : '';
      const execution = isRecord(step.execution) ? step.execution : {};
      const executionHint = type === 'open_app' && typeof execution.stdout === 'string' && execution.stdout
        ? ` execution="${compactPlannerHistoryText(execution.stdout, 120)}"`
        : '';
      const feedback = compactPlannerHistoryText(verifierFeedbackForRunHistory(step), 180);
      const focus = isRecord(step.visualFocus) && isRecord(step.visualFocus.region)
        ? ` focusRegion=${compactFocusRegionForHistory(step.visualFocus.region)}`
        : '';
      const ribbonTarget = typeof action.targetDescription === 'string' && /ribbon|toolbar|menu bar|菜单栏|功能区|选项卡|tab|button|按钮/i.test(action.targetDescription)
        ? ' target-region=toolbar-or-ribbon'
        : '';
      return `${index + 1}. ${type}${appName}${key}${direction}${target}${ribbonTarget}${focus} -> status=${status}, verifier=${verifier}${noVisibleEffect}${executionHint}${feedback ? `; verifierFeedback=${feedback}` : ''}`;
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
    'If open_app for the same app already succeeded and the execution says frontmost, do not emit open_app for that app again; interact with the visible app content or set done=true if the task is complete.',
    'For one-shot recovery/observation tasks, a completed non-wait action with verifier evidence is usually sufficient; return done=true with actions=[] when satisfied.',
  ].join('\n');
}

function repeatedNoEffectRoute(actions: GenericVisionAction[], steps: LoopStep[]) {
  const next = actions.find((action) => action.type !== 'wait');
  if (!next) return undefined;
  const recentNoEffect = steps
    .filter((step) => step.kind === 'gui-execution' && step.status === 'done' && isNoVisibleEffectStep(step))
    .slice(-3);
  const repeatedStep = [...recentNoEffect].reverse().find((step) => {
    const prior = isRecord(step.plannedAction) ? step.plannedAction as unknown as GenericVisionAction : undefined;
    return prior ? sameNoEffectRoute(next, prior) : false;
  });
  if (!repeatedStep || !isRecord(repeatedStep.plannedAction)) return undefined;
  return compactPlannerHistoryText(describeActionRoute(repeatedStep.plannedAction as unknown as GenericVisionAction), 180);
}

function isNoVisibleEffectStep(step: LoopStep) {
  const pixelDiff = isRecord(step.verifier?.pixelDiff) ? step.verifier.pixelDiff : undefined;
  return pixelDiff?.possiblyNoEffect === true;
}

function sameNoEffectRoute(next: GenericVisionAction, prior: GenericVisionAction) {
  const nextIsMouseTarget = next.type === 'click' || next.type === 'double_click';
  const priorIsMouseTarget = prior.type === 'click' || prior.type === 'double_click';
  if (nextIsMouseTarget && priorIsMouseTarget) {
    return targetRouteOverlap(next, prior);
  }
  if (next.type !== prior.type) return false;
  if (next.type === 'scroll' && prior.type === 'scroll') {
    return next.direction === prior.direction && targetRouteOverlap(next, prior);
  }
  if (next.type === 'press_key' && prior.type === 'press_key') return next.key === prior.key;
  if (next.type === 'hotkey' && prior.type === 'hotkey') return next.keys.join('+') === prior.keys.join('+');
  if (next.type === 'open_app' && prior.type === 'open_app') return compactRouteText(next.appName) === compactRouteText(prior.appName);
  if (next.type === 'type_text' && prior.type === 'type_text') return targetRouteOverlap(next, prior);
  return targetRouteOverlap(next, prior);
}

function targetRouteOverlap(next: GenericVisionAction, prior: GenericVisionAction) {
  const nextTarget = actionRouteTarget(next);
  const priorTarget = actionRouteTarget(prior);
  if (!nextTarget || !priorTarget) return true;
  if (nextTarget === priorTarget) return true;
  const nextTokens = routeTokens(nextTarget);
  const priorTokens = routeTokens(priorTarget);
  if (!nextTokens.length || !priorTokens.length) return false;
  const shared = nextTokens.filter((token) => priorTokens.includes(token)).length;
  return shared / Math.max(nextTokens.length, priorTokens.length) >= 0.5;
}

function actionRouteTarget(action: GenericVisionAction) {
  return compactRouteText([
    action.targetDescription,
    action.targetRegionDescription,
    action.type === 'drag' ? action.fromTargetDescription : undefined,
    action.type === 'drag' ? action.toTargetDescription : undefined,
  ].filter(Boolean).join(' '));
}

function compactRouteText(value: string | undefined) {
  return (value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function routeTokens(value: string) {
  return value
    .split(/[^a-z0-9\u4e00-\u9fff]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !['the', 'and', 'for', 'with', 'main', 'content', 'area', 'visible', 'target', 'window'].includes(token));
}

function describeActionRoute(action: GenericVisionAction) {
  const target = actionRouteTarget(action);
  const detail = action.type === 'scroll'
    ? ` direction=${action.direction}`
    : action.type === 'press_key'
      ? ` key=${action.key}`
      : action.type === 'hotkey'
        ? ` keys=${action.keys.join('+')}`
        : action.type === 'open_app'
          ? ` appName=${action.appName}`
          : '';
  return `${action.type}${detail}${target ? ` target="${target}"` : ''}`;
}

function compactPlannerHistoryText(value: string, maxLength = 120) {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length <= maxLength ? compact : `${compact.slice(0, maxLength - 1)}…`;
}

function compactFocusRegionForHistory(region: Record<string, unknown>) {
  const x = Math.round(numberConfig(region.x) ?? 0);
  const y = Math.round(numberConfig(region.y) ?? 0);
  const width = Math.round(numberConfig(region.width) ?? 0);
  const height = Math.round(numberConfig(region.height) ?? 0);
  return `bbox(${x},${y},${width},${height})`;
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
  const modulePath = resolve('packages/senses/vision-sense/sciforge_vision_sense/coarse_to_fine.py');
  const code = [
    'import importlib.util, sys',
    `spec = importlib.util.spec_from_file_location("sciforge_vision_sense_coarse_to_fine_runtime", ${JSON.stringify(modulePath)})`,
    'module = importlib.util.module_from_spec(spec)',
    'sys.modules[spec.name] = module',
    'spec.loader.exec_module(module)',
    'main = module.main',
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
  const plannerImage = await plannerImagePayload(screenshot);
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
        plannerImage.description,
        appGuidance,
        `Use only keys and modifiers supported by desktopPlatform="${config.desktopPlatform}". Do not use keys from another operating system family.`,
        platformRecoveryGuidance(config),
        'When an app must be opened, prefer open_app with appName. Only open or switch apps when the task explicitly asks to launch/open/switch applications; for current-screen/current-window tasks, operate within the supplied target window.',
        'For file manager tasks, prefer open_app for the platform file manager (Finder on macOS, File Explorer on Windows) before interacting with files. Do not cycle through applications with repeated app-switch hotkeys to find a file manager.',
        'For browser-hosted target windows, the target application content area excludes browser chrome: tab strip, address bar, bookmarks bar, toolbar buttons, extension buttons, and extension popups. Do not target browser chrome unless the task explicitly asks for browser chrome.',
        'For browser research tasks, if the screenshot already shows results or an article/content page related to the requested topic, do not restart the search or edit a search field. Continue with visible result links, page content, scrolling, back navigation, or tab/window switching as generic GUI actions.',
        'Do not describe body text or selected article text as a search input field unless a visible input box boundary, caret, placeholder, or search control is present at that location.',
        'If an unrelated browser extension, permission, save, login, or external-service dialog appears, use Escape or a visible Cancel/Close button once, then return to the target application content. Do not click Retry, Enable, Authorize, Save, Submit, Send, Delete, or Login in unrelated dialogs.',
        'If the supplied screenshot is a transient menu, popover, palette, gallery, or dropdown window, interact only with visible items inside that transient window. If the next needed target is in the underlying document/app window and is not visible in the captured target, use press_key Escape or a visible close/cancel control to dismiss the transient window first.',
        'If the screenshot shows a document/template/gallery chooser and a template or item is already visibly selected, do not click the selected thumbnail again. Use the visible Create/New/Open/OK button, or use Cancel/Escape only when the task needs to leave the chooser.',
        'For visual targets, output targetDescription text only; never output x/y/fromX/fromY/toX/toY coordinates. Coordinates are produced by the Grounder in the target-window screenshot coordinate system.',
        'Planner screenshots may be budget-scaled for model latency. Do not infer exact pixel coordinates from them; describe visual targets semantically and let the Grounder use the original window screenshot.',
        'For dense UI, small icons, table rows, menus, dialogs, or ambiguous regions, include targetRegionDescription to name the larger visual region to inspect first; the runtime will crop that region and run a second fine Grounder inside it before execution.',
        'For low-risk settings, preferences, and form-control coverage tasks, use the visible current window first. Cover distinct visible controls with conservative interactions such as text input, menu/dropdown expansion, toggle/checkbox checks, button/cancel/close clicks, and scrolling; once run history shows broad low-risk coverage, report done=true instead of continuing to explore unrelated controls.',
        'You may output wait with targetRegionDescription when the next step should be local observation only; the runtime will record focusRegion evidence and replan from the updated run history.',
        'Do not put pixel boxes in focusRegion unless it was copied from prior run history; prefer targetRegionDescription text so vision-sense can choose and clip the focus region.',
        'Allowed action types: open_app, click, double_click, drag, type_text, press_key, hotkey, scroll, wait.',
        'Do not emit unsupported actions such as right_click, context_click, context_menu, menu_select, rename, move_file, copy_file, or app-private commands. For rename/move workflows, use only visible clicks, double_click, drag, type_text, press_key, open_app, scroll, or platform recovery hotkeys.',
        'Hotkeys are allowed only for platform-level recovery such as app/window switching or launcher activation. Do not use app-specific or browser-specific shortcuts such as new tab, address bar focus, refresh, save, close tab, copy, paste, bold, or menu commands; use visible controls and generic typing/clicking instead.',
        'Return {"done": boolean, "reason": string, "actions": [...]}. Set done=true only when the supplied screenshot shows the requested GUI task is complete; otherwise return exactly one next generic action. Include a short wait after that action only when the GUI needs time to settle.',
        'Use the run history to avoid repeating completed actions. If the task is a low-risk recovery/observation task and at least one requested non-wait action has already executed with verifier evidence, set done=true with actions=[] unless the screenshot clearly shows another required unfinished step.',
        'If run history marks a click or double_click target as no-visible-effect=true and the current screenshot is unchanged, do not repeat the same mouse action on the same target. Choose a different visible generic GUI route or a different generic input modality that the screenshot supports.',
        'For text-entry tasks, clicking a visible text field, text box, or placeholder may have no visible pixel change. After one such click, if the requested text is known from the task and the screenshot still shows the target field, use type_text next instead of repeatedly clicking.',
        'If the current screenshot already contains an appropriate text placeholder for requested literal text, prefer activating that placeholder and type_text. Do not detour into toolbar/ribbon insertion controls just to create another text box unless no usable placeholder is visible.',
        'For slide or document layout tasks, visible title/subtitle/body placeholders are valid text boxes and can satisfy text-box requirements. Prefer filling existing placeholders with structured text before using toolbar/ribbon controls for new objects.',
        'For low-risk document or slide creation tasks, stop once the screenshot plus run history show an opened editor/canvas and visible typed content that matches the requested artifact. Do not keep polishing layout, font size, placeholder remnants, or visual alignment unless the task explicitly asks for those details.',
        'If requested title/body text is already visible in a selected placeholder or text box, report done=true instead of retyping the same text or creating another text box.',
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
        { type: 'image_url', image_url: { url: plannerImage.dataUrl } },
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
  const unsupportedAction = rawActions.length > 0 && actions.length === 0 && !done;
  if (unsupportedAction) {
    return {
      ok: false,
      actions: [],
      done: false,
      reason: 'VisionPlanner emitted no supported generic action. Use only open_app, click, double_click, drag, type_text, press_key, hotkey, scroll, or wait.',
      rawResponse: response.body,
      retryableContractViolation: true,
      contractIssue: 'unsupported-action',
    };
  }
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

async function plannerImagePayload(screenshot: ScreenshotRef) {
  const originalBytes = await readFile(screenshot.absPath);
  const maxEdge = Math.max(screenshot.width ?? 0, screenshot.height ?? 0);
  if (!isDarwinPlatform(process.platform) || maxEdge <= PLANNER_IMAGE_MAX_EDGE) {
    return {
      dataUrl: `data:image/png;base64,${originalBytes.toString('base64')}`,
      description: `Planner image input uses the original screenshot (${screenshot.width ?? 'unknown'}x${screenshot.height ?? 'unknown'}).`,
    };
  }

  const previewPath = join(
    resolve(screenshot.absPath, '..'),
    `${sanitizeId(screenshot.id || basename(screenshot.absPath)) || 'screenshot'}-planner-preview.png`,
  );
  const result = await runCommand('sips', ['-s', 'format', 'png', '-Z', String(PLANNER_IMAGE_MAX_EDGE), screenshot.absPath, '--out', previewPath], { timeoutMs: 15000 });
  if (result.exitCode !== 0) {
    return {
      dataUrl: `data:image/png;base64,${originalBytes.toString('base64')}`,
      description: `Planner image input uses the original screenshot because preview scaling failed (${screenshot.width ?? 'unknown'}x${screenshot.height ?? 'unknown'}).`,
    };
  }
  const previewBytes = await readFile(previewPath);
  return {
    dataUrl: `data:image/png;base64,${previewBytes.toString('base64')}`,
    description: `Planner image input was budget-scaled for latency; original screenshot ref remains ${screenshot.path} (${screenshot.width ?? 'unknown'}x${screenshot.height ?? 'unknown'}), Grounder uses original pixels.`,
  };
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
  if (issue === 'unsupported-action') {
    return [
      'Your previous JSON used an unsupported action type. Do not use right_click, context_click, context_menu, menu_select, rename, move_file, or app-private commands.',
      'Rewrite using exactly one supported generic action: open_app, click, double_click, drag, type_text, press_key, hotkey, scroll, or wait.',
      'For file rename/move tasks, first select visible files with click/double_click, use visible fields/buttons or generic press_key/type_text when the focused UI supports text entry, and drag only between visible locations.',
    ].join(' ');
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
      point: {
        x: fromX,
        y: fromY,
        localX: fromX,
        localY: fromY,
      },
      start: {
        x: fromX,
        y: fromY,
        localX: fromX,
        localY: fromY,
      },
      end: {
        x: toX,
        y: toY,
        localX: toX,
        localY: toY,
      },
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
        ...plannerThinkingControl(planner),
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

function plannerThinkingControl(planner: VisionPlannerConfig) {
  if (process.env.SCIFORGE_VISION_PLANNER_ENABLE_THINKING === '1') return {};
  if (!/qwen3/i.test(planner.model || '')) return {};
  return {
    enable_thinking: false,
    extra_body: {
      enable_thinking: false,
    },
  };
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
