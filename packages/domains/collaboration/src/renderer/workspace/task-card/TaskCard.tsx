import React, { type ReactElement } from 'react'
import { Clock3, Flag, UserRound } from 'lucide-react'
import type { TaskCardModel } from '../workspace-types.js'

export function TaskCard({
  card,
  selected = false,
}: Readonly<{
  card: TaskCardModel
  selected?: boolean
}>): ReactElement {
  return (
    <article className={`collaboration-workspace-task-card${selected ? ' is-selected' : ''}${card.unread ? ' is-unread' : ''}`}>
      <div className="collaboration-workspace-task-card-kicker">
        <span className="collaboration-workspace-task-card-reference">{card.reference}</span>
        <span>{card.moduleType}</span>
        {card.priority ? <span className="collaboration-workspace-task-card-priority"><Flag aria-hidden="true" />{card.priority === 'urgent' ? '紧急' : '高'}</span> : null}
      </div>
      <h3>{card.unread ? <span className="collaboration-workspace-task-card-unread-dot" role="img" aria-label="未读" /> : null}{card.title}</h3>
      {card.stateLabel ? <span className={`collaboration-workspace-task-card-state ${card.executionFailure ? 'tone-warning' : stateTone(card.stateLabel)}`}>{card.stateLabel}</span> : null}
      {card.blockedByLabel ? <p className="collaboration-workspace-task-card-state tone-warning">{card.blockedByLabel}</p> : null}
      <div className="collaboration-workspace-task-card-meta">
        <span className={card.assignee ? undefined : 'is-unassigned'}><UserRound aria-hidden="true" />{card.assignee ?? '待分配'}</span>
        <time><Clock3 aria-hidden="true" />{card.date}</time>
      </div>
    </article>
  )
}

export function stateTone(label: string): string {
  if (label === '等待回答' || label === '等待成员回答' || label === '返修中') return 'tone-warning'
  if (label === '待你接受' || label === '待你采纳' || label === '待提交交付') return 'tone-accent'
  return 'tone-neutral'
}
