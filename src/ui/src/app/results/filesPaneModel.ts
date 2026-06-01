import type { ObjectReference } from '../../domain';
import type { WorkspaceFileContent } from '../../api/workspaceClient';
import {
  type WorkspaceFileViewerEntry,
  type WorkspaceFileViewerFile,
  type WorkspaceFileViewerOpenFileTab,
  type WorkspaceFileViewerViewMode,
  workspaceFileViewerBasename,
  workspaceFileViewerParentPath,
} from '../../../../../packages/presentation/components';
import {
  toWorkspaceRelativePath,
} from '../../../../../packages/support/object-references';
import type { ResultPaneTabInstance } from './ResultShell';

export type WorkspaceFileEditorState = {
  file: WorkspaceFileContent & WorkspaceFileViewerFile;
  draft: string;
  workspacePath?: string;
  focusRequestKey?: string;
  editMode?: boolean;
  viewMode?: WorkspaceFileViewerViewMode;
};

export type WorkspaceFileEditorsByTabId = Record<string, WorkspaceFileEditorState | undefined>;

export const WORKSPACE_FILE_INLINE_TEXT_LIMIT_BYTES = 1024 * 1024;

export function setWorkspaceFileEditorForTab(
  current: WorkspaceFileEditorsByTabId,
  tabId: string,
  next: WorkspaceFileEditorState | null,
): WorkspaceFileEditorsByTabId {
  if (!tabId) return current;
  const updated = { ...current };
  if (next) updated[tabId] = next;
  else delete updated[tabId];
  return updated;
}

export function removeWorkspaceFileEditorForTab(current: WorkspaceFileEditorsByTabId, tabId: string): WorkspaceFileEditorsByTabId {
  if (!tabId || !(tabId in current)) return current;
  const updated = { ...current };
  delete updated[tabId];
  return updated;
}

export function cancelWorkspaceFileEditorEdit(state: WorkspaceFileEditorState): WorkspaceFileEditorState {
  return { ...state, draft: state.file.content, editMode: false };
}

function workspaceFileEditorMimeLooksText(mimeType: string | undefined) {
  if (!mimeType) return true;
  const normalized = mimeType.toLowerCase();
  return normalized.startsWith('text/')
    || /(?:json|xml|yaml|toml|csv|markdown|javascript|typescript|x-sh|x-python|x-ruby|x-php|x-java|x-c|x-c\+\+)/.test(normalized);
}

export function workspaceFileEditorUnsupportedKind(file: WorkspaceFileEditorState['file'] | null | undefined): WorkspaceFileViewerFile['unsupportedKind'] | undefined {
  if (!file) return undefined;
  if (file.unsupportedKind) return file.unsupportedKind;
  if (file.encoding === 'base64') return 'binary';
  if (!workspaceFileEditorMimeLooksText(file.mimeType)) return 'binary';
  if (typeof file.size === 'number' && file.size > WORKSPACE_FILE_INLINE_TEXT_LIMIT_BYTES) return 'too-large';
  if (file.contentUnavailable) return 'unsupported';
  return undefined;
}

export function workspaceFileEditorCanEditFile(file: WorkspaceFileEditorState['file'] | null | undefined) {
  return Boolean(file && !file.readOnly && !workspaceFileEditorUnsupportedKind(file));
}

export function workspaceFileEditorIsDirty(editor: WorkspaceFileEditorState | null | undefined) {
  return Boolean(editor && workspaceFileEditorCanEditFile(editor.file) && editor.draft !== editor.file.content);
}

export function workspaceFileWithInlinePolicy(file: WorkspaceFileContent & WorkspaceFileViewerFile): WorkspaceFileEditorState['file'] {
  const unsupportedKind = workspaceFileEditorUnsupportedKind(file);
  if (!unsupportedKind) return file;
  return {
    ...file,
    content: '',
    readOnly: true,
    contentUnavailable: true,
    unsupportedKind,
  };
}

export function workspaceFileEditorWithEditMode(state: WorkspaceFileEditorState, editMode: boolean): WorkspaceFileEditorState {
  return { ...state, editMode: editMode && workspaceFileEditorCanEditFile(state.file) };
}

export function workspaceFileViewerDraftForFile(file: WorkspaceFileEditorState['file']) {
  return workspaceFileEditorCanEditFile(file) ? file.content : '';
}

export function workspaceFileOpenTabsForRightPaneTabs(
  tabs: readonly ResultPaneTabInstance[],
  editorsByTabId: WorkspaceFileEditorsByTabId,
): WorkspaceFileViewerOpenFileTab[] {
  return tabs.flatMap((tab) => {
    if (tab.kind !== 'files') return [];
    const editor = editorsByTabId[tab.id];
    if (!editor?.file.path) return [];
    const unsupportedKind = workspaceFileEditorUnsupportedKind(editor.file);
    return [{
      path: editor.file.path,
      name: editor.file.name || workspaceFileViewerBasename(editor.file.path),
      dirty: workspaceFileEditorCanEditFile(editor.file) && editor.draft !== editor.file.content,
      readOnly: Boolean(editor.file.readOnly) || Boolean(unsupportedKind),
      unsupportedKind,
    }];
  });
}

