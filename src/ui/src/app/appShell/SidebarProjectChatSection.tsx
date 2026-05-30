import type { FormEvent, MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { ChevronDown, ChevronsDown, ChevronsUp, Edit3, Folder, FolderPlus, Gauge, GitBranch, HardDrive, MoreHorizontal, PanelTopOpen, Search } from 'lucide-react';
import { useI18n } from '../../i18nContext';
import { Badge, cx } from '../uiPrimitives';
import type { SidebarProjectThreadGroup, SidebarSearchMatch, SidebarThreadItem } from './ShellPanels';
import type { SidebarCursorAgentProjectGroup, SidebarCursorAgentStatus } from './sidebarCursorAgentModel';
import { sidebarRenderableThreadItems } from './sidebarProjectThreadList';

type SidebarProjectMenuTarget =
  | { kind: 'global' }
  | { kind: 'create' }
  | { kind: 'project'; projectId: string };

export function SidebarProjectChatSection({
  sidebarSearchQuery,
  sidebarSearchMatches,
  allProjectThreadsCollapsed,
  activeMenuKind,
  activeProjectMenuId,
  projectThreadLimit,
  sidebarProjectThreadGroups,
  cursorProjectGroups,
  expandedProjectThreads,
  onSearchQueryChange,
  onSearchSubmit,
  onOpenSearchMatch,
  onOpenProjectMenuAt,
  onToggleProjectMenu,
  onToggleAllProjectThreadsCollapsed,
  onActivateProject,
  onToggleProjectThreadExpansion,
  onOpenProjectNewChat,
  renderSidebarThreadRow,
}: {
  sidebarSearchQuery: string;
  sidebarSearchMatches: SidebarSearchMatch[];
  allProjectThreadsCollapsed: boolean;
  activeMenuKind?: 'global' | 'create' | 'project';
  activeProjectMenuId?: string;
  projectThreadLimit: number;
  sidebarProjectThreadGroups: SidebarProjectThreadGroup[];
  cursorProjectGroups?: SidebarCursorAgentProjectGroup[];
  expandedProjectThreads: Set<string>;
  onSearchQueryChange: (value: string) => void;
  onSearchSubmit: (event: FormEvent) => void;
  onOpenSearchMatch: (match: SidebarSearchMatch) => void;
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
  onActivateProject: (project: SidebarProjectThreadGroup, thread?: SidebarThreadItem) => void;
  onToggleProjectThreadExpansion: (projectId: string) => void;
  onOpenProjectNewChat: (project: SidebarProjectThreadGroup, event: ReactMouseEvent) => void;
  renderSidebarThreadRow: (item: SidebarThreadItem, project: SidebarProjectThreadGroup) => ReactNode;
}) {
  const { t } = useI18n();
  const primaryProject = sidebarProjectThreadGroups.find((project) => project.current) ?? sidebarProjectThreadGroups[0];
  const newAgentLabel = t({ 'zh-CN': '新建智能体', 'en-US': 'New Agent' });
  const searchLabel = t({ 'zh-CN': '搜索聊天、项目、页面', 'en-US': 'Search chats, projects, pages' });
  const expandAllChatsLabel = t({ 'zh-CN': '展开所有聊天', 'en-US': 'Expand all chats' });
  const collapseAllChatsLabel = t({ 'zh-CN': '折叠所有聊天', 'en-US': 'Collapse all chats' });
  const projectActionsLabel = t({ 'zh-CN': '项目操作', 'en-US': 'Project actions' });
  return (
    <>
      <section className="sidebar-section sidebar-section-actions" aria-label={t({ 'zh-CN': '主操作', 'en-US': 'Primary actions' })}>
        <button
          type="button"
          className="sidebar-command primary sidebar-new-agent-command"
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
        <form className="sidebar-search" onSubmit={onSearchSubmit}>
          <Search size={15} />
          <input
            value={sidebarSearchQuery}
            onChange={(event) => onSearchQueryChange(event.target.value)}
            placeholder={t({ 'zh-CN': '搜索', 'en-US': 'Search' })}
            aria-label={searchLabel}
          />
        </form>
        {sidebarSearchQuery.trim() ? (
          <div className="sidebar-search-results" aria-label={t({ 'zh-CN': '侧边栏搜索结果', 'en-US': 'Sidebar search results' })}>
            {sidebarSearchMatches.length ? sidebarSearchMatches.map((match) => (
              <button
                key={match.id}
                type="button"
                className="sidebar-result-row"
                onClick={() => onOpenSearchMatch(match)}
              >
                <span>{match.label}</span>
                <small>{match.detail}</small>
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
              {allProjectThreadsCollapsed ? <ChevronsDown size={14} /> : <ChevronsUp size={14} />}
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
                const expanded = expandedProjectThreads.has(project.id);
                const projectThreads = sidebarRenderableThreadItems(project);
                const visibleThreads = allProjectThreadsCollapsed
                  ? []
                  : expanded
                    ? projectThreads
                    : projectThreads.slice(0, projectThreadLimit);
                const hiddenThreadCount = Math.max(0, projectThreads.length - visibleThreads.length);
                return (
                  <div
                    key={project.id}
                    className="sidebar-project-chat-group"
                    data-gui-region-ref={cursorProject?.resourceRef}
                    data-gui-current-project={cursorProject?.current || project.current ? 'true' : undefined}
                  >
                    <div
                      className={cx('sidebar-project-chat-head', project.current && 'current')}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        onOpenProjectMenuAt({ kind: 'project', projectId: project.id }, event, project);
                      }}
                    >
                      <button
                        type="button"
                        className="sidebar-project-chat-main"
                        onClick={() => {
                          if (!project.current) {
                            onActivateProject(project);
                            return;
                          }
                          if (projectThreads.length) onToggleProjectThreadExpansion(project.id);
                        }}
                      >
                        <Folder size={15} aria-hidden />
                        <span>{project.label}</span>
                        {project.current ? <Badge variant="muted">{t({ 'zh-CN': '当前', 'en-US': 'Current' })}</Badge> : null}
                      </button>
                      <div className="sidebar-project-row-actions">
                        <button
                          type="button"
                          className={cx('sidebar-project-icon-btn', activeMenuKind === 'project' && activeProjectMenuId === project.id && 'active')}
                          onClick={(event) => onToggleProjectMenu({ kind: 'project', projectId: project.id }, event, project)}
                          title={projectActionsLabel}
                          aria-label={t({ 'zh-CN': `${project.label} 项目操作`, 'en-US': `${project.label} project actions` })}
                          aria-haspopup="menu"
                        >
                          <MoreHorizontal size={14} />
                        </button>
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
                    {cursorProject ? (
                      <ProjectStatusRow status={cursorProject.status} />
                    ) : null}
                    {visibleThreads.length ? (
                      <div className="sidebar-thread-list">
                        {visibleThreads.map((item) => renderSidebarThreadRow(item, project))}
                        {hiddenThreadCount ? (
                          <button
                            type="button"
                            className="sidebar-thread-more"
                            onClick={() => onToggleProjectThreadExpansion(project.id)}
                          >
                            <PanelTopOpen size={14} aria-hidden />
                            <span>{t({ 'zh-CN': '显示更多', 'en-US': 'Show more' })}</span>
                            <small>{hiddenThreadCount}</small>
                          </button>
                        ) : expanded && projectThreads.length > projectThreadLimit ? (
                          <button
                            type="button"
                            className="sidebar-thread-more"
                            onClick={() => onToggleProjectThreadExpansion(project.id)}
                          >
                            <ChevronDown size={14} aria-hidden />
                            <span>{t({ 'zh-CN': '收起', 'en-US': 'Show less' })}</span>
                          </button>
                        ) : null}
                      </div>
                    ) : allProjectThreadsCollapsed ? null : (
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

function ProjectStatusRow({ status }: { status: SidebarCursorAgentProjectGroup['status'] }) {
  const { t } = useI18n();
  return (
    <div className="sidebar-project-status-row" aria-label={t({ 'zh-CN': '项目状态', 'en-US': 'Project status' })}>
      <ProjectStatusPill icon="branch" status={status.branch} />
      <ProjectStatusPill icon="environment" status={status.localEnvironment} />
      <ProjectStatusPill icon="context" status={status.context} />
    </div>
  );
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
