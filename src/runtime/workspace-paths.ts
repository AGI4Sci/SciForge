import { existsSync } from 'node:fs';
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

export function resolveWorkspaceFilePreviewPath(rawPath: string, workspacePath = '') {
  const stripped = rawPath.trim().replace(/^(file|folder):/i, '');
  if (!stripped) throw new Error('path is required');
  const workspaceRoot = workspacePath.trim() ? normalizeWorkspaceRootPath(resolve(workspacePath)) : '';
  if (!workspaceRoot || isAbsolute(stripped)) return resolve(stripped);
  const targetPath = resolveInsideWorkspace(workspaceRoot, stripped);
  const managedPath = managedWorkspacePathCandidate(workspaceRoot, stripped);
  if (managedPath && !existsSync(targetPath) && existsSync(managedPath)) return managedPath;
  return targetPath;
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
