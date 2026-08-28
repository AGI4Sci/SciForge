import { createHash, randomUUID } from 'node:crypto'
import {
  idempotencyComparableCommandProjection,
  restRequestSchema,
  restResponseSchema,
  type RestRequest,
  type RestResponse
} from '@sciforge/collaboration-contracts'
import { canonicalTaskIdForPlanItem } from '@sciforge/collaboration-contracts/node'
import type { AgentCloudRuntime } from '@sciforge/domain-identity-access/agent-cloud-runtime'
import {
  coordinatorCloudCommandSchema,
  type CoordinatorCloudCommand
} from '../coordinator-cloud-command.js'
import type { ProjectionCloudOutbox, ProjectionDeliveryCommand } from './projection-coordinator.js'
import type { CollaborationOutboxEntry } from './store.js'
import { CollaborationLocalStore } from './store.js'

export type DurableCloudOutboxOptions = Readonly<{
  store: CollaborationLocalStore
  agentCloudRuntime: AgentCloudRuntime
  localAgentId: () => string | undefined
  sanitizeText?: (value: string) => string
  now?: () => Date
}>

type CoordinatorActor = Readonly<{
  agentId: string
  userId: string
}>

type TerminalWaiter = Readonly<{
  resolve: (response: RestResponse) => void
  reject: (error: Error) => void
}>

export class DurableCloudOutbox implements ProjectionCloudOutbox {
  private readonly now: () => Date
  private drainTail: Promise<void> = Promise.resolve()
  private readonly terminalWaiters = new Map<string, Set<TerminalWaiter>>()
  private stopped = false

  constructor(private readonly options: DurableCloudOutboxOptions) {
    this.now = options.now ?? (() => new Date())
  }

  start(): void {
    this.stopped = false
    this.schedule()
  }

  wake(): void {
    this.schedule()
  }

  stop(): void {
    this.stopped = true
  }

  async waitForIdle(): Promise<void> {
    await this.drainTail
  }

  async enqueueProjectionDelivery(
    command: ProjectionDeliveryCommand,
    idempotencyKey: string
  ): Promise<void> {
    const request = restRequestSchema.parse({
      protocolVersion: '1.0',
      requestId: requestId(),
      type: 'projection.message.publish',
      idempotencyKey,
      ...command
    })
    await this.enqueue('projection.message', request)
  }

  async enqueue(
    kind: CollaborationOutboxEntry['kind'],
    request: RestRequest
  ): Promise<void> {
    const parsed = restRequestSchema.parse(request)
    if (!('idempotencyKey' in parsed)) {
      throw new Error('Durable cloud outbox accepts idempotent write commands only.')
    }
    const bodyHash = idempotentCommandHash(parsed)
    const supersession = commandSupersession(kind, parsed)
    await this.options.store.transact((draft) => {
      const existing = draft.outbox.find((entry) => entry.idempotencyKey === parsed.idempotencyKey)
      if (existing) {
        if (idempotentCommandHash(existing.body) !== bodyHash) {
          throw new Error('Outbox idempotency key was reused for a different command.')
        }
        return
      }
      if (supersession) {
        // Availability is a heartbeat-fenced current observation, not an
        // append-only external effect. Once a newer observation exists, an
        // older non-sending command can only fail its Agent revision CAS and
        // must not block the current projection. An actively sending command
        // remains so its in-flight delivery can settle against a durable row.
        let newerFactAlreadyQueued = false
        draft.outbox = draft.outbox.filter((entry) => {
          const queued = commandSupersession(entry.kind, entry.body)
          if (!queued || queued.key !== supersession.key) return true
          if (compareSupersessionOrder(queued, supersession) > 0) {
            newerFactAlreadyQueued = true
            return true
          }
          return entry.state === 'sending'
        })
        if (newerFactAlreadyQueued) return
      }
      const now = this.now().toISOString()
      draft.outbox.push({
        outboxId: localOpaqueId('obx'),
        idempotencyKey: parsed.idempotencyKey,
        kind,
        body: parsed,
        state: 'pending',
        attempts: 0,
        createdAt: now,
        updatedAt: now
      })
    })
    this.schedule()
  }

  /**
   * Durably enqueue one idempotent command and return the exact strict Cloud
   * response retained with the delivered entry. This is used when the next
   * local journal checkpoint needs a Cloud-issued immutable identity.
   */
  async enqueueAndWait(
    kind: CollaborationOutboxEntry['kind'],
    request: RestRequest
  ): Promise<RestResponse> {
    const parsed = restRequestSchema.parse(request)
    if (!('idempotencyKey' in parsed)) {
      throw new Error('Durable cloud outbox accepts idempotent write commands only.')
    }
    const existingBeforeEnqueue = this.options.store.snapshot().outbox.find((candidate) => (
      candidate.idempotencyKey === parsed.idempotencyKey
    ))
    await this.enqueue(kind, parsed)
    if (existingBeforeEnqueue?.state === 'failed') {
      await this.retry(existingBeforeEnqueue.outboxId)
    }
    return this.waitForTerminal(parsed.idempotencyKey)
  }

