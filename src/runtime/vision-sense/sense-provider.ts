import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type { GatewayRequest } from '../runtime-types.js';
import { isRecord, toStringList, uniqueStrings } from '../gateway-utils.js';
import { parseGenericActions } from '../computer-use/actions.js';
import type { ComputerUseConfig as VisionSenseConfig } from '../computer-use/types.js';
import {
  booleanConfig,
  detectCaptureDisplays,
  envOrValue,
  numberConfig,
  parseDisplayList,
  stringConfig,
  supportsBuiltinDesktopBridge,
} from '../computer-use/utils.js';
import { parseWindowTarget } from '../computer-use/window-target.js';
import { VISION_TOOL_ID } from './trace-policy.js';

export function rebindWindowTargetForPromptAppAlias(config: VisionSenseConfig, prompt: string) {
  if (config.windowTarget.mode !== 'display' && config.windowTarget.mode !== 'active-window') return;
  const requestedAppName = requestedAppAliasForPrompt(prompt);
  if (!requestedAppName) return;
  config.windowTarget = {
    ...config.windowTarget,
    enabled: true,
    required: false,
    mode: 'app-window',
    appName: requestedAppName,
    coordinateSpace: config.windowTarget.coordinateSpace === 'screen' ? 'window-local' : config.windowTarget.coordinateSpace,
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

export function visionSenseSelected(request: GatewayRequest) {
  const selected = uniqueStrings([
    ...(request.selectedToolIds ?? []),
    ...toStringList(request.uiState?.selectedToolIds),
  ]);
  return selected.includes(VISION_TOOL_ID);
}

export function looksLikeComputerUseRequest(prompt: string) {
  return /computer\s*use|gui|desktop|screen|screenshot|mouse|keyboard|click|type|scroll|drag|browser|word|powerpoint|ppt|电脑|桌面|屏幕|截图|鼠标|键盘|点击|输入|滚动|拖拽|操作|使用|打开|创建|保存|文档|演示文稿|应用/i.test(prompt);
}

export async function loadVisionSenseConfig(workspace: string, request: GatewayRequest): Promise<VisionSenseConfig> {
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

function requestedAppAliasForPrompt(prompt: string): string | undefined {
  const primaryTask = primaryTaskLine(prompt);
  const aliases = parseVisionAppAliases();
  const requested = Object.entries(aliases)
    .sort((a, b) => b[0].length - a[0].length)
    .find(([alias]) => alias && promptAliasMatches(primaryTask, alias));
  if (requested) return requested[1];
  return undefined;
}

function promptAliasMatches(task: string, alias: string) {
  if (containsCjk(alias)) return task.includes(alias);
  return new RegExp(`(^|[^A-Za-z0-9_-])${escapeRegExp(alias)}([^A-Za-z0-9_-]|$)`, 'iu').test(task);
}

function containsCjk(value: string) {
  return /[\u3400-\u9FFF]/u.test(value);
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
