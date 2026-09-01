import type {
  Task,
  TaskExecution,
  TaskOffer
} from '@sciforge/collaboration-contracts'

import type {
  ProjectCoordinatorProject
} from './contract.js'

type ProjectCoordinatorTaskView = ProjectCoordinatorProject['tasks'][number]

/**
 * A bounded observation of one Cloud Task and its immutable execution/offer
 * history.  This is a local read model: it never claims a new Cloud state.
 */
export type TaskRecoveryObservation = Readonly<{
  projectId: string
  taskId: string
  projectRevision: number
  coordinatorAuthorityEpoch: number
  executionAuthorityEpoch: number
  task: Task
  executions: readonly TaskExecution[]
  offers: readonly TaskOffer[]
}>

export type TaskRecoveryAction =
  | 'continue_current_execution'
  | 'await_result_review'
  | 'recover_content'
  | 'reassign_successor'
  | 'await_worker_offer'
  | 'completed'
  | 'blocked'

export type TaskRecoveryDecision = Readonly<{
  action: TaskRecoveryAction
  projectId: string
  taskId: string
  taskRevision: number
  currentExecutionId: string | null
  currentExecutionRevision: number | null
  retryable: boolean
  /** Existing accepted/terminal offer to pass to task-offer.reassign. */
  previousTaskOfferId: string | null
  /** The current execution's Worker User, or the terminal unclaimed offer User. */
  workerUserId: string | null
  reason: string
  lineage: TaskRecoveryLineage
}>

export type TaskRecoveryAttempt = Readonly<{
  executionId: string
  attempt: number
  state: TaskExecution['state']
  stateRevision: number
  fenceStatus: TaskExecution['fence']['status']
  fenceReason: TaskExecution['fence']['reason']
  assigneeUserId: string
  offerId: string | null
  isCurrent: boolean
  /** Derived locally from immutable attempt ordering; not a Cloud field. */
  parentExecutionId: string | null
  /** Derived locally from immutable attempt ordering; not a Cloud field. */
  childExecutionId: string | null
}>

export type TaskRecoveryLineage = Readonly<{
  taskId: string
  currentExecutionId: string | null
  attempts: readonly TaskRecoveryAttempt[]
  pendingOfferIds: readonly string[]
}>

/** Build a task-scoped observation from a Project Coordinator workspace read. */
export function taskRecoveryObservation(
  project: ProjectCoordinatorProject,
  taskId: string
): TaskRecoveryObservation {
  const taskView = project.tasks.find(({ task }) => task.taskId === taskId)
  if (!taskView) throw new Error('The exact Task is not present in the Project workspace.')
  return observationFromTaskView(project, taskView)
}

/** Build a task-scoped observation when the caller already has the Task view. */
export function observationFromTaskView(
  project: Pick<ProjectCoordinatorProject, 'project' | 'offers'>,
  taskView: ProjectCoordinatorTaskView
): TaskRecoveryObservation {
  if (taskView.task.projectId !== project.project.projectId) {
    throw new Error('Task recovery observation crosses a Project boundary.')
  }
  const observation = {
    projectId: project.project.projectId,
    taskId: taskView.task.taskId,
    projectRevision: project.project.revision,
    coordinatorAuthorityEpoch: project.project.coordinatorAuthorityEpoch,
    executionAuthorityEpoch: project.project.executionAuthorityEpoch,
    task: taskView.task,
    executions: Object.freeze([...taskView.executions]),
    offers: Object.freeze(project.offers.filter(({ taskId }) => taskId === taskView.task.taskId))
  }
  validateObservationIdentity(observation)
  return Object.freeze(observation)
}

/**
 * Derive the only safe local next action.  The result intentionally separates
 * an active execution from a fenced historical execution.  Callers may use a
 * `reassign_successor` result with the existing
 * `project-coordinator.task-offer.reassign` capability; no local state is
 * promoted to a Cloud success.
 */
