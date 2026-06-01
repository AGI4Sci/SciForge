import { useEffect, useState } from 'react';
import type { WorkspaceEntry } from '../../api/workspaceClient';
import { normalizeWorkspaceRootPath } from '../../config';
import type { SciForgeConfig } from '../../domain';
import {
  renderWorkspaceFileViewer,
  workspaceFileViewerBasename,
  workspaceFileViewerParentPath,
  type WorkspaceFileViewerEntry,
  type WorkspaceFileViewerOpenFileTab,
  type WorkspaceFileViewerProps,
  type WorkspaceFileViewerViewMode,
} from '../../../../../packages/presentation/components';
import {
  referenceForWorkspaceFileLike,
  referenceKindForWorkspaceFileLike,
  sciForgeReferenceAttribute,
} from '../../../../../packages/support/object-references';
import { boundedRightPaneText } from './previewSafety';
import { resultText, type ResultLocale } from './resultLocale';
import {
  WORKSPACE_FILE_INLINE_TEXT_LIMIT_BYTES,
  cancelWorkspaceFileEditorEdit,
  tooLargeWorkspaceFileFromEntry,
  workspaceCopyRefForPath,
  workspaceDisplayPathForPath,
  workspaceFileAncestors,
  workspaceFileEditorCanEditFile,
  workspaceFileEditorUnsupportedKind,
  workspaceFileEditorWithEditMode,
  workspaceFileViewerDraftForFile,
  workspaceFileWithInlinePolicy,
  type WorkspaceFileEditorState,
} from './filesPaneModel';
import {
  createWorkspaceFilesModulePort,
  unwrapWorkspaceFilesModuleResult,
  type WorkspaceFilesPort,
} from './filesPaneModulePort';

const defaultWorkspaceFilesPort = createWorkspaceFilesModulePort();

