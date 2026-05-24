import { useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { Archive, ArrowDown, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronsDown, ChevronsUp, Clock, Copy, Edit3, File, FileCode, FilePlus, FileText, Folder, FolderOpen, FolderPlus, MessageSquare, MoreHorizontal, Moon, PanelTopOpen, Pin, Plug, Plus, RefreshCw, Save, Search, Settings, Square, Sun, Workflow } from 'lucide-react';
import { navItems, scenarios, sidebarViewNavItems, type PageId } from '../../data';
import { normalizeWorkspaceRootPath } from '../../config';
import type { SciForgeConfig, SciForgeSession, ScenarioInstanceId } from '../../domain';
import { listWorkspace, mutateWorkspaceFile, openWorkspaceObject, readWorkspaceFile, writeWorkspaceFile, type WorkspaceEntry, type WorkspaceFileContent } from '../../api/workspaceClient';
import { Badge, IconButton, cx } from '../uiPrimitives';
import type { RuntimeHealthItem } from '../runtimeHealthPanel';
import {
  explorerWorkspaceRoot,
  formatBytes,
  parentPath,
  pathBasename,
  sortWorkspaceEntries,
  syntheticFolderEntry,
  toWorkspaceRelativePath,
  workspaceActionSuccessMessage,
  workspaceActions,
  workspaceNeedsOnboarding,
  workspaceOnboardingError,
  type WorkspaceAction,
} from './explorerModels';
import {
  loadSidebarPreferences,
  moveCurrentProjectDown,
  saveSidebarPreferences,
  togglePinnedThreadId,
  type SidebarLayoutMode,
  type SidebarPreferences,
  type SidebarSortMode,
} from './sidebarPreferences';
import { resolveWorkspaceDirectoryPath } from './workspaceDirectoryPicker';
import {
  SIDEBAR_CHRONOLOGICAL_PROJECT_ID,
  buildConfiguredSidebarProjects,
  migrateLegacySidebarProjectId,
  sidebarProjectPath,
} from './sidebarProjectModel';
import { resolveSidebarProjectSessionBundle } from './sidebarProjectSessions';
export { SettingsPage } from './SettingsPage';
export { SettingsDialog } from './ShellPanelsSettingsDialog';

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

export interface SidebarThreadItem {
  sessionId: string;
  scenarioId: ScenarioInstanceId;
  title: string;
  detail: string;
  updatedAt: string;
}

export interface SidebarProjectThreadGroup {
  id: string;
  label: string;
  detail: string;
  current: boolean;
  threads: SidebarThreadItem[];
}

export interface SidebarSearchMatch {
  id: string;
  label: string;
  detail: string;
  page: PageId;
  scenarioId?: ScenarioInstanceId;
}

const SIDEBAR_PROJECT_THREAD_LIMIT = 4;
const SIDEBAR_RECENT_PROJECT_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

export interface SidebarThreadBuildOptions {
  sort?: SidebarSortMode;
  pinnedThreadIds?: string[];
  limit?: number;
}

export interface SidebarProjectBuildOptions extends SidebarThreadBuildOptions {
  layout?: SidebarLayoutMode;
  projectOrder?: string[];
  activeWorkspacePath?: string;
  projectSessionsByPath?: Record<string, {
    sessionsByScenario: Partial<Record<ScenarioInstanceId, SciForgeSession>>;
    archivedSessions?: SciForgeSession[];
  }>;
}
type SidebarProjectMenu =
  | { kind: 'global' }
  | { kind: 'create' }
  | { kind: 'project'; projectId: string };

export function sidebarSessionActivityScore(session: SciForgeSession) {
  const nonSeedMessages = session.messages.filter((message) => !message.id.startsWith('seed')).length;
  return nonSeedMessages
    + session.runs.length
    + session.artifacts.length
    + session.executionUnits.length
    + session.notebook.length;
}

export function sidebarThreadTitle(session: SciForgeSession) {
  const title = compactSidebarLine(session.title, 44);
  if (title && !isEvidenceLikeThreadTitle(title)) return title;
  const firstUserPrompt = session.messages.find((message) => message.role === 'user' && !message.id.startsWith('seed'))?.content;
  const promptTitle = compactSidebarLine(firstUserPrompt || '', 44);
  if (promptTitle && !isEvidenceLikeThreadTitle(promptTitle)) return promptTitle;
  return '未命名聊天';
}

export function buildSidebarThreadItems(
  sessionsByScenario: Partial<Record<ScenarioInstanceId, SciForgeSession>>,
  archivedSessions?: SciForgeSession[],
  options: SidebarThreadBuildOptions = {},
): SidebarThreadItem[] {
  const sort = options.sort ?? 'updatedAt';
  const pinned = new Set(options.pinnedThreadIds ?? []);
  const limit = options.limit ?? 8;
  const pool: SciForgeSession[] = Object.values(sessionsByScenario).filter((s): s is SciForgeSession => Boolean(s));
  if (archivedSessions) {
    const activeIds = new Set(pool.map((s) => s.sessionId));
    for (const session of archivedSessions) {
      if (!activeIds.has(session.sessionId)) pool.push(session);
    }
  }
  const items = pool
    .filter((session) => sidebarSessionActivityScore(session) > 0)
    .map((session) => ({
      sessionId: session.sessionId,
      scenarioId: session.scenarioId,
      title: sidebarThreadTitle(session),
      detail: sidebarThreadDetail(session),
      updatedAt: session.updatedAt || session.createdAt,
      createdAt: session.createdAt,
      pinned: pinned.has(session.sessionId),
    }));
  items.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    const left = sort === 'createdAt' ? Date.parse(a.createdAt) : Date.parse(a.updatedAt);
    const right = sort === 'createdAt' ? Date.parse(b.createdAt) : Date.parse(b.updatedAt);
    return right - left;
  });
  return items.slice(0, limit).map(({ pinned: _pinned, createdAt: _createdAt, ...item }) => item);
}

