import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import type { TaskProjectPaths } from './task-project-contracts.js';

export function normalizeWorkspace(workspace: string) {
  return resolve(workspace);
}

export function taskProjectRelativePaths(projectId: string): TaskProjectPaths {
  const root = join('.sciforge', 'projects', projectId);
  return {
    root,
    projectJson: join(root, 'project.json'),
    planJson: join(root, 'plan.json'),
    stages: join(root, 'stages'),
    src: join(root, 'src'),
    artifacts: join(root, 'artifacts'),
    evidence: join(root, 'evidence'),
    logs: join(root, 'logs'),
  };
}

export function resolveWorkspacePath(workspaceRoot: string, relPath: string) {
  assertWorkspaceRelative(workspaceRoot, relPath);
  return resolve(workspaceRoot, relPath);
}

export function assertWorkspaceRelative(workspaceRoot: string, relPath: string) {
  if (!relPath || /^[a-z][a-z0-9+.-]*:/i.test(relPath) || relPath.startsWith('/') || relPath.startsWith('\\')) {
    throw new Error(`Path must be relative to workspace: ${relPath}`);
  }
  const resolved = resolve(workspaceRoot, relPath);
  const rel = relative(workspaceRoot, resolved);
  if (rel === '..' || rel.startsWith(`..${join('a', 'b').slice(1, 2)}`) || rel.startsWith('../') || rel.startsWith('..\\')) {
    throw new Error(`Path escapes workspace: ${relPath}`);
  }
}

export function stageRef(projectId: string, stageId: string) {
  return fileRef(join('.sciforge', 'projects', projectId, 'stages', `${stageId}.json`));
}

export function stageEvidenceRef(projectId: string, stageId: string, seed: string) {
  return fileRef(join('.sciforge', 'projects', projectId, 'evidence', `${stageId}-${safeToken(seed)}.json`));
}

export function fileRef(relPath: string) {
  return `file:${relPath.split('\\').join('/')}`;
}

export function stripFileRef(ref: string) {
  return ref.startsWith('file:') ? ref.slice('file:'.length) : ref;
}

export function normalizeOptionalRef(workspaceRoot: string, value: string | undefined) {
  return value === undefined ? undefined : normalizeRef(workspaceRoot, value);
}

export function normalizeRef(workspaceRoot: string, value: string) {
  const ref = value.trim();
  if (!ref) throw new Error('Task project ref cannot be empty');
  if (/^[a-z][a-z0-9+.-]*:/i.test(ref) && !ref.startsWith('file:')) return ref;
  const rel = stripFileRef(ref);
  assertWorkspaceRelative(workspaceRoot, rel);
  return fileRef(rel);
}

export async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

export async function taskProjectPathExists(workspace: string, relPath: string) {
  try {
    await stat(resolveWorkspacePath(normalizeWorkspace(workspace), relPath));
    return true;
  } catch {
    return false;
  }
}

function safeToken(value: string) {
  return value.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'evidence';
}
