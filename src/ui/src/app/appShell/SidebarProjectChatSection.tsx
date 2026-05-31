import type { FormEvent, MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { CalendarClock, ChevronsDown, Edit3, Folder, FolderPlus, Gauge, GitBranch, HardDrive, ListFilter, MoreHorizontal, Search, SlidersHorizontal } from 'lucide-react';
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
  sidebarProjectThreadGroups,
  cursorProjectGroups,
  visibleSections = defaultVisibleSections,
  onSearchQueryChange,
  onSearchSubmit,
  onOpenSearchMatch,
  onOpenProjectMenuAt,
  onToggleProjectMenu,
  onToggleAllProjectThreadsCollapsed,
  onActivateProject,
  onShowMoreProjectThreads,
  onOpenProjectNewChat,
  onOpenAutomations,
  onOpenCustomize,
  renderSidebarThreadRow,
}: {
  sidebarSearchQuery: string;
  sidebarSearchMatches: SidebarSearchMatch[];
  allProjectThreadsCollapsed: boolean;
  activeMenuKind?: 'global' | 'create' | 'project';
  projectThreadLimit: number;
  projectThreadVisibleCounts?: Record<string, number>;
  sidebarProjectThreadGroups: SidebarProjectThreadGroup[];
  cursorProjectGroups?: SidebarCursorAgentProjectGroup[];
  visibleSections?: SidebarVisibleSections;
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
  onShowMoreProjectThreads: (projectId: string) => void;
  onOpenProjectNewChat: (project: SidebarProjectThreadGroup, event: ReactMouseEvent) => void;
  onOpenAutomations: () => void;
  onOpenCustomize: () => void;
  renderSidebarThreadRow: (item: SidebarThreadItem, project: SidebarProjectThreadGroup) => ReactNode;
}) {
  const { t } = useI18n();
  const primaryProject = sidebarProjectThreadGroups.find((project) => project.current) ?? sidebarProjectThreadGroups[0];
  const newAgentLabel = t({ 'zh-CN': '新建智能体', 'en-US': 'New Agent' });
  const searchLabel = t({ 'zh-CN': '搜索聊天、项目、页面', 'en-US': 'Search chats, projects, pages' });
  const expandAllChatsLabel = t({ 'zh-CN': '展开所有聊天', 'en-US': 'Expand all chats' });
  const collapseAllChatsLabel = t({ 'zh-CN': '折叠所有聊天', 'en-US': 'Collapse all chats' });
  const customizeLabel = t({ 'zh-CN': '自定义', 'en-US': 'Customize' });
  const automationsLabel = t({ 'zh-CN': '自动化', 'en-US': 'Automations' });
  return (
    <>
      <section className="sidebar-section sidebar-section-actions" aria-label={t({ 'zh-CN': '主操作', 'en-US': 'Primary actions' })}>
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
                const projectStatusTitle = cursorProject ? projectStatusSummary(cursorProject.status) : project.detail;
                const visibleThreads = allProjectThreadsCollapsed
                  ? []
                  : projectThreads.slice(0, visibleCount);
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
                      title={projectStatusTitle}
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
