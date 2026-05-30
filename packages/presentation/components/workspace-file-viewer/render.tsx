import React, { type KeyboardEvent, type ReactNode } from 'react';
import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

export interface WorkspaceFileViewerEntry {
  name: string;
  path: string;
  kind: 'file' | 'folder';
  size?: number;
  modifiedAt?: string;
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
}

export interface WorkspaceFileViewerLabels {
  title: string;
  treeLabel: string;
  editorLabel: string;
  loading: string;
  emptyTree: string;
  emptyEditor: string;
  refresh: string;
  collapseAll: string;
  copyPath: string;
  copyContents: string;
  save: string;
  close: string;
  saved: string;
  unsaved: string;
}

export interface WorkspaceFileViewerProps {
  rootPath: string;
  rootLabel?: string;
  entriesByFolder: Record<string, WorkspaceFileViewerEntry[] | undefined>;
  expandedFolderPaths: readonly string[];
  selectedPath?: string;
  file?: WorkspaceFileViewerFile | null;
  draft?: string;
  dirty?: boolean;
  notice?: string;
  error?: string;
  saveError?: string;
  disabled?: boolean;
  labels?: Partial<WorkspaceFileViewerLabels>;
  renderFileIcon?: (entry: WorkspaceFileViewerEntry) => ReactNode;
  onToggleFolder?: (path: string) => void;
  onOpenFile?: (entry: WorkspaceFileViewerEntry) => void;
  onRefresh?: () => void;
  onCollapseAll?: () => void;
  onDraftChange?: (draft: string) => void;
  onSave?: () => void;
  onClose?: () => void;
  onCopyPath?: (path: string) => void;
  onCopyContents?: (content: string) => void;
}

const defaultLabels: WorkspaceFileViewerLabels = {
  title: 'Workspace files',
  treeLabel: 'Workspace file tree',
  editorLabel: 'Workspace file editor',
  loading: 'Loading...',
  emptyTree: 'No files to show.',
  emptyEditor: 'Select a file to inspect it.',
  refresh: 'Refresh',
  collapseAll: 'Collapse all',
  copyPath: 'Copy path',
  copyContents: 'Copy contents',
  save: 'Save file',
  close: 'Close file view',
  saved: 'Saved',
  unsaved: 'Unsaved',
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

function normalizeComparablePath(path: string | undefined) {
  return (path ?? '').replace(/\\/g, '/').replace(/\/+$/, '');
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

export function WorkspaceFileViewer(props: WorkspaceFileViewerProps) {
  const labels = { ...defaultLabels, ...props.labels };
  const expanded = new Set(props.expandedFolderPaths.map(normalizeComparablePath));
  const selectedPath = normalizeComparablePath(props.selectedPath ?? props.file?.path);
  const rootPath = normalizeComparablePath(props.rootPath);
  const rootExpanded = expanded.has(rootPath);
  const rootEntries = props.entriesByFolder[props.rootPath];

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
    return sortWorkspaceFileViewerEntries(entries).map((entry) => renderEntry(entry, depth));
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
          <span className="workspace-file-viewer-entry-name" title={entry.path}>{entry.name}</span>
        </button>
        {isFolder && isExpanded ? (
          <div className="workspace-file-viewer-branch" role="group">
            {renderFolderEntries(entry.path, depth + 1)}
          </div>
        ) : null}
      </div>
    );
  }

  function handleEditorKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      props.onSave?.();
    }
  }

  return (
    <div className="workspace-file-viewer" aria-label={labels.title}>
      <aside className="workspace-file-viewer-tree" aria-label={labels.treeLabel}>
        <div className="workspace-file-viewer-tree-head">
          <strong title={props.rootPath}>{props.rootLabel || workspaceFileViewerBasename(props.rootPath) || labels.title}</strong>
          <div className="workspace-file-viewer-toolbar">
            <button type="button" onClick={props.onRefresh} disabled={props.disabled || !props.onRefresh} title={labels.refresh} aria-label={labels.refresh}>R</button>
            <button type="button" onClick={props.onCollapseAll} disabled={props.disabled || !props.onCollapseAll} title={labels.collapseAll} aria-label={labels.collapseAll}>C</button>
          </div>
        </div>
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
              <span className="workspace-file-viewer-entry-name" title={props.rootPath}>{props.rootLabel || workspaceFileViewerBasename(props.rootPath)}</span>
            </button>
            {rootExpanded ? <div role="group">{rootEntries === undefined ? renderFolderEntries(props.rootPath, 0) : renderFolderEntries(props.rootPath, 0)}</div> : null}
          </div>
        ) : (
          <div className="workspace-file-viewer-empty">{labels.emptyTree}</div>
        )}
      </aside>
      <section className="workspace-file-viewer-editor" aria-label={labels.editorLabel}>
        {props.file ? (
          <>
            <div className="workspace-file-viewer-editor-head">
              <span className="workspace-file-viewer-editor-title">
                <strong title={props.file.path}>{props.file.name}</strong>
                <span className={`workspace-file-viewer-state${props.dirty ? ' is-dirty' : ''}`}>
                  {props.dirty ? labels.unsaved : labels.saved}
                </span>
              </span>
              <div className="workspace-file-viewer-editor-actions">
                <button type="button" onClick={() => props.file ? props.onCopyPath?.(props.file.path) : undefined} disabled={!props.onCopyPath} title={labels.copyPath} aria-label={labels.copyPath}>P</button>
                <button type="button" onClick={() => props.onCopyContents?.(props.draft ?? props.file?.content ?? '')} disabled={!props.onCopyContents} title={labels.copyContents} aria-label={labels.copyContents}>Copy</button>
                <button type="button" onClick={props.onSave} disabled={props.disabled || !props.dirty || !props.onSave} title={labels.save} aria-label={labels.save}>Save</button>
                <button type="button" onClick={props.onClose} disabled={!props.onClose} title={labels.close} aria-label={labels.close}>X</button>
              </div>
            </div>
            {props.saveError ? <div className="workspace-file-viewer-error">{props.saveError}</div> : null}
            <textarea
              value={props.draft ?? props.file.content}
              spellCheck={false}
              onChange={(event) => props.onDraftChange?.(event.target.value)}
              onKeyDown={handleEditorKeyDown}
              aria-label={`${props.file.name} contents`}
            />
            <div className="workspace-file-viewer-meta">
              {props.file.language ? <code>{props.file.language}</code> : null}
              {formatBytes(props.file.size) ? <span>{formatBytes(props.file.size)}</span> : null}
              {props.file.modifiedAt ? <span>{new Date(props.file.modifiedAt).toLocaleString(undefined, { hour12: false })}</span> : null}
            </div>
          </>
        ) : (
          <div className="workspace-file-viewer-empty">{labels.emptyEditor}</div>
        )}
      </section>
    </div>
  );
}

export function renderWorkspaceFileViewer(props: UIComponentRendererProps) {
  const payload = props.artifact?.data;
  const record = typeof payload === 'object' && payload !== null && !Array.isArray(payload)
    ? payload as Partial<WorkspaceFileViewerProps>
    : {};
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
    />
  );
}
