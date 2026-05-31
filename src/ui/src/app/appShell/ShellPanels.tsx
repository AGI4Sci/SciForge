import { useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { Archive, ChevronLeft, ChevronRight, File, FileCode, FileText, Pin, RotateCcw, Trash2 } from 'lucide-react';
import { navItems, scenarios, sidebarViewNavItems, type PageId } from '../../data';
import { normalizeWorkspaceRootPath } from '../../config';
import type { SciForgeConfig, SciForgeReference, SciForgeSession, ScenarioInstanceId } from '../../domain';
import { listWorkspace, mutateWorkspaceFile, openWorkspaceObject, readWorkspaceFile, writeWorkspaceFile, type WorkspaceEntry, type WorkspaceFileContent } from '../../api/workspaceClient';
import { localeText, type SupportedLocale } from '../../i18n';
import { useI18n } from '../../i18nContext';
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
  markThreadIdsRead,
  removeProjectFromSidebarPreferences,
  saveSidebarPreferences,
  toggleSidebarVisibleSection,
  togglePinnedThreadId,
  type SidebarLayoutMode,
  type SidebarPreferences,
  type SidebarSortMode,
  type SidebarVisibleSection,
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
import { sidebarHiddenArchiveThreadItems, sidebarRenderableThreadItems, sidebarSearchableThreadItems } from './sidebarProjectThreadList';
import { ExplorerContextMenu } from '../contextMenu/ExplorerContextMenu';
import { resolveAppContextMenuReference } from '../contextMenu/contextMenuModel';
import {
  SidebarProjectActionContextMenu,
  SidebarProjectCreateContextMenu,
  SidebarThreadsGlobalContextMenu,
} from '../contextMenu/SidebarProjectContextMenus';
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
import {
  buildSidebarCursorAgentProjection,
  sidebarCursorAgentRegionDetail,
  type SidebarCursorAgentProjection,
  type SidebarCursorAgentStatus,
  type SidebarCursorAgentSortMode,
  type SidebarCursorAgentThreadState,
} from './sidebarCursorAgentModel';
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
  createdAt?: string;
  state?: SidebarCursorAgentThreadState;
  pinned?: boolean;
  archived?: boolean;
  discarded?: boolean;
}

export interface SidebarProjectThreadGroup {
  id: string;
  label: string;
  detail: string;
  current: boolean;
  threads: SidebarThreadItem[];
  draftThreads?: SidebarThreadItem[];
  archivedThreads?: SidebarThreadItem[];
}

export interface SidebarSearchMatch {
  id: string;
  label: string;
  detail: string;
  page: PageId;
  scenarioId?: ScenarioInstanceId;
  projectId?: string;
  sessionId?: string;
  threadState?: SidebarCursorAgentThreadState;
}

const SIDEBAR_PROJECT_THREAD_LIMIT = 6;
const SIDEBAR_PROJECT_THREAD_PAGE_SIZE = 8;
const SIDEBAR_RECENT_PROJECT_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const SHELL_MODEL_DEFAULT_LOCALE: SupportedLocale = 'en-US';

function shellText(locale: SupportedLocale | undefined, copy: Record<SupportedLocale, string>) {
  return localeText(locale ?? SHELL_MODEL_DEFAULT_LOCALE, copy);
}

export interface SidebarThreadBuildOptions {
  sort?: SidebarSortMode;
  pinnedThreadIds?: string[];
  limit?: number;
  locale?: SupportedLocale;
}

export interface SidebarProjectBuildOptions extends SidebarThreadBuildOptions {
  layout?: SidebarLayoutMode;
  projectOrder?: string[];
  activeWorkspacePath?: string;
  activeSessionId?: string;
  projectSessionsByPath?: SidebarProjectSessionsByPath;
}
type SidebarProjectMenu =
  | { kind: 'global'; x: number; y: number; reference?: SciForgeReference }
  | { kind: 'create'; x: number; y: number }
  | { kind: 'project'; x: number; y: number; projectId: string };

export function sidebarSessionActivityScore(session: SciForgeSession) {
  const nonSeedMessages = session.messages.filter((message) => !message.id.startsWith('seed')).length;
  return nonSeedMessages
    + session.runs.length
    + session.artifacts.length
    + session.executionUnits.length
    + session.notebook.length;
}

export function sidebarThreadTitle(session: SciForgeSession, locale?: SupportedLocale) {
  const title = compactSidebarLine(session.title, 44);
  if (title && !isEvidenceLikeThreadTitle(title)) return title;
  const firstUserPrompt = session.messages.find((message) => message.role === 'user' && !message.id.startsWith('seed'))?.content;
  const promptTitle = compactSidebarLine(firstUserPrompt || '', 44);
  if (promptTitle && !isEvidenceLikeThreadTitle(promptTitle)) return promptTitle;
  return shellText(locale, { 'zh-CN': '未命名聊天', 'en-US': 'Untitled chat' });
}

export function buildSidebarThreadItems(
  sessionsByScenario: Partial<Record<ScenarioInstanceId, SciForgeSession>>,
  options: SidebarThreadBuildOptions = {},
): SidebarThreadItem[] {
  const sort = options.sort ?? 'updatedAt';
  const pinned = new Set(options.pinnedThreadIds ?? []);
  const limit = options.limit ?? 8;
  const locale = options.locale;
  const pool: SciForgeSession[] = Object.values(sessionsByScenario).filter((s): s is SciForgeSession => Boolean(s));
  const items = pool
    .filter((session) => sidebarSessionActivityScore(session) > 0)
    .map((session) => ({
      sessionId: session.sessionId,
      scenarioId: session.scenarioId,
      title: sidebarThreadTitle(session, locale),
      detail: sidebarThreadDetail(session, locale),
      updatedAt: session.updatedAt || session.createdAt,
      createdAt: session.createdAt,
      pinned: pinned.has(session.sessionId),
    }));
  return sortSidebarThreadItems(items, sort).slice(0, limit).map((item) => ({
    sessionId: item.sessionId,
    scenarioId: item.scenarioId,
    title: item.title,
    detail: item.detail,
    updatedAt: item.updatedAt,
    createdAt: item.createdAt,
    pinned: item.pinned,
    state: 'active',
  }));
}

export function buildSidebarArchivedThreadItems(
  archivedSessions: SciForgeSession[],
  options: SidebarThreadBuildOptions = {},
): SidebarThreadItem[] {
  const sort = options.sort ?? 'updatedAt';
  const pinned = new Set(options.pinnedThreadIds ?? []);
  const locale = options.locale;
  const items = archivedSessions
    .filter((session) => sidebarSessionActivityScore(session) > 0)
    .map((session) => ({
      sessionId: session.sessionId,
      scenarioId: session.scenarioId,
      title: sidebarThreadTitle(session, locale),
      detail: sidebarThreadDetail(session, locale),
      updatedAt: session.updatedAt || session.createdAt,
      createdAt: session.createdAt,
      pinned: pinned.has(session.sessionId),
      session,
    }));
  return sortSidebarThreadItems(items, sort).map((item) => {
    const state = sidebarArchivedSessionState(item.session);
    return {
      sessionId: item.sessionId,
      scenarioId: item.scenarioId,
      title: item.title,
      detail: item.detail,
      updatedAt: item.updatedAt,
      createdAt: item.createdAt,
      pinned: item.pinned,
      state,
      archived: state === 'archived',
      discarded: state === 'discarded',
    };
  });
}

function sortSidebarThreadItems<T extends { createdAt?: string; pinned?: boolean; updatedAt?: string }>(
  items: T[],
  sort: SidebarSortMode = 'updatedAt',
): T[] {
  return [...items].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    const left = sidebarThreadSortTime(a, sort);
    const right = sidebarThreadSortTime(b, sort);
    return right - left;
  });
}

function sidebarThreadSortTime(
  item: { createdAt?: string; updatedAt?: string },
  sort: SidebarSortMode,
): number {
  const primary = sort === 'createdAt' ? item.createdAt : item.updatedAt;
  const fallback = sort === 'createdAt' ? item.updatedAt : item.createdAt;
  const time = Date.parse(primary ?? fallback ?? '');
  return Number.isFinite(time) ? time : 0;
}