export function ResultPaneWorkspaceFileViewer({
  state,
  config,
  locale,
  onChange,
  onClose,
  filesPort = defaultWorkspaceFilesPort,
}: {
  state: WorkspaceFileEditorState;
  config: SciForgeConfig;
  locale?: ResultLocale;
  onChange: (next: WorkspaceFileEditorState) => void;
  onClose: () => void;
  filesPort?: WorkspaceFilesPort;
}) {
  const workspaceRoot = normalizeWorkspaceRootPath(state.workspacePath || config.workspacePath);
  const dirty = state.draft !== state.file.content;
  const [folderChildren, setFolderChildren] = useState<Record<string, WorkspaceFileViewerEntry[] | undefined>>({});
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set(workspaceRoot ? [workspaceRoot] : []));
  const [workspaceError, setWorkspaceError] = useState('');
  const [workspaceNotice, setWorkspaceNotice] = useState('');
  const [saveError, setSaveError] = useState('');
  const canEditFile = workspaceFileEditorCanEditFile(state.file);
  const fileReference = referenceForWorkspaceFileLike(state.file, referenceKindForWorkspaceFileLike(state.file));

  useEffect(() => {
    setFolderChildren({});
    setExpandedFolders(new Set(workspaceRoot ? [workspaceRoot] : []));
    setWorkspaceError('');
    setWorkspaceNotice('');
  }, [workspaceRoot]);

  useEffect(() => {
    if (!workspaceRoot) return undefined;
    let cancelled = false;
    void loadFolder(workspaceRoot, { cancelled: () => cancelled, quiet: true });
    return () => {
      cancelled = true;
    };
  }, [workspaceRoot, config.agentServerBaseUrl, config.workspaceWriterBaseUrl]);

  useEffect(() => {
    if (!workspaceRoot || !state.file.path) return;
    const ancestors = workspaceFileAncestors(workspaceRoot, state.file.path);
    if (!ancestors.length) return;
    setExpandedFolders((current) => new Set([...current, ...ancestors]));
    for (const ancestor of ancestors) {
      if (folderChildren[ancestor] === undefined) {
        void loadFolder(ancestor, { quiet: true });
      }
    }
  }, [workspaceRoot, state.file.path]);

  async function loadFolder(path: string, options: { cancelled?: () => boolean; quiet?: boolean } = {}) {
    if (!path.trim()) return;
    try {
      if (!options.quiet) setWorkspaceError('');
      const entries = unwrapWorkspaceFilesModuleResult(await filesPort.queryTree(path, config));
      if (options.cancelled?.()) return;
      setFolderChildren((previous) => ({ ...previous, [path]: entries.map(workspaceFileViewerEntryFromWorkspaceEntry) }));
      if (!options.quiet) {
        setWorkspaceNotice(entries.length
          ? resultText(locale, { 'zh-CN': `已加载 ${entries.length} 项`, 'en-US': `${entries.length} items loaded` })
          : resultText(locale, { 'zh-CN': '文件夹为空', 'en-US': 'Folder is empty' }));
      }
    } catch (error) {
      if (options.cancelled?.()) return;
      setWorkspaceError(error instanceof Error ? error.message : String(error));
      if (!options.quiet) setWorkspaceNotice('');
    }
  }

  function toggleFolder(path: string) {
    setExpandedFolders((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else {
        next.add(path);
        if (folderChildren[path] === undefined) void loadFolder(path, { quiet: true });
      }
      return next;
    });
  }

  async function refreshTree() {
    if (!workspaceRoot) return;
    try {
      setWorkspaceError('');
      const folders = Array.from(new Set([workspaceRoot, ...expandedFolders])).filter(Boolean);
      const loaded = await Promise.all(folders.map(async (folder) =>
        [folder, unwrapWorkspaceFilesModuleResult(await filesPort.queryTree(folder, config))] as const,
      ));
      setFolderChildren((previous) => ({
        ...previous,
        ...Object.fromEntries(loaded.map(([folder, entries]) => [folder, entries.map(workspaceFileViewerEntryFromWorkspaceEntry)])),
      }));
      setWorkspaceNotice(resultText(locale, { 'zh-CN': '目录已刷新', 'en-US': 'Tree refreshed' }));
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : String(error));
      setWorkspaceNotice('');
    }
  }

  function collapseTree() {
    setExpandedFolders(new Set(workspaceRoot ? [workspaceRoot] : []));
  }

  async function openFile(entry: WorkspaceFileViewerEntry) {
    if (entry.kind !== 'file') return;
    const tooLargeFile = tooLargeWorkspaceFileFromEntry(entry);
    if (tooLargeFile) {
      onChange({ ...state, file: tooLargeFile, draft: '', workspacePath: workspaceRoot, editMode: false });
      setWorkspaceError('');
      setSaveError('');
      setWorkspaceNotice(resultText(locale, { 'zh-CN': `已打开只读元数据：${entry.name}`, 'en-US': `Opened read-only metadata for ${entry.name}` }));
      return;
    }
    try {
      setWorkspaceError('');
      const file = workspaceFileWithInlinePolicy(unwrapWorkspaceFilesModuleResult(await filesPort.readFile(entry.path, config)));
      onChange({ ...state, file, draft: workspaceFileViewerDraftForFile(file), workspacePath: workspaceRoot, editMode: false });
      setWorkspaceNotice(resultText(locale, { 'zh-CN': `已打开 ${file.name}`, 'en-US': `Opened ${file.name}` }));
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : String(error));
      setWorkspaceNotice('');
    }
  }

  async function save() {
    if (!canEditFile) return;
    try {
      setSaveError('');
      const file = workspaceFileWithInlinePolicy(unwrapWorkspaceFilesModuleResult(await filesPort.invokeSave(state.file.path, state.draft, config)));
      onChange({ ...state, file, draft: workspaceFileViewerDraftForFile(file), workspacePath: workspaceRoot, editMode: false });
      setWorkspaceNotice(resultText(locale, { 'zh-CN': `已保存 ${file.name}`, 'en-US': `Saved ${file.name}` }));
      const parent = workspaceFileViewerParentPath(file.path) || workspaceRoot;
      if (parent) await loadFolder(parent, { quiet: true });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    }
  }
  return (
    <div
      className="result-workspace-file-viewer"
      aria-label={resultText(locale, { 'zh-CN': '工作区文件', 'en-US': 'Workspace file' })}
      data-sciforge-reference={sciForgeReferenceAttribute(fileReference)}
    >
      {renderWorkspaceFileViewer({
        slot: {
          componentId: 'workspace-file-viewer',
          title: workspaceFileViewerLabels(locale).title,
          props: {
            rootPath: workspaceRoot,
            rootLabel: workspaceFileViewerBasename(workspaceRoot),
            entriesByFolder: folderChildren,
            expandedFolderPaths: Array.from(expandedFolders),
            selectedPath: state.file.path,
            file: state.file,
            treePageSize: 200,
            inlineTextLimitBytes: WORKSPACE_FILE_INLINE_TEXT_LIMIT_BYTES,
            draft: state.draft,
            dirty: dirty && canEditFile,
            editMode: Boolean(state.editMode && canEditFile),
            openFileTabs: [{
              path: state.file.path,
              name: state.file.name,
              dirty: dirty && canEditFile,
              readOnly: Boolean(state.file.readOnly) || Boolean(workspaceFileEditorUnsupportedKind(state.file)),
              unsupportedKind: workspaceFileEditorUnsupportedKind(state.file),
            }],
            viewMode: state.viewMode ?? 'source',
            notice: workspaceNotice,
            error: boundedRightPaneText(workspaceError, 800),
            saveError: boundedRightPaneText(saveError, 800),
            labels: workspaceFileViewerLabels(locale),
            displayPathForPath: (path: string) => workspaceDisplayPathForPath(workspaceRoot, path),
            copyPathForPath: (path: string) => workspaceCopyRefForPath(workspaceRoot, path),
            onToggleFolder: toggleFolder,
            onOpenFile: (entry: WorkspaceFileViewerEntry) => void openFile(entry),
            onRefresh: () => void refreshTree(),
            onCollapseAll: collapseTree,
            onDraftChange: (draft: string) => {
              if (state.editMode && canEditFile) onChange({ ...state, draft });
            },
            onEditModeChange: (editMode: boolean) => onChange(workspaceFileEditorWithEditMode(state, editMode)),
            onViewModeChange: (viewMode: WorkspaceFileViewerViewMode) => onChange({ ...state, viewMode }),
            onSave: () => void save(),
            onCancel: () => onChange(cancelWorkspaceFileEditorEdit(state)),
            onClose,
            onCopyPath: (path: string) => void navigator.clipboard?.writeText(path),
            onCopyContents: (content: string) => void navigator.clipboard?.writeText(content),
          } satisfies Partial<WorkspaceFileViewerProps> as Record<string, unknown>,
        },
        artifact: {
          id: `workspace-file-view:${state.file.path}`,
          type: 'workspace-file-view',
          producerScenario: 'workspace-file-viewer',
          schemaVersion: 'sciforge.workspace-file-view.v1',
          data: {
            rootPath: workspaceRoot,
            selectedPath: state.file.path,
            file: state.file,
            dirty: dirty && canEditFile,
          },
        },
        config,
      })}
    </div>
  );
}

