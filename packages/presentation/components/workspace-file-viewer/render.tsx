import React, { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

export interface WorkspaceFileViewerEntry {
  name: string;
  path: string;
  kind: 'file' | 'folder';
  size?: number;
  modifiedAt?: string;
}

export interface WorkspaceFileViewerFolderContinuation {
  offset?: number;
  limit?: number;
  total?: number;
  hasMore?: boolean;
  state?: 'available' | 'loading' | 'error';
  message?: string;
  commandLabel?: string;
}

export interface WorkspaceFileViewerFolderContinuationRequest {
  folderPath: string;
  offset: number;
  limit: number;
}

export interface WorkspaceFileViewerFileSegment {
  offset?: number;
  length?: number;
  total?: number;
  hasMore?: boolean;
  label?: string;
}

export interface WorkspaceFileViewerFile {
  path: string;
  name: string;
  content: string;
  size: number;
  modifiedAt?: string;
  language?: string;
  encoding?: 'utf8' | 'base64';
  mimeType?: string;
  readOnly?: boolean;
  readOnlyReason?: string;
  contentUnavailable?: boolean;
  unsupportedKind?: 'binary' | 'too-large' | 'unsupported';
  unsupportedReason?: string;
  previewContent?: string;
  previewSegment?: WorkspaceFileViewerFileSegment;
}

export interface WorkspaceFileViewerLabels {
  title: string;
  treeLabel: string;
  editorLabel: string;
  readOnly: string;
  editing: string;
  edit: string;
  loading: string;
  emptyTree: string;
  emptyEditor: string;
  refresh: string;
  collapseAll: string;
  searchPlaceholder: string;
  noSearchResults: string;
  copyPath: string;
  copyContents: string;
  save: string;
  cancel: string;
  close: string;
  saved: string;
  unsaved: string;
  unsupported: string;
  binaryUnsupported: string;
  tooLargeUnsupported: string;
  readOnlyReason: string;
  loadMore: string;
  showingItems: string;
  largeFileState: string;
  binaryFileState: string;
  fileSize: string;
  inlineLimit: string;
  previewSegment: string;
}

export interface WorkspaceFileViewerProps {
  rootPath: string;
  rootLabel?: string;
  entriesByFolder: Record<string, WorkspaceFileViewerEntry[] | undefined>;
  expandedFolderPaths: readonly string[];
  selectedPath?: string;
  file?: WorkspaceFileViewerFile | null;
  treePageSize?: number;
  searchResultLimit?: number;
  inlineTextLimitBytes?: number;
  folderContinuations?: Record<string, WorkspaceFileViewerFolderContinuation | undefined>;
  draft?: string;
  dirty?: boolean;
  editMode?: boolean;
  notice?: string;
  error?: string;
  saveError?: string;
  disabled?: boolean;
  labels?: Partial<WorkspaceFileViewerLabels>;
  renderFileIcon?: (entry: WorkspaceFileViewerEntry) => ReactNode;
  displayPathForPath?: (path: string) => string;
  copyPathForPath?: (path: string) => string;
  onToggleFolder?: (path: string) => void;
  onOpenFile?: (entry: WorkspaceFileViewerEntry) => void;
  onRefresh?: () => void;
  onCollapseAll?: () => void;
  onDraftChange?: (draft: string) => void;
  onEditModeChange?: (editMode: boolean) => void;
  onSave?: () => void;
  onCancel?: () => void;
  onClose?: () => void;
  onCopyPath?: (path: string) => void;
  onCopyContents?: (content: string) => void;
  onLoadMoreFolder?: (request: WorkspaceFileViewerFolderContinuationRequest) => void;
}

export const WORKSPACE_FILE_VIEWER_DEFAULT_TREE_PAGE_SIZE = 200;
export const WORKSPACE_FILE_VIEWER_DEFAULT_INLINE_TEXT_LIMIT_BYTES = 1024 * 1024;

const defaultLabels: WorkspaceFileViewerLabels = {
  title: 'Workspace files',
  treeLabel: 'Workspace file tree',
  editorLabel: 'Workspace file editor',
  readOnly: 'Read only',
  editing: 'Editing',
  edit: 'Edit',
  loading: 'Loading...',
  emptyTree: 'No files to show.',
  emptyEditor: 'Select a file to inspect it.',
  refresh: 'Refresh',
  collapseAll: 'Collapse all',
  searchPlaceholder: 'Search files',
  noSearchResults: 'No matching files',
  copyPath: 'Copy path',
  copyContents: 'Copy contents',
  save: 'Save file',
  cancel: 'Cancel',
  close: 'Close file view',
  saved: 'Saved',
  unsaved: 'Unsaved',
  unsupported: 'Unsupported file',
  binaryUnsupported: 'Binary files are read-only in this viewer.',
  tooLargeUnsupported: 'This file is too large for inline editing.',
  readOnlyReason: 'This file is read-only.',
  loadMore: 'Load more',
  showingItems: 'Showing',
  largeFileState: 'Large file',
  binaryFileState: 'Binary file',
  fileSize: 'Size',
  inlineLimit: 'Inline limit',
  previewSegment: 'Preview segment',
};

export function sortWorkspaceFileViewerEntries(entries: readonly WorkspaceFileViewerEntry[]) {
  return [...entries].sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === 'folder' ? -1 : 1;
    return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
  });
}

