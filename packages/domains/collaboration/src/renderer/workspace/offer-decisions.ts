import type { CollaborationOfferAvailability, CollaborationTaskOfferDecisionInput } from '../../contract.js'

/**
 * The three human decisions the canonical `collaboration.task.offer.decide`
 * capability accepts. A surface may render them differently, but none of them
 * may exist without the backend decision gate saying so.
 */
export type OfferDecision = 'accept' | 'dismiss' | 'reject'

export type OfferActionTone = 'primary' | 'secondary' | 'ghost'

export type OfferAction = Readonly<{
  decision: OfferDecision
  /** Compact label for the board card action row. */
  label: string
  /** Detail label used by the Task drawer action band. */
  detailLabel: string
  /** Verb that names the action in an accessible label for one exact Task. */
  ariaVerb: string
  tone: OfferActionTone
}>

const actions: Readonly<Record<OfferDecision, Omit<OfferAction, 'decision'>>> = {
  accept: { label: '接受', detailLabel: '接受任务', ariaVerb: '接受任务', tone: 'primary' },
  dismiss: { label: '忽略', detailLabel: '忽略', ariaVerb: '忽略任务', tone: 'ghost' },
  reject: { label: '拒绝', detailLabel: '拒绝', ariaVerb: '拒绝任务', tone: 'secondary' }
}

const order: readonly OfferDecision[] = ['accept', 'dismiss', 'reject']

/** One presentation of the backend gate shared by the board and the drawer. */
export function offerActions(availability: CollaborationOfferAvailability | null | undefined): readonly OfferAction[] {
  if (!availability) return []
  return order
    .filter((decision) => offerDecisionAllowed(availability, decision))
    .map((decision) => ({ decision, ...actions[decision] }))
}

export function offerDecisionAllowed(
  availability: CollaborationOfferAvailability | null | undefined,
  decision: OfferDecision
): boolean {
  if (!availability) return false
  if (decision === 'accept') return availability.canAccept
  if (decision === 'reject') return availability.canReject
  return availability.canDismiss
}

export function offerAction(decision: OfferDecision): OfferAction {
  return { decision, ...actions[decision] }
}

export function offerDecisionBusyLabel(decision: OfferDecision): string {
  return decision === 'accept' ? '接受中…' : decision === 'dismiss' ? '忽略中…' : '拒绝中…'
}

/** The page-wide action kind for one card decision; the drawer reads the same value. */
export function offerDecisionActionKind(decision: OfferDecision): `offer-${OfferDecision}` {
  return `offer-${decision}`
}

export function offerDecisionFromActionKind(kind: string | undefined): OfferDecision | null {
  if (kind === 'offer-accept') return 'accept'
  if (kind === 'offer-dismiss') return 'dismiss'
  if (kind === 'offer-reject') return 'reject'
  return null
}

export function offerDecisionInput(
  taskOfferId: string,
  decision: OfferDecision
): CollaborationTaskOfferDecisionInput {
  if (decision === 'accept') return { taskOfferId, decision: 'accept' }
  if (decision === 'reject') return { taskOfferId, decision: 'reject' }
  return { taskOfferId, decision: 'dismiss' }
}
