import { createHash } from 'node:crypto';
import { basename, join } from 'node:path';
import {
  WORKSPACE_RUNTIME_ARTIFACT_PREVIEW_CAPABILITY_ID,
} from '@sciforge-ui/runtime-contract';
import { isRecord, readOptionalJson } from './server/http.js';
import { gitOutput } from './workspace-server-git.js';

export const WORKSPACE_INSTANCE_MANIFEST_CAPABILITIES = [
  'instance-manifest',
  'stable-version-registry',
  'stable-version-promote',
  'stable-version-sync-plan',
  'feedback-issues-list',
  'feedback-issue-handoff-bundle',
  'feedback-comment-evidence-persistence',
  'feedback-direct-codex-terminal-websocket-pty',
  'feedback-direct-codex-terminal-system-terminal',
  'feedback-repair-run-record',
  'feedback-repair-result-record',
  'feedback-repair-terminal-mirror-tail',
  'feedback-repair-stop-request',
  'feedback-repair-guidance-input',
  'feedback-scrubbed-screenshot-evidence-assets',
  'feedback-repair-evidence-store',
  'feedback-repair-evidence-upload',
  'runtime-provider-preflight-manifest',
  'runtime-codex-browser-acceptance-manifest',
  'repair-handoff-runner',
  'workspace-snapshot',
  'workspace-files',
  WORKSPACE_RUNTIME_ARTIFACT_PREVIEW_CAPABILITY_ID,
  'sciforge-tools',
] as const;

export type WorkspaceRepoInfo = {
  detected: false;
} | {
  detected: true;
  root: string;
  branch?: string;
  commit?: string;
  remote?: string;
  dirty: boolean;
};

export interface WorkspaceInstanceManifestInput {
  root: string;
  state: Record<string, unknown> | undefined;
  config: Record<string, unknown>;
  localConfig: Record<string, unknown>;
  repo: WorkspaceRepoInfo;
  stableVersion: unknown;
  agentId: string;
  role: string;
  appPort: number;
  workspaceWriterPort: number;
  repoPath: string;
  stateDir: string;
  logDir: string;
  configLocalPath: string;
  counterpart: unknown;
  generatedAt?: string;
}

export interface WorkspaceStableVersionEnvironmentInput {
  root: string;
  state: Record<string, unknown> | undefined;
  repo: WorkspaceRepoInfo;
  instanceId: string;
  role: string;
  stateDir: string;
}

export async function readWorkspaceConfig(root: string): Promise<Record<string, unknown>> {
  const parsed = await readOptionalJson(join(root, '.sciforge', 'config.json'));
  return isRecord(parsed) ? parsed : {};
}

export async function readWorkspaceRepoInfo(root: string): Promise<WorkspaceRepoInfo> {
  const [topLevel, branch, commit] = await Promise.all([
    gitOutput(root, ['rev-parse', '--show-toplevel']),
    gitOutput(root, ['rev-parse', '--abbrev-ref', 'HEAD']),
    gitOutput(root, ['rev-parse', 'HEAD']),
  ]);
  if (!topLevel) return { detected: false };
  const remote = await gitOutput(root, ['config', '--get', 'remote.origin.url']);
  const status = await gitOutput(root, ['status', '--porcelain']);
  return {
    detected: true,
    root: topLevel,
    branch: branch || undefined,
    commit: commit || undefined,
    remote: remote || undefined,
    dirty: Boolean(status),
  };
}

export function buildWorkspaceInstanceManifest(input: WorkspaceInstanceManifestInput) {
  return {
    schemaVersion: 1,
    agentId: input.agentId,
    role: input.role,
    appPort: input.appPort,
    workspaceWriterPort: input.workspaceWriterPort,
    appUrl: `http://127.0.0.1:${input.appPort}`,
    workspaceWriterUrl: input.localConfig.workspaceWriterBaseUrl,
    agentServerBaseUrl: input.localConfig.agentServerBaseUrl,
    repoPath: input.repoPath,
    stateDir: input.stateDir,
    logDir: input.logDir,
    configLocalPath: input.configLocalPath,
    counterpart: input.counterpart,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    instance: {
      id: input.agentId !== 'default' ? input.agentId : workspaceInstanceIdForRoot(input.root, input.state),
      name: typeof input.config.name === 'string' && input.config.name.trim() ? input.config.name.trim() : basename(input.root) || 'SciForge workspace',
      role: input.role,
    },
    workspacePath: input.root,
    repo: input.repo,
    stableVersion: input.stableVersion,
    capabilities: [...WORKSPACE_INSTANCE_MANIFEST_CAPABILITIES],
  };
}

export function buildWorkspaceStableVersionEnvironment(input: WorkspaceStableVersionEnvironmentInput) {
  return {
    instanceId: input.instanceId !== 'default' ? input.instanceId : workspaceInstanceIdForRoot(input.root, input.state),
    role: input.role,
    stateDir: input.stateDir,
    repoRoot: input.repo.detected && typeof input.repo.root === 'string' ? input.repo.root : input.root,
    branch: input.repo.detected && typeof input.repo.branch === 'string' ? input.repo.branch : undefined,
    commit: input.repo.detected && typeof input.repo.commit === 'string' ? input.repo.commit : undefined,
  };
}

export function workspaceInstanceIdForRoot(root: string, state: Record<string, unknown> | undefined) {
  if (state && typeof state.instanceId === 'string' && state.instanceId.trim()) return state.instanceId.trim();
  return `sciforge-${createHash('sha256').update(root).digest('hex').slice(0, 16)}`;
}