  async retry(id?: string): Promise<void> {
    await this.options.store.transact((draft) => {
      const candidates = draft.outbox.filter((entry) => (
        entry.state === 'failed' && (!id || entry.outboxId === id || entry.idempotencyKey === id)
      ))
      const now = this.now().toISOString()
      for (const entry of candidates) {
        entry.state = 'reconciling'
        entry.error = undefined
        entry.updatedAt = now
      }
    })
    this.schedule()
  }

  private schedule(): void {
    if (this.stopped) return
    this.drainTail = this.drainTail.then(
      () => this.drain(),
      () => this.drain()
    )
  }

  private async drain(): Promise<void> {
    while (!this.stopped) {
      const agentId = this.options.localAgentId()
      if (!agentId) return
      const authority = await this.options.agentCloudRuntime.authorityStatus(agentId)
      if (authority.state !== 'ready') return
      const next = this.options.store.snapshot().outbox
        .filter((entry) => entry.state === 'pending' || entry.state === 'reconciling')
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0]
      if (!next) return
      const startedAt = this.now().toISOString()
      const request = restRequestSchema.parse(next.body)
      await this.options.store.transact((draft) => {
        const entry = requireOutbox(draft.outbox, next.outboxId)
        if (entry.state !== 'pending' && entry.state !== 'reconciling') return
        entry.state = 'sending'
        entry.attempts += 1
        entry.updatedAt = startedAt
        entry.error = undefined
      })
      try {
        const response = restResponseSchema.parse(
          await this.options.agentCloudRuntime.execute({ agentId, request })
        )
        assertExpectedWriteResponse(next.kind, request, response, {
          agentId,
          userId: authority.userId
        })
        const deliveredAt = this.now().toISOString()
        await this.options.store.transact((draft) => {
          const entry = requireOutbox(draft.outbox, next.outboxId)
          entry.state = 'delivered'
          entry.updatedAt = deliveredAt
          entry.deliveredAt = deliveredAt
          entry.response = restResponseSchema.parse(response)
          if (
            request.type === 'capability.approval.create'
            && response.type === 'capability.approval.created'
          ) {
            const approval = draft.remoteApprovals.find((candidate) => (
              candidate.desktopApprovalId === request.desktopApprovalId
            ))
            if (approval) {
              approval.remoteApprovalId = response.approval.remoteApprovalId
              approval.state = 'pending'
              approval.updatedAt = deliveredAt
            }
            return
          }
          if (request.type === 'capability.approval.result' || request.type === 'capability.approval.withdraw') {
            const approval = draft.remoteApprovals.find((candidate) => (
              candidate.remoteApprovalId === request.remoteApprovalId
            ))
            if (approval) {
              approval.state = 'completed'
              approval.updatedAt = deliveredAt
            }
            return
          }
          if (request.type !== 'projection.message.publish') return
          const receipt = draft.receipts.find((candidate) => (
            candidate.localItemId === request.localItemId &&
            candidate.projectionId === request.projectionId
          ))
          if (!receipt) return
          receipt.status = 'delivered'
          receipt.updatedAt = deliveredAt
          if (
            response.type === 'rest.receipt'
            && response.receipt.type === 'projection.message.receipt' &&
            response.receipt.providerMessageId
          ) {
            receipt.remoteMessageId = response.receipt.providerMessageId
          }
          const queueItem = draft.queue.find((candidate) => candidate.queueItemId === receipt.queueItemId)
          if (!queueItem) return
          queueItem.state = 'completed'
          queueItem.updatedAt = deliveredAt
          queueItem.completedAt = deliveredAt
          queueItem.remoteMessageId = receipt.remoteMessageId
        })
        this.settleTerminalWaiters(next.idempotencyKey)
      } catch (error) {
        const failedAt = this.now().toISOString()
        await this.options.store.transact((draft) => {
          const entry = requireOutbox(draft.outbox, next.outboxId)
          entry.state = 'failed'
          entry.error = safeError(error, this.options.sanitizeText)
          entry.updatedAt = failedAt
        })
        this.settleTerminalWaiters(next.idempotencyKey)
        return
      }
    }
  }

  private waitForTerminal(idempotencyKey: string): Promise<RestResponse> {
    const terminal = this.readTerminal(idempotencyKey)
    if (terminal) return terminal
    return new Promise<RestResponse>((resolve, reject) => {
      const waiter = Object.freeze({ resolve, reject })
      const waiters = this.terminalWaiters.get(idempotencyKey) ?? new Set<TerminalWaiter>()
      waiters.add(waiter)
      this.terminalWaiters.set(idempotencyKey, waiters)
      this.settleTerminalWaiters(idempotencyKey)
    })
  }

  private readTerminal(idempotencyKey: string): Promise<RestResponse> | undefined {
    const entry = this.options.store.snapshot().outbox.find((candidate) => (
      candidate.idempotencyKey === idempotencyKey
    ))
    if (!entry || !['delivered', 'failed'].includes(entry.state)) return undefined
    if (entry.state === 'failed') {
      return Promise.reject(new Error(entry.error ?? 'Cloud command delivery failed.'))
    }
    if (!entry.response) {
      return Promise.reject(new Error('Delivered Cloud command is missing its durable response.'))
    }
    return Promise.resolve(restResponseSchema.parse(entry.response))
  }

  private settleTerminalWaiters(idempotencyKey: string): void {
    const waiters = this.terminalWaiters.get(idempotencyKey)
    if (!waiters) return
    const terminal = this.readTerminal(idempotencyKey)
    if (!terminal) return
    this.terminalWaiters.delete(idempotencyKey)
    void terminal.then(
      (response) => {
        for (const waiter of waiters) waiter.resolve(response)
      },
      (error: unknown) => {
        const terminalError = error instanceof Error
          ? error
          : new Error('Cloud command delivery failed.')
        for (const waiter of waiters) waiter.reject(terminalError)
      }
    )
  }
}

