import type {
  FeedbackIssueHandoffBundle,
  FeedbackIssueSummary,
  FeedbackCommentRecord,
  FeedbackEvidenceAssetRecord,
  FeedbackRepairActionRecord,
  FeedbackRepairGuidanceRecord,
  FeedbackRepairResultRecord,
  FeedbackRepairRunRecord,
  SciForgeConfig,
  SciForgeInstanceManifest,
  SciForgeWorkspaceWriterHealth,
  SciForgeWorkspaceState,
  PreviewDescriptor,
  PreviewDerivative,
  RuntimeExecutionUnit,
  RuntimeCodexBrowserAcceptanceManifest,
  RuntimeProviderPreflightManifest,
  TaskRunCard,
} from '../domain';
import type { ScenarioLibraryState } from '@sciforge/scenario-core/scenario-library';
import type { ScenarioPackage } from '@sciforge/scenario-core/scenario-package';
import { parseWorkspaceState } from '../sessionStore';
import { LEGACY_DEFAULT_WORKSPACE_WRITER_URL, defaultSciForgeConfig, normalizeConfig, normalizeWorkspaceRootPath } from '../config';
import { SciForgeClientError, reasonFromResponseText, recoverActionsForService } from './clientError';
export type { AgentHostModuleCallResult as WorkspaceModuleCallResult } from './agentHostModuleClient';
export {
  describeAgentHostModule as describeWorkspaceModule,
  invokeAgentHostModule as invokeWorkspaceModule,
  queryAgentHostModule as queryWorkspaceModule,
  readAgentHostModule as readWorkspaceModule,
} from './agentHostModuleClient';

export interface WorkspaceEntry {
  name: string;
  path: string;
  kind: 'file' | 'folder';
  size?: number;
  modifiedAt?: string;
}

export interface WorkspaceFileContent {
  path: string;
  name: string;
  content: string;
  size: number;
  modifiedAt?: string;
  language: string;
  encoding?: 'utf8' | 'base64';
  mimeType?: string;
}

export interface WorkspaceOpenResult {
  ok: boolean;
  action: 'open-external' | 'reveal-in-folder' | 'copy-path';
  path: string;
  workspacePath: string;
  dryRun?: boolean;
}

export interface WorkspaceScenarioListItem {
  id: string;
  version: string;
  status: string;
  title: string;
  description: string;
  skillDomain: string;
}

export interface WorkspaceTaskAttemptRecord {
  id: string;
  prompt: string;
  skillDomain: string;
  skillId?: string;
  scenarioPackageRef?: RuntimeExecutionUnit['scenarioPackageRef'];
  skillPlanRef?: string;
  uiPlanRef?: string;
  runtimeProfileId?: string;
  routeDecision?: RuntimeExecutionUnit['routeDecision'];
  attempt: number;
  parentAttempt?: number;
  status: RuntimeExecutionUnit['status'];
  codeRef?: string;
  inputRef?: string;
  outputRef?: string;
  stdoutRef?: string;
  stderrRef?: string;
  failureReason?: string;
  schemaErrors?: string[];
  taskRunCard?: TaskRunCard;
  createdAt: string;
}

type WorkspacePreviewCacheEntry<T> = {
  promise?: Promise<T>;
  staleError?: Error;
  staleAt?: number;
};

const WORKSPACE_PREVIEW_STALE_STATUS_CODES = new Set([400, 404]);
const WORKSPACE_PREVIEW_STALE_CACHE_TTL_MS = 5 * 60 * 1000;
export const BROWSER_HOST_WRITER_PREFLIGHT_TIMEOUT_MS = 6000;
export const BROWSER_HOST_WRITER_START_PREFLIGHT_TIMEOUT_MS = 1500;
const workspaceFileReadCache = new Map<string, WorkspacePreviewCacheEntry<WorkspaceFileContent>>();
const previewDescriptorReadCache = new Map<string, WorkspacePreviewCacheEntry<PreviewDescriptor>>();
const previewDerivativeReadCache = new Map<string, WorkspacePreviewCacheEntry<PreviewDerivative>>();
let workspacePreviewCacheGeneration = 0;

export interface SkillPromotionProposalRecord {
  id: string;
  status: 'draft' | 'needs-user-confirmation' | 'accepted' | 'rejected' | 'archived';
  createdAt: string;
  statusUpdatedAt?: string;
  statusReason?: string;
  source: {
    workspacePath: string;
    taskCodeRef: string;
    inputRef?: string;
    outputRef?: string;
    stdoutRef?: string;
    stderrRef?: string;
    successfulExecutionUnitRefs: string[];
  };
  proposedManifest: {
    id: string;
    description: string;
    skillDomains: string[];
    validationSmoke?: Record<string, unknown>;
    promotionHistory?: Array<Record<string, unknown>>;
  };
  validationPlan: {
    smokePrompts: string[];
    expectedArtifactTypes: string[];
    requiredEnvironment: Record<string, unknown>;
    rerunAfterAccept?: Record<string, unknown>;
  };
  securityGate?: {
    passed: boolean;
    checks: Record<string, boolean>;
    findings: string[];
  };
  reviewChecklist: Record<string, boolean>;
}

export interface SkillPromotionValidationResult {
  passed: boolean;
  skillId: string;
  exitCode: number;
  outputRef: string;
  stdoutRef: string;
  stderrRef: string;
  schemaErrors: string[];
  expectedArtifactTypes: string[];
  artifactTypes: string[];
  missingArtifactTypes: string[];
}

export type FeedbackRepairResultInput = Pick<FeedbackRepairResultRecord, 'verdict' | 'summary'> & Partial<Omit<FeedbackRepairResultRecord, 'schemaVersion' | 'issueId' | 'verdict' | 'summary' | 'completedAt'>>;

export interface FeedbackCommentEvidenceBundle {
  schemaVersion: 1;
  id: string;
  commentRef: string;
  evidenceBundleRef: string;
  rawScreenshotRef?: string;
  annotatedScreenshotRef?: string;
  evidenceAssets?: FeedbackEvidenceAssetRecord[];
  comment?: FeedbackCommentRecord;
}

export interface FeedbackEvidenceUploadInput {
  repo?: string;
  token?: string;
  branch?: string;
  commitMessage?: string;
  workspacePath?: string;
}

export interface FeedbackEvidenceUploadResult {
  schemaVersion: 1;
  issueId: string;
  evidenceFolderRef?: string;
  evidenceAssets: FeedbackEvidenceAssetRecord[];
  uploadedAssets: FeedbackEvidenceAssetRecord[];
  comment?: FeedbackCommentRecord;
  diagnostics?: string[];
}

export interface FeedbackRepairHandoffRunInput {
  executorInstance: {
    id?: string;
    name?: string;
    appUrl?: string;
    workspaceWriterUrl?: string;
    workspacePath?: string;
  };
  targetInstance: {
    id?: string;
    name?: string;
    appUrl?: string;
    workspaceWriterUrl?: string;
    workspacePath?: string;
  };
  targetWorkspacePath: string;
  targetWorkspaceWriterUrl: string;
  issueBundle: FeedbackIssueHandoffBundle;
  expectedTests: Array<string | { name?: string; command: string }>;
  githubSyncRequired: boolean;
  repairRunId?: string;
  executorBackend?: 'agent-server' | 'runtime-codex';
  runtimeProfile?: string;
  allowOpenAiRuntime?: boolean;
  gitMode?: 'manual' | 'auto';
  allowExecutorRepoTarget?: boolean;
  initialGuidance?: string;
  allowedWritePaths?: string[];
  forbiddenWritePaths?: string[];
  requestMetadata?: Record<string, unknown>;
  confirmationPolicy?: {
    commit: 'disabled' | 'requires-user-confirmation';
    push: 'disabled' | 'requires-second-confirmation';
    pr: 'disabled' | 'requires-second-confirmation';
    merge: 'disabled' | 'never';
  };
}

export interface FeedbackRepairActionInput {
  action: FeedbackRepairActionRecord['action'];
  resultId?: string;
  confirmed?: boolean;
  secondConfirmed?: boolean;
  safeModeConfirmed?: boolean;
  browserVerification?: FeedbackRepairActionRecord['browserVerification'];
}

export interface FeedbackRepairTerminalMirrorEntry {
  timestamp: string;
  stream: 'stdout' | 'stderr' | 'event';
  text: string;
}

export interface FeedbackRepairTerminalMirrorTail {
  terminalMirrorRef: string;
  entries: FeedbackRepairTerminalMirrorEntry[];
  cursor: number;
  nextCursor: number;
  totalEntries: number;
}

export interface FeedbackRepairStopResult {
  repairRunId: string;
  status: 'cancel-requested' | 'blocked' | 'not-running';
  stopped: boolean;
  message: string;
  terminalMirrorRef?: string;
  executorMode?: 'agent-server' | 'runtime-codex';
}

export interface FeedbackRepairGuidanceInput {
  repairRunId: string;
  repairResultId?: string;
  message: string;
  terminalMirrorRef?: string;
  codexSessionId?: string;
  workspacePath?: string;
}

export interface FeedbackRepairGuidanceResult {
  guidance: FeedbackRepairGuidanceRecord;
}

export type FeedbackCodexTerminalStatus = 'starting' | 'running' | 'idle' | 'failed' | 'cancelled';
export type FeedbackCodexTerminalTransport = 'websocket-pty' | 'system-terminal';

export interface FeedbackCodexTerminalSession {
  schemaVersion: 1;
  id: string;
  issueId: string;
  repairRunId: string;
  status: FeedbackCodexTerminalStatus;
  workspacePath: string;
  terminalMirrorRef: string;
  promptRef: string;
  promptPreview?: string;
  codexSessionId?: string;
  startedAt: string;
  updatedAt: string;
  message?: string;
  runtimeProfile?: string;
  allowOpenAiRuntime?: boolean;
  transport: FeedbackCodexTerminalTransport;
  webSocketPath?: string;
  systemTerminalLaunchRef?: string;
  systemTerminalCommandPreview?: string;
}

export interface FeedbackCodexPtyTerminalStartResult {
  session: FeedbackCodexTerminalSession;
  repairRun?: FeedbackRepairRunRecord;
}

export type WorkspaceTerminalStatus = 'starting' | 'running' | 'idle' | 'failed' | 'cancelled';
export const WORKSPACE_TERMINAL_WEBSOCKET_PTY_CAPABILITY = 'workspace-terminal-websocket-pty';
export const BROWSER_HOST_SESSION_CAPABILITY = 'browser-host-session';
export const BROWSER_HOST_NATIVE_SURFACE_CAPABILITY = 'browser-host-native-surface';
export const BROWSER_HOST_SEARCH_CAPABILITY = 'browser-host-search';
const BROWSER_HOST_REQUIRED_CAPABILITIES = [
  BROWSER_HOST_SESSION_CAPABILITY,
  BROWSER_HOST_NATIVE_SURFACE_CAPABILITY,
  BROWSER_HOST_SEARCH_CAPABILITY,
] as const;
const BROWSER_HOST_SESSION_REQUIRED_ENDPOINT_TOKENS = [
  'start',
  'state',
  'actions',
  'computer-use-actions',
] as const;
const BROWSER_HOST_NATIVE_SURFACE_REQUIRED_ENDPOINT_TOKENS = [
  'health',
  'attach',
  'state',
] as const;
const BROWSER_HOST_SEARCH_REQUIRED_ENDPOINT_TOKEN = 'browser-host/search';

export interface WorkspaceTerminalSession {
  schemaVersion: 1;
  id: string;
  status: WorkspaceTerminalStatus;
  workspacePath: string;
  cwd: string;
  shell: string;
  transcriptRef: string;
  startedAt: string;
  updatedAt: string;
  message?: string;
  webSocketPath: string;
  workspaceWriterBaseUrl?: string;
}

export interface WorkspaceTerminalStartResult {
  session: WorkspaceTerminalSession;
}

export type WorkspaceTerminalWriterPreflightStatus =
  | 'ready'
  | 'invalid-url'
  | 'offline'
  | 'ui-html'
  | 'http-error'
  | 'invalid-json'
  | 'unexpected-service'
  | 'missing-terminal-capability';

export interface WorkspaceTerminalWriterCandidate {
  label: string;
  baseUrl: string;
  displayUrl: string;
  ok: boolean;
  status: WorkspaceTerminalWriterPreflightStatus;
  message: string;
  health?: SciForgeWorkspaceWriterHealth;
}

