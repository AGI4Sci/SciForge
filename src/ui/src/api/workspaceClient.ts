import type { BioAgentConfig, BioAgentWorkspaceState, RuntimeExecutionUnit } from '../domain';
import type { ScenarioLibraryState } from '../scenarioCompiler/scenarioLibrary';
import type { ScenarioPackage } from '../scenarioCompiler/scenarioPackage';
import { parseWorkspaceState } from '../sessionStore';
import { normalizeConfig, normalizeWorkspaceRootPath } from '../config';
import { BioAgentClientError, reasonFromResponseText, recoverActionsForService } from './clientError';

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
  createdAt: string;
}

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

export async function loadFileBackedBioAgentConfig(config: BioAgentConfig): Promise<BioAgentConfig | undefined> {
  const response = await fetchWorkspace(config, 'load config.local.json', `${config.workspaceWriterBaseUrl}/api/bioagent/config`);
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(await workspaceResponseError(response, `Load config failed: HTTP ${response.status}`));
  const json = await response.json() as { config?: unknown };
  return isBioAgentConfig(json.config) ? normalizeConfig(json.config) : undefined;
}

export async function saveFileBackedBioAgentConfig(config: BioAgentConfig): Promise<BioAgentConfig | undefined> {
  const response = await fetchWorkspace(config, 'save config.local.json', `${config.workspaceWriterBaseUrl}/api/bioagent/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config }),
  });
  if (!response.ok) throw new Error(await workspaceResponseError(response, `Save config failed: HTTP ${response.status}`));
  const json = await response.json() as { config?: unknown };
  return isBioAgentConfig(json.config) ? normalizeConfig(json.config) : undefined;
}

export async function persistWorkspaceState(state: BioAgentWorkspaceState, config: BioAgentConfig): Promise<void> {
  const workspacePath = normalizeWorkspaceRootPath(state.workspacePath);
  if (!workspacePath) return;
  const normalizedState = { ...state, workspacePath };
  const operation = `snapshot workspace ${workspacePath}`;
  const response = await fetchWorkspace(config, operation, `${config.workspaceWriterBaseUrl}/api/bioagent/workspace/snapshot`, {
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

function isBioAgentConfig(value: unknown): value is BioAgentConfig {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return record.schemaVersion === 1
    && typeof record.agentServerBaseUrl === 'string'
    && typeof record.workspaceWriterBaseUrl === 'string'
    && typeof record.workspacePath === 'string'
    && typeof record.modelProvider === 'string'
    && typeof record.modelBaseUrl === 'string'
    && typeof record.modelName === 'string'
    && typeof record.apiKey === 'string'
    && typeof record.requestTimeoutMs === 'number'
    && typeof record.updatedAt === 'string';
}

export async function loadPersistedWorkspaceState(path: string, config: BioAgentConfig): Promise<BioAgentWorkspaceState | undefined> {
  if (path.trim()) return fetchPersistedWorkspaceState(path, config);
  return fetchPersistedWorkspaceState('', config);
}

async function fetchPersistedWorkspaceState(path: string, config: BioAgentConfig): Promise<BioAgentWorkspaceState | undefined> {
  const url = new URL(`${config.workspaceWriterBaseUrl}/api/bioagent/workspace/snapshot`);
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

export async function listWorkspace(path: string, config: BioAgentConfig): Promise<WorkspaceEntry[]> {
  if (!path.trim()) return [];
  const url = new URL(`${config.workspaceWriterBaseUrl}/api/bioagent/workspace/list`);
  url.searchParams.set('path', path);
  const response = await fetchWorkspace(config, `list workspace ${path}`, url);
  if (!response.ok) throw new Error(await workspaceResponseError(response, `List failed: HTTP ${response.status}`));
  const json = await response.json() as { entries?: WorkspaceEntry[] };
  return Array.isArray(json.entries) ? json.entries : [];
}

export async function readWorkspaceFile(path: string, config: BioAgentConfig): Promise<WorkspaceFileContent> {
  if (!path.trim()) throw new Error('path is required');
  const url = new URL(`${config.workspaceWriterBaseUrl}/api/bioagent/workspace/file`);
  url.searchParams.set('path', path);
  const response = await fetchWorkspace(config, `read workspace file ${path}`, url);
  if (!response.ok) throw new Error(await workspaceResponseError(response, `Read file failed: HTTP ${response.status}`));
  const json = await response.json() as { file?: WorkspaceFileContent };
  if (!json.file) throw new Error(`Read file ${path} returned no file payload.`);
  return json.file;
}

export async function writeWorkspaceFile(path: string, content: string, config: BioAgentConfig): Promise<WorkspaceFileContent> {
  if (!path.trim()) throw new Error('path is required');
  const response = await fetchWorkspace(config, `write workspace file ${path}`, `${config.workspaceWriterBaseUrl}/api/bioagent/workspace/file`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, content }),
  });
  if (!response.ok) throw new Error(await workspaceResponseError(response, `Write file failed: HTTP ${response.status}`));
  const json = await response.json() as { file?: WorkspaceFileContent };
  if (!json.file) throw new Error(`Write file ${path} returned no file payload.`);
  return json.file;
}

export async function mutateWorkspaceFile(
  config: BioAgentConfig,
  action: 'create-file' | 'create-folder' | 'rename' | 'delete',
  payload: { path: string; targetPath?: string },
): Promise<void> {
  const operation = `${action} ${payload.path}`;
  const response = await fetchWorkspace(config, operation, `${config.workspaceWriterBaseUrl}/api/bioagent/workspace/file-action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...payload }),
  });
  if (!response.ok) throw new Error(await workspaceResponseError(response, `File action failed: HTTP ${response.status}`));
}