function assertExpectedWriteResponse(
  kind: CollaborationOutboxEntry['kind'],
  request: RestRequest,
  response: RestResponse,
  actor: CoordinatorActor
): void {
  if (kind === 'coordinator.command') {
    const command = coordinatorCloudCommandSchema.parse(request)
    if (response.type === 'rest.error') {
      if (response.requestId === command.requestId) return
      throw new Error('Cloud write returned a response for another request.')
    }
    if (isExpectedCoordinatorResponse(command, response, actor)) return
    throw new Error(`Cloud write returned unexpected ${response.type}.`)
  }
  if (response.type === 'rest.error') {
    throw new Error(response.error.message)
  }
  let expected: boolean
  if (kind === 'task.offer-decision' && request.type === 'task.offer.accept') {
    expected = isExpectedTaskOfferClaimResponse(request, response)
  } else if (kind === 'task.external-operation') {
    expected = isExpectedExternalOperationResponse(request, response)
  } else if (kind === 'task.progress' && request.type === 'task.execution.start') {
    expected = isExpectedTaskExecutionStartResponse(request, response, actor)
  } else if (kind === 'task.failed' && request.type === 'task.execution.fail') {
    expected = isExpectedTaskExecutionFailureResponse(request, response, actor)
  } else if (kind === 'task.result' && request.type === 'task.result.submit') {
    expected = isExpectedTaskResultSubmissionResponse(request, response, actor)
  } else if (request.type === 'capability.approval.create') {
    expected = response.type === 'capability.approval.created'
  } else if (
    request.type === 'capability.approval.result' ||
    request.type === 'capability.approval.withdraw'
  ) {
    expected = response.type === 'rest.entity' && response.entity.type === 'remote_capability_approval'
  } else {
    expected = response.type === 'rest.receipt' || response.type === 'rest.entity'
  }
  if (!expected) throw new Error(`Cloud write returned unexpected ${response.type}.`)
}

