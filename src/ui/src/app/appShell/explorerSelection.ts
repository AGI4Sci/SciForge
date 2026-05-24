import type { WorkspaceEntry } from '../../api/workspaceClient';
import { pathBasename } from './explorerModels';

export interface ExplorerSelectedEntry {
  path: string;
  kind: WorkspaceEntry['kind'];
  name: string;
}

export function explorerSelectedEntryFromWorkspaceEntry(entry: WorkspaceEntry): ExplorerSelectedEntry {
  return { path: entry.path, kind: entry.kind, name: entry.name };
}

export function explorerSelectedEntryFromFolderPath(path: string): ExplorerSelectedEntry {
  return { path, kind: 'folder', name: pathBasename(path) || path };
}

export function collectVisibleExplorerEntries(
  workspaceRoot: string,
  folderChildren: Record<string, WorkspaceEntry[]>,
  expandedFolders: Set<string>,
): ExplorerSelectedEntry[] {
  const result: ExplorerSelectedEntry[] = [];
  if (!workspaceRoot) return result;

  result.push(explorerSelectedEntryFromFolderPath(workspaceRoot));
  if (expandedFolders.has(workspaceRoot)) {
    appendVisibleChildren(workspaceRoot);
  }
  return result;

  function appendVisibleChildren(dirPath: string) {
    const entries = folderChildren[dirPath];
    if (!entries) return;
    for (const entry of entries) {
      result.push(explorerSelectedEntryFromWorkspaceEntry(entry));
      if (entry.kind === 'folder' && expandedFolders.has(entry.path)) {
        appendVisibleChildren(entry.path);
      }
    }
  }
}

export function applyExplorerEntryClickSelection(options: {
  entry: ExplorerSelectedEntry;
  visibleEntries: ExplorerSelectedEntry[];
  currentSelection: ExplorerSelectedEntry[];
  anchorPath: string | null;
  metaKey: boolean;
  shiftKey: boolean;
}): { selection: ExplorerSelectedEntry[]; anchorPath: string } {
  const { entry, visibleEntries, currentSelection, anchorPath, metaKey, shiftKey } = options;

  if (shiftKey) {
    const anchor = anchorPath ?? currentSelection[0]?.path ?? entry.path;
    const anchorIdx = visibleEntries.findIndex((item) => item.path === anchor);
    const clickIdx = visibleEntries.findIndex((item) => item.path === entry.path);
    if (anchorIdx >= 0 && clickIdx >= 0) {
      const [start, end] = anchorIdx < clickIdx ? [anchorIdx, clickIdx] : [clickIdx, anchorIdx];
      return { selection: visibleEntries.slice(start, end + 1), anchorPath: anchor };
    }
  }

  if (metaKey) {
    const exists = currentSelection.some((item) => item.path === entry.path);
    const selection = exists
      ? currentSelection.filter((item) => item.path !== entry.path)
      : [...currentSelection, entry];
    return { selection, anchorPath: entry.path };
  }

  return { selection: [entry], anchorPath: entry.path };
}

export function resolveExplorerContextMenuSelection(
  entry: ExplorerSelectedEntry,
  currentSelection: ExplorerSelectedEntry[],
): ExplorerSelectedEntry[] {
  if (currentSelection.some((item) => item.path === entry.path)) return currentSelection;
  return [entry];
}

export function explorerSelectionIncludesPath(selection: ExplorerSelectedEntry[], path: string) {
  return selection.some((item) => item.path === path);
}
