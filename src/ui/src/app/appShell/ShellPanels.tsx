import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Check, ChevronDown, ChevronLeft, ChevronRight, ChevronsUp, Copy, File, FileCode, FilePlus, FileText, Folder, FolderOpen, FolderPlus, Moon, Plus, RefreshCw, Save, Search, Settings, Sun, Target, Trash2 } from 'lucide-react';
import { navItems, type PageId, type ScenarioId } from '../../data';
import type { PeerInstance, SciForgeConfig, ScenarioInstanceId } from '../../domain';
import { listWorkspace, mutateWorkspaceFile, openWorkspaceObject, readWorkspaceFile, writeWorkspaceFile, type WorkspaceEntry, type WorkspaceFileContent } from '../../api/workspaceClient';
import { ActionButton, Badge, IconButton, cx } from '../uiPrimitives';
import { RuntimeHealthPanel, useRuntimeHealth, type RuntimeHealthItem } from '../runtimeHealthPanel';
import { validatePeerInstances } from '../../config';
import {
  explorerWorkspaceRoot,
  formatBytes,
  parentPath,
  pathBasename,
  sortWorkspaceEntries,
  syntheticFolderEntry,
  toWorkspaceRelativePath,
  workspaceActionSuccessMessage,
  workspaceNeedsOnboarding,
  workspaceOnboardingError,
  workspaceOnboardingReason,
  type WorkspaceAction,
} from './explorerModels';
import { settingsSaveStateText, type ConfigSaveState } from './settingsModels';

function explorerFileGlyph(name: string) {
  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 ? name.slice(dot).toLowerCase() : '';
  if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.rs', '.go'].includes(ext)) {
    return <FileCode size={16} className="explorer-type-icon" aria-hidden />;
  }
  if (['.md', '.txt', '.rst'].includes(ext)) {
    return <FileText size={16} className="explorer-type-icon" aria-hidden />;
  }
  if (['.json', '.yaml', '.yml', '.toml'].includes(ext)) {
    return <FileCode size={16} className="explorer-type-icon explorer-icon-muted" aria-hidden />;
  }
  return <File size={16} className="explorer-type-icon explorer-icon-muted" aria-hidden />;
}