function isExpectedExternalOperationResponse(
  request: RestRequest,
  response: Exclude<RestResponse, { type: 'rest.error' }>
): boolean {
  if (response.requestId !== request.requestId) return false
  if (request.type === 'external_operation.prepare') {
    if (
      response.type !== 'rest.entity' ||
      response.entity.type !== 'external_operation_recovery_journal_entry'
    ) return false
    const journal = response.entity
    return journal.scope === request.scope &&
      journal.projectId === request.projectId &&
      journal.taskId === request.taskId &&
      journal.executionId === request.executionId &&
      journal.preparedTaskRevision === request.preparedTaskRevision &&
      journal.preparedExecutionRevision === request.preparedExecutionRevision &&
      journal.provisioningIntentId === request.provisioningIntentId &&
      journal.provisioningRevision === request.provisioningRevision &&
      journal.logicalInvocationId === request.logicalInvocationId &&
      journal.operation === request.operation &&
      journal.state === 'prepared' &&
      journal.requestDigest === request.requestDigest &&
      journal.receiptDigest === null &&
      journal.observationDigest === null &&
      journal.safeFailureCode === null &&
      journal.dispatchedAt === null &&
      journal.resolvedAt === null &&
      journal.revision === 1
  }
  if (request.type === 'external_operation.dispatch') {
    if (
      response.type !== 'rest.entity' ||
      response.entity.type !== 'external_operation_recovery_journal_entry'
    ) return false
    const journal = response.entity
    return journal.contentRecoveryJournalEntryId === request.journalEntryId &&
      journal.state === 'dispatched' &&
      journal.receiptDigest === null &&
      journal.observationDigest === null &&
      journal.safeFailureCode === null &&
      journal.dispatchedAt !== null &&
      journal.resolvedAt === null &&
      journal.revision === request.expectedJournalRevision + 1
  }
  if (request.type !== 'external_operation.observe') return false
  if (
    response.type !== 'rest.collection' ||
    response.nextCursor !== undefined ||
    response.items.length < 1
  ) return false
  const [journal, ...companions] = response.items
  if (
    journal?.type !== 'external_operation_recovery_journal_entry' ||
    journal.contentRecoveryJournalEntryId !== request.journalEntryId ||
    journal.state !== request.outcome ||
    journal.receiptDigest !== request.receiptDigest ||
    journal.observationDigest !== request.observationDigest ||
    journal.safeFailureCode !== request.safeFailureCode ||
    journal.revision !== request.expectedJournalRevision + 1 ||
    (request.outcome === 'outcome_unknown') !== (journal.resolvedAt === null)
  ) return false
  let previousRank = 0
  for (const companion of companions) {
    let rank: number
    if (companion.type === 'visible_recovery_action') {
      rank = 1
      if (
        companion.projectId !== journal.projectId ||
        companion.journalEntryId !== journal.contentRecoveryJournalEntryId ||
        companion.taskId !== journal.taskId ||
        companion.executionId !== journal.executionId
      ) return false
    } else if (companion.type === 'task') {
      rank = 2
      if (
        companion.projectId !== journal.projectId ||
        companion.taskId !== journal.taskId
      ) return false
    } else if (companion.type === 'task_execution') {
      rank = 3
      if (
        companion.projectId !== journal.projectId ||
        companion.taskId !== journal.taskId ||
        companion.executionId !== journal.executionId
      ) return false
    } else if (companion.type === 'project_content_provisioning_intent') {
      rank = 4
      if (
        companion.projectId !== journal.projectId ||
        companion.provisioningIntentId !== journal.provisioningIntentId
      ) return false
    } else return false
    if (rank <= previousRank) return false
    previousRank = rank
  }
  return true
}

function isExpectedCoordinatorResponse(
  request: CoordinatorCloudCommand,
  response: Exclude<RestResponse, { type: 'rest.error' }>,
  actor: CoordinatorActor
): boolean {
  if (response.requestId !== request.requestId) return false
  switch (request.type) {
    case 'project.create':
      return isProjectCreatedResponse(request, response, actor)
    case 'project.plan.submit':
      return response.type === 'rest.entity' &&
        response.entity.type === 'project_plan' &&
        response.entity.projectId === request.projectId
    case 'human.needed.create': {
      if (
        response.type !== 'rest.entity' ||
        response.entity.type !== 'human_needed'
      ) return false
      const expectedContext = request.context.scope === 'worker_execution'
        ? {
            scope: 'worker_execution' as const,
            taskId: request.context.taskId,
            executionId: request.context.executionId
          }
        : {
            scope: 'coordinator_project' as const,
            coordinatorAuthorityEpoch: request.context.expectedCoordinatorAuthorityEpoch
          }
      return response.entity.projectId === request.projectId &&
        response.entity.targetUserId === request.targetUserId &&
        response.entity.requestedByAgentId === actor.agentId &&
        response.entity.requiredAssurance === request.requiredAssurance &&
        response.entity.prompt === request.prompt &&
        canonicalJson(response.entity.confirmableAction) ===
          canonicalJson(request.confirmableAction ?? null) &&
        response.entity.status === 'pending' &&
        response.entity.expiresAt === request.expiresAt &&
        response.entity.revision === 1 &&
        canonicalJson(response.entity.context) === canonicalJson(expectedContext)
    }
    case 'task.result.review':
      return isTaskResultReviewCollection(request, response, actor)
    case 'project.decision.submit':
      return isProjectDecisionCollection(request, response, actor)
    case 'project.final_summary.submit':
      return isProjectFinalSummaryCollection(request, response, actor)
    case 'task.offer.create':
      return isUserTaskOfferCollection(response, {
        outcome: 'created',
        projectId: request.projectId,
        taskId: canonicalTaskIdForPlanItem(request.projectPlanId, request.planItemId),
        offeredByCoordinatorAgentId: actor.agentId,
        offerExpiresAt: request.offerExpiresAt,
        taskRevision: 1,
        offerRevision: 1
      })
    case 'task.offer.withdraw':
      return isUserTaskOfferCollection(response, {
        outcome: 'withdrawn',
        taskId: request.taskId,
        taskOfferId: request.taskOfferId,
        taskRevision: request.expectedTaskRevision + 1,
        offerRevision: request.expectedOfferRevision + 1
      })
    case 'task.offer.reassign':
      return isUserTaskOfferCollection(response, {
        outcome: 'reassigned',
        taskId: request.taskId,
        workerUserId: request.workerUserId,
        offeredByCoordinatorAgentId: actor.agentId,
        offerExpiresAt: request.offerExpiresAt,
        taskRevision: request.expectedTaskRevision + 1,
        offerRevision: 1
      })
  }
  return unexpectedCoordinatorCommand(request)
}

