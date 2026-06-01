import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, CalendarClock, ChevronDown, ChevronRight, ChevronsDown, Edit3, Folder, FolderPlus, Gauge, GitBranch, HardDrive, ListFilter, MoreHorizontal, PanelLeftClose, Search, SlidersHorizontal } from 'lucide-react';
import { useI18n } from '../../i18nContext';
import { cx } from '../uiPrimitives';
import type { SidebarProjectThreadGroup, SidebarSearchMatch, SidebarThreadItem } from './ShellPanels';
import type { SidebarCursorAgentProjectGroup, SidebarCursorAgentStatus } from './sidebarCursorAgentModel';
import type { SidebarVisibleSections } from './sidebarPreferences';
import { sidebarRenderableThreadItems } from './sidebarProjectThreadList';

const defaultVisibleSections: SidebarVisibleSections = {
  status: true,
  git: true,
  environment: true,
  archiveUnread: true,
  source: true,
  metadata: true,
};

type SidebarProjectMenuTarget =
  | { kind: 'global' }
  | { kind: 'create' }
  | { kind: 'project'; projectId: string };

export function SidebarProjectChatSection({
  sidebarSearchQuery,
  sidebarSearchMatches,
  allProjectThreadsCollapsed,
  activeMenuKind,
  projectThreadLimit,
  projectThreadVisibleCounts = {},
  collapsedProjectThreadIds = {},
  sidebarProjectThreadGroups,
  cursorProjectGroups,
  visibleSections = defaultVisibleSections,
  onSearchQueryChange,
  onSearchSubmit,
  onOpenSearchMatch,
  onHideSidebar,
  onFocusSearch,
  onGoBack,
  onGoForward,
  onOpenProjectMenuAt,
  onToggleProjectMenu,
  onToggleAllProjectThreadsCollapsed,
  onToggleProjectThreadsCollapsed,
  onActivateProject,
  onShowMoreProjectThreads,
  onOpenProjectNewChat,
  onOpenAutomations,
  onOpenCustomize,
  renderSidebarThreadRow,
  canGoBack = false,
  canGoForward = false,
}: {
  sidebarSearchQuery: string;
  sidebarSearchMatches: SidebarSearchMatch[];
  allProjectThreadsCollapsed: boolean;
  activeMenuKind?: 'global' | 'create' | 'project';
  projectThreadLimit: number;
  projectThreadVisibleCounts?: Record<string, number>;
  collapsedProjectThreadIds?: Record<string, boolean>;
  sidebarProjectThreadGroups: SidebarProjectThreadGroup[];
  cursorProjectGroups?: SidebarCursorAgentProjectGroup[];
  visibleSections?: SidebarVisibleSections;
  onSearchQueryChange: (value: string) => void;
  onSearchSubmit: (event: FormEvent) => void;
  onOpenSearchMatch: (match: SidebarSearchMatch) => void;
  onHideSidebar: () => void;
  onFocusSearch?: () => void;
  onGoBack: () => void;
  onGoForward: () => void;
  onOpenProjectMenuAt: (
    target: SidebarProjectMenuTarget,
    event: ReactMouseEvent,
    project?: SidebarProjectThreadGroup,
  ) => void;
  onToggleProjectMenu: (
    target: SidebarProjectMenuTarget,
    event: ReactMouseEvent,
    project?: SidebarProjectThreadGroup,
  ) => void;
  onToggleAllProjectThreadsCollapsed: () => void;
  onToggleProjectThreadsCollapsed?: (project: SidebarProjectThreadGroup) => void;
  onActivateProject: (project: SidebarProjectThreadGroup, thread?: SidebarThreadItem) => void;
  onShowMoreProjectThreads: (projectId: string) => void;
  onOpenProjectNewChat: (project: SidebarProjectThreadGroup, event: ReactMouseEvent) => void;
  onOpenAutomations: () => void;
  onOpenCustomize: (event: ReactMouseEvent) => void;
  renderSidebarThreadRow: (item: SidebarThreadItem, project: SidebarProjectThreadGroup) => ReactNode;
  canGoBack?: boolean;
  canGoForward?: boolean;
}) {
  const { t } = useI18n();
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [activeSearchIndex, setActiveSearchIndex] = useState(0);
  const primaryProject = sidebarProjectThreadGroups.find((project) => project.current) ?? sidebarProjectThreadGroups[0];
  const newAgentLabel = t({ 'zh-CN': '新建智能体', 'en-US': 'New Agent' });
  const searchLabel = t({ 'zh-CN': '搜索文件、动作、智能体', 'en-US': 'Search files, actions, agents' });
  const searchShortcut = t({ 'zh-CN': '搜索', 'en-US': 'Search' });
  const hideSidebarLabel = t({ 'zh-CN': '隐藏侧边栏', 'en-US': 'Hide Sidebar' });
  const goBackLabel = t({ 'zh-CN': '后退', 'en-US': 'Go Back' });
  const goForwardLabel = t({ 'zh-CN': '前进', 'en-US': 'Go Forward' });
  const expandAllChatsLabel = t({ 'zh-CN': '展开所有聊天', 'en-US': 'Expand all chats' });
  const collapseAllChatsLabel = t({ 'zh-CN': '折叠所有聊天', 'en-US': 'Collapse all chats' });
  const customizeLabel = t({ 'zh-CN': '自定义', 'en-US': 'Customize' });
  const automationsLabel = t({ 'zh-CN': '自动化', 'en-US': 'Automations' });
  const searchResultsLabel = t({ 'zh-CN': '命令面板搜索结果', 'en-US': 'Command palette results' });
  const searchResultRows = sidebarSearchResultRows(sidebarSearchMatches, {
    actions: t({ 'zh-CN': '动作', 'en-US': 'Actions' }),
    files: t({ 'zh-CN': '文件', 'en-US': 'Files' }),
    agents: t({ 'zh-CN': '智能体', 'en-US': 'Agents' }),
    modes: t({ 'zh-CN': '模式', 'en-US': 'Modes' }),
    models: t({ 'zh-CN': '模型', 'en-US': 'Models' }),
    skills: t({ 'zh-CN': '技能', 'en-US': 'Skills' }),
    mcp: t({ 'zh-CN': 'MCP', 'en-US': 'MCP' }),
    projects: t({ 'zh-CN': '仓库', 'en-US': 'Repositories' }),
    pages: t({ 'zh-CN': '页面', 'en-US': 'Pages' }),
    settings: t({ 'zh-CN': '设置', 'en-US': 'Settings' }),
  });

  useEffect(() => {
    setActiveSearchIndex(0);
  }, [sidebarSearchQuery, sidebarSearchMatches.length]);

  function focusSearchInput() {
    onFocusSearch?.();
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  }

  function commitSearchMatch(match: SidebarSearchMatch) {
    onOpenSearchMatch(match);
    onSearchQueryChange('');
  }

  function handleSearchKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (!sidebarSearchMatches.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveSearchIndex((current) => Math.min(sidebarSearchMatches.length - 1, current + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveSearchIndex((current) => Math.max(0, current - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      commitSearchMatch(sidebarSearchMatches[activeSearchIndex] ?? sidebarSearchMatches[0]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onSearchQueryChange('');
    }
  }

  return (
    <>
      <section className="sidebar-section sidebar-section-actions" aria-label={t({ 'zh-CN': '主操作', 'en-US': 'Primary actions' })}>
        <div className="sidebar-window-toolbar" aria-label={t({ 'zh-CN': '侧边栏窗口操作', 'en-US': 'Sidebar window actions' })}>
          <button
            type="button"
            className="sidebar-icon-command"
            onClick={onHideSidebar}
            title={hideSidebarLabel}
            aria-label={hideSidebarLabel}
          >
            <PanelLeftClose size={15} aria-hidden />
          </button>
          <button
            type="button"
            className="sidebar-icon-command"
            onClick={focusSearchInput}
            title={searchShortcut}
            aria-label={searchShortcut}
          >
            <Search size={15} aria-hidden />
          </button>
          <button
            type="button"
            className="sidebar-icon-command"
            onClick={onGoBack}
            disabled={!canGoBack}
            title={goBackLabel}
            aria-label={goBackLabel}
          >
            <ArrowLeft size={15} aria-hidden />
          </button>
          <button
            type="button"
            className="sidebar-icon-command"
            onClick={onGoForward}
            disabled={!canGoForward}
            title={goForwardLabel}
            aria-label={goForwardLabel}
          >
            <ArrowRight size={15} aria-hidden />
          </button>
        </div>
        <button
          type="button"
          className="sidebar-command sidebar-top-command sidebar-new-agent-command"
          onClick={(event) => {
            if (primaryProject) onOpenProjectNewChat(primaryProject, event);
          }}
          disabled={!primaryProject}
          aria-label={primaryProject
            ? t({ 'zh-CN': `在 ${primaryProject.label} 中新建智能体`, 'en-US': `New Agent in ${primaryProject.label}` })
            : newAgentLabel}
          title={primaryProject
            ? t({ 'zh-CN': `在 ${primaryProject.label} 中新建智能体`, 'en-US': `New Agent in ${primaryProject.label}` })
            : newAgentLabel}
        >
          <Edit3 size={15} aria-hidden />
          <span>{newAgentLabel}</span>
          <small>⌘N</small>
        </button>
        <button
          type="button"
          className="sidebar-command sidebar-top-command"
          onClick={onOpenAutomations}
          title={automationsLabel}
          aria-label={automationsLabel}
        >
          <CalendarClock size={15} aria-hidden />
          <span>{automationsLabel}</span>
        </button>
        <button
          type="button"
          className="sidebar-command sidebar-top-command"
          onClick={onOpenCustomize}
          title={customizeLabel}
          aria-label={customizeLabel}
        >
          <SlidersHorizontal size={15} aria-hidden />
          <span>{customizeLabel}</span>
        </button>
        <form className="sidebar-search" onSubmit={onSearchSubmit}>
          <Search size={15} />
          <input
            ref={searchInputRef}
            value={sidebarSearchQuery}
            onChange={(event) => onSearchQueryChange(event.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder={searchLabel}
            aria-label={searchLabel}
            aria-controls="sidebar-command-palette-results"
            aria-activedescendant={sidebarSearchMatches[activeSearchIndex] ? `sidebar-search-result-${sidebarSearchMatches[activeSearchIndex].id}` : undefined}
            aria-autocomplete="list"
          />
        </form>
        {sidebarSearchQuery.trim() ? (
          <div
            id="sidebar-command-palette-results"
            className="sidebar-search-results"
            role="listbox"
            aria-label={searchResultsLabel}
          >
            {sidebarSearchMatches.length ? searchResultRows.map((row) => row.kind === 'group' ? (
              <div key={row.id} className="sidebar-search-group-label" role="presentation">{row.label}</div>
            ) : (
              <button
                key={row.match.id}
                id={`sidebar-search-result-${row.match.id}`}
                type="button"
                role="option"
                aria-selected={row.index === activeSearchIndex}
                className={cx('sidebar-result-row', row.index === activeSearchIndex && 'active')}
                onClick={() => commitSearchMatch(row.match)}
              >
                <span>{row.match.label}</span>
                <small>{row.match.detail}</small>
                {row.match.shortcut ? <kbd>{row.match.shortcut}</kbd> : null}
              </button>
            )) : (
              <p className="sidebar-empty-note">{t({ 'zh-CN': '无结果', 'en-US': 'No results' })}</p>
            )}
          </div>
        ) : null}
      </section>
      <section className="sidebar-section sidebar-section-threads" aria-labelledby="sidebar-threads-title">
        <div
          className="sidebar-section-title"
          id="sidebar-threads-title"
          onContextMenu={(event) => {
            onOpenProjectMenuAt({ kind: 'global' }, event);
          }}
        >
          <span>{t({ 'zh-CN': '仓库', 'en-US': 'Repositories' })}</span>
          <div className="sidebar-project-title-actions">
            <button
              type="button"
              className={cx('sidebar-project-icon-btn', allProjectThreadsCollapsed && 'active')}
              onClick={onToggleAllProjectThreadsCollapsed}
              title={allProjectThreadsCollapsed ? expandAllChatsLabel : collapseAllChatsLabel}
              aria-label={allProjectThreadsCollapsed ? expandAllChatsLabel : collapseAllChatsLabel}
              aria-pressed={allProjectThreadsCollapsed}
            >
              {allProjectThreadsCollapsed ? <ChevronsDown size={14} /> : <ListFilter size={14} />}
            </button>
            <button
              type="button"
              className={cx('sidebar-project-icon-btn', activeMenuKind === 'global' && 'active')}
              onClick={(event) => onToggleProjectMenu({ kind: 'global' }, event)}
              title={t({ 'zh-CN': '自定义侧边栏', 'en-US': 'Customize Sidebar' })}
              aria-label={t({ 'zh-CN': '自定义侧边栏', 'en-US': 'Customize Sidebar' })}
              aria-haspopup="menu"
            >
              <MoreHorizontal size={15} />
            </button>
            <button
              type="button"
              className={cx('sidebar-project-icon-btn', activeMenuKind === 'create' && 'active')}
              onClick={(event) => onToggleProjectMenu({ kind: 'create' }, event)}
              title={t({ 'zh-CN': '打开工作区', 'en-US': 'Open Workspace' })}
              aria-label={t({ 'zh-CN': '打开工作区', 'en-US': 'Open Workspace' })}
              aria-haspopup="menu"
            >
              <FolderPlus size={15} />
            </button>
          </div>
        </div>
        <div className="sidebar-project-chat-scroll">
          {sidebarProjectThreadGroups.length ? (
            <div className="sidebar-project-chat-list">
              {sidebarProjectThreadGroups.map((project, index) => {
                const cursorProject = cursorProjectGroups?.[index];
                const projectThreads = sidebarRenderableThreadItems(project);
                const visibleCount = Math.min(
                  projectThreads.length,
                  Math.max(projectThreadLimit, projectThreadVisibleCounts[project.id] ?? projectThreadLimit),
                );
                const projectStatusTitle = cursorProject && visibleSections.status
                  ? projectStatusSummary(cursorProject.status)
                  : project.detail;
                const projectCollapsed = allProjectThreadsCollapsed || Boolean(collapsedProjectThreadIds[project.id]);
                const projectCollapseLabel = projectCollapsed
                  ? t({ 'zh-CN': `展开 ${project.label} 聊天`, 'en-US': `Expand chats in ${project.label}` })
                  : t({ 'zh-CN': `折叠 ${project.label} 聊天`, 'en-US': `Collapse chats in ${project.label}` });
                const visibleThreads = projectCollapsed
                  ? []
                  : projectThreads.slice(0, visibleCount);
                const hiddenThreadCount = projectCollapsed ? 0 : Math.max(0, projectThreads.length - visibleThreads.length);
                return (
                  <div
                    key={project.id}
                    className={cx('sidebar-project-chat-group', projectCollapsed && 'is-collapsed')}
                    data-gui-region-ref={cursorProject?.resourceRef}
                    data-gui-current-project={cursorProject?.current || project.current ? 'true' : undefined}
                  >
                    <div
                      className={cx('sidebar-project-chat-head', project.current && 'current')}
                      title={projectStatusTitle}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        onOpenProjectMenuAt({ kind: 'project', projectId: project.id }, event, project);
                      }}
                    >
                      <button
                        type="button"
                        className="sidebar-project-collapse-btn"
                        onClick={(event) => {
                          event.stopPropagation();
                          onToggleProjectThreadsCollapsed?.(project);
                        }}
                        title={projectCollapseLabel}
                        aria-label={projectCollapseLabel}
                        aria-expanded={!projectCollapsed}
                      >
                        {projectCollapsed ? <ChevronRight size={13} aria-hidden /> : <ChevronDown size={13} aria-hidden />}
                      </button>
                      <button
                        type="button"
                        className="sidebar-project-chat-main"
                        onClick={() => {
                          if (!project.current) {
                            onActivateProject(project);
                          }
                        }}
                      >
                        <Folder size={15} aria-hidden />
                        <span>{project.label}</span>
                      </button>
                      <div className="sidebar-project-row-actions">
                        <button
                          type="button"
                          className="sidebar-project-icon-btn"
                          onClick={(event) => onOpenProjectNewChat(project, event)}
                          title={newAgentLabel}
                          aria-label={t({ 'zh-CN': `在 ${project.label} 中新建智能体`, 'en-US': `New Agent in ${project.label}` })}
                        >
                          <Edit3 size={14} />
                        </button>
                      </div>
                    </div>
                    {cursorProject && visibleSections.status ? (
                      <ProjectStatusRow status={cursorProject.status} visibleSections={visibleSections} />
                    ) : null}
                    {visibleThreads.length ? (
                      <div className="sidebar-thread-list">
                        {visibleThreads.map((item) => renderSidebarThreadRow(item, project))}
                        {hiddenThreadCount ? (
                          <button
                            type="button"
                            className="sidebar-thread-more"
                            onClick={() => onShowMoreProjectThreads(project.id)}
                            aria-label={t({ 'zh-CN': `查看更多 ${project.label} 聊天`, 'en-US': `See more chats in ${project.label}` })}
                          >
                            <span>{t({ 'zh-CN': '查看更多', 'en-US': 'See more' })}</span>
                          </button>
                        ) : null}
                      </div>
                    ) : projectCollapsed ? null : (
                      <p className="sidebar-empty-note sidebar-project-empty">{t({ 'zh-CN': '还没有聊天', 'en-US': 'No chats yet' })}</p>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="sidebar-empty-note">{t({ 'zh-CN': '还没有聊天', 'en-US': 'No chats yet' })}</p>
          )}
        </div>
      </section>
    </>
  );
}

function ProjectStatusRow({ status, visibleSections }: { status: SidebarCursorAgentProjectGroup['status']; visibleSections: SidebarVisibleSections }) {
  const { t } = useI18n();
  const showBranch = visibleSections.git;
  const showEnvironment = visibleSections.environment;
  const showContext = visibleSections.metadata;
  if (!showBranch && !showEnvironment && !showContext) return null;
  return (
    <div className="sidebar-project-status-row" aria-label={`${t({ 'zh-CN': '项目状态', 'en-US': 'Project status' })}: ${projectStatusSummary(status)}`}>
      {showBranch ? <ProjectStatusPill icon="branch" status={status.branch} /> : null}
      {showEnvironment ? <ProjectStatusPill icon="environment" status={status.localEnvironment} /> : null}
      {showContext ? <ProjectStatusPill icon="context" status={status.context} /> : null}
    </div>
  );
}

function projectStatusSummary(status: SidebarCursorAgentProjectGroup['status']) {
  return [status.branch, status.localEnvironment, status.context]
    .map((item) => `${item.label}: ${item.detail}`)
    .join(' · ');
}

function ProjectStatusPill({
  icon,
  status,
}: {
  icon: 'branch' | 'environment' | 'context';
  status: SidebarCursorAgentStatus;
}) {
  const Icon = icon === 'branch' ? GitBranch : icon === 'environment' ? HardDrive : Gauge;
  return (
    <span className={cx('sidebar-project-status-pill', status.state)} title={`${status.label} · ${status.detail}`}>
      <Icon size={11} aria-hidden />
      <span>{status.label}</span>
    </span>
  );
}

type SidebarSearchGroupId =
  | 'actions'
  | 'files'
  | 'agents'
  | 'modes'
  | 'models'
  | 'skills'
  | 'mcp'
  | 'projects'
  | 'pages'
  | 'settings';

type SidebarSearchResultRow =
  | { kind: 'group'; id: string; label: string }
  | { kind: 'match'; match: SidebarSearchMatch; index: number };

function sidebarSearchResultRows(
  matches: SidebarSearchMatch[],
  labels: Record<SidebarSearchGroupId, string>,
): SidebarSearchResultRow[] {
  const groupOrder: SidebarSearchGroupId[] = ['actions', 'files', 'agents', 'modes', 'models', 'skills', 'mcp', 'projects', 'pages', 'settings'];
  const grouped = new Map<SidebarSearchGroupId, Array<{ match: SidebarSearchMatch; index: number }>>();
  matches.forEach((match, index) => {
    const group = sidebarSearchGroup(match);
    const existing = grouped.get(group) ?? [];
    existing.push({ match, index });
    grouped.set(group, existing);
  });
  return groupOrder.flatMap((group) => {
    const items = grouped.get(group);
    if (!items?.length) return [];
    return [
      { kind: 'group' as const, id: `search-group-${group}`, label: labels[group] },
      ...items.map((item) => ({ kind: 'match' as const, ...item })),
    ];
  });
}

function sidebarSearchGroup(match: SidebarSearchMatch): SidebarSearchGroupId {
  if (match.workspaceRelativePath) return 'files';
  if (match.action && match.action !== 'new-agent' && match.action !== 'open-settings' && match.action !== 'open-mcp-settings') return 'actions';
  if (match.kind === 'agent' || match.kind === 'thread') return 'agents';
  if (match.kind === 'file') return 'actions';
  if (match.kind === 'mode') return 'modes';
  if (match.kind === 'model') return 'models';
  if (match.kind === 'skill') return 'skills';
  if (match.kind === 'mcp') return 'mcp';
  if (match.kind === 'project') return 'projects';
  if (match.kind === 'setting') return 'settings';
  return 'pages';
}
