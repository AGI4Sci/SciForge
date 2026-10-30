import React, { useEffect, useRef, useState, type ReactElement } from 'react'
import { Bell, ListChecks, Plus, Settings2 } from 'lucide-react'
import type { ProjectModel } from '../workspace-types.js'
import type { WorkspaceConnectionViewModel } from '../workspace-view-model.js'

type PersonalRoute = 'my-work' | 'inbox' | 'settings'

export function ProjectSidebar({
  projects,
  selectedProjectId,
  onSelectProject,
  onNavigate,
  onCreateProject,
  myWorkCount = 0,
  inboxCount = 0,
  canOpenSettings = true,
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
  myWorkCount?: number
  inboxCount?: number
  canOpenSettings?: boolean
  activeRoute?: PersonalRoute
  loading?: boolean
  connection?: WorkspaceConnectionViewModel
  currentUserId?: string | null
  onConnect?(action: NonNullable<WorkspaceConnectionViewModel['action']>): void
  onCopyUserId?(): void | Promise<void>
}>): ReactElement {
  const owned = projects.filter((project) => project.owned)
  const joined = projects.filter((project) => !project.owned)
  return (
    <aside className="collaboration-workspace-sidebar" aria-label="协作导航">
      <div className="collaboration-workspace-sidebar-titlebar">
        <strong>协作</strong>
      </div>
      <nav className="collaboration-workspace-sidebar-nav" aria-label="跨项目导航">
        <NavItem icon={<ListChecks aria-hidden="true" />} label="我的工作" count={myWorkCount} active={activeRoute === 'my-work'} onClick={() => onNavigate?.('my-work')} />
        <NavItem icon={<Bell aria-hidden="true" />} label="收件箱" count={inboxCount} emphasize active={activeRoute === 'inbox'} onClick={() => onNavigate?.('inbox')} />
      </nav>
      <div className="collaboration-workspace-sidebar-section-heading">
        <span>项目</span>
        <button type="button" aria-label="新建项目" title="新建项目" onClick={onCreateProject}><Plus aria-hidden="true" /></button>
      </div>
      <div className="collaboration-workspace-sidebar-projects">
        {loading ? <SidebarSkeleton /> : projects.length ? (
          <>
            {owned.length ? <ProjectGroup label="我负责的" projects={owned} selectedProjectId={selectedProjectId} onSelectProject={onSelectProject} /> : null}
            {joined.length ? <ProjectGroup label="我参与的" projects={joined} selectedProjectId={selectedProjectId} onSelectProject={onSelectProject} /> : null}
          </>
        ) : (
          <div className="collaboration-workspace-sidebar-empty">
            <p>还没有项目</p>
            <button type="button" onClick={onCreateProject}>新建项目</button>
          </div>
        )}
      </div>
      <div className="collaboration-workspace-sidebar-footer">
        <UserIdStatus currentUserId={currentUserId} onCopyUserId={onCopyUserId} />
        <ConnectionStatus connection={connection} onConnect={onConnect} />
        {canOpenSettings ? <NavItem icon={<Settings2 aria-hidden="true" />} label="设置" active={activeRoute === 'settings'} onClick={() => onNavigate?.('settings')} /> : null}
      </div>
    </aside>
  )
}

function NavItem({ icon, label, count = 0, emphasize = false, active, onClick }: Readonly<{ icon: ReactElement; label: string; count?: number; emphasize?: boolean; active: boolean; onClick(): void }>): ReactElement {
  return (
    <button type="button" className={`collaboration-workspace-sidebar-nav-item${active ? ' is-active' : ''}`} aria-current={active ? 'page' : undefined} onClick={onClick}>
      {icon}
      <span>{label}</span>
      {count ? <b className={emphasize ? 'is-emphasized' : undefined}>{count}</b> : null}
    </button>
  )
}

function ProjectGroup({ label, projects, selectedProjectId, onSelectProject }: Readonly<{
  label: string
  projects: readonly ProjectModel[]
  selectedProjectId?: string | null
  onSelectProject?: (projectId: string) => void
}>): ReactElement {
  return (
    <section className="collaboration-workspace-sidebar-project-group">
      <h2>{label}</h2>
      {projects.map((project) => (
        <button
          type="button"
          key={project.id}
          className={`collaboration-workspace-project-row${project.id === selectedProjectId ? ' is-selected' : ''}`}
          aria-current={project.id === selectedProjectId ? 'page' : undefined}
          title={project.name}
          onClick={() => onSelectProject?.(project.id)}
        >
          <span className="collaboration-workspace-project-badge" aria-hidden="true">{project.initials}</span>
          <span className="collaboration-workspace-project-row-name">{project.name}</span>
          {project.pendingCount ? <b aria-label={`${project.pendingCount} 项待处理`}>{project.pendingCount}</b> : null}
        </button>
      ))}
    </section>
  )
}

function UserIdStatus({ currentUserId, onCopyUserId }: Readonly<{ currentUserId: string | null; onCopyUserId?(): void | Promise<void> }>): ReactElement {
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
    <div className="collaboration-workspace-user-id-status" title={currentUserId ? `我的用户 ID：${currentUserId}` : '尚未连接协作账户'}>
      <div className="collaboration-workspace-user-id-status-head">
        <span className="collaboration-workspace-user-id-status-label">我的用户 ID</span>
        <button type="button" onClick={() => void copy()} disabled={!currentUserId || !onCopyUserId}>{copied ? '已复制' : '复制'}</button>
      </div>
      <code className={currentUserId ? undefined : 'is-empty'}>{currentUserId ? shortUserId(currentUserId) : '未连接'}</code>
      {currentUserId ? <span className="collaboration-workspace-visually-hidden">完整用户 ID：{currentUserId}</span> : null}
      <span className="collaboration-workspace-visually-hidden" role="status">{copied ? '已复制用户 ID' : ''}</span>
    </div>
  )
}

function shortUserId(userId: string): string {
  return userId.length > 14 ? `${userId.slice(0, 8)}…${userId.slice(-4)}` : userId
}

function ConnectionStatus({ connection, onConnect }: Readonly<{ connection: WorkspaceConnectionViewModel; onConnect?(action: NonNullable<WorkspaceConnectionViewModel['action']>): void }>): ReactElement {
  const [open, setOpen] = useState(false)
  return (
    <div className="collaboration-workspace-connection">
      <button type="button" className={`collaboration-workspace-connection-point tone-${connection.tone}`} aria-expanded={connection.detail ? open : undefined} onClick={() => setOpen((value) => !value)} disabled={!connection.detail}>
        <span className="collaboration-workspace-connection-dot" aria-hidden="true" />
        <span>{connection.label}</span>
      </button>
      {(open || connection.action) && connection.detail ? <p className="collaboration-workspace-connection-detail">{connection.detail}</p> : null}
      {connection.action ? <button type="button" className="collaboration-workspace-button-primary collaboration-workspace-connection-action" onClick={() => onConnect?.(connection.action!)}>{connection.action === 'recover' ? '重新连接' : '连接协作'}</button> : null}
    </div>
  )
}

function SidebarSkeleton(): ReactElement {
  return (
    <div className="collaboration-workspace-sidebar-skeleton" aria-busy="true" aria-label="正在加载项目">
      {[0, 1, 2].map((index) => <span key={index} className="collaboration-workspace-skeleton-line" />)}
    </div>
  )
}