export function RightPaneFilesTool({
  config,
  locale,
  state,
  openFileTabs,
  onSelectOpenFile,
  onCloseOpenFile,
  onChange,
  onOpenFileEditor,
  onCloseFileView,
  filesPort = defaultWorkspaceFilesPort,
}: {
  config: SciForgeConfig;
  locale?: ResultLocale;
  state: WorkspaceFileEditorState | null;
  openFileTabs?: readonly WorkspaceFileViewerOpenFileTab[];
  onSelectOpenFile?: (path: string) => void;
  onCloseOpenFile?: (path: string) => void;
  onChange: (next: WorkspaceFileEditorState | null) => void;
  onOpenFileEditor?: (next: WorkspaceFileEditorState) => void;
  onCloseFileView?: () => void;
  filesPort?: WorkspaceFilesPort;
}) {
  const workspaceRoot = normalizeWorkspaceRootPath(state?.workspacePath || config.workspacePath);
  const [folderChildren, setFolderChildren] = useState<Record<string, WorkspaceFileViewerEntry[] | undefined>>({});
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set(workspaceRoot ? [workspaceRoot] : []));
  const [workspaceError, setWorkspaceError] = useState('');
  const [workspaceNotice, setWorkspaceNotice] = useState('');
  const [saveError, setSaveError] = useState('');
  const canEditFile = workspaceFileEditorCanEditFile(state?.file);
  const dirty = Boolean(state && canEditFile && state.draft !== state.file.content);

  useEffect(() => {
    setFolderChildren({});
    setExpandedFolders(new Set(workspaceRoot ? [workspaceRoot] : []));
    setWorkspaceError('');
    setWorkspaceNotice('');
  }, [workspaceRoot]);

  useEffect(() => {
    if (!workspaceRoot) return undefined;
    let cancelled = false;
    void loadFolder(workspaceRoot, { cancelled: () => cancelled, quiet: true });
    return () => {
      cancelled = true;
    };
  }, [workspaceRoot, config.agentServerBaseUrl, config.workspaceWriterBaseUrl]);

  async function loadFolder(path: string, options: { cancelled?: () => boolean; quiet?: boolean } = {}) {
    if (!path.trim()) return;
    try {
      if (!options.quiet) setWorkspaceError('');
      const entries = unwrapWorkspaceFilesModuleResult(await filesPort.queryTree(path, config));
      if (options.cancelled?.()) return;
      setFolderChildren((previous) => ({ ...previous, [path]: entries.map(workspaceFileViewerEntryFromWorkspaceEntry) }));
      if (!options.quiet) {
        setWorkspaceNotice(entries.length
          ? resultText(locale, { 'zh-CN': `已加载 ${entries.length} 项`, 'en-US': `${entries.length} items loaded` })
          : resultText(locale, { 'zh-CN': '文件夹为空', 'en-US': 'Folder is empty' }));
      }
    } catch (error) {
      if (options.cancelled?.()) return;
      setWorkspaceError(error instanceof Error ? error.message : String(error));
      if (!options.quiet) setWorkspaceNotice('');
    }
  }

  function toggleFolder(path: string) {
    setExpandedFolders((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else {
        next.add(path);
        if (folderChildren[path] === undefined) void loadFolder(path, { quiet: true });
      }
      return next;
    });
  }

  async function refreshTree() {
    if (!workspaceRoot) return;
    try {
      setWorkspaceError('');
      const folders = Array.from(new Set([workspaceRoot, ...expandedFolders])).filter(Boolean);
      const loaded = await Promise.all(folders.map(async (folder) =>
        [folder, unwrapWorkspaceFilesModuleResult(await filesPort.queryTree(folder, config))] as const,
      ));
      setFolderChildren((previous) => ({
        ...previous,
        ...Object.fromEntries(loaded.map(([folder, entries]) => [folder, entries.map(workspaceFileViewerEntryFromWorkspaceEntry)])),
      }));
      setWorkspaceNotice(resultText(locale, { 'zh-CN': '目录已刷新', 'en-US': 'Tree refreshed' }));
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : String(error));
      setWorkspaceNotice('');
    }
  }

  async function openFile(entry: WorkspaceFileViewerEntry) {
    if (entry.kind !== 'file') return;
    const tooLargeFile = tooLargeWorkspaceFileFromEntry(entry);
    if (tooLargeFile) {
      const nextEditor = { file: tooLargeFile, draft: '', workspacePath: workspaceRoot, editMode: false };
      if (onOpenFileEditor) onOpenFileEditor(nextEditor);
      else onChange(nextEditor);
      setWorkspaceError('');
      setSaveError('');
      setWorkspaceNotice(resultText(locale, { 'zh-CN': `已打开只读元数据：${entry.name}`, 'en-US': `Opened read-only metadata for ${entry.name}` }));
      return;
    }
    try {
      setWorkspaceError('');
      const file = workspaceFileWithInlinePolicy(unwrapWorkspaceFilesModuleResult(await filesPort.readFile(entry.path, config)));
      const nextEditor = { file, draft: workspaceFileViewerDraftForFile(file), workspacePath: workspaceRoot, editMode: false };
      if (onOpenFileEditor) onOpenFileEditor(nextEditor);
      else onChange(nextEditor);
      setWorkspaceNotice(resultText(locale, { 'zh-CN': `已打开 ${file.name}`, 'en-US': `Opened ${file.name}` }));
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : String(error));
      setWorkspaceNotice('');
    }
  }

  async function saveFile() {
    if (!state || !canEditFile) return;
    try {
      setSaveError('');
      const file = workspaceFileWithInlinePolicy(unwrapWorkspaceFilesModuleResult(await filesPort.invokeSave(state.file.path, state.draft, config)));
      onChange({ ...state, file, draft: workspaceFileViewerDraftForFile(file), workspacePath: workspaceRoot, editMode: false });
      setWorkspaceNotice(resultText(locale, { 'zh-CN': `已保存 ${file.name}`, 'en-US': `Saved ${file.name}` }));
      const parent = workspaceFileViewerParentPath(file.path) || workspaceRoot;
      if (parent) await loadFolder(parent, { quiet: true });
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div className="right-pane-package-surface right-pane-files-surface" data-testid="right-pane-files-tool">
      {renderWorkspaceFileViewer({
        slot: {
          componentId: 'workspace-file-viewer',
          title: workspaceFileViewerLabels(locale).title,
          props: {
            rootPath: workspaceRoot,
            rootLabel: workspaceFileViewerBasename(workspaceRoot),
            entriesByFolder: folderChildren,
            expandedFolderPaths: Array.from(expandedFolders),
            selectedPath: state?.file.path,
            file: state?.file ?? null,
            treePageSize: 200,
            inlineTextLimitBytes: WORKSPACE_FILE_INLINE_TEXT_LIMIT_BYTES,
            draft: state?.draft ?? '',
            dirty,
            editMode: Boolean(state?.editMode && canEditFile),
            openFileTabs,
            viewMode: state?.viewMode ?? 'source',
            notice: workspaceNotice,
            error: boundedRightPaneText(workspaceError, 800),
            saveError: boundedRightPaneText(saveError, 800),
            labels: workspaceFileViewerLabels(locale),
            displayPathForPath: (path: string) => workspaceDisplayPathForPath(workspaceRoot, path),
            copyPathForPath: (path: string) => workspaceCopyRefForPath(workspaceRoot, path),
            onToggleFolder: toggleFolder,
            onOpenFile: (entry: WorkspaceFileViewerEntry) => void openFile(entry),
            onRefresh: () => void refreshTree(),
            onCollapseAll: () => setExpandedFolders(new Set(workspaceRoot ? [workspaceRoot] : [])),
            onDraftChange: (draft: string) => {
              if (state?.editMode && canEditFile) onChange({ ...state, draft });
            },
            onEditModeChange: (editMode: boolean) => {
              if (state) onChange(workspaceFileEditorWithEditMode(state, editMode));
            },
            onSelectOpenFile,
            onCloseOpenFile,
            onViewModeChange: (viewMode: WorkspaceFileViewerViewMode) => {
              if (state) onChange({ ...state, viewMode });
            },
            onSave: () => void saveFile(),
            onCancel: () => {
              if (state) onChange(cancelWorkspaceFileEditorEdit(state));
            },
            onClose: () => {
              if (onCloseFileView) onCloseFileView();
              else onChange(null);
            },
            onCopyPath: (path: string) => {
              if (typeof navigator !== 'undefined') void navigator.clipboard?.writeText(path);
            },
            onCopyContents: (content: string) => {
              if (typeof navigator !== 'undefined') void navigator.clipboard?.writeText(content);
            },
          } satisfies Partial<WorkspaceFileViewerProps> as Record<string, unknown>,
        },
        artifact: {
          id: 'right-pane-workspace-file-view',
          type: 'workspace-file-view',
          producerScenario: 'workspace-file-viewer',
          schemaVersion: 'sciforge.workspace-file-view.v1',
          data: {
            rootPath: workspaceRoot,
            selectedPath: state?.file.path,
            file: state?.file ?? null,
            dirty,
          },
        },
        config,
      })}
    </div>
  );
}