export interface WorkspaceTerminalWriterPreflightResult {
  ok: boolean;
  status: WorkspaceTerminalWriterPreflightStatus;
  configuredBaseUrl: string;
  configuredDisplayUrl: string;
  effectiveBaseUrl?: string;
  effectiveDisplayUrl?: string;
  recommendedBaseUrl?: string;
  recommendedDisplayUrl?: string;
  message: string;
  diagnosticRef: string;
  candidates: WorkspaceTerminalWriterCandidate[];
  health?: SciForgeWorkspaceWriterHealth;
}

export type BrowserHostSessionWriterPreflightStatus =
  | 'ready'
  | 'invalid-url'
  | 'offline'
  | 'ui-html'
  | 'http-error'
  | 'invalid-json'
  | 'unexpected-service'
  | 'missing-browser-host-capability';

export interface BrowserHostSessionWriterCandidate {
  label: string;
  baseUrl: string;
  displayUrl: string;
  ok: boolean;
  status: BrowserHostSessionWriterPreflightStatus;
  message: string;
  health?: SciForgeWorkspaceWriterHealth;
}

export interface BrowserHostSessionWriterPreflightResult {
  ok: boolean;
  status: BrowserHostSessionWriterPreflightStatus;
  configuredBaseUrl: string;
  configuredDisplayUrl: string;
  effectiveBaseUrl?: string;
  effectiveDisplayUrl?: string;
  recommendedBaseUrl?: string;
  recommendedDisplayUrl?: string;
  message: string;
  diagnosticRef: string;
  candidates: BrowserHostSessionWriterCandidate[];
  health?: SciForgeWorkspaceWriterHealth;
}

export type BrowserHostSessionStatus = 'starting' | 'loading' | 'ready' | 'failed' | 'closed';
export type BrowserHostSessionAction = 'navigate' | 'back' | 'forward' | 'reload' | 'stop' | 'click' | 'double-click' | 'mouse-down' | 'mouse-move' | 'mouse-up' | 'drag' | 'type' | 'press' | 'scroll' | 'cursor' | 'snapshot' | 'state' | 'close';
export type BrowserHostSessionCaptureMode = 'full' | 'frame' | 'none';
export type BrowserHostSessionLiveSurfaceTransport = 'host-stream' | 'native-embedded' | 'webrtc-data-channel';
export type BrowserHostMouseButton = 'left' | 'right' | 'middle';
export type BrowserHostSessionLoadingProgressState = 'navigation-start' | 'navigation-committed' | 'interactive' | 'load' | 'network-quiet' | 'stalled' | 'blocked' | 'retry' | 'handoff';
export type BrowserHostSessionLoadingProgressReason = 'navigation-requested' | 'navigation-committed' | 'page-interactive' | 'page-load' | 'network-quiet' | 'navigation-stalled' | 'navigation-blocked' | 'navigation-retry' | 'user-handoff-required' | 'host-starting' | 'host-loading' | 'host-ready' | 'host-error' | 'host-diagnostic';
export type BrowserHostSessionLoadingProgressSource = 'host-lifecycle' | 'host-progress' | 'host-navigation' | 'host-action-timing' | 'host-state' | 'host-session' | 'host-error';
export type BrowserHostComputerUseAction =
  | { type: 'click'; x?: number; y?: number; targetDescription?: string }
  | { type: 'double_click'; x?: number; y?: number; targetDescription?: string }
  | { type: 'drag'; fromX?: number; fromY?: number; toX?: number; toY?: number; targetDescription?: string }
  | { type: 'mouse_down'; x?: number; y?: number; button?: BrowserHostMouseButton; targetDescription?: string }
  | { type: 'mouse_move'; x?: number; y?: number; targetDescription?: string }
  | { type: 'mouse_up'; x?: number; y?: number; button?: BrowserHostMouseButton; targetDescription?: string }
  | { type: 'type_text'; text: string; targetDescription?: string }
  | { type: 'press_key'; key: string; targetDescription?: string }
  | { type: 'hotkey'; keys: string[]; targetDescription?: string }
  | { type: 'scroll'; direction: 'up' | 'down' | 'left' | 'right'; amount?: number; targetDescription?: string }
  | { type: 'wheel'; x?: number; y?: number; deltaX?: number; deltaY?: number; targetDescription?: string }
  | { type: 'cursor'; x?: number; y?: number; targetDescription?: string }
  | { type: 'wait'; ms?: number; targetDescription?: string };

export interface BrowserHostSessionLoadingProgress {
  schemaVersion: 'sciforge.browser-host-session.loading-progress.lifecycle.v1';
  state: BrowserHostSessionLoadingProgressState;
  reason: BrowserHostSessionLoadingProgressReason;
  source: BrowserHostSessionLoadingProgressSource;
  status: BrowserHostSessionStatus;
  action?: BrowserHostSessionAction | 'open';
  updatedAt: string;
  refs: {
    session?: string;
    liveSurface?: string;
    frameStream?: string;
    frame?: string;
    screenshot?: string;
    domSnapshot?: string;
    axSnapshot?: string;
    consoleLog?: string;
    networkLog?: string;
    searchResult?: string;
  };
  urls?: {
    requested?: { length: number; sha1: string };
    current?: { length: number; sha1: string };
    final?: { length: number; sha1: string };
  };
  canRetry?: boolean;
  blocked?: boolean;
  requiresHandoff?: boolean;
}

export interface BrowserHostSessionState {
  schemaVersion: 'sciforge.browser-host-session.state.v1';
  id: string;
  owner: 'host';
  providerId: 'sciforge.browser-host-session';
  status: BrowserHostSessionStatus;
  workspacePath: string;
  requestedUrl: string;
  url: string;
  title?: string;
  startedAt: string;
  updatedAt: string;
  viewport: { width: number; height: number };
  canGoBack: boolean;
  canGoForward: boolean;
  liveSurfaceRef?: string;
  liveSurfaceTransport?: BrowserHostSessionLiveSurfaceTransport;
  nativeAdapterUrl?: string;
  singleInteractiveTruth?: true;
  frameStreamRef?: string;
  frameRef?: string;
  frameUrl?: string;
  screenshotRef?: string;
  domSnapshotRef?: string;
  axSnapshotRef?: string;
  consoleLogRef?: string;
  networkLogRef?: string;
  searchResultRef?: string;
  workspaceWriterBaseUrl?: string;
  cursor?: string;
  loadingProgress?: BrowserHostSessionLoadingProgress;
  lastActionTiming?: BrowserHostSessionActionTiming;
  actionTimingSummary?: BrowserHostSessionActionTimingSummary[];
  diagnostics: string[];
}

export interface BrowserHostSessionActionTiming {
  actionId: string;
  action: BrowserHostSessionAction | 'open';
  capture: BrowserHostSessionCaptureMode;
  status: 'ok' | 'failed';
  uiEventReceivedAt?: string;
  adapterSentAt?: string;
  hostReceivedAt: string;
  hostStartedAt: string;
  hostActionEndedAt?: string;
  evidenceCaptureStartedAt?: string;
  evidenceCaptureEndedAt?: string;
  hostCompletedAt: string;
  adapterToHostMs?: number;
  queueMs: number;
  hostActionMs: number;
  evidenceMs?: number;
  totalMs: number;
  liveSurfaceTransport?: BrowserHostSessionLiveSurfaceTransport;
  paintAckSource?: 'native-adapter-action-state' | 'host-stream-frame' | 'none';
  blockedReason?: string;
}

export interface BrowserHostSessionActionTimingSummary {
  action: BrowserHostSessionAction | 'open';
  count: number;
  p50Ms: number;
  p95Ms: number;
  lastMs: number;
}

export interface BrowserHostSessionStartResult {
  session: BrowserHostSessionState;
  preflight?: BrowserHostSessionWriterPreflightResult;
  runtimeStart?: { ok: boolean; services: Array<Record<string, unknown>>; error?: string };
}

export interface BrowserHostComputerUseActionResult {
  schemaVersion: 'sciforge.browser-host-session.computer-use-action.v1';
  providerId: 'sciforge.browser-host-session.computer-use-adapter';
  inputChannel: 'browser-host-session';
  userDeviceImpact: 'none';
  sharedSystemInputUsed: false;
  systemMouseEvents: 'not-sent';
  systemKeyboardEvents: 'not-sent';
  liveBrowserOwner?: 'BrowserHostSession';
  singleInteractiveTruth?: true;
  hostAction: {
    action: BrowserHostSessionAction;
    capture?: BrowserHostSessionCaptureMode;
    x?: number;
    y?: number;
    button?: BrowserHostMouseButton;
    path?: Array<{ x: number; y: number }>;
    text?: string;
    key?: string;
    deltaX?: number;
    deltaY?: number;
  };
  session: BrowserHostSessionState;
}

export interface BrowserHostSearchResultItem {
  title: string;
  url: string;
  snippet: string;
}

export interface BrowserHostSearchResult {
  schemaVersion: 'sciforge.browser-host-session.search-result.v1';
  query: string;
  sessionId?: string;
  engine: 'bing' | 'duckduckgo';
  searchUrl: string;
  finalUrl: string;
  results: BrowserHostSearchResultItem[];
  session: BrowserHostSessionState;
  searchResultRef: string;
  screenshotRef?: string;
  domSnapshotRef?: string;
  axSnapshotRef?: string;
  consoleLogRef?: string;
  networkLogRef?: string;
}

export async function loadFileBackedSciForgeConfig(config: SciForgeConfig): Promise<SciForgeConfig | undefined> {
  const response = await fetchWorkspaceConfigWithFallback(config);
  if (response.status === 404) return undefined;
  const json = await readWorkspaceJson<{ config?: unknown }>(
    config,
    'load config.local.json',
    response,
    `Load config failed: HTTP ${response.status}`,
  );
  return isSciForgeConfig(json.config) ? normalizeConfig(json.config) : undefined;
}

async function fetchWorkspaceConfigWithFallback(config: SciForgeConfig): Promise<Response> {
  const primaryUrl = `${config.workspaceWriterBaseUrl}/api/sciforge/config`;
  try {
    return await fetchWorkspace(config, 'load config.local.json', primaryUrl);
  } catch (error) {
    const fallbackBaseUrl = defaultSciForgeConfig.workspaceWriterBaseUrl;
    if (config.workspaceWriterBaseUrl === fallbackBaseUrl) throw error;
    return await fetchWorkspace(
      { ...config, workspaceWriterBaseUrl: fallbackBaseUrl },
      'load config.local.json from default Workspace Writer',
      `${fallbackBaseUrl}/api/sciforge/config`,
    );
  }
}

