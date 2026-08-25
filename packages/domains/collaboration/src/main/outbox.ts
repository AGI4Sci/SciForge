import { createHash, randomUUID } from 'node:crypto'
import {
  restRequestSchema,
  restResponseSchema,
  type RestRequest,
  type RestResponse
} from '@sciforge/collaboration-contracts'
import type { AgentCloudRuntime } from '@sciforge/domain-identity-access/agent-cloud-runtime'
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

export class DurableCloudOutbox implements ProjectionCloudOutbox {
  private readonly now: () => Date
  private drainTail: Promise<void> = Promise.resolve()
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
    await this.options.store.transact((draft) => {
      const existing = draft.outbox.find((entry) => entry.idempotencyKey === parsed.idempotencyKey)
      if (existing) {
        if (idempotentCommandHash(existing.body) !== bodyHash) {
          throw new Error('Outbox idempotency key was reused for a different command.')
        }
        return
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
    await this.enqueue(kind, request)
    await this.waitForIdle()
    if (!('idempotencyKey' in request)) {
      throw new Error('Durable cloud outbox accepts idempotent write commands only.')
    }
    const entry = this.options.store.snapshot().outbox.find((candidate) => (
      candidate.idempotencyKey === request.idempotencyKey
    ))
    if (!entry || entry.state !== 'delivered') {
      throw new Error(entry?.error ?? 'Cloud command is pending delivery.')
    }
    if (!entry.response) {
      throw new Error('Delivered Cloud command is missing its durable response.')
    }
    return restResponseSchema.parse(entry.response)
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
        assertExpectedWriteResponse(next.kind, request, response)
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
      } catch (error) {
        const failedAt = this.now().toISOString()
        await this.options.store.transact((draft) => {
          const entry = requireOutbox(draft.outbox, next.outboxId)
          entry.state = 'failed'
          entry.error = safeError(error, this.options.sanitizeText)
          entry.updatedAt = failedAt
        })
        return
      }
    }
  }
}

function assertExpectedWriteResponse(
  kind: CollaborationOutboxEntry['kind'],
  request: RestRequest,
  response: RestResponse
): void {
  if (response.type === 'rest.error') {
    if (kind === 'coordinator.command' && response.requestId === request.requestId) return
    if (kind === 'coordinator.command') {
      throw new Error('Cloud write returned a response for another request.')
    }
    throw new Error(response.error.message)
  }
  const expected = kind === 'coordinator.command'
    ? isExpectedCoordinatorResponse(request, response)
    : request.type === 'capability.approval.create'
      ? response.type === 'capability.approval.created'
      : request.type === 'capability.approval.result' || request.type === 'capability.approval.withdraw'
        ? response.type === 'rest.entity' && response.entity.type === 'remote_capability_approval'
        : response.type === 'rest.receipt' || response.type === 'rest.entity'
  if (!expected) throw new Error(`Cloud write returned unexpected ${response.type}.`)
}

function isExpectedCoordinatorResponse(
  request: RestRequest,
  response: Exclude<RestResponse, { type: 'rest.error' }>
): boolean {
  if (response.requestId !== request.requestId) return false
  switch (request.type) {
    case 'project.plan.submit':
      return response.type === 'rest.entity' &&
        response.entity.type === 'project_plan' &&
        response.entity.projectId === request.projectId
    case 'task.offer.create':
      return isExactTaskOfferCollection(response, {
        outcome: 'created',
        projectId: request.projectId,
        assigneeAgentId: request.assigneeAgentId,
        offerExpiresAt: request.offerExpiresAt,
        taskRevision: 1,
        executionRevision: 1,
        offerRevision: 1
      })
    case 'task.offer.withdraw':
      return isExactTaskOfferCollection(response, {
        outcome: 'withdrawn',
        taskId: request.taskId,
        executionId: request.executionId,
        taskOfferId: request.taskOfferId,
        taskRevision: request.expectedTaskRevision + 1,
        executionRevision: request.expectedExecutionRevision + 1,
        offerRevision: request.expectedOfferRevision + 1
      })
    case 'task.offer.reassign':
      return isExactTaskOfferCollection(response, {
        outcome: 'reassigned',
        taskId: request.taskId,
        assigneeAgentId: request.assigneeAgentId,
        offerExpiresAt: request.offerExpiresAt,
        previousExecutionId: request.previousExecutionId,
        taskRevision: request.expectedTaskRevision + 1,
        executionRevision: 1,
        offerRevision: 1
      })
    default:
      return false
  }
}