export function Sidebar({
  page,
  setPage,
  scenarioId,
  setScenarioId,
  config,
  workspaceStatus,
  onWorkspacePathChange,
  deferWorkbenchFilePreview,
  onWorkbenchFileOpened,
  workbenchEditorFilePath,
  onWorkbenchEditorPathInvalidated,
}: {
  page: PageId;
  setPage: (page: PageId) => void;
  scenarioId: ScenarioInstanceId;
  setScenarioId: (id: ScenarioId) => void;
  config: SciForgeConfig;
  workspaceStatus: string;
  onWorkspacePathChange: (value: string) => void;
  deferWorkbenchFilePreview?: boolean;
  onWorkbenchFileOpened?: (file: WorkspaceFileContent) => void;
  workbenchEditorFilePath?: string | null;
  onWorkbenchEditorPathInvalidated?: () => void;
}) {
  const workspaceRoot = explorerWorkspaceRoot(config);
  const [collapsed, setCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(284);
  const [folderChildren, setFolderChildren] = useState<Record<string, WorkspaceEntry[]>>({});
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set(workspaceRoot ? [workspaceRoot] : []));
  const [workspaceError, setWorkspaceError] = useState('');
  const [workspaceNotice, setWorkspaceNotice] = useState('');
  const [selectedEntry, setSelectedEntry] = useState<{ path: string; kind: 'file' | 'folder' } | null>(null);
  const [pathEditDraft, setPathEditDraft] = useState(config.workspacePath);
  const [previewFile, setPreviewFile] = useState<WorkspaceFileContent | null>(null);
  const [previewDraft, setPreviewDraft] = useState('');
  const [previewDirty, setPreviewDirty] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; entry?: WorkspaceEntry } | null>(null);
  const resizingRef = useRef(false);

  useEffect(() => {
    if (collapsed) return;
    function handleMouseMove(event: MouseEvent) {
      if (!resizingRef.current) return;
      const nextWidth = Math.min(420, Math.max(220, event.clientX));
      setSidebarWidth(nextWidth);
    }
    function handleMouseUp() {
      resizingRef.current = false;
    }
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [collapsed]);

  useEffect(() => {
    const root = explorerWorkspaceRoot(config);
    setPathEditDraft(config.workspacePath);
    setPreviewFile(null);
    setPreviewDraft('');
    setPreviewDirty(false);
    setFolderChildren({});
    setExpandedFolders(new Set(root ? [root] : []));
    setSelectedEntry(root ? { path: root, kind: 'folder' } : null);
  }, [config.workspacePath]);

  useEffect(() => {
    if (collapsed || !workspaceRoot) return;
    void (async () => {
      try {
        setWorkspaceError('');
        const entries = await listWorkspace(workspaceRoot, config);
        setFolderChildren((prev) => ({ ...prev, [workspaceRoot]: sortWorkspaceEntries(entries) }));
        setWorkspaceNotice(entries.length ? `已加载 ${entries.length} 项` : '文件夹为空');
      } catch (err) {
        setFolderChildren({});
        setWorkspaceError(err instanceof Error ? err.message : String(err));
        setWorkspaceNotice('');
      }
    })();
  }, [collapsed, workspaceRoot, config.workspaceWriterBaseUrl, config.workspacePath]);

  useEffect(() => {
    if (!contextMenu) return;
    function closeMenu() {
      setContextMenu(null);
    }
    window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, [contextMenu]);

  function effectiveCreateParentPath(): string {
    const root = explorerWorkspaceRoot(config);
    if (!selectedEntry) return root;
    if (selectedEntry.kind === 'folder') return selectedEntry.path;
    const p = parentPath(selectedEntry.path);
    return p && p.length ? p : root;
  }

  async function ensureFolderLoaded(dirPath: string) {
    if (!dirPath.trim()) return;
    try {
      setWorkspaceError('');
      const raw = await listWorkspace(dirPath, config);
      setFolderChildren((prev) => ({ ...prev, [dirPath]: sortWorkspaceEntries(raw) }));
    } catch (err) {
      setWorkspaceError(err instanceof Error ? err.message : String(err));
    }
  }

  async function refreshExplorer() {
    const root = explorerWorkspaceRoot(config);
    if (!root) {
      setWorkspaceNotice('');
      return;
    }
    try {
      setWorkspaceError('');
      const paths = new Set<string>([root, ...expandedFolders]);
      const next: Record<string, WorkspaceEntry[]> = {};
      for (const p of paths) {
        if (!p.trim()) continue;
        const raw = await listWorkspace(p, config);
        next[p] = sortWorkspaceEntries(raw);
      }
      setFolderChildren((prev) => ({ ...prev, ...next }));
      const n = next[root]?.length ?? 0;
      setWorkspaceNotice(n ? `已加载 ${n} 项` : '文件夹为空');
    } catch (err) {
      setWorkspaceError(err instanceof Error ? err.message : String(err));
      setWorkspaceNotice('');
    }
  }

  function collapseExplorerFolders() {
    const root = explorerWorkspaceRoot(config);
    if (!root) {
      setExpandedFolders(new Set());
      return;
    }
    setExpandedFolders(new Set([root]));
  }

  async function openWorkspaceEntry(entry: WorkspaceEntry) {
    if (entry.kind === 'folder') return;
    setSelectedEntry({ path: entry.path, kind: 'file' });
    try {
      setWorkspaceError('');
      const file = await readWorkspaceFile(entry.path, config);
      onWorkbenchFileOpened?.(file);
      if (deferWorkbenchFilePreview) {
        setPreviewFile(null);
        setPreviewDraft('');
        setPreviewDirty(false);
      } else {
        setPreviewFile(file);
        setPreviewDraft(file.content);
        setPreviewDirty(false);
      }
      setWorkspaceNotice(`已打开 ${file.name}`);
    } catch (err) {
      setWorkspaceError(err instanceof Error ? err.message : String(err));
      setWorkspaceNotice('');
    }
  }

  async function savePreviewFile() {
    if (!previewFile) return;
    try {
      setWorkspaceError('');
      const file = await writeWorkspaceFile(previewFile.path, previewDraft, config);
      setPreviewFile(file);
      setPreviewDraft(file.content);
      setPreviewDirty(false);
      setWorkspaceNotice(`已保存 ${file.name}`);
      await refreshExplorer();
    } catch (err) {
      setWorkspaceError(err instanceof Error ? err.message : String(err));
      setWorkspaceNotice('');
    }
  }

  async function runWorkspaceAction(action: WorkspaceAction, entry?: WorkspaceEntry) {
    const root = explorerWorkspaceRoot(config);
    const basePath = entry?.kind === 'folder'
      ? entry.path
      : entry?.kind === 'file'
        ? (parentPath(entry.path) || root)
        : effectiveCreateParentPath();
    const selectedPath = entry?.path || selectedEntry?.path || root;
    let targetPath = selectedPath;
    let renameTarget: string | undefined;
    if (action === 'create-file') {
      const name = window.prompt('新文件名', 'notes.md');
      if (!name) return;
      targetPath = `${basePath.replace(/\/+$/, '')}/${name}`;
    } else if (action === 'create-folder') {
      const name = window.prompt('新文件夹名', 'new-folder');
      if (!name) return;
      targetPath = `${basePath.replace(/\/+$/, '')}/${name}`;
    } else if (action === 'rename') {
      if (!entry) return;
      const name = window.prompt('重命名为', entry.name);
      if (!name || name === entry.name) return;
      renameTarget = `${entry.path.slice(0, -entry.name.length)}${name}`;
    } else if (action === 'delete') {
      if (!entry || !window.confirm(`删除 ${entry.name}？`)) return;
    }
    try {
      setWorkspaceError('');
      await mutateWorkspaceFile(config, action, { path: targetPath, targetPath: renameTarget });
      const invalidatedWorkbenchPath = entry?.path && workbenchEditorFilePath && entry.path === workbenchEditorFilePath;
      if (invalidatedWorkbenchPath) {
        onWorkbenchEditorPathInvalidated?.();
      }
      if (previewFile && (previewFile.path === targetPath || previewFile.path === selectedPath)) {
        setPreviewFile(null);
        setPreviewDraft('');
        setPreviewDirty(false);
      }
      await refreshExplorer();
      setWorkspaceNotice(workspaceActionSuccessMessage(action));
    } catch (err) {
      setWorkspaceError(err instanceof Error ? err.message : String(err));
      setWorkspaceNotice('');
    }
  }

  async function initializeWorkspacePath() {
    const root = config.workspacePath.trim();
    if (!root) {
      setWorkspaceError('请先填写 workspace path。');
      return;
    }
    try {
      setWorkspaceError('');
      setWorkspaceNotice('正在创建 SciForge workspace...');
      await mutateWorkspaceFile(config, 'create-folder', { path: root });
      await mutateWorkspaceFile(config, 'create-folder', { path: `${root.replace(/\/+$/, '')}/.sciforge` });
      for (const resource of ['tasks', 'logs', 'task-results', 'scenarios', 'exports', 'artifacts', 'sessions', 'versions']) {
        await mutateWorkspaceFile(config, 'create-folder', { path: `${root.replace(/\/+$/, '')}/.sciforge/${resource}` });
      }
      await refreshExplorer();
      setWorkspaceNotice('SciForge workspace 已创建；可以导入 package 或运行场景。');
    } catch (err) {
      setWorkspaceError(workspaceOnboardingError(err));
      setWorkspaceNotice('');
    }
  }

  async function openFolderFromContext(path: string) {
    setSelectedEntry({ path, kind: 'folder' });
    setExpandedFolders((prev) => new Set([...prev, path]));
    await ensureFolderLoaded(path);
  }

  async function toggleFolderExpanded(path: string, nextExpanded?: boolean) {
    const shouldExpand = typeof nextExpanded === 'boolean' ? nextExpanded : !expandedFolders.has(path);
    if (shouldExpand) {
      setExpandedFolders((prev) => new Set([...prev, path]));
      await ensureFolderLoaded(path);
      return;
    }
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      next.delete(path);
      return next;
    });
  }

  async function handleContextMenuAction(action: WorkspaceAction) {
    const entry = contextMenu?.entry;
    setContextMenu(null);
    await runWorkspaceAction(action, entry);
  }

  async function handleContextMenuOpen() {
    const entry = contextMenu?.entry;
    setContextMenu(null);
    if (!entry) return;
    if (entry.kind === 'folder') {
      await openFolderFromContext(entry.path);
      return;
    }
    await openWorkspaceEntry(entry);
  }

  async function handleContextMenuToggleFolder() {
    const entry = contextMenu?.entry;
    setContextMenu(null);
    if (!entry || entry.kind !== 'folder') return;
    await toggleFolderExpanded(entry.path);
  }

  async function handleContextMenuCopyPath() {
    const entry = contextMenu?.entry;
    setContextMenu(null);
    if (!entry?.path) return;
    await navigator.clipboard?.writeText(entry.path);
    setWorkspaceNotice(`已复制路径 ${entry.path}`);
  }

  async function handleContextMenuCopyRelativePath() {
    const entry = contextMenu?.entry;
    setContextMenu(null);
    if (!entry?.path) return;
    const relativePath = toWorkspaceRelativePath(explorerWorkspaceRoot(config), entry.path);
    await navigator.clipboard?.writeText(relativePath);
    setWorkspaceNotice(`已复制相对路径 ${relativePath}`);
  }

  async function handleContextMenuRevealInFolder() {
    const entry = contextMenu?.entry;
    setContextMenu(null);
    if (!entry?.path) return;
    try {
      setWorkspaceError('');
      await openWorkspaceObject(config, 'reveal-in-folder', entry.path, config.workspacePath);
      setWorkspaceNotice(`已在系统文件管理器定位 ${entry.name}`);
    } catch (err) {
      setWorkspaceError(err instanceof Error ? err.message : String(err));
      setWorkspaceNotice('');
    }
  }

  async function handleContextMenuOpenExternal() {
    const entry = contextMenu?.entry;
    setContextMenu(null);
    if (!entry?.path) return;
    try {
      setWorkspaceError('');
      await openWorkspaceObject(config, 'open-external', entry.path, config.workspacePath);
      setWorkspaceNotice(`已使用系统默认方式打开 ${entry.name}`);
    } catch (err) {
      setWorkspaceError(err instanceof Error ? err.message : String(err));
      setWorkspaceNotice('');
    }
  }

  async function handleContextMenuOpenInWorkbench() {
    const entry = contextMenu?.entry;
    setContextMenu(null);
    if (!entry || entry.kind !== 'file') return;
    try {
      setWorkspaceError('');
      const file = await readWorkspaceFile(entry.path, config);
      onWorkbenchFileOpened?.(file);
      setPage('workbench');
      setWorkspaceNotice(`已在工作台打开 ${file.name}`);
    } catch (err) {
      setWorkspaceError(err instanceof Error ? err.message : String(err));
      setWorkspaceNotice('');
    }
  }

  function renderExplorerDepth(depth: number, dirPath: string): ReactNode {
    const entries = folderChildren[dirPath];
    if (entries === undefined) {
      return (
        <div className="explorer-loading" style={{ paddingLeft: 12 + depth * 12 }}>
          加载中…
        </div>
      );
    }
    return entries.map((entry) => {
      const isExpanded = entry.kind === 'folder' && expandedFolders.has(entry.path);
      const isSelected = selectedEntry?.path === entry.path;
      return (
        <div key={entry.path} className="explorer-node">
          <div
            role="treeitem"
            aria-expanded={entry.kind === 'folder' ? isExpanded : undefined}
            className={cx('explorer-row', entry.kind === 'file' && 'is-file', isSelected && 'is-selected')}
            style={{ paddingLeft: 8 + depth * 12 }}
            onClick={(event) => {
              if ((event.target as HTMLElement).closest('.explorer-twistie')) return;
              setSelectedEntry({ path: entry.path, kind: entry.kind });
              if (entry.kind === 'file') void openWorkspaceEntry(entry);
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              setSelectedEntry({ path: entry.path, kind: entry.kind });
              setContextMenu({ x: event.clientX, y: event.clientY, entry });
            }}
          >
            {entry.kind === 'folder' ? (
              <button
                type="button"
                className="explorer-twistie"
                aria-label={isExpanded ? '折叠' : '展开'}
                onClick={(ev) => {
                  ev.stopPropagation();
                  setExpandedFolders((prev) => {
                    const next = new Set(prev);
                    if (next.has(entry.path)) next.delete(entry.path);
                    else {
                      next.add(entry.path);
                      void ensureFolderLoaded(entry.path);
                    }
                    return next;
                  });
                }}
              >
                {isExpanded ? <ChevronDown size={14} strokeWidth={1.75} /> : <ChevronRight size={14} strokeWidth={1.75} />}
              </button>
            ) : (
              <span className="explorer-twistie-placeholder" aria-hidden />
            )}
            {entry.kind === 'folder' ? <Folder size={16} className="explorer-type-icon" aria-hidden /> : explorerFileGlyph(entry.name)}
            <span className="explorer-label">{entry.name}</span>
          </div>
          {entry.kind === 'folder' && isExpanded ? (
            <div className="explorer-branch" role="group">
              {renderExplorerDepth(depth + 1, entry.path)}
            </div>
          ) : null}
        </div>
      );
    });
  }

  return (
    <aside className={cx('sidebar', collapsed && 'collapsed')} style={{ width: collapsed ? 46 : sidebarWidth }}>
      <div className="sidebar-activitybar">
        <div className="brand">
          <div className="brand-mark">BA</div>
        </div>
        <button
          className={cx('activity-item', !collapsed && 'active')}
          onClick={() => setCollapsed(false)}
          title="导航"
          aria-label="导航"
        >
          <Target size={18} />
        </button>
        {collapsed ? (
          <button className="collapse-button top-toggle" onClick={() => setCollapsed(false)} title="展开侧栏" aria-label="展开侧栏">
            <ChevronRight size={16} />
          </button>
        ) : null}
      </div>

      {!collapsed ? (
        <div className="sidebar-panel">
          <div className="sidebar-panel-header">
            <span>导航</span>
            <button className="panel-collapse-button" onClick={() => setCollapsed(true)} title="收起侧栏" aria-label="收起侧栏">
              <ChevronLeft size={16} />
            </button>
          </div>
          <div className="sidebar-panel-body">
            <nav className="nav-section">
              {navItems.map((item) => (
                <button key={item.id} className={cx('nav-item', page === item.id && 'active')} onClick={() => setPage(item.id)}>
                  <item.icon size={18} />
                  <span>{item.label}</span>
                </button>
              ))}
            </nav>
            <div className="scenario-list scenario-list-workspace">
              <div className="scenario-list-explorer-toolbar">
                <div className="explorer-view-toolbar">
                  <button
                    type="button"
                    className="explorer-icon-btn"
                    onClick={() => void runWorkspaceAction('create-file')}
                    title="新建文件"
                    aria-label="新建文件"
                  >
                    <FilePlus size={16} />
                  </button>
                  <button
                    type="button"
                    className="explorer-icon-btn"
                    onClick={() => void runWorkspaceAction('create-folder')}
                    title="新建文件夹"
                    aria-label="新建文件夹"
                  >
                    <FolderPlus size={16} />
                  </button>
                  <button type="button" className="explorer-icon-btn" onClick={() => void refreshExplorer()} title="刷新" aria-label="刷新">
                    <RefreshCw size={16} />
                  </button>
                  <button type="button" className="explorer-icon-btn" onClick={collapseExplorerFolders} title="全部折叠" aria-label="全部折叠">
                    <ChevronsUp size={16} />
                  </button>
                </div>
              </div>
              <div
                className="sidebar-tree explorer-surface scenario-list-explorer-tree"
                role="tree"
                aria-label="工作区文件树"
                onContextMenu={(event) => {
                  if ((event.target as HTMLElement).closest('.explorer-row')) return;
                  event.preventDefault();
                  setContextMenu({ x: event.clientX, y: event.clientY });
                }}
              >
                {workspaceNeedsOnboarding(config.workspacePath, workspaceError, workspaceStatus) ? (
                  <div className="workspace-onboarding">
                    <strong>{config.workspacePath.trim() ? '初始化 SciForge workspace' : '设置 workspace path'}</strong>
                    <p>{workspaceOnboardingReason(config.workspacePath, workspaceError, workspaceStatus)}</p>
                    <button type="button" onClick={() => void initializeWorkspacePath()}>
                      创建 .sciforge 工作区
                    </button>
                  </div>
                ) : null}
                {workspaceNotice ? <p className="workspace-status explorer-muted-line" role="status">{workspaceNotice}</p> : null}
                {workspaceError ? <p className="workspace-error">{workspaceError}</p> : null}
                {!workspaceNeedsOnboarding(config.workspacePath, workspaceError, workspaceStatus) && workspaceRoot ? (
                  <div className="explorer-section">
                    <div
                      role="treeitem"
                      aria-expanded={expandedFolders.has(workspaceRoot)}
                      className={cx('explorer-row', 'explorer-root-row', selectedEntry?.path === workspaceRoot && 'is-selected')}
                      style={{ paddingLeft: 8 }}
                      onClick={(event) => {
                        if ((event.target as HTMLElement).closest('.explorer-twistie')) return;
                        setSelectedEntry({ path: workspaceRoot, kind: 'folder' });
                      }}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        setSelectedEntry({ path: workspaceRoot, kind: 'folder' });
                        setContextMenu({ x: event.clientX, y: event.clientY, entry: syntheticFolderEntry(workspaceRoot) });
                      }}
                    >
                      <button
                        type="button"
                        className="explorer-twistie"
                        aria-label={expandedFolders.has(workspaceRoot) ? '折叠' : '展开'}
                        onClick={(ev) => {
                          ev.stopPropagation();
                          setExpandedFolders((prev) => {
                            const next = new Set(prev);
                            if (next.has(workspaceRoot)) next.delete(workspaceRoot);
                            else {
                              next.add(workspaceRoot);
                              void ensureFolderLoaded(workspaceRoot);
                            }
                            return next;
                          });
                        }}
                      >
                        {expandedFolders.has(workspaceRoot) ? <ChevronDown size={14} strokeWidth={1.75} /> : <ChevronRight size={14} strokeWidth={1.75} />}
                      </button>
                      <FolderOpen size={16} className="explorer-type-icon" aria-hidden />
                      <span className="explorer-label">{pathBasename(workspaceRoot) || workspaceRoot}</span>
                    </div>
                    {expandedFolders.has(workspaceRoot) ? (
                      <div className="explorer-branch explorer-root-children" role="group">
                        {renderExplorerDepth(0, workspaceRoot)}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {previewFile ? (
                  <div className="workspace-preview" aria-label="文件预览">
                    <div className="workspace-preview-head">
                      <span>
                        <FileText size={13} />
                        <strong>{previewFile.name}</strong>
                        {previewDirty ? <Badge variant="warning">未保存</Badge> : <Badge variant="success">已保存</Badge>}
                      </span>
                      <div>
                        <button type="button" onClick={() => void navigator.clipboard?.writeText(previewFile.path)} title="复制路径" aria-label="复制路径"><Copy size={13} /></button>
                        <button type="button" onClick={() => void navigator.clipboard?.writeText(previewDraft)} title="复制内容" aria-label="复制内容"><Copy size={13} /></button>
                        <button type="button" onClick={() => void savePreviewFile()} disabled={!previewDirty} title="保存文件" aria-label="保存文件"><Save size={13} /></button>
                      </div>
                    </div>
                    <textarea
                      value={previewDraft}
                      spellCheck={false}
                      onChange={(event) => {
                        setPreviewDraft(event.target.value);
                        setPreviewDirty(event.target.value !== previewFile.content);
                      }}
                      onKeyDown={(event) => {
                        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
                          event.preventDefault();
                          void savePreviewFile();
                        }
                      }}
                      aria-label={`${previewFile.name} 文件内容`}
                    />
                    <div className="workspace-preview-meta">
                      <code>{previewFile.language}</code>
                      <span>{formatBytes(previewFile.size)}</span>
                      {previewFile.modifiedAt ? <span>{new Date(previewFile.modifiedAt).toLocaleString('zh-CN', { hour12: false })}</span> : null}
                    </div>
                  </div>
                ) : null}
                {contextMenu ? (
                  <div className="context-menu context-menu-vscode" style={{ left: contextMenu.x, top: contextMenu.y }} onClick={(event) => event.stopPropagation()}>
                    {contextMenu.entry?.kind === 'folder' ? (
                      <button
                        type="button"
                        onClick={() => void handleContextMenuToggleFolder()}
                      >
                        {expandedFolders.has(contextMenu.entry.path) ? '折叠' : '展开'}
                      </button>
                    ) : null}
                    {contextMenu.entry ? (
                      <button type="button" onClick={() => void handleContextMenuOpen()}>
                        {contextMenu.entry.kind === 'folder' ? '打开文件夹' : '打开'}
                      </button>
                    ) : null}
                    {contextMenu.entry?.kind === 'file' ? (
                      <button type="button" onClick={() => void handleContextMenuOpenInWorkbench()}>在工作台打开</button>
                    ) : null}
                    <hr className="context-menu-separator" />
                    <button type="button" onClick={() => void handleContextMenuAction('create-file')}>新建文件</button>
                    <button type="button" onClick={() => void handleContextMenuAction('create-folder')}>新建文件夹</button>
                    {contextMenu.entry ? <button type="button" onClick={() => void handleContextMenuAction('rename')}>重命名</button> : null}
                    {contextMenu.entry ? (
                      <button type="button" onClick={() => void handleContextMenuCopyPath()}>复制路径</button>
                    ) : null}
                    {contextMenu.entry ? (
                      <button type="button" onClick={() => void handleContextMenuCopyRelativePath()}>复制相对路径</button>
                    ) : null}
                    {contextMenu.entry ? (
                      <button type="button" onClick={() => void handleContextMenuRevealInFolder()}>在文件管理器中显示</button>
                    ) : null}
                    {contextMenu.entry ? (
                      <button type="button" onClick={() => void handleContextMenuOpenExternal()}>系统默认程序打开</button>
                    ) : null}
                    {contextMenu.entry ? <button type="button" className="danger" onClick={() => void handleContextMenuAction('delete')}>删除</button> : null}
                  </div>
                ) : null}
                <details className="explorer-folder-picker">
                  <summary>打开其他文件夹…</summary>
                  <div className="explorer-folder-picker-body">
                    <input
                      className="workspace-path-editor explorer-path-input"
                      value={pathEditDraft}
                      onChange={(event) => setPathEditDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') void refreshExplorer();
                      }}
                      spellCheck={false}
                      title={workspaceStatus || 'Workspace 根路径'}
                      aria-label="Workspace 根路径"
                    />
                    <div className="explorer-folder-picker-actions">
                      <button type="button" className="explorer-cta-btn" onClick={() => onWorkspacePathChange(pathEditDraft.trim())}>
                        <Check size={14} />
                        用作工作区根目录
                      </button>
                    </div>
                  </div>
                </details>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {!collapsed ? (
        <div
          className="resize-handle"
          role="separator"
          aria-orientation="vertical"
          aria-label="拖拽调整左侧栏宽度"
          onMouseDown={() => {
            resizingRef.current = true;
          }}
        />
      ) : null}
    </aside>
  );
}

export function TopBar({
  onSearch,
  onSettingsOpen,
  theme,
  onThemeToggle,
  healthItems,
}: {
  onSearch: (query: string) => void;
  onSettingsOpen: () => void;
  theme: SciForgeConfig['theme'];
  onThemeToggle: () => void;
  healthItems: RuntimeHealthItem[];
}) {
  const [query, setQuery] = useState('');
  const healthProblems = healthItems.filter((item) => item.status === 'offline' || item.status === 'not-configured').length;
  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSearch(query);
  }
  return (
    <header className="topbar">
      <form className="searchbox" onSubmit={handleSubmit}>
        <Search size={15} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索基因、通路、文献、Execution Unit..." />
      </form>
      <div className="topbar-actions">
        <Badge variant={healthProblems ? 'warning' : 'success'} glow>
          Scenario Runtime · {healthProblems ? `${healthProblems} actions` : 'ready'}
        </Badge>
        <IconButton icon={(theme ?? 'dark') === 'dark' ? Sun : Moon} label={(theme ?? 'dark') === 'dark' ? '切换白天模式' : '切换黑夜模式'} onClick={onThemeToggle} />
        <IconButton icon={Settings} label="设置" onClick={onSettingsOpen} />
      </div>
    </header>
  );
}

