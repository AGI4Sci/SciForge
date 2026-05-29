import { useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { Archive, ArrowDown, ChevronLeft, ChevronRight, Clock, File, FileCode, FileText, MessageSquare, Pin, Square } from 'lucide-react';
import { navItems, scenarios, sidebarViewNavItems, type PageId } from '../../data';
import { normalizeWorkspaceRootPath } from '../../config';
import type { SciForgeConfig, SciForgeReference, SciForgeSession, ScenarioInstanceId } from '../../domain';
import { listWorkspace, mutateWorkspaceFile, openWorkspaceObject, readWorkspaceFile, writeWorkspaceFile, type WorkspaceEntry, type WorkspaceFileContent } from '../../api/workspaceClient';
import { cx } from '../uiPrimitives';
import {
  explorerWorkspaceRoot,
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
  removeProjectFromSidebarPreferences,
  saveSidebarPreferences,
  togglePinnedThreadId,
  type SidebarLayoutMode,
  type SidebarPreferences,
  type SidebarSortMode,
} from './sidebarPreferences';
import {
  clampSidebarPanelHeights,
  loadSidebarPanelLayout,
  saveSidebarPanelLayout,
  sidebarExplorerPanelStyle,
  sidebarPanelBlockStyle,
  type SidebarPanelLayout,
} from './sidebarPanelLayout';
import { resolveWorkspaceDirectoryPath } from './workspaceDirectoryPicker';
import { WorkspaceConnectionPanel } from './WorkspaceConnectionPanel';
import { WorkspaceExplorerToolbar } from './WorkspaceExplorerToolbar';
import { WorkspaceExplorerStatusPanel } from './WorkspaceExplorerStatusPanel';
import { WorkspaceExplorerRootTree } from './WorkspaceExplorerRootTree';
import { WorkspaceExplorerNodeRow } from './WorkspaceExplorerNodeRow';
import { WorkspacePreviewPanel } from './WorkspacePreviewPanel';
import { SidebarProjectChatSection } from './SidebarProjectChatSection';
import { SidebarToolsStrip } from './SidebarToolsStrip';
import { SidebarFooterActions } from './SidebarFooterActions';
import { SidebarPanelBlock, SidebarPanelToggleButton } from './SidebarPanelBlock';
import {
  SIDEBAR_CHRONOLOGICAL_PROJECT_ID,
  buildConfiguredSidebarProjects,
  migrateLegacySidebarProjectId,
  sidebarProjectPath,
} from './sidebarProjectModel';
import { resolveSidebarProjectSessionBundle, type SidebarProjectSessionsByPath } from './sidebarProjectSessions';
import { ExplorerContextMenu } from '../contextMenu/ExplorerContextMenu';
import { resolveAppContextMenuReference } from '../contextMenu/contextMenuModel';
import {
  SidebarProjectActionContextMenu,
  SidebarProjectCreateContextMenu,
  SidebarThreadsGlobalContextMenu,
} from '../contextMenu/SidebarProjectContextMenus';
import { referenceForWorkspaceEntry } from '../../../../../packages/support/object-references';
import {
  applyExplorerEntryClickSelection,
  collectVisibleExplorerEntries,
  explorerSelectedEntryFromFolderPath,
  explorerSelectedEntryFromWorkspaceEntry,
  explorerSelectionIncludesPath,
  resolveExplorerContextMenuSelection,
  type ExplorerSelectedEntry,
} from './explorerSelection';
import {
  workspacePasteTargetPath,
  type WorkspaceClipboardState,
} from '../contextMenu/workspaceClipboardModel';
export { SettingsPage } from './SettingsPage';
export { SettingsDialog } from './ShellPanelsSettingsDialog';
export { TopBar } from './TopBar';

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
  projectSessionsByPath?: SidebarProjectSessionsByPath;
}
type SidebarProjectMenu =
  | { kind: 'global'; x: number; y: number; reference?: SciForgeReference }
  | { kind: 'create'; x: number; y: number }
  | { kind: 'project'; x: number; y: number; projectId: string; reference?: SciForgeReference };

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
  options: SidebarThreadBuildOptions = {},
): SidebarThreadItem[] {
  const sort = options.sort ?? 'updatedAt';
  const pinned = new Set(options.pinnedThreadIds ?? []);
  const limit = options.limit ?? 8;
  const pool: SciForgeSession[] = Object.values(sessionsByScenario).filter((s): s is SciForgeSession => Boolean(s));
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
  const threadItems = buildSidebarThreadItems(sessionsByScenario, {
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
    const { sessionsByScenario: projectSessions } = resolveSidebarProjectSessionBundle(
      projectPath,
      options.activeWorkspacePath ?? config.workspacePath,
      sessionsByScenario,
      archivedSessions,
      options.projectSessionsByPath,
    );
    const threads = buildSidebarThreadItems(projectSessions, {
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
  for (const thread of buildSidebarThreadItems(sessionsByScenario)) {
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

export function Sidebar({
  page,
  setPage,
  scenarioId,
  setScenarioId,
  config,
  sessionsByScenario,
  archivedSessions,
  onProjectNewChat,
  onArchiveThread,
  onArchiveProjectChats,
  onArchiveAllChats,
  onRemoveSidebarProject,
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
  onReferenceToChat,
}: {
  page: PageId;
  setPage: (page: PageId) => void;
  scenarioId: ScenarioInstanceId;
  setScenarioId: (id: ScenarioInstanceId) => void;
  config: SciForgeConfig;
  sessionsByScenario?: Record<ScenarioInstanceId, SciForgeSession>;
  archivedSessions?: SciForgeSession[];
  onProjectNewChat?: (project: SidebarProjectThreadGroup) => void;
  onArchiveThread?: (scenarioId: ScenarioInstanceId, sessionId: string) => void;
  onArchiveProjectChats?: (project: SidebarProjectThreadGroup) => void | Promise<void>;
  onArchiveAllChats?: () => void;
  onRemoveSidebarProject?: (project: SidebarProjectThreadGroup) => void;
  onSearchNavigate?: (query: string) => void;
  onSettingsOpen?: () => void;
  workspaceStatus: string;
  onWorkspacePathChange: (value: string) => void;
  onWorkspaceProjectActivate?: (
    project: SidebarProjectThreadGroup,
    thread?: Pick<SidebarThreadItem, 'scenarioId' | 'sessionId'>,
  ) => void;
  projectSessionsByPath?: SidebarProjectSessionsByPath;
  activeWorkspacePath?: string;
  deferWorkbenchFilePreview?: boolean;
  onWorkbenchFileOpened?: (file: WorkspaceFileContent) => void;
  workbenchEditorFilePath?: string | null;
  onWorkbenchEditorPathInvalidated?: () => void;
  onReferenceToChat?: (reference: SciForgeReference) => void;
}) {
  const workspaceRoot = explorerWorkspaceRoot(config);
  const [collapsed, setCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(284);
  const [folderChildren, setFolderChildren] = useState<Record<string, WorkspaceEntry[]>>({});
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set(workspaceRoot ? [workspaceRoot] : []));
  const [workspaceError, setWorkspaceError] = useState('');
  const [workspaceNotice, setWorkspaceNotice] = useState('');
  const [selectedEntries, setSelectedEntries] = useState<ExplorerSelectedEntry[]>([]);
  const [selectionAnchorPath, setSelectionAnchorPath] = useState<string | null>(null);
  const [pathEditDraft, setPathEditDraft] = useState(config.workspacePath);
  const [previewFile, setPreviewFile] = useState<WorkspaceFileContent | null>(null);
  const [previewDraft, setPreviewDraft] = useState('');
  const [previewDirty, setPreviewDirty] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    entry?: WorkspaceEntry;
    selectedEntries: ExplorerSelectedEntry[];
  } | null>(null);
  const [workspaceClipboard, setWorkspaceClipboard] = useState<WorkspaceClipboardState | null>(null);
  const [sidebarSearchQuery, setSidebarSearchQuery] = useState('');
  const [expandedProjectThreads, setExpandedProjectThreads] = useState<Set<string>>(() => new Set());
  const [allProjectThreadsCollapsed, setAllProjectThreadsCollapsed] = useState(false);
  const [sidebarProjectMenu, setSidebarProjectMenu] = useState<SidebarProjectMenu | null>(null);
  const [sidebarPreferences, setSidebarPreferences] = useState<SidebarPreferences>(() => loadSidebarPreferences());
  const [panelLayout, setPanelLayout] = useState<SidebarPanelLayout>(() => loadSidebarPanelLayout());
  const folderPickerRef = useRef<HTMLDetailsElement | null>(null);
  const resizingRef = useRef(false);
  const panelBodyRef = useRef<HTMLDivElement | null>(null);
  const panelResizeRef = useRef<{
    edge: 'threads-tools' | 'tools-explorer';
    startY: number;
    startThreads: number;
    startTools: number;
  } | null>(null);
  const sidebarSessions: Partial<Record<ScenarioInstanceId, SciForgeSession>> = sessionsByScenario ?? {};
  const sidebarSearchMatches = useMemo(
    () => buildSidebarSearchMatches(sidebarSearchQuery, sidebarSessions),
    [sidebarSearchQuery, sidebarSessions],
  );
  const sidebarProjectThreadGroups = useMemo(
    () => buildSidebarProjectThreadGroups(config, sidebarSessions, archivedSessions, {
      layout: sidebarPreferences.layout,
      sort: sidebarPreferences.sort,
      pinnedThreadIds: sidebarPreferences.pinnedThreadIds,
      projectOrder: sidebarPreferences.projectOrder,
      projectSessionsByPath,
      activeWorkspacePath,
    }),
    [config, sidebarSessions, archivedSessions, sidebarPreferences, projectSessionsByPath, activeWorkspacePath],
  );
  const pinnedThreadIds = useMemo(() => new Set(sidebarPreferences.pinnedThreadIds), [sidebarPreferences.pinnedThreadIds]);
  const sidebarProjectContextMenuProject = useMemo(
    () => (sidebarProjectMenu?.kind === 'project'
      ? sidebarProjectThreadGroups.find((project) => project.id === sidebarProjectMenu.projectId)
      : undefined),
    [sidebarProjectMenu, sidebarProjectThreadGroups],
  );
  const showWorkbenchNav = page === 'workbench';
  const sidebarExpanded = showWorkbenchNav && !collapsed;
  const visibleExplorerEntries = useMemo(
    () => collectVisibleExplorerEntries(workspaceRoot, folderChildren, expandedFolders),
    [workspaceRoot, folderChildren, expandedFolders],
  );

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
    saveSidebarPanelLayout(panelLayout);
  }, [panelLayout]);

  useEffect(() => {
    if (!sidebarExpanded) return;
    const node = panelBodyRef.current;
    if (!node) return;
    function syncPanelHeights() {
      const available = node?.clientHeight;
      if (!available) return;
      setPanelLayout((current) => clampSidebarPanelHeights(current, available));
    }
    syncPanelHeights();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', syncPanelHeights);
      return () => window.removeEventListener('resize', syncPanelHeights);
    }
    const observer = new ResizeObserver(() => syncPanelHeights());
    observer.observe(node);
    return () => observer.disconnect();
  }, [sidebarExpanded, panelLayout.threadsCollapsed, panelLayout.toolsCollapsed, panelLayout.explorerCollapsed]);

  useEffect(() => {
    if (!sidebarExpanded) return;
    function handleMouseMove(event: MouseEvent) {
      const resize = panelResizeRef.current;
      const available = panelBodyRef.current?.clientHeight;
      if (!resize || !available) return;
      const delta = event.clientY - resize.startY;
      setPanelLayout((current) => {
        if (resize.edge === 'threads-tools') {
          const nextThreads = resize.startThreads + delta;
          return clampSidebarPanelHeights({ ...current, threadsHeight: nextThreads }, available);
        }
        const nextTools = resize.startTools + delta;
        return clampSidebarPanelHeights({ ...current, toolsHeight: nextTools }, available);
      });
    }
    function handleMouseUp() {
      panelResizeRef.current = null;
    }
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [sidebarExpanded]);

  function beginSidebarPanelResize(edge: 'threads-tools' | 'tools-explorer', event: ReactMouseEvent<HTMLDivElement>) {
    event.preventDefault();
    panelResizeRef.current = {
      edge,
      startY: event.clientY,
      startThreads: panelLayout.threadsHeight,
      startTools: panelLayout.toolsHeight,
    };
  }

  function toggleSidebarPanelSection(section: 'threads' | 'tools' | 'explorer') {
    setPanelLayout((current) => ({
      ...current,
      threadsCollapsed: section === 'threads' ? !current.threadsCollapsed : current.threadsCollapsed,
      toolsCollapsed: section === 'tools' ? !current.toolsCollapsed : current.toolsCollapsed,
      explorerCollapsed: section === 'explorer' ? !current.explorerCollapsed : current.explorerCollapsed,
    }));
  }

  useEffect(() => {
    const root = explorerWorkspaceRoot(config);
    setPathEditDraft(config.workspacePath);
    setPreviewFile(null);
    setPreviewDraft('');
    setPreviewDirty(false);
    setFolderChildren({});
    setExpandedFolders(new Set(root ? [root] : []));
    setSelectedEntries(root ? [explorerSelectedEntryFromFolderPath(root)] : []);
    setSelectionAnchorPath(root || null);
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
    const primary = selectedEntries[selectedEntries.length - 1];
    if (!primary) return root;
    if (primary.kind === 'folder') return primary.path;
    const p = parentPath(primary.path);
    return p && p.length ? p : root;
  }

  function contextMenuTargets(menu: NonNullable<typeof contextMenu>): ExplorerSelectedEntry[] {
    if (menu.selectedEntries.length) return menu.selectedEntries;
    return menu.entry ? [explorerSelectedEntryFromWorkspaceEntry(menu.entry)] : [];
  }

  function handleExplorerEntryClick(entry: ExplorerSelectedEntry, event: ReactMouseEvent<HTMLElement>) {
    if ((event.target as HTMLElement).closest('.explorer-twistie')) return;
    const next = applyExplorerEntryClickSelection({
      entry,
      visibleEntries: visibleExplorerEntries,
      currentSelection: selectedEntries,
      anchorPath: selectionAnchorPath,
      metaKey: event.metaKey || event.ctrlKey,
      shiftKey: event.shiftKey,
    });
    setSelectedEntries(next.selection);
    setSelectionAnchorPath(next.anchorPath);
    if (!event.metaKey && !event.ctrlKey && !event.shiftKey && entry.kind === 'file') {
      void openWorkspaceEntry({ kind: 'file', path: entry.path, name: entry.name, size: 0 });
    }
  }

  function handleExplorerContextMenu(entry: ExplorerSelectedEntry, event: ReactMouseEvent<HTMLElement>, workspaceEntry?: WorkspaceEntry) {
    event.preventDefault();
    event.stopPropagation();
    const nextSelection = resolveExplorerContextMenuSelection(entry, selectedEntries);
    setSelectedEntries(nextSelection);
    setSelectionAnchorPath(entry.path);
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      entry: workspaceEntry ?? { kind: entry.kind, path: entry.path, name: entry.name, ...(entry.kind === 'file' ? { size: 0 } : {}) },
      selectedEntries: nextSelection,
    });
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
    const selected = explorerSelectedEntryFromWorkspaceEntry(entry);
    setSelectedEntries([selected]);
    setSelectionAnchorPath(selected.path);
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
    const selectedPath = entry?.path || selectedEntries[selectedEntries.length - 1]?.path || root;
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
    const selected = explorerSelectedEntryFromFolderPath(path);
    setSelectedEntries([selected]);
    setSelectionAnchorPath(path);
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

  async function handleContextMenuDelete() {
    const menu = contextMenu;
    setContextMenu(null);
    const targets = menu ? contextMenuTargets(menu) : [];
    if (!targets.length) return;
    const label = targets.length > 1 ? `${targets.length} 项` : targets[0].name;
    if (!window.confirm(`删除 ${label}？`)) return;
    try {
      setWorkspaceError('');
      for (const target of targets) {
        if (workbenchEditorFilePath && target.path === workbenchEditorFilePath) {
          onWorkbenchEditorPathInvalidated?.();
        }
        if (previewFile && previewFile.path === target.path) {
          setPreviewFile(null);
          setPreviewDraft('');
          setPreviewDirty(false);
        }
        await mutateWorkspaceFile(config, workspaceActions.delete, { path: target.path });
      }
      setSelectedEntries((current) => current.filter((item) => !targets.some((target) => target.path === item.path)));
      await refreshExplorer();
      setWorkspaceNotice(targets.length > 1 ? `已删除 ${targets.length} 项` : workspaceActionSuccessMessage(workspaceActions.delete));
    } catch (err) {
      setWorkspaceError(err instanceof Error ? err.message : String(err));
      setWorkspaceNotice('');
    }
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
    const menu = contextMenu;
    setContextMenu(null);
    const targets = menu ? contextMenuTargets(menu) : [];
    if (!targets.length) return;
    const paths = targets.map((target) => target.path).join('\n');
    await navigator.clipboard?.writeText(paths);
    setWorkspaceNotice(targets.length > 1 ? `已复制 ${targets.length} 个路径` : `已复制路径 ${paths}`);
  }

  async function handleContextMenuCopyRelativePath() {
    const menu = contextMenu;
    setContextMenu(null);
    const targets = menu ? contextMenuTargets(menu) : [];
    if (!targets.length) return;
    const root = explorerWorkspaceRoot(config);
    const paths = targets.map((target) => toWorkspaceRelativePath(root, target.path)).join('\n');
    await navigator.clipboard?.writeText(paths);
    setWorkspaceNotice(targets.length > 1 ? `已复制 ${targets.length} 个相对路径` : `已复制相对路径 ${paths}`);
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

  function handleContextMenuCut() {
    const menu = contextMenu;
    setContextMenu(null);
    const targets = menu ? contextMenuTargets(menu) : [];
    if (!targets.length) return;
    setWorkspaceClipboard({
      mode: 'cut',
      entries: targets.map((target) => ({ path: target.path, name: target.name, kind: target.kind })),
    });
    setWorkspaceNotice(targets.length > 1 ? `已剪切 ${targets.length} 项` : `已剪切 ${targets[0].name}`);
  }

  function handleContextMenuCopy() {
    const menu = contextMenu;
    setContextMenu(null);
    const targets = menu ? contextMenuTargets(menu) : [];
    if (!targets.length) return;
    setWorkspaceClipboard({
      mode: 'copy',
      entries: targets.map((target) => ({ path: target.path, name: target.name, kind: target.kind })),
    });
    setWorkspaceNotice(targets.length > 1 ? `已复制 ${targets.length} 项` : `已复制 ${targets[0].name}`);
  }

  async function handleContextMenuPaste() {
    const menu = contextMenu;
    const clipboard = workspaceClipboard;
    setContextMenu(null);
    if (!menu || !clipboard?.entries.length) return;
    const targetPath = workspacePasteTargetPath({ entry: menu.entry, workspaceRoot });
    if (!targetPath) return;
    try {
      setWorkspaceError('');
      for (const item of clipboard.entries) {
        const destination = `${targetPath.replace(/\/+$/, '')}/${item.name}`;
        const action = clipboard.mode === 'cut' ? workspaceActions.moveFile : workspaceActions.copyFile;
        await mutateWorkspaceFile(config, action, { path: item.path, targetPath: destination });
      }
      if (clipboard.mode === 'cut') setWorkspaceClipboard(null);
      await refreshExplorer();
      setWorkspaceNotice(clipboard.mode === 'cut' ? workspaceActionSuccessMessage(workspaceActions.moveFile) : workspaceActionSuccessMessage(workspaceActions.copyFile));
    } catch (err) {
      setWorkspaceError(err instanceof Error ? err.message : String(err));
      setWorkspaceNotice('');
    }
  }

  function handleContextMenuReferenceToChat(reference: SciForgeReference) {
    setContextMenu(null);
    onReferenceToChat?.(reference);
  }

  const explorerContextMenuCanPaste = Boolean(
    contextMenu
    && workspaceClipboard?.entries.length
    && workspacePasteTargetPath({ entry: contextMenu.entry, workspaceRoot }),
  );

  function referenceForSidebarProject(project: Pick<SidebarProjectThreadGroup, 'label' | 'detail'>) {
    const path = project.detail.trim();
    if (!path) return undefined;
    return referenceForWorkspaceEntry({
      path,
      name: project.label || pathBasename(path),
      kind: 'folder',
    });
  }

  function resolveSidebarMenuReference(
    kind: SidebarProjectMenu['kind'],
    event: ReactMouseEvent,
    project?: SidebarProjectThreadGroup,
  ) {
    if (kind === 'project' && project) return referenceForSidebarProject(project);
    if (kind === 'global') return resolveAppContextMenuReference(event.nativeEvent);
    return undefined;
  }

  function sidebarProjectMenuAt(
    base: { kind: 'global' } | { kind: 'create' } | { kind: 'project'; projectId: string },
    event: ReactMouseEvent,
    project?: SidebarProjectThreadGroup,
  ): SidebarProjectMenu {
    return {
      ...base,
      x: event.clientX,
      y: event.clientY,
      ...(base.kind === 'global' || base.kind === 'project'
        ? { reference: resolveSidebarMenuReference(base.kind, event, project) }
        : {}),
    } as SidebarProjectMenu;
  }

  function toggleSidebarProjectMenu(
    base: { kind: 'global' } | { kind: 'create' } | { kind: 'project'; projectId: string },
    event: ReactMouseEvent,
    project?: SidebarProjectThreadGroup,
  ) {
    event.stopPropagation();
    const menu = sidebarProjectMenuAt(base, event, project);
    setSidebarProjectMenu((current) => {
      if (!current || current.kind !== menu.kind) return menu;
      if (current.kind === 'project' && menu.kind === 'project' && current.projectId !== menu.projectId) return menu;
      return null;
    });
  }

  function openSidebarProjectMenuAt(
    base: { kind: 'global' } | { kind: 'create' } | { kind: 'project'; projectId: string },
    event: ReactMouseEvent,
    project?: SidebarProjectThreadGroup,
  ) {
    event.preventDefault();
    event.stopPropagation();
    setSidebarProjectMenu(sidebarProjectMenuAt(base, event, project));
  }

  function handleSidebarProjectReferenceToChat(reference: SciForgeReference) {
    setSidebarProjectMenu(null);
    onReferenceToChat?.(reference);
  }

  async function copySidebarProjectPath(project: SidebarProjectThreadGroup) {
    setSidebarProjectMenu(null);
    if (!project.detail.trim()) return;
    await navigator.clipboard?.writeText(project.detail);
    setWorkspaceNotice(`已复制路径 ${project.detail}`);
  }

  async function copySidebarProjectRelativePath(project: SidebarProjectThreadGroup) {
    setSidebarProjectMenu(null);
    if (!project.detail.trim()) return;
    const root = explorerWorkspaceRoot(config);
    const relativePath = toWorkspaceRelativePath(root, project.detail);
    await navigator.clipboard?.writeText(relativePath);
    setWorkspaceNotice(`已复制相对路径 ${relativePath}`);
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
    thread?: SidebarThreadItem,
  ) {
    if (project.current) {
      if (thread) openSidebarThread(thread, project);
      return;
    }
    setSidebarProjectMenu(null);
    onWorkspaceProjectActivate?.(project, thread ? { scenarioId: thread.scenarioId, sessionId: thread.sessionId } : undefined);
    setPage('workbench');
    setAllProjectThreadsCollapsed(false);
    setExpandedProjectThreads(new Set([project.id]));
    setWorkspaceNotice(`已切换到项目 ${project.label}`);
  }

  function openProjectNewChat(project: SidebarProjectThreadGroup, event: ReactMouseEvent) {
    event.stopPropagation();
    setSidebarProjectMenu(null);
    onProjectNewChat?.(project);
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

  async function archiveProjectChats(project: SidebarProjectThreadGroup) {
    setSidebarProjectMenu(null);
    if (!onArchiveProjectChats) {
      setWorkspaceNotice(`${project.label} 没有可归档的活跃对话。`);
      return;
    }
    try {
      setWorkspaceError('');
      await onArchiveProjectChats(project);
      setWorkspaceNotice(`已归档 ${project.label} 的全部活跃对话。`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setWorkspaceError(message.includes('没有可归档') ? '' : message);
      setWorkspaceNotice(message);
    }
  }

  function removeSidebarProject(project: SidebarProjectThreadGroup) {
    setSidebarProjectMenu(null);
    if (project.current) {
      setWorkspaceNotice('当前项目不能从侧栏移除。');
      return;
    }
    try {
      setWorkspaceError('');
      onRemoveSidebarProject?.(project);
      updateSidebarPreferences(
        (current) => removeProjectFromSidebarPreferences(current, project.id),
        `已从侧栏移除 ${project.label}。`,
      );
    } catch (err) {
      setWorkspaceError(err instanceof Error ? err.message : String(err));
      setWorkspaceNotice('');
    }
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
      const isSelected = explorerSelectionIncludesPath(selectedEntries, entry.path);
      return (
        <WorkspaceExplorerNodeRow
          key={entry.path}
          entry={entry}
          depth={depth}
          expanded={isExpanded}
          selected={isSelected}
          icon={explorerFileGlyph(entry.name)}
          onEntryClick={(event) => handleExplorerEntryClick(explorerSelectedEntryFromWorkspaceEntry(entry), event)}
          onEntryContextMenu={(event) => handleExplorerContextMenu(explorerSelectedEntryFromWorkspaceEntry(entry), event, entry)}
          onToggleFolder={() => {
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
          {entry.kind === 'folder' && isExpanded ? renderExplorerDepth(depth + 1, entry.path) : null}
        </WorkspaceExplorerNodeRow>
      );
    });
  }

  return (
    <aside className={cx('sidebar', !sidebarExpanded && 'collapsed')} style={{ width: sidebarExpanded ? sidebarWidth : 46 }}>
      <div className="sidebar-activitybar" aria-label="工作区视图">
        <div className="brand" title="SciForge">
          <div className="brand-mark">
            <img src="/favicon.svg" alt="SciForge" width={38} height={38} />
          </div>
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
          <div className="sidebar-panel-body" ref={panelBodyRef}>
            <div className="sidebar-panel-sections">
              <SidebarPanelBlock
                title="对话"
                collapsed={panelLayout.threadsCollapsed}
                style={sidebarPanelBlockStyle(panelLayout.threadsCollapsed, panelLayout.threadsHeight)}
                toggleLabel={{ collapsed: '展开对话区', expanded: '折叠对话区' }}
                onToggle={() => toggleSidebarPanelSection('threads')}
              >
                  <div className="sidebar-scroll">
              <SidebarProjectChatSection
                sidebarSearchQuery={sidebarSearchQuery}
                sidebarSearchMatches={sidebarSearchMatches}
                allProjectThreadsCollapsed={allProjectThreadsCollapsed}
                activeMenuKind={sidebarProjectMenu?.kind}
                activeProjectMenuId={sidebarProjectMenu?.kind === 'project' ? sidebarProjectMenu.projectId : undefined}
                projectThreadLimit={SIDEBAR_PROJECT_THREAD_LIMIT}
                sidebarProjectThreadGroups={sidebarProjectThreadGroups}
                expandedProjectThreads={expandedProjectThreads}
                onSearchQueryChange={setSidebarSearchQuery}
                onSearchSubmit={handleSidebarSearchSubmit}
                onOpenSearchMatch={openSidebarSearchMatch}
                onOpenProjectMenuAt={openSidebarProjectMenuAt}
                onToggleProjectMenu={toggleSidebarProjectMenu}
                onToggleAllProjectThreadsCollapsed={toggleAllProjectThreadsCollapsed}
                onActivateProject={activateSidebarProject}
                onToggleProjectThreadExpansion={toggleProjectThreadExpansion}
                onOpenProjectNewChat={openProjectNewChat}
                renderSidebarThreadRow={renderSidebarThreadRow}
              />
                  </div>
              </SidebarPanelBlock>
              <div
                className="sidebar-panel-resize-handle"
                role="separator"
                aria-orientation="horizontal"
                aria-label="拖拽调整对话区高度"
                onMouseDown={(event) => beginSidebarPanelResize('threads-tools', event)}
              />
              <SidebarPanelBlock
                title="工具"
                collapsed={panelLayout.toolsCollapsed}
                style={sidebarPanelBlockStyle(panelLayout.toolsCollapsed, panelLayout.toolsHeight)}
                toggleLabel={{ collapsed: '展开工具区', expanded: '折叠工具区' }}
                onToggle={() => toggleSidebarPanelSection('tools')}
              >
                <SidebarToolsStrip onOpenComponents={() => setPage('components')} />
              </SidebarPanelBlock>
              <div
                className="sidebar-panel-resize-handle"
                role="separator"
                aria-orientation="horizontal"
                aria-label="拖拽调整工具区高度"
                onMouseDown={(event) => beginSidebarPanelResize('tools-explorer', event)}
              />
              <SidebarPanelBlock
                title="项目"
                collapsed={panelLayout.explorerCollapsed}
                className="sidebar-panel-block-explorer"
                style={sidebarExplorerPanelStyle(panelLayout.explorerCollapsed)}
                headerExtra={(
                  <>
                    {workspaceRoot ? <small>{pathBasename(workspaceRoot) || workspaceRoot}</small> : null}
                    <SidebarPanelToggleButton
                      collapsed={panelLayout.explorerCollapsed}
                      toggleLabel={{ collapsed: '展开项目区', expanded: '折叠项目区' }}
                      onToggle={() => toggleSidebarPanelSection('explorer')}
                    />
                  </>
                )}
                toggleLabel={{ collapsed: '展开项目区', expanded: '折叠项目区' }}
                onToggle={() => toggleSidebarPanelSection('explorer')}
              >
            <div className="scenario-list scenario-list-workspace">
              <WorkspaceExplorerToolbar
                onCreateFile={() => runWorkspaceAction(workspaceActions.createFile)}
                onCreateFolder={() => runWorkspaceAction(workspaceActions.createFolder)}
                onRefresh={refreshExplorer}
                onCollapseAll={collapseExplorerFolders}
              />
              <div
                className="sidebar-tree explorer-surface scenario-list-explorer-tree"
                role="tree"
                aria-label="工作区文件树"
                onContextMenu={(event) => {
                  if ((event.target as HTMLElement).closest('.explorer-row')) return;
                  event.preventDefault();
                  event.stopPropagation();
                  setContextMenu({ x: event.clientX, y: event.clientY, selectedEntries: [] });
                }}
              >
                <WorkspaceExplorerStatusPanel
                  workspacePath={config.workspacePath}
                  workspaceError={workspaceError}
                  workspaceStatus={workspaceStatus}
                  workspaceNotice={workspaceNotice}
                  onInitializeWorkspacePath={initializeWorkspacePath}
                />
                {!workspaceNeedsOnboarding(config.workspacePath, workspaceError, workspaceStatus) && workspaceRoot ? (
                  <WorkspaceExplorerRootTree
                    workspaceRoot={workspaceRoot}
                    rootLabel={pathBasename(workspaceRoot)}
                    expanded={expandedFolders.has(workspaceRoot)}
                    selected={explorerSelectionIncludesPath(selectedEntries, workspaceRoot)}
                    onRootClick={(event) => handleExplorerEntryClick(explorerSelectedEntryFromFolderPath(workspaceRoot), event)}
                    onRootContextMenu={(event) => handleExplorerContextMenu(
                      explorerSelectedEntryFromFolderPath(workspaceRoot),
                      event,
                      syntheticFolderEntry(workspaceRoot),
                    )}
                    onToggleRoot={() => {
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
                    {renderExplorerDepth(0, workspaceRoot)}
                  </WorkspaceExplorerRootTree>
                ) : null}
                {previewFile ? (
                  <WorkspacePreviewPanel
                    file={previewFile}
                    draft={previewDraft}
                    dirty={previewDirty}
                    onDraftChange={(value) => {
                      setPreviewDraft(value);
                      setPreviewDirty(value !== previewFile.content);
                    }}
                    onSave={savePreviewFile}
                  />
                ) : null}
                {contextMenu ? (
                  <ExplorerContextMenu
                    x={contextMenu.x}
                    y={contextMenu.y}
                    entry={contextMenu.entry}
                    selectedEntries={contextMenu.selectedEntries}
                    expandedFolders={expandedFolders}
                    clipboard={workspaceClipboard}
                    canPaste={explorerContextMenuCanPaste}
                    onOpen={() => void handleContextMenuOpen()}
                    onOpenInWorkbench={() => void handleContextMenuOpenInWorkbench()}
                    onOpenExternal={() => void handleContextMenuOpenExternal()}
                    onRevealInFolder={() => void handleContextMenuRevealInFolder()}
                    onToggleFolder={() => void handleContextMenuToggleFolder()}
                    onCreateFile={() => void handleContextMenuAction(workspaceActions.createFile)}
                    onCreateFolder={() => void handleContextMenuAction(workspaceActions.createFolder)}
                    onRename={() => void handleContextMenuAction(workspaceActions.rename)}
                    onDelete={() => void handleContextMenuDelete()}
                    onCopyPath={() => void handleContextMenuCopyPath()}
                    onCopyRelativePath={() => void handleContextMenuCopyRelativePath()}
                    onCut={handleContextMenuCut}
                    onCopy={handleContextMenuCopy}
                    onPaste={() => void handleContextMenuPaste()}
                    onReferenceToChat={handleContextMenuReferenceToChat}
                  />
                ) : null}
                <WorkspaceConnectionPanel
                  folderPickerRef={folderPickerRef}
                  pathEditDraft={pathEditDraft}
                  workspaceStatus={workspaceStatus}
                  onPathEditDraftChange={setPathEditDraft}
                  onChooseWorkspaceRootPath={chooseWorkspaceRootPath}
                  onRefreshExplorer={refreshExplorer}
                  onWorkspacePathChange={onWorkspacePathChange}
                />
              </div>
              </div>
              </SidebarPanelBlock>
            </div>
            <SidebarFooterActions onSettingsOpen={onSettingsOpen} />
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
      {sidebarProjectMenu?.kind === 'global' ? (
        <SidebarThreadsGlobalContextMenu
          x={sidebarProjectMenu.x}
          y={sidebarProjectMenu.y}
          layout={sidebarPreferences.layout}
          sort={sidebarPreferences.sort}
          reference={sidebarProjectMenu.reference}
          onArchiveAllChats={() => archiveAllSidebarChats()}
          onApplyLayout={applySidebarLayout}
          onMoveCurrentProjectDown={moveCurrentProjectDownInSidebar}
          onApplySort={applySidebarSort}
          onReferenceToChat={handleSidebarProjectReferenceToChat}
        />
      ) : null}
      {sidebarProjectMenu?.kind === 'create' ? (
        <SidebarProjectCreateContextMenu
          x={sidebarProjectMenu.x}
          y={sidebarProjectMenu.y}
          onCreateBlankProject={() => closeSidebarProjectMenuWithNotice('新建空白项目需要先选择工作区路径。')}
          onUseExistingFolder={() => {
            setSidebarProjectMenu(null);
            void chooseWorkspaceRootPath();
          }}
        />
      ) : null}
      {sidebarProjectMenu?.kind === 'project' && sidebarProjectContextMenuProject ? (
        <SidebarProjectActionContextMenu
          x={sidebarProjectMenu.x}
          y={sidebarProjectMenu.y}
          project={sidebarProjectContextMenuProject}
          reference={sidebarProjectMenu.reference ?? referenceForSidebarProject(sidebarProjectContextMenuProject)}
          onPinProject={() => closeSidebarProjectMenuWithNotice(`已请求置顶项目 ${sidebarProjectContextMenuProject.label}。`)}
          onRevealInFolder={() => void revealSidebarProject(sidebarProjectContextMenuProject)}
          onRenameProject={() => closeSidebarProjectMenuWithNotice('重命名项目稍后接入。')}
          onArchiveChats={() => void archiveProjectChats(sidebarProjectContextMenuProject)}
          onCopyPath={() => void copySidebarProjectPath(sidebarProjectContextMenuProject)}
          onCopyRelativePath={() => void copySidebarProjectRelativePath(sidebarProjectContextMenuProject)}
          onRemoveProject={() => removeSidebarProject(sidebarProjectContextMenuProject)}
          onReferenceToChat={handleSidebarProjectReferenceToChat}
        />
      ) : null}
    </aside>
  );
}

export type { ConfigSaveState } from './settingsModels';