function isExactTaskOfferCollection(
  response: Exclude<RestResponse, { type: 'rest.error' }>,
  expected: Readonly<{
    outcome: 'created' | 'withdrawn' | 'reassigned'
    projectId?: string
    taskId?: string
    executionId?: string
    taskOfferId?: string
    assigneeAgentId?: string
    offerExpiresAt?: string
    previousExecutionId?: string
    taskRevision?: number
    executionRevision?: number
    offerRevision?: number
  }>
): boolean {
  if (
    response.type !== 'rest.collection' ||
    response.nextCursor !== undefined ||
    response.items.length !== 3
  ) return false
  const [task, execution, offer] = response.items
  if (
    task?.type !== 'task' ||
    execution?.type !== 'task_execution' ||
    offer?.type !== 'task_offer'
  ) return false
  const identitiesMatch = (
    (expected.projectId === undefined || task.projectId === expected.projectId) &&
    (expected.taskId === undefined || task.taskId === expected.taskId) &&
    (expected.executionId === undefined || execution.executionId === expected.executionId) &&
    (expected.taskOfferId === undefined || offer.taskOfferId === expected.taskOfferId) &&
    (expected.assigneeAgentId === undefined || execution.assigneeAgentId === expected.assigneeAgentId) &&
    (expected.offerExpiresAt === undefined || offer.expiresAt === expected.offerExpiresAt) &&
    (expected.taskRevision === undefined || task.revision === expected.taskRevision) &&
    (expected.executionRevision === undefined || execution.revision === expected.executionRevision) &&
    (expected.offerRevision === undefined || offer.revision === expected.offerRevision) &&
    task.projectId === execution.projectId &&
    task.projectId === offer.projectId &&
    task.taskId === execution.taskId &&
    task.taskId === offer.taskId &&
    task.currentExecutionId === execution.executionId &&
    execution.executionId === offer.executionId &&
    execution.assigneeUserId === offer.assigneeUserId &&
    execution.assigneeAgentId === offer.assigneeAgentId &&
    execution.assigneeDeviceId === offer.assigneeDeviceId &&
    task.executionCount === execution.attempt
  )
  if (!identitiesMatch) return false
  switch (expected.outcome) {
    case 'created':
      return task.status === 'offered' &&
        task.currentExecutionState === 'offered' &&
        execution.state === 'offered' &&
        execution.fence.status === 'open' &&
        execution.fence.assignmentTaskRevision === task.revision &&
        offer.state === 'pending'
    case 'withdrawn':
      return task.status === 'revision_requested' &&
        task.currentExecutionState === 'cancelled' &&
        execution.state === 'cancelled' &&
        execution.fence.status === 'fenced' &&
        execution.fence.reason === 'offer_withdrawn' &&
        offer.state === 'withdrawn'
    case 'reassigned':
      return expected.previousExecutionId !== undefined &&
        execution.executionId !== expected.previousExecutionId &&
        task.status === 'offered' &&
        task.currentExecutionState === 'offered' &&
        execution.state === 'offered' &&
        execution.fence.status === 'open' &&
        execution.fence.assignmentTaskRevision === task.revision &&
        offer.state === 'pending'
  }
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
  const { requestId: _requestId, ...command } = value as Record<string, unknown>
  return sha256(canonicalJson(command))
}

function safeError(error: unknown, sanitizeText?: (value: string) => string): string {
  const value = error instanceof Error ? error.message : 'Cloud delivery failed.'
  return (sanitizeText?.(value) ?? value)
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{6,}/giu, '[REDACTED]')
    .replace(/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/gu, '[REDACTED]')
    .slice(0, 4_000)
}