export type WorkspaceFileTabOpenPlan =
  | { action: 'focus-existing'; tabId: string }
  | { action: 'reuse-active'; tabId: string }
  | { action: 'open-new' };

export function planWorkspaceFileTabOpen({
  tabs,
  editorsByTabId,
  activeTabId,
  workspaceRoot,
  nextEditor,
}: {
  tabs: readonly ResultPaneTabInstance[];
  editorsByTabId: WorkspaceFileEditorsByTabId;
  activeTabId: string;
  workspaceRoot: string;
  nextEditor: WorkspaceFileEditorState;
}): WorkspaceFileTabOpenPlan {
  const existingTab = tabs.find((tab) => (
    tab.kind === 'files'
    && workspaceFileEditorMatchesPath(editorsByTabId[tab.id]?.file.path, nextEditor.file.path, workspaceRoot)
  ));
  if (existingTab) return { action: 'focus-existing', tabId: existingTab.id };

  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const activeEditor = editorsByTabId[activeTabId];
  if (activeTab?.kind === 'files' && !workspaceFileEditorIsDirty(activeEditor)) {
    return { action: 'reuse-active', tabId: activeTab.id };
  }

  const emptyCleanTab = tabs.find((tab) => tab.kind === 'files' && !editorsByTabId[tab.id]);
  if (emptyCleanTab) return { action: 'reuse-active', tabId: emptyCleanTab.id };

  return { action: 'open-new' };
}

export function workspaceDisplayPathForPath(workspaceRoot: string, path: string) {
  const relative = toWorkspaceRelativePath(workspaceRoot, path);
  if (relative === '.') return workspaceFileViewerBasename(workspaceRoot) || '.';
  return relative || workspaceFileViewerBasename(path) || path;
}

export function workspaceCopyRefForPath(workspaceRoot: string, path: string) {
  const relative = toWorkspaceRelativePath(workspaceRoot, path);
  return relative === '.' ? 'workspace:.' : `file:${relative}`;
}

export function tooLargeWorkspaceFileFromEntry(entry: WorkspaceFileViewerEntry): WorkspaceFileEditorState['file'] | undefined {
  if (typeof entry.size !== 'number' || entry.size <= WORKSPACE_FILE_INLINE_TEXT_LIMIT_BYTES) return undefined;
  return {
    path: entry.path,
    name: entry.name,
    content: '',
    size: entry.size,
    modifiedAt: entry.modifiedAt,
    language: 'unsupported',
    encoding: 'utf8',
    readOnly: true,
    contentUnavailable: true,
    unsupportedKind: 'too-large',
  };
}

export function workspaceFileAncestors(workspaceRoot: string, filePath: string) {
  const root = normalizeWorkspaceViewerPath(workspaceRoot);
  let current = normalizeWorkspaceViewerPath(workspaceFileViewerParentPath(filePath));
  const ancestors: string[] = [];
  while (current && (current === root || current.startsWith(`${root}/`))) {
    ancestors.unshift(current);
    if (current === root) break;
    current = normalizeWorkspaceViewerPath(workspaceFileViewerParentPath(current));
  }
  return ancestors;
}

export function normalizeWorkspaceViewerPath(path: string | undefined) {
  return (path ?? '').replace(/\\/g, '/').replace(/\/+$/, '');
}

export function workspaceFileEditorMatchesPath(editorPath: string | undefined, requestedPath: string, workspaceRoot: string) {
  const editor = normalizeWorkspaceViewerPath(editorPath);
  const requested = normalizeWorkspaceViewerPath(requestedPath);
  const root = normalizeWorkspaceViewerPath(workspaceRoot);
  if (!editor || !requested) return false;
  if (editor === requested) return true;
  return Boolean(root && editor === `${root}/${requested.replace(/^\/+/, '')}`);
}

export function workspaceFileFocusRequestKey(reference: ObjectReference | undefined, path: string) {
  if (!reference || !path.trim()) return '';
  return [
    reference.kind,
    reference.id,
    reference.runId ?? '',
    reference.ref,
    reference.provenance?.path ?? '',
    path.trim(),
  ].join('|');
}

export function shouldTryRepoRootWorkspaceFallback(reference: ObjectReference | undefined, path: string) {
  return reference?.kind === 'file' && isSafeRepoRelativeFilePath(path);
}

function isSafeRepoRelativeFilePath(path: string) {
  const normalized = path.trim().replace(/\\/g, '/').replace(/^file::?/i, '');
  if (!normalized || normalized.startsWith('/')) return false;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(normalized)) return false;
  return normalized.split('/').every((segment) => segment && segment !== '.' && segment !== '..' && !segment.startsWith('.'));
}