function sidebarArchivedSessionState(session: SciForgeSession): SidebarCursorAgentThreadState {
  if (isSidebarRetainedHistorySession(session)) return 'active';
  if (session.archiveState === 'archived' || session.archiveState === 'discarded') return session.archiveState;
  const latestVersionReason = session.versions[0]?.reason ?? '';
  return /deleted|discard|remove|删除|丢弃/i.test(`${session.title} ${latestVersionReason}`)
    ? 'discarded'
    : 'archived';
}

function isSidebarRetainedHistorySession(session: SciForgeSession): boolean {
  if (!session.archiveState) return true;
  const latestReason = session.versions[0]?.reason ?? '';
  return session.archiveState === 'archived' && /new chat (?:archived|retained) previous session/i.test(latestReason);
}

function buildSidebarDraftThreadItems(
  sessionsByScenario: Partial<Record<ScenarioInstanceId, SciForgeSession>>,
  locale?: SupportedLocale,
  activeSessionId?: string,
): SidebarThreadItem[] {
  if (!activeSessionId) return [];
  return Object.values(sessionsByScenario)
    .filter((session): session is SciForgeSession => {
      if (!session) return false;
      if (session.sessionId !== activeSessionId) return false;
      return sidebarSessionActivityScore(session) === 0;
    })
    .map((session) => ({
      sessionId: session.sessionId,
      scenarioId: session.scenarioId,
      title: shellText(locale, { 'zh-CN': '新聊天', 'en-US': 'New chat' }),
      detail: shellText(locale, { 'zh-CN': '草稿就绪', 'en-US': 'Draft ready' }),
      updatedAt: session.updatedAt || session.createdAt,
      createdAt: session.createdAt,
      state: 'draft',
    }));
}

