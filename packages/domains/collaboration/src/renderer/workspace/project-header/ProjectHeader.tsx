import React, { type KeyboardEvent, type ReactElement } from 'react'
import type { ProjectStatus } from '../workspace-types.js'

type ProjectTab = 'board' | 'requirements' | 'files' | 'settings'

export function ProjectHeader({
  initials,
  name,
  memberCount,
  status,
  activeTab = 'board',
  onTabChange,
  onPrimaryAction,
  primaryActionLabel,
  canOpenSettings = true,
  progress,
}: Readonly<{
  initials: string
  name: string
  memberCount: number
  status: ProjectStatus
  activeTab?: ProjectTab
  onTabChange?(tab: ProjectTab): void
  onPrimaryAction?(): void
  primaryActionLabel?: string
  canOpenSettings?: boolean
  progress?: Readonly<{ adopted: number; total: number }>
}>): ReactElement {
  const tabs: readonly Readonly<{ id: ProjectTab; label: string }>[] = [
    { id: 'board', label: '看板' },
    { id: 'requirements', label: '需求' },
    { id: 'files', label: '文件' },
    ...(canOpenSettings ? [{ id: 'settings' as const, label: '项目设置' }] : []),
  ]
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
            <span className={`collaboration-workspace-status-label status-${status}`}>{statusLabel(status)}</span>
          </div>
          <p>协作项目 · {memberCount} 位成员{progress ? <> · <span className={progress.adopted === progress.total ? 'collaboration-workspace-progress is-done' : 'collaboration-workspace-progress'}>已采纳 {progress.adopted}/{progress.total}</span></> : null}</p>
        </div>
      </div>
      <div className="collaboration-workspace-project-header-tabs" role="tablist" aria-label="项目页面" onKeyDown={moveFocus}>
        {tabs.map((tab) => (
          <button
            type="button"
            key={tab.id}
            className={activeTab === tab.id ? 'is-active' : undefined}
            role="tab"
            aria-selected={activeTab === tab.id}
            tabIndex={activeTab === tab.id ? 0 : -1}
            onClick={() => onTabChange?.(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="collaboration-workspace-project-header-actions">
        {primaryActionLabel && canOpenSettings ? <button type="button" className="collaboration-workspace-button-primary" onClick={onPrimaryAction}>{primaryActionLabel}</button> : null}
      </div>
    </header>
  )
}

export function statusLabel(status: ProjectStatus): string {
  return { draft: '草稿', active: '进行中', paused: '已暂停', completed: '已完成' }[status]
}