export function deriveTaskRecoveryDecision(
  observation: TaskRecoveryObservation
): TaskRecoveryDecision {
  validateObservationIdentity(observation)
  const { task } = observation
  const lineage = buildTaskRecoveryLineage(observation)
  const retryable = task.executionCount < task.maxRetries + 1
  const currentExecutionId = task.currentExecutionId
  const currentExecution = currentExecutionId === null
    ? null
    : observation.executions.find(({ executionId }) => executionId === currentExecutionId) ?? null
  const base = {
    projectId: observation.projectId,
    taskId: observation.taskId,
    taskRevision: task.revision,
    currentExecutionId,
    currentExecutionRevision: currentExecution?.revision ?? null,
    retryable,
    lineage
  }

  if (currentExecutionId !== null && currentExecution === null) {
    return {
      ...base,
      action: 'blocked',
      previousTaskOfferId: null,
      workerUserId: null,
      reason: 'Cloud Task facts reference a current execution that is missing from the local workspace read.'
    }
  }
  if (currentExecution && task.currentExecutionState !== currentExecution.state) {
    return {
      ...base,
      action: 'blocked',
      previousTaskOfferId: offerForExecution(observation.offers, currentExecution.executionId)?.taskOfferId ?? null,
      workerUserId: currentExecution.assigneeUserId,
      reason: 'Task and execution current-state projections disagree; refresh before taking a recovery action.'
    }
  }

  if (currentExecution && isActiveExecution(currentExecution)) {
    if (currentExecution.fence.status !== 'open') {
      return {
        ...base,
        action: 'blocked',
        previousTaskOfferId: acceptedOfferForExecution(observation.offers, currentExecution.executionId)?.taskOfferId ?? null,
        workerUserId: currentExecution.assigneeUserId,
        reason: 'The execution appears active but is already fenced; do not dispatch another Worker turn.'
      }
    }
    return {
      ...base,
      action: 'continue_current_execution',
      previousTaskOfferId: acceptedOfferForExecution(observation.offers, currentExecution.executionId)?.taskOfferId ?? null,
      workerUserId: currentExecution.assigneeUserId,
      reason: currentExecution.state === 'needs_human'
        ? 'The active execution is waiting for a human answer.'
        : 'The current execution has an open Cloud fence and may receive another local interaction turn.'
    }
  }

  if (currentExecution?.state === 'result_submitted') {
    return {
      ...base,
      action: 'await_result_review',
      previousTaskOfferId: acceptedOfferForExecution(observation.offers, currentExecution.executionId)?.taskOfferId ?? null,
      workerUserId: currentExecution.assigneeUserId,
      reason: 'The immutable result was submitted; wait for Project Coordinator review.'
    }
  }

  if (currentExecution?.state === 'manual_recovery_required') {
    return {
      ...base,
      action: 'recover_content',
      previousTaskOfferId: acceptedOfferForExecution(observation.offers, currentExecution.executionId)?.taskOfferId ?? null,
      workerUserId: currentExecution.assigneeUserId,
      reason: 'The execution is fenced for content recovery; observe/link or abandon the exact recovery action first.'
    }
  }

  if (currentExecution && isFailedFencedExecution(currentExecution)) {
    const previousOffer = acceptedOfferForExecution(observation.offers, currentExecution.executionId)
    if (!retryable || task.status !== 'revision_requested' || previousOffer === null) {
      return {
        ...base,
        action: 'blocked',
        previousTaskOfferId: previousOffer?.taskOfferId ?? null,
        workerUserId: currentExecution.assigneeUserId,
        reason: previousOffer === null
          ? 'The terminal execution has no exact accepted Task offer for reassignment.'
          : retryable
          ? 'A fenced execution is terminal, but the Task is not in revision_requested state.'
          : 'The Task retry budget is exhausted; the fenced execution cannot be reassigned.'
      }
    }
    return {
      ...base,
      action: 'reassign_successor',
      previousTaskOfferId: previousOffer?.taskOfferId ?? null,
      workerUserId: currentExecution.assigneeUserId,
      reason: 'The current execution is terminal and fenced; use the existing reassignment capability to create a successor offer.'
    }
  }

  if (currentExecution?.state === 'completed' || task.status === 'completed') {
    return {
      ...base,
      action: 'completed',
      previousTaskOfferId: currentExecution
        ? acceptedOfferForExecution(observation.offers, currentExecution.executionId)?.taskOfferId ?? null
        : null,
      workerUserId: currentExecution?.assigneeUserId ?? null,
      reason: 'The Task has a completed immutable execution.'
    }
  }

  if (currentExecutionId === null && task.status === 'revision_requested') {
    const previousOffer = terminalUnclaimedOfferForReassignment(observation.offers, task.revision)
    if (!retryable || previousOffer === null) {
      return {
        ...base,
        action: 'blocked',
        previousTaskOfferId: previousOffer?.taskOfferId ?? null,
        workerUserId: previousOffer?.workerUserId ?? null,
        reason: !retryable
          ? 'The Task retry budget is exhausted; no successor offer may be created.'
          : 'The revision-requested Task has no exact terminal unclaimed offer for reassignment.'
      }
    }
    return {
      ...base,
      action: 'reassign_successor',
      previousTaskOfferId: previousOffer.taskOfferId,
      workerUserId: previousOffer.workerUserId,
      reason: 'The current Task revision is eligible for reassignment from the exact terminal unclaimed offer.'
    }
  }

  if (currentExecutionId === null && task.status === 'offered') {
    const pendingOffer = observation.offers
      .filter(({ taskId, state }) => taskId === task.taskId && state === 'pending')
      .sort(compareOffer)
      .at(-1)
    return {
      ...base,
      action: 'await_worker_offer',
      previousTaskOfferId: null,
      workerUserId: pendingOffer?.workerUserId ?? null,
      reason: pendingOffer
        ? 'A successor offer is pending a Worker claim.'
        : 'The Task is offered but no pending Worker offer is visible in this workspace read.'
    }
  }

  return {
    ...base,
    action: 'blocked',
    previousTaskOfferId: null,
    workerUserId: currentExecution?.assigneeUserId ?? null,
    reason: 'The Task state is not safe for a local recovery action; refresh Cloud facts before continuing.'
  }
}

