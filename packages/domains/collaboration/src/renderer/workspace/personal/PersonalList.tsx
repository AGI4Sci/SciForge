import { useWorkspaceTranslation } from '../workspace-i18n.js'
import React, { useMemo, useState, type ReactElement } from 'react'
import { ChevronRight, Inbox, ListChecks, Search, UserRound } from 'lucide-react'
import type { WorkspacePersonalItem } from '../workspace-view-model.js'
import { formatAbsoluteTime } from '../format-time.js'

type Scope = 'all' | 'open' | 'done'

/** Adopted/published items are history: they stay reachable through the filter. */
function isDone(state: string): boolean {
  return state === '已完成' || state === '已采纳' || state === '已发布'
}

export function PersonalList({ title, subtitle, items, loading = false, onOpen }: Readonly<{ title: string; subtitle: string; items: readonly WorkspacePersonalItem[]; loading?: boolean; onOpen(item: WorkspacePersonalItem): void }>): ReactElement {
  const cw = useWorkspaceTranslation()
  const inbox = title === '收件箱'
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<Scope>('open')
  const matching = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return items.filter((item) => {
      if (scope === 'done' && !isDone(item.state)) return false
      if (scope === 'open' && isDone(item.state)) return false
      if (!needle) return true
      return `${item.title} ${item.projectName} ${item.person ?? ''}`.toLocaleLowerCase().includes(needle)
    })
  }, [items, query, scope])
  const openCount = items.filter((item) => !isDone(item.state)).length
  const doneCount = items.length - openCount
  const scopes: ReadonlyArray<{ id: Scope; label: string; count: number }> = [
    { id: 'open', label: '待处理', count: openCount },
    { id: 'all', label: '全部', count: items.length },
    { id: 'done', label: '已完成', count: doneCount }
  ]
  return (
    <section className="collaboration-workspace-page-panel collaboration-workspace-personal-page">
      <header className="collaboration-workspace-page-header is-page-title">
        <div><h1>{cw(title)}</h1>{subtitle ? <p>{cw(subtitle)}</p> : null}</div>
      </header>
      <div className="collaboration-workspace-personal-toolbar">
        <label className="collaboration-workspace-personal-search">
          <Search aria-hidden="true" />
          <input
            type="search"
            value={query}
            placeholder={cw('搜索任务')}
            aria-label={cw('搜索任务')}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="collaboration-workspace-personal-scopes" role="group" aria-label={cw('状态')}>
          {scopes.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={`collaboration-workspace-personal-scope${scope === entry.id ? ' is-active' : ''}`}
              aria-pressed={scope === entry.id}
              onClick={() => setScope(entry.id)}
            >
              {cw(entry.label)}<span className="collaboration-workspace-count">{entry.count}</span>
            </button>
          ))}
        </div>
      </div>
      <h2 className="collaboration-workspace-group-title">{cw(inbox ? '待我处理' : '分配给我')}{matching.length ? <span className="collaboration-workspace-count">{matching.length}</span> : null}</h2>
      <div className="collaboration-workspace-personal-list" aria-busy={loading || undefined}>
        {loading ? [0, 1, 2].map((index) => <div key={index} className="collaboration-workspace-personal-row is-skeleton"><span className="collaboration-workspace-skeleton-line" /><span className="collaboration-workspace-skeleton-line is-short" /></div>) : matching.length ? matching.map((item) => (
          <button type="button" className="collaboration-workspace-personal-row" key={item.id} onClick={() => onOpen(item)}>
            <span className="collaboration-workspace-personal-title">
              <strong>{item.reference ? <span className="collaboration-workspace-task-card-reference">{item.reference}</span> : null}{item.title}</strong>
              <small>{item.projectName}</small>
            </span>
            <span className="collaboration-workspace-personal-person">{item.person ? <><UserRound aria-hidden="true" />{item.person}</> : null}</span>
            <span className={`collaboration-workspace-personal-state ${stateTone(item.state)}`}><span aria-hidden="true" />{cw(item.state)}</span>
            <time dateTime={item.at} title={item.at ? formatAbsoluteTime(item.at) : undefined}>{item.time}</time>
            <span className="collaboration-workspace-personal-action">{cw(item.action)}<ChevronRight aria-hidden="true" /></span>
          </button>
        )) : items.length ? (
          <div className="collaboration-workspace-personal-empty" role="status">
            <strong>{cw('没有匹配的任务')}</strong>
            <p>{cw('换个关键词，或切换到「全部」查看已完成的历史。')}</p>
          </div>
        ) : (
          <div className="collaboration-workspace-personal-empty" role="status">
            <span aria-hidden="true">{inbox ? <Inbox /> : <ListChecks />}</span>
            <strong>{cw('暂时没有需要你处理的事')}</strong>
            <p>{cw(inbox ? '新的邀请、提问和交付会出现在这里。' : '分配给你的任务会出现在这里。')}</p>
          </div>
        )}
      </div>
    </section>
  )
}

function stateTone(state: string): string {
  if (state === '待回复' || state === '等待回答' || state === '等待成员回答' || state === '提问待回复' || state === '需要处理') return 'tone-warning'
  if (state.startsWith('待') || state.includes('待接受') || state.includes('待处')) return 'tone-accent'
  if (state === '已完成') return 'tone-success'
  return 'tone-neutral'
}
