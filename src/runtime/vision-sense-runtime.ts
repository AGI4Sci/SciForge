import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

import type { GatewayRequest, ToolPayload, WorkspaceRuntimeCallbacks } from './runtime-types.js';
import { isRecord, toStringList, uniqueStrings } from './gateway-utils.js';
import { emitWorkspaceRuntimeEvent } from './workspace-runtime-events.js';

const VISION_TOOL_ID = 'local.vision-sense';
const ONE_BY_ONE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADgwGOSyRGjgAAAABJRU5ErkJggg==',
  'base64',
);

type GenericVisionAction =
  | ({ type: 'click'; x?: number; y?: number } & GenericActionMetadata)
  | ({ type: 'double_click'; x?: number; y?: number } & GenericActionMetadata)
  | ({ type: 'drag'; fromX?: number; fromY?: number; toX?: number; toY?: number; fromTargetDescription?: string; toTargetDescription?: string } & GenericActionMetadata)
  | ({ type: 'type_text'; text: string } & GenericActionMetadata)
  | ({ type: 'press_key'; key: string } & GenericActionMetadata)
  | ({ type: 'hotkey'; keys: string[] } & GenericActionMetadata)
  | ({ type: 'scroll'; direction: 'up' | 'down' | 'left' | 'right'; amount?: number } & GenericActionMetadata)
  | ({ type: 'open_app'; appName: string } & GenericActionMetadata)
  | ({ type: 'wait'; ms?: number } & GenericActionMetadata);

type GenericSwiftGuiAction = Extract<GenericVisionAction, { type: 'click' | 'double_click' | 'drag' | 'scroll' }>;

interface GenericActionMetadata {
  targetDescription?: string;
  grounding?: Record<string, unknown>;
  riskLevel?: 'low' | 'medium' | 'high';
  requiresConfirmation?: boolean;
  confirmationText?: string;
}

interface VisionSenseConfig {
  desktopBridgeEnabled: boolean;
  dryRun: boolean;
  captureDisplays: number[];
  desktopPlatform: string;
  windowTarget: WindowTarget;
  runId?: string;
  outputDir?: string;
  maxSteps: number;
  allowHighRiskActions: boolean;
  executorCoordinateScale?: number;
  planner: VisionPlannerConfig;
  grounder: VisionGrounderConfig;
  plannedActions: GenericVisionAction[];
}

interface VisionPlannerConfig {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  timeoutMs: number;
  maxTokens: number;
}

interface VisionGrounderConfig {
  baseUrl?: string;
  timeoutMs: number;
  allowServiceLocalPaths: boolean;
  localPathPrefix?: string;
  remotePathPrefix?: string;
  visionBaseUrl?: string;
  visionApiKey?: string;
  visionModel?: string;
  visionTimeoutMs: number;
  visionMaxTokens: number;
}

interface WindowTarget {
  enabled: boolean;
  required: boolean;
  mode: 'display' | 'active-window' | 'window-id' | 'app-window';
  windowId?: number;
  appName?: string;
  title?: string;
  displayId?: number;
  bounds?: WindowBounds;
  coordinateSpace: 'screen' | 'window' | 'window-local';
  inputIsolation: 'best-effort' | 'require-focused-target';
}

interface ResolvedWindowTarget {
  ok: true;
  target: WindowTarget;
  captureKind: 'display' | 'window';
  windowId?: number;
  appName?: string;
  title?: string;
  bounds?: WindowBounds;
  coordinateSpace: 'screen' | 'window' | 'window-local';
  inputIsolation: WindowTarget['inputIsolation'];
  schedulerLockId: string;
  source: 'config' | 'active-window' | 'display-fallback' | 'dry-run';
  diagnostics: string[];
}

interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

type WindowTargetResolution = ResolvedWindowTarget | { ok: false; target: WindowTarget; reason: string; diagnostics: string[] };

type GroundingResolution =
  | { ok: true; action: GenericVisionAction; grounding?: Record<string, unknown> }
  | { ok: false; action: GenericVisionAction; grounding?: Record<string, unknown>; reason: string };

type PlannerContractIssue = 'coordinate-output' | 'platform-incompatible-action';

interface ScreenshotRef {
  id: string;
  path: string;
  absPath: string;
  displayId: number;
  windowTarget?: TraceWindowTarget;
  width?: number;
  height?: number;
  sha256: string;
  bytes: number;
}

interface TraceWindowTarget {
  enabled: boolean;
  required: boolean;
  mode: WindowTarget['mode'];
  captureKind: 'display' | 'window';
  coordinateSpace: WindowTarget['coordinateSpace'];
  inputIsolation: WindowTarget['inputIsolation'];
  windowId?: number;
  appName?: string;
  title?: string;
  bounds?: WindowBounds;
  schedulerLockId?: string;
  source: ResolvedWindowTarget['source'];
  diagnostics?: string[];
}

interface LoopStep {
  id: string;
  kind: 'planning' | 'gui-execution';
  status: 'done' | 'failed' | 'blocked';
  beforeScreenshotRefs?: TraceScreenshotRef[];
  afterScreenshotRefs?: TraceScreenshotRef[];
  plannedAction?: GenericVisionAction;
  grounding?: Record<string, unknown>;
  execution?: Record<string, unknown>;
  windowTarget?: TraceWindowTarget;
  localCoordinate?: Record<string, unknown>;
  mappedCoordinate?: Record<string, unknown>;
  inputChannel?: Record<string, unknown>;
  verifier?: Record<string, unknown>;
  scheduler?: Record<string, unknown>;
  failureReason?: string;
}

type TraceScreenshotRef = ReturnType<typeof toTraceScreenshotRef>;

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

