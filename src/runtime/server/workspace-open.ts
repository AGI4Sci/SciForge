import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { normalizeWorkspaceRootPath } from '../workspace-paths.js';
import { isBinaryPreviewFile } from './file-preview.js';

export type WorkspaceOpenAction = 'open-external' | 'reveal-in-folder' | 'copy-path';

export interface WorkspaceOpenResult {
  action: WorkspaceOpenAction;
  path: string;
  workspacePath: string;
  dryRun: boolean;
}

export async function runWorkspaceOpenAction(input: {
  workspacePath: string;
  path: string;
  action: string;
  dryRun?: boolean;
}): Promise<WorkspaceOpenResult> {
  const workspacePath = normalizeWorkspaceRootPath(resolve(input.workspacePath));
  const targetPath = resolveWorkspaceOpenPath(workspacePath, input.path);
  const info = await stat(targetPath);
  const action = normalizeWorkspaceOpenAction(input.action);
  if (action === 'open-external') assertCanOpenExternal(targetPath, info.isDirectory());
  const dryRun = input.dryRun === true;
  if (!dryRun && action !== 'copy-path') {
    const args = action === 'reveal-in-folder'
      ? info.isDirectory() ? [targetPath] : ['-R', targetPath]
      : [targetPath];
    const child = spawn('open', args, { detached: true, stdio: 'ignore' });
    child.unref();
  }
  return {
    action,
    path: targetPath,
    workspacePath,
    dryRun,
  };
}

export function resolveWorkspaceOpenPath(workspacePath: string, rawPath: string) {
  const root = normalizeWorkspaceRootPath(resolve(workspacePath));
  if (!root) throw new Error('workspacePath is required');
  if (!rawPath.trim()) throw new Error('path is required');
  const stripped = rawPath.trim().replace(/^(file|folder):/i, '');
  const targetPath = isAbsolute(stripped) ? resolve(stripped) : resolve(root, stripped);
  const rel = relative(root, targetPath);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    if (!isAllowedGeneratedPreviewPath(targetPath)) {
      throw new Error('Workspace Open Gateway refused a path outside the active workspace.');
    }
  }
  return targetPath;
}

function normalizeWorkspaceOpenAction(action: string): WorkspaceOpenAction {
  if (action === 'open-external' || action === 'reveal-in-folder' || action === 'copy-path') return action;
  throw new Error(`Unsupported workspace open action: ${action}`);
}

function isAllowedGeneratedPreviewPath(targetPath: string) {
  if (!isBinaryPreviewFile(targetPath)) return false;
  const tempRoots = Array.from(new Set([
    resolve('/tmp'),
    resolve('/private/tmp'),
    resolve(tmpdir()),
    resolve('/var/folders'),
    resolve('/private/var/folders'),
  ]));
  return tempRoots.some((root) => {
    const rel = relative(root, targetPath);
    return rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
  });
}

function assertCanOpenExternal(targetPath: string, isDirectory: boolean) {
  if (isDirectory) return;
  const extension = extname(targetPath).toLowerCase();
  const blocked = new Set([
    '.app',
    '.bat',
    '.cmd',
    '.com',
    '.dmg',
    '.exe',
    '.pkg',
    '.ps1',
    '.scr',
    '.sh',
    '.bash',
    '.zsh',
    '.fish',
    '.command',
    '.scpt',
    '.workflow',
    '.docm',
    '.xlsm',
    '.pptm',
    '.jar',
  ]);
  if (blocked.has(extension)) {
    throw new Error(`Workspace Open Gateway blocked high-risk file type: ${extension}`);
  }
}
