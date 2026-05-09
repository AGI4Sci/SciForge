import {
  normalizeWorkspacePath,
  toWorkspaceRelativePath as supportToWorkspaceRelativePath,
  workspaceOnboardingErrorMessage,
  workspaceOnboardingReason as supportWorkspaceOnboardingReason,
  workspaceParentPath,
  workspacePathBasename,
  workspacePathNeedsOnboarding,
} from '@sciforge-ui/object-references';
import type { SciForgeConfig } from '../../domain';
import type { WorkspaceEntry } from '../../api/workspaceClient';

export type WorkspaceAction = 'create-file' | 'create-folder' | 'rename' | 'delete';

export function explorerWorkspaceRoot(config: SciForgeConfig): string {
  return normalizeWorkspacePath(config.workspacePath || '');
}

export function pathBasename(p: string): string {
  return workspacePathBasename(p);
}

export function parentPath(path: string) {
  return workspaceParentPath(path);
}

export function sortWorkspaceEntries(entries: WorkspaceEntry[]): WorkspaceEntry[] {
  return [...entries].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
}

export function syntheticFolderEntry(path: string): WorkspaceEntry {
  const clean = normalizeWorkspacePath(path) || path;
  return { kind: 'folder', path: clean, name: pathBasename(clean) || clean };
}

export function workspaceActionSuccessMessage(action: WorkspaceAction) {
  if (action === 'create-file') return '文件已创建。';
  if (action === 'create-folder') return '文件夹已创建。';
  if (action === 'rename') return '资源已重命名。';
  return '资源已删除。';
}

export function workspaceNeedsOnboarding(path: string, workspaceError: string, workspaceStatus: string) {
  return workspacePathNeedsOnboarding(path, workspaceError, workspaceStatus);
}

export function workspaceOnboardingReason(path: string, workspaceError: string, workspaceStatus: string) {
  return supportWorkspaceOnboardingReason(path, workspaceError, workspaceStatus);
}

export function workspaceOnboardingError(error: unknown) {
  return workspaceOnboardingErrorMessage(error);
}

export function toWorkspaceRelativePath(rootPath: string, path: string): string {
  return supportToWorkspaceRelativePath(rootPath, path);
}

export function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