export async function saveFileBackedSciForgeConfig(config: SciForgeConfig): Promise<SciForgeConfig | undefined> {
  const response = await fetchWorkspace(config, 'save config.local.json', `${config.workspaceWriterBaseUrl}/api/sciforge/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config }),
  });
  const json = await readWorkspaceJson<{ config?: unknown }>(
    config,
    'save config.local.json',
    response,
    `Save config failed: HTTP ${response.status}`,
  );
  return isSciForgeConfig(json.config) ? normalizeConfig(json.config) : undefined;
}

export async function startRuntimeServices(): Promise<{ ok: boolean; services: Array<Record<string, unknown>>; error?: string }> {
  const response = await fetch('/api/sciforge/runtime/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  const json = await response.json().catch(() => ({})) as { ok?: boolean; services?: Array<Record<string, unknown>>; error?: string };
  if (!response.ok) throw new Error(json.error || `Start runtime services failed: HTTP ${response.status}`);
  return {
    ok: json.ok === true,
    services: Array.isArray(json.services) ? json.services : [],
    error: json.error,
  };
}

export async function persistWorkspaceState(state: SciForgeWorkspaceState, config: SciForgeConfig): Promise<void> {
  const workspacePath = normalizeWorkspaceRootPath(state.workspacePath);
  if (!workspacePath) return;
  const normalizedState = { ...state, workspacePath };
  const operation = `snapshot workspace ${workspacePath}`;
  const response = await fetchWorkspace(config, operation, `${config.workspaceWriterBaseUrl}/api/sciforge/workspace/snapshot`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspacePath,
      state: normalizedState,
      config: { ...config, workspacePath: normalizeWorkspaceRootPath(config.workspacePath) },
    }),
  });
  if (!response.ok) {
    throw new Error(await workspaceResponseError(response, `Workspace writer failed: HTTP ${response.status}`));
  }
}

function isSciForgeConfig(value: unknown): value is SciForgeConfig {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return record.schemaVersion === 1
    && typeof record.agentServerBaseUrl === 'string'
    && typeof record.workspaceWriterBaseUrl === 'string'
    && typeof record.workspacePath === 'string'
    && (record.peerInstances === undefined || Array.isArray(record.peerInstances))
    && typeof record.modelProvider === 'string'
    && typeof record.modelBaseUrl === 'string'
    && typeof record.modelName === 'string'
    && typeof record.apiKey === 'string'
    && typeof record.requestTimeoutMs === 'number'
    && (record.maxContextWindowTokens === undefined || typeof record.maxContextWindowTokens === 'number')
    && (record.visionAllowSharedSystemInput === undefined || typeof record.visionAllowSharedSystemInput === 'boolean')
    && (record.toolProviderRoutes === undefined || (typeof record.toolProviderRoutes === 'object' && record.toolProviderRoutes !== null && !Array.isArray(record.toolProviderRoutes)))
    && typeof record.updatedAt === 'string';
}

export async function loadPersistedWorkspaceState(path: string, config: SciForgeConfig): Promise<SciForgeWorkspaceState | undefined> {
  if (path.trim()) return fetchPersistedWorkspaceState(path, config);
  return fetchPersistedWorkspaceState('', config);
}

export async function loadPersistedWorkspaceStateForProject(
  path: string,
  config: SciForgeConfig,
  writerBaseUrl: string,
): Promise<SciForgeWorkspaceState | undefined> {
  const normalizedPath = normalizeWorkspaceRootPath(path);
  const normalizedWriter = writerBaseUrl.trim();
  if (!normalizedPath || !normalizedWriter) return undefined;
  return fetchPersistedWorkspaceState(normalizedPath, {
    ...config,
    workspacePath: normalizedPath,
    workspaceWriterBaseUrl: normalizedWriter,
  });
}

async function fetchPersistedWorkspaceState(path: string, config: SciForgeConfig): Promise<SciForgeWorkspaceState | undefined> {
  const url = new URL(`${config.workspaceWriterBaseUrl}/api/sciforge/workspace/snapshot`);
  if (path.trim()) url.searchParams.set('path', path);
  const label = path.trim() || 'last workspace';
  const response = await fetchWorkspace(config, `load workspace snapshot ${label}`, url);
  if (response.status === 404) return undefined;
  const json = await readWorkspaceJson<{ workspacePath?: unknown; state?: unknown }>(
    config,
    `load workspace snapshot ${label}`,
    response,
    `Load snapshot failed: HTTP ${response.status}`,
  );
  if (!json.state) return undefined;
  const state = parseWorkspaceState(json.state);
  return typeof json.workspacePath === 'string'
    ? { ...state, workspacePath: normalizeWorkspaceRootPath(json.workspacePath) }
    : state;
}

export async function listWorkspace(path: string, config: SciForgeConfig): Promise<WorkspaceEntry[]> {
  if (!path.trim()) return [];
  const url = new URL(`${config.workspaceWriterBaseUrl}/api/sciforge/workspace/list`);
  url.searchParams.set('path', path);
  const response = await fetchWorkspace(config, `list workspace ${path}`, url);
  const json = await readWorkspaceJson<{ entries?: WorkspaceEntry[] }>(
    config,
    `list workspace ${path}`,
    response,
    `List failed: HTTP ${response.status}`,
  );
  return Array.isArray(json.entries) ? json.entries : [];
}

export async function readWorkspaceFile(path: string, config: SciForgeConfig): Promise<WorkspaceFileContent> {
  if (!path.trim()) throw new Error('path is required');
  return cachedWorkspacePreviewRequest(
    workspaceFileReadCache,
    workspacePreviewCacheKey(config, 'workspace-file', path),
    async () => {
      const url = new URL(`${config.workspaceWriterBaseUrl}/api/sciforge/workspace/file`);
      url.searchParams.set('path', path);
      if (config.workspacePath.trim()) url.searchParams.set('workspacePath', config.workspacePath.trim());
      const response = await fetchWorkspace(config, `read workspace file ${path}`, url);
      const json = await readWorkspaceJson<{ file?: WorkspaceFileContent }>(
        config,
        `read workspace file ${path}`,
        response,
        `Read file failed: HTTP ${response.status}`,
      );
      if (!json.file) throw new Error(`Read file ${path} returned no file payload.`);
      return json.file;
    },
  );
}

export async function readPreviewDescriptor(ref: string, config: SciForgeConfig): Promise<PreviewDescriptor> {
  if (!ref.trim()) throw new Error('ref is required');
  return cachedWorkspacePreviewRequest(
    previewDescriptorReadCache,
    workspacePreviewCacheKey(config, 'preview-descriptor', ref),
    async () => {
      const url = new URL(`${config.workspaceWriterBaseUrl}/api/sciforge/preview/descriptor`);
      url.searchParams.set('ref', ref);
      if (config.workspacePath.trim()) url.searchParams.set('workspacePath', config.workspacePath.trim());
      const response = await fetchWorkspace(config, `read preview descriptor ${ref}`, url);
      const json = await readWorkspaceJson<{ descriptor?: PreviewDescriptor }>(
        config,
        `read preview descriptor ${ref}`,
        response,
        `Read preview descriptor failed: HTTP ${response.status}`,
      );
      if (!json.descriptor) throw new Error(`Preview descriptor ${ref} returned no descriptor payload.`);
      return json.descriptor;
    },
  );
}

export async function readPreviewDerivative(ref: string, kind: PreviewDerivative['kind'], config: SciForgeConfig): Promise<PreviewDerivative> {
  if (!ref.trim()) throw new Error('ref is required');
  return cachedWorkspacePreviewRequest(
    previewDerivativeReadCache,
    workspacePreviewCacheKey(config, 'preview-derivative', `${kind}:${ref}`),
    async () => {
      const url = new URL(`${config.workspaceWriterBaseUrl}/api/sciforge/preview/derivative`);
      url.searchParams.set('ref', ref);
      url.searchParams.set('kind', kind);
      if (config.workspacePath.trim()) url.searchParams.set('workspacePath', config.workspacePath.trim());
      const response = await fetchWorkspace(config, `read preview derivative ${kind} ${ref}`, url);
      const json = await readWorkspaceJson<{ derivative?: PreviewDerivative }>(
        config,
        `read preview derivative ${kind} ${ref}`,
        response,
        `Read preview derivative failed: HTTP ${response.status}`,
      );
      if (!json.derivative) throw new Error(`Preview derivative ${ref} returned no derivative payload.`);
      return json.derivative;
    },
  );
}

export async function writeWorkspaceFile(
  path: string,
  content: string,
  config: SciForgeConfig,
  options?: { encoding?: 'utf8' | 'base64'; mimeType?: string },
): Promise<WorkspaceFileContent> {
  if (!path.trim()) throw new Error('path is required');
  const response = await fetchWorkspace(config, `write workspace file ${path}`, `${config.workspaceWriterBaseUrl}/api/sciforge/workspace/file`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspacePath: config.workspacePath, path, content, encoding: options?.encoding, mimeType: options?.mimeType }),
  });
  if (!response.ok) throw new Error(await workspaceResponseError(response, `Write file failed: HTTP ${response.status}`));
  const json = await response.json() as { file?: WorkspaceFileContent };
  if (!json.file) throw new Error(`Write file ${path} returned no file payload.`);
  clearWorkspacePreviewReadCache();
  return json.file;
}

export async function mutateWorkspaceFile(
  config: SciForgeConfig,
  action: 'create-file' | 'create-folder' | 'rename' | 'move-file' | 'copy-file' | 'delete',
  payload: { path: string; targetPath?: string },
): Promise<void> {
  const operation = `${action} ${payload.path}`;
  const response = await fetchWorkspace(config, operation, `${config.workspaceWriterBaseUrl}/api/sciforge/workspace/file-action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspacePath: config.workspacePath, action, ...payload }),
  });
  if (!response.ok) throw new Error(await workspaceResponseError(response, `File action failed: HTTP ${response.status}`));
  clearWorkspacePreviewReadCache();
}

export function cachedWorkspaceFileReadError(path: string, config: SciForgeConfig): Error | undefined {
  return cachedStaleWorkspacePreviewError(workspaceFileReadCache, workspacePreviewCacheKey(config, 'workspace-file', path));
}

export function clearWorkspacePreviewReadCacheForTests() {
  clearWorkspacePreviewReadCache();
}

export async function openWorkspaceObject(
  config: SciForgeConfig,
  action: WorkspaceOpenResult['action'],
  path: string,
  workspacePath = config.workspacePath,
): Promise<WorkspaceOpenResult> {
  const response = await fetchWorkspace(config, `${action} workspace object`, `${config.workspaceWriterBaseUrl}/api/sciforge/workspace/open`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspacePath, action, path }),
  });
  if (!response.ok) throw new Error(await workspaceResponseError(response, `${action} failed: HTTP ${response.status}`));
  const json = await response.json() as Partial<WorkspaceOpenResult>;
  if (!json.ok || typeof json.path !== 'string' || json.action !== action || typeof json.workspacePath !== 'string') {
    throw new Error(`Workspace open returned invalid payload for ${path}.`);
  }
  return json as WorkspaceOpenResult;
}

export async function pickWorkspaceDirectory(
  config: SciForgeConfig,
  defaultPath = config.workspacePath,
): Promise<string | null> {
  const response = await fetchWorkspace(config, 'pick workspace directory', `${config.workspaceWriterBaseUrl}/api/sciforge/workspace/pick-directory`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ defaultPath }),
  });
  if (!response.ok) throw new Error(await workspaceResponseError(response, `Pick workspace directory failed: HTTP ${response.status}`));
  const json = await response.json() as { ok?: boolean; path?: string | null; cancelled?: boolean };
  if (!json.ok) throw new Error('Pick workspace directory returned an invalid payload.');
  return typeof json.path === 'string' && json.path.trim() ? json.path.trim() : null;
}

export async function listWorkspaceScenarios(config: SciForgeConfig, workspacePath = config.workspacePath): Promise<WorkspaceScenarioListItem[]> {
  if (!workspacePath.trim()) return [];
  const url = new URL(`${config.workspaceWriterBaseUrl}/api/sciforge/scenarios/list`);
  url.searchParams.set('workspacePath', workspacePath);
  const response = await fetchWorkspace(config, `list scenarios ${workspacePath}`, url);
  if (!response.ok) throw new Error(await workspaceResponseError(response, `List scenarios failed: HTTP ${response.status}`));
  const json = await response.json() as { scenarios?: WorkspaceScenarioListItem[] };
  return Array.isArray(json.scenarios) ? json.scenarios : [];
}

export async function loadScenarioLibrary(config: SciForgeConfig, workspacePath = config.workspacePath): Promise<ScenarioLibraryState | undefined> {
  if (!workspacePath.trim()) return undefined;
  const url = new URL(`${config.workspaceWriterBaseUrl}/api/sciforge/scenarios/library`);
  url.searchParams.set('workspacePath', workspacePath);
  const response = await fetchWorkspace(config, `load scenario library ${workspacePath}`, url);
  if (!response.ok) throw new Error(await workspaceResponseError(response, `Load scenario library failed: HTTP ${response.status}`));
  const json = await response.json() as { library?: ScenarioLibraryState };
  return json.library;
}

export async function loadWorkspaceScenario(config: SciForgeConfig, id: string, workspacePath = config.workspacePath): Promise<ScenarioPackage | undefined> {
  if (!workspacePath.trim() || !id.trim()) return undefined;
  const url = new URL(`${config.workspaceWriterBaseUrl}/api/sciforge/scenarios/get`);
  url.searchParams.set('workspacePath', workspacePath);
  url.searchParams.set('id', id);
  const response = await fetchWorkspace(config, `load scenario ${id}`, url);
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(await workspaceResponseError(response, `Load scenario failed: HTTP ${response.status}`));
  const json = await response.json() as { package?: ScenarioPackage };
  return json.package;
}

export async function saveWorkspaceScenario(config: SciForgeConfig, pkg: ScenarioPackage, workspacePath = config.workspacePath): Promise<void> {
  await writeWorkspaceScenario(config, 'save', { workspacePath, package: pkg });
}

export async function publishWorkspaceScenario(config: SciForgeConfig, pkg: ScenarioPackage, workspacePath = config.workspacePath): Promise<void> {
  await writeWorkspaceScenario(config, 'publish', { workspacePath, package: pkg });
}