export function buildSidebarProjectThreadGroups(
  config: SciForgeConfig,
  sessionsByScenario: Partial<Record<ScenarioInstanceId, SciForgeSession>>,
  archivedSessions?: SciForgeSession[],
  options: SidebarProjectBuildOptions = {},
): SidebarProjectThreadGroup[] {
  const layout = options.layout ?? 'by-project';
  const threadLimit = options.limit ?? Number.POSITIVE_INFINITY;
  const locale = options.locale;
  const threadItems = buildSidebarThreadItems(sessionsByScenario, {
    sort: options.sort,
    pinnedThreadIds: options.pinnedThreadIds,
    limit: threadLimit,
    locale,
  });
  if (layout === 'chronological') {
    const archivedThreadItems = buildSidebarArchivedThreadItems(archivedSessions ?? [], {
      sort: options.sort,
      pinnedThreadIds: options.pinnedThreadIds,
      locale,
    });
    const retainedThreads = archivedThreadItems.filter(isSidebarVisibleRetainedThread);
    const hiddenArchivedThreads = archivedThreadItems.filter((thread) => !isSidebarVisibleRetainedThread(thread));
    return [{
      id: SIDEBAR_CHRONOLOGICAL_PROJECT_ID,
      label: shellText(locale, { 'zh-CN': '全部聊天', 'en-US': 'All chats' }),
      detail: config.workspacePath,
      current: true,
      threads: sortSidebarThreadItems([...threadItems, ...retainedThreads], options.sort).slice(0, threadLimit),
      draftThreads: buildSidebarDraftThreadItems(sessionsByScenario, locale, options.activeSessionId),
      archivedThreads: hiddenArchivedThreads,
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
    const { sessionsByScenario: projectSessions, archivedSessions: projectArchivedSessions } = resolveSidebarProjectSessionBundle(
      projectPath,
      options.activeWorkspacePath ?? config.workspacePath,
      sessionsByScenario,
      archivedSessions,
      options.projectSessionsByPath,
    );
    const activeThreads = buildSidebarThreadItems(projectSessions, {
      sort: options.sort,
      pinnedThreadIds: options.pinnedThreadIds,
      limit: threadLimit,
      locale,
    });
    const archivedThreadItems = buildSidebarArchivedThreadItems(projectArchivedSessions, {
      sort: options.sort,
      pinnedThreadIds: options.pinnedThreadIds,
      locale,
    });
    const retainedThreads = archivedThreadItems.filter(isSidebarVisibleRetainedThread);
    const archivedThreads = archivedThreadItems.filter((thread) => !isSidebarVisibleRetainedThread(thread));
    const threads = sortSidebarThreadItems([...activeThreads, ...retainedThreads], options.sort).slice(0, threadLimit);
    return {
      ...project,
      threads,
      draftThreads: buildSidebarDraftThreadItems(projectSessions, locale, project.current ? options.activeSessionId : undefined),
      archivedThreads,
    };
  });
}

function isSidebarVisibleRetainedThread(thread: SidebarThreadItem) {
  return thread.state === 'active' && !thread.archived && !thread.discarded;
}

export function buildSidebarCursorAgentProjectionForShell(
  config: SciForgeConfig,
  groups: SidebarProjectThreadGroup[],
  options: {
    sort?: SidebarSortMode;
    searchQuery?: string;
    currentBranch?: string;
    workspaceStatus?: string;
    activeProjectId?: string;
    activeThreadId?: string;
    pinnedThreadIds?: string[];
    locale?: SupportedLocale;
  } = {},
): SidebarCursorAgentProjection {
  const locale = options.locale;
  const currentProject = groups.find((group) => group.id === options.activeProjectId)
    ?? groups.find((group) => group.current)
    ?? groups[0];
  return buildSidebarCursorAgentProjection({
    workspace: {
      id: config.workspacePath || 'current-workspace',
      label: pathBasename(config.workspacePath) || shellText(locale, { 'zh-CN': '当前工作区', 'en-US': 'Current workspace' }),
      path: config.workspacePath,
      currentBranch: options.currentBranch,
      localEnvironment: {
        label: shellText(locale, { 'zh-CN': '本地环境', 'en-US': 'Local environment' }),
        detail: config.workspacePath
          ? (options.workspaceStatus || shellText(locale, { 'zh-CN': '就绪', 'en-US': 'Ready' }))
          : shellText(locale, { 'zh-CN': '未选择工作区', 'en-US': 'Workspace not selected' }),
        state: config.workspacePath ? workspaceStatusState(options.workspaceStatus) : 'unknown',
      },
      context: {
        label: shellText(locale, { 'zh-CN': '上下文', 'en-US': 'Context' }),
        limit: config.maxContextWindowTokens,
        state: config.maxContextWindowTokens > 0 ? 'ready' : 'unknown',
      },
    },
    projects: groups.map((group) => ({
      id: group.id,
      label: group.label,
      path: group.detail,
      current: group.current,
      pinnedThreadIds: options.pinnedThreadIds,
      threads: sidebarRenderableThreadItems(group).map((thread) => ({
        id: thread.sessionId,
        sessionId: thread.sessionId,
        scenarioId: thread.scenarioId,
        title: thread.title,
        detail: thread.detail,
        updatedAt: thread.updatedAt,
        createdAt: thread.createdAt,
        state: thread.state ?? 'active',
        pinned: thread.pinned,
      })),
      archivedThreads: sidebarHiddenArchiveThreadItems(group).filter((thread) => thread.archived !== false && !thread.discarded).map((thread) => ({
        id: thread.sessionId,
        sessionId: thread.sessionId,
        scenarioId: thread.scenarioId,
        title: thread.title,
        detail: thread.detail,
        updatedAt: thread.updatedAt,
        createdAt: thread.createdAt,
        state: 'archived',
        archived: true,
        pinned: thread.pinned,
      })),
      discardedThreads: sidebarHiddenArchiveThreadItems(group).filter((thread) => thread.discarded).map((thread) => ({
        id: thread.sessionId,
        sessionId: thread.sessionId,
        scenarioId: thread.scenarioId,
        title: thread.title,
        detail: thread.detail,
        updatedAt: thread.updatedAt,
        createdAt: thread.createdAt,
        state: 'discarded',
        discarded: true,
        pinned: thread.pinned,
      })),
    })),
    selection: {
      projectId: currentProject?.id,
      threadId: options.activeThreadId,
    },
    presentation: {
      sort: toCursorAgentSortMode(options.sort),
      searchQuery: options.searchQuery,
      includeArchived: true,
      includeDiscarded: true,
    },
  });
}

function toCursorAgentSortMode(sort: SidebarSortMode | undefined): SidebarCursorAgentSortMode {
  return sort === 'createdAt' ? 'createdAt' : 'updatedAt';
}

function workspaceStatusState(status: string | undefined): SidebarCursorAgentStatus['state'] {
  const value = (status ?? '').trim();
  if (!value) return 'ready';
  if (/error|failed|missing|不可用|失败|错误|未连接|未选择/i.test(value)) return 'warning';
  if (/sync|loading|连接中|加载中|同步/i.test(value)) return 'syncing';
  return 'ready';
}

export function buildSidebarSearchMatches(
  query: string,
  sessionsByScenario: Partial<Record<ScenarioInstanceId, SciForgeSession>>,
  options: {
    groups?: SidebarProjectThreadGroup[];
    archivedSessions?: SciForgeSession[];
    locale?: SupportedLocale;
  } = {},
): SidebarSearchMatch[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  const matches: SidebarSearchMatch[] = [];
  const locale = options.locale;

  for (const item of navItems) {
    const label = sidebarNavItemLabel(item.id, item.label, locale);
    if (containsNeedle(`${label} ${item.label} ${item.id}`, needle)) {
      matches.push({
        id: `page:${item.id}`,
        label,
        detail: shellText(locale, { 'zh-CN': '页面', 'en-US': 'Page' }),
        page: item.id,
      });
    }
  }
  for (const scenario of scenarios) {
    const haystack = `${scenario.name} ${scenario.domain} ${scenario.desc} ${scenario.tools.join(' ')}`;
    if (containsNeedle(haystack, needle)) {
      matches.push({
        id: `scenario:${scenario.id}`,
        label: scenario.name,
        detail: shellText(locale, { 'zh-CN': '聊天模式', 'en-US': 'Chat mode' }),
        page: 'workbench',
        scenarioId: scenario.id,
      });
    }
  }
  for (const thread of buildSidebarThreadItems(sessionsByScenario, { locale })) {
    if (containsNeedle(`${thread.title} ${thread.detail} ${thread.scenarioId}`, needle)) {
      matches.push({
        id: `thread:${thread.sessionId}`,
        label: thread.title,
        detail: thread.detail,
        page: 'workbench',
        scenarioId: thread.scenarioId,
        sessionId: thread.sessionId,
        threadState: thread.state,
      });
    }
  }
  for (const project of options.groups ?? []) {
    if (containsNeedle(project.label, needle)) {
      const projectTargetId = sidebarSearchProjectTargetId(project);
      matches.push({
        id: sidebarSearchMatchId('project', project.id || project.label),
        label: project.label,
        detail: project.current
          ? shellText(locale, { 'zh-CN': '当前项目', 'en-US': 'Current project' })
          : shellText(locale, { 'zh-CN': '项目', 'en-US': 'Project' }),
        page: 'workbench',
        projectId: projectTargetId,
      });
    }
    for (const thread of sidebarSearchableThreadItems(project)) {
      if (containsNeedle(`${thread.title} ${thread.detail} ${thread.scenarioId}`, needle)) {
        const projectTargetId = sidebarSearchProjectTargetId(project);
        matches.push({
          id: `${thread.state === 'archived' || thread.state === 'discarded' ? 'archived-thread' : thread.state === 'draft' ? 'draft-thread' : 'thread'}:${thread.sessionId}`,
          label: thread.title,
          detail: thread.state === 'discarded'
            ? shellText(locale, { 'zh-CN': '已删除聊天', 'en-US': 'Deleted chat' })
            : thread.state === 'archived'
              ? shellText(locale, { 'zh-CN': '已归档聊天', 'en-US': 'Archived chat' })
              : thread.state === 'draft'
                ? shellText(locale, { 'zh-CN': '草稿聊天', 'en-US': 'Draft chat' })
                : thread.detail,
          page: 'workbench',
          scenarioId: thread.scenarioId,
          projectId: projectTargetId,
          sessionId: thread.sessionId,
          threadState: thread.state,
        });
      }
    }
  }
  for (const thread of buildSidebarArchivedThreadItems(options.archivedSessions ?? [], { locale })) {
    if (containsNeedle(`${thread.title} ${thread.detail} ${thread.scenarioId}`, needle)) {
      matches.push({
        id: `${thread.discarded ? 'archived-thread-discarded' : 'archived-thread'}:${thread.sessionId}`,
        label: thread.title,
        detail: thread.discarded
          ? shellText(locale, { 'zh-CN': '已删除聊天', 'en-US': 'Deleted chat' })
          : shellText(locale, { 'zh-CN': '已归档聊天', 'en-US': 'Archived chat' }),
        page: 'workbench',
        scenarioId: thread.scenarioId,
        sessionId: thread.sessionId,
        threadState: thread.state,
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

function sidebarThreadDetail(session: SciForgeSession, locale?: SupportedLocale) {
  const latestMessage = [...session.messages].reverse().find((message) => !message.id.startsWith('seed'));
  if (latestMessage) {
    const snippet = sidebarUserSemanticSnippet(latestMessage.content);
    if (snippet) {
      if (latestMessage.role === 'user') {
        return shellText(locale, { 'zh-CN': `上次提问：${snippet}`, 'en-US': `Last question: ${snippet}` });
      }
      if (latestMessage.role === 'scenario') {
        return shellText(locale, { 'zh-CN': `上次回答：${snippet}`, 'en-US': `Last answer: ${snippet}` });
      }
      return shellText(locale, { 'zh-CN': `最近更新：${snippet}`, 'en-US': `Last update: ${snippet}` });
    }
    return latestMessage.role === 'user'
      ? shellText(locale, { 'zh-CN': '最近提问', 'en-US': 'Recent question' })
      : shellText(locale, { 'zh-CN': '最近进展', 'en-US': 'Recent progress' });
  }
  if (session.runs.length || session.artifacts.length || session.executionUnits.length || session.notebook.length) {
    return shellText(locale, { 'zh-CN': '已有结果', 'en-US': 'Results available' });
  }
  return shellText(locale, { 'zh-CN': '新聊天', 'en-US': 'New chat' });
}

function sidebarThreadStateLabel(state: SidebarCursorAgentThreadState, locale?: SupportedLocale) {
  if (state === 'draft') return shellText(locale, { 'zh-CN': '草稿', 'en-US': 'Draft' });
  if (state === 'archived') return shellText(locale, { 'zh-CN': '已归档', 'en-US': 'Archived' });
  if (state === 'discarded') return shellText(locale, { 'zh-CN': '已删除', 'en-US': 'Deleted' });
  return '';
}

function sidebarThreadAgeLabel(value: string | undefined, locale?: SupportedLocale) {
  const time = Date.parse(value ?? '');
  if (!Number.isFinite(time)) return shellText(locale, { 'zh-CN': '刚刚', 'en-US': 'now' });
  const diffMs = Math.max(0, Date.now() - time);
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return shellText(locale, { 'zh-CN': '刚刚', 'en-US': 'now' });
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days}d`;
  return new Date(time).toLocaleDateString(locale ?? SHELL_MODEL_DEFAULT_LOCALE, { month: 'short', day: 'numeric' });
}

function containsNeedle(value: string, needle: string) {
  return value.toLocaleLowerCase().includes(needle);
}

function sidebarNavItemLabel(pageId: PageId, fallback: string, locale?: SupportedLocale) {
  switch (pageId) {
    case 'workbench':
      return shellText(locale, { 'zh-CN': '聊天', 'en-US': 'Chat' });
    case 'components':
      return shellText(locale, { 'zh-CN': '应用', 'en-US': 'Apps' });
    case 'browser':
      return shellText(locale, { 'zh-CN': '浏览器', 'en-US': 'Browser' });
    case 'timeline':
      return shellText(locale, { 'zh-CN': '时间线', 'en-US': 'Timeline' });
    case 'feedback':
      return shellText(locale, { 'zh-CN': '反馈', 'en-US': 'Feedback' });
    case 'settings':
      return shellText(locale, { 'zh-CN': '设置', 'en-US': 'Settings' });
    default:
      return fallback;
  }
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
    const key = sidebarSearchMatchDedupeKey(match);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sidebarSearchMatchDedupeKey(match: SidebarSearchMatch) {
  if (match.sessionId) {
    return `thread:${match.scenarioId ?? ''}:${match.sessionId}:${match.threadState ?? ''}`;
  }
  if (match.projectId) return `project:${match.projectId}`;
  return match.id;
}

function sidebarSearchMatchId(prefix: string, raw: string) {
  let hash = 2166136261;
  for (let index = 0; index < raw.length; index += 1) {
    hash ^= raw.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}:${(hash >>> 0).toString(36)}`;
}

function sidebarSearchProjectTargetId(project: Pick<SidebarProjectThreadGroup, 'id' | 'label'>) {
  return sidebarSearchMatchId('project-target', project.id || project.label);
}

export function findSidebarThreadSearchTarget(
  groups: SidebarProjectThreadGroup[],
  match: SidebarSearchMatch,
): { project: SidebarProjectThreadGroup; thread: SidebarThreadItem } | undefined {
  if (!match.sessionId) return undefined;
  const projects = match.projectId
    ? groups.filter((project) => sidebarSearchProjectTargetId(project) === match.projectId)
    : groups;
  for (const project of projects) {
    const thread = sidebarSearchableThreadItems(project).find((item) => (
      item.sessionId === match.sessionId && (!match.scenarioId || item.scenarioId === match.scenarioId)
    ));
    if (thread) return { project, thread };
  }
  return undefined;
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
  onDiscardThread,
  onRestoreThread,
  onArchiveProjectChats,
  onRemoveSidebarProject,
  onSearchNavigate,
  onOpenAutomations,
  onOpenCustomize,
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
  onArchiveThread?: (scenarioId: ScenarioInstanceId, sessionId: string, project?: SidebarProjectThreadGroup) => boolean | void | Promise<boolean | void>;
  onDiscardThread?: (scenarioId: ScenarioInstanceId, sessionId: string, project?: SidebarProjectThreadGroup) => boolean | void | Promise<boolean | void>;
  onRestoreThread?: (scenarioId: ScenarioInstanceId, sessionId: string, project?: SidebarProjectThreadGroup) => boolean | void | Promise<boolean | void>;
  onArchiveProjectChats?: (project: SidebarProjectThreadGroup) => boolean | void | Promise<boolean | void>;
  onRemoveSidebarProject?: (project: SidebarProjectThreadGroup) => void;
  onSearchNavigate?: (query: string) => void;
  onOpenAutomations?: () => void;
  onOpenCustomize?: () => void;
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
  const { locale, t } = useI18n();
  const workspaceRoot = explorerWorkspaceRoot(config);
  const [collapsed, setCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(244);
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
  const [projectThreadVisibleCounts, setProjectThreadVisibleCounts] = useState<Record<string, number>>({});
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
  const sidebarProjectThreadGroups = useMemo(
    () => buildSidebarProjectThreadGroups(config, sidebarSessions, archivedSessions, {
      layout: sidebarPreferences.layout,
      sort: sidebarPreferences.sort,
      pinnedThreadIds: sidebarPreferences.pinnedThreadIds,
      projectOrder: sidebarPreferences.projectOrder,
      projectSessionsByPath,
      activeWorkspacePath,
      activeSessionId: sidebarSessions[scenarioId]?.sessionId,
      locale,
    }),
    [config, sidebarSessions, archivedSessions, sidebarPreferences, projectSessionsByPath, activeWorkspacePath, scenarioId, locale],
  );
  const sidebarSearchMatches = useMemo(
    () => {
      const matches = buildSidebarSearchMatches(sidebarSearchQuery, sidebarSessions, {
        groups: sidebarProjectThreadGroups,
        archivedSessions,
        locale,
      });
      if (sidebarPreferences.visibleSections.archiveUnread) return matches;
      return matches.filter((match) => match.threadState !== 'archived' && match.threadState !== 'discarded');
    },
    [sidebarSearchQuery, sidebarSessions, sidebarProjectThreadGroups, archivedSessions, locale, sidebarPreferences.visibleSections.archiveUnread],
  );
  const cursorSidebarRegion = useMemo(() => {
    const projection = buildSidebarCursorAgentProjectionForShell(config, sidebarProjectThreadGroups, {
      sort: sidebarPreferences.sort,
      searchQuery: sidebarSearchQuery,
      workspaceStatus,
      activeProjectId: sidebarProjectPath(activeWorkspacePath || config.workspacePath),
      activeThreadId: sidebarSessions[scenarioId]?.sessionId,
      pinnedThreadIds: sidebarPreferences.pinnedThreadIds,
      locale,
    });
    return sidebarCursorAgentRegionDetail(projection);
  }, [config, sidebarProjectThreadGroups, sidebarPreferences.sort, sidebarSearchQuery, workspaceStatus, activeWorkspacePath, sidebarSessions, scenarioId, sidebarPreferences.pinnedThreadIds, locale]);
  const pinnedThreadIds = useMemo(() => new Set(sidebarPreferences.pinnedThreadIds), [sidebarPreferences.pinnedThreadIds]);
  const readThreadIds = useMemo(() => new Set(sidebarPreferences.readThreadIds), [sidebarPreferences.readThreadIds]);
  const sidebarProjectContextMenuProject = useMemo(
    () => (sidebarProjectMenu?.kind === 'project'
      ? sidebarProjectThreadGroups.find((project) => project.id === sidebarProjectMenu.projectId)
      : undefined),
    [sidebarProjectMenu, sidebarProjectThreadGroups],
  );
  const showWorkbenchNav = page === 'workbench';
  const showSidebarWorkspaceExplorer = false;
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
    if (!showWorkbenchNav) return;
    function handleNewAgentShortcut(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      if (event.key.toLowerCase() !== 'n') return;
      const project = sidebarProjectThreadGroups.find((item) => item.current) ?? sidebarProjectThreadGroups[0];
      if (!project) return;
      event.preventDefault();
      startSidebarProjectNewChat(project);
    }
    window.addEventListener('keydown', handleNewAgentShortcut);
    return () => window.removeEventListener('keydown', handleNewAgentShortcut);
  }, [showWorkbenchNav, sidebarProjectThreadGroups, onProjectNewChat]);

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
    if (!sidebarExpanded || !showSidebarWorkspaceExplorer || !workspaceRoot) return;
    void (async () => {
      try {
        setWorkspaceError('');
        const entries = await listWorkspace(workspaceRoot, config);
        setFolderChildren((prev) => ({ ...prev, [workspaceRoot]: sortWorkspaceEntries(entries) }));
        setWorkspaceNotice(entries.length
          ? t({ 'zh-CN': `已加载 ${entries.length} 项`, 'en-US': `${entries.length} items loaded` })
          : t({ 'zh-CN': '文件夹为空', 'en-US': 'Folder is empty' }));
      } catch (err) {
        setFolderChildren({});
        setWorkspaceError(err instanceof Error ? err.message : String(err));
        setWorkspaceNotice('');
      }
    })();
  }, [sidebarExpanded, workspaceRoot, config.workspaceWriterBaseUrl, config.workspacePath, t]);

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

  function workspaceActionSuccessText(action: WorkspaceAction) {
    if (action === workspaceActions.createFile) return t({ 'zh-CN': '文件已创建。', 'en-US': 'File created.' });
    if (action === workspaceActions.createFolder) return t({ 'zh-CN': '文件夹已创建。', 'en-US': 'Folder created.' });
    if (action === workspaceActions.rename) return t({ 'zh-CN': '资源已重命名。', 'en-US': 'Item renamed.' });
    if (action === workspaceActions.moveFile) return t({ 'zh-CN': '资源已移动。', 'en-US': 'Item moved.' });
    if (action === workspaceActions.copyFile) return t({ 'zh-CN': '资源已复制。', 'en-US': 'Item copied.' });
    if (action === workspaceActions.delete) return t({ 'zh-CN': '资源已删除。', 'en-US': 'Item deleted.' });
    return workspaceActionSuccessMessage(action);
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
      setWorkspaceNotice(n
        ? t({ 'zh-CN': `已加载 ${n} 项`, 'en-US': `${n} items loaded` })
        : t({ 'zh-CN': '文件夹为空', 'en-US': 'Folder is empty' }));
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
      setWorkspaceNotice(t({ 'zh-CN': `已打开 ${file.name}`, 'en-US': `Opened ${file.name}` }));
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
      setWorkspaceNotice(t({ 'zh-CN': `已保存 ${file.name}`, 'en-US': `Saved ${file.name}` }));
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
      const name = window.prompt(t({ 'zh-CN': '新文件名', 'en-US': 'New file name' }), 'notes.md');
      if (!name) return;
      targetPath = `${basePath.replace(/\/+$/, '')}/${name}`;
    } else if (action === workspaceActions.createFolder) {
      const name = window.prompt(t({ 'zh-CN': '新文件夹名', 'en-US': 'New folder name' }), 'new-folder');
      if (!name) return;
      targetPath = `${basePath.replace(/\/+$/, '')}/${name}`;
    } else if (action === workspaceActions.rename) {
      if (!entry) return;
      const name = window.prompt(t({ 'zh-CN': '重命名为', 'en-US': 'Rename to' }), entry.name);
      if (!name || name === entry.name) return;
      renameTarget = `${entry.path.slice(0, -entry.name.length)}${name}`;
    } else if (action === workspaceActions.delete) {
      if (!entry || !window.confirm(t({ 'zh-CN': `删除 ${entry.name}？`, 'en-US': `Delete ${entry.name}?` }))) return;
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
      setWorkspaceNotice(workspaceActionSuccessText(action));
    } catch (err) {
      setWorkspaceError(err instanceof Error ? err.message : String(err));
      setWorkspaceNotice('');
    }
  }

  async function initializeWorkspacePath() {
    const root = config.workspacePath.trim();
    if (!root) {
      setWorkspaceError(t({ 'zh-CN': '请先填写项目路径。', 'en-US': 'Set the project path first.' }));
      return;
    }
    try {
      setWorkspaceError('');
      setWorkspaceNotice(t({ 'zh-CN': '正在创建 SciForge 项目工作区...', 'en-US': 'Creating SciForge project workspace...' }));
      await mutateWorkspaceFile(config, workspaceActions.createFolder, { path: root });
      await mutateWorkspaceFile(config, workspaceActions.createFolder, { path: `${root.replace(/\/+$/, '')}/.sciforge` });
      for (const resource of ['tasks', 'logs', 'task-results', 'scenarios', 'exports', 'artifacts', 'sessions', 'versions']) {
        await mutateWorkspaceFile(config, workspaceActions.createFolder, { path: `${root.replace(/\/+$/, '')}/.sciforge/${resource}` });
      }
      await refreshExplorer();
      setWorkspaceNotice(t({
        'zh-CN': 'SciForge 项目工作区已创建；可以导入 package 或运行场景。',
        'en-US': 'SciForge project workspace is ready; you can import packages or run scenarios.',
      }));
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
    const label = targets.length > 1 ? t({ 'zh-CN': `${targets.length} 项`, 'en-US': `${targets.length} items` }) : targets[0].name;
    if (!window.confirm(t({ 'zh-CN': `删除 ${label}？`, 'en-US': `Delete ${label}?` }))) return;
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
      setWorkspaceNotice(targets.length > 1
        ? t({ 'zh-CN': `已删除 ${targets.length} 项`, 'en-US': `Deleted ${targets.length} items` })
        : workspaceActionSuccessText(workspaceActions.delete));
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
    setWorkspaceNotice(targets.length > 1
      ? t({ 'zh-CN': `已复制 ${targets.length} 个路径`, 'en-US': `Copied ${targets.length} paths` })
      : t({ 'zh-CN': `已复制路径 ${paths}`, 'en-US': `Copied path ${paths}` }));
  }

  async function handleContextMenuCopyRelativePath() {
    const menu = contextMenu;
    setContextMenu(null);
    const targets = menu ? contextMenuTargets(menu) : [];
    if (!targets.length) return;
    const root = explorerWorkspaceRoot(config);
    const paths = targets.map((target) => toWorkspaceRelativePath(root, target.path)).join('\n');
    await navigator.clipboard?.writeText(paths);
    setWorkspaceNotice(targets.length > 1
      ? t({ 'zh-CN': `已复制 ${targets.length} 个相对路径`, 'en-US': `Copied ${targets.length} relative paths` })
      : t({ 'zh-CN': `已复制相对路径 ${paths}`, 'en-US': `Copied relative path ${paths}` }));
  }

  async function handleContextMenuRevealInFolder() {
    const entry = contextMenu?.entry;
    setContextMenu(null);
    if (!entry?.path) return;
    try {
      setWorkspaceError('');
      await openWorkspaceObject(config, 'reveal-in-folder', entry.path, config.workspacePath);
      setWorkspaceNotice(t({ 'zh-CN': `已在系统文件管理器定位 ${entry.name}`, 'en-US': `Revealed ${entry.name} in the system file manager` }));
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
      setWorkspaceNotice(t({ 'zh-CN': `已使用系统默认方式打开 ${entry.name}`, 'en-US': `Opened ${entry.name} with the system default app` }));
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
      setWorkspaceNotice(t({ 'zh-CN': `已在工作台打开 ${file.name}`, 'en-US': `Opened ${file.name} in the workbench` }));
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
    setWorkspaceNotice(targets.length > 1
      ? t({ 'zh-CN': `已剪切 ${targets.length} 项`, 'en-US': `Cut ${targets.length} items` })
      : t({ 'zh-CN': `已剪切 ${targets[0].name}`, 'en-US': `Cut ${targets[0].name}` }));
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
    setWorkspaceNotice(targets.length > 1
      ? t({ 'zh-CN': `已复制 ${targets.length} 项`, 'en-US': `Copied ${targets.length} items` })
      : t({ 'zh-CN': `已复制 ${targets[0].name}`, 'en-US': `Copied ${targets[0].name}` }));
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
      setWorkspaceNotice(clipboard.mode === 'cut' ? workspaceActionSuccessText(workspaceActions.moveFile) : workspaceActionSuccessText(workspaceActions.copyFile));
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

  function resolveSidebarMenuReference(
    kind: SidebarProjectMenu['kind'],
    event: ReactMouseEvent,
  ) {
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
      ...(base.kind === 'global'
        ? { reference: resolveSidebarMenuReference(base.kind, event) }
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

  function updateSidebarPreferences(next: SidebarPreferences | ((current: SidebarPreferences) => SidebarPreferences), message?: string) {
    setSidebarPreferences((current) => {
      const resolved = typeof next === 'function' ? next(current) : next;
      saveSidebarPreferences(resolved);
      return resolved;
    });
    setSidebarProjectMenu(null);
    if (message) setWorkspaceNotice(message);
  }

  function groupSidebarByRepository() {
    updateSidebarPreferences(
      (current) => ({ ...current, layout: 'by-project' }),
      t({ 'zh-CN': '已按仓库分组。', 'en-US': 'Grouped by Repository.' }),
    );
  }

  function toggleSidebarVisibleFilter(section: SidebarVisibleSection) {
    updateSidebarPreferences((current) => toggleSidebarVisibleSection(current, section));
  }

  function collapseAllSidebarProjects() {
    setAllProjectThreadsCollapsed(true);
    setProjectThreadVisibleCounts({});
    setSidebarProjectMenu(null);
    setWorkspaceNotice(t({ 'zh-CN': '已折叠所有仓库聊天。', 'en-US': 'Collapsed all repository chats.' }));
  }

  function markAllSidebarThreadsAsRead() {
    const visibleThreadIds = sidebarProjectThreadGroups.flatMap((project) => sidebarRenderableThreadItems(project).map((thread) => thread.sessionId));
    updateSidebarPreferences(
      (current) => markThreadIdsRead(current, visibleThreadIds),
      t({ 'zh-CN': '所有可见聊天已标记为已读。', 'en-US': 'All visible chats are marked as read.' }),
    );
  }

  function markSidebarProjectThreadsAsRead(project: SidebarProjectThreadGroup) {
    updateSidebarPreferences(
      (current) => markThreadIdsRead(current, sidebarRenderableThreadItems(project).map((thread) => thread.sessionId)),
      t({
        'zh-CN': `${project.label} 中的可见聊天已标记为已读。`,
        'en-US': `Visible chats in ${project.label} are marked as read.`,
      }),
    );
  }

  function toggleSidebarThreadPin(item: SidebarThreadItem) {
    updateSidebarPreferences(
      (current) => togglePinnedThreadId(current, item.sessionId),
      pinnedThreadIds.has(item.sessionId)
        ? t({ 'zh-CN': `已取消置顶：${item.title}`, 'en-US': `Unpinned: ${item.title}` })
        : t({ 'zh-CN': `已置顶：${item.title}`, 'en-US': `Pinned: ${item.title}` }),
    );
  }

  async function archiveSidebarThread(item: SidebarThreadItem, project: SidebarProjectThreadGroup) {
    setSidebarProjectMenu(null);
    if (item.state === 'draft') {
      await discardSidebarThread(item, project);
      return;
    }
    if (item.state === 'archived' || item.state === 'discarded') {
      await restoreSidebarThread(item, project);
      return;
    }
    if (!onArchiveThread) {
      setWorkspaceNotice(t({ 'zh-CN': `没有可归档的聊天：${item.title}`, 'en-US': `No chat to archive: ${item.title}` }));
      return;
    }
    try {
      setWorkspaceError('');
      const changed = await onArchiveThread(item.scenarioId, item.sessionId, project);
      if (changed === false) {
        setWorkspaceNotice(t({ 'zh-CN': `没有可归档的聊天：${item.title}`, 'en-US': `No chat to archive: ${item.title}` }));
        return;
      }
      setWorkspaceNotice(t({ 'zh-CN': `已归档聊天：${item.title}`, 'en-US': `Archived chat: ${item.title}` }));
    } catch (err) {
      setWorkspaceError(err instanceof Error ? err.message : String(err));
      setWorkspaceNotice('');
    }
  }

  async function discardSidebarThread(item: SidebarThreadItem, project: SidebarProjectThreadGroup) {
    setSidebarProjectMenu(null);
    const draft = item.state === 'draft';
    const unavailable = draft
      ? t({ 'zh-CN': `没有可丢弃的草稿：${item.title}`, 'en-US': `No draft to discard: ${item.title}` })
      : t({ 'zh-CN': `没有可删除的聊天：${item.title}`, 'en-US': `No chat to delete: ${item.title}` });
    const completed = draft
      ? t({ 'zh-CN': `已丢弃草稿：${item.title}`, 'en-US': `Discarded draft: ${item.title}` })
      : t({ 'zh-CN': `已删除聊天：${item.title}`, 'en-US': `Deleted chat: ${item.title}` });
    if (!onDiscardThread) {
      setWorkspaceNotice(unavailable);
      return;
    }
    try {
      setWorkspaceError('');
      const changed = await onDiscardThread(item.scenarioId, item.sessionId, project);
      if (changed === false) {
        setWorkspaceNotice(unavailable);
        return;
      }
      setWorkspaceNotice(completed);
    } catch (err) {
      setWorkspaceError(err instanceof Error ? err.message : String(err));
      setWorkspaceNotice('');
    }
  }

  async function restoreSidebarThread(item: SidebarThreadItem, project: SidebarProjectThreadGroup, openAfterRestore = false) {
    setSidebarProjectMenu(null);
    if (!onRestoreThread) {
      setWorkspaceNotice(t({ 'zh-CN': `没有可恢复的聊天：${item.title}`, 'en-US': `No chat to restore: ${item.title}` }));
      return;
    }
    try {
      setWorkspaceError('');
      const changed = await onRestoreThread(item.scenarioId, item.sessionId, project);
      if (changed === false) {
        setWorkspaceNotice(t({ 'zh-CN': `没有可恢复的聊天：${item.title}`, 'en-US': `No chat to restore: ${item.title}` }));
        return;
      }
      if (openAfterRestore && project.current) {
        setScenarioId(item.scenarioId);
        setPage('workbench');
      }
      setWorkspaceNotice(t({ 'zh-CN': `已恢复聊天：${item.title}`, 'en-US': `Restored chat: ${item.title}` }));
    } catch (err) {
      setWorkspaceError(err instanceof Error ? err.message : String(err));
      setWorkspaceNotice('');
    }
  }

  async function chooseWorkspaceRootPath() {
    try {
      setWorkspaceError('');
      setWorkspaceNotice(t({ 'zh-CN': '正在打开工作区选择器...', 'en-US': 'Opening workspace picker...' }));
      const picked = await resolveWorkspaceDirectoryPath(config, pathEditDraft.trim() || config.workspacePath);
      if (!picked) {
        setWorkspaceNotice('');
        return;
      }
      setPathEditDraft(picked);
      onWorkspacePathChange(picked);
      setWorkspaceNotice(t({
        'zh-CN': `已打开工作区：${pathBasename(picked) || picked}。之前的工作区仍会保留在仓库中。`,
        'en-US': `Opened workspace: ${pathBasename(picked) || picked}. Previous workspace remains available in Repositories.`,
      }));
    } catch (err) {
      setWorkspaceError(err instanceof Error ? err.message : String(err));
      setWorkspaceNotice('');
    }
  }

  function focusManualWorkspacePath() {
    setSidebarProjectMenu(null);
    const details = folderPickerRef.current;
    if (details) details.open = true;
    requestAnimationFrame(() => {
      const input = details?.querySelector<HTMLInputElement>('.workspace-path-editor');
      input?.focus();
      input?.select();
    });
  }

  function toggleAllProjectThreadsCollapsed() {
    setAllProjectThreadsCollapsed((current) => {
      const next = !current;
      if (next) {
        setProjectThreadVisibleCounts({});
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
    setWorkspaceNotice(t({ 'zh-CN': `已切换到项目 ${project.label}`, 'en-US': `Switched to project ${project.label}` }));
  }

  function startSidebarProjectNewChat(project: SidebarProjectThreadGroup) {
    setSidebarProjectMenu(null);
    onProjectNewChat?.(project);
  }

  function openProjectNewChat(project: SidebarProjectThreadGroup, event: ReactMouseEvent) {
    event.stopPropagation();
    startSidebarProjectNewChat(project);
  }

  function openSidebarAutomations() {
    setSidebarProjectMenu(null);
    if (onOpenAutomations) onOpenAutomations();
    else setPage('components');
  }

  function openSidebarCustomize() {
    setSidebarProjectMenu(null);
    if (onOpenCustomize) onOpenCustomize();
    else setPage('components');
  }

  async function archiveProjectChats(project: SidebarProjectThreadGroup) {
    setSidebarProjectMenu(null);
    if (!onArchiveProjectChats) {
      setWorkspaceNotice(t({ 'zh-CN': `${project.label} 没有可归档的活跃聊天。`, 'en-US': `${project.label} has no active chats to archive.` }));
      return;
    }
    try {
      setWorkspaceError('');
      const changed = await onArchiveProjectChats(project);
      if (changed === false) {
        setWorkspaceNotice(t({ 'zh-CN': `${project.label} 没有可归档的活跃聊天。`, 'en-US': `${project.label} has no active chats to archive.` }));
        return;
      }
      setWorkspaceNotice(t({ 'zh-CN': `已归档 ${project.label} 中的活跃聊天。`, 'en-US': `Archived active chats in ${project.label}.` }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setWorkspaceError(message.includes('没有可归档') ? '' : message);
      setWorkspaceNotice(message);
    }
  }

  function removeSidebarProject(project: SidebarProjectThreadGroup) {
    setSidebarProjectMenu(null);
    if (project.current) {
      setWorkspaceNotice(t({
        'zh-CN': '移除此项目之前请先打开另一个工作区。本地文件不会被删除。',
        'en-US': 'Open another workspace before removing this project from the sidebar. Local files are not deleted.',
      }));
      return;
    }
    try {
      setWorkspaceError('');
      onRemoveSidebarProject?.(project);
      updateSidebarPreferences(
        (current) => removeProjectFromSidebarPreferences(current, project.id),
        t({
          'zh-CN': `已从侧边栏移除 ${project.label}。本地文件未被删除。`,
          'en-US': `Removed ${project.label} from the sidebar. Local files were not deleted.`,
        }),
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
    const threadState = item.state ?? 'active';
    const archivedOrDiscarded = threadState === 'archived' || threadState === 'discarded';
    const draft = threadState === 'draft';
    const timeLabel = threadState === 'draft' ? '' : sidebarThreadAgeLabel(item.updatedAt || item.createdAt, locale);
    const showSource = sidebarPreferences.visibleSections.source;
    const showMetadata = sidebarPreferences.visibleSections.metadata;
    const isUnread = sidebarPreferences.visibleSections.archiveUnread
      && threadState === 'active'
      && !isActive
      && !readThreadIds.has(item.sessionId);
    return (
      <div
        key={`${project.id}:${item.sessionId}`}
        className={cx('sidebar-thread-row', `state-${threadState}`, isActive && 'active', isPinned && 'pinned', isUnread && 'unread')}
        title={`${item.title}${item.detail ? ` · ${item.detail}` : ''}`}
      >
        <button type="button" className="sidebar-thread-main" onClick={() => openSidebarThread(item, project)}>
          <span className={cx('sidebar-thread-status-dot', threadState, isUnread && 'unread', isPinned && !archivedOrDiscarded && 'pinned')} aria-hidden />
          <span className="sidebar-thread-title-line">
            <span className="sidebar-thread-title">{item.title}</span>
            {showMetadata ? (
              <span className="sidebar-thread-meta">
                {threadState !== 'active' ? <span className="sidebar-thread-state-badge">{sidebarThreadStateLabel(threadState, locale)}</span> : null}
                {timeLabel ? <time dateTime={item.updatedAt || item.createdAt}>{timeLabel}</time> : null}
              </span>
            ) : null}
          </span>
          {showSource ? <small className="sidebar-thread-detail">{item.detail}</small> : null}
        </button>
        <div className="sidebar-thread-actions" aria-label={t({ 'zh-CN': `${item.title} 聊天操作`, 'en-US': `${item.title} chat actions` })}>
          {archivedOrDiscarded ? (
            <button
              type="button"
              className="sidebar-project-icon-btn"
              onClick={() => { void restoreSidebarThread(item, project); }}
              title={t({ 'zh-CN': '恢复聊天', 'en-US': 'Restore chat' })}
              aria-label={t({ 'zh-CN': `恢复聊天：${item.title}`, 'en-US': `Restore chat: ${item.title}` })}
            >
              <RotateCcw size={13} />
            </button>
          ) : (
            <>
              <button
                type="button"
                className={cx('sidebar-project-icon-btn', isPinned && 'active')}
                onClick={() => toggleSidebarThreadPin(item)}
                title={isPinned
                  ? t({ 'zh-CN': '取消置顶聊天', 'en-US': 'Unpin chat' })
                  : t({ 'zh-CN': '置顶聊天', 'en-US': 'Pin chat' })}
                aria-label={isPinned
                  ? t({ 'zh-CN': `取消置顶聊天：${item.title}`, 'en-US': `Unpin chat: ${item.title}` })
                  : t({ 'zh-CN': `置顶聊天：${item.title}`, 'en-US': `Pin chat: ${item.title}` })}
              >
                <Pin size={13} />
              </button>
              {draft ? (
                <button
                  type="button"
                  className="sidebar-project-icon-btn"
                  onClick={() => { void discardSidebarThread(item, project); }}
                  title={t({ 'zh-CN': '丢弃草稿', 'en-US': 'Discard draft' })}
                  aria-label={t({ 'zh-CN': `丢弃草稿：${item.title}`, 'en-US': `Discard draft: ${item.title}` })}
                >
                  <Trash2 size={13} />
                </button>
              ) : (
                <button
                  type="button"
                  className="sidebar-project-icon-btn"
                  onClick={() => { void archiveSidebarThread(item, project); }}
                  title={t({ 'zh-CN': '归档聊天', 'en-US': 'Archive chat' })}
                  aria-label={t({ 'zh-CN': `归档聊天：${item.title}`, 'en-US': `Archive chat: ${item.title}` })}
                >
                  <Archive size={13} />
                </button>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  function openSidebarSearchMatch(match: SidebarSearchMatch) {
    if (match.sessionId) {
      const threadTarget = findSidebarThreadSearchTarget(sidebarProjectThreadGroups, match);
      if (threadTarget) {
        openSidebarThread(threadTarget.thread, threadTarget.project);
        return;
      }
    }
    if (match.projectId) {
      const project = sidebarProjectThreadGroups.find((item) => sidebarSearchProjectTargetId(item) === match.projectId);
      if (project) {
        activateSidebarProject(project);
        return;
      }
    }
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
    if (!readThreadIds.has(item.sessionId)) {
      updateSidebarPreferences((current) => markThreadIdsRead(current, [item.sessionId]));
    }
    if (!project.current) {
      activateSidebarProject(project, item);
      return;
    }
    const active = sidebarSessions[item.scenarioId];
    if (item.state === 'archived' || item.state === 'discarded' || active?.sessionId !== item.sessionId) {
      void restoreSidebarThread(item, project, true);
      return;
    }
    setScenarioId(item.scenarioId);
    setPage('workbench');
  }

  function showMoreProjectThreads(projectId: string) {
    setAllProjectThreadsCollapsed(false);
    setProjectThreadVisibleCounts((current) => {
      const project = sidebarProjectThreadGroups.find((item) => item.id === projectId);
      const total = project ? sidebarRenderableThreadItems(project).length : 0;
      const currentVisible = Math.max(SIDEBAR_PROJECT_THREAD_LIMIT, current[projectId] ?? SIDEBAR_PROJECT_THREAD_LIMIT);
      const nextVisible = total
        ? Math.min(total, currentVisible + SIDEBAR_PROJECT_THREAD_PAGE_SIZE)
        : currentVisible + SIDEBAR_PROJECT_THREAD_PAGE_SIZE;
      if (current[projectId] === nextVisible) return current;
      const next = { ...current, [projectId]: nextVisible };
      return next;
    });
  }

  function renderExplorerDepth(depth: number, dirPath: string): ReactNode {
    const entries = folderChildren[dirPath];
    if (entries === undefined) {
      return (
        <div className="explorer-loading" style={{ paddingLeft: 12 + depth * 12 }}>
          {t({ 'zh-CN': '加载中...', 'en-US': 'Loading...' })}
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
    <aside
      className={cx('sidebar', showWorkbenchNav && 'cursor-agent-sidebar', !sidebarExpanded && 'collapsed')}
      style={{ width: sidebarExpanded ? sidebarWidth : 46 }}
      data-gui-region-id={cursorSidebarRegion.regionId}
      data-gui-region-ref={cursorSidebarRegion.rendererState.projection.sidebarResourceRef}
      data-gui-region-summary={cursorSidebarRegion.summary}
    >
      <div className="sidebar-activitybar" aria-label={t({ 'zh-CN': '工作区视图', 'en-US': 'Workspace views' })}>
        <div className="brand" title="SciForge">
          <div className="brand-mark">
            <img src="/favicon.svg" alt="SciForge" width={38} height={38} />
          </div>
        </div>
        <div className="sidebar-activitybar-nav">
          {sidebarViewNavItems.map((item) => {
            const label = sidebarNavItemLabel(item.id, item.label, locale);
            return (
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
                title={label}
                aria-label={label}
                aria-current={page === item.id ? 'page' : undefined}
              >
                <item.icon size={18} />
              </button>
            );
          })}
        </div>
        <div className="sidebar-activitybar-spacer" aria-hidden />
        {showWorkbenchNav && collapsed ? (
          <button
            type="button"
            className="collapse-button top-toggle"
            onClick={() => setCollapsed(false)}
            title={t({ 'zh-CN': '展开侧边栏', 'en-US': 'Expand sidebar' })}
            aria-label={t({ 'zh-CN': '展开侧边栏', 'en-US': 'Expand sidebar' })}
          >
            <ChevronRight size={16} />
          </button>
        ) : null}
      </div>

      {showWorkbenchNav && !collapsed ? (
        <div className="sidebar-panel">
          <div className="sidebar-panel-header">
            <span>{t({ 'zh-CN': '导航', 'en-US': 'Navigation' })}</span>
            <button
              className="panel-collapse-button"
              onClick={() => setCollapsed(true)}
              title={t({ 'zh-CN': '折叠侧边栏', 'en-US': 'Collapse sidebar' })}
              aria-label={t({ 'zh-CN': '折叠侧边栏', 'en-US': 'Collapse sidebar' })}
            >
              <ChevronLeft size={16} />
            </button>
          </div>
          <div className="sidebar-panel-body" ref={panelBodyRef}>
            <div className="sidebar-panel-sections">
              <SidebarPanelBlock
                title={t({ 'zh-CN': '智能体', 'en-US': 'Agents' })}
                collapsed={panelLayout.threadsCollapsed}
                style={sidebarPanelBlockStyle(panelLayout.threadsCollapsed, panelLayout.threadsHeight)}
                toggleLabel={{
                  collapsed: t({ 'zh-CN': '展开智能体', 'en-US': 'Expand agents' }),
                  expanded: t({ 'zh-CN': '折叠智能体', 'en-US': 'Collapse agents' }),
                }}
                onToggle={() => toggleSidebarPanelSection('threads')}
              >
                  <div className="sidebar-scroll">
              <SidebarProjectChatSection
                sidebarSearchQuery={sidebarSearchQuery}
                sidebarSearchMatches={sidebarSearchMatches}
                allProjectThreadsCollapsed={allProjectThreadsCollapsed}
                activeMenuKind={sidebarProjectMenu?.kind}
                projectThreadLimit={SIDEBAR_PROJECT_THREAD_LIMIT}
                projectThreadVisibleCounts={projectThreadVisibleCounts}
                sidebarProjectThreadGroups={sidebarProjectThreadGroups}
                cursorProjectGroups={cursorSidebarRegion.rendererState.projection.groups}
                visibleSections={sidebarPreferences.visibleSections}
                onSearchQueryChange={setSidebarSearchQuery}
                onSearchSubmit={handleSidebarSearchSubmit}
                onOpenSearchMatch={openSidebarSearchMatch}
                onOpenProjectMenuAt={openSidebarProjectMenuAt}
                onToggleProjectMenu={toggleSidebarProjectMenu}
                onToggleAllProjectThreadsCollapsed={toggleAllProjectThreadsCollapsed}
                onActivateProject={activateSidebarProject}
                onShowMoreProjectThreads={showMoreProjectThreads}
                onOpenProjectNewChat={openProjectNewChat}
                onOpenAutomations={openSidebarAutomations}
                onOpenCustomize={openSidebarCustomize}
                renderSidebarThreadRow={renderSidebarThreadRow}
              />
                  </div>
              </SidebarPanelBlock>
              <div
                className="sidebar-panel-resize-handle"
                role="separator"
                aria-orientation="horizontal"
                aria-label={t({ 'zh-CN': '调整智能体区域大小', 'en-US': 'Resize agents section' })}
                onMouseDown={(event) => beginSidebarPanelResize('threads-tools', event)}
              />
              <SidebarPanelBlock
                title={t({ 'zh-CN': '工具', 'en-US': 'Tools' })}
                collapsed={panelLayout.toolsCollapsed}
                style={sidebarPanelBlockStyle(panelLayout.toolsCollapsed, panelLayout.toolsHeight)}
                toggleLabel={{
                  collapsed: t({ 'zh-CN': '展开工具', 'en-US': 'Expand tools' }),
                  expanded: t({ 'zh-CN': '折叠工具', 'en-US': 'Collapse tools' }),
                }}
                onToggle={() => toggleSidebarPanelSection('tools')}
              >
                <SidebarToolsStrip onOpenComponents={() => setPage('components')} />
              </SidebarPanelBlock>
              {showSidebarWorkspaceExplorer ? (
                <>
                  <div
                    className="sidebar-panel-resize-handle"
                    role="separator"
                    aria-orientation="horizontal"
                    aria-label={t({ 'zh-CN': '调整工具区域大小', 'en-US': 'Resize tools section' })}
                    onMouseDown={(event) => beginSidebarPanelResize('tools-explorer', event)}
                  />
                  <SidebarPanelBlock
                    title={t({ 'zh-CN': '文件', 'en-US': 'Files' })}
                    collapsed={panelLayout.explorerCollapsed}
                    className="sidebar-panel-block-explorer"
                    style={sidebarExplorerPanelStyle(panelLayout.explorerCollapsed)}
                    headerExtra={(
                      <>
                        {workspaceRoot ? <small>{pathBasename(workspaceRoot) || workspaceRoot}</small> : null}
                        <SidebarPanelToggleButton
                          collapsed={panelLayout.explorerCollapsed}
                          toggleLabel={{
                            collapsed: t({ 'zh-CN': '展开文件', 'en-US': 'Expand files' }),
                            expanded: t({ 'zh-CN': '折叠文件', 'en-US': 'Collapse files' }),
                          }}
                          onToggle={() => toggleSidebarPanelSection('explorer')}
                        />
                      </>
                    )}
                    toggleLabel={{
                      collapsed: t({ 'zh-CN': '展开文件', 'en-US': 'Expand files' }),
                      expanded: t({ 'zh-CN': '折叠文件', 'en-US': 'Collapse files' }),
                    }}
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
                aria-label={t({ 'zh-CN': '工作区文件树', 'en-US': 'Workspace file tree' })}
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
                  onWorkspacePathChange={onWorkspacePathChange}
                />
              </div>
              </div>
                  </SidebarPanelBlock>
                </>
              ) : null}
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
          aria-label={t({ 'zh-CN': '调整侧边栏大小', 'en-US': 'Resize sidebar' })}
          onMouseDown={() => {
            resizingRef.current = true;
          }}
        />
      ) : null}
      {sidebarProjectMenu?.kind === 'global' ? (
        <SidebarThreadsGlobalContextMenu
          x={sidebarProjectMenu.x}
          y={sidebarProjectMenu.y}
          visibleSections={sidebarPreferences.visibleSections}
          reference={sidebarProjectMenu.reference}
          onGroupByRepository={groupSidebarByRepository}
          onToggleVisibleSection={toggleSidebarVisibleFilter}
          onCollapseAll={collapseAllSidebarProjects}
          onMarkAllAsRead={markAllSidebarThreadsAsRead}
          onReferenceToChat={handleSidebarProjectReferenceToChat}
        />
      ) : null}
      {sidebarProjectMenu?.kind === 'create' ? (
        <SidebarProjectCreateContextMenu
          x={sidebarProjectMenu.x}
          y={sidebarProjectMenu.y}
          onNewProject={() => {
            setSidebarProjectMenu(null);
            void chooseWorkspaceRootPath();
          }}
          onOpenWorkspace={() => {
            setSidebarProjectMenu(null);
            void chooseWorkspaceRootPath();
          }}
          onSetCurrentDirectory={focusManualWorkspacePath}
        />
      ) : null}
      {sidebarProjectMenu?.kind === 'project' && sidebarProjectContextMenuProject ? (
        <SidebarProjectActionContextMenu
          x={sidebarProjectMenu.x}
          y={sidebarProjectMenu.y}
          project={sidebarProjectContextMenuProject}
          onMarkAllAsRead={() => markSidebarProjectThreadsAsRead(sidebarProjectContextMenuProject)}
          onArchiveChats={() => void archiveProjectChats(sidebarProjectContextMenuProject)}
          onRemoveProject={() => removeSidebarProject(sidebarProjectContextMenuProject)}
        />
      ) : null}
    </aside>
  );
}

export type { ConfigSaveState } from './settingsModels';
