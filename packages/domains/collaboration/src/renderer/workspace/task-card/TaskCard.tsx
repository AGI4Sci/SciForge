import { useWorkspaceTranslation } from '../workspace-i18n.js'
import React, { type ReactElement } from 'react'
import { Clock3, Flag, UserRound, UserRoundPlus } from 'lucide-react'
import { offerActions, offerDecisionBusyLabel, type OfferAction, type OfferDecision } from '../offer-decisions.js'
import type { TaskAssignmentModel, TaskCardModel } from '../workspace-types.js'

/**
 * One board card. The clickable body and the action row are siblings: a button
 * may never wrap another button, so the card is an article that owns both.
 * Offer actions exist only when the backend Offer gate allows them; the
 * Owner's dispatch action exists only when the Project Coordinator proves an
 * assignment step for this module.
 */
export function TaskCard({
  card,
  selected = false,
  busy = false,
  pendingDecision,
  canAssign = false,
  onOpen,
  onDecide,
  onAssignRequest,
}: Readonly<{
  card: TaskCardModel
  selected?: boolean
  /** A decision for this card is in flight. */
  busy?: boolean
  pendingDecision?: OfferDecision
  /** The current User owns the Project, so this card may be handed to a Member. */
  canAssign?: boolean
  onOpen?(card: TaskCardModel): void
  onDecide?(card: TaskCardModel, decision: OfferDecision): void
  /** Opens the canonical assignment band for this exact card. */
  onAssignRequest?(card: TaskCardModel): void
}>): ReactElement {
  const cw = useWorkspaceTranslation()
  const actions = card.offerId ? offerActions(card.offerAvailability) : []
  const assignmentAction = canAssign && card.assignment ? assignmentActionFor(card.assignment) : null
  const hasActions = actions.length > 0 || assignmentAction !== null
  const className = `collaboration-workspace-task-card${selected ? ' is-selected' : ''}${card.unread ? ' is-unread' : ''}${hasActions ? ' has-actions' : ''}`
  return (
    <article className={className}>
      <button
        type="button"
        className="collaboration-workspace-task-card-button"
        aria-pressed={selected}
        aria-label={cw('打开任务 {{reference}} {{title}}{{unread}}', { reference: card.reference, title: card.title, unread: card.unread ? cw('（未读）') : '' })}
        onClick={() => onOpen?.(card)}
      >
        <span className="collaboration-workspace-task-card-kicker">
          <span className="collaboration-workspace-task-card-reference">{card.reference}</span>
          <span className="collaboration-workspace-task-card-module">{cw(card.moduleType)}</span>
          {card.priority ? <span className="collaboration-workspace-task-card-priority"><Flag aria-hidden="true" />{cw(card.priority === 'urgent' ? '紧急' : '高')}</span> : null}
        </span>
        <h3 className="collaboration-workspace-task-card-title">
          {card.unread ? <span className="collaboration-workspace-task-card-unread-dot" aria-hidden="true" /> : null}
          {card.title}
        </h3>
        {card.stateLabel ? <span className={`collaboration-workspace-task-card-state ${card.executionFailure ? 'tone-warning' : stateTone(card.stateLabel)}`}>{cw(card.stateLabel)}</span> : null}
        {card.blockedByLabel ? <span className="collaboration-workspace-task-card-state tone-warning">{card.blockedByLabel}</span> : null}
        <span className="collaboration-workspace-task-card-meta">
          <span className={`collaboration-workspace-task-card-assignee${card.assignee ? '' : ' is-unassigned'}`}><UserRound aria-hidden="true" />{card.assignee ?? cw('待分配')}</span>
          <time className="collaboration-workspace-task-card-date"><Clock3 aria-hidden="true" />{cw(card.date)}</time>
        </span>
      </button>
      {hasActions ? (
        <div
          className="collaboration-workspace-task-card-actions"
          role="group"
          aria-label={cw('任务 {{reference}} 的操作', { reference: card.reference })}
          data-testid={`task-card-actions:${card.id}`}
        >
          {assignmentAction ? (
            <button
              type="button"
              className="collaboration-workspace-task-card-action tone-assign"
              data-assign={card.assignment!.kind}
              aria-label={cw('{{action}}：{{reference}} {{title}}', { action: cw(assignmentAction.verb), reference: card.reference, title: card.title })}
              title={cw(assignmentAction.title)}
              disabled={busy}
              onClick={() => onAssignRequest?.(card)}
            >
              <UserRoundPlus aria-hidden="true" />
              {cw(assignmentAction.label)}
            </button>
          ) : null}
          {actions.map((action) => <CardActionButton key={action.decision} card={card} action={action} busy={busy} pendingDecision={pendingDecision} onDecide={onDecide} />)}
        </div>
      ) : null}
    </article>
  )
}

/**
 * The two dispatch shapes the Coordinator proves: a first assignment for a
 * module that never had an Offer, and a replacement for a terminal or pending
 * one. Both open the same assignment band in the Task drawer.
 */
function assignmentActionFor(assignment: TaskAssignmentModel): Readonly<{ label: string; verb: string; title: string }> {
  if (assignment.kind === 'first') {
    return { label: '分配', verb: '分配任务', title: '打开任务，选择成员后派发' }
  }
  return { label: '改派', verb: '改派任务', title: '打开任务，改派或撤回当前派单' }
}

function CardActionButton({ card, action, busy, pendingDecision, onDecide }: Readonly<{
  card: TaskCardModel
  action: OfferAction
  busy: boolean
  pendingDecision?: OfferDecision
  onDecide?(card: TaskCardModel, decision: OfferDecision): void
}>): ReactElement {
  const cw = useWorkspaceTranslation()
  const pending = busy && pendingDecision === action.decision
  return (
    <button
      type="button"
      className={`collaboration-workspace-task-card-action tone-${action.tone}${pending ? ' is-busy' : ''}`}
      data-decision={action.decision}
      aria-label={cw('{{action}}：{{reference}} {{title}}', { action: cw(action.ariaVerb), reference: card.reference, title: card.title })}
      disabled={busy}
      onClick={() => onDecide?.(card, action.decision)}
    >
      {cw(pending ? offerDecisionBusyLabel(action.decision) : action.label)}
    </button>
  )
}

export function stateTone(label: string): string {
  if (label === '等待决定' || label === '等待成员决定' || label === '等待回答' || label === '等待成员回答' || label === '返修中') return 'tone-warning'
  if (label === '待你接受' || label === '待你采纳' || label === '待提交交付') return 'tone-accent'
  return 'tone-neutral'
}