export async function archiveWorkspaceScenario(config: SciForgeConfig, id: string, workspacePath = config.workspacePath): Promise<void> {
  await writeWorkspaceScenario(config, 'archive', { workspacePath, id });
}

export async function deleteWorkspaceScenario(config: SciForgeConfig, id: string, workspacePath = config.workspacePath): Promise<void> {
  await writeWorkspaceScenario(config, 'delete', { workspacePath, id });
}

export async function restoreWorkspaceScenario(config: SciForgeConfig, id: string, status: 'draft' | 'validated' | 'published' = 'draft', workspacePath = config.workspacePath): Promise<void> {
  await writeWorkspaceScenario(config, 'restore', { workspacePath, id, status });
}

export async function listWorkspaceTaskAttempts(
  config: SciForgeConfig,
  options: { workspacePath?: string; skillDomain?: string; scenarioPackageId?: string; limit?: number } = {},
): Promise<WorkspaceTaskAttemptRecord[]> {
  const workspacePath = options.workspacePath ?? config.workspacePath;
  if (!workspacePath.trim()) return [];
  const url = new URL(`${config.workspaceWriterBaseUrl}/api/sciforge/task-attempts/list`);
  url.searchParams.set('workspacePath', workspacePath);
  if (options.skillDomain) url.searchParams.set('skillDomain', options.skillDomain);
  if (options.scenarioPackageId) url.searchParams.set('scenarioPackageId', options.scenarioPackageId);
  if (options.limit) url.searchParams.set('limit', String(options.limit));
  const response = await fetchWorkspace(config, `list task attempts ${workspacePath}`, url);
  if (!response.ok) throw new Error(await workspaceResponseError(response, `List task attempts failed: HTTP ${response.status}`));
  const json = await response.json() as { attempts?: WorkspaceTaskAttemptRecord[] };
  return Array.isArray(json.attempts) ? json.attempts : [];
}

export async function loadWorkspaceTaskAttempts(
  config: SciForgeConfig,
  id: string,
  workspacePath = config.workspacePath,
): Promise<WorkspaceTaskAttemptRecord[]> {
  if (!workspacePath.trim() || !id.trim()) return [];
  const url = new URL(`${config.workspaceWriterBaseUrl}/api/sciforge/task-attempts/get`);
  url.searchParams.set('workspacePath', workspacePath);
  url.searchParams.set('id', id);
  const response = await fetchWorkspace(config, `load task attempts ${id}`, url);
  if (!response.ok) throw new Error(await workspaceResponseError(response, `Load task attempts failed: HTTP ${response.status}`));
  const json = await response.json() as { attempts?: WorkspaceTaskAttemptRecord[] };
  return Array.isArray(json.attempts) ? json.attempts : [];
}

export async function loadSciForgeInstanceManifest(
  config: SciForgeConfig,
  workspacePath = config.workspacePath,
): Promise<SciForgeInstanceManifest> {
  const url = new URL(`${config.workspaceWriterBaseUrl}/api/sciforge/instance/manifest`);
  if (workspacePath.trim()) url.searchParams.set('workspacePath', workspacePath);
  const response = await fetchWorkspace(config, `load instance manifest ${workspacePath || 'last workspace'}`, url);
  if (!response.ok) throw new Error(await workspaceResponseError(response, `Load instance manifest failed: HTTP ${response.status}`));
  const json = await response.json() as { manifest?: SciForgeInstanceManifest };
  if (!json.manifest) throw new Error('Instance manifest returned no manifest payload.');
  return json.manifest;
}

export async function loadWorkspaceWriterHealth(
  config: SciForgeConfig,
  workspaceWriterBaseUrl = config.workspaceWriterBaseUrl,
): Promise<SciForgeWorkspaceWriterHealth> {
  const cleanBaseUrl = workspaceWriterBaseUrl.replace(/\/+$/, '');
  const response = await fetchWorkspace(config, `load workspace writer health ${cleanBaseUrl}`, `${cleanBaseUrl}/health`);
  if (!response.ok) throw new Error(await workspaceResponseError(response, `Load workspace writer health failed: HTTP ${response.status}`));
  const json = await readWorkspaceJson<SciForgeWorkspaceWriterHealth>(
    config,
    `load workspace writer health ${cleanBaseUrl}`,
    response,
    `Load workspace writer health failed: HTTP ${response.status}`,
  );
  if (json.ok !== true || json.service !== 'sciforge-workspace-writer') {
    throw new Error(`Workspace writer health returned unexpected service: ${json.service || 'unknown'}`);
  }
  return {
    ...json,
    capabilities: Array.isArray(json.capabilities) ? json.capabilities : [],
  };
}

export async function preflightWorkspaceTerminalWriter(
  config: SciForgeConfig,
  input: { workspaceWriterBaseUrl?: string; timeoutMs?: number } = {},
): Promise<WorkspaceTerminalWriterPreflightResult> {
  const configuredBaseUrl = normalizeWorkspaceWriterBaseUrl(input.workspaceWriterBaseUrl || config.workspaceWriterBaseUrl);
  const configuredDisplayUrl = displayWorkspaceWriterUrl(configuredBaseUrl || input.workspaceWriterBaseUrl || config.workspaceWriterBaseUrl);
  if (!configuredBaseUrl) {
    return {
      ok: false,
      status: 'invalid-url',
      configuredBaseUrl: '',
      configuredDisplayUrl,
      message: `Workspace Writer URL is invalid: ${configuredDisplayUrl || 'empty URL'}.`,
      diagnosticRef: 'workspace-terminal-writer-invalid-url',
      candidates: [],
    };
  }
  const primary = await probeWorkspaceTerminalWriter(configuredBaseUrl, {
    label: 'Configured writer',
    timeoutMs: input.timeoutMs,
  });
  if (primary.ok) {
    return {
      ok: true,
      status: 'ready',
      configuredBaseUrl,
      configuredDisplayUrl: primary.displayUrl,
      effectiveBaseUrl: configuredBaseUrl,
      effectiveDisplayUrl: primary.displayUrl,
      message: primary.message,
      diagnosticRef: 'workspace-terminal-writer-ready',
      candidates: [],
      health: primary.health,
    };
  }

  const candidates: WorkspaceTerminalWriterCandidate[] = [];
  for (const candidate of workspaceWriterCandidates(config, configuredBaseUrl)) {
    candidates.push(await probeWorkspaceTerminalWriter(candidate.baseUrl, {
      label: candidate.label,
      timeoutMs: input.timeoutMs,
    }));
  }
  const recommended = candidates.find((candidate) => candidate.ok);
  return {
    ok: false,
    status: primary.status,
    configuredBaseUrl,
    configuredDisplayUrl: primary.displayUrl,
    recommendedBaseUrl: recommended?.baseUrl,
    recommendedDisplayUrl: recommended?.displayUrl,
    message: recommended
      ? `${primary.message} A ready Workspace Writer is available at ${recommended.displayUrl}.`
      : primary.message,
    diagnosticRef: primaryDiagnosticRef(primary.status),
    candidates,
  };
}

export async function preflightBrowserHostSessionWriter(
  config: SciForgeConfig,
  input: { workspaceWriterBaseUrl?: string; timeoutMs?: number } = {},
): Promise<BrowserHostSessionWriterPreflightResult> {
  const timeoutMs = input.timeoutMs ?? BROWSER_HOST_WRITER_PREFLIGHT_TIMEOUT_MS;
  const configuredBaseUrl = normalizeWorkspaceWriterBaseUrl(input.workspaceWriterBaseUrl || config.workspaceWriterBaseUrl);
  const configuredDisplayUrl = displayWorkspaceWriterUrl(configuredBaseUrl || input.workspaceWriterBaseUrl || config.workspaceWriterBaseUrl);
  if (!configuredBaseUrl) {
    return {
      ok: false,
      status: 'invalid-url',
      configuredBaseUrl: '',
      configuredDisplayUrl,
      message: `Workspace Writer URL is invalid: ${configuredDisplayUrl || 'empty URL'}.`,
      diagnosticRef: 'browser-host-writer-invalid-url',
      candidates: [],
    };
  }
  const primary = await probeBrowserHostSessionWriter(configuredBaseUrl, {
    label: 'Configured writer',
    timeoutMs,
  });
  if (primary.ok) {
    return {
      ok: true,
      status: 'ready',
      configuredBaseUrl,
      configuredDisplayUrl: primary.displayUrl,
      effectiveBaseUrl: configuredBaseUrl,
      effectiveDisplayUrl: primary.displayUrl,
      message: primary.message,
      diagnosticRef: 'browser-host-writer-ready',
      candidates: [],
      health: primary.health,
    };
  }

  const candidates: BrowserHostSessionWriterCandidate[] = [];
  for (const candidate of workspaceWriterCandidates(config, configuredBaseUrl)) {
    candidates.push(await probeBrowserHostSessionWriter(candidate.baseUrl, {
      label: candidate.label,
      timeoutMs,
    }));
  }
  const recommended = candidates.find((candidate) => candidate.ok);
  return {
    ok: false,
    status: primary.status,
    configuredBaseUrl,
    configuredDisplayUrl: primary.displayUrl,
    recommendedBaseUrl: recommended?.baseUrl,
    recommendedDisplayUrl: recommended?.displayUrl,
    message: recommended
      ? `${primary.message} A ready Workspace Writer with BrowserHostSession is available at ${recommended.displayUrl}.`
      : primary.message,
    diagnosticRef: browserHostDiagnosticRef(primary.status),
    candidates,
    health: primary.health,
  };
}

export async function listFeedbackIssues(
  config: SciForgeConfig,
  workspacePath = config.workspacePath,
): Promise<FeedbackIssueSummary[]> {
  if (!workspacePath.trim()) return [];
  const url = new URL(`${config.workspaceWriterBaseUrl}/api/sciforge/feedback/issues`);
  url.searchParams.set('workspacePath', workspacePath);
  const response = await fetchWorkspace(config, `list feedback issues ${workspacePath}`, url);
  if (!response.ok) throw new Error(await workspaceResponseError(response, `List feedback issues failed: HTTP ${response.status}`));
  const json = await response.json() as { issues?: FeedbackIssueSummary[] };
  return Array.isArray(json.issues) ? json.issues : [];
}

export async function loadFeedbackIssueHandoffBundle(
  config: SciForgeConfig,
  id: string,
  workspacePath = config.workspacePath,
): Promise<FeedbackIssueHandoffBundle> {
  if (!workspacePath.trim() || !id.trim()) throw new Error('workspacePath and id are required');
  const url = new URL(`${config.workspaceWriterBaseUrl}/api/sciforge/feedback/issues/${encodeURIComponent(id)}`);
  url.searchParams.set('workspacePath', workspacePath);
  const response = await fetchWorkspace(config, `load feedback issue ${id}`, url);
  if (!response.ok) throw new Error(await workspaceResponseError(response, `Load feedback issue failed: HTTP ${response.status}`));
  const json = await response.json() as { issue?: FeedbackIssueHandoffBundle };
  if (!json.issue) throw new Error(`Feedback issue ${id} returned no handoff bundle.`);
  return json.issue;
}

export async function saveFeedbackCommentEvidenceBundle(
  config: SciForgeConfig,
  comment: FeedbackCommentRecord,
  workspacePath = config.workspacePath,
): Promise<FeedbackCommentEvidenceBundle> {
  if (!workspacePath.trim()) throw new Error('workspacePath is required');
  if (!comment.id.trim()) throw new Error('feedback comment id is required');
  const response = await fetchWorkspace(config, `save feedback comment ${comment.id}`, `${config.workspaceWriterBaseUrl}/api/sciforge/feedback/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspacePath, comment }),
  });
  if (!response.ok) throw new Error(await workspaceResponseError(response, `Save feedback comment failed: HTTP ${response.status}`));
  const json = await response.json() as { bundle?: FeedbackCommentEvidenceBundle };
  if (!json.bundle) throw new Error(`Save feedback comment ${comment.id} returned no bundle.`);
  return json.bundle;
}

export async function runFeedbackIssueRepairHandoff(
  config: SciForgeConfig,
  contract: FeedbackRepairHandoffRunInput,
): Promise<FeedbackRepairResultRecord> {
  const response = await fetchWorkspace(config, `run feedback repair handoff ${contract.issueBundle.id}`, `${config.workspaceWriterBaseUrl}/api/sciforge/repair-handoff/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contract }),
  });
  if (!response.ok) throw new Error(await workspaceResponseError(response, `Run feedback repair handoff failed: HTTP ${response.status}`));
  const json = await response.json() as { result?: FeedbackRepairResultRecord };
  if (!json.result) throw new Error(`Run feedback repair handoff for ${contract.issueBundle.id} returned no result.`);
  return json.result;
}

