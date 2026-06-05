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
import { defaultMacBundleIdForAppName, parseWindowTarget } from '../computer-use/window-target.js';
import {
  looksLikeVisionSenseComputerUseRequest,
  parseVisionSenseAppAliases,
  requestedVisionSenseAppNameForPrompt,
} from '../../../packages/observe/vision/computer-use-runtime-policy.js';
import { VISION_TOOL_ID } from './trace-policy.js';

export function rebindWindowTargetForPromptAppAlias(config: VisionSenseConfig, prompt: string) {
  if (config.windowTarget.mode !== 'display' && config.windowTarget.mode !== 'active-window') return;
  const requestedAppName = requestedVisionSenseAppNameForPrompt(prompt, parseVisionAppAliases());
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
    bundleId: defaultMacBundleIdForAppName(requestedAppName),
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
  return looksLikeVisionSenseComputerUseRequest(prompt);
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
    independentInputAdapterProvider: stringConfig(
      requestConfig.independentInputAdapterProvider,
      requestConfig.inputAdapterProvider,
      process.env.SCIFORGE_VISION_INDEPENDENT_INPUT_ADAPTER_PROVIDER,
      fileConfig.independentInputAdapterProvider,
      fileConfig.inputAdapterProvider,
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
    visibleTextExtraction: parseVisibleTextExtractionConfig(requestConfig, fileConfig),
    completionPolicy: parseCompletionPolicy(envOrValue(requestConfig.completionPolicy, fileConfig.completionPolicy)),
    planner: {
      profile: stringConfig(
        process.env.SCIFORGE_COMPUTER_USE_PLANNER_PROFILE,
        requestConfig.plannerProfile,
        fileConfig.plannerProfile,
      ),
      allowOpenAiRuntime: booleanConfig(
        process.env.SCIFORGE_COMPUTER_USE_PLANNER_ALLOW_OPENAI_RUNTIME,
        requestConfig.plannerAllowOpenAiRuntime,
        fileConfig.plannerAllowOpenAiRuntime,
        false,
      ),
      timeoutMs: numberConfig(process.env.SCIFORGE_COMPUTER_USE_PLANNER_TIMEOUT_MS, requestConfig.plannerTimeoutMs, fileConfig.plannerTimeoutMs) ?? 120000,
      maxTokens: numberConfig(process.env.SCIFORGE_COMPUTER_USE_PLANNER_MAX_TOKENS, requestConfig.plannerMaxTokens, fileConfig.plannerMaxTokens) ?? 512,
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
    },
    testActionFixtureMode: booleanConfig(
      process.env.SCIFORGE_VISION_TEST_ACTION_FIXTURES,
      requestConfig.testActionFixtureMode,
      fileConfig.testActionFixtureMode,
      false,
    ),
    testOnlyPlannedActions: parseTestOnlyActions(requestConfig, fileConfig),
  };
}

function parseVisibleTextExtractionConfig(
  requestConfig: Record<string, unknown>,
  fileConfig: Record<string, unknown>,
): VisionSenseConfig['visibleTextExtraction'] {
  const requestVisibleText = isRecord(requestConfig.visibleTextExtraction) ? requestConfig.visibleTextExtraction : {};
  const fileVisibleText = isRecord(fileConfig.visibleTextExtraction) ? fileConfig.visibleTextExtraction : {};
  const enabled = booleanConfig(
    process.env.SCIFORGE_VISION_EXTRACT_VISIBLE_TEXT,
    envOrValue(requestConfig.extractVisibleText, requestConfig.enableVisibleTextExtraction, requestVisibleText.enabled),
    envOrValue(fileConfig.extractVisibleText, fileConfig.enableVisibleTextExtraction, fileVisibleText.enabled),
    false,
  );
  return {
    enabled,
    provider: 'macos-vision-framework-ocr',
    maxItems: numberConfig(
      process.env.SCIFORGE_VISION_VISIBLE_TEXT_MAX_ITEMS,
      requestVisibleText.maxItems,
      requestVisibleText.limit,
      fileVisibleText.maxItems,
      fileVisibleText.limit,
    ) ?? 24,
  };
}

function parseVisionAppAliases(): Record<string, string> {
  return parseVisionSenseAppAliases(process.env.SCIFORGE_VISION_APP_ALIASES_JSON);
}

function normalizeGrounderUploadStrategy(value: string | undefined): 'scp' | 'inline' | 'file-ref' | undefined {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'scp') return 'scp';
  if (normalized === 'inline' || normalized === 'base64') return 'inline';
  if (normalized === 'file-ref' || normalized === 'ref' || normalized === 'shared-path') return 'file-ref';
  return undefined;
}

function parseTestOnlyActions(
  requestConfig: Record<string, unknown>,
  fileConfig: Record<string, unknown>,
) {
  const enabled = booleanConfig(
    process.env.SCIFORGE_VISION_TEST_ACTION_FIXTURES,
    requestConfig.testActionFixtureMode,
    fileConfig.testActionFixtureMode,
    false,
  );
  if (!enabled) return [];
  return parseGenericActions(envOrValue(
    requestConfig.testOnlyActions,
    requestConfig.testOnlyPlannedActions,
    process.env.SCIFORGE_VISION_TEST_ACTIONS_JSON,
    fileConfig.testOnlyActions,
    fileConfig.testOnlyPlannedActions,
  ));
}

function parseCompletionPolicy(value: unknown): VisionSenseConfig['completionPolicy'] {
  if (!isRecord(value)) return undefined;
  const mode = stringConfig(value.mode, value.completionMode, value.kind);
  if (mode === 'one-successful-non-wait-action' || mode === 'planner-confirmed') {
    return {
      mode,
      reason: stringConfig(value.reason),
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
