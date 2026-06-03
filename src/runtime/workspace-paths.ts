import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

const MANAGED_WORKSPACE_NAMESPACES = new Set([
  'artifacts',
  'exports',
  'logs',
  'preview-cache',
  'sessions',
  'task-inputs',
  'task-results',
  'verifications',
  'versions',
]);

export const WORKSPACE_BROWSER_PROFILE_REF = '.sciforge/browser-host/profile' as const;

export interface WorkspaceBrowserProfileState {
  workspaceRoot: string;
  runtimeDir: string;
  profileDir: string;
  profileRef: typeof WORKSPACE_BROWSER_PROFILE_REF;
  ignoredRuntimeState: true;
  storageScope: 'workspace';
  reusesUserMainProfile: false;
}

export function normalizeWorkspaceRootPath(value: string) {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  const marker = '/.sciforge/';
  const nestedIndex = trimmed.indexOf(marker);
  if (nestedIndex >= 0) return trimmed.slice(0, nestedIndex);
  if (trimmed.endsWith('/.sciforge')) return trimmed.slice(0, -'/.sciforge'.length);
  return trimmed;
}

export function resolveWorkspacePreviewRef(ref: string, workspacePath = '') {
  return resolveWorkspaceFilePreviewPath(ref.replace(/^(file|path|artifact):/i, ''), workspacePath);
}

export function resolveWorkspaceFileRefPath(ref: string, workspacePath: string) {
  const workspaceRoot = normalizeWorkspaceRootPath(resolve(workspacePath || process.cwd()));
  if (!workspaceRoot) throw new Error('workspace path is required');
  const stripped = stripWorkspaceFileLikeRef(ref);
  if (!stripped) throw new Error('path is required');
  if (/^[a-z][a-z0-9+.-]*:/i.test(stripped)) {
    throw new Error(`Unsupported workspace file ref: ${ref}`);
  }
  const targetPath = resolveInsideWorkspace(workspaceRoot, stripped);
  const managedPath = managedWorkspacePathCandidate(workspaceRoot, stripped);
  if (managedPath && !existsSync(targetPath) && existsSync(managedPath)) return managedPath;
  return targetPath;
}

export function workspaceBrowserRuntimeDir(workspacePath: string) {
  const workspaceRoot = normalizeWorkspaceRootPath(resolve(workspacePath || process.cwd()));
  if (!workspaceRoot) throw new Error('workspace path is required');
  return join(workspaceRoot, '.sciforge', 'browser-host');
}

export function workspaceBrowserProfileDir(workspacePath: string) {
  return workspaceBrowserProfileState(workspacePath).profileDir;
}

export function workspaceBrowserProfileState(workspacePath: string): WorkspaceBrowserProfileState {
  const workspaceRoot = normalizeWorkspaceRootPath(resolve(workspacePath || process.cwd()));
  if (!workspaceRoot) throw new Error('workspace path is required');
  const runtimeDir = join(workspaceRoot, '.sciforge', 'browser-host');
  return {
    workspaceRoot,
    runtimeDir,
    profileDir: join(runtimeDir, 'profile'),
    profileRef: WORKSPACE_BROWSER_PROFILE_REF,
    ignoredRuntimeState: true,
    storageScope: 'workspace',
    reusesUserMainProfile: false,
  };
}

export async function ensureWorkspaceBrowserProfileDir(workspacePath: string): Promise<WorkspaceBrowserProfileState> {
  const state = workspaceBrowserProfileState(workspacePath);
  await mkdir(state.profileDir, { recursive: true });
  await ensureWorkspaceRuntimeGitignore(state.workspaceRoot);
  return state;
}

export function workspaceBrowserOutputDir(workspacePath: string, runtime = 'output') {
  return join(workspaceBrowserRuntimeDir(workspacePath), safeWorkspaceRuntimeSegment(runtime));
}

export function resolveWorkspaceFilePreviewPath(rawPath: string, workspacePath = '') {
  const stripped = stripWorkspaceFileLikeRef(rawPath);
  if (!stripped) throw new Error('path is required');
  const workspaceRoot = workspacePath.trim() ? normalizeWorkspaceRootPath(resolve(workspacePath)) : '';
  if (!workspaceRoot || isAbsolute(stripped)) return resolve(stripped);
  const targetPath = resolveInsideWorkspace(workspaceRoot, stripped);
  const managedPath = managedWorkspacePathCandidate(workspaceRoot, stripped);
  if (managedPath && !existsSync(targetPath) && existsSync(managedPath)) return managedPath;
  return targetPath;
}

function stripWorkspaceFileLikeRef(ref: string) {
  return ref.trim().replace(/^(file|folder):/i, '');
}

function managedWorkspacePathCandidate(workspaceRoot: string, stripped: string) {
  if (stripped.startsWith('.sciforge/') || stripped === '.sciforge') return undefined;
  const namespace = stripped.split(/[\\/]/)[0];
  if (!MANAGED_WORKSPACE_NAMESPACES.has(namespace)) return undefined;
  return resolveInsideWorkspace(workspaceRoot, join('.sciforge', stripped));
}

function resolveInsideWorkspace(workspaceRoot: string, relativePath: string) {
  const targetPath = resolve(workspaceRoot, relativePath);
  const rel = relative(workspaceRoot, targetPath);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error('Workspace File Gateway refused a path outside the active workspace.');
  }
  return targetPath;
}

function safeWorkspaceRuntimeSegment(value: string) {
  const segment = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return segment || 'output';
}

async function ensureWorkspaceRuntimeGitignore(workspaceRoot: string) {
  const gitignorePath = join(workspaceRoot, '.gitignore');
  const ignoredLine = '.sciforge/';
  let current = '';
  try {
    current = await readFile(gitignorePath, 'utf8');
  } catch {
    current = '';
  }
  if (current.split(/\r?\n/).some((line) => line.trim() === ignoredLine)) return;
  const prefix = current && !current.endsWith('\n') ? `${current}\n` : current;
  await writeFile(gitignorePath, `${prefix}${ignoredLine}\n`, 'utf8');
}