export function SettingsDialog({
  config,
  onChange,
  saveState,
  onSave,
  onClose,
}: {
  config: SciForgeConfig;
  onChange: (patch: Partial<SciForgeConfig>) => void;
  saveState: ConfigSaveState;
  onSave: () => void;
  onClose: () => void;
}) {
  const healthItems = useRuntimeHealth(config);
  const peerInstances = config.peerInstances ?? [];
  const peerValidationErrors = validatePeerInstances(peerInstances);
  const updatePeerInstance = (index: number, patch: Partial<PeerInstance>) => {
    onChange({
      peerInstances: peerInstances.map((peer, peerIndex) => (peerIndex === index ? { ...peer, ...patch } : peer)),
    });
  };
  const addPeerInstance = () => {
    const existingNames = new Set(peerInstances.map((peer) => peer.name.trim().toLowerCase()).filter(Boolean));
    let suffix = peerInstances.length + 1;
    let name = `peer-${suffix}`;
    while (existingNames.has(name.toLowerCase())) {
      suffix += 1;
      name = `peer-${suffix}`;
    }
    onChange({
      peerInstances: [
        ...peerInstances,
        {
          name,
          appUrl: '',
          workspaceWriterUrl: '',
          workspacePath: '',
          role: 'peer',
          trustLevel: 'readonly',
          enabled: true,
        },
      ],
    });
  };
  const removePeerInstance = (index: number) => {
    onChange({ peerInstances: peerInstances.filter((_, peerIndex) => peerIndex !== index) });
  };
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="settings-dialog" role="dialog" aria-modal="true" aria-label="SciForge 设置" onMouseDown={(event) => event.stopPropagation()}>
        <div className="settings-head">
          <div>
            <h2>设置</h2>
            <p>统一配置 AgentServer、模型连接和本地 workspace。</p>
          </div>
          <IconButton icon={ChevronDown} label="关闭设置" onClick={onClose} />
        </div>
        <RuntimeHealthPanel items={healthItems} />
        <div className="settings-grid">
          <label>
            <span>界面主题</span>
            <select value={config.theme} onChange={(event) => onChange({ theme: event.target.value === 'light' ? 'light' : 'dark' })}>
              <option value="dark">黑夜</option>
              <option value="light">白天</option>
            </select>
          </label>
          <label>
            <span>AgentServer Base URL</span>
            <input value={config.agentServerBaseUrl} onChange={(event) => onChange({ agentServerBaseUrl: event.target.value })} />
          </label>
          <label>
            <span>Workspace Writer URL</span>
            <input value={config.workspaceWriterBaseUrl} onChange={(event) => onChange({ workspaceWriterBaseUrl: event.target.value })} />
          </label>
          <label className="wide">
            <span>Workspace Path</span>
            <input value={config.workspacePath} onChange={(event) => onChange({ workspacePath: event.target.value })} />
          </label>
          <div className="wide settings-peer-section">
            <div className="settings-peer-section-head">
              <span>Peer Instances</span>
              <ActionButton icon={Plus} variant="secondary" onClick={addPeerInstance}>新增 Peer</ActionButton>
            </div>
            {peerInstances.length ? (
              <div className="settings-peer-list">
                {peerInstances.map((peer, index) => (
                  <div className="settings-peer-card" key={`${peer.name}-${index}`}>
                    <label className="settings-check-row settings-peer-enabled">
                      <input
                        type="checkbox"
                        checked={peer.enabled}
                        onChange={(event) => updatePeerInstance(index, { enabled: event.target.checked })}
                      />
                      <span>{peer.enabled ? '启用' : '禁用'}</span>
                    </label>
                    <label>
                      <span>Name</span>
                      <input value={peer.name} onChange={(event) => updatePeerInstance(index, { name: event.target.value })} />
                    </label>
                    <label>
                      <span>Role</span>
                      <select value={peer.role} onChange={(event) => updatePeerInstance(index, { role: event.target.value as PeerInstance['role'] })}>
                        <option value="main">main</option>
                        <option value="repair">repair</option>
                        <option value="peer">peer</option>
                      </select>
                    </label>
                    <label>
                      <span>Trust Level</span>
                      <select value={peer.trustLevel} onChange={(event) => updatePeerInstance(index, { trustLevel: event.target.value as PeerInstance['trustLevel'] })}>
                        <option value="readonly">readonly</option>
                        <option value="repair">repair</option>
                        <option value="sync">sync</option>
                      </select>
                    </label>
                    <label>
                      <span>App URL</span>
                      <input value={peer.appUrl} onChange={(event) => updatePeerInstance(index, { appUrl: event.target.value })} placeholder="http://127.0.0.1:5173" />
                    </label>
                    <label>
                      <span>Workspace Writer URL</span>
                      <input value={peer.workspaceWriterUrl} onChange={(event) => updatePeerInstance(index, { workspaceWriterUrl: event.target.value })} placeholder="http://127.0.0.1:5174" />
                    </label>
                    <label className="settings-peer-path">
                      <span>Workspace Path</span>
                      <input value={peer.workspacePath} onChange={(event) => updatePeerInstance(index, { workspacePath: event.target.value })} />
                    </label>
                    <ActionButton icon={Trash2} variant="secondary" onClick={() => removePeerInstance(index)}>删除</ActionButton>
                  </div>
                ))}
              </div>
            ) : (
              <p className="settings-peer-empty">还没有配置 Peer Instance。</p>
            )}
            {peerValidationErrors.length ? (
              <div className="settings-validation" role="alert">
                {peerValidationErrors.map((error) => <p key={error}>{error}</p>)}
              </div>
            ) : null}
          </div>
          <label>
            <span>Agent Backend</span>
            <select value={config.agentBackend} onChange={(event) => onChange({ agentBackend: event.target.value })}>
              <option value="codex">Codex</option>
              <option value="openteam_agent">OpenTeam Agent</option>
              <option value="claude-code">Claude Code</option>
              <option value="hermes-agent">Hermes Agent</option>
              <option value="openclaw">OpenClaw</option>
              <option value="gemini">Gemini</option>
            </select>
          </label>
          <label>
            <span>Model Provider</span>
            <select value={config.modelProvider} onChange={(event) => onChange({ modelProvider: event.target.value })}>
              <option value="native">native user endpoint</option>
              <option value="openai-compatible">openai-compatible</option>
              <option value="openrouter">openrouter</option>
              <option value="qwen">qwen</option>
              <option value="codex-chatgpt">codex-chatgpt</option>
              <option value="gemini">gemini</option>
            </select>
          </label>
          <label>
            <span>Model Name</span>
            <input value={config.modelName} onChange={(event) => onChange({ modelName: event.target.value })} placeholder="gpt-5.4 / local-model / ..." />
          </label>
          <label>
            <span>Model Base URL</span>
            <input value={config.modelBaseUrl} onChange={(event) => onChange({ modelBaseUrl: event.target.value })} placeholder="https://.../v1" />
          </label>
          <label>
            <span>API Key</span>
            <input type="password" value={config.apiKey} onChange={(event) => onChange({ apiKey: event.target.value })} placeholder="stored in local config.json" />
          </label>
          <label>
            <span>Timeout ms</span>
            <input
              type="number"
              min={30000}
              step={10000}
              value={config.requestTimeoutMs}
              onChange={(event) => onChange({ requestTimeoutMs: Number(event.target.value) })}
            />
          </label>
          <label>
            <span>Max Context Window (k tokens)</span>
            <input
              type="number"
              min={1}
              step={1}
              value={Math.round(config.maxContextWindowTokens / 1000)}
              onChange={(event) => onChange({ maxContextWindowTokens: Number(event.target.value) * 1000 })}
            />
          </label>
          <label className="wide settings-check-row">
            <input
              type="checkbox"
              checked={config.visionAllowSharedSystemInput}
              onChange={(event) => onChange({ visionAllowSharedSystemInput: event.target.checked })}
            />
            <span>默认允许 vision-sense 使用共享系统鼠标/键盘</span>
          </label>
          <label className="wide">
            <span>反馈 GitHub 仓库</span>
            <input
              value={config.feedbackGithubRepo ?? ''}
              onChange={(event) => onChange({ feedbackGithubRepo: event.target.value.trim() || undefined })}
              placeholder="默认 AGI4Sci/SciForge；可改为 fork 或完整 https://github.com/… URL"
            />
          </label>
          <label className="wide">
            <span>反馈 GitHub Token（可选）</span>
            <input
              type="password"
              autoComplete="off"
              value={config.feedbackGithubToken ?? ''}
              onChange={(event) => onChange({ feedbackGithubToken: event.target.value.trim() || undefined })}
              placeholder="classic PAT 或 fine-grained PAT（需 Issues 读写；仅存本地）"
            />
          </label>
        </div>
        <div className="settings-save-state" role="status">
          <span className={cx('status-dot', saveState.status === 'error' ? 'offline' : saveState.status === 'saving' ? 'optional' : 'online')} />
          <span>
            {settingsSaveStateText(saveState)}
            {' '}
            下一次 AgentServer 请求会使用当前模型：
            {' '}
            <code>{config.agentBackend}</code>
            <strong>{config.modelProvider || 'native'}</strong>
            {config.modelName.trim() ? <code>{config.modelName.trim()}</code> : <em>user model not set</em>}
          </span>
          <ActionButton icon={Save} variant="primary" onClick={onSave} disabled={saveState.status === 'saving' || peerValidationErrors.length > 0}>
            {saveState.status === 'saving' ? '保存中' : '保存并生效'}
          </ActionButton>
          <ActionButton icon={RefreshCw} variant="secondary" onClick={() => window.location.reload()}>重新检测连接</ActionButton>
        </div>
      </section>
    </div>
  );
}

export type { ConfigSaveState } from './settingsModels';
