import type { TaskOffer } from '@sciforge/collaboration-contracts'

import {
  buildTaskRecoveryLineage,
  observationFromTaskView,
  type TaskRecoveryAttempt,
  type TaskRecoveryLineage
} from './task-recovery.js'
import type { ProjectCoordinatorProject } from './contract.js'

export type ProjectCoordinatorTaskHistory = Readonly<{
  taskId: string
  attempts: readonly TaskRecoveryAttempt[]
  offers: readonly TaskOffer[]
  lineage: TaskRecoveryLineage
  retryLimit: number
  retriesUsed: number
  retriesRemaining: number
  canRetry: boolean
  canWithdrawPendingOffer: boolean
  canExtendPendingOffer: boolean
}>

/**
 * Build the renderer-facing history from immutable Cloud facts. This helper
 * never mutates or infers a new Cloud state; action availability is only a
 * convenience for rendering the existing canonical capabilities.
 */
export function projectCoordinatorTaskHistory(
  project: ProjectCoordinatorProject,
  taskView: ProjectCoordinatorProject['tasks'][number]
): ProjectCoordinatorTaskHistory {
  const observation = observationFromTaskView(project, taskView)
  const lineage = buildTaskRecoveryLineage(observation)
  const offers = Object.freeze([...observation.offers].sort(compareOfferHistory))
  const retriesUsed = Math.max(0, taskView.task.executionCount - 1)
  const retriesRemaining = Math.max(0, taskView.task.maxRetries - retriesUsed)
  const pendingOffer = offers.find((offer) => (
    offer.state === 'pending' && offer.executionId === null
  ))
  const canRetry = taskView.task.status === 'revision_requested' &&
    retriesRemaining > 0 && lineage.pendingOfferIds.length === 0
  return Object.freeze({
    taskId: taskView.task.taskId,
    attempts: lineage.attempts,
    offers,
    lineage,
    retryLimit: taskView.task.maxRetries,
    retriesUsed,
    retriesRemaining,
    canRetry,
    canWithdrawPendingOffer: taskView.task.status === 'offered' && pendingOffer !== undefined,
    canExtendPendingOffer: taskView.task.status === 'offered' && pendingOffer !== undefined
  })
}

function compareOfferHistory(left: TaskOffer, right: TaskOffer): number {
  return left.createdAt.localeCompare(right.createdAt) ||
    left.revision - right.revision ||
    left.taskOfferId.localeCompare(right.taskOfferId)
}

