import type { FormEvent, MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { ChevronDown, ChevronsDown, ChevronsUp, Edit3, Folder, FolderPlus, MoreHorizontal, PanelTopOpen, Search } from 'lucide-react';
import { Badge, cx } from '../uiPrimitives';
import type { SidebarProjectThreadGroup, SidebarSearchMatch, SidebarThreadItem } from './ShellPanels';

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
  return (
    <>
      <section className="sidebar-section sidebar-section-actions" aria-label="主操作">
        <form className="sidebar-search" onSubmit={onSearchSubmit}>
          <Search size={15} />
          <input
            value={sidebarSearchQuery}
            onChange={(event) => onSearchQueryChange(event.target.value)}
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
                onClick={() => onOpenSearchMatch(match)}
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
        <div
          className="sidebar-section-title"
          id="sidebar-threads-title"
          onContextMenu={(event) => {
            onOpenProjectMenuAt({ kind: 'global' }, event);
          }}
        >
          <span>项目对话</span>
          <div className="sidebar-project-title-actions">
            <button
              type="button"
              className={cx('sidebar-project-icon-btn', allProjectThreadsCollapsed && 'active')}
              onClick={onToggleAllProjectThreadsCollapsed}
              title={allProjectThreadsCollapsed ? '展开全部对话' : '收起全部对话'}
              aria-label={allProjectThreadsCollapsed ? '展开全部对话' : '收起全部对话'}
              aria-pressed={allProjectThreadsCollapsed}
            >
              {allProjectThreadsCollapsed ? <ChevronsDown size={14} /> : <ChevronsUp size={14} />}
            </button>
            <button
              type="button"
              className={cx('sidebar-project-icon-btn', activeMenuKind === 'global' && 'active')}
              onClick={(event) => onToggleProjectMenu({ kind: 'global' }, event)}
              title="项目对话菜单"
              aria-label="项目对话菜单"
              aria-haspopup="menu"
            >
              <MoreHorizontal size={15} />
            </button>
            <button
              type="button"
              className={cx('sidebar-project-icon-btn', activeMenuKind === 'create' && 'active')}
              onClick={(event) => onToggleProjectMenu({ kind: 'create' }, event)}
              title="添加项目"
              aria-label="添加项目"
              aria-haspopup="menu"
            >
              <FolderPlus size={15} />
            </button>
          </div>
        </div>
        <div className="sidebar-project-chat-scroll">
          {sidebarProjectThreadGroups.length ? (
            <div className="sidebar-project-chat-list">
              {sidebarProjectThreadGroups.map((project) => {
                const expanded = expandedProjectThreads.has(project.id);
                const visibleThreads = allProjectThreadsCollapsed
                  ? []
                  : expanded
                    ? project.threads
                    : project.threads.slice(0, projectThreadLimit);
                const hiddenThreadCount = Math.max(0, project.threads.length - visibleThreads.length);
                return (
                  <div key={project.id} className="sidebar-project-chat-group">
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
                          if (project.threads.length) onToggleProjectThreadExpansion(project.id);
                        }}
                      >
                        <Folder size={15} aria-hidden />
                        <span>{project.label}</span>
                        {project.current ? <Badge variant="muted">当前</Badge> : null}
                      </button>
                      <div className="sidebar-project-row-actions">
                        <button
                          type="button"
                          className={cx('sidebar-project-icon-btn', activeMenuKind === 'project' && activeProjectMenuId === project.id && 'active')}
                          onClick={(event) => onToggleProjectMenu({ kind: 'project', projectId: project.id }, event, project)}
                          title="项目操作"
                          aria-label={`${project.label} 项目操作`}
                          aria-haspopup="menu"
                        >
                          <MoreHorizontal size={14} />
                        </button>
                        <button
                          type="button"
                          className="sidebar-project-icon-btn"
                          onClick={(event) => onOpenProjectNewChat(project, event)}
                          title="新聊天"
                          aria-label={`在 ${project.label} 中新聊天`}
                        >
                          <Edit3 size={14} />
                        </button>
                      </div>
                    </div>
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
                            <span>展开显示</span>
                            <small>{hiddenThreadCount} 条</small>
                          </button>
                        ) : expanded && project.threads.length > projectThreadLimit ? (
                          <button
                            type="button"
                            className="sidebar-thread-more"
                            onClick={() => onToggleProjectThreadExpansion(project.id)}
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
        </div>
      </section>
    </>
  );
}
