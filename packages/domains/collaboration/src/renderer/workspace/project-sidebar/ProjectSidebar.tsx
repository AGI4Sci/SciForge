import { useWorkspaceTranslation } from '../workspace-i18n.js'
import React, { useEffect, useRef, useState, type ReactElement } from 'react'
import { Bell, ListChecks, Loader2, Plus, Pencil, Trash2 } from 'lucide-react'
import type { ProjectModel } from '../workspace-types.js'
import type { WorkspaceConnectionViewModel } from '../workspace-view-model.js'

type PersonalRoute = 'my-work' | 'inbox'

export function ProjectSidebar({
  projects,
  selectedProjectId,
  onSelectProject,
  onNavigate,
  onCreateProject,
  onRenameProject,
  onDeleteProject,
  deletingProjectId = null,
  myWorkCount = 0,
  inboxCount = 0,
  activeRoute,
  loading = false,
  connection = { tone: 'ready', label: '云端已连接' },
  currentUserId = null,
  onConnect,
  onCopyUserId,
}: Readonly<{
  projects: readonly ProjectModel[]
  selectedProjectId?: string | null
  onSelectProject?(projectId: string): void
  onNavigate?(route: PersonalRoute): void
  onCreateProject?(): void
  /** Opens the in-app delete confirmation for one owned Project. */
  onRenameProject?(projectId: string): void
  onDeleteProject?(projectId: string): void
  /** The Project whose deletion is in flight; its row action shows progress. */
  deletingProjectId?: string | null
  myWorkCount?: number
  inboxCount?: number
  activeRoute?: PersonalRoute
  loading?: boolean
  connection?: WorkspaceConnectionViewModel
  currentUserId?: string | null
  onConnect?(action: NonNullable<WorkspaceConnectionViewModel['action']>): void
  onCopyUserId?(): void | Promise<void>
}>): ReactElement {
  const cw = useWorkspaceTranslation()
  const owned = projects.filter((project) => project.owned)
  const joined = projects.filter((project) => !project.owned)
  return (
    <aside className="collaboration-workspace-sidebar" aria-label={cw('协作导航')}>
      <div className="collaboration-workspace-sidebar-titlebar">
        <strong>{cw('协作')}</strong>
      </div>
      <nav className="collaboration-workspace-sidebar-nav" aria-label={cw('跨项目导航')}>
        <NavItem icon={<ListChecks aria-hidden="true" />} label="我的工作" count={myWorkCount} active={activeRoute === 'my-work'} onClick={() => onNavigate?.('my-work')} />
        <NavItem icon={<Bell aria-hidden="true" />} label="收件箱" count={inboxCount} emphasize active={activeRoute === 'inbox'} onClick={() => onNavigate?.('inbox')} />
      </nav>
      <div className="collaboration-workspace-sidebar-section-heading">
        <span>{cw('项目')}</span>
        <button type="button" aria-label={cw('新建项目')} title={cw('新建项目')} onClick={onCreateProject}><Plus aria-hidden="true" /></button>
      </div>
      <div className="collaboration-workspace-sidebar-projects">
        {loading ? <SidebarSkeleton /> : projects.length ? (
          <>
            {owned.length ? <ProjectGroup label="我负责的" projects={owned} selectedProjectId={selectedProjectId} onSelectProject={onSelectProject} onRenameProject={onRenameProject} onDeleteProject={onDeleteProject} deletingProjectId={deletingProjectId} /> : null}
            {joined.length ? <ProjectGroup label="我参与的" projects={joined} selectedProjectId={selectedProjectId} onSelectProject={onSelectProject} onRenameProject={onRenameProject} onDeleteProject={onDeleteProject} deletingProjectId={deletingProjectId} /> : null}
          </>
        ) : (
          <div className="collaboration-workspace-sidebar-empty">
            <p>{cw('还没有项目')}</p>
            <button type="button" onClick={onCreateProject}>{cw('新建项目')}</button>
          </div>
        )}
      </div>
      <div className="collaboration-workspace-sidebar-footer">
        <UserIdStatus currentUserId={currentUserId} onCopyUserId={onCopyUserId} />
        <ConnectionStatus connection={connection} onConnect={onConnect} />
      </div>
    </aside>
  )
}

function NavItem({ icon, label, count = 0, emphasize = false, active, onClick }: Readonly<{ icon: ReactElement; label: string; count?: number; emphasize?: boolean; active: boolean; onClick(): void }>): ReactElement {
  const cw = useWorkspaceTranslation()
  return (
    <button type="button" className={`collaboration-workspace-sidebar-nav-item${active ? ' is-active' : ''}`} aria-current={active ? 'page' : undefined} onClick={onClick}>
      {icon}
      <span>{cw(label)}</span>
      {count ? <b className={emphasize ? 'is-emphasized' : undefined}>{count}</b> : null}
    </button>
  )
}