function unexpectedCoordinatorCommand(command: never): false {
  throw new Error(`Unsupported Coordinator command: ${String(command)}.`)
}

function isProjectCreatedResponse(
  request: Extract<CoordinatorCloudCommand, { type: 'project.create' }>,
  response: Exclude<RestResponse, { type: 'rest.error' }>,
  actor: CoordinatorActor
): boolean {
  if (response.type !== 'rest.project_created') return false
  const [ownerMembership] = response.memberships
  return response.memberships.length === 1 &&
    ownerMembership !== undefined &&
    response.project.ownerUserId === actor.userId &&
    response.project.coordinatorAgentId === actor.agentId &&
    response.project.displayName === request.displayName &&
    response.project.goal === request.goal &&
    response.project.contentMode === 'none' &&
    response.project.status === 'draft' &&
    response.project.coordinatorAuthorityEpoch === 1 &&
    response.project.executionAuthorityEpoch === 1 &&
    response.project.revision === 1 &&
    canonicalJson(response.project.budget) === canonicalJson(request.budget) &&
    ownerMembership.projectId === response.project.projectId &&
    ownerMembership.userId === actor.userId &&
    ownerMembership.state === 'active' &&
    ownerMembership.authorityEpoch === 1 &&
    ownerMembership.revision === 1 &&
    response.provisioningIntent === null
}

function isProjectFinalSummaryCollection(
  request: Extract<CoordinatorCloudCommand, { type: 'project.final_summary.submit' }>,
  response: Exclude<RestResponse, { type: 'rest.error' }>,
  actor: CoordinatorActor
): boolean {
  if (
    response.type !== 'rest.collection' ||
    response.nextCursor !== undefined ||
    response.items.length !== 3
  ) return false
  const [project, record, summary] = response.items
  return project?.type === 'project' &&
    record?.type === 'project_record' &&
    summary?.type === 'project_final_summary' &&
    project.projectId === request.projectId &&
    project.ownerUserId === actor.userId &&
    project.coordinatorAgentId === actor.agentId &&
    project.coordinatorAuthorityEpoch === request.expectedCoordinatorAuthorityEpoch &&
    project.executionAuthorityEpoch === request.expectedExecutionAuthorityEpoch + 1 &&
    project.status === 'completed' &&
    project.revision === request.expectedProjectRevision + 1 &&
    record.projectId === request.projectId &&
    record.kind === 'summary' &&
    record.status === 'accepted' &&
    record.body === request.summary &&
    record.authorUserId === actor.userId &&
    record.authorAgentId === actor.agentId &&
    record.sourceTaskId === null &&
    record.sourceResultSubmissionId === null &&
    record.sourceHumanAnswerId === null &&
    record.acceptedByUserId === actor.userId &&
    record.acceptedByAgentId === actor.agentId &&
    record.revision === 1 &&
    summary.projectId === request.projectId &&
    summary.projectRecordId === record.projectRecordId &&
    summary.projectPlanId === request.projectPlanId &&
    summary.confirmedPlanRevision === request.confirmedPlanRevision &&
    canonicalJson(summary.acceptedResultSubmissionIds) ===
      canonicalJson(request.acceptedResultSubmissionIds) &&
    summary.summary === request.summary &&
    summary.createdByUserId === actor.userId &&
    summary.createdByCoordinatorAgentId === actor.agentId &&
    summary.completedAt === record.acceptedAt &&
    summary.completedAt === project.updatedAt &&
    summary.revision === 1
}