export function workspaceFileViewerBasename(path: string) {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? normalized;
}

export function workspaceFileViewerParentPath(path: string) {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
  const index = normalized.lastIndexOf('/');
  if (index <= 0) return '';
  return normalized.slice(0, index);
}

function workspaceFileViewerRelativeParent(rootPath: string, path: string) {
  const root = normalizeComparablePath(rootPath);
  const parent = normalizeComparablePath(workspaceFileViewerParentPath(path));
  if (!parent || parent === root) return '';
  return root && parent.startsWith(`${root}/`) ? parent.slice(root.length + 1) : parent;
}

function normalizeComparablePath(path: string | undefined) {
  return (path ?? '').replace(/\\/g, '/').replace(/\/+$/, '');
}

function positiveInteger(value: number | undefined, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

function formatBytes(value: number | undefined) {
  if (value === undefined) return '';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function entryGlyph(entry: WorkspaceFileViewerEntry) {
  if (entry.kind === 'folder') return 'dir';
  const ext = entry.name.split('.').pop()?.toLowerCase();
  if (ext === 'ts' || ext === 'tsx' || ext === 'js' || ext === 'jsx') return 'TS';
  if (ext === 'md' || ext === 'markdown') return 'MD';
  if (ext === 'json') return 'JSON';
  if (ext === 'css') return 'CSS';
  return 'file';
}

function workspaceFileViewerMimeLooksText(mimeType: string | undefined) {
  if (!mimeType) return true;
  const normalized = mimeType.toLowerCase();
  return normalized.startsWith('text/')
    || /(?:json|xml|yaml|toml|csv|markdown|javascript|typescript|x-sh|x-python|x-ruby|x-php|x-java|x-c|x-c\+\+)/.test(normalized);
}

export function workspaceFileViewerUnsupportedKind(
  file: WorkspaceFileViewerFile | null | undefined,
  inlineTextLimitBytes = WORKSPACE_FILE_VIEWER_DEFAULT_INLINE_TEXT_LIMIT_BYTES,
): WorkspaceFileViewerFile['unsupportedKind'] | undefined {
  if (!file) return undefined;
  if (file.unsupportedKind) return file.unsupportedKind;
  if (file.encoding === 'base64') return 'binary';
  if (!workspaceFileViewerMimeLooksText(file.mimeType)) return 'binary';
  if (typeof file.size === 'number' && file.size > positiveInteger(inlineTextLimitBytes, WORKSPACE_FILE_VIEWER_DEFAULT_INLINE_TEXT_LIMIT_BYTES)) return 'too-large';
  if (file.contentUnavailable) return 'unsupported';
  return undefined;
}

export function workspaceFileViewerCanEditFile(
  file: WorkspaceFileViewerFile | null | undefined,
  inlineTextLimitBytes = WORKSPACE_FILE_VIEWER_DEFAULT_INLINE_TEXT_LIMIT_BYTES,
) {
  return Boolean(file && !file.readOnly && !workspaceFileViewerUnsupportedKind(file, inlineTextLimitBytes));
}

function workspaceFileViewerUnsupportedMessage(
  file: WorkspaceFileViewerFile,
  labels: WorkspaceFileViewerLabels,
  inlineTextLimitBytes: number,
) {
  if (file.unsupportedReason) return file.unsupportedReason;
  const kind = workspaceFileViewerUnsupportedKind(file, inlineTextLimitBytes);
  if (kind === 'binary') return labels.binaryUnsupported;
  if (kind === 'too-large') return labels.tooLargeUnsupported;
  return labels.unsupported;
}

export function WorkspaceFileViewer(props: WorkspaceFileViewerProps) {
  const labels = { ...defaultLabels, ...props.labels };
  const [searchQuery, setSearchQuery] = useState('');
  const [uncontrolledEditMode, setUncontrolledEditMode] = useState(false);
  const [localVisibleLimits, setLocalVisibleLimits] = useState<Record<string, number>>({});
  const treePageSize = positiveInteger(props.treePageSize, WORKSPACE_FILE_VIEWER_DEFAULT_TREE_PAGE_SIZE);
  const searchResultLimit = positiveInteger(props.searchResultLimit, treePageSize);
  const inlineTextLimitBytes = positiveInteger(props.inlineTextLimitBytes, WORKSPACE_FILE_VIEWER_DEFAULT_INLINE_TEXT_LIMIT_BYTES);
  const [searchVisibleLimit, setSearchVisibleLimit] = useState(searchResultLimit);
  const canEditFile = workspaceFileViewerCanEditFile(props.file, inlineTextLimitBytes);
  const editMode = Boolean((props.editMode ?? uncontrolledEditMode) && canEditFile);
  const unsupportedKind = workspaceFileViewerUnsupportedKind(props.file, inlineTextLimitBytes);
  const largeFilePreviewContent = unsupportedKind === 'too-large' && typeof props.file?.previewContent === 'string'
    ? props.file.previewContent
    : undefined;
  const expanded = new Set(props.expandedFolderPaths.map(normalizeComparablePath));
  const selectedPath = normalizeComparablePath(props.selectedPath ?? props.file?.path);
  const rootPath = normalizeComparablePath(props.rootPath);
  const rootExpanded = expanded.has(rootPath);
  const rootEntries = props.entriesByFolder[props.rootPath];
  const currentFile = props.file ?? null;
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const displayPathForPath = (path: string) => props.displayPathForPath?.(path) ?? path;
  const copyPathForPath = (path: string) => props.copyPathForPath?.(path) ?? path;
  const searchEntries = useMemo(() => {
    if (!normalizedSearchQuery) return [];
    const byPath = new Map<string, WorkspaceFileViewerEntry>();
    for (const entries of Object.values(props.entriesByFolder)) {
      for (const entry of entries ?? []) {
        const path = normalizeComparablePath(entry.path);
        if (!path || byPath.has(path)) continue;
        const haystack = `${entry.name}\n${path}`.toLowerCase();
        if (haystack.includes(normalizedSearchQuery)) byPath.set(path, entry);
      }
    }
    return sortWorkspaceFileViewerEntries([...byPath.values()]);
  }, [normalizedSearchQuery, props.entriesByFolder]);

  useEffect(() => {
    if (props.editMode === undefined) setUncontrolledEditMode(false);
  }, [props.editMode, props.file?.path]);

  useEffect(() => {
    setLocalVisibleLimits({});
  }, [props.rootPath, treePageSize]);

  useEffect(() => {
    setSearchVisibleLimit(searchResultLimit);
  }, [normalizedSearchQuery, searchResultLimit]);

  function folderContinuationFor(folderPath: string) {
    return props.folderContinuations?.[folderPath] ?? props.folderContinuations?.[normalizeComparablePath(folderPath)];
  }

  function visibleLimitForFolder(folderPath: string) {
    const normalized = normalizeComparablePath(folderPath);
    const continuation = folderContinuationFor(folderPath);
    return Math.max(
      treePageSize,
      localVisibleLimits[normalized] ?? 0,
      positiveInteger(continuation?.offset, 0),
    );
  }

  function renderContinuation(
    folderPath: string,
    depth: number,
    entryCount: number,
    visibleCount: number,
  ): ReactNode {
    const continuation = folderContinuationFor(folderPath);
    const localHasMore = visibleCount < entryCount;
    const remoteHasMore = Boolean(continuation?.hasMore);
    if (!localHasMore && !remoteHasMore && !continuation?.message) return null;
    const limit = positiveInteger(continuation?.limit, treePageSize);
    const total = positiveInteger(continuation?.total, Math.max(entryCount, visibleCount));
    const state = continuation?.state ?? 'available';
    const offset = visibleCount;
    const disabled = props.disabled || state === 'loading';
    return (
      <div
        className={`workspace-file-viewer-continuation is-${state}`}
        data-folder-continuation-state={state}
        data-folder-offset={offset}
        data-folder-limit={limit}
        data-folder-total={total}
        style={{ paddingLeft: 16 + depth * 14 }}
      >
        <span>{labels.showingItems} {visibleCount} of {total}</span>
        {continuation?.message ? <span>{continuation.message}</span> : null}
        {(localHasMore || remoteHasMore) ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              if (remoteHasMore && props.onLoadMoreFolder) {
                props.onLoadMoreFolder({ folderPath, offset, limit });
                return;
              }
              setLocalVisibleLimits((current) => ({
                ...current,
                [normalizeComparablePath(folderPath)]: offset + limit,
              }));
            }}
          >
            {continuation?.commandLabel || labels.loadMore}
          </button>
        ) : null}
      </div>
    );
  }

  function renderFolderEntries(folderPath: string, depth: number): ReactNode {
    const entries = props.entriesByFolder[folderPath];
    if (entries === undefined) {
      return (
        <div className="workspace-file-viewer-loading" style={{ paddingLeft: 16 + depth * 14 }}>
          {labels.loading}
        </div>
      );
    }
    if (!entries.length) {
      return depth === 0 ? (
        <div className="workspace-file-viewer-empty" style={{ paddingLeft: 16 }}>
          {labels.emptyTree}
        </div>
      ) : null;
    }
    const sortedEntries = sortWorkspaceFileViewerEntries(entries);
    const visibleEntries = sortedEntries.slice(0, visibleLimitForFolder(folderPath));
    return (
      <>
        {visibleEntries.map((entry) => renderEntry(entry, depth))}
        {renderContinuation(folderPath, depth, sortedEntries.length, visibleEntries.length)}
      </>
    );
  }

  function renderEntry(entry: WorkspaceFileViewerEntry, depth: number): ReactNode {
    const entryPath = normalizeComparablePath(entry.path);
    const isFolder = entry.kind === 'folder';
    const isExpanded = isFolder && expanded.has(entryPath);
    const isSelected = selectedPath && selectedPath === entryPath;
    return (
      <div className="workspace-file-viewer-node" key={entry.path}>
        <button
          type="button"
          className={`workspace-file-viewer-row${isSelected ? ' is-selected' : ''}${isFolder ? ' is-folder' : ' is-file'}`}
          style={{ paddingLeft: 8 + depth * 14 }}
          role="treeitem"
          aria-expanded={isFolder ? isExpanded : undefined}
          aria-selected={Boolean(isSelected)}
          onClick={() => {
            if (isFolder) props.onToggleFolder?.(entry.path);
            else props.onOpenFile?.(entry);
          }}
        >
          <span className="workspace-file-viewer-twistie" aria-hidden>{isFolder ? (isExpanded ? '-' : '+') : ''}</span>
          <span className="workspace-file-viewer-entry-icon" aria-hidden>
            {props.renderFileIcon?.(entry) ?? entryGlyph(entry)}
          </span>
          <span className="workspace-file-viewer-entry-name" title={displayPathForPath(entry.path)}>{entry.name}</span>
        </button>
        {isFolder && isExpanded ? (
          <div className="workspace-file-viewer-branch" role="group">
            {renderFolderEntries(entry.path, depth + 1)}
          </div>
        ) : null}
      </div>
    );
  }

  function renderSearchEntry(entry: WorkspaceFileViewerEntry): ReactNode {
    const entryPath = normalizeComparablePath(entry.path);
    const isFolder = entry.kind === 'folder';
    const isSelected = selectedPath && selectedPath === entryPath;
    const parent = workspaceFileViewerRelativeParent(props.rootPath, entry.path);
    return (
      <button
        type="button"
        key={entry.path}
        className={`workspace-file-viewer-row workspace-file-viewer-search-row${isSelected ? ' is-selected' : ''}${isFolder ? ' is-folder' : ' is-file'}`}
        role="treeitem"
        aria-selected={Boolean(isSelected)}
        onClick={() => {
          if (isFolder) props.onToggleFolder?.(entry.path);
          else props.onOpenFile?.(entry);
        }}
      >
        <span className="workspace-file-viewer-twistie" aria-hidden>{isFolder ? '+' : ''}</span>
        <span className="workspace-file-viewer-entry-icon" aria-hidden>
          {props.renderFileIcon?.(entry) ?? entryGlyph(entry)}
        </span>
        <span className="workspace-file-viewer-entry-name" title={displayPathForPath(entry.path)}>{entry.name}</span>
        {parent ? <span className="workspace-file-viewer-entry-context">{parent}</span> : null}
      </button>
    );
  }

  function renderSearchResults(): ReactNode {
    if (!searchEntries.length) return <div className="workspace-file-viewer-empty">{labels.noSearchResults}</div>;
    const visibleEntries = searchEntries.slice(0, searchVisibleLimit);
    return (
      <>
        {visibleEntries.map(renderSearchEntry)}
        {visibleEntries.length < searchEntries.length ? (
          <div
            className="workspace-file-viewer-continuation is-available"
            data-search-continuation-state="available"
            data-folder-offset={visibleEntries.length}
            data-folder-limit={searchResultLimit}
            data-folder-total={searchEntries.length}
          >
            <span>{labels.showingItems} {visibleEntries.length} of {searchEntries.length}</span>
            <button
              type="button"
              disabled={props.disabled}
              onClick={() => setSearchVisibleLimit((current) => current + searchResultLimit)}
            >
              {labels.loadMore}
            </button>
          </div>
        ) : null}
      </>
    );
  }

  function handleEditorKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      if (editMode && props.dirty && !props.disabled) props.onSave?.();
    }
  }

  function setEditMode(nextEditMode: boolean) {
    const allowedEditMode = nextEditMode && canEditFile;
    if (props.editMode === undefined) setUncontrolledEditMode(allowedEditMode);
    props.onEditModeChange?.(allowedEditMode);
  }

  function handleCancelEdit() {
    if (props.onCancel) {
      props.onCancel();
      if (props.editMode === undefined) setUncontrolledEditMode(false);
      return;
    }
    if (props.file) props.onDraftChange?.(props.file.content);
    setEditMode(false);
  }

  return (
    <div
      className="workspace-file-viewer"
      aria-label={labels.title}
      data-component-id="workspace-file-viewer"
      data-render-boundary="presentation-only"
    >
      <aside className="workspace-file-viewer-tree" aria-label={labels.treeLabel}>
        <div className="workspace-file-viewer-tree-head">
          <strong title={displayPathForPath(props.rootPath)}>{props.rootLabel || workspaceFileViewerBasename(props.rootPath) || labels.title}</strong>
          <div className="workspace-file-viewer-toolbar">
            <button type="button" onClick={props.onRefresh} disabled={props.disabled || !props.onRefresh} title={labels.refresh} aria-label={labels.refresh}>R</button>
            <button type="button" onClick={props.onCollapseAll} disabled={props.disabled || !props.onCollapseAll} title={labels.collapseAll} aria-label={labels.collapseAll}>C</button>
          </div>
        </div>
        <label className="workspace-file-viewer-search">
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={labels.searchPlaceholder}
            aria-label={labels.searchPlaceholder}
            disabled={props.disabled}
          />
        </label>
        {props.error ? <div className="workspace-file-viewer-error">{props.error}</div> : null}
        {props.notice ? <div className="workspace-file-viewer-notice">{props.notice}</div> : null}
        {props.rootPath ? (
          <div className="workspace-file-viewer-tree-body" role="tree">
            <button
              type="button"
              className={`workspace-file-viewer-row workspace-file-viewer-root-row${selectedPath === rootPath ? ' is-selected' : ''}`}
              role="treeitem"
              aria-expanded={rootExpanded}
              aria-selected={selectedPath === rootPath}
              onClick={() => props.onToggleFolder?.(props.rootPath)}
            >
              <span className="workspace-file-viewer-twistie" aria-hidden>{rootExpanded ? '-' : '+'}</span>
              <span className="workspace-file-viewer-entry-icon" aria-hidden>dir</span>
              <span className="workspace-file-viewer-entry-name" title={displayPathForPath(props.rootPath)}>{props.rootLabel || workspaceFileViewerBasename(props.rootPath)}</span>
            </button>
            {normalizedSearchQuery ? (
              <div className="workspace-file-viewer-search-results" role="group">{renderSearchResults()}</div>
            ) : rootExpanded ? (
              <div role="group">{rootEntries === undefined ? renderFolderEntries(props.rootPath, 0) : renderFolderEntries(props.rootPath, 0)}</div>
            ) : null}
          </div>
        ) : (
          <div className="workspace-file-viewer-empty">{labels.emptyTree}</div>
        )}
      </aside>
      <section className="workspace-file-viewer-editor" aria-label={labels.editorLabel}>
        {currentFile ? (
          <div
            className="workspace-file-viewer-editor-document"
            data-file-preview-state={unsupportedKind ? `unsupported-${unsupportedKind}` : currentFile.readOnly ? 'readonly' : editMode ? 'editing' : 'readonly'}
            data-file-size-bytes={currentFile.size}
            data-inline-limit-bytes={unsupportedKind === 'too-large' ? inlineTextLimitBytes : undefined}
          >
            <div className="workspace-file-viewer-editor-head">
              <span className="workspace-file-viewer-editor-title">
                <strong title={displayPathForPath(currentFile.path)}>{currentFile.name}</strong>
                <span className={`workspace-file-viewer-mode${editMode ? ' is-editing' : ' is-read-only'}`}>
                  {editMode ? labels.editing : labels.readOnly}
                </span>
                {unsupportedKind ? (
                  <span className="workspace-file-viewer-state is-read-only">
                    {unsupportedKind === 'binary' ? labels.binaryFileState : unsupportedKind === 'too-large' ? labels.largeFileState : labels.unsupported}
                  </span>
                ) : (
                  <span className={`workspace-file-viewer-state${props.dirty ? ' is-dirty' : ''}`}>
                    {props.dirty ? labels.unsaved : labels.saved}
                  </span>
                )}
              </span>
              <div className="workspace-file-viewer-editor-actions">
                <button type="button" onClick={() => props.onCopyPath?.(copyPathForPath(currentFile.path))} disabled={!props.onCopyPath} title={labels.copyPath} aria-label={labels.copyPath}>P</button>
                <button type="button" onClick={() => props.onCopyContents?.(largeFilePreviewContent ?? props.draft ?? currentFile.content ?? '')} disabled={!props.onCopyContents || Boolean(unsupportedKind && !largeFilePreviewContent)} title={labels.copyContents} aria-label={labels.copyContents}>Copy</button>
                <button type="button" onClick={() => setEditMode(true)} disabled={props.disabled || editMode || !canEditFile} title={labels.edit} aria-label={labels.edit}>Edit</button>
                <button type="button" onClick={props.onSave} disabled={props.disabled || !editMode || !props.dirty || !props.onSave || !canEditFile} title={labels.save} aria-label={labels.save}>Save</button>
                {editMode ? (
                  <button type="button" onClick={handleCancelEdit} disabled={props.disabled} title={labels.cancel} aria-label={labels.cancel}>Cancel</button>
                ) : (
                  <button type="button" onClick={props.onClose} disabled={!props.onClose} title={labels.close} aria-label={labels.close}>X</button>
                )}
              </div>
            </div>
            {props.saveError ? <div className="workspace-file-viewer-error">{props.saveError}</div> : null}
            {unsupportedKind ? (
              <div className="workspace-file-viewer-unsupported" role="status">
                <strong>{unsupportedKind === 'binary' ? labels.binaryFileState : unsupportedKind === 'too-large' ? labels.largeFileState : labels.unsupported}</strong>
                <span>{workspaceFileViewerUnsupportedMessage(currentFile, labels, inlineTextLimitBytes)}</span>
                {unsupportedKind === 'too-large' ? (
                  <span className="workspace-file-viewer-unsupported-meta">
                    {labels.fileSize}: {formatBytes(currentFile.size) || currentFile.size} · {labels.inlineLimit}: {formatBytes(inlineTextLimitBytes)}
                  </span>
                ) : null}
                {largeFilePreviewContent !== undefined ? (
                  <pre
                    className="workspace-file-viewer-segment-preview"
                    data-file-segment-offset={currentFile.previewSegment?.offset ?? 0}
                    data-file-segment-length={currentFile.previewSegment?.length ?? largeFilePreviewContent.length}
                    data-file-segment-total={currentFile.previewSegment?.total ?? currentFile.size}
                    data-file-segment-has-more={currentFile.previewSegment?.hasMore}
                    aria-label={currentFile.previewSegment?.label ?? labels.previewSegment}
                  >
                    {largeFilePreviewContent}
                  </pre>
                ) : null}
                {props.onCopyPath ? (
                  <button type="button" onClick={() => props.onCopyPath?.(copyPathForPath(currentFile.path))} disabled={props.disabled}>
                    {labels.copyPath}
                  </button>
                ) : null}
              </div>
            ) : (
              <textarea
                value={props.draft ?? currentFile.content}
                spellCheck={false}
                readOnly={!editMode}
                onChange={(event) => {
                  if (editMode) props.onDraftChange?.(event.target.value);
                }}
                onKeyDown={handleEditorKeyDown}
                aria-label={`${currentFile.name} contents`}
              />
            )}
            <div className="workspace-file-viewer-meta">
              {currentFile.language ? <code>{currentFile.language}</code> : null}
              {currentFile.mimeType ? <code>{currentFile.mimeType}</code> : null}
              {formatBytes(currentFile.size) ? <span>{formatBytes(currentFile.size)}</span> : null}
              {currentFile.readOnly && !unsupportedKind ? <span>{currentFile.readOnlyReason || labels.readOnlyReason}</span> : null}
              {currentFile.modifiedAt ? <span>{new Date(currentFile.modifiedAt).toLocaleString(undefined, { hour12: false })}</span> : null}
            </div>
          </div>
        ) : (
          <div className="workspace-file-viewer-empty">{labels.emptyEditor}</div>
        )}
      </section>
    </div>
  );
}