export function buildSidebarArchivedThreadItems(
  archivedSessions: SciForgeSession[],
  options: SidebarThreadBuildOptions = {},
): SidebarThreadItem[] {
  const sort = options.sort ?? 'updatedAt';
  const pinned = new Set(options.pinnedThreadIds ?? []);
  const items = archivedSessions
    .filter((session) => sidebarSessionActivityScore(session) > 0)
    .map((session) => ({
      sessionId: session.sessionId,
      scenarioId: session.scenarioId,
      title: sidebarThreadTitle(session),
      detail: sidebarThreadDetail(session),
      updatedAt: session.updatedAt || session.createdAt,
      createdAt: session.createdAt,
      pinned: pinned.has(session.sessionId),
    }));
  items.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    const left = sort === 'createdAt' ? Date.parse(a.createdAt) : Date.parse(a.updatedAt);
    const right = sort === 'createdAt' ? Date.parse(b.createdAt) : Date.parse(b.updatedAt);
    return right - left;
  });
  return items.map(({ pinned: _pinned, createdAt: _createdAt, ...item }) => item);
}

export function buildSidebarProjectThreadGroups(
  config: SciForgeConfig,
  sessionsByScenario: Partial<Record<ScenarioInstanceId, SciForgeSession>>,
  archivedSessions?: SciForgeSession[],
  options: SidebarProjectBuildOptions = {},
): SidebarProjectThreadGroup[] {
  const layout = options.layout ?? 'by-project';
  const threadLimit = layout === 'chronological' ? 12 : 8;
  const threadItems = buildSidebarThreadItems(sessionsByScenario, archivedSessions, {
    sort: options.sort,
    pinnedThreadIds: options.pinnedThreadIds,
    limit: threadLimit,
  });
  if (layout === 'chronological') {
    return [{
      id: SIDEBAR_CHRONOLOGICAL_PROJECT_ID,
      label: '全部对话',
      detail: config.workspacePath,
      current: true,
      threads: threadItems,
    }];
  }
  let projects = buildConfiguredSidebarProjects(config);
  if (layout === 'recent-projects') {
    const recentCutoff = Date.now() - SIDEBAR_RECENT_PROJECT_WINDOW_MS;
    projects = projects.filter((project) => {
      if (!project.current) return false;
      return threadItems.some((thread) => Date.parse(thread.updatedAt) >= recentCutoff);
    });
    if (!projects.length) projects = buildConfiguredSidebarProjects(config).filter((project) => project.current);
  }
  if (options.projectOrder?.length) {
    const rank = new Map(options.projectOrder.map((id, index) => [
      migrateLegacySidebarProjectId(config, id),
      index,
    ]));
    projects = [...projects].sort((left, right) => (rank.get(left.id) ?? 999) - (rank.get(right.id) ?? 999));
  }
  return projects.map((project) => {
    const projectPath = sidebarProjectPath(project.detail);
    const { sessionsByScenario: projectSessions, archivedSessions: projectArchived } = resolveSidebarProjectSessionBundle(
      projectPath,
      options.activeWorkspacePath ?? config.workspacePath,
      sessionsByScenario,
      archivedSessions,
      options.projectSessionsByPath,
    );
    const threads = buildSidebarThreadItems(projectSessions, projectArchived, {
      sort: options.sort,
      pinnedThreadIds: options.pinnedThreadIds,
      limit: threadLimit,
    });
    return { ...project, threads };
  });
}

export function buildSidebarSearchMatches(
  query: string,
  sessionsByScenario: Partial<Record<ScenarioInstanceId, SciForgeSession>>,
  archivedSessions?: SciForgeSession[],
): SidebarSearchMatch[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  const matches: SidebarSearchMatch[] = [];

  for (const item of navItems) {
    if (containsNeedle(`${item.label} ${item.id}`, needle)) {
      matches.push({ id: `page:${item.id}`, label: item.label, detail: '页面', page: item.id });
    }
  }
  for (const scenario of scenarios) {
    const haystack = `${scenario.name} ${scenario.domain} ${scenario.desc} ${scenario.tools.join(' ')}`;
    if (containsNeedle(haystack, needle)) {
      matches.push({
        id: `scenario:${scenario.id}`,
        label: scenario.name,
        detail: '聊天场景',
        page: 'workbench',
        scenarioId: scenario.id,
      });
    }
  }
  for (const thread of buildSidebarThreadItems(sessionsByScenario, archivedSessions)) {
    if (containsNeedle(`${thread.title} ${thread.detail} ${thread.scenarioId}`, needle)) {
      matches.push({
        id: `thread:${thread.sessionId}`,
        label: thread.title,
        detail: thread.detail,
        page: 'workbench',
        scenarioId: thread.scenarioId,
      });
    }
  }

  return uniqueSidebarMatches(matches).slice(0, 8);
}