function isProjectDecisionCollection(
  request: Extract<CoordinatorCloudCommand, { type: 'project.decision.submit' }>,
  response: Exclude<RestResponse, { type: 'rest.error' }>,
  actor: CoordinatorActor
): boolean {
  if (
    response.type !== 'rest.collection' ||
    response.nextCursor !== undefined ||
    response.items.length !== 2
  ) return false
  const [project, record] = response.items
  return project?.type === 'project' &&
    record?.type === 'project_record' &&
    project.projectId === request.projectId &&
    project.ownerUserId === actor.userId &&
    project.coordinatorAgentId === actor.agentId &&
    project.coordinatorAuthorityEpoch === request.expectedCoordinatorAuthorityEpoch &&
    project.revision === request.expectedProjectRevision + 1 &&
    record.projectId === request.projectId &&
    record.kind === 'decision' &&
    record.status === 'accepted' &&
    record.body === request.decision &&
    record.authorUserId === actor.userId &&
    record.authorAgentId === actor.agentId &&
    record.sourceTaskId === null &&
    record.sourceResultSubmissionId === null &&
    record.sourceHumanAnswerId === request.humanAnswerId &&
    record.sourceRevision === request.expectedHumanAnswerRevision &&
    record.acceptedByUserId === actor.userId &&
    record.acceptedByAgentId === actor.agentId &&
    record.revision === 1
}

function isTaskResultReviewCollection(
  request: Extract<CoordinatorCloudCommand, { type: 'task.result.review' }>,
  response: Exclude<RestResponse, { type: 'rest.error' }>,
  actor: CoordinatorActor
): boolean {
  if (
    response.type !== 'rest.collection' ||
    response.nextCursor !== undefined ||
    response.items.length !== (request.decision === 'accept' ? 3 : 4)
  ) return false
  const [task, execution, review, offer] = response.items
  if (
    task?.type !== 'task' ||
    execution?.type !== 'task_execution' ||
    review?.type !== 'task_review_decision' ||
    task.projectId !== request.projectId ||
    task.taskId !== request.taskId ||
    task.revision !== request.expectedTaskRevision + 1 ||
    execution.projectId !== request.projectId ||
    execution.taskId !== request.taskId ||
    execution.executionId !== request.executionId ||
    execution.currentResultSubmissionId !== request.resultSubmissionId ||
    execution.revision !== request.expectedExecutionRevision + 1 ||
    review.projectId !== request.projectId ||
    review.taskId !== request.taskId ||
    review.executionId !== request.executionId ||
    review.resultSubmissionId !== request.resultSubmissionId ||
    review.reviewedResultRevision !== request.expectedResultRevision ||
    review.decidedByUserId !== actor.userId ||
    review.decidedByCoordinatorAgentId !== actor.agentId ||
    review.decision !== request.decision ||
    review.instruction !== request.instruction ||
    review.revision !== 1
  ) return false
  if (request.decision === 'accept') {
    return offer === undefined &&
      task.status === 'completed' &&
      task.currentExecutionId === execution.executionId &&
      task.currentExecutionState === 'completed' &&
      task.completedAt !== null &&
      execution.state === 'completed' &&
      execution.fence.status === 'fenced' &&
      execution.fence.reason === 'completed' &&
      execution.terminalAt !== null &&
      review.acceptedProjectRecordId !== null &&
      review.nextTaskOfferId === null
  }
  return offer?.type === 'task_offer' &&
    task.status === 'offered' &&
    task.currentExecutionId === null &&
    task.currentExecutionState === null &&
    task.completedAt === null &&
    canonicalJson(task.fileIntent) === canonicalJson(request.nextFileIntent) &&
    execution.state === 'superseded' &&
    execution.fence.status === 'fenced' &&
    execution.fence.reason === 'reassigned' &&
    execution.terminalAt !== null &&
    review.acceptedProjectRecordId === null &&
    review.nextTaskOfferId === offer.taskOfferId &&
    offer.projectId === request.projectId &&
    offer.taskId === request.taskId &&
    offer.executionId === null &&
    offer.workerUserId === request.nextWorkerUserId &&
    offer.offeredByCoordinatorAgentId === actor.agentId &&
    offer.state === 'pending' &&
    offer.expiresAt === request.nextOfferExpiresAt &&
    offer.revision === 1
}

