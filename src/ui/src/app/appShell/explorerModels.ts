import type { SciForgeConfig } from '../../domain';
import type { WorkspaceEntry } from '../../api/workspaceClient';

export type WorkspaceAction = 'create-file' | 'create-folder' | 'rename' | 'delete';

export function explorerWorkspaceRoot(config: SciForgeConfig): string {
  return (config.workspacePath || '').replace(/\/+$/, '');
}

export function pathBasename(p: string): string {
  const c = p.replace(/\/+$/, '');
  if (!c) return '';
  const i = c.lastIndexOf('/');
  return i >= 0 ? c.slice(i + 1) : c;
}

export function parentPath(path: string) {
  const clean = path.replace(/\/+$/, '');
  if (!clean || clean === '/') return clean || '/';
  const index = clean.lastIndexOf('/');
  return index <= 0 ? '/' : clean.slice(0, index);
}

export function sortWorkspaceEntries(entries: WorkspaceEntry[]): WorkspaceEntry[] {
  return [...entries].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
}

export function syntheticFolderEntry(path: string): WorkspaceEntry {
  const clean = path.replace(/\/+$/, '') || path;
  return { kind: 'folder', path: clean, name: pathBasename(clean) || clean };
}

export function workspaceActionSuccessMessage(action: WorkspaceAction) {
  if (action === 'create-file') return '文件已创建。';
  if (action === 'create-folder') return '文件夹已创建。';
  if (action === 'rename') return '资源已重命名。';
  return '资源已删除。';
}

export function workspaceNeedsOnboarding(path: string, workspaceError: string, workspaceStatus: string) {
  if (!path.trim()) return true;
  const combined = `${workspaceError} ${workspaceStatus}`;
  return /ENOENT|no such file|not found|未找到|不存在/i.test(combined);
}

export function workspaceOnboardingReason(path: string, workspaceError: string, workspaceStatus: string) {
  if (!path.trim()) return '当前还没有 workspace path；填写一个本机目录后可以创建 .sciforge 资源结构。';
  const combined = `${workspaceError} ${workspaceStatus}`;
  if (/EACCES|EPERM|permission|权限/i.test(combined)) {
    return '当前路径权限不足；请选择可写目录，或修复目录权限后再创建。';
  }
  if (/Workspace Writer 未连接|Failed to fetch|无法访问|connection/i.test(combined)) {
    return 'Workspace Writer 当前不可用；请启动 npm run workspace:server 后再创建。';
  }
  return `未找到 ${path}/.sciforge/workspace-state.json；可以创建标准 .sciforge 目录结构作为新工作区。`;
}

export function workspaceOnboardingError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/EACCES|EPERM|permission/i.test(message)) return `创建失败：权限不足。${message}`;
  if (/Workspace Writer 未连接|Failed to fetch|fetch/i.test(message)) return `创建失败：Workspace Writer 未连接。${message}`;
  return `创建失败：${message}`;
}

export function toWorkspaceRelativePath(rootPath: string, path: string): string {
  const root = rootPath.replace(/\/+$/, '');
  const current = path.replace(/\/+$/, '');
  if (root && current.startsWith(`${root}/`)) return current.slice(root.length + 1);
  if (root && current === root) return '.';
  return current;
}

export function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