function compactSidebarLine(value: string | undefined, maxLength: number) {
  const compact = (value ?? '').replace(/\s+/g, ' ').trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function isEvidenceLikeThreadTitle(title: string) {
  return /^(artifact|file|folder|run|execution-unit|stdout|stderr|trace|log|debug):/i.test(title)
    || /^[a-z][a-z0-9+.-]*:\/\//i.test(title)
    || /\.(jsonl?|log|stdout|stderr)$/i.test(title)
    || containsSidebarInternalTerm(title);
}

function sidebarThreadDetail(session: SciForgeSession) {
  const latestMessage = [...session.messages].reverse().find((message) => !message.id.startsWith('seed'));
  if (latestMessage) {
    const snippet = sidebarUserSemanticSnippet(latestMessage.content);
    if (snippet) {
      if (latestMessage.role === 'user') return `最近提问：${snippet}`;
      if (latestMessage.role === 'scenario') return `最近回答：${snippet}`;
      return `最近更新：${snippet}`;
    }
    return latestMessage.role === 'user' ? '最近有新提问' : '最近有新进展';
  }
  if (session.runs.length || session.artifacts.length || session.executionUnits.length || session.notebook.length) return '有结果可继续';
  return '新聊天';
}

function containsNeedle(value: string, needle: string) {
  return value.toLocaleLowerCase().includes(needle);
}

function sidebarUserSemanticSnippet(value: string | undefined) {
  const compact = compactSidebarLine((value ?? '').replace(/[`*_>#\-\[\]()]/g, ' '), 36);
  if (!compact || containsSidebarInternalTerm(compact)) return '';
  return compact;
}

function containsSidebarInternalTerm(value: string) {
  return /\b(?:ExecutionUnit|execution-unit|provider|model|profile|runtime\s+codex|live-runtime-codex|native-message|raw\s+JSONL|stdout|stderr|ConversationProjection|ArtifactDelivery|codex-command|run\s+id|workspace\s+command)\b/i.test(value)
    || /\brun-[a-z0-9][a-z0-9_-]*\b/i.test(value);
}

function uniqueSidebarMatches(matches: SidebarSearchMatch[]) {
  const seen = new Set<string>();
  return matches.filter((match) => {
    if (seen.has(match.id)) return false;
    seen.add(match.id);
    return true;
  });
}

function conciseWorkspaceOnboardingReason(path: string, workspaceError: string, workspaceStatus: string) {
  if (!path.trim()) return '还没有项目。选择项目路径后会显示文件。';
  const diagnostic = `${workspaceError} ${workspaceStatus}`;
  if (/EACCES|EPERM|permission|权限/i.test(diagnostic)) return '无法读取当前项目；请检查权限。';
  if (/ENOENT|not found|未找到/i.test(diagnostic)) return '未找到项目工作区。';
  return '项目尚未初始化。';
}

export function Sidebar({
  page,
  setPage,
  scenarioId,
  setScenarioId,
  config,
  sessionsByScenario,
  archivedSessions,
  onNewChat,
  onRestoreArchivedSession,
  onArchiveThread,
  onArchiveAllChats,
  onSearchNavigate,
  onSettingsOpen,
  workspaceStatus,
  onWorkspacePathChange,
  onWorkspaceProjectActivate,
  projectSessionsByPath,
  activeWorkspacePath,
  deferWorkbenchFilePreview,
  onWorkbenchFileOpened,
  workbenchEditorFilePath,
  onWorkbenchEditorPathInvalidated,
}: {
  page: PageId;
  setPage: (page: PageId) => void;
  scenarioId: ScenarioInstanceId;
  setScenarioId: (id: ScenarioInstanceId) => void;
  config: SciForgeConfig;
  sessionsByScenario?: Record<ScenarioInstanceId, SciForgeSession>;
  archivedSessions?: SciForgeSession[];
  onNewChat?: (scenarioId: ScenarioInstanceId) => void;
  onRestoreArchivedSession?: (scenarioId: ScenarioInstanceId, sessionId: string) => void;
  onArchiveThread?: (scenarioId: ScenarioInstanceId, sessionId: string) => void;
  onArchiveAllChats?: () => void;
  onSearchNavigate?: (query: string) => void;
  onSettingsOpen?: () => void;
  workspaceStatus: string;
  onWorkspacePathChange: (value: string) => void;
  onWorkspaceProjectActivate?: (
    project: SidebarProjectThreadGroup,
    thread?: Pick<SidebarThreadItem, 'scenarioId' | 'sessionId'>,
  ) => void;
  projectSessionsByPath?: Record<string, {
    sessionsByScenario: Partial<Record<ScenarioInstanceId, SciForgeSession>>;
    archivedSessions?: SciForgeSession[];
  }>;
  activeWorkspacePath?: string;
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
  const [sidebarSearchQuery, setSidebarSearchQuery] = useState('');
  const [expandedProjectThreads, setExpandedProjectThreads] = useState<Set<string>>(() => new Set());
  const [allProjectThreadsCollapsed, setAllProjectThreadsCollapsed] = useState(false);
  const [sidebarProjectMenu, setSidebarProjectMenu] = useState<SidebarProjectMenu | null>(null);
  const [sidebarPreferences, setSidebarPreferences] = useState<SidebarPreferences>(() => loadSidebarPreferences());
  const [showArchivedPanel, setShowArchivedPanel] = useState(false);
  const folderPickerRef = useRef<HTMLDetailsElement | null>(null);
  const resizingRef = useRef(false);
  const sidebarSessions: Partial<Record<ScenarioInstanceId, SciForgeSession>> = sessionsByScenario ?? {};
  const sidebarArchivedSessions = archivedSessions ?? [];
  const sidebarSearchMatches = useMemo(
    () => buildSidebarSearchMatches(sidebarSearchQuery, sidebarSessions, sidebarArchivedSessions),
    [sidebarSearchQuery, sidebarSessions, sidebarArchivedSessions],
  );
  const sidebarProjectThreadGroups = useMemo(
    () => buildSidebarProjectThreadGroups(config, sidebarSessions, sidebarArchivedSessions, {
      layout: sidebarPreferences.layout,
      sort: sidebarPreferences.sort,
      pinnedThreadIds: sidebarPreferences.pinnedThreadIds,
      projectOrder: sidebarPreferences.projectOrder,
      projectSessionsByPath,
      activeWorkspacePath,
    }),
    [config, sidebarSessions, sidebarArchivedSessions, sidebarPreferences, projectSessionsByPath, activeWorkspacePath],
  );
  const sidebarArchivedThreadItems = useMemo(
    () => buildSidebarArchivedThreadItems(sidebarArchivedSessions, {
      sort: sidebarPreferences.sort,
      pinnedThreadIds: sidebarPreferences.pinnedThreadIds,
      limit: 12,
    }),
    [sidebarArchivedSessions, sidebarPreferences],
  );
  const pinnedThreadIds = useMemo(() => new Set(sidebarPreferences.pinnedThreadIds), [sidebarPreferences.pinnedThreadIds]);
  const archivedThreadCount = useMemo(
    () => sidebarArchivedSessions.filter((session) => sidebarSessionActivityScore(session) > 0).length,
    [sidebarArchivedSessions],
  );
  const showWorkbenchNav = page === 'workbench';
  const sidebarExpanded = showWorkbenchNav && !collapsed;

  useEffect(() => {
    if (page !== 'workbench') {
      setCollapsed(true);
    }
  }, [page]);

  useEffect(() => {
    if (!sidebarExpanded) return;
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
  }, [sidebarExpanded]);

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
    if (!sidebarExpanded || !workspaceRoot) return;
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
  }, [sidebarExpanded, workspaceRoot, config.workspaceWriterBaseUrl, config.workspacePath]);

  useEffect(() => {
    if (!contextMenu) return;
    function closeMenu() {
      setContextMenu(null);
    }
    window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, [contextMenu]);

  useEffect(() => {
    if (!sidebarProjectMenu) return;
    function closeMenu() {
      setSidebarProjectMenu(null);
    }
    window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, [sidebarProjectMenu]);

  useEffect(() => {
    if (!sidebarProjectMenu) return;
    function closeMenu() {
      setSidebarProjectMenu(null);
    }
    window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, [sidebarProjectMenu]);

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
    if (action === workspaceActions.createFile) {
      const name = window.prompt('新文件名', 'notes.md');
      if (!name) return;
      targetPath = `${basePath.replace(/\/+$/, '')}/${name}`;
    } else if (action === workspaceActions.createFolder) {
      const name = window.prompt('新文件夹名', 'new-folder');
      if (!name) return;
      targetPath = `${basePath.replace(/\/+$/, '')}/${name}`;
    } else if (action === workspaceActions.rename) {
      if (!entry) return;
      const name = window.prompt('重命名为', entry.name);
      if (!name || name === entry.name) return;
      renameTarget = `${entry.path.slice(0, -entry.name.length)}${name}`;
    } else if (action === workspaceActions.delete) {
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
      setWorkspaceError('请先填写项目路径。');
      return;
    }
    try {
      setWorkspaceError('');
      setWorkspaceNotice('正在创建 SciForge 项目工作区...');
      await mutateWorkspaceFile(config, workspaceActions.createFolder, { path: root });
      await mutateWorkspaceFile(config, workspaceActions.createFolder, { path: `${root.replace(/\/+$/, '')}/.sciforge` });
      for (const resource of ['tasks', 'logs', 'task-results', 'scenarios', 'exports', 'artifacts', 'sessions', 'versions']) {
        await mutateWorkspaceFile(config, workspaceActions.createFolder, { path: `${root.replace(/\/+$/, '')}/.sciforge/${resource}` });
      }
      await refreshExplorer();
      setWorkspaceNotice('SciForge 项目工作区已创建；可以导入 package 或运行场景。');
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

  function handleNewChat() {
    setScenarioId(scenarioId);
    setPage('workbench');
    onNewChat?.(scenarioId);
  }

  function toggleSidebarProjectMenu(menu: SidebarProjectMenu, event: ReactMouseEvent) {
    event.stopPropagation();
    setSidebarProjectMenu((current) => {
      if (!current || current.kind !== menu.kind) return menu;
      if (current.kind === 'project' && menu.kind === 'project' && current.projectId !== menu.projectId) return menu;
      return null;
    });
  }

  function closeSidebarProjectMenuWithNotice(message: string) {
    setSidebarProjectMenu(null);
    setWorkspaceNotice(message);
  }

  function updateSidebarPreferences(next: SidebarPreferences | ((current: SidebarPreferences) => SidebarPreferences), message?: string) {
    setSidebarPreferences((current) => {
      const resolved = typeof next === 'function' ? next(current) : next;
      saveSidebarPreferences(resolved);
      return resolved;
    });
    setSidebarProjectMenu(null);
    if (message) setWorkspaceNotice(message);
  }

  function applySidebarLayout(layout: SidebarLayoutMode) {
    updateSidebarPreferences((current) => ({ ...current, layout }), layout === 'by-project'
      ? '已按项目整理侧边栏。'
      : layout === 'recent-projects'
        ? '已切换到近期项目视图。'
        : '已切换到按时间顺序视图。');
  }

  function applySidebarSort(sort: SidebarSortMode) {
    updateSidebarPreferences((current) => ({ ...current, sort }), sort === 'createdAt' ? '已按创建时间排序。' : '已按更新时间排序。');
  }

  function moveCurrentProjectDownInSidebar() {
    const currentProject = sidebarProjectThreadGroups.find((project) => project.current);
    if (!currentProject) {
      closeSidebarProjectMenuWithNotice('当前没有可下移的项目。');
      return;
    }
    updateSidebarPreferences(
      (current) => moveCurrentProjectDown(current, sidebarProjectThreadGroups.map((project) => project.id), currentProject.id),
      `已将 ${currentProject.label} 下移。`,
    );
  }

  function toggleSidebarThreadPin(item: SidebarThreadItem) {
    updateSidebarPreferences(
      (current) => togglePinnedThreadId(current, item.sessionId),
      pinnedThreadIds.has(item.sessionId) ? `已取消置顶：${item.title}` : `已置顶：${item.title}`,
    );
  }

  function archiveSidebarThread(item: SidebarThreadItem) {
    setSidebarProjectMenu(null);
    const activeSession = sidebarSessions[item.scenarioId];
    if (activeSession?.sessionId === item.sessionId) {
      onArchiveThread?.(item.scenarioId, item.sessionId);
      setWorkspaceNotice(`已归档对话：${item.title}`);
      return;
    }
    setWorkspaceNotice(`「${item.title}」已在归档列表中。`);
  }

  function archiveAllSidebarChats() {
    setSidebarProjectMenu(null);
    onArchiveAllChats?.();
    setWorkspaceNotice('已归档所有活跃聊天。');
  }

  async function chooseWorkspaceRootPath() {
    try {
      setWorkspaceError('');
      setWorkspaceNotice('正在打开文件夹选择器…');
      const picked = await resolveWorkspaceDirectoryPath(config, pathEditDraft.trim() || config.workspacePath);
      if (!picked) {
        setWorkspaceNotice('');
        return;
      }
      setPathEditDraft(picked);
      onWorkspacePathChange(picked);
      setWorkspaceNotice(`已选择项目文件夹：${pathBasename(picked) || picked}`);
    } catch (err) {
      setWorkspaceError(err instanceof Error ? err.message : String(err));
      setWorkspaceNotice('');
    }
  }

  function toggleAllProjectThreadsCollapsed() {
    setAllProjectThreadsCollapsed((current) => {
      const next = !current;
      if (next) {
        setExpandedProjectThreads(new Set());
      } else {
        setExpandedProjectThreads(new Set(sidebarProjectThreadGroups.map((project) => project.id)));
      }
      setSidebarProjectMenu(null);
      return next;
    });
  }

  function activateSidebarProject(
    project: SidebarProjectThreadGroup,
    thread?: Pick<SidebarThreadItem, 'scenarioId' | 'sessionId'>,
  ) {
    if (project.current) {
      if (thread) openSidebarThread(thread, project);
      return;
    }
    setSidebarProjectMenu(null);
    onWorkspaceProjectActivate?.(project, thread);
    setPage('workbench');
    setAllProjectThreadsCollapsed(false);
    setExpandedProjectThreads(new Set([project.id]));
    setWorkspaceNotice(`已切换到项目 ${project.label}`);
  }

  function openProjectNewChat(project: SidebarProjectThreadGroup) {
    setSidebarProjectMenu(null);
    if (!project.current) {
      activateSidebarProject(project);
    }
    handleNewChat();
  }

  async function revealSidebarProject(project: SidebarProjectThreadGroup) {
    setSidebarProjectMenu(null);
    if (!project.detail) return;
    try {
      setWorkspaceError('');
      await openWorkspaceObject(config, 'reveal-in-folder', project.detail, config.workspacePath);
      setWorkspaceNotice(`已在访达中定位 ${project.label}`);
    } catch (err) {
      setWorkspaceError(err instanceof Error ? err.message : String(err));
      setWorkspaceNotice('');
    }
  }

  function renderSidebarProjectGlobalMenu() {
    const { layout, sort } = sidebarPreferences;
    return (
      <div className="sidebar-project-menu" role="menu" onClick={(event) => event.stopPropagation()}>
        <button type="button" role="menuitem" onClick={() => archiveAllSidebarChats()}>
          <Archive size={14} aria-hidden />
          <span>归档所有聊天</span>
        </button>
        <div className="sidebar-project-menu-group">
          <button type="button" role="menuitem" aria-haspopup="menu">
            <Folder size={14} aria-hidden />
            <span>整理侧边栏</span>
            <ChevronRight size={13} aria-hidden />
          </button>
          <div className="sidebar-project-submenu" role="menu" aria-label="整理侧边栏">
            <button type="button" onClick={() => applySidebarLayout('by-project')}>
              <Folder size={14} aria-hidden />
              <span>按项目</span>
              {layout === 'by-project' ? <Check size={13} aria-hidden /> : <span aria-hidden />}
            </button>
            <button type="button" onClick={() => applySidebarLayout('recent-projects')}>
              <FolderOpen size={14} aria-hidden />
              <span>近期项目</span>
              {layout === 'recent-projects' ? <Check size={13} aria-hidden /> : <span aria-hidden />}
            </button>
            <button type="button" onClick={() => applySidebarLayout('chronological')}>
              <Clock size={14} aria-hidden />
              <span>按时间顺序</span>
              {layout === 'chronological' ? <Check size={13} aria-hidden /> : <span aria-hidden />}
            </button>
            <button type="button" onClick={() => moveCurrentProjectDownInSidebar()}>
              <ArrowDown size={14} aria-hidden />
              <span>下移</span>
            </button>
          </div>
        </div>
        <div className="sidebar-project-menu-group">
          <button type="button" role="menuitem" aria-haspopup="menu">
            <Clock size={14} aria-hidden />
            <span>排序条件</span>
            <ChevronRight size={13} aria-hidden />
          </button>
          <div className="sidebar-project-submenu" role="menu" aria-label="排序条件">
            <button type="button" onClick={() => applySidebarSort('createdAt')}>
              <Clock size={14} aria-hidden />
              <span>创建时间</span>
              {sort === 'createdAt' ? <Check size={13} aria-hidden /> : <span aria-hidden />}
            </button>
            <button type="button" onClick={() => applySidebarSort('updatedAt')}>
              <Clock size={14} aria-hidden />
              <span>更新时间</span>
              {sort === 'updatedAt' ? <Check size={13} aria-hidden /> : <span aria-hidden />}
            </button>
          </div>
        </div>
      </div>
    );
  }

  function renderSidebarProjectCreateMenu() {
    return (
      <div className="sidebar-project-menu sidebar-project-menu-create" role="menu" onClick={(event) => event.stopPropagation()}>
        <button type="button" role="menuitem" onClick={() => closeSidebarProjectMenuWithNotice('新建空白项目需要先选择工作区路径。')}>
          <FolderPlus size={14} aria-hidden />
          <span>新建空白项目</span>
        </button>
        <button type="button" role="menuitem" onClick={() => {
          setSidebarProjectMenu(null);
          void chooseWorkspaceRootPath();
        }}>
          <FolderOpen size={14} aria-hidden />
          <span>使用现有文件夹</span>
        </button>
      </div>
    );
  }

  function renderSidebarProjectActionMenu(project: SidebarProjectThreadGroup) {
    return (
      <div className="sidebar-project-menu sidebar-project-menu-project" role="menu" onClick={(event) => event.stopPropagation()}>
        <button type="button" role="menuitem" onClick={() => closeSidebarProjectMenuWithNotice(`已请求置顶项目 ${project.label}。`)}>
          <Pin size={14} aria-hidden />
          <span>置顶项目</span>
        </button>
        <button type="button" role="menuitem" onClick={() => void revealSidebarProject(project)}>
          <FolderOpen size={14} aria-hidden />
          <span>在“访达”中打开</span>
        </button>
        <button type="button" role="menuitem" onClick={() => closeSidebarProjectMenuWithNotice('创建永久工作树稍后接入。')}>
          <ArrowDown size={14} aria-hidden />
          <span>创建永久工作树</span>
        </button>
        <button type="button" role="menuitem" onClick={() => closeSidebarProjectMenuWithNotice('重命名项目稍后接入。')}>
          <Edit3 size={14} aria-hidden />
          <span>重命名项目</span>
        </button>
        <button type="button" role="menuitem" onClick={() => archiveProjectChats(project)}>
          <Archive size={14} aria-hidden />
          <span>归档对话</span>
        </button>
        <button type="button" role="menuitem" onClick={() => closeSidebarProjectMenuWithNotice('移除项目稍后接入。')}>
          <Square size={14} aria-hidden />
          <span>移除</span>
        </button>
      </div>
    );
  }

  function archiveProjectChats(project: SidebarProjectThreadGroup) {
    setSidebarProjectMenu(null);
    if (!project.current) {
      setWorkspaceNotice('只能归档当前项目的对话。');
      return;
    }
    const active = sidebarSessions[scenarioId];
    if (active && sidebarSessionActivityScore(active) > 0) {
      onArchiveThread?.(scenarioId, active.sessionId);
      setWorkspaceNotice(`已归档 ${project.label} 的对话。`);
      return;
    }
    setWorkspaceNotice(`${project.label} 没有可归档的活跃对话。`);
  }

  function renderSidebarThreadRow(item: SidebarThreadItem, project: SidebarProjectThreadGroup) {
    const projectPath = sidebarProjectPath(project.detail);
    const liveWorkspacePath = sidebarProjectPath(activeWorkspacePath || config.workspacePath);
    const isActive = projectPath === liveWorkspacePath
      && item.scenarioId === scenarioId
      && item.sessionId === sidebarSessions[scenarioId]?.sessionId;
    const isPinned = pinnedThreadIds.has(item.sessionId);
    return (
      <div key={`${project.id}:${item.sessionId}`} className={cx('sidebar-thread-row', isActive && 'active', isPinned && 'pinned')}>
        <button type="button" className="sidebar-thread-main" onClick={() => openSidebarThread(item, project)}>
          {isPinned ? <Pin size={14} className="sidebar-thread-pin-icon" aria-hidden /> : <MessageSquare size={15} aria-hidden />}
          <span className="sidebar-thread-title">{item.title}</span>
          <small className="sidebar-thread-detail">{item.detail}</small>
        </button>
        <div className="sidebar-thread-actions" aria-label={`${item.title} 对话操作`}>
          <button
            type="button"
            className={cx('sidebar-project-icon-btn', isPinned && 'active')}
            onClick={() => toggleSidebarThreadPin(item)}
            title={isPinned ? '取消置顶' : '置顶对话'}
            aria-label={isPinned ? `取消置顶：${item.title}` : `置顶对话：${item.title}`}
          >
            <Pin size={13} />
          </button>
          <button
            type="button"
            className="sidebar-project-icon-btn"
            onClick={() => archiveSidebarThread(item)}
            title="归档对话"
            aria-label={`归档对话：${item.title}`}
          >
            <Archive size={13} />
          </button>
        </div>
      </div>
    );
  }

  function openSidebarSearchMatch(match: SidebarSearchMatch) {
    if (match.scenarioId) setScenarioId(match.scenarioId);
    setPage(match.page);
  }

  function handleSidebarSearchSubmit(event: FormEvent) {
    event.preventDefault();
    const firstMatch = sidebarSearchMatches[0];
    if (firstMatch) {
      openSidebarSearchMatch(firstMatch);
      return;
    }
    const query = sidebarSearchQuery.trim();
    if (query) onSearchNavigate?.(query);
  }

  function openSidebarThread(item: SidebarThreadItem, project: SidebarProjectThreadGroup) {
    if (!project.current) {
      activateSidebarProject(project, item);
      return;
    }
    const activeSession = sidebarSessions[item.scenarioId];
    if (activeSession?.sessionId !== item.sessionId) {
      onRestoreArchivedSession?.(item.scenarioId, item.sessionId);
    }
    setScenarioId(item.scenarioId);
    setPage('workbench');
  }

  function toggleProjectThreadExpansion(projectId: string) {
    setAllProjectThreadsCollapsed(false);
    setExpandedProjectThreads((current) => {
      const next = new Set(current);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
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
    <aside className={cx('sidebar', !sidebarExpanded && 'collapsed')} style={{ width: sidebarExpanded ? sidebarWidth : 46 }}>
      <div className="sidebar-activitybar" aria-label="工作区视图">
        <div className="brand">
          <div className="brand-mark">BA</div>
        </div>
        <div className="sidebar-activitybar-nav">
          {sidebarViewNavItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={cx('activity-item', page === item.id && 'active')}
              onClick={() => {
                setPage(item.id);
                if (item.id === 'workbench') {
                  setCollapsed(false);
                }
              }}
              title={item.label}
              aria-label={item.label}
              aria-current={page === item.id ? 'page' : undefined}
            >
              <item.icon size={18} />
            </button>
          ))}
        </div>
        <div className="sidebar-activitybar-spacer" aria-hidden />
        {showWorkbenchNav && collapsed ? (
          <button type="button" className="collapse-button top-toggle" onClick={() => setCollapsed(false)} title="展开侧栏" aria-label="展开侧栏">
            <ChevronRight size={16} />
          </button>
        ) : null}
      </div>

      {showWorkbenchNav && !collapsed ? (
        <div className="sidebar-panel">
          <div className="sidebar-panel-header">
            <span>导航</span>
            <button className="panel-collapse-button" onClick={() => setCollapsed(true)} title="收起侧栏" aria-label="收起侧栏">
              <ChevronLeft size={16} />
            </button>
          </div>
          <div className="sidebar-panel-body">
            <div className="sidebar-scroll">
              <section className="sidebar-section sidebar-section-actions" aria-label="主操作">
                <button type="button" className="nav-item sidebar-command primary" onClick={handleNewChat}>
                  <Plus size={17} />
                  <span>新聊天</span>
                </button>
                <form className="sidebar-search" onSubmit={handleSidebarSearchSubmit}>
                  <Search size={15} />
                  <input
                    value={sidebarSearchQuery}
                    onChange={(event) => setSidebarSearchQuery(event.target.value)}
                    placeholder="搜索聊天、项目、页面"
                    aria-label="搜索聊天、项目、页面"
                  />
                </form>
                {sidebarSearchQuery.trim() ? (
                  <div className="sidebar-search-results" aria-label="侧边栏搜索结果">
                    {sidebarSearchMatches.length ? sidebarSearchMatches.map((match) => (
                      <button
                        key={match.id}
                        type="button"
                        className="sidebar-result-row"
                        onClick={() => openSidebarSearchMatch(match)}
                      >
                        <span>{match.label}</span>
                        <small>{match.detail}</small>
                      </button>
                    )) : (
                      <p className="sidebar-empty-note">无搜索结果</p>
                    )}
                  </div>
                ) : null}
              </section>
              <section className="sidebar-section sidebar-section-threads" aria-labelledby="sidebar-threads-title">
                <div className="sidebar-section-title" id="sidebar-threads-title">
                  <span>项目对话</span>
                  <div className="sidebar-project-title-actions">
                    {archivedThreadCount ? (
                      <button
                        type="button"
                        className={cx('sidebar-archive-badge', showArchivedPanel && 'active')}
                        onClick={() => setShowArchivedPanel((current) => !current)}
                        title="查看已归档对话"
                        aria-label={`${archivedThreadCount} 条已归档对话`}
                        aria-expanded={showArchivedPanel}
                      >
                        {archivedThreadCount} 已归档
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className={cx('sidebar-project-icon-btn', allProjectThreadsCollapsed && 'active')}
                      onClick={toggleAllProjectThreadsCollapsed}
                      title={allProjectThreadsCollapsed ? '展开全部对话' : '收起全部对话'}
                      aria-label={allProjectThreadsCollapsed ? '展开全部对话' : '收起全部对话'}
                      aria-pressed={allProjectThreadsCollapsed}
                    >
                      {allProjectThreadsCollapsed ? <ChevronsDown size={14} /> : <ChevronsUp size={14} />}
                    </button>
                    <button
                      type="button"
                      className={cx('sidebar-project-icon-btn', sidebarProjectMenu?.kind === 'global' && 'active')}
                      onClick={(event) => toggleSidebarProjectMenu({ kind: 'global' }, event)}
                      title="项目对话菜单"
                      aria-label="项目对话菜单"
                      aria-haspopup="menu"
                    >
                      <MoreHorizontal size={15} />
                    </button>
                    <button
                      type="button"
                      className={cx('sidebar-project-icon-btn', sidebarProjectMenu?.kind === 'create' && 'active')}
                      onClick={(event) => toggleSidebarProjectMenu({ kind: 'create' }, event)}
                      title="添加项目"
                      aria-label="添加项目"
                      aria-haspopup="menu"
                    >
                      <FolderPlus size={15} />
                    </button>
                  </div>
                  {sidebarProjectMenu?.kind === 'global' ? renderSidebarProjectGlobalMenu() : null}
                  {sidebarProjectMenu?.kind === 'create' ? renderSidebarProjectCreateMenu() : null}
                </div>
                {sidebarProjectThreadGroups.length ? (
                  <div className="sidebar-project-chat-list">
                    {sidebarProjectThreadGroups.map((project) => {
                      const expanded = expandedProjectThreads.has(project.id);
                      const visibleThreads = allProjectThreadsCollapsed
                        ? []
                        : expanded
                          ? project.threads
                          : project.threads.slice(0, SIDEBAR_PROJECT_THREAD_LIMIT);
                      const hiddenThreadCount = Math.max(0, project.threads.length - visibleThreads.length);
                      return (
                        <div key={project.id} className="sidebar-project-chat-group">
                          <div className={cx('sidebar-project-chat-head', project.current && 'current')}>
                            <button
                              type="button"
                              className="sidebar-project-chat-main"
                              onClick={() => {
                                if (!project.current) {
                                  activateSidebarProject(project);
                                  return;
                                }
                                if (project.threads.length) toggleProjectThreadExpansion(project.id);
                              }}
                            >
                              <Folder size={15} aria-hidden />
                              <span>{project.label}</span>
                              {project.current ? <Badge variant="muted">当前</Badge> : null}
                            </button>
                            <div className="sidebar-project-row-actions">
                              <button
                                type="button"
                                className={cx('sidebar-project-icon-btn', sidebarProjectMenu?.kind === 'project' && sidebarProjectMenu.projectId === project.id && 'active')}
                                onClick={(event) => toggleSidebarProjectMenu({ kind: 'project', projectId: project.id }, event)}
                                title="项目操作"
                                aria-label={`${project.label} 项目操作`}
                                aria-haspopup="menu"
                              >
                                <MoreHorizontal size={14} />
                              </button>
                              <button
                                type="button"
                                className="sidebar-project-icon-btn"
                                onClick={() => openProjectNewChat(project)}
                                title="在 SciForge 中开始新对话"
                                aria-label={`在 ${project.label} 中开始新对话`}
                              >
                                <Edit3 size={14} />
                              </button>
                            </div>
                            {sidebarProjectMenu?.kind === 'project' && sidebarProjectMenu.projectId === project.id ? renderSidebarProjectActionMenu(project) : null}
                          </div>
                          {visibleThreads.length ? (
                            <div className="sidebar-thread-list">
                              {visibleThreads.map((item) => renderSidebarThreadRow(item, project))}
                              {hiddenThreadCount ? (
                                <button
                                  type="button"
                                  className="sidebar-thread-more"
                                  onClick={() => toggleProjectThreadExpansion(project.id)}
                                >
                                  <PanelTopOpen size={14} aria-hidden />
                                  <span>展开显示</span>
                                  <small>{hiddenThreadCount} 条</small>
                                </button>
                              ) : expanded && project.threads.length > SIDEBAR_PROJECT_THREAD_LIMIT ? (
                                <button
                                  type="button"
                                  className="sidebar-thread-more"
                                  onClick={() => toggleProjectThreadExpansion(project.id)}
                                >
                                  <ChevronDown size={14} aria-hidden />
                                  <span>收起</span>
                                </button>
                              ) : null}
                            </div>
                          ) : allProjectThreadsCollapsed ? null : (
                            <p className="sidebar-empty-note sidebar-project-empty">暂无对话</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="sidebar-empty-note">还没有聊天</p>
                )}
                {showArchivedPanel && archivedThreadCount ? (
                  <div className="sidebar-archived-panel" aria-label="已归档对话">
                    <div className="sidebar-archived-panel-head">
                      <Archive size={14} aria-hidden />
                      <span>已归档对话</span>
                      <small>{archivedThreadCount} 条</small>
                    </div>
                    <div className="sidebar-thread-list">
                      {sidebarArchivedThreadItems.length
                        ? sidebarArchivedThreadItems.map((item) => renderSidebarThreadRow(item))
                        : <p className="sidebar-empty-note">暂无已归档对话</p>}
                    </div>
                  </div>
                ) : null}
              </section>
            </div>
            <div className="sidebar-tools-strip" aria-label="工具">
              <div className="sidebar-section-title sidebar-tools-title">
                <span>工具</span>
              </div>
              <button type="button" className={cx('nav-item sidebar-command sidebar-tool-item', page === 'components' && 'active')} onClick={() => setPage('components')}>
                <Plug size={16} />
                <span>应用</span>
              </button>
              <div className="sidebar-static-row sidebar-tool-item muted" aria-label="自动化">
                <Workflow size={16} />
                <span>自动化</span>
                <Badge variant="muted">即将推出</Badge>
              </div>
            </div>
            <div className="scenario-list scenario-list-workspace">
              <div className="sidebar-section-title sidebar-project-title">
                <span>项目</span>
                {workspaceRoot ? <small>{pathBasename(workspaceRoot) || workspaceRoot}</small> : null}
              </div>
              <div className="scenario-list-explorer-toolbar">
                <div className="explorer-view-toolbar">
                  <button
                    type="button"
                    className="explorer-icon-btn"
                    onClick={() => void runWorkspaceAction(workspaceActions.createFile)}
                    title="新建文件"
                    aria-label="新建文件"
                  >
                    <FilePlus size={16} />
                  </button>
                  <button
                    type="button"
                    className="explorer-icon-btn"
                    onClick={() => void runWorkspaceAction(workspaceActions.createFolder)}
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
                    <strong>{config.workspacePath.trim() ? '初始化 SciForge 项目' : '设置项目路径'}</strong>
                    <p>{conciseWorkspaceOnboardingReason(config.workspacePath, workspaceError, workspaceStatus)}</p>
                    <button type="button" onClick={() => void initializeWorkspacePath()}>
                      创建项目工作区
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
                    <button type="button" onClick={() => void handleContextMenuAction(workspaceActions.createFile)}>新建文件</button>
                    <button type="button" onClick={() => void handleContextMenuAction(workspaceActions.createFolder)}>新建文件夹</button>
                    {contextMenu.entry ? <button type="button" onClick={() => void handleContextMenuAction(workspaceActions.rename)}>重命名</button> : null}
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
                    {contextMenu.entry ? <button type="button" className="danger" onClick={() => void handleContextMenuAction(workspaceActions.delete)}>删除</button> : null}
                  </div>
                ) : null}
                <button
                  type="button"
                  className="explorer-folder-picker-trigger"
                  onClick={() => void chooseWorkspaceRootPath()}
                >
                  打开其他文件夹…
                </button>
                <details ref={folderPickerRef} className="explorer-folder-picker explorer-folder-picker-advanced">
                  <summary>手动输入路径</summary>
                  <div className="explorer-folder-picker-body">
                    <input
                      className="workspace-path-editor explorer-path-input"
                      value={pathEditDraft}
                      onChange={(event) => setPathEditDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') void refreshExplorer();
                      }}
                      spellCheck={false}
                      title={workspaceStatus || '项目根路径'}
                      aria-label="项目根路径"
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
            <div className="sidebar-footer-actions">
              <button type="button" className="nav-item sidebar-command" onClick={() => onSettingsOpen?.()}>
                <Settings size={17} />
                <span>设置</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {showWorkbenchNav && !collapsed ? (
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
  annotationModeActive = false,
  onAnnotationModeToggle = () => undefined,
}: {
  onSearch: (query: string) => void;
  onSettingsOpen: () => void;
  theme: SciForgeConfig['theme'];
  onThemeToggle: () => void;
  healthItems: RuntimeHealthItem[];
  annotationModeActive?: boolean;
  onAnnotationModeToggle?: () => void;
}) {
  const [query, setQuery] = useState('');
  const healthProblems = healthItems.filter((item) => item.status === 'offline' || item.status === 'not-configured' || item.status === 'checking').length;
  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSearch(query);
  }
  return (
    <header className="topbar">
      <form className="searchbox" onSubmit={handleSubmit}>
        <Search size={15} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索文件、报告、问题..." />
      </form>
      <div className="topbar-actions">
        <button
          type="button"
          className={cx('topbar-annotation-button', annotationModeActive && 'active')}
          onClick={onAnnotationModeToggle}
          aria-pressed={annotationModeActive}
          aria-label={annotationModeActive ? '退出注释模式' : '开启注释模式'}
          data-feedback-control="true"
        >
          <MessageSquare size={15} aria-hidden />
          <span>注释</span>
        </button>
        <Badge variant={healthProblems ? 'warning' : 'success'} glow>
          SciForge · {healthProblems ? `${healthProblems} 项需处理` : '就绪'}
        </Badge>
        <IconButton icon={(theme ?? 'dark') === 'dark' ? Sun : Moon} label={(theme ?? 'dark') === 'dark' ? '切换白天模式' : '切换黑夜模式'} onClick={onThemeToggle} />
        <IconButton icon={Settings} label="设置" onClick={onSettingsOpen} />
      </div>
    </header>
  );
}

export type { ConfigSaveState } from './settingsModels';