function isUserTaskOfferCollection(
  response: Exclude<RestResponse, { type: 'rest.error' }>,
  expected: Readonly<{
    outcome: 'created' | 'withdrawn' | 'reassigned'
    projectId?: string
    taskId?: string
    taskOfferId?: string
    workerUserId?: string
    offeredByCoordinatorAgentId?: string
    offerExpiresAt?: string
    taskRevision?: number
    offerRevision?: number
  }>
): boolean {
  if (
    response.type !== 'rest.collection' ||
    response.nextCursor !== undefined ||
    response.items.length !== 2
  ) return false
  const [task, offer] = response.items
  if (
    task?.type !== 'task' ||
    offer?.type !== 'task_offer'
  ) return false
  const identitiesMatch = (
    (expected.projectId === undefined || task.projectId === expected.projectId) &&
    (expected.taskId === undefined || task.taskId === expected.taskId) &&
    (expected.taskOfferId === undefined || offer.taskOfferId === expected.taskOfferId) &&
    (expected.workerUserId === undefined || offer.workerUserId === expected.workerUserId) &&
    (expected.offeredByCoordinatorAgentId === undefined ||
      offer.offeredByCoordinatorAgentId === expected.offeredByCoordinatorAgentId) &&
    (expected.offerExpiresAt === undefined || offer.expiresAt === expected.offerExpiresAt) &&
    (expected.taskRevision === undefined || task.revision === expected.taskRevision) &&
    (expected.offerRevision === undefined || offer.revision === expected.offerRevision) &&
    task.projectId === offer.projectId &&
    task.taskId === offer.taskId &&
    task.currentExecutionId === null &&
    task.currentExecutionState === null &&
    offer.executionId === null
  )
  if (!identitiesMatch) return false
  switch (expected.outcome) {
    case 'created':
      return task.status === 'offered' &&
        task.executionCount === 0 &&
        offer.state === 'pending'
    case 'withdrawn':
      return task.status === 'revision_requested' &&
        offer.state === 'withdrawn'
    case 'reassigned':
      return task.status === 'offered' &&
        offer.state === 'pending'
  }
}

function isExpectedTaskOfferClaimResponse(
  request: Extract<RestRequest, { type: 'task.offer.accept' }>,
  response: Exclude<RestResponse, { type: 'rest.error' }>
): boolean {
  if (
    response.requestId !== request.requestId ||
    response.type !== 'rest.collection' ||
    response.nextCursor !== undefined ||
    response.items.length !== 3
  ) return false
  const [task, execution, offer] = response.items
  return task?.type === 'task' &&
    execution?.type === 'task_execution' &&
    offer?.type === 'task_offer' &&
    task.taskId === request.taskId &&
    task.revision === request.expectedTaskRevision + 1 &&
    task.status === 'in_progress' &&
    task.currentExecutionId === execution.executionId &&
    task.currentExecutionState === 'accepted' &&
    execution.taskId === task.taskId &&
    execution.projectId === task.projectId &&
    execution.state === 'accepted' &&
    execution.revision === 1 &&
    execution.attempt === task.executionCount &&
    offer.taskOfferId === request.taskOfferId &&
    offer.taskId === task.taskId &&
    offer.projectId === task.projectId &&
    offer.executionId === execution.executionId &&
    offer.workerUserId === execution.assigneeUserId &&
    offer.state === 'accepted' &&
    offer.revision === request.expectedOfferRevision + 1
}

function isExpectedTaskExecutionStartResponse(
  request: Extract<RestRequest, { type: 'task.execution.start' }>,
  response: Exclude<RestResponse, { type: 'rest.error' }>,
  actor: CoordinatorActor
): boolean {
  if (
    response.requestId !== request.requestId ||
    response.type !== 'rest.collection' ||
    response.nextCursor !== undefined ||
    response.items.length !== 2
  ) return false
  const [task, execution] = response.items
  return task?.type === 'task' &&
    execution?.type === 'task_execution' &&
    task.taskId === request.taskId &&
    task.revision === request.expectedTaskRevision + 1 &&
    task.status === 'in_progress' &&
    task.currentExecutionId === request.executionId &&
    task.currentExecutionState === 'running' &&
    execution.taskId === task.taskId &&
    execution.projectId === task.projectId &&
    execution.executionId === request.executionId &&
    execution.assigneeUserId === actor.userId &&
    execution.assigneeAgentId === actor.agentId &&
    execution.state === 'running' &&
    execution.stateRevision === request.expectedExecutionRevision + 1 &&
    execution.revision === request.expectedExecutionRevision + 1 &&
    execution.startedAt === request.startedAt &&
    execution.terminalAt === null &&
    execution.fence.status === 'open'
}

function isExpectedTaskExecutionFailureResponse(
  request: Extract<RestRequest, { type: 'task.execution.fail' }>,
  response: Exclude<RestResponse, { type: 'rest.error' }>,
  actor: CoordinatorActor
): boolean {
  if (
    response.requestId !== request.requestId ||
    response.type !== 'rest.collection' ||
    response.nextCursor !== undefined ||
    response.items.length !== 2
  ) return false
  const [task, execution] = response.items
  return task?.type === 'task' &&
    execution?.type === 'task_execution' &&
    task.taskId === request.taskId &&
    task.revision === request.expectedTaskRevision + 1 &&
    task.status === 'failed' &&
    task.currentExecutionId === request.executionId &&
    task.currentExecutionState === 'failed' &&
    task.completedAt === request.failedAt &&
    execution.taskId === task.taskId &&
    execution.projectId === task.projectId &&
    execution.executionId === request.executionId &&
    execution.assigneeUserId === actor.userId &&
    execution.assigneeAgentId === actor.agentId &&
    execution.state === 'failed' &&
    execution.stateRevision === request.expectedExecutionRevision + 1 &&
    execution.revision === request.expectedExecutionRevision + 1 &&
    execution.terminalAt === request.failedAt &&
    execution.fence.status === 'fenced' &&
    execution.fence.reason === 'execution_failed' &&
    execution.fence.fencedAt === request.failedAt
}