function parseWindowTarget(requestConfig: Record<string, unknown>, fileConfig: Record<string, unknown>): WindowTarget {
  const rawTarget = envOrValue(
    parseJsonEnv(process.env.SCIFORGE_VISION_WINDOW_TARGET_JSON),
    requestConfig.windowTarget,
    requestConfig.targetWindow,
    fileConfig.windowTarget,
    fileConfig.targetWindow,
  );
  const targetConfig = isRecord(rawTarget) ? rawTarget : {};
  const windowId = numberConfig(process.env.SCIFORGE_VISION_WINDOW_ID, targetConfig.windowId, targetConfig.window_id);
  const appName = stringConfig(process.env.SCIFORGE_VISION_WINDOW_APP_NAME, targetConfig.appName, targetConfig.app_name, targetConfig.application);
  const title = stringConfig(process.env.SCIFORGE_VISION_WINDOW_TITLE, targetConfig.title, targetConfig.windowTitle, targetConfig.window_title);
  const bounds = parseWindowBounds(envOrValue(process.env.SCIFORGE_VISION_WINDOW_BOUNDS, targetConfig.bounds, targetConfig.windowBounds, targetConfig.window_bounds));
  const explicitMode = stringConfig(process.env.SCIFORGE_VISION_WINDOW_TARGET_MODE, targetConfig.mode, targetConfig.kind);
  const mode = normalizeWindowTargetMode(explicitMode, { windowId, appName, title });
  const enabled = booleanConfig(
    process.env.SCIFORGE_VISION_WINDOW_TARGET_ENABLED,
    targetConfig.enabled,
    undefined,
    mode !== 'display',
  );
  const required = booleanConfig(
    process.env.SCIFORGE_VISION_REQUIRE_WINDOW_TARGET,
    targetConfig.required,
    targetConfig.requireWindowTarget,
    enabled && mode !== 'display',
  );
  const coordinateSpace = normalizeCoordinateSpace(stringConfig(process.env.SCIFORGE_VISION_COORDINATE_SPACE, targetConfig.coordinateSpace, targetConfig.coordinate_space), mode);
  const inputIsolation = normalizeInputIsolation(stringConfig(process.env.SCIFORGE_VISION_INPUT_ISOLATION, targetConfig.inputIsolation, targetConfig.input_isolation), required);
  return {
    enabled,
    required,
    mode: enabled ? mode : 'display',
    windowId,
    appName,
    title,
    bounds,
    coordinateSpace,
    inputIsolation,
  };
}

function normalizeWindowTargetMode(value: string | undefined, target: { windowId?: number; appName?: string; title?: string }): WindowTarget['mode'] {
  const normalized = value?.trim().toLowerCase().replace(/[-\s]+/g, '_');
  if (normalized === 'display' || normalized === 'screen') return 'display';
  if (normalized === 'active' || normalized === 'active_window' || normalized === 'frontmost') return 'active-window';
  if (normalized === 'window' || normalized === 'window_id' || normalized === 'id') return 'window-id';
  if (normalized === 'app' || normalized === 'app_window' || normalized === 'application') return 'app-window';
  if (target.windowId !== undefined) return 'window-id';
  if (target.appName || target.title) return 'app-window';
  return 'display';
}

function normalizeCoordinateSpace(value: string | undefined, mode: WindowTarget['mode']): WindowTarget['coordinateSpace'] {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'screen' || normalized === 'global') return 'screen';
  if (normalized === 'window-local' || normalized === 'window_local' || normalized === 'local') return 'window-local';
  if (normalized === 'window' || normalized === 'target-window' || normalized === 'target') return 'window';
  return mode === 'display' ? 'screen' : 'window';
}

function normalizeInputIsolation(value: string | undefined, required: boolean): WindowTarget['inputIsolation'] {
  const normalized = value?.trim().toLowerCase().replace(/[-\s]+/g, '_');
  if (normalized === 'require_focused_target' || normalized === 'strict' || normalized === 'required') return 'require-focused-target';
  if (normalized === 'best_effort' || normalized === 'off' || normalized === 'none') return 'best-effort';
  return required ? 'require-focused-target' : 'best-effort';
}

