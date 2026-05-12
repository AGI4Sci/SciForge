import type {
  FeedbackIssueHandoffBundle,
  FeedbackIssueSummary,
  FeedbackRepairResultRecord,
  FeedbackRepairRunRecord,
  SciForgeConfig,
  SciForgeInstanceManifest,
  SciForgeWorkspaceState,
  PreviewDescriptor,
  PreviewDerivative,
  RuntimeExecutionUnit,
  TaskRunCard,
} from '../domain';
import type { ScenarioLibraryState } from '@sciforge/scenario-core/scenario-library';
import type { ScenarioPackage } from '@sciforge/scenario-core/scenario-package';
import { parseWorkspaceState } from '../sessionStore';
import { defaultSciForgeConfig, normalizeConfig, normalizeWorkspaceRootPath } from '../config';
import { SciForgeClientError, reasonFromResponseText, recoverActionsForService } from './clientError';

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

export async function loadFileBackedSciForgeConfig(config: SciForgeConfig): Promise<SciForgeConfig | undefined> {
  const response = await fetchWorkspaceConfigWithFallback(config);
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(await workspaceResponseError(response, `Load config failed: HTTP ${response.status}`));
  const json = await response.json() as { config?: unknown };
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
  if (!response.ok) throw new Error(await workspaceResponseError(response, `Save config failed: HTTP ${response.status}`));
  const json = await response.json() as { config?: unknown };
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
    && typeof record.updatedAt === 'string';
}

export async function loadPersistedWorkspaceState(path: string, config: SciForgeConfig): Promise<SciForgeWorkspaceState | undefined> {
  if (path.trim()) return fetchPersistedWorkspaceState(path, config);
  return fetchPersistedWorkspaceState('', config);
}

async function fetchPersistedWorkspaceState(path: string, config: SciForgeConfig): Promise<SciForgeWorkspaceState | undefined> {
  const url = new URL(`${config.workspaceWriterBaseUrl}/api/sciforge/workspace/snapshot`);
  if (path.trim()) url.searchParams.set('path', path);
  const label = path.trim() || 'last workspace';
  const response = await fetchWorkspace(config, `load workspace snapshot ${label}`, url);
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(await workspaceResponseError(response, `Load snapshot failed: HTTP ${response.status}`));
  const json = await response.json() as { workspacePath?: unknown; state?: unknown };
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
  if (!response.ok) throw new Error(await workspaceResponseError(response, `List failed: HTTP ${response.status}`));
  const json = await response.json() as { entries?: WorkspaceEntry[] };
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
      if (!response.ok) throw await workspaceRequestError(response, `Read file failed: HTTP ${response.status}`);
      const json = await response.json() as { file?: WorkspaceFileContent };
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
      if (!response.ok) throw await workspaceRequestError(response, `Read preview descriptor failed: HTTP ${response.status}`);
      const json = await response.json() as { descriptor?: PreviewDescriptor };
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
      if (!response.ok) throw await workspaceRequestError(response, `Read preview derivative failed: HTTP ${response.status}`);
      const json = await response.json() as { derivative?: PreviewDerivative };
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
    body: JSON.stringify({ path, content, encoding: options?.encoding, mimeType: options?.mimeType }),
  });
  if (!response.ok) throw new Error(await workspaceResponseError(response, `Write file failed: HTTP ${response.status}`));
  const json = await response.json() as { file?: WorkspaceFileContent };
  if (!json.file) throw new Error(`Write file ${path} returned no file payload.`);
  clearWorkspacePreviewReadCache();
  return json.file;
}

export async function mutateWorkspaceFile(
  config: SciForgeConfig,
  action: 'create-file' | 'create-folder' | 'rename' | 'delete',
  payload: { path: string; targetPath?: string },
): Promise<void> {
  const operation = `${action} ${payload.path}`;
  const response = await fetchWorkspace(config, operation, `${config.workspaceWriterBaseUrl}/api/sciforge/workspace/file-action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...payload }),
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

async function workspaceResponseError(response: Response, fallback: string) {
  const text = await response.text();
  return new SciForgeClientError({
    title: 'Workspace Writer 请求失败',
    reason: reasonFromResponseText(text, fallback),
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
      reason: `${config.workspaceWriterBaseUrl} 无法访问，操作：${operation}。${detail}`,
      recoverActions: recoverActionsForService('workspace'),
      diagnosticRef: 'workspace-connection',
      cause: error,
    });
  }
}