export async function confirmFeedbackRepairAction(
  config: SciForgeConfig,
  id: string,
  input: FeedbackRepairActionInput,
  workspacePath = config.workspacePath,
): Promise<{ action: FeedbackRepairActionRecord; result?: FeedbackRepairResultRecord }> {
  const response = await fetchWorkspace(config, `confirm feedback repair ${input.action} ${id}`, `${config.workspaceWriterBaseUrl}/api/sciforge/feedback/issues/${encodeURIComponent(id)}/repair-actions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspacePath, ...input }),
  });
  if (!response.ok) throw new Error(await workspaceResponseError(response, `Confirm feedback repair action failed: HTTP ${response.status}`));
  const json = await response.json() as { action?: FeedbackRepairActionRecord; result?: FeedbackRepairResultRecord };
  if (!json.action) throw new Error(`Confirm feedback repair action for ${id} returned no action record.`);
  return { action: json.action, result: json.result };
}

export async function loadFeedbackRepairTerminalMirror(
  config: SciForgeConfig,
  input: { terminalMirrorRef: string; cursor?: number; limit?: number; workspacePath?: string },
): Promise<FeedbackRepairTerminalMirrorTail> {
  const ref = input.terminalMirrorRef.trim();
  if (!ref) throw new Error('terminalMirrorRef is required');
  const url = new URL(`${config.workspaceWriterBaseUrl}/api/sciforge/repair-handoff/terminal-mirror`);
  url.searchParams.set('ref', ref);
  url.searchParams.set('workspacePath', input.workspacePath || config.workspacePath);
  if (typeof input.cursor === 'number') url.searchParams.set('cursor', String(input.cursor));
  if (typeof input.limit === 'number') url.searchParams.set('limit', String(input.limit));
  const response = await fetchWorkspace(config, `load repair terminal mirror ${ref}`, url);
  if (!response.ok) throw new Error(await workspaceResponseError(response, `Load repair terminal mirror failed: HTTP ${response.status}`));
  const json = await response.json() as { tail?: FeedbackRepairTerminalMirrorTail };
  if (!json.tail) throw new Error('Load repair terminal mirror returned no tail.');
  return json.tail;
}

export async function stopFeedbackRepairHandoff(
  config: SciForgeConfig,
  input: { repairRunId: string; reason?: string; terminalMirrorRef?: string; workspacePath?: string },
): Promise<FeedbackRepairStopResult> {
  const repairRunId = input.repairRunId.trim();
  if (!repairRunId) throw new Error('repairRunId is required');
  const response = await fetchWorkspace(config, `stop feedback repair handoff ${repairRunId}`, `${config.workspaceWriterBaseUrl}/api/sciforge/repair-handoff/stop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      repairRunId,
      reason: input.reason,
      terminalMirrorRef: input.terminalMirrorRef,
      workspacePath: input.workspacePath || config.workspacePath,
      requestedBy: 'feedback-inbox',
    }),
  });
  if (!response.ok) throw new Error(await workspaceResponseError(response, `Stop feedback repair handoff failed: HTTP ${response.status}`));
  const json = await response.json() as { stop?: FeedbackRepairStopResult };
  if (!json.stop) throw new Error(`Stop feedback repair handoff for ${repairRunId} returned no stop result.`);
  return json.stop;
}

export async function sendFeedbackRepairGuidance(
  config: SciForgeConfig,
  issueId: string,
  input: FeedbackRepairGuidanceInput,
): Promise<FeedbackRepairGuidanceResult> {
  const repairRunId = input.repairRunId.trim();
  if (!issueId.trim()) throw new Error('feedback issue id is required');
  if (!repairRunId) throw new Error('repairRunId is required');
  if (!input.message.trim()) throw new Error('guidance message is required');
  const response = await fetchWorkspace(config, `send feedback repair guidance ${repairRunId}`, `${config.workspaceWriterBaseUrl}/api/sciforge/feedback/issues/${encodeURIComponent(issueId)}/repair-guidance`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspacePath: input.workspacePath || config.workspacePath,
      repairRunId,
      repairResultId: input.repairResultId,
      message: input.message,
      terminalMirrorRef: input.terminalMirrorRef,
      codexSessionId: input.codexSessionId,
      requestedBy: 'feedback-inbox',
    }),
  });
  if (!response.ok) throw new Error(await workspaceResponseError(response, `Send feedback repair guidance failed: HTTP ${response.status}`));
  const json = await response.json() as { guidance?: FeedbackRepairGuidanceRecord };
  if (!json.guidance) throw new Error(`Send feedback repair guidance for ${repairRunId} returned no guidance record.`);
  return { guidance: json.guidance };
}

export async function startFeedbackCodexPtyTerminal(
  config: SciForgeConfig,
  issueId: string,
  input: {
    workspacePath?: string;
    initialMessage?: string;
    runtimeProfile?: string;
    allowOpenAiRuntime?: boolean;
    gitMode?: 'manual' | 'auto';
    launchSurface?: 'system-terminal' | 'web-viewer';
    cols?: number;
    rows?: number;
  } = {},
): Promise<FeedbackCodexPtyTerminalStartResult> {
  if (!issueId.trim()) throw new Error('feedback issue id is required');
  const response = await fetchWorkspace(config, `start Codex repair session ${issueId}`, `${config.workspaceWriterBaseUrl}/api/sciforge/feedback/issues/${encodeURIComponent(issueId)}/codex-pty/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspacePath: input.workspacePath || config.workspacePath,
      initialMessage: input.initialMessage,
      runtimeProfile: input.runtimeProfile || config.runtimeProfile,
      allowOpenAiRuntime: input.allowOpenAiRuntime ?? config.allowOpenAiRuntime === true,
      gitMode: input.gitMode || 'manual',
      launchSurface: input.launchSurface || 'system-terminal',
      cols: input.cols,
      rows: input.rows,
    }),
  });
  if (!response.ok) throw new Error(await workspaceResponseError(response, `Start Codex repair session failed: HTTP ${response.status}`));
  const json = await response.json() as { session?: FeedbackCodexTerminalSession; repairRun?: FeedbackRepairRunRecord };
  if (!json.session) throw new Error(`Start Codex repair session for ${issueId} returned no session.`);
  if (json.session.transport !== 'websocket-pty' && json.session.transport !== 'system-terminal') {
    throw new Error(`Start Codex repair session for ${issueId} returned ${json.session.transport || 'unknown'} transport.`);
  }
  return { session: json.session, repairRun: json.repairRun };
}

export async function stopFeedbackCodexPtyTerminal(
  config: SciForgeConfig,
  sessionId: string,
  input: { reason?: string; workspacePath?: string } = {},
): Promise<FeedbackCodexTerminalSession> {
  if (!sessionId.trim()) throw new Error('Codex repair session id is required');
  const response = await fetchWorkspace(config, `stop Codex repair session ${sessionId}`, `${config.workspaceWriterBaseUrl}/api/sciforge/feedback/codex-pty/${encodeURIComponent(sessionId)}/stop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspacePath: input.workspacePath || config.workspacePath,
      reason: input.reason || 'feedback inbox PTY stop button',
    }),
  });
  if (!response.ok) throw new Error(await workspaceResponseError(response, `Stop Codex repair session failed: HTTP ${response.status}`));
  const json = await response.json() as { session?: FeedbackCodexTerminalSession };
  if (!json.session) throw new Error(`Stop Codex repair session for ${sessionId} returned no session.`);
  return json.session;
}

export async function startWorkspaceTerminalSession(
  config: SciForgeConfig,
  input: {
    workspacePath?: string;
    cwd?: string;
    shell?: string;
    cols?: number;
    rows?: number;
  } = {},
): Promise<WorkspaceTerminalStartResult> {
  const response = await fetchWorkspace(config, 'start workspace terminal session', `${config.workspaceWriterBaseUrl}/api/sciforge/terminal/sessions/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspacePath: input.workspacePath || config.workspacePath,
      cwd: input.cwd,
      shell: input.shell,
      cols: input.cols,
      rows: input.rows,
    }),
  });
  if (!response.ok) throw new Error(await workspaceResponseError(response, `Start workspace terminal failed: HTTP ${response.status}`));
  const json = await response.json() as { session?: WorkspaceTerminalSession };
  if (!json.session) throw new Error('Start workspace terminal returned no session.');
  return { session: json.session };
}

export async function stopWorkspaceTerminalSession(
  config: SciForgeConfig,
  sessionId: string,
  input: { reason?: string; workspacePath?: string } = {},
): Promise<WorkspaceTerminalSession> {
  if (!sessionId.trim()) throw new Error('Workspace terminal session id is required');
  const response = await fetchWorkspace(config, `stop workspace terminal session ${sessionId}`, `${config.workspaceWriterBaseUrl}/api/sciforge/terminal/sessions/${encodeURIComponent(sessionId)}/stop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspacePath: input.workspacePath || config.workspacePath,
      reason: input.reason || 'right pane terminal stop',
    }),
  });
  if (!response.ok) throw new Error(await workspaceResponseError(response, `Stop workspace terminal failed: HTTP ${response.status}`));
  const json = await response.json() as { session?: WorkspaceTerminalSession };
  if (!json.session) throw new Error(`Stop workspace terminal ${sessionId} returned no session.`);
  return json.session;
}

export async function startBrowserHostSession(
  config: SciForgeConfig,
  input: {
    url: string;
    sessionId?: string;
    workspacePath?: string;
    width?: number;
    height?: number;
    timeoutMs?: number;
  },
): Promise<BrowserHostSessionStartResult> {
  const prepared = await prepareBrowserHostSessionWriter(config, {
    timeoutMs: BROWSER_HOST_WRITER_START_PREFLIGHT_TIMEOUT_MS,
    allowConfiguredOfflineFallback: true,
  });
  const launchConfig = prepared.config;
  const response = await fetchWorkspace(launchConfig, 'start BrowserHostSession', `${launchConfig.workspaceWriterBaseUrl}/api/sciforge/browser-host/sessions/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspacePath: input.workspacePath || launchConfig.workspacePath,
      url: input.url,
      sessionId: input.sessionId,
      width: input.width,
      height: input.height,
      timeoutMs: input.timeoutMs,
    }),
  });
  if (!response.ok) throw new Error(await workspaceResponseError(response, `Start BrowserHostSession failed: HTTP ${response.status}`));
  const json = await response.json() as { session?: BrowserHostSessionState };
  if (!json.session) throw new Error('Start BrowserHostSession returned no session.');
  return {
    session: withBrowserHostWriterUrl(json.session, launchConfig.workspaceWriterBaseUrl),
    preflight: prepared.preflight,
    runtimeStart: prepared.runtimeStart,
  };
}

export async function sendBrowserHostSessionAction(
  config: SciForgeConfig,
  sessionId: string,
  input: {
    action: BrowserHostSessionAction;
    capture?: BrowserHostSessionCaptureMode;
    url?: string;
    x?: number;
    y?: number;
    button?: BrowserHostMouseButton;
    path?: Array<{ x: number; y: number }>;
    text?: string;
    key?: string;
    deltaX?: number;
    deltaY?: number;
    timeoutMs?: number;
    actionId?: string;
    uiEventReceivedAt?: string;
    adapterSentAt?: string;
    workspacePath?: string;
    workspaceWriterBaseUrl?: string;
  },
): Promise<BrowserHostSessionState> {
  const operationConfig = input.workspaceWriterBaseUrl ? { ...config, workspaceWriterBaseUrl: input.workspaceWriterBaseUrl } : config;
  const response = await fetchWorkspace(operationConfig, `send BrowserHostSession ${input.action}`, `${operationConfig.workspaceWriterBaseUrl}/api/sciforge/browser-host/sessions/${encodeURIComponent(sessionId)}/actions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspacePath: input.workspacePath || operationConfig.workspacePath,
      action: input.action,
      capture: input.capture,
      url: input.url,
      x: input.x,
      y: input.y,
      button: input.button,
      path: input.path,
      text: input.text,
      key: input.key,
      deltaX: input.deltaX,
      deltaY: input.deltaY,
      timeoutMs: input.timeoutMs,
      actionId: input.actionId,
      uiEventReceivedAt: input.uiEventReceivedAt,
      adapterSentAt: input.adapterSentAt,
    }),
  });
  if (!response.ok) throw new Error(await workspaceResponseError(response, `BrowserHostSession action failed: HTTP ${response.status}`));
  const json = await response.json() as { session?: BrowserHostSessionState };
  if (!json.session) throw new Error(`BrowserHostSession ${sessionId} action returned no session.`);
  return withBrowserHostWriterUrl(json.session, operationConfig.workspaceWriterBaseUrl);
}