/**
 * Merge two reads without allowing stale Cloud facts to overwrite newer local
 * facts. Equal revisions must be byte-for-byte equal (canonical JSON), while
 * higher revisions replace the older entity and omitted history is retained.
 */
export function mergeTaskRecoveryObservations(
  previous: TaskRecoveryObservation,
  next: TaskRecoveryObservation
): TaskRecoveryObservation {
  validateObservationIdentity(previous)
  validateObservationIdentity(next)
  if (previous.projectId !== next.projectId || previous.taskId !== next.taskId) {
    throw new Error('Task recovery observations target different Project or Task identities.')
  }
  if (next.projectRevision < previous.projectRevision) {
    throw new Error('A stale Project recovery observation cannot replace newer Cloud facts.')
  }
  if (next.coordinatorAuthorityEpoch < previous.coordinatorAuthorityEpoch ||
      next.executionAuthorityEpoch < previous.executionAuthorityEpoch) {
    throw new Error('A stale Project authority observation cannot replace newer Cloud facts.')
  }
  const task = mergeVersionedEntity(previous.task, next.task, 'taskId')
  const executions = mergeVersionedCollection(
    previous.executions,
    next.executions,
    (execution) => execution.executionId
  )
  const offers = mergeVersionedCollection(
    previous.offers,
    next.offers,
    (offer) => offer.taskOfferId
  )
  if (task.projectId !== previous.projectId || task.taskId !== previous.taskId) {
    throw new Error('Merged Task recovery facts crossed a Project or Task boundary.')
  }
  return Object.freeze({
    projectId: previous.projectId,
    taskId: previous.taskId,
    projectRevision: Math.max(previous.projectRevision, next.projectRevision),
    coordinatorAuthorityEpoch: Math.max(
      previous.coordinatorAuthorityEpoch,
      next.coordinatorAuthorityEpoch
    ),
    executionAuthorityEpoch: Math.max(
      previous.executionAuthorityEpoch,
      next.executionAuthorityEpoch
    ),
    task,
    executions: Object.freeze(executions),
    offers: Object.freeze(offers)
  })
}

function validateObservationIdentity(observation: TaskRecoveryObservation): void {
  if (observation.projectId !== observation.task.projectId ||
      observation.taskId !== observation.task.taskId) {
    throw new Error('Task recovery observation identity does not match its Task snapshot.')
  }
  for (const execution of observation.executions) {
    if (execution.projectId !== observation.projectId || execution.taskId !== observation.taskId) {
      throw new Error('Task recovery execution history crossed a Project or Task boundary.')
    }
  }
  for (const offer of observation.offers) {
    if (offer.projectId !== observation.projectId || offer.taskId !== observation.taskId) {
      throw new Error('Task recovery offer history crossed a Project or Task boundary.')
    }
  }
}