function isExpectedTaskResultSubmissionResponse(
  request: Extract<RestRequest, { type: 'task.result.submit' }>,
  response: Exclude<RestResponse, { type: 'rest.error' }>,
  actor: CoordinatorActor
): boolean {
  if (
    response.requestId !== request.requestId ||
    response.type !== 'rest.collection' ||
    response.nextCursor !== undefined ||
    response.items.length !== 3
  ) return false
  const [task, execution, submission] = response.items
  return task?.type === 'task' &&
    execution?.type === 'task_execution' &&
    submission?.type === 'task_result_submission' &&
    task.taskId === request.taskId &&
    task.revision === request.expectedTaskRevision + 1 &&
    task.status === 'awaiting_review' &&
    task.currentExecutionId === request.executionId &&
    task.currentExecutionState === 'result_submitted' &&
    execution.taskId === task.taskId &&
    execution.projectId === task.projectId &&
    execution.executionId === request.executionId &&
    execution.assigneeUserId === actor.userId &&
    execution.assigneeAgentId === actor.agentId &&
    execution.state === 'result_submitted' &&
    execution.stateRevision === request.expectedExecutionRevision + 1 &&
    execution.revision === request.expectedExecutionRevision + 1 &&
    execution.currentResultSubmissionId === submission.resultSubmissionId &&
    execution.terminalAt === request.runtimeProvenance.completedAt &&
    execution.fence.status === 'fenced' &&
    execution.fence.reason === 'result_submitted' &&
    execution.fence.fencedAt === request.runtimeProvenance.completedAt &&
    submission.projectId === task.projectId &&
    submission.taskId === task.taskId &&
    submission.executionId === execution.executionId &&
    submission.submittedByUserId === actor.userId &&
    submission.submittedByAgentId === actor.agentId &&
    submission.submittedTaskRevision === request.expectedTaskRevision &&
    submission.submittedExecutionRevision === request.expectedExecutionRevision &&
    submission.summary === request.summary &&
    canonicalJson(submission.runtimeProvenance) === canonicalJson(request.runtimeProvenance) &&
    canonicalJson(submission.outputs) === canonicalJson(request.outputs) &&
    canonicalJson(submission.recoveryJournalEntryIds) ===
      canonicalJson(request.recoveryJournalEntryIds) &&
    submission.submissionDigest === request.submissionDigest &&
    submission.revision === 1
}

function requireOutbox(
  entries: CollaborationOutboxEntry[],
  outboxId: string
): CollaborationOutboxEntry {
  const entry = entries.find((candidate) => candidate.outboxId === outboxId)
  if (!entry) throw new Error('Collaboration outbox entry was not found.')
  return entry
}

function requestId(): `req_${string}` {
  return `req_${randomUUID().replaceAll('-', '')}`
}

function localOpaqueId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll('-', '')}`
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJson(value))
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortJson(child)])
  )
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function idempotentCommandHash(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return sha256(canonicalJson(value))
  return sha256(canonicalJson(idempotencyComparableCommandProjection(
    value as Record<string, unknown>
  )))
}

type CommandSupersession = Readonly<{
  key: string
  agentRevision: number
  observedAt: number
}>

function commandSupersession(
  kind: CollaborationOutboxEntry['kind'],
  body: Readonly<Record<string, unknown>>
): CommandSupersession | undefined {
  if (
    kind === 'worker.availability' &&
    body.type === 'worker.availability.publish' &&
    typeof body.agentId === 'string' &&
    typeof body.expectedAgentRevision === 'number' &&
    typeof body.observedAt === 'string'
  ) {
    const observedAt = Date.parse(body.observedAt)
    if (!Number.isFinite(observedAt)) return undefined
    return {
      key: `worker.availability:${body.agentId}`,
      agentRevision: body.expectedAgentRevision,
      observedAt
    }
  }
  return undefined
}

function compareSupersessionOrder(left: CommandSupersession, right: CommandSupersession): number {
  return left.agentRevision - right.agentRevision || left.observedAt - right.observedAt
}

function safeError(error: unknown, sanitizeText?: (value: string) => string): string {
  const value = error instanceof Error ? error.message : 'Cloud delivery failed.'
  return (sanitizeText?.(value) ?? value)
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{6,}/giu, '[REDACTED]')
    .replace(/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/gu, '[REDACTED]')
    .slice(0, 4_000)
}