export async function sendBrowserHostComputerUseAction(
  config: SciForgeConfig,
  sessionId: string,
  input: {
    action: BrowserHostComputerUseAction;
    capture?: BrowserHostSessionCaptureMode;
    timeoutMs?: number;
    actionId?: string;
    uiEventReceivedAt?: string;
    adapterSentAt?: string;
    workspacePath?: string;
    workspaceWriterBaseUrl?: string;
  },
): Promise<BrowserHostComputerUseActionResult> {
  const operationConfig = input.workspaceWriterBaseUrl ? { ...config, workspaceWriterBaseUrl: input.workspaceWriterBaseUrl } : config;
  const response = await fetchWorkspace(operationConfig, `send BrowserHostSession Computer Use ${input.action.type}`, `${operationConfig.workspaceWriterBaseUrl}/api/sciforge/browser-host/sessions/${encodeURIComponent(sessionId)}/computer-use-actions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspacePath: input.workspacePath || operationConfig.workspacePath,
      action: input.action,
      capture: input.capture,
      timeoutMs: input.timeoutMs,
      actionId: input.actionId,
      uiEventReceivedAt: input.uiEventReceivedAt,
      adapterSentAt: input.adapterSentAt,
    }),
  });
  if (!response.ok) throw new Error(await workspaceResponseError(response, `BrowserHostSession Computer Use action failed: HTTP ${response.status}`));
  const json = await response.json() as { result?: BrowserHostComputerUseActionResult };
  if (!json.result) throw new Error(`BrowserHostSession ${sessionId} Computer Use action returned no result.`);
  return {
    ...json.result,
    session: withBrowserHostWriterUrl(json.result.session, operationConfig.workspaceWriterBaseUrl),
  };
}

export async function readBrowserHostSessionState(
  config: SciForgeConfig,
  sessionId: string,
  input: { workspacePath?: string; workspaceWriterBaseUrl?: string } = {},
): Promise<BrowserHostSessionState> {
  const operationConfig = input.workspaceWriterBaseUrl ? { ...config, workspaceWriterBaseUrl: input.workspaceWriterBaseUrl } : config;
  const url = new URL(`${operationConfig.workspaceWriterBaseUrl}/api/sciforge/browser-host/sessions/${encodeURIComponent(sessionId)}/state`);
  url.searchParams.set('workspacePath', input.workspacePath || operationConfig.workspacePath);
  const response = await fetchWorkspace(operationConfig, `read BrowserHostSession ${sessionId}`, url);
  if (!response.ok) throw new Error(await workspaceResponseError(response, `Read BrowserHostSession failed: HTTP ${response.status}`));
  const json = await response.json() as { session?: BrowserHostSessionState };
  if (!json.session) throw new Error(`Read BrowserHostSession ${sessionId} returned no session.`);
  return withBrowserHostWriterUrl(json.session, operationConfig.workspaceWriterBaseUrl);
}

export async function searchWithBrowserHostSession(
  config: SciForgeConfig,
  input: {
    query: string;
    sessionId?: string;
    limit?: number;
    region?: string;
    engine?: 'bing' | 'duckduckgo';
    timeoutMs?: number;
    workspacePath?: string;
  },
): Promise<BrowserHostSearchResult> {
  const prepared = await prepareBrowserHostSessionWriter(config, {
    timeoutMs: BROWSER_HOST_WRITER_START_PREFLIGHT_TIMEOUT_MS,
    allowConfiguredOfflineFallback: true,
  });
  const searchConfig = prepared.config;
  const response = await fetchWorkspace(searchConfig, 'browser host search', `${searchConfig.workspaceWriterBaseUrl}/api/sciforge/browser-host/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspacePath: input.workspacePath || searchConfig.workspacePath,
      query: input.query,
      sessionId: input.sessionId,
      limit: input.limit,
      region: input.region,
      engine: input.engine,
      timeoutMs: input.timeoutMs,
    }),
  });
  if (!response.ok) throw new Error(await workspaceResponseError(response, `BrowserHostSession search failed: HTTP ${response.status}`));
  const json = await response.json() as { search?: BrowserHostSearchResult };
  if (!json.search) throw new Error('BrowserHostSession search returned no result.');
  return {
    ...json.search,
    session: withBrowserHostWriterUrl(json.search.session, searchConfig.workspaceWriterBaseUrl),
  };
}

export function browserHostSessionFrameUrl(config: SciForgeConfig, session: BrowserHostSessionState): string {
  const writerBaseUrl = session.workspaceWriterBaseUrl || config.workspaceWriterBaseUrl;
  const url = new URL(`${writerBaseUrl}/api/sciforge/browser-host/sessions/${encodeURIComponent(session.id)}/frame`);
  url.searchParams.set('workspacePath', session.workspacePath || config.workspacePath);
  url.searchParams.set('t', session.updatedAt || String(Date.now()));
  return url.toString();
}

export function browserHostSessionFrameStreamUrl(
  config: SciForgeConfig,
  session: BrowserHostSessionState,
  input: { intervalMs?: number; fps?: number; quietWindowMs?: number; maxBufferedBytes?: number } = {},
): string {
  const writerBaseUrl = session.workspaceWriterBaseUrl || config.workspaceWriterBaseUrl;
  const url = new URL(`${writerBaseUrl}/api/sciforge/browser-host/sessions/${encodeURIComponent(session.id)}/frame-stream`);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('workspacePath', session.workspacePath || config.workspacePath);
  if (input.intervalMs) url.searchParams.set('intervalMs', String(input.intervalMs));
  if (input.fps) url.searchParams.set('fps', String(input.fps));
  if (input.quietWindowMs !== undefined) url.searchParams.set('quietWindowMs', String(input.quietWindowMs));
  if (input.maxBufferedBytes !== undefined) url.searchParams.set('maxBufferedBytes', String(input.maxBufferedBytes));
  return url.toString();
}

export function browserHostSessionWebRtcSignalingUrl(
  config: SciForgeConfig,
  session: BrowserHostSessionState,
  input: { transport?: 'webrtc-data-channel'; role?: 'adapter' | 'viewer' } = {},
): string {
  const writerBaseUrl = session.workspaceWriterBaseUrl || config.workspaceWriterBaseUrl;
  const url = new URL(`${writerBaseUrl}/api/sciforge/browser-host/sessions/${encodeURIComponent(session.id)}/webrtc-signaling`);
  url.searchParams.set('workspacePath', session.workspacePath || config.workspacePath);
  url.searchParams.set('transport', input.transport ?? 'webrtc-data-channel');
  url.searchParams.set('role', input.role ?? 'adapter');
  return url.toString();
}

async function prepareBrowserHostSessionWriter(
  config: SciForgeConfig,
  input: { timeoutMs?: number; allowConfiguredOfflineFallback?: boolean } = { timeoutMs: BROWSER_HOST_WRITER_PREFLIGHT_TIMEOUT_MS },
): Promise<{
  config: SciForgeConfig;
  preflight: BrowserHostSessionWriterPreflightResult;
  runtimeStart?: BrowserHostSessionStartResult['runtimeStart'];
}> {
  const first = await preflightBrowserHostSessionWriter(config, input);
  const firstReadyBaseUrl = first.ok ? first.effectiveBaseUrl : first.recommendedBaseUrl;
  if (firstReadyBaseUrl) {
    return {
      config: { ...config, workspaceWriterBaseUrl: firstReadyBaseUrl },
      preflight: first,
    };
  }
  if (input.allowConfiguredOfflineFallback && first.status === 'offline' && first.configuredBaseUrl && !first.recommendedBaseUrl) {
    return {
      config: { ...config, workspaceWriterBaseUrl: first.configuredBaseUrl },
      preflight: first,
    };
  }

  let runtimeStart: BrowserHostSessionStartResult['runtimeStart'];
  try {
    runtimeStart = await startRuntimeServices();
  } catch (error) {
    throw browserHostWriterUnavailableError(first, error);
  }

  const second = await preflightBrowserHostSessionWriter(config, input);
  const secondReadyBaseUrl = second.ok ? second.effectiveBaseUrl : second.recommendedBaseUrl;
  if (secondReadyBaseUrl) {
    return {
      config: { ...config, workspaceWriterBaseUrl: secondReadyBaseUrl },
      preflight: second,
      runtimeStart,
    };
  }
  throw browserHostWriterUnavailableError(second, runtimeStart?.error);
}

function withBrowserHostWriterUrl(session: BrowserHostSessionState, workspaceWriterBaseUrl: string): BrowserHostSessionState {
  return {
    ...session,
    workspaceWriterBaseUrl: normalizeWorkspaceWriterBaseUrl(workspaceWriterBaseUrl) || workspaceWriterBaseUrl,
  };
}

function browserHostWriterUnavailableError(
  preflight: BrowserHostSessionWriterPreflightResult,
  cause?: unknown,
) {
  const causeText = cause instanceof Error
    ? cause.message
    : typeof cause === 'string'
      ? cause
      : '';
  return new SciForgeClientError({
    title: 'BrowserHostSession Workspace Writer 未连接',
    reason: sanitizeWorkspaceDiagnosticText([
      preflight.message,
      causeText ? `Runtime autostart: ${causeText}` : '',
    ].filter(Boolean).join(' ')),
    recoverActions: [
      '确认 Workspace Writer URL 指向 writer 服务而不是 Web UI',
      '启动 npm run workspace:server 或点击启动服务后重试',
      '检查 /health 是否包含 browser-host-session、browser-host-native-surface、browser-host-search，以及 native surface health/attach/state endpoints',
    ],
    diagnosticRef: preflight.diagnosticRef,
    cause,
  });
}

export function workspaceTerminalWebSocketUrl(config: SciForgeConfig, session: WorkspaceTerminalSession): string {
  if (!session.webSocketPath) throw new Error(`Workspace terminal session ${session.id} has no WebSocket path.`);
  const base = new URL(session.workspaceWriterBaseUrl || config.workspaceWriterBaseUrl);
  base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  base.pathname = session.webSocketPath;
  base.search = '';
  base.searchParams.set('workspacePath', session.workspacePath || config.workspacePath);
  return base.toString();
}

export function feedbackCodexPtyWebSocketUrl(config: SciForgeConfig, session: FeedbackCodexTerminalSession): string {
  if (!session.webSocketPath) throw new Error(`Codex PTY session ${session.id} has no WebSocket path.`);
  const base = new URL(config.workspaceWriterBaseUrl);
  base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  base.pathname = session.webSocketPath;
  base.search = '';
  base.searchParams.set('workspacePath', session.workspacePath || config.workspacePath);
  return base.toString();
}