function parseJsonEnv(value: string | undefined) {
  if (!value) return undefined;
  return parseJson(value);
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

async function captureDisplays(
  workspace: string,
  runDir: string,
  prefix: string,
  config: VisionSenseConfig,
  targetResolution: WindowTargetResolution,
) {
  const refs: ScreenshotRef[] = [];
  if (targetResolution.ok && targetResolution.captureKind === 'window') {
    const displayId = config.captureDisplays[0] ?? 1;
    const absPath = join(runDir, `${prefix}-window-${targetResolution.windowId ?? 'active'}.png`);
    if (config.dryRun) {
      await writeFile(absPath, ONE_BY_ONE_PNG);
    } else {
      const result = await captureWindowScreenshot(absPath, targetResolution, config);
      if (result.exitCode !== 0) {
        throw new Error(`target window capture failed: ${result.stderr || result.stdout || `exit ${result.exitCode}`}`);
      }
    }
    const stats = await stat(absPath);
    const bytes = await readFile(absPath);
    const dimensions = pngDimensions(bytes);
    refs.push({
      id: basename(absPath, '.png'),
      path: workspaceRel(workspace, absPath),
      absPath,
      displayId,
      windowTarget: toTraceWindowTarget(targetResolution),
      width: dimensions?.width,
      height: dimensions?.height,
      sha256: sha256(bytes),
      bytes: stats.size,
    });
    return refs;
  }

  for (const displayId of config.captureDisplays) {
    const absPath = join(runDir, `${prefix}-display-${displayId}.png`);
    if (config.dryRun) {
      await writeFile(absPath, ONE_BY_ONE_PNG);
    } else {
      const result = await runCommand('screencapture', ['-x', '-D', String(displayId), absPath], { timeoutMs: 15000 });
      if (result.exitCode !== 0) {
        throw new Error(`screencapture display ${displayId} failed: ${result.stderr || result.stdout || `exit ${result.exitCode}`}`);
      }
    }
    const stats = await stat(absPath);
    const bytes = await readFile(absPath);
    const dimensions = pngDimensions(bytes);
    refs.push({
      id: basename(absPath, '.png'),
      path: workspaceRel(workspace, absPath),
      absPath,
      displayId,
      windowTarget: targetResolution.ok ? toTraceWindowTarget(targetResolution) : undefined,
      width: dimensions?.width,
      height: dimensions?.height,
      sha256: sha256(bytes),
      bytes: stats.size,
    });
  }
  return refs;
}

async function resolveWindowTarget(config: VisionSenseConfig): Promise<WindowTargetResolution> {
  const target = config.windowTarget;
  if (!target.enabled || target.mode === 'display') {
    return {
      ok: true,
      target,
      captureKind: 'display',
      coordinateSpace: 'screen',
      inputIsolation: target.inputIsolation,
      schedulerLockId: schedulerLockIdForTarget(target, 'display'),
      source: 'display-fallback',
      diagnostics: ['window targeting disabled; using configured display capture for compatibility'],
    };
  }
  if (config.dryRun) {
    return {
      ok: true,
      target,
      captureKind: 'window',
      windowId: target.windowId,
      appName: target.appName,
      title: target.title,
      bounds: target.bounds,
      coordinateSpace: target.coordinateSpace,
      inputIsolation: target.inputIsolation,
      schedulerLockId: schedulerLockIdForTarget(target, target.windowId ?? target.mode),
      source: 'dry-run',
      diagnostics: ['dry-run window target accepted without probing the desktop'],
    };
  }
  if (!isDarwinPlatform(config.desktopPlatform)) {
    const reason = `WindowTarget mode="${target.mode}" is configured, but no target-window provider is available for desktopPlatform="${config.desktopPlatform}".`;
    return target.required
      ? { ok: false, target, reason, diagnostics: [reason] }
      : {
          ok: true,
          target,
          captureKind: 'display',
          coordinateSpace: 'screen',
          inputIsolation: 'best-effort',
          schedulerLockId: schedulerLockIdForTarget(target, 'display'),
          source: 'display-fallback',
          diagnostics: [reason, 'falling back to display capture because windowTarget.required=false'],
        };
  }
  const detected = await detectMacWindowTarget(target);
  if (detected.ok) return detected;
  if (target.required) return detected;
  return {
    ok: true,
    target,
    captureKind: 'display',
    coordinateSpace: 'screen',
    inputIsolation: 'best-effort',
    schedulerLockId: schedulerLockIdForTarget(target, 'display'),
    source: 'display-fallback',
    diagnostics: [...detected.diagnostics, 'falling back to display capture because windowTarget.required=false'],
  };
}

async function detectMacWindowTarget(target: WindowTarget): Promise<WindowTargetResolution> {
  if (target.mode === 'window-id' && target.windowId !== undefined) {
    return {
      ok: true,
      target,
      captureKind: 'window',
      windowId: target.windowId,
      appName: target.appName,
      title: target.title,
      coordinateSpace: target.coordinateSpace,
      inputIsolation: target.inputIsolation,
      schedulerLockId: schedulerLockIdForTarget(target, target.windowId),
      source: 'config',
      diagnostics: ['using configured macOS window id'],
    };
  }
  const scriptPath = join(tmpdir(), `sciforge-window-target-${randomUUID()}.swift`);
  await writeFile(scriptPath, macWindowTargetProbeScript(target), 'utf8');
  try {
    const result = await runCommand('swift', [scriptPath], { timeoutMs: 15000 });
    if (result.exitCode !== 0) {
      const reason = `macOS target-window probe failed: ${result.stderr || result.stdout || `exit ${result.exitCode}`}`;
      return { ok: false, target, reason, diagnostics: [reason] };
    }
    const parsed = parseJson(result.stdout.trim());
    if (!isRecord(parsed)) {
      const reason = 'macOS target-window probe did not return JSON metadata.';
      return { ok: false, target, reason, diagnostics: [reason, result.stdout.trim()].filter(Boolean) };
    }
    const windowId = numberConfig(parsed.windowId);
    const bounds = parseWindowBounds(parsed.bounds);
    if (windowId === undefined) {
      const reason = String(parsed.reason || 'macOS target-window probe did not find a matching on-screen window.');
      return { ok: false, target, reason, diagnostics: [reason] };
    }
    return {
      ok: true,
      target,
      captureKind: 'window',
      windowId,
      appName: stringConfig(parsed.appName, target.appName),
      title: stringConfig(parsed.title, target.title),
      bounds,
      coordinateSpace: target.coordinateSpace,
      inputIsolation: target.inputIsolation,
      schedulerLockId: schedulerLockIdForTarget(target, windowId),
      source: target.mode === 'active-window' ? 'active-window' : 'config',
      diagnostics: ['resolved macOS target window through CGWindowList'],
    };
  } finally {
    await unlink(scriptPath).catch(() => undefined);
  }
}

function macWindowTargetProbeScript(target: WindowTarget) {
  return `
import CoreGraphics
import Foundation

let targetMode = ${swiftString(target.mode)}
let targetApp: String? = ${swiftOptionalString(target.appName)}
let targetTitle: String? = ${swiftOptionalString(target.title)}
let options = CGWindowListOption(arrayLiteral: .optionOnScreenOnly, .excludeDesktopElements)
let windows = (CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]]) ?? []

func emit(_ value: [String: Any]) {
  let data = try! JSONSerialization.data(withJSONObject: value, options: [])
  print(String(data: data, encoding: .utf8)!)
}

for window in windows {
  let layer = window[kCGWindowLayer as String] as? Int ?? 1
  if layer != 0 { continue }
  let appName = window[kCGWindowOwnerName as String] as? String ?? ""
  let title = window[kCGWindowName as String] as? String ?? ""
  if let targetApp, appName.range(of: targetApp, options: [.caseInsensitive]) == nil { continue }
  if let targetTitle, title.range(of: targetTitle, options: [.caseInsensitive]) == nil { continue }
  let windowId = window[kCGWindowNumber as String] as? UInt32 ?? 0
  let bounds = window[kCGWindowBounds as String] as? [String: Any] ?? [:]
  if targetMode == "active-window" || targetMode == "app-window" {
    emit([
      "windowId": Int(windowId),
      "appName": appName,
      "title": title,
      "bounds": bounds,
    ])
    exit(0)
  }
}

emit(["reason": "no matching target window"])
exit(2)
`;
}

function parseWindowBounds(value: unknown): WindowBounds | undefined {
  if (!isRecord(value)) return undefined;
  const x = numberConfig(value.X, value.x);
  const y = numberConfig(value.Y, value.y);
  const width = numberConfig(value.Width, value.width);
  const height = numberConfig(value.Height, value.height);
  return x === undefined || y === undefined || width === undefined || height === undefined
    ? undefined
    : { x, y, width, height };
}

function schedulerLockIdForTarget(target: WindowTarget, resolvedId: string | number) {
  return sanitizeId([
    'vision-window',
    target.mode,
    resolvedId,
    target.appName,
    target.title,
  ].filter((part) => part !== undefined && part !== '').join('-')).toLowerCase();
}

async function captureWindowScreenshot(absPath: string, targetResolution: ResolvedWindowTarget, config: VisionSenseConfig) {
  if (isDarwinPlatform(config.desktopPlatform) && targetResolution.windowId !== undefined) {
    return runCommand('screencapture', ['-x', '-l', String(targetResolution.windowId), absPath], { timeoutMs: 15000 });
  }
  return {
    exitCode: 125,
    stdout: '',
    stderr: 'Target-window capture requires a resolved windowId for the configured desktop platform.',
  };
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

function isWindowLocalCoordinateSpace(value: string | undefined) {
  return value === 'window' || value === 'window-local';
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

function windowTargetTraceConfig(target: WindowTarget) {
  return {
    enabled: target.enabled,
    required: target.required,
    mode: target.mode,
    coordinateSpace: target.coordinateSpace,
    inputIsolation: target.inputIsolation,
    windowId: target.windowId,
    appName: target.appName,
    title: target.title,
    bounds: target.bounds,
  };
}

function toTraceWindowTarget(targetResolution: ResolvedWindowTarget): TraceWindowTarget {
  return {
    ...windowTargetTraceConfig(targetResolution.target),
    captureKind: targetResolution.captureKind,
    coordinateSpace: targetResolution.coordinateSpace,
    inputIsolation: targetResolution.inputIsolation,
    windowId: targetResolution.windowId,
    appName: targetResolution.appName,
    title: targetResolution.title,
    bounds: targetResolution.bounds,
    schedulerLockId: targetResolution.schedulerLockId,
    source: targetResolution.source,
    diagnostics: targetResolution.diagnostics.length ? targetResolution.diagnostics : undefined,
  };
}

function inputChannelDescription(config: VisionSenseConfig, targetResolution: WindowTargetResolution) {
  const executor = config.dryRun ? 'dry-run' : executorBoundary(config);
  if (!targetResolution.ok) return `generic-mouse-keyboard:${executor}:blocked-unresolved-window-target`;
  return [
    'generic-mouse-keyboard',
    executor,
    targetResolution.captureKind === 'window' ? 'target-window' : 'display',
    isWindowLocalCoordinateSpace(targetResolution.coordinateSpace) ? 'window-relative-grounding' : 'screen-relative-grounding',
    targetResolution.inputIsolation,
  ].join(':');
}

function schedulerStepMetadata(targetResolution: WindowTargetResolution, stepId: string): Record<string, unknown> {
  if (!targetResolution.ok) {
    return {
      mode: 'blocked',
      stepId,
      lockId: 'unresolved-window-target',
      reason: targetResolution.reason,
      diagnostics: targetResolution.diagnostics,
    };
  }
  return {
    mode: 'serialized-window-actions',
    stepId,
    lockId: targetResolution.schedulerLockId,
    captureKind: targetResolution.captureKind,
    inputIsolation: targetResolution.inputIsolation,
    failClosedIsolation: targetResolution.inputIsolation === 'require-focused-target',
    targetWindow: toTraceWindowTarget(targetResolution),
  };
}

function stepInputChannelMetadata(config: VisionSenseConfig, targetResolution: WindowTargetResolution): Record<string, unknown> {
  return {
    type: 'generic-mouse-keyboard',
    executor: config.dryRun ? 'dry-run-generic-gui-executor' : executorBoundary(config),
    isolation: targetResolution.ok ? targetResolution.inputIsolation : config.windowTarget.inputIsolation,
    targetBound: targetResolution.ok && targetResolution.captureKind === 'window',
  };
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

function platformActionIssue(action: GenericVisionAction, config: VisionSenseConfig) {
  if (!isDarwinPlatform(config.desktopPlatform)) return '';
  if (action.type === 'press_key' && isWindowsOnlyKey(action.key)) {
    return `VisionPlanner emitted Windows-only key "${action.key}" for desktopPlatform="${config.desktopPlatform}".`;
  }
  if (action.type === 'hotkey') {
    const badKey = action.keys.find(isWindowsOnlyKey);
    if (badKey) return `VisionPlanner emitted Windows-only hotkey modifier "${badKey}" for desktopPlatform="${config.desktopPlatform}".`;
  }
  return '';
}

function isWindowsOnlyKey(key: string) {
  return /^(win|windows|super|meta|start|search)$/i.test(key.trim());
}

function platformLauncherGuidance(platform: string) {
  if (isDarwinPlatform(platform)) {
    return 'For app launch on this configured platform, prefer open_app with appName. If open_app is unavailable for the configured executor, use command+space, type_text for the app name, then press_key Enter, or click a visibly present low-risk target.';
  }
  if (isWindowsPlatform(platform)) {
    return 'For app launch on this configured platform, prefer open_app with appName when the executor supports it; otherwise use a visible launcher/search control or a platform-compatible hotkey, then type_text for the app name and press_key Enter.';
  }
  return 'For app launch on this configured platform, prefer open_app with appName when the executor supports it; otherwise use a visible launcher/search control or platform-compatible keyboard flow, then type_text for the app name and press_key Enter.';
}

function platformLabel(platform: string) {
  if (isDarwinPlatform(platform)) return 'macOS';
  if (isWindowsPlatform(platform)) return 'Windows';
  if (/^linux$/i.test(platform)) return 'Linux';
  return platform;
}

function isDarwinPlatform(platform: string) {
  return /^(darwin|mac|macos|osx)$/i.test(platform.trim());
}

function isWindowsPlatform(platform: string) {
  return /^(win32|windows|win)$/i.test(platform.trim());
}

function supportsBuiltinDesktopBridge(platform: string) {
  return isDarwinPlatform(platform);
}

function trimLeadingWaitActions(actions: GenericVisionAction[], done: boolean) {
  if (done) return actions;
  const firstNonWait = actions.findIndex((action) => action.type !== 'wait');
  return firstNonWait > 0 ? actions.slice(firstNonWait) : actions;
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

function highRiskBlockReason(action: GenericVisionAction, config: VisionSenseConfig) {
  if (config.allowHighRiskActions) return '';
  if (action.requiresConfirmation || action.riskLevel === 'high') {
    return [
      'High-risk Computer Use action blocked before execution.',
      `Action type=${action.type}${action.targetDescription ? ` target="${action.targetDescription}"` : ''}.`,
      'Set an explicit upstream confirmation and SCIFORGE_VISION_ALLOW_HIGH_RISK_ACTIONS=1 only for trusted runs.',
    ].join(' ');
  }
  return '';
}

function groundingForAction(action: GenericVisionAction): Record<string, unknown> | undefined {
  const grounding = action.grounding && isRecord(action.grounding) ? action.grounding : {};
  if (action.type === 'click' || action.type === 'double_click') {
    return {
      status: 'provided',
      targetDescription: action.targetDescription,
      x: action.x,
      y: action.y,
      ...grounding,
    };
  }
  if (action.type === 'drag') {
    return {
      status: 'provided',
      targetDescription: action.targetDescription,
      fromX: action.fromX,
      fromY: action.fromY,
      toX: action.toX,
      toY: action.toY,
      ...grounding,
    };
  }
  if (action.targetDescription || Object.keys(grounding).length) {
    return {
      status: 'provided',
      targetDescription: action.targetDescription,
      ...grounding,
    };
  }
  return undefined;
}

function pixelDiffForScreenshotSets(beforeRefs: ScreenshotRef[], afterRefs: ScreenshotRef[]) {
  const pairs = beforeRefs.map((before) => {
    const after = afterRefs.find((candidate) => candidate.displayId === before.displayId);
    if (!after) {
      return {
        displayId: before.displayId,
        status: 'missing-after-screenshot',
        changedByteRatio: 1,
        possiblyNoEffect: false,
      };
    }
    return {
      displayId: before.displayId,
      beforeScreenshotRef: before.path,
      afterScreenshotRef: after.path,
      changedByteRatio: screenshotByteDiffRatio(before, after),
      possiblyNoEffect: before.sha256 === after.sha256,
    };
  });
  return {
    method: 'sha256-and-byte-diff',
    pairs,
    possiblyNoEffect: pairs.every((pair) => pair.possiblyNoEffect),
  };
}

function screenshotByteDiffRatio(before: ScreenshotRef, after: ScreenshotRef) {
  if (before.sha256 === after.sha256) return 0;
  try {
    const left = readFileSync(before.absPath);
    const right = readFileSync(after.absPath);
    if (left.length !== right.length) return 1;
    let changed = 0;
    for (let index = 0; index < left.length; index += 1) {
      if (left[index] !== right[index]) changed += 1;
    }
    return changed / Math.max(left.length, 1);
  } catch {
    return 1;
  }
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

function validateRuntimeTraceScreenshots(refs: ScreenshotRef[]) {
  const missingRefs = refs.filter((ref) => !ref.bytes || !ref.sha256 || !ref.width || !ref.height).map((ref) => ref.path);
  return {
    ok: missingRefs.length === 0,
    checkedRefs: refs.map((ref) => ref.path),
    missingRefs,
    invalidRefs: [],
    diagnostics: missingRefs.map((ref) => `invalid screenshot metadata: ${ref}`),
  };
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

async function executeGenericDesktopAction(action: GenericVisionAction, config: VisionSenseConfig, targetResolution: WindowTargetResolution) {
  if (!targetResolution.ok) {
    return {
      exitCode: 125,
      stdout: '',
      stderr: targetResolution.reason,
    };
  }
  if (isDarwinPlatform(config.desktopPlatform)) return executeGenericMacAction(action, targetResolution);
  return {
    exitCode: 126,
    stdout: '',
    stderr: [
      `No real generic GUI executor is configured for desktopPlatform="${config.desktopPlatform}".`,
      'Set visionSense.desktopPlatform to a supported local executor platform, enable dryRun, or add an executor adapter for this platform.',
    ].join(' '),
  };
}

function executorBoundary(config: VisionSenseConfig) {
  if (isDarwinPlatform(config.desktopPlatform)) return 'darwin-system-events-generic-gui-executor';
  return `${sanitizeId(config.desktopPlatform).toLowerCase()}-generic-gui-executor`;
}

async function executeGenericMacAction(action: GenericVisionAction, targetResolution: ResolvedWindowTarget) {
  if (action.type === 'open_app') {
    const openResult = await runCommand('open', ['-a', action.appName], { timeoutMs: 30000 });
    if (openResult.exitCode !== 0) return openResult;
    const activateResult = await activateMacApp(action.appName);
    return activateResult.exitCode === 0
      ? { ...activateResult, stdout: [openResult.stdout, activateResult.stdout].filter(Boolean).join('\n') }
      : {
          exitCode: activateResult.exitCode,
          stdout: [openResult.stdout, activateResult.stdout].filter(Boolean).join('\n'),
          stderr: activateResult.stderr || activateResult.stdout || `activate ${action.appName} failed with exit ${activateResult.exitCode}`,
        };
  }
  const isolation = await ensureMacInputTarget(action, targetResolution);
  if (isolation.exitCode !== 0) return isolation;
  if (action.type === 'click' || action.type === 'double_click' || action.type === 'drag' || action.type === 'scroll') {
    const swiftResult = await executeSwiftGuiAction(action);
    if (swiftResult.exitCode === 0) return swiftResult;
    const script = genericMacActionScript(action);
    const appleScriptResult = await runCommand('osascript', ['-e', script], { timeoutMs: 30000 });
    return appleScriptResult.exitCode === 0
      ? { ...appleScriptResult, stdout: [swiftResult.stdout, appleScriptResult.stdout].filter(Boolean).join('\n') }
      : {
          exitCode: appleScriptResult.exitCode,
          stdout: [swiftResult.stdout, appleScriptResult.stdout].filter(Boolean).join('\n'),
          stderr: [
            `Swift CGEvent executor failed: ${swiftResult.stderr || swiftResult.stdout || `exit ${swiftResult.exitCode}`}`,
            `System Events executor failed: ${appleScriptResult.stderr || appleScriptResult.stdout || `exit ${appleScriptResult.exitCode}`}`,
          ].join('\n'),
        };
  }
  const script = genericMacActionScript(action);
  return runCommand('osascript', ['-e', script], { timeoutMs: action.type === 'wait' ? Math.max(1000, (action.ms ?? 500) + 1000) : 30000 });
}

async function activateMacApp(appName: string) {
  let lastResult = { exitCode: 1, stdout: '', stderr: '' };
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    lastResult = await runCommand('osascript', ['-e', [
      `tell application ${appleScriptString(appName)} to activate`,
      'delay 0.35',
      'tell application "System Events" to get name of first application process whose frontmost is true',
    ].join('\n')], { timeoutMs: 30000 });
    const frontmost = lastResult.stdout.trim();
    if (lastResult.exitCode === 0 && frontmost === appName) {
      return { ...lastResult, stdout: `frontmost=${frontmost}` };
    }
    await sleep(250);
  }
  return {
    exitCode: lastResult.exitCode || 1,
    stdout: lastResult.stdout,
    stderr: lastResult.stderr || `App ${appName} did not become frontmost after open_app; frontmost=${lastResult.stdout.trim() || 'unknown'}`,
  };
}

async function ensureMacInputTarget(action: GenericVisionAction, targetResolution: ResolvedWindowTarget) {
  if (targetResolution.captureKind !== 'window') return { exitCode: 0, stdout: 'input-isolation=display-fallback', stderr: '' };
  if (action.type === 'wait') return { exitCode: 0, stdout: 'input-isolation=not-required-for-wait', stderr: '' };
  if (targetResolution.appName) {
    const activateResult = await activateMacApp(targetResolution.appName);
    if (activateResult.exitCode !== 0 && targetResolution.inputIsolation === 'require-focused-target') {
      return {
        exitCode: 125,
        stdout: activateResult.stdout,
        stderr: [
          'Input isolation failed before executing Computer Use action.',
          activateResult.stderr || `Could not focus target app ${targetResolution.appName}.`,
        ].join(' '),
      };
    }
  }
  if (targetResolution.inputIsolation !== 'require-focused-target') {
    return { exitCode: 0, stdout: 'input-isolation=best-effort', stderr: '' };
  }
  if (!targetResolution.appName) {
    return {
      exitCode: 125,
      stdout: '',
      stderr: 'Input isolation requires a target appName so the scheduler can verify focus before sending mouse/keyboard events.',
    };
  }
  const frontmost = await runCommand('osascript', ['-e', 'tell application "System Events" to get name of first application process whose frontmost is true'], { timeoutMs: 10000 });
  const frontmostApp = frontmost.stdout.trim();
  if (frontmost.exitCode === 0 && frontmostApp === targetResolution.appName) {
    return { exitCode: 0, stdout: `input-isolation=focused-target frontmost=${frontmostApp || 'unknown'}`, stderr: '' };
  }
  return {
    exitCode: 125,
    stdout: frontmost.stdout,
    stderr: [
      'Input isolation blocked Computer Use action because the focused window/app did not match the target window contract.',
      `expectedApp=${targetResolution.appName ?? 'unknown'} frontmost=${frontmostApp || 'unknown'}`,
    ].join(' '),
  };
}

async function executeSwiftGuiAction(action: GenericSwiftGuiAction) {
  const scriptPath = join(tmpdir(), `sciforge-gui-${randomUUID()}.swift`);
  await writeFile(scriptPath, swiftGuiActionScript(action), 'utf8');
  try {
    return await runCommand('swift', [scriptPath], { timeoutMs: 30000 });
  } finally {
    await unlink(scriptPath).catch(() => undefined);
  }
}

function swiftGuiActionScript(action: GenericSwiftGuiAction) {
  if (action.type === 'scroll') return swiftScrollActionScript(action);
  const clickCount = action.type === 'double_click' ? 2 : 1;
  const point = action.type === 'drag'
    ? { x: requiredCoordinate(action.fromX, 'fromX'), y: requiredCoordinate(action.fromY, 'fromY') }
    : { x: requiredCoordinate(action.x, 'x'), y: requiredCoordinate(action.y, 'y') };
  const dragTo = action.type === 'drag'
    ? { x: requiredCoordinate(action.toX, 'toX'), y: requiredCoordinate(action.toY, 'toY') }
    : undefined;
  return `
import CoreGraphics
import Foundation

let source = CGEventSource(stateID: .hidSystemState)

func postMove(_ x: Double, _ y: Double) {
  let point = CGPoint(x: x, y: y)
  CGEvent(mouseEventSource: source, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
}

func postClick(_ x: Double, _ y: Double) {
  let point = CGPoint(x: x, y: y)
  CGEvent(mouseEventSource: source, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
  usleep(50000)
  CGEvent(mouseEventSource: source, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
}

${dragTo
    ? `postMove(${point.x}, ${point.y})
usleep(50000)
let start = CGPoint(x: ${point.x}, y: ${point.y})
let end = CGPoint(x: ${dragTo.x}, y: ${dragTo.y})
CGEvent(mouseEventSource: source, mouseType: .leftMouseDown, mouseCursorPosition: start, mouseButton: .left)?.post(tap: .cghidEventTap)
usleep(100000)
CGEvent(mouseEventSource: source, mouseType: .leftMouseDragged, mouseCursorPosition: end, mouseButton: .left)?.post(tap: .cghidEventTap)
usleep(100000)
CGEvent(mouseEventSource: source, mouseType: .leftMouseUp, mouseCursorPosition: end, mouseButton: .left)?.post(tap: .cghidEventTap)
print("swift-cgevent drag ${point.x},${point.y} -> ${dragTo.x},${dragTo.y}")`
    : `postMove(${point.x}, ${point.y})
${Array.from({ length: clickCount }, () => `postClick(${point.x}, ${point.y})`).join('\n')}
print("swift-cgevent ${action.type} ${point.x},${point.y}")`}
`;
}

function swiftScrollActionScript(action: Extract<GenericVisionAction, { type: 'scroll' }>) {
  const amount = Math.max(1, Math.round(action.amount ?? 5));
  const pixelDelta = amount * 120;
  const vertical = action.direction === 'up' ? pixelDelta : action.direction === 'down' ? -pixelDelta : 0;
  const horizontal = action.direction === 'left' ? pixelDelta : action.direction === 'right' ? -pixelDelta : 0;
  return `
import CoreGraphics
import Foundation

let source = CGEventSource(stateID: .hidSystemState)
CGEvent(
  scrollWheelEvent2Source: source,
  units: .pixel,
  wheelCount: 2,
  wheel1: Int32(${vertical}),
  wheel2: Int32(${horizontal}),
  wheel3: 0
)?.post(tap: .cghidEventTap)
print("swift-cgevent scroll ${action.direction} ${amount}")
`;
}

function genericMacActionScript(action: GenericVisionAction) {
  if (action.type === 'wait') return `delay ${Math.max(0, action.ms ?? 500) / 1000}`;
  const lines = [
    'tell application "System Events"',
  ];
  if (action.type === 'click') {
    lines.push(`  click at {${Math.round(requiredCoordinate(action.x, 'x'))}, ${Math.round(requiredCoordinate(action.y, 'y'))}}`);
  } else if (action.type === 'double_click') {
    lines.push(`  click at {${Math.round(requiredCoordinate(action.x, 'x'))}, ${Math.round(requiredCoordinate(action.y, 'y'))}}`);
    lines.push(`  click at {${Math.round(requiredCoordinate(action.x, 'x'))}, ${Math.round(requiredCoordinate(action.y, 'y'))}}`);
  } else if (action.type === 'drag') {
    lines.push(`  mouse down at {${Math.round(requiredCoordinate(action.fromX, 'fromX'))}, ${Math.round(requiredCoordinate(action.fromY, 'fromY'))}}`);
    lines.push('  delay 0.1');
    lines.push(`  mouse up at {${Math.round(requiredCoordinate(action.toX, 'toX'))}, ${Math.round(requiredCoordinate(action.toY, 'toY'))}}`);
  } else if (action.type === 'type_text') {
    lines.push(`  keystroke ${appleScriptString(action.text)}`);
  } else if (action.type === 'press_key') {
    lines.push(`  ${keyStrokeScript(action.key)}`);
  } else if (action.type === 'hotkey') {
    const key = action.keys[action.keys.length - 1] || '';
    const modifiers = action.keys.slice(0, -1).map(appleScriptModifier).filter(Boolean);
    lines.push(`  ${keyStrokeScript(key, modifiers)}`);
  } else if (action.type === 'scroll') {
    if (action.direction === 'up') {
      lines.push('  key code 116');
    } else if (action.direction === 'down') {
      lines.push('  key code 121');
    } else if (action.direction === 'left') {
      lines.push('  key code 123');
    } else {
      lines.push('  key code 124');
    }
  }
  lines.push('end tell');
  return lines.join('\n');
}

function requiredCoordinate(value: number | undefined, name: string) {
  if (typeof value !== 'number') throw new Error(`Executable Computer Use action is missing ${name}`);
  return value;
}

function keyStrokeScript(key: string, modifiers: string[] = []) {
  const normalized = key.toLowerCase();
  const keyCodes: Record<string, number> = {
    return: 36,
    enter: 36,
    tab: 48,
    escape: 53,
    esc: 53,
    delete: 51,
    backspace: 51,
    space: 49,
    left: 123,
    right: 124,
    down: 125,
    up: 126,
  };
  const code = keyCodes[normalized];
  const modifierSuffix = modifiers.length ? ` using {${modifiers.join(', ')}}` : '';
  return code !== undefined
    ? `key code ${code}${modifierSuffix}`
    : `keystroke ${appleScriptString(key)}${modifierSuffix}`;
}

function appleScriptModifier(key: string) {
  const normalized = key.toLowerCase();
  if (normalized === 'cmd' || normalized === 'command' || normalized === 'meta') return 'command down';
  if (normalized === 'shift') return 'shift down';
  if (normalized === 'option' || normalized === 'alt') return 'option down';
  if (normalized === 'ctrl' || normalized === 'control') return 'control down';
  return '';
}

function parseGenericActions(value: unknown): GenericVisionAction[] {
  const parsed = typeof value === 'string'
    ? parseJson(value)
    : value;
  if (!Array.isArray(parsed)) return [];
  return parsed.map(normalizeGenericAction).filter((action): action is GenericVisionAction => Boolean(action));
}

function normalizeGenericAction(value: unknown): GenericVisionAction | undefined {
  if (!isRecord(value)) return undefined;
  const rawType = stringConfig(value.type, value.actionType, value.action, value.kind);
  if (!rawType) return undefined;
  const type = normalizeActionType(rawType);
  const metadata = genericActionMetadata(value);
  if (type === 'click' || type === 'double_click') {
    const x = numberConfig(value.x);
    const y = numberConfig(value.y);
    return x === undefined || y === undefined ? { type, ...metadata } : { type, x, y, ...metadata };
  }
  if (type === 'drag') {
    const fromX = numberConfig(value.fromX);
    const fromY = numberConfig(value.fromY);
    const toX = numberConfig(value.toX);
    const toY = numberConfig(value.toY);
    return [fromX, fromY, toX, toY].some((item) => item === undefined)
      ? {
          type,
          fromTargetDescription: stringConfig(value.fromTargetDescription, value.from_target_description, value.sourceDescription, value.source_description, value.fromTarget, value.source, value.targetDescription, value.target_description, value.target),
          toTargetDescription: stringConfig(value.toTargetDescription, value.to_target_description, value.destinationDescription, value.destination_description, value.targetDescription, value.target_description, value.toTarget, value.destination),
          ...metadata,
        }
      : { type, fromX: fromX as number, fromY: fromY as number, toX: toX as number, toY: toY as number, ...metadata };
  }
  if (type === 'type_text') return typeof value.text === 'string' ? { type, text: value.text, ...metadata } : undefined;
  if (type === 'press_key') {
    const key = stringConfig(value.key, value.keyName);
    return key ? { type, key, ...metadata } : undefined;
  }
  if (type === 'hotkey') {
    const keys = parseHotkeyKeys(value.keys, value.hotkey, value.shortcut, value.keyCombo, value.key_combo);
    return keys.length ? { type, keys, ...metadata } : undefined;
  }
  if (type === 'scroll') {
    const direction = normalizeScrollDirection(value);
    const amount = numberConfig(value.amount, value.scrollAmount, value.scroll_amount, value.delta, value.wheelDelta, value.wheel_delta);
    return direction ? { type, direction, amount, ...metadata } : undefined;
  }
  if (type === 'open_app') {
    const appName = stringConfig(value.appName, value.app_name, value.application, value.applicationName, value.name, value.target);
    return appName ? { type, appName, ...metadata } : undefined;
  }
  if (type === 'wait') return { type, ms: numberConfig(value.ms, value.durationMs, value.duration, value.amount), ...metadata };
  return undefined;
}

function genericActionMetadata(value: Record<string, unknown>): GenericActionMetadata {
  const riskLevel = value.riskLevel === 'low' || value.riskLevel === 'medium' || value.riskLevel === 'high'
    ? value.riskLevel
    : undefined;
  const requiresConfirmation = typeof value.requiresConfirmation === 'boolean' ? value.requiresConfirmation : undefined;
  return {
    targetDescription: stringConfig(value.targetDescription, value.target_description, value.target, value.description),
    grounding: isRecord(value.grounding) ? value.grounding : undefined,
    riskLevel,
    requiresConfirmation,
    confirmationText: stringConfig(value.confirmationText, value.confirmation_text),
  };
}

function normalizeActionType(value: string) {
  const normalized = value.trim().toLowerCase().replace(/[-\s]+/g, '_');
  if (normalized === 'doubleclick') return 'double_click';
  if (normalized === 'type' || normalized === 'input_text') return 'type_text';
  if (normalized === 'keypress') return 'press_key';
  if (normalized === 'openapp' || normalized === 'launch_app' || normalized === 'launchapp' || normalized === 'open_application') return 'open_app';
  return normalized;
}

function parseHotkeyKeys(...values: unknown[]) {
  for (const value of values) {
    const listed = toStringList(value);
    if (listed.length) return listed;
    if (typeof value === 'string' && value.trim()) {
      return value
        .split(/[+,\s]+/g)
        .map((key) => key.trim())
        .filter(Boolean);
    }
  }
  return [];
}

function normalizeScrollDirection(value: Record<string, unknown>): 'up' | 'down' | 'left' | 'right' | undefined {
  if (value.direction === 'up' || value.direction === 'down' || value.direction === 'left' || value.direction === 'right') {
    return value.direction;
  }
  const amount = numberConfig(value.scrollAmount, value.scroll_amount, value.delta, value.wheelDelta, value.wheel_delta);
  if (amount === undefined || amount === 0) return undefined;
  return amount < 0 ? 'up' : 'down';
}

function parseJson(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function extractChatCompletionContent(value: unknown) {
  if (!isRecord(value) || !Array.isArray(value.choices)) return '';
  const first = value.choices[0];
  if (!isRecord(first) || !isRecord(first.message)) return '';
  return typeof first.message.content === 'string' ? first.message.content : '';
}

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const direct = parseJson(trimmed);
  if (direct !== undefined) return direct;
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    const parsed = parseJson(fenced[1].trim());
    if (parsed !== undefined) return parsed;
  }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const parsed = parseJson(trimmed.slice(start, end + 1));
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

function toTraceScreenshotRef(ref: ScreenshotRef) {
  return {
    id: ref.id,
    type: 'screenshot',
    path: ref.path,
    displayId: ref.displayId,
    windowTarget: ref.windowTarget,
    width: ref.width,
    height: ref.height,
    sha256: ref.sha256,
    bytes: ref.bytes,
  };
}

function pngDimensions(bytes: Buffer) {
  if (bytes.length < 24) return undefined;
  if (bytes.readUInt32BE(0) !== 0x89504e47 || bytes.readUInt32BE(4) !== 0x0d0a1a0a) return undefined;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function envOrValue(...values: unknown[]) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function stringConfig(...values: unknown[]) {
  const value = envOrValue(...values);
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberConfig(...values: unknown[]) {
  const value = envOrValue(...values);
  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(numeric) ? numeric : undefined;
}

function booleanConfig(env: unknown, requestValue: unknown, fileValue: unknown, fallback: boolean) {
  const value = envOrValue(env, requestValue, fileValue);
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (/^(1|true|yes|on|enabled)$/i.test(value)) return true;
    if (/^(0|false|no|off|disabled)$/i.test(value)) return false;
  }
  return fallback;
}

function parseDisplayList(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item > 0);
  if (typeof value !== 'string') return [];
  return value.split(',').map((item) => Number(item.trim())).filter((item) => Number.isInteger(item) && item > 0);
}

async function detectCaptureDisplays() {
  if (process.platform !== 'darwin') return [1];
  const probe = await runCommand('screencapture', ['-x', '-D', '999999', '/dev/null'], { timeoutMs: 5000 });
  const range = String(probe.stderr || probe.stdout).match(/number from\s+(\d+)\s*-\s*(\d+)/i);
  if (range) {
    const start = Number(range[1]);
    const end = Number(range[2]);
    if (Number.isInteger(start) && Number.isInteger(end) && start > 0 && end >= start) {
      return Array.from({ length: end - start + 1 }, (_, index) => start + index);
    }
  }
  const primary = await runCommand('screencapture', ['-x', '-D', '1', '/dev/null'], { timeoutMs: 5000 });
  return primary.exitCode === 0 ? [1] : [1];
}

async function runCommand(command: string, args: string[], options: { timeoutMs: number }) {
  return await new Promise<{ exitCode: number; stdout: string; stderr: string }>((resolvePromise) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
    }, options.timeoutMs);
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (error) => {
      clearTimeout(timeout);
      resolvePromise({ exitCode: 127, stdout, stderr: stderr || error.message });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timeout);
      resolvePromise({ exitCode: code ?? (signal ? 143 : 1), stdout, stderr });
    });
  });
}

function sleep(ms: number) {
  return new Promise<void>((resolvePromise) => setTimeout(resolvePromise, ms));
}

function workspaceRel(workspace: string, absPath: string) {
  const resolvedWorkspace = resolve(workspace);
  const resolvedPath = resolve(absPath);
  if (resolvedPath === resolvedWorkspace) return '.';
  if (resolvedPath.startsWith(`${resolvedWorkspace}/`)) return resolvedPath.slice(resolvedWorkspace.length + 1);
  return resolvedPath;
}

function sanitizeId(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'vision-run';
}

function sha256(bytes: Buffer) {
  return createHash('sha256').update(bytes).digest('hex');
}

function appleScriptString(value: string) {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n')}"`;
}

function swiftString(value: string) {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n')}"`;
}

function swiftOptionalString(value: string | undefined) {
  return value ? `Optional(${swiftString(value)})` : 'nil';
}