export function workspaceFileViewerEntryFromWorkspaceEntry(entry: WorkspaceEntry): WorkspaceFileViewerEntry {
  return {
    kind: entry.kind,
    name: entry.name,
    path: entry.path,
    size: entry.size,
    modifiedAt: entry.modifiedAt,
  };
}

export function workspaceFileViewerLabels(locale?: ResultLocale) {
  return {
    title: resultText(locale, { 'zh-CN': '工作区文件', 'en-US': 'Workspace files' }),
    treeLabel: resultText(locale, { 'zh-CN': '工作区文件树', 'en-US': 'Workspace file tree' }),
    editorLabel: resultText(locale, { 'zh-CN': '工作区文件编辑器', 'en-US': 'Workspace file editor' }),
    readOnly: resultText(locale, { 'zh-CN': '只读', 'en-US': 'Read only' }),
    editing: resultText(locale, { 'zh-CN': '编辑中', 'en-US': 'Editing' }),
    edit: resultText(locale, { 'zh-CN': '编辑', 'en-US': 'Edit' }),
    loading: resultText(locale, { 'zh-CN': '加载中...', 'en-US': 'Loading...' }),
    emptyTree: resultText(locale, { 'zh-CN': '没有可显示的文件。', 'en-US': 'No files to show.' }),
    emptyEditor: resultText(locale, { 'zh-CN': '选择一个文件查看内容。', 'en-US': 'Select a file to inspect it.' }),
    refresh: resultText(locale, { 'zh-CN': '刷新目录', 'en-US': 'Refresh tree' }),
    collapseAll: resultText(locale, { 'zh-CN': '折叠目录', 'en-US': 'Collapse tree' }),
    searchPlaceholder: resultText(locale, { 'zh-CN': '搜索文件', 'en-US': 'Search files' }),
    noSearchResults: resultText(locale, { 'zh-CN': '没有匹配的文件', 'en-US': 'No matching files' }),
    copyPath: resultText(locale, { 'zh-CN': '复制路径', 'en-US': 'Copy path' }),
    copyContents: resultText(locale, { 'zh-CN': '复制内容', 'en-US': 'Copy contents' }),
    save: resultText(locale, { 'zh-CN': '保存文件', 'en-US': 'Save file' }),
    cancel: resultText(locale, { 'zh-CN': '取消', 'en-US': 'Cancel' }),
    close: resultText(locale, { 'zh-CN': '关闭文件视图', 'en-US': 'Close file view' }),
    saved: resultText(locale, { 'zh-CN': '已保存', 'en-US': 'Saved' }),
    unsaved: resultText(locale, { 'zh-CN': '未保存', 'en-US': 'Unsaved' }),
    unsupported: resultText(locale, { 'zh-CN': '不支持预览', 'en-US': 'Unsupported file' }),
    binaryUnsupported: resultText(locale, { 'zh-CN': '二进制文件在此视图中只读。', 'en-US': 'Binary files are read-only in this viewer.' }),
    tooLargeUnsupported: resultText(locale, { 'zh-CN': '文件过大，已切换为只读元数据视图。', 'en-US': 'This file is too large for inline editing.' }),
    readOnlyReason: resultText(locale, { 'zh-CN': '该文件为只读。', 'en-US': 'This file is read-only.' }),
    pathBreadcrumb: resultText(locale, { 'zh-CN': '文件路径', 'en-US': 'File path' }),
  };
}