export async function uploadFeedbackEvidenceAssets(
  config: SciForgeConfig,
  issueId: string,
  input: FeedbackEvidenceUploadInput,
): Promise<FeedbackEvidenceUploadResult> {
  if (!issueId.trim()) throw new Error('feedback issue id is required');
  const response = await fetchWorkspace(config, `upload feedback evidence ${issueId}`, `${config.workspaceWriterBaseUrl}/api/sciforge/feedback/issues/${encodeURIComponent(issueId)}/evidence/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspacePath: input.workspacePath || config.workspacePath,
      repo: input.repo,
      token: input.token,
      branch: input.branch,
      commitMessage: input.commitMessage,
      requestedBy: 'feedback-inbox',
    }),
  });
  if (!response.ok) throw new Error(await workspaceResponseError(response, `Upload feedback evidence failed: HTTP ${response.status}`));
  const json = await response.json() as FeedbackEvidenceUploadResult;
  if (!json.issueId) throw new Error(`Upload feedback evidence for ${issueId} returned no issue id.`);
  return json;
}

export async function loadRuntimeProviderPreflightManifest(config: SciForgeConfig): Promise<RuntimeProviderPreflightManifest | undefined> {
  const response = await fetchWorkspace(config, 'load runtime provider preflight manifest', `${config.workspaceWriterBaseUrl}/api/sciforge/runtime-provider-preflight/manifest`);
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(await workspaceResponseError(response, `Load runtime provider preflight manifest failed: HTTP ${response.status}`));
  const json = await response.json() as { manifest?: RuntimeProviderPreflightManifest };
  return json.manifest;
}

export async function loadRuntimeCodexBrowserAcceptanceManifest(config: SciForgeConfig): Promise<RuntimeCodexBrowserAcceptanceManifest | undefined> {
  const response = await fetchWorkspace(config, 'load runtime codex browser acceptance manifest', `${config.workspaceWriterBaseUrl}/api/sciforge/runtime-codex-browser-acceptance/manifest`);
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(await workspaceResponseError(response, `Load runtime codex browser acceptance manifest failed: HTTP ${response.status}`));
  const json = await response.json() as { manifest?: RuntimeCodexBrowserAcceptanceManifest };
  return json.manifest;
}

export async function startFeedbackIssueRepairRun(
  config: SciForgeConfig,
  id: string,
  input: Partial<Omit<FeedbackRepairRunRecord, 'schemaVersion' | 'issueId' | 'status' | 'startedAt'>> & { startedAt?: string } = {},
  workspacePath = config.workspacePath,
): Promise<FeedbackRepairRunRecord> {
  const json = await mutateFeedbackIssue(config, id, 'repair-runs', { workspacePath, ...input }, 'start feedback repair run') as { run?: FeedbackRepairRunRecord };
  if (!json.run) throw new Error(`Start feedback repair run for ${id} returned no run.`);
  return json.run;
}

export async function saveFeedbackIssueRepairResult(
  config: SciForgeConfig,
  id: string,
  result: FeedbackRepairResultInput,
  workspacePath = config.workspacePath,
): Promise<FeedbackRepairResultRecord> {
  const json = await mutateFeedbackIssue(config, id, 'repair-result', { workspacePath, result }, 'save feedback repair result') as { result?: FeedbackRepairResultRecord };
  if (!json.result) throw new Error(`Save feedback repair result for ${id} returned no result.`);
  return json.result;
}

export async function listSkillPromotionProposals(
  config: SciForgeConfig,
  workspacePath = config.workspacePath,
): Promise<SkillPromotionProposalRecord[]> {
  if (!workspacePath.trim()) return [];
  const url = new URL(`${config.workspaceWriterBaseUrl}/api/sciforge/skill-proposals/list`);
  url.searchParams.set('workspacePath', workspacePath);
  const response = await fetchWorkspace(config, `list skill proposals ${workspacePath}`, url);
  if (!response.ok) throw new Error(await workspaceResponseError(response, `List skill proposals failed: HTTP ${response.status}`));
  const json = await response.json() as { proposals?: SkillPromotionProposalRecord[] };
  return Array.isArray(json.proposals) ? json.proposals : [];
}

export async function acceptSkillPromotionProposal(config: SciForgeConfig, id: string, workspacePath = config.workspacePath): Promise<SkillPromotionProposalRecord['proposedManifest']> {
  const json = await mutateSkillPromotionProposal(config, 'accept', { workspacePath, id }) as { manifest?: SkillPromotionProposalRecord['proposedManifest'] };
  if (!json.manifest) throw new Error(`Accept skill proposal ${id} returned no manifest.`);
  return json.manifest;
}

export async function rejectSkillPromotionProposal(config: SciForgeConfig, id: string, reason?: string, workspacePath = config.workspacePath): Promise<SkillPromotionProposalRecord> {
  const json = await mutateSkillPromotionProposal(config, 'reject', { workspacePath, id, reason }) as { proposal?: SkillPromotionProposalRecord };
  if (!json.proposal) throw new Error(`Reject skill proposal ${id} returned no proposal.`);
  return json.proposal;
}

export async function archiveSkillPromotionProposal(config: SciForgeConfig, id: string, reason?: string, workspacePath = config.workspacePath): Promise<SkillPromotionProposalRecord> {
  const json = await mutateSkillPromotionProposal(config, 'archive', { workspacePath, id, reason }) as { proposal?: SkillPromotionProposalRecord };
  if (!json.proposal) throw new Error(`Archive skill proposal ${id} returned no proposal.`);
  return json.proposal;
}

export async function validateAcceptedSkillPromotionProposal(config: SciForgeConfig, skillId: string, workspacePath = config.workspacePath): Promise<SkillPromotionValidationResult> {
  const json = await mutateSkillPromotionProposal(config, 'validate', { workspacePath, skillId }) as { validation?: SkillPromotionValidationResult };
  if (!json.validation) throw new Error(`Validate evolved skill ${skillId} returned no validation result.`);
  return json.validation;
}

async function mutateSkillPromotionProposal(config: SciForgeConfig, action: 'accept' | 'reject' | 'archive' | 'validate', body: Record<string, unknown>) {
  const response = await fetchWorkspace(config, `${action} skill proposal`, `${config.workspaceWriterBaseUrl}/api/sciforge/skill-proposals/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await workspaceResponseError(response, `${action} skill proposal failed: HTTP ${response.status}`));
  return response.json();
}

async function mutateFeedbackIssue(config: SciForgeConfig, id: string, action: 'repair-runs' | 'repair-result', body: Record<string, unknown>, operation: string) {
  if (!id.trim()) throw new Error('id is required');
  const response = await fetchWorkspace(config, operation, `${config.workspaceWriterBaseUrl}/api/sciforge/feedback/issues/${encodeURIComponent(id)}/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await workspaceResponseError(response, `${operation} failed: HTTP ${response.status}`));
  return response.json();
}

async function writeWorkspaceScenario(config: SciForgeConfig, action: 'save' | 'publish' | 'archive' | 'restore' | 'delete', body: Record<string, unknown>) {
  const response = await fetchWorkspace(config, `${action} scenario`, `${config.workspaceWriterBaseUrl}/api/sciforge/scenarios/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await workspaceResponseError(response, `${action} scenario failed: HTTP ${response.status}`));
}

async function probeWorkspaceTerminalWriter(
  baseUrl: string,
  input: { label: string; timeoutMs?: number },
): Promise<WorkspaceTerminalWriterCandidate> {
  const normalized = normalizeWorkspaceWriterBaseUrl(baseUrl);
  const displayUrl = displayWorkspaceWriterUrl(normalized || baseUrl);
  if (!normalized) {
    return {
      label: input.label,
      baseUrl,
      displayUrl,
      ok: false,
      status: 'invalid-url',
      message: `${input.label} has an invalid Workspace Writer URL: ${displayUrl || 'empty URL'}.`,
    };
  }
  let response: Response;
  try {
    response = await fetch(`${normalized}/health`, {
      headers: { Accept: 'application/json' },
      signal: workspaceTerminalPreflightSignal(input.timeoutMs),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      label: input.label,
      baseUrl: normalized,
      displayUrl,
      ok: false,
      status: 'offline',
      message: `${input.label} is not reachable at ${displayUrl}: ${sanitizeWorkspaceDiagnosticText(detail)}.`,
    };
  }
  const text = await response.text().catch(() => '');
  const contentType = response.headers.get('content-type') ?? '';
  if (workspaceResponseLooksLikeHtml(text, contentType)) {
    return {
      label: input.label,
      baseUrl: normalized,
      displayUrl,
      ok: false,
      status: 'ui-html',
      message: `${input.label} at ${displayUrl} returned a SciForge UI/HTML page instead of Workspace Writer JSON.`,
    };
  }
  if (!response.ok) {
    return {
      label: input.label,
      baseUrl: normalized,
      displayUrl,
      ok: false,
      status: 'http-error',
      message: `${input.label} at ${displayUrl} failed /health with HTTP ${response.status}.`,
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      label: input.label,
      baseUrl: normalized,
      displayUrl,
      ok: false,
      status: 'invalid-json',
      message: `${input.label} at ${displayUrl} returned non-JSON health (${contentType || 'unknown content type'}).`,
    };
  }
  const health = normalizeWorkspaceWriterHealth(parsed);
  if (!health || health.ok !== true || health.service !== 'sciforge-workspace-writer') {
    return {
      label: input.label,
      baseUrl: normalized,
      displayUrl,
      ok: false,
      status: 'unexpected-service',
      message: `${input.label} at ${displayUrl} is not a SciForge Workspace Writer service.`,
    };
  }
  if (!health.capabilities.includes(WORKSPACE_TERMINAL_WEBSOCKET_PTY_CAPABILITY)) {
    return {
      label: input.label,
      baseUrl: normalized,
      displayUrl,
      ok: false,
      status: 'missing-terminal-capability',
      message: `${input.label} at ${displayUrl} is a stale Workspace Writer without ${WORKSPACE_TERMINAL_WEBSOCKET_PTY_CAPABILITY}.`,
      health,
    };
  }
  return {
    label: input.label,
    baseUrl: normalized,
    displayUrl,
    ok: true,
    status: 'ready',
    message: `${input.label} at ${displayUrl} is ready for workspace terminal PTY sessions.`,
    health,
  };
}

async function probeBrowserHostSessionWriter(
  baseUrl: string,
  input: { label: string; timeoutMs?: number },
): Promise<BrowserHostSessionWriterCandidate> {
  const normalized = normalizeWorkspaceWriterBaseUrl(baseUrl);
  const displayUrl = displayWorkspaceWriterUrl(normalized || baseUrl);
  if (!normalized) {
    return {
      label: input.label,
      baseUrl,
      displayUrl,
      ok: false,
      status: 'invalid-url',
      message: `${input.label} has an invalid Workspace Writer URL: ${displayUrl || 'empty URL'}.`,
    };
  }
  let response: Response;
  try {
    response = await fetch(`${normalized}/health`, {
      headers: { Accept: 'application/json' },
      signal: workspaceTerminalPreflightSignal(input.timeoutMs),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      label: input.label,
      baseUrl: normalized,
      displayUrl,
      ok: false,
      status: 'offline',
      message: `${input.label} is not reachable at ${displayUrl}: ${sanitizeWorkspaceDiagnosticText(detail)}.`,
    };
  }
  const text = await response.text().catch(() => '');
  const contentType = response.headers.get('content-type') ?? '';
  if (workspaceResponseLooksLikeHtml(text, contentType)) {
    return {
      label: input.label,
      baseUrl: normalized,
      displayUrl,
      ok: false,
      status: 'ui-html',
      message: `${input.label} at ${displayUrl} returned a SciForge UI/HTML page instead of Workspace Writer JSON.`,
    };
  }
  if (!response.ok) {
    return {
      label: input.label,
      baseUrl: normalized,
      displayUrl,
      ok: false,
      status: 'http-error',
      message: `${input.label} at ${displayUrl} failed /health with HTTP ${response.status}.`,
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      label: input.label,
      baseUrl: normalized,
      displayUrl,
      ok: false,
      status: 'invalid-json',
      message: `${input.label} at ${displayUrl} returned non-JSON health (${contentType || 'unknown content type'}).`,
    };
  }
  const health = normalizeWorkspaceWriterHealth(parsed);
  if (!health || health.ok !== true || health.service !== 'sciforge-workspace-writer') {
    return {
      label: input.label,
      baseUrl: normalized,
      displayUrl,
      ok: false,
      status: 'unexpected-service',
      message: `${input.label} at ${displayUrl} is not a SciForge Workspace Writer service.`,
    };
  }
  const missingRequirements = missingBrowserHostSessionRequirements(health);
  if (missingRequirements.length) {
    return {
      label: input.label,
      baseUrl: normalized,
      displayUrl,
      ok: false,
      status: 'missing-browser-host-capability',
      message: `${input.label} at ${displayUrl} is a stale Workspace Writer without native BrowserHostSession surface support: ${missingRequirements.join(', ')}. Restart runtime services so /health advertises native surface health, attach, and state support.`,
      health,
    };
  }
  return {
    label: input.label,
    baseUrl: normalized,
    displayUrl,
    ok: true,
    status: 'ready',
    message: `${input.label} at ${displayUrl} is ready for BrowserHostSession live browser sessions.`,
    health,
  };
}

function workspaceWriterCandidates(config: SciForgeConfig, configuredBaseUrl: string) {
  const candidates = new Map<string, { label: string; baseUrl: string }>();
  const defaultBaseUrl = normalizeWorkspaceWriterBaseUrl(defaultSciForgeConfig.workspaceWriterBaseUrl);
  if (defaultBaseUrl && defaultBaseUrl !== configuredBaseUrl) {
    candidates.set(defaultBaseUrl, { label: 'Default writer', baseUrl: defaultBaseUrl });
  }
  const legacyDefaultBaseUrl = normalizeWorkspaceWriterBaseUrl(LEGACY_DEFAULT_WORKSPACE_WRITER_URL);
  if (legacyDefaultBaseUrl && legacyDefaultBaseUrl !== configuredBaseUrl && !candidates.has(legacyDefaultBaseUrl)) {
    candidates.set(legacyDefaultBaseUrl, { label: 'Legacy default writer', baseUrl: legacyDefaultBaseUrl });
  }
  for (const peer of config.peerInstances ?? []) {
    if (peer.enabled === false) continue;
    const peerBaseUrl = normalizeWorkspaceWriterBaseUrl(peer.workspaceWriterUrl);
    if (!peerBaseUrl || peerBaseUrl === configuredBaseUrl || candidates.has(peerBaseUrl)) continue;
    candidates.set(peerBaseUrl, {
      label: peer.name?.trim() ? `${peer.name.trim()} writer` : 'Peer writer',
      baseUrl: peerBaseUrl,
    });
  }
  return Array.from(candidates.values());
}

function normalizeWorkspaceWriterBaseUrl(value: string | undefined) {
  const trimmed = value?.trim().replace(/\/+$/, '') ?? '';
  if (!trimmed) return '';
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return url.toString().replace(/\/+$/, '');
  } catch {
    return '';
  }
}

function displayWorkspaceWriterUrl(value: string | undefined) {
  const trimmed = value?.trim().replace(/\/+$/, '') ?? '';
  if (!trimmed) return '';
  try {
    const url = new URL(trimmed);
    const providerHost = /\b(?:api|[a-z0-9-]*(?:openai|anthropic|provider|openrouter|azure|googleapis)[a-z0-9-]*)(?:\.[a-z0-9-]+)+$/i.test(url.hostname);
    const host = providerHost ? '[host]' : url.host;
    const pathname = url.pathname === '/' ? '' : redactWorkspaceUrlSecrets(url.pathname);
    const params = Array.from(url.searchParams.entries()).map(([key, paramValue]) => {
      const nextValue = /api[_-]?key|authorization|credential|password|secret|token/i.test(key)
        ? '[redacted]'
        : redactWorkspaceUrlSecrets(paramValue);
      return `${encodeURIComponent(key)}=${encodeURIComponent(nextValue)}`;
    });
    return `${url.protocol}//${host}${pathname}${params.length ? `?${params.join('&')}` : ''}`;
  } catch {
    return sanitizeWorkspaceDiagnosticText(trimmed);
  }
}

function redactWorkspaceUrlSecrets(value: string) {
  return value.replace(/\b(?:sk|rk|pk)-[A-Za-z0-9][A-Za-z0-9_-]{8,}\b/g, '[redacted-token]');
}

function workspaceTerminalPreflightSignal(timeoutMs = 2500) {
  const timeout = typeof AbortSignal !== 'undefined'
    ? (AbortSignal as typeof AbortSignal & { timeout?: (milliseconds: number) => AbortSignal }).timeout
    : undefined;
  return typeof timeout === 'function'
    ? timeout(timeoutMs)
    : undefined;
}

function workspaceResponseLooksLikeHtml(text: string, contentType: string) {
  return /text\/html/i.test(contentType) || /^\s*<!doctype\b|^\s*<html[\s>]/i.test(text);
}

function normalizeWorkspaceWriterHealth(value: unknown): SciForgeWorkspaceWriterHealth | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Partial<SciForgeWorkspaceWriterHealth>;
  return {
    ok: record.ok === true,
    service: typeof record.service === 'string' ? record.service : '',
    schemaVersion: 1,
    pid: typeof record.pid === 'number' ? record.pid : undefined,
    startedAt: typeof record.startedAt === 'string' ? record.startedAt : undefined,
    instanceId: typeof record.instanceId === 'string' ? record.instanceId : undefined,
    lifecycleToken: typeof record.lifecycleToken === 'string' ? record.lifecycleToken : undefined,
    capabilities: Array.isArray(record.capabilities) ? record.capabilities.filter((item): item is string => typeof item === 'string') : [],
    endpoints: record.endpoints && typeof record.endpoints === 'object' ? record.endpoints : undefined,
  };
}

