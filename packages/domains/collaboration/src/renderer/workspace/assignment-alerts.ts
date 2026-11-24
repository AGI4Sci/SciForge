import type { TaskCardModel } from './workspace-types.js'
import type { WorkspacePersonalItem } from './workspace-view-model.js'

/**
 * One Task that is waiting for this User, either because the local Offer gate
 * says it can be accepted right now, or because the inbox still holds an
 * unread assignment event for it. The workspace alert and the 看板 badge read
 * this single list so their counts can never disagree.
 */
export type PendingAssignment = Readonly<{
  /** Stable identity of one Project + Task row. */
  key: string
  taskId: string
  projectId: string
  title: string
  reference?: string
  /** The exact local Offer this Desktop may decide, when the gate proved it. */
  offerId?: string
  /** True only when the canonical capability currently allows accepting it. */
  acceptable: boolean
}>

function assignmentKey(projectId: string, taskId: string): string {
  return `${projectId}\u0000${taskId}`
}

const inboxTitlePrefix = /^(?:新任务待接受|任务待接受|派单状态)[：:]\s*/u

/**
 * Inbox states that still mean "this assignment is waiting for you". A syncing,
 * recovering, claimed-elsewhere or closed row is a status update, not a new
 * assignment, so it must not keep the alert alive after the User decided.
 */
const pendingInboxStates: ReadonlySet<string> = new Set(['待接受', '待核实'])

/**
 * The inbox item's title already carries a delivery/notification prefix. The
 * alert quotes the Task title itself.
 */
function assignmentTitle(item: WorkspacePersonalItem): string {
  return item.title.replace(inboxTitlePrefix, '')
}

export function pendingAssignments(
  cards: readonly TaskCardModel[],
  inbox: readonly WorkspacePersonalItem[]
): readonly PendingAssignment[] {
  const items: PendingAssignment[] = []
  const seen = new Set<string>()
  const push = (item: PendingAssignment): void => {
    if (seen.has(item.key)) return
    seen.add(item.key)
    items.push(item)
  }
  // A card proves the exact Offer behind an assignment; it always outranks the
  // inbox row that describes the same Task.
  for (const card of cards) {
    if (!card.projectId || !card.offerId || card.offerAvailability?.canAccept !== true) continue
    push({
      key: assignmentKey(card.projectId, card.id),
      taskId: card.id,
      projectId: card.projectId,
      title: card.title,
      reference: card.reference,
      offerId: card.offerId,
      acceptable: true
    })
  }
  for (const item of inbox) {
    if (!pendingInboxStates.has(item.state)) continue
    push({
      key: item.taskId ? assignmentKey(item.projectId, item.taskId) : `inbox:${item.id}`,
      taskId: item.taskId ?? '',
      projectId: item.projectId,
      title: assignmentTitle(item),
      ...(item.reference ? { reference: item.reference } : {}),
      acceptable: false
    })
  }
  return items
}

/** A changed set of assignments re-opens a dismissed alert; the same set stays closed. */
export function assignmentAlertSignature(items: readonly PendingAssignment[]): string {
  return items.map((item) => item.key).sort().join('\u0001')
}

/**
 * "全部接受" is only unambiguous when every pending assignment was proved by a
 * concrete local Offer. Anything that still needs verification stays behind
 * the 查看 action so the User does not mass-accept an unknown gate.
 */
export function canAcceptAllAssignments(items: readonly PendingAssignment[]): boolean {
  return items.length > 0 && items.every((item) => item.acceptable && Boolean(item.offerId))
}

export function assignmentOfferIds(items: readonly PendingAssignment[]): readonly string[] {
  return [...new Set(items.flatMap((item) => item.offerId ? [item.offerId] : []))]
}