export async function openWorkspaceObject(
  config: BioAgentConfig,
  action: WorkspaceOpenResult['action'],
  path: string,
  workspacePath = config.workspacePath,
): Promise<WorkspaceOpenResult> {
  const response = await fetchWorkspace(config, `${action} workspace object`, `${config.workspaceWriterBaseUrl}/api/bioagent/workspace/open`, {
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

export async function listWorkspaceScenarios(config: BioAgentConfig, workspacePath = config.workspacePath): Promise<WorkspaceScenarioListItem[]> {
  if (!workspacePath.trim()) return [];
  const url = new URL(`${config.workspaceWriterBaseUrl}/api/bioagent/scenarios/list`);
  url.searchParams.set('workspacePath', workspacePath);
  const response = await fetchWorkspace(config, `list scenarios ${workspacePath}`, url);
  if (!response.ok) throw new Error(await workspaceResponseError(response, `List scenarios failed: HTTP ${response.status}`));
  const json = await response.json() as { scenarios?: WorkspaceScenarioListItem[] };
  return Array.isArray(json.scenarios) ? json.scenarios : [];
}

export async function loadScenarioLibrary(config: BioAgentConfig, workspacePath = config.workspacePath): Promise<ScenarioLibraryState | undefined> {
  if (!workspacePath.trim()) return undefined;
  const url = new URL(`${config.workspaceWriterBaseUrl}/api/bioagent/scenarios/library`);
  url.searchParams.set('workspacePath', workspacePath);
  const response = await fetchWorkspace(config, `load scenario library ${workspacePath}`, url);
  if (!response.ok) throw new Error(await workspaceResponseError(response, `Load scenario library failed: HTTP ${response.status}`));
  const json = await response.json() as { library?: ScenarioLibraryState };
  return json.library;
}

export async function loadWorkspaceScenario(config: BioAgentConfig, id: string, workspacePath = config.workspacePath): Promise<ScenarioPackage | undefined> {
  if (!workspacePath.trim() || !id.trim()) return undefined;
  const url = new URL(`${config.workspaceWriterBaseUrl}/api/bioagent/scenarios/get`);
  url.searchParams.set('workspacePath', workspacePath);
  url.searchParams.set('id', id);
  const response = await fetchWorkspace(config, `load scenario ${id}`, url);
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(await workspaceResponseError(response, `Load scenario failed: HTTP ${response.status}`));
  const json = await response.json() as { package?: ScenarioPackage };
  return json.package;
}

export async function saveWorkspaceScenario(config: BioAgentConfig, pkg: ScenarioPackage, workspacePath = config.workspacePath): Promise<void> {
  await writeWorkspaceScenario(config, 'save', { workspacePath, package: pkg });
}

export async function publishWorkspaceScenario(config: BioAgentConfig, pkg: ScenarioPackage, workspacePath = config.workspacePath): Promise<void> {
  await writeWorkspaceScenario(config, 'publish', { workspacePath, package: pkg });
}

export async function archiveWorkspaceScenario(config: BioAgentConfig, id: string, workspacePath = config.workspacePath): Promise<void> {
  await writeWorkspaceScenario(config, 'archive', { workspacePath, id });
}

export async function deleteWorkspaceScenario(config: BioAgentConfig, id: string, workspacePath = config.workspacePath): Promise<void> {
  await writeWorkspaceScenario(config, 'delete', { workspacePath, id });
}

export async function restoreWorkspaceScenario(config: BioAgentConfig, id: string, status: 'draft' | 'validated' | 'published' = 'draft', workspacePath = config.workspacePath): Promise<void> {
  await writeWorkspaceScenario(config, 'restore', { workspacePath, id, status });
}

export async function listWorkspaceTaskAttempts(
  config: BioAgentConfig,
  options: { workspacePath?: string; skillDomain?: string; scenarioPackageId?: string; limit?: number } = {},
): Promise<WorkspaceTaskAttemptRecord[]> {
  const workspacePath = options.workspacePath ?? config.workspacePath;
  if (!workspacePath.trim()) return [];
  const url = new URL(`${config.workspaceWriterBaseUrl}/api/bioagent/task-attempts/list`);
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
  config: BioAgentConfig,
  id: string,
  workspacePath = config.workspacePath,
): Promise<WorkspaceTaskAttemptRecord[]> {
  if (!workspacePath.trim() || !id.trim()) return [];
  const url = new URL(`${config.workspaceWriterBaseUrl}/api/bioagent/task-attempts/get`);
  url.searchParams.set('workspacePath', workspacePath);
  url.searchParams.set('id', id);
  const response = await fetchWorkspace(config, `load task attempts ${id}`, url);
  if (!response.ok) throw new Error(await workspaceResponseError(response, `Load task attempts failed: HTTP ${response.status}`));
  const json = await response.json() as { attempts?: WorkspaceTaskAttemptRecord[] };
  return Array.isArray(json.attempts) ? json.attempts : [];
}

export async function listSkillPromotionProposals(
  config: BioAgentConfig,
  workspacePath = config.workspacePath,
): Promise<SkillPromotionProposalRecord[]> {
  if (!workspacePath.trim()) return [];
  const url = new URL(`${config.workspaceWriterBaseUrl}/api/bioagent/skill-proposals/list`);
  url.searchParams.set('workspacePath', workspacePath);
  const response = await fetchWorkspace(config, `list skill proposals ${workspacePath}`, url);
  if (!response.ok) throw new Error(await workspaceResponseError(response, `List skill proposals failed: HTTP ${response.status}`));
  const json = await response.json() as { proposals?: SkillPromotionProposalRecord[] };
  return Array.isArray(json.proposals) ? json.proposals : [];
}

export async function acceptSkillPromotionProposal(config: BioAgentConfig, id: string, workspacePath = config.workspacePath): Promise<SkillPromotionProposalRecord['proposedManifest']> {
  const json = await mutateSkillPromotionProposal(config, 'accept', { workspacePath, id }) as { manifest?: SkillPromotionProposalRecord['proposedManifest'] };
  if (!json.manifest) throw new Error(`Accept skill proposal ${id} returned no manifest.`);
  return json.manifest;
}

export async function rejectSkillPromotionProposal(config: BioAgentConfig, id: string, reason?: string, workspacePath = config.workspacePath): Promise<SkillPromotionProposalRecord> {
  const json = await mutateSkillPromotionProposal(config, 'reject', { workspacePath, id, reason }) as { proposal?: SkillPromotionProposalRecord };
  if (!json.proposal) throw new Error(`Reject skill proposal ${id} returned no proposal.`);
  return json.proposal;
}

export async function archiveSkillPromotionProposal(config: BioAgentConfig, id: string, reason?: string, workspacePath = config.workspacePath): Promise<SkillPromotionProposalRecord> {
  const json = await mutateSkillPromotionProposal(config, 'archive', { workspacePath, id, reason }) as { proposal?: SkillPromotionProposalRecord };
  if (!json.proposal) throw new Error(`Archive skill proposal ${id} returned no proposal.`);
  return json.proposal;
}

export async function validateAcceptedSkillPromotionProposal(config: BioAgentConfig, skillId: string, workspacePath = config.workspacePath): Promise<SkillPromotionValidationResult> {
  const json = await mutateSkillPromotionProposal(config, 'validate', { workspacePath, skillId }) as { validation?: SkillPromotionValidationResult };
  if (!json.validation) throw new Error(`Validate evolved skill ${skillId} returned no validation result.`);
  return json.validation;
}

async function mutateSkillPromotionProposal(config: BioAgentConfig, action: 'accept' | 'reject' | 'archive' | 'validate', body: Record<string, unknown>) {
  const response = await fetchWorkspace(config, `${action} skill proposal`, `${config.workspaceWriterBaseUrl}/api/bioagent/skill-proposals/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await workspaceResponseError(response, `${action} skill proposal failed: HTTP ${response.status}`));
  return response.json();
}

async function writeWorkspaceScenario(config: BioAgentConfig, action: 'save' | 'publish' | 'archive' | 'restore' | 'delete', body: Record<string, unknown>) {
  const response = await fetchWorkspace(config, `${action} scenario`, `${config.workspaceWriterBaseUrl}/api/bioagent/scenarios/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await workspaceResponseError(response, `${action} scenario failed: HTTP ${response.status}`));
}

async function workspaceResponseError(response: Response, fallback: string) {
  const text = await response.text();
  return new BioAgentClientError({
    title: 'Workspace Writer 请求失败',
    reason: reasonFromResponseText(text, fallback),
    recoverActions: recoverActionsForService('workspace'),
    diagnosticRef: `workspace-http-${response.status}`,
  }).message;
}

async function fetchWorkspace(
  config: BioAgentConfig,
  operation: string,
  input: string | URL,
  init?: RequestInit,
): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new BioAgentClientError({
      title: 'Workspace Writer 未连接',
      reason: `${config.workspaceWriterBaseUrl} 无法访问，操作：${operation}。${detail}`,
      recoverActions: recoverActionsForService('workspace'),
      diagnosticRef: 'workspace-connection',
      cause: error,
    });
  }
}