function missingBrowserHostSessionRequirements(health: SciForgeWorkspaceWriterHealth) {
  const missingCapabilities = BROWSER_HOST_REQUIRED_CAPABILITIES
    .filter((capability) => !health.capabilities.includes(capability))
    .map((capability) => `capability:${capability}`);
  const endpoints = health.endpoints ?? {};
  const browserHostSessionEndpoint = typeof endpoints.browserHostSession === 'string' ? endpoints.browserHostSession : '';
  const missingSessionEndpoints = BROWSER_HOST_SESSION_REQUIRED_ENDPOINT_TOKENS
    .filter((token) => !browserHostSessionEndpoint.includes(token))
    .map((token) => `endpoint:browserHostSession.${token}`);
  const browserHostNativeSurfaceEndpoint = browserHostNativeSurfaceEndpointFromHealth(endpoints, browserHostSessionEndpoint);
  const missingNativeSurfaceEndpoints = browserHostNativeSurfaceEndpoint
    ? BROWSER_HOST_NATIVE_SURFACE_REQUIRED_ENDPOINT_TOKENS
      .filter((token) => !browserHostNativeSurfaceEndpoint.includes(token))
      .map((token) => `endpoint:browserHostNativeSurface.${token}`)
    : ['endpoint:browserHostNativeSurface'];
  const browserHostSearchEndpoint = typeof endpoints.browserHostSearch === 'string' ? endpoints.browserHostSearch : '';
  const missingSearchEndpoints = browserHostSearchEndpoint.includes(BROWSER_HOST_SEARCH_REQUIRED_ENDPOINT_TOKEN)
    ? []
    : ['endpoint:browserHostSearch'];
  return [...missingCapabilities, ...missingSessionEndpoints, ...missingNativeSurfaceEndpoints, ...missingSearchEndpoints];
}

function browserHostNativeSurfaceEndpointFromHealth(
  endpoints: Record<string, unknown>,
  browserHostSessionEndpoint: string,
) {
  const explicitEndpoint = typeof endpoints.browserHostNativeSurface === 'string'
    ? endpoints.browserHostNativeSurface
    : typeof endpoints.browserHostSessionNativeSurface === 'string'
      ? endpoints.browserHostSessionNativeSurface
      : '';
  if (explicitEndpoint) return explicitEndpoint;
  return /native[-.]?surface|nativeSurface/i.test(browserHostSessionEndpoint) ? browserHostSessionEndpoint : '';
}

function primaryDiagnosticRef(status: WorkspaceTerminalWriterPreflightStatus) {
  return `workspace-terminal-writer-${status}`;
}

function browserHostDiagnosticRef(status: BrowserHostSessionWriterPreflightStatus) {
  return `browser-host-writer-${status}`;
}

async function readWorkspaceJson<T>(
  config: SciForgeConfig,
  operation: string,
  response: Response,
  fallback: string,
): Promise<T> {
  if (!response.ok) throw await workspaceRequestError(response, fallback);
  const text = await response.text();
  const contentType = response.headers.get('content-type') ?? '';
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    const looksLikeHtml = workspaceResponseLooksLikeHtml(text, contentType);
    const reason = looksLikeHtml
      ? `${sanitizeWorkspaceDiagnosticText(config.workspaceWriterBaseUrl)} 返回的是 SciForge UI 页面，不是 Workspace Writer JSON；请把 Workspace Writer URL 指向 writer 服务。`
      : `${sanitizeWorkspaceDiagnosticText(operation)} returned a non-JSON response (${contentType || 'unknown content type'}).`;
    throw new Error(new SciForgeClientError({
      title: 'Workspace Writer 响应不是 JSON',
      reason: sanitizeWorkspaceDiagnosticText(reason),
      recoverActions: recoverActionsForService('workspace'),
      diagnosticRef: looksLikeHtml ? 'workspace-writer-html-response' : 'workspace-writer-invalid-json',
      cause: error,
    }).message);
  }
}

async function workspaceResponseError(response: Response, fallback: string) {
  const text = await response.text();
  return new SciForgeClientError({
    title: 'Workspace Writer 请求失败',
    reason: sanitizeWorkspaceDiagnosticText(reasonFromResponseText(text, sanitizeWorkspaceDiagnosticText(fallback))),
    recoverActions: recoverActionsForService('workspace'),
    diagnosticRef: `workspace-http-${response.status}`,
  }).message;
}

class WorkspaceHttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'WorkspaceHttpError';
    this.status = status;
  }
}

async function workspaceRequestError(response: Response, fallback: string) {
  return new WorkspaceHttpError(response.status, await workspaceResponseError(response, fallback));
}

function sanitizeWorkspaceDiagnosticText(value: string) {
  return value
    .replace(/\bAuthorization\s*[:=]\s*Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Authorization: Bearer [redacted]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/\b(?:sk|rk|pk)-[A-Za-z0-9][A-Za-z0-9_-]{8,}\b/g, '[redacted-token]')
    .replace(
      /\b(api[_-]?key|authorization|credential|password|secret|token)\b(\s*[:=]\s*)(["']?)[^"',}\]\s]+/gi,
      (_match, key: string, separator: string, quote: string) => `${key}${separator}${quote}[redacted]`,
    )
    .replace(/\bhttps?:\/\/[^\s"'<>\\)]+/gi, '[url]')
    .replace(/\b(?:api|[a-z0-9-]*(?:openai|anthropic|provider|openrouter|azure|googleapis)[a-z0-9-]*)(?:\.[a-z0-9-]+)+(?:\:\d+)?\b/gi, '[host]')
    .replace(/\bfile:\/\/\/[^\s"'<>\\)]+/gi, '[workspace-path]')
    .replace(/\/(?:Applications|Users|home|private|var|tmp)\/[^\s"'<>\\)]+/gi, '[workspace-path]')
    .replace(/\b[A-Za-z]:\\Users\\[^\s"'<>]+/gi, '[workspace-path]');
}

function cachedWorkspacePreviewRequest<T>(
  cache: Map<string, WorkspacePreviewCacheEntry<T>>,
  key: string,
  load: () => Promise<T>,
): Promise<T> {
  const staleError = cachedStaleWorkspacePreviewError(cache, key);
  if (staleError) return Promise.reject(staleError);
  const cached = cache.get(key);
  if (cached?.promise) return cached.promise;
  const generation = workspacePreviewCacheGeneration;
  let promise: Promise<T>;
  promise = Promise.resolve().then(load).then(
    (value) => {
      if (workspacePreviewCacheGeneration === generation && cache.get(key)?.promise === promise) {
        cache.delete(key);
      }
      return value;
    },
    (error) => {
      if (workspacePreviewCacheGeneration === generation && cache.get(key)?.promise === promise) {
        if (isStaleWorkspacePreviewError(error)) {
          cache.set(key, { staleError: error instanceof Error ? error : new Error(String(error)), staleAt: Date.now() });
        } else {
          cache.delete(key);
        }
      }
      throw error;
    },
  );
  cache.set(key, { promise });
  return promise;
}

function cachedStaleWorkspacePreviewError<T>(cache: Map<string, WorkspacePreviewCacheEntry<T>>, key: string): Error | undefined {
  const cached = cache.get(key);
  if (!cached?.staleError || !cached.staleAt) return undefined;
  if (Date.now() - cached.staleAt > WORKSPACE_PREVIEW_STALE_CACHE_TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  return cached.staleError;
}

function isStaleWorkspacePreviewError(error: unknown) {
  return error instanceof WorkspaceHttpError && WORKSPACE_PREVIEW_STALE_STATUS_CODES.has(error.status);
}

function workspacePreviewCacheKey(config: SciForgeConfig, route: string, ref: string) {
  return JSON.stringify([
    config.workspaceWriterBaseUrl.replace(/\/+$/, ''),
    normalizeWorkspaceRootPath(config.workspacePath),
    route,
    ref.trim(),
  ]);
}

function clearWorkspacePreviewReadCache() {
  workspacePreviewCacheGeneration += 1;
  workspaceFileReadCache.clear();
  previewDescriptorReadCache.clear();
  previewDerivativeReadCache.clear();
}

async function fetchWorkspace(
  config: SciForgeConfig,
  operation: string,
  input: string | URL,
  init?: RequestInit,
): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new SciForgeClientError({
      title: 'Workspace Writer 未连接',
      reason: sanitizeWorkspaceDiagnosticText(`${config.workspaceWriterBaseUrl} 无法访问，操作：${operation}。${detail}`),
      recoverActions: recoverActionsForService('workspace'),
      diagnosticRef: 'workspace-connection',
      cause: error,
    });
  }
}