function ProjectGroup({ label, projects, selectedProjectId, onSelectProject, onRenameProject, onDeleteProject, deletingProjectId }: Readonly<{
  label: string
  projects: readonly ProjectModel[]
  selectedProjectId?: string | null
  onSelectProject?: (projectId: string) => void
  onRenameProject?: (projectId: string) => void
  onDeleteProject?: (projectId: string) => void
  deletingProjectId?: string | null
}>): ReactElement {
  const cw = useWorkspaceTranslation()
  return (
    <section className="collaboration-workspace-sidebar-project-group">
      <h2>{cw(label)}</h2>
      {projects.map((project) => {
        const deleting = deletingProjectId === project.id
        return (
          <div className="collaboration-workspace-project-row-wrap" key={project.id}>
            <button
              type="button"
              className={`collaboration-workspace-project-row${project.id === selectedProjectId ? ' is-selected' : ''}`}
              aria-current={project.id === selectedProjectId ? 'page' : undefined}
              title={project.name}
              onClick={() => onSelectProject?.(project.id)}
            >
              <span className="collaboration-workspace-project-badge" aria-hidden="true">{project.initials}</span>
              <span className="collaboration-workspace-project-row-name">{project.name}</span>
              {project.pendingCount ? <b aria-label={cw('{{count}} 项待处理', { count: project.pendingCount })}>{project.pendingCount}</b> : null}
            </button>
            {project.owned && onRenameProject ? <button type="button" className="collaboration-workspace-project-row-rename" aria-label={cw('重命名项目：{{name}}', { name: project.name })} title={cw('重命名项目')} disabled={deleting} onClick={() => onRenameProject(project.id)}><Pencil aria-hidden="true" /></button> : null}
            {/* Only an Owner may delete; the Coordinator enforces the same rule. */}
            {project.owned && onDeleteProject ? (
              <button
                type="button"
                className="collaboration-workspace-project-row-delete"
                data-testid="project-delete"
                data-project-id={project.id}
                aria-label={cw('删除项目')}
                title={cw('删除项目：{{name}}', { name: project.name })}
                aria-busy={deleting}
                disabled={deletingProjectId !== null}
                onClick={() => onDeleteProject(project.id)}
              >
                {deleting ? <Loader2 aria-hidden="true" /> : <Trash2 aria-hidden="true" />}
              </button>
            ) : null}
          </div>
        )
      })}
    </section>
  )
}

function UserIdStatus({ currentUserId, onCopyUserId }: Readonly<{ currentUserId: string | null; onCopyUserId?(): void | Promise<void> }>): ReactElement {
  const cw = useWorkspaceTranslation()
  const [copied, setCopied] = useState(false)
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (resetTimer.current !== null) clearTimeout(resetTimer.current) }, [])
  const copy = async () => {
    if (!currentUserId || !onCopyUserId) return
    try {
      await onCopyUserId()
      setCopied(true)
      if (resetTimer.current !== null) clearTimeout(resetTimer.current)
      resetTimer.current = setTimeout(() => { setCopied(false); resetTimer.current = null }, 1600)
    } catch {
      setCopied(false)
    }
  }
  return (
    <div className="collaboration-workspace-user-id-status" title={currentUserId ? cw('我的用户 ID：{{id}}', { id: currentUserId }) : cw('尚未连接协作账户')}>
      <div className="collaboration-workspace-user-id-status-head">
        <span className="collaboration-workspace-user-id-status-label">{cw('我的用户 ID')}</span>
        <button type="button" onClick={() => void copy()} disabled={!currentUserId || !onCopyUserId}>{cw(copied ? '已复制' : '复制')}</button>
      </div>
      <code className={currentUserId ? undefined : 'is-empty'}>{currentUserId ? shortUserId(currentUserId) : cw('未连接')}</code>
      {currentUserId ? <span className="collaboration-workspace-visually-hidden">{cw('完整用户 ID：{{id}}', { id: currentUserId })}</span> : null}
      <span className="collaboration-workspace-visually-hidden" role="status">{copied ? cw('已复制用户 ID') : ''}</span>
    </div>
  )
}

function shortUserId(userId: string): string {
  return userId.length > 14 ? `${userId.slice(0, 8)}…${userId.slice(-4)}` : userId
}

function ConnectionStatus({ connection, onConnect }: Readonly<{ connection: WorkspaceConnectionViewModel; onConnect?(action: NonNullable<WorkspaceConnectionViewModel['action']>): void }>): ReactElement {
  const cw = useWorkspaceTranslation()
  const [open, setOpen] = useState(false)
  return (
    <div className="collaboration-workspace-connection">
      <button type="button" className={`collaboration-workspace-connection-point tone-${connection.tone}`} aria-expanded={connection.detail ? open : undefined} onClick={() => setOpen((value) => !value)} disabled={!connection.detail}>
        <span className="collaboration-workspace-connection-dot" aria-hidden="true" />
        <span>{cw(connection.label)}</span>
      </button>
      {(open || connection.action) && connection.detail ? <p className="collaboration-workspace-connection-detail">{cw(connection.detail)}</p> : null}
      {connection.action ? <button type="button" className="collaboration-workspace-button-primary collaboration-workspace-connection-action" onClick={() => onConnect?.(connection.action!)}>{cw(connection.action === 'recover' ? '重新连接' : '连接协作')}</button> : null}
    </div>
  )
}

function SidebarSkeleton(): ReactElement {
  const cw = useWorkspaceTranslation()
  return (
    <div className="collaboration-workspace-sidebar-skeleton" aria-busy="true" aria-label={cw('正在加载项目')}>
      {[0, 1, 2].map((index) => <span key={index} className="collaboration-workspace-skeleton-line" />)}
    </div>
  )
}
