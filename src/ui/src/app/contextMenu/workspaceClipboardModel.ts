import type { WorkspaceEntry } from '../../api/workspaceClient';

export interface WorkspaceClipboardEntry {
  path: string;
  name: string;
  kind: WorkspaceEntry['kind'];
}

export interface WorkspaceClipboardState {
  mode: 'cut' | 'copy';
  entries: WorkspaceClipboardEntry[];
}

export function workspaceClipboardEntryFromWorkspaceEntry(entry: WorkspaceEntry): WorkspaceClipboardEntry {
  return { path: entry.path, name: entry.name, kind: entry.kind };
}

export function workspacePasteTargetPath(
  context: { entry?: WorkspaceEntry; workspaceRoot: string },
): string | undefined {
  if (context.entry?.kind === 'folder') return context.entry.path;
  if (context.entry?.kind === 'file') {
    const parent = context.entry.path.slice(0, -context.entry.name.length).replace(/\/+$/, '');
    return parent || context.workspaceRoot;
  }
  return context.workspaceRoot || undefined;
}