export function buildTaskRecoveryLineage(
  observation: Pick<TaskRecoveryObservation, 'taskId' | 'task' | 'executions' | 'offers'>
): TaskRecoveryLineage {
  const executions = [...observation.executions]
    .sort((left, right) => (
      left.attempt - right.attempt ||
      left.offeredAt.localeCompare(right.offeredAt) ||
      left.executionId.localeCompare(right.executionId)
    ))
  const attempts = executions.map((execution, index) => {
    const previous = executions[index - 1]
    const next = executions[index + 1]
    return Object.freeze({
      executionId: execution.executionId,
      attempt: execution.attempt,
      state: execution.state,
      stateRevision: execution.stateRevision,
      fenceStatus: execution.fence.status,
      fenceReason: execution.fence.reason,
      assigneeUserId: execution.assigneeUserId,
      offerId: offerForExecution(observation.offers, execution.executionId)?.taskOfferId ?? null,
      isCurrent: observation.task.currentExecutionId === execution.executionId,
      parentExecutionId: previous?.executionId ?? null,
      childExecutionId: next?.executionId ?? null
    })
  })
  return Object.freeze({
    taskId: observation.taskId,
    currentExecutionId: observation.task.currentExecutionId,
    attempts: Object.freeze(attempts),
    pendingOfferIds: Object.freeze(observation.offers
      .filter(({ state }) => state === 'pending')
      .sort(compareOffer)
      .map(({ taskOfferId }) => taskOfferId))
  })
}

function isActiveExecution(execution: TaskExecution): boolean {
  return execution.state === 'accepted' ||
    execution.state === 'running' ||
    execution.state === 'needs_human'
}

function isFailedFencedExecution(execution: TaskExecution): boolean {
  return (execution.state === 'failed' ||
    execution.state === 'cancelled' ||
    execution.state === 'revoked') && execution.fence.status === 'fenced'
}

function acceptedOfferForExecution(
  offers: readonly TaskOffer[],
  executionId: string
): TaskOffer | null {
  return offers
    .filter(({ executionId: candidate, state }) => candidate === executionId && state === 'accepted')
    .sort(compareOffer)
    .at(-1) ?? null
}

function offerForExecution(
  offers: readonly TaskOffer[],
  executionId: string
): TaskOffer | null {
  return offers
    .filter(({ executionId: candidate }) => candidate === executionId)
    .sort(compareOffer)
    .at(-1) ?? null
}

function terminalUnclaimedOfferForReassignment(
  offers: readonly TaskOffer[],
  taskRevision: number
): TaskOffer | null {
  return offers
    .filter(({ executionId, reassignmentTaskRevision, state }) => (
      executionId === null &&
      reassignmentTaskRevision === taskRevision &&
      (state === 'rejected' || state === 'withdrawn' || state === 'timed_out')
    ))
    .sort(compareOffer)
    .at(-1) ?? null
}

function compareOffer(left: TaskOffer, right: TaskOffer): number {
  const responseOrder = left.respondedAt === null
    ? right.respondedAt === null ? 0 : -1
    : right.respondedAt === null
      ? 1
      : left.respondedAt.localeCompare(right.respondedAt)
  return left.revision - right.revision ||
    responseOrder ||
    left.createdAt.localeCompare(right.createdAt) ||
    left.taskOfferId.localeCompare(right.taskOfferId)
}

function mergeVersionedCollection<Value extends { revision: number }>(
  previous: readonly Value[],
  next: readonly Value[],
  id: (value: Value) => string
): Value[] {
  const merged = new Map(previous.map((value) => [id(value), value]))
  for (const candidate of next) {
    const existing = merged.get(id(candidate))
    if (!existing || candidate.revision > existing.revision) {
      merged.set(id(candidate), candidate)
      continue
    }
    if (candidate.revision === existing.revision && stableJson(candidate) !== stableJson(existing)) {
      throw new Error(`Cloud revision conflict for ${id(candidate)}.`)
    }
  }
  return [...merged.values()]
}

function mergeVersionedEntity<Value extends { revision: number }>(
  previous: Value,
  next: Value,
  idKey: keyof Value
): Value {
  if (previous[idKey] !== next[idKey]) throw new Error('Cloud entity identities do not match.')
  if (next.revision > previous.revision) return next
  if (next.revision < previous.revision) {
    throw new Error('A stale Cloud Task observation cannot replace newer Task facts.')
  }
  if (stableJson(previous) !== stableJson(next)) {
    throw new Error(`Cloud revision conflict for ${String(previous[idKey])}.`)
  }
  return previous
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`
}