export function renderWorkspaceFileViewer(props: UIComponentRendererProps) {
  const payload = props.artifact?.data;
  const artifactRecord = typeof payload === 'object' && payload !== null && !Array.isArray(payload)
    ? payload as Partial<WorkspaceFileViewerProps>
    : {};
  const slotRecord = props.slot.props as Partial<WorkspaceFileViewerProps> | undefined;
  const record = { ...artifactRecord, ...(slotRecord ?? {}) };
  return (
    <WorkspaceFileViewer
      rootPath={typeof record.rootPath === 'string' ? record.rootPath : ''}
      rootLabel={typeof record.rootLabel === 'string' ? record.rootLabel : undefined}
      entriesByFolder={record.entriesByFolder ?? {}}
      expandedFolderPaths={Array.isArray(record.expandedFolderPaths) ? record.expandedFolderPaths : []}
      selectedPath={typeof record.selectedPath === 'string' ? record.selectedPath : undefined}
      file={record.file ?? null}
      draft={typeof record.draft === 'string' ? record.draft : undefined}
      dirty={Boolean(record.dirty)}
      editMode={typeof record.editMode === 'boolean' ? record.editMode : undefined}
      notice={typeof record.notice === 'string' ? record.notice : undefined}
      error={typeof record.error === 'string' ? record.error : undefined}
      saveError={typeof record.saveError === 'string' ? record.saveError : undefined}
      disabled={Boolean(record.disabled)}
      labels={record.labels}
      renderFileIcon={record.renderFileIcon}
      displayPathForPath={record.displayPathForPath}
      copyPathForPath={record.copyPathForPath}
      treePageSize={record.treePageSize}
      searchResultLimit={record.searchResultLimit}
      inlineTextLimitBytes={record.inlineTextLimitBytes}
      folderContinuations={record.folderContinuations}
      onToggleFolder={record.onToggleFolder}
      onOpenFile={record.onOpenFile}
      onRefresh={record.onRefresh}
      onCollapseAll={record.onCollapseAll}
      onDraftChange={record.onDraftChange}
      onEditModeChange={record.onEditModeChange}
      onSave={record.onSave}
      onCancel={record.onCancel}
      onClose={record.onClose}
      onCopyPath={record.onCopyPath}
      onCopyContents={record.onCopyContents}
      onLoadMoreFolder={record.onLoadMoreFolder}
    />
  );
}
