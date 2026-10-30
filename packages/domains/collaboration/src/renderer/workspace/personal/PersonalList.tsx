import React, { type ReactElement } from 'react'
import { ChevronRight, Inbox, ListChecks, UserRound } from 'lucide-react'
import type { WorkspacePersonalItem } from '../workspace-view-model.js'

export function PersonalList({ title, subtitle, items, loading = false, onOpen }: Readonly<{ title: string; subtitle: string; items: readonly WorkspacePersonalItem[]; loading?: boolean; onOpen(item: WorkspacePersonalItem): void }>): ReactElement {
  const inbox = title === '收件箱'
  return (
    <section className="collaboration-workspace-page-panel collaboration-workspace-personal-page">
      <header className="collaboration-workspace-page-header is-page-title">
        <div><h1>{title}</h1>{subtitle ? <p>{subtitle}</p> : null}</div>
      </header>
      <h2 className="collaboration-workspace-group-title">{inbox ? '待我处理' : '分配给我'}{items.length ? <span className="collaboration-workspace-count">{items.length}</span> : null}</h2>
      <div className="collaboration-workspace-personal-list" aria-busy={loading || undefined}>
        {loading ? [0, 1, 2].map((index) => <div key={index} className="collaboration-workspace-personal-row is-skeleton"><span className="collaboration-workspace-skeleton-line" /><span className="collaboration-workspace-skeleton-line is-short" /></div>) : items.length ? items.map((item) => (
          <button type="button" className="collaboration-workspace-personal-row" key={item.id} onClick={() => onOpen(item)}>
            <span className="collaboration-workspace-personal-title">
              <strong>{item.reference ? <span className="collaboration-workspace-task-card-reference">{item.reference}</span> : null}{item.title}</strong>
              <small>{item.projectName}</small>
            </span>
            <span className="collaboration-workspace-personal-person">{item.person ? <><UserRound aria-hidden="true" />{item.person}</> : null}</span>
            <span className={`collaboration-workspace-personal-state ${stateTone(item.state)}`}><span aria-hidden="true" />{item.state}</span>
            <time>{item.time}</time>
            <span className="collaboration-workspace-personal-action">{item.action}<ChevronRight aria-hidden="true" /></span>
          </button>
        )) : (
          <div className="collaboration-workspace-personal-empty" role="status">
            <span aria-hidden="true">{inbox ? <Inbox /> : <ListChecks />}</span>
            <strong>暂时没有需要你处理的事</strong>
            <p>{inbox ? '新的邀请、提问和交付会出现在这里。' : '分配给你的任务会出现在这里。'}</p>
          </div>
        )}
      </div>
    </section>
  )
}

function stateTone(state: string): string {
  if (state === '待回答' || state === '等待回答' || state === '等待成员回答' || state === '提问待回答' || state === '需要处理') return 'tone-warning'
  if (state.startsWith('待') || state.includes('待接受') || state.includes('待处理')) return 'tone-accent'
  if (state === '已完成') return 'tone-success'
  return 'tone-neutral'
}
