import { useTranslation } from 'react-i18next'
import { useWorkspaceTranslation } from '../workspace-i18n.js'
import React, { type KeyboardEvent, type ReactElement } from 'react'
import type { ProjectStatus } from '../workspace-types.js'

/**
 * The Project pages, in the order the header renders them. Each id is also the
 * page route the workspace shell switches to, so the header and the routes can
 * never drift apart.
 */
export const PROJECT_TABS = Object.freeze([
  { id: 'research', label: '研究对话' },
  { id: 'board', label: '看板' },
  { id: 'members', label: '成员' },
  { id: 'requirements', label: '需求' },
  { id: 'files', label: '共享文件' },
  { id: 'info', label: '项目信息' }
] as const)

export type ProjectTab = (typeof PROJECT_TABS)[number]['id']

export function ProjectHeader({
  initials,
  name,
  memberCount,
  status,
  activeTab = 'board',
  onTabChange,
  onPrimaryAction,
  primaryActionLabel,
  canManage = true,
  progress,
  boardCount = 0,
}: Readonly<{
  initials: string
  name: string
  memberCount: number
  status: ProjectStatus
  activeTab?: ProjectTab
  onTabChange?(tab: ProjectTab): void
  onPrimaryAction?(): void
  primaryActionLabel?: string
  /** The Owner's project-level action; members never see it. */
  canManage?: boolean
  progress?: Readonly<{ adopted: number; total: number }>
  /** Tasks waiting for this User's acceptance, visible without opening the board. */
  boardCount?: number
}>): ReactElement {
  const cw = useWorkspaceTranslation()
  const { t } = useTranslation('common')
  const tabs: readonly Readonly<{ id: ProjectTab; label: string; badge?: number }>[] = PROJECT_TABS.map((tab) => ({
    ...tab,
    ...(tab.id === 'board' && boardCount > 0 ? { badge: boardCount } : {})
  }))
  const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
    const index = tabs.findIndex((tab) => tab.id === activeTab)
    const next = tabs[(index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]!
    event.preventDefault()
    onTabChange?.(next.id)
    const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')
    buttons[tabs.indexOf(next)]?.focus()
  }
  return (
    <header className="collaboration-workspace-project-header">
      <div className="collaboration-workspace-project-header-main">
        <span className="collaboration-workspace-project-header-mark" aria-hidden="true">{initials}</span>
        <div className="collaboration-workspace-project-header-title">
          <div className="collaboration-workspace-project-header-name-row">
            <h1 title={name}>{name}</h1>
            <span className={`collaboration-workspace-status-label status-${status}`}>{cw(statusLabel(status))}</span>
          </div>
          <p>{memberCount === 1 ? cw('协作项目 · 1 位成员') : cw('协作项目 · {{count}} 位成员', { count: memberCount })}{progress ? <> · <span className={progress.adopted === progress.total ? 'collaboration-workspace-progress is-done' : 'collaboration-workspace-progress'}>{cw('已采纳 {{adopted}}/{{total}}', { adopted: progress.adopted, total: progress.total })}</span></> : null}</p>
        </div>
      </div>
      <div className="collaboration-workspace-project-header-tabs" role="tablist" aria-label={cw('项目页面')} onKeyDown={moveFocus}>
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`collaboration-workspace-project-header-tab${activeTab === tab.id ? ' is-active' : ''}`}
            role="tab"
            aria-selected={activeTab === tab.id}
            tabIndex={activeTab === tab.id ? 0 : -1}
            onClick={() => onTabChange?.(tab.id)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return
              event.preventDefault()
              onTabChange?.(tab.id)
            }}
          >
            <button
              type="button"
              className="collaboration-workspace-project-header-tab-label"
              tabIndex={-1}
            >
              {tab.id === 'members' ? t('collaborationWorkspaceTabMembers', { defaultValue: '成员' }) : cw(tab.label)}
            </button>
            {tab.badge ? <><b className="collaboration-workspace-project-header-tab-badge">{tab.badge}</b><span className="collaboration-workspace-visually-hidden">{cw(' 个待你接受的任务')}</span></> : null}
          </div>
        ))}
      </div>
      <div className="collaboration-workspace-project-header-actions">
        {primaryActionLabel && canManage ? <button type="button" className="collaboration-workspace-button-primary" onClick={onPrimaryAction}>{cw(primaryActionLabel)}</button> : null}
      </div>
    </header>
  )
}

export function statusLabel(status: ProjectStatus): string {
  return { draft: '草稿', active: '进行中', paused: '已暂停', completed: '已完成' }[status]
}
