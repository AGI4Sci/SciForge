import {
  idempotencyComparableCommandProjection,
  idempotencyKeySchema,
  objectStageRequestSchema,
  objectStagedResponseSchema,
  restRequestSchema,
  restResponseSchema,
  type ObjectStageRequest,
  type ObjectStagedResponse,
  type RestRequest,
  type RestResponse
} from '@sciforge/collaboration-contracts'
import { canonicalTaskIdForRequirementsModule } from '@sciforge/collaboration-contracts/node'
import type { AgentCloudRuntime } from '@sciforge/domain-identity-access/agent-cloud-runtime'
import {
  AUTHENTICATED_CLOUD_COMMAND_OPERATION_ID,
  authenticatedCloudJsonBody,
  type AuthenticatedCloudTransport
} from '@sciforge/domain-identity-access/authenticated-cloud-transport'
import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import {
  coordinatorCloudCommandSchema,
  type CoordinatorUserCloudCommand,
  type CoordinatorCloudCommand
} from '../coordinator-cloud-command.js'
import type { ProjectionCloudOutbox, ProjectionDeliveryCommand } from './projection-coordinator.js'
import type { CollaborationOutboxEntry, CollaborationOutboxWait } from './store.js'
import { CollaborationLocalStore, enforceWorkerOutboxAuthorityFence, isObjectUploadLimit, isDeliveryCandidateValidationFailure } from './store.js'

export type DurableCloudOutboxOptions = Readonly<{
  store: CollaborationLocalStore
  agentCloudRuntime: AgentCloudRuntime
  /** Human-authenticated transport used for explicit Worker acceptance. */
  authenticatedCloudTransport?: AuthenticatedCloudTransport
  localAgentId: () => string | undefined
  sanitizeText?: (value: string) => string
  now?: () => Date
}>

type CoordinatorActor = Readonly<{
  deviceId: string
  agentId: string
  userId: string
}>

/** JSON/authority calls retain their existing short budget. */
const CLOUD_STEP_TIMEOUT_MS = 45_000
/** Object upload + storage verification budget, below the server's 300s ingress deadline. */
const OBJECT_STAGE_TIMEOUT_MS = 240_000
/** A command blocked on a precondition is retried on this cadence besides explicit wakes. */
const WAIT_RETRY_MS = 5_000

type TerminalWaiter = Readonly<{
  resolve: (response: RestResponse) => void
  reject: (error: Error) => void
}>

class DurableCloudOutboxError extends Error {
  constructor(readonly code: NonNullable<CollaborationOutboxEntry['failureReason']>, message: string) {
    super(message)
  }
}

class CloudStepTimeoutError extends DurableCloudOutboxError {
  constructor() {
    super('transport_unavailable', 'SciForge Cloud did not answer within the outbox time limit.')
  }
}

function boundedCloudStep<Value>(step: Promise<Value>): Promise<Value> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new CloudStepTimeoutError()), CLOUD_STEP_TIMEOUT_MS)
    timer.unref?.()
  })
  return Promise.race([step, deadline]).finally(() => clearTimeout(timer))
}

function cloudFailureReason(error: unknown): NonNullable<CollaborationOutboxEntry['failureReason']> {
  const code = error instanceof Error && 'code' in error ? error.code : undefined
  if (code === 'authority_lost') return 'authority_lost'
  if (code === 'authority_unverified') return 'authority_unverified'
  if (code === 'object_upload_limit') return 'object_upload_limit'
  if (['transport_unavailable', 'runtime_unavailable', 'cloud_unavailable', 'cloud_timeout'].includes(String(code))) {
    return 'transport_unavailable'
  }
  return 'command_failed'
}

export type DurableCloudOutboxReplay = Readonly<{
  request: RestRequest
  response: RestResponse
}>

type ObjectStageFlight = Readonly<{ controller: AbortController; settled: Promise<void> }>
// An outbox can be stopped/recreated while a provider is still unwinding an
// aborted request. Share the fence by the Identity-owned transport, not row ID.
const objectStageFlights = new WeakMap<AuthenticatedCloudTransport, ObjectStageFlight>()

export class DurableCloudOutbox implements ProjectionCloudOutbox {
  private readonly now: () => Date
  private ownedObjectStage: ObjectStageFlight | undefined
  private observedObjectStage: ObjectStageFlight | undefined
  private drainTail: Promise<void> = Promise.resolve()
  private readonly terminalWaiters = new Map<string, Set<TerminalWaiter>>()
  private stopped = false
  private waitRetry: ReturnType<typeof setTimeout> | undefined

  constructor(private readonly options: DurableCloudOutboxOptions) {
    this.now = options.now ?? (() => new Date())
  }

  start(): void {
    this.stopped = false
    this.wake()
  }

  wake(): void {
    for (const key of this.terminalWaiters.keys()) this.settleTerminalWaiters(key)
    this.schedule()
  }

  stop(): void {
    this.stopped = true
    this.ownedObjectStage?.controller.abort()
    clearTimeout(this.waitRetry)
    this.waitRetry = undefined
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
    const userAuthority = this.isUserCommand(parsed)
      ? this.captureUserAuthority() : undefined
    const bodyHash = idempotentCommandHash(parsed)
    const supersession = commandSupersession(kind, parsed)
    await this.options.store.transact((draft) => {
      const existing = draft.outbox.find((entry) => entry.idempotencyKey === parsed.idempotencyKey)
      if (existing) {
        this.assertUserAuthority(existing)
        if (idempotentCommandHash(existing.body) !== bodyHash) {
          throw new Error('Outbox idempotency key was reused for a different command.')
        }
        enforceWorkerOutboxAuthorityFence(draft, existing)
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
      const entry: CollaborationOutboxEntry = {
        outboxId: localOpaqueId('obx'),
        idempotencyKey: parsed.idempotencyKey,
        kind,
        body: parsed,
        ...(userAuthority ? { userAuthority } : {}),
        state: 'pending',
        attempts: 0,
        createdAt: now,
        updatedAt: now
      }
      enforceWorkerOutboxAuthorityFence(draft, entry)
      draft.outbox.push(entry)
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
    const response = await this.waitForTerminal(parsed.idempotencyKey)
    const entry = this.options.store.snapshot().outbox.find(candidate => candidate.idempotencyKey === parsed.idempotencyKey)
    if (entry) this.assertUserAuthority(entry)
    return response
  }

  /** Object bytes use the same journal/drain and the Identity-owned gateway. */
  async stageAndWait(request: ObjectStageRequest, path: string, options?: Readonly<{ explicitRetry: boolean }>): Promise<ObjectStagedResponse> {
    const parsed = objectStageRequestSchema.parse(request)
    if (this.options.authenticatedCloudTransport && objectStageFlights.has(this.options.authenticatedCloudTransport)) {
      throw new DurableCloudOutboxError('transport_unavailable', 'The previous object upload is still settling after cancellation; its outcome is unknown. Wait before reconciling the original idempotent operation.')
    }
    const userAuthority = this.captureUserAuthority()
    await this.options.store.transact((draft) => {
      const existing = draft.outbox.find((entry) => entry.idempotencyKey === parsed.idempotencyKey)
      if (existing) {
        this.assertUserAuthority(existing)
        if (existing.kind !== 'delivery.stage' || idempotentCommandHash(existing.body) !== idempotentCommandHash(parsed) || existing.stageFile?.path !== path) {
          throw new Error('Stage idempotency identity does not match the frozen object.')
        }
        if (!enforceWorkerOutboxAuthorityFence(draft, existing) &&
            (!isObjectUploadLimit(existing) || options?.explicitRetry)) {
          if (existing.state === 'failed' || isObjectUploadLimit(existing)) {
            existing.state = 'reconciling'
            existing.error = undefined
            existing.failureReason = undefined
          }
        }
        return
      }
      const now = this.now().toISOString()
      const entry: CollaborationOutboxEntry = { outboxId: localOpaqueId('obx'), idempotencyKey: parsed.idempotencyKey,
        kind: 'delivery.stage', body: parsed, userAuthority, stageFile: { path, sha256: parsed.sha256, byteCount: parsed.byteCount },
        state: 'pending', attempts: 0, createdAt: now, updatedAt: now }
      enforceWorkerOutboxAuthorityFence(draft, entry)
      draft.outbox.push(entry)
    })
    this.schedule()
    await this.waitForIdle()
    const entry = this.options.store.snapshot().outbox.find((item) => item.idempotencyKey === parsed.idempotencyKey)
    if (entry) this.assertUserAuthority(entry)
    if (entry?.state !== 'delivered') throw new Error(entry?.error ?? 'Object upload is pending reconciliation.')
    return objectStagedResponseSchema.parse(entry.response)
  }

  private async executeStage(entry: CollaborationOutboxEntry): Promise<void> {
    if (!this.options.authenticatedCloudTransport) throw new Error('User object transport is unavailable.')
    const request = objectStageRequestSchema.parse(entry.body)
    if (!entry.stageFile) throw new Error('Staging has no frozen private object.')
    if (!await this.beginSending(entry.outboxId)) return
    try {
      this.assertUserAuthority(entry)
      const body = await readFile(entry.stageFile.path)
      if (body.byteLength !== request.byteCount || createHash('sha256').update(body).digest('hex') !== request.sha256) {
        throw new Error('Frozen candidate bytes changed; upload is blocked.')
      }
      if (!this.canDispatch(entry.outboxId)) {
        await this.deferUnsentCheckpoint(entry.outboxId)
        return
      }
      this.assertUserAuthority(entry)
      const response = objectStagedResponseSchema.parse(await this.stageObjectWithinBudget(request, body))
      this.assertUserAuthority(entry)
      if (response.requestId !== request.requestId || response.object.projectId !== request.projectId ||
          response.object.sha256 !== request.sha256 || response.object.byteCount !== request.byteCount) {
        throw new Error('Object upload receipt does not match the frozen candidate.')
      }
      await this.options.store.transact((draft) => {
        const current = requireOutbox(draft.outbox, entry.outboxId)
        current.state = 'delivered'; current.response = response; current.error = undefined
        current.failureReason = undefined
        current.deliveredAt = this.now().toISOString(); current.updatedAt = current.deliveredAt
      })
    } catch (error) {
      await this.options.store.transact((draft) => {
        const current = requireOutbox(draft.outbox, entry.outboxId)
        current.state = 'failed'; current.error = safeError(error, this.options.sanitizeText)
        current.failureReason = current.authorityFence ? 'authority_lost' : cloudFailureReason(error)
      })
    }
  }

  private async stageObjectWithinBudget(request: ObjectStageRequest, body: Uint8Array<ArrayBuffer>): Promise<ObjectStagedResponse> {
    const transport = this.options.authenticatedCloudTransport!
    if (objectStageFlights.has(transport)) {
      throw new DurableCloudOutboxError('transport_unavailable', 'The previous object upload is still settling; reconcile only after it finishes.')
    }
    const controller = new AbortController()
    // Invocation is deferred until the shared fence and abort listener exist.
    const operation = Promise.resolve().then(() => {
      controller.signal.throwIfAborted()
      return transport.stageObject({ request, body }, { signal: controller.signal })
    })
    const settled = operation.then(() => undefined, () => undefined)
    const flight: ObjectStageFlight = { controller, settled }
    objectStageFlights.set(transport, flight)
    this.ownedObjectStage = flight
    void settled.then(() => {
      if (objectStageFlights.get(transport) === flight) objectStageFlights.delete(transport)
      if (this.ownedObjectStage === flight) this.ownedObjectStage = undefined
      this.schedule()
    })
    let timer: ReturnType<typeof setTimeout> | undefined
    let abort: () => void = () => undefined
    const cancellation = new Promise<never>((_resolve, reject) => {
      abort = () => reject(new DurableCloudOutboxError('transport_unavailable',
        'Object upload was cancelled or exceeded its 240 second budget; the outcome is unknown. Reconcile the original idempotent operation after the transport settles.'))
      controller.signal.addEventListener('abort', abort, { once: true })
      timer = setTimeout(() => controller.abort(), OBJECT_STAGE_TIMEOUT_MS)
      timer.unref?.()
    })
    try { return await Promise.race([operation, cancellation]) } finally {
      clearTimeout(timer)
      controller.signal.removeEventListener('abort', abort)
    }
  }

  /**
   * Resumes one already-enqueued durable command without asking its caller to
   * reconstruct the body. A failed delivery reuses the original row and its
   * idempotency key; a delivered row returns its retained strict response.
   */
  async resumeAndWait(
    kind: CollaborationOutboxEntry['kind'],
    rawIdempotencyKey: string,
    validateRequest: (request: RestRequest) => void
  ): Promise<DurableCloudOutboxReplay | null> {
    const idempotencyKey = idempotencyKeySchema.parse(rawIdempotencyKey)
    if (typeof validateRequest !== 'function') {
      throw new TypeError('Durable cloud outbox replay validator is invalid.')
    }
    const existing = this.options.store.snapshot().outbox.find((candidate) => (
      candidate.idempotencyKey === idempotencyKey
    ))
    if (!existing) return null
    if (existing.kind !== kind) {
      throw new Error('Outbox idempotency key belongs to another command kind.')
    }
    this.assertUserAuthority(existing)
    const request = restRequestSchema.parse(existing.body)
    if (!('idempotencyKey' in request) || request.idempotencyKey !== idempotencyKey) {
      throw new Error('Durable cloud outbox command identity is inconsistent.')
    }
    validateRequest(request)
    if (existing.state === 'failed') await this.retry(existing.outboxId)
    else this.schedule()
    const response = await this.waitForTerminal(idempotencyKey)
    this.assertUserAuthority(existing)
    return Object.freeze({ request, response })
  }

  async retry(id?: string): Promise<void> {
    await this.options.store.transact((draft) => {
      const candidates = draft.outbox.filter((entry) => (
        entry.state === 'failed' && !isObjectUploadLimit(entry) && !isDeliveryCandidateValidationFailure(entry) &&
        (!id || entry.outboxId === id || entry.idempotencyKey === id)
      ))
      const now = this.now().toISOString()
      for (const entry of candidates) {
        // A different caller cannot replace the retained original failure
        // with a new identity error, nor acquire its retry authority.
        try { this.assertUserAuthority(entry) } catch { continue }
        if (enforceWorkerOutboxAuthorityFence(draft, entry)) continue
        entry.state = 'reconciling'
        entry.error = undefined
        entry.failureReason = undefined
        entry.updatedAt = now
      }
    })
    this.schedule()
  }

  private isUserCommand(request: Readonly<{ type: string; interaction?: unknown }>): boolean {
    // Offer acceptance has both User and Agent protocol routes. Bind the User
    // identity only when this outbox actually owns the User transport, matching
    // executeRequest; a UI interaction marker is not a transport authority.
    return requiresAuthenticatedCloudCommand(request.type as RestRequest['type']) &&
      (request.type !== 'task.offer.accept' || this.options.authenticatedCloudTransport !== undefined)
  }

  private isUserEntry(entry: CollaborationOutboxEntry): boolean {
    return entry.userAuthority !== undefined || entry.kind === 'delivery.stage' ||
      this.isUserCommand({ type: String(entry.body.type), interaction: entry.body.interaction })
  }

  private captureUserAuthority(): NonNullable<CollaborationOutboxEntry['userAuthority']> {
    const status = this.options.authenticatedCloudTransport?.status()
    if (status?.state !== 'ready') {
      throw new DurableCloudOutboxError('authority_unverified', 'Ready User identity is required to create a durable User command.')
    }
    return { userId: status.userId, deviceId: status.deviceId, baseUrl: status.baseUrl }
  }

  private assertUserAuthority(entry: CollaborationOutboxEntry): void {
    if (!this.isUserEntry(entry)) return
    const binding = entry.userAuthority
    if (!binding) throw new DurableCloudOutboxError('authority_lost', 'Durable User command has no creation authority binding.')
    const current = this.captureUserAuthority()
    if (binding.userId !== current.userId || binding.deviceId !== current.deviceId || binding.baseUrl !== current.baseUrl) {
      throw new DurableCloudOutboxError('authority_lost', 'Durable User command creation authority no longer matches the current User, Device or Cloud.')
    }
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
      const activeStage = this.options.authenticatedCloudTransport && objectStageFlights.get(this.options.authenticatedCloudTransport)
      if (activeStage && activeStage !== this.observedObjectStage) {
        this.observedObjectStage = activeStage
        void activeStage.settled.then(() => { this.observedObjectStage = undefined; this.schedule() })
      }
      const next = this.options.store.snapshot().outbox
        .filter((entry) => (
          !entry.authorityFence && !isObjectUploadLimit(entry) && (entry.state === 'pending' || entry.state === 'reconciling') &&
          (entry.kind !== 'delivery.stage' || !this.options.authenticatedCloudTransport || !objectStageFlights.has(this.options.authenticatedCloudTransport))
        ))
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0]
      if (!next) {
        await this.recordWait(null)
        return
      }
      if (this.isUserEntry(next)) {
        try {
          // Missing creation identity is terminal even while signed out.
          if (!next.userAuthority) this.assertUserAuthority(next)
          const status = this.options.authenticatedCloudTransport?.status()
          if (status?.state !== 'ready') {
            await this.recordWait('user_identity')
            return
          }
          this.assertUserAuthority(next)
        } catch (error) {
          await this.options.store.transact(draft => {
            const entry = requireOutbox(draft.outbox, next.outboxId)
            entry.state = 'failed'
            entry.failureReason = cloudFailureReason(error)
            entry.error = safeError(error, this.options.sanitizeText)
            entry.updatedAt = this.now().toISOString()
          })
          this.settleTerminalWaiters(next.idempotencyKey)
          continue
        }
      }
      if (next.kind === 'delivery.stage') { await this.executeStage(next); continue }
      if (next.kind === 'retired.task-result') throw new Error('Retired result operation cannot be dispatched.')
      if (next.kind === 'task.external-operation') throw new Error('Retired external operation cannot be dispatched.')
      const parsedRequest = restRequestSchema.safeParse(next.body)
      if (!parsedRequest.success) {
        await this.options.store.transact((draft) => {
          const entry = requireOutbox(draft.outbox, next.outboxId)
          entry.state = 'failed'
          entry.error = `Unsupported or retired Cloud command: ${String(next.body.type)}.`
          entry.updatedAt = this.now().toISOString()
        })
        this.settleTerminalWaiters(next.idempotencyKey)
        continue
      }
      const request = parsedRequest.data
      const authenticatedCommand = requiresAuthenticatedCloudCommand(request.type) && this.options.authenticatedCloudTransport
      const humanAuthority = authenticatedCommand ? this.options.authenticatedCloudTransport?.status() : undefined
      const agentId = authenticatedCommand ? undefined : this.options.localAgentId()
      let authority: Awaited<ReturnType<AgentCloudRuntime['authorityStatus']>> | null = null
      if (authenticatedCommand) {
        if (this.options.authenticatedCloudTransport?.status().state !== 'ready') {
          await this.recordWait('user_identity')
          return
        }
      } else {
        if (!agentId) {
          await this.recordWait('agent_identity')
          return
        }
        try {
          authority = await boundedCloudStep(this.options.agentCloudRuntime.authorityStatus(agentId))
        } catch (error) {
          if (!(error instanceof CloudStepTimeoutError)) throw error
          await this.recordWait('authority_check')
          return
        }
        if (authority.state !== 'ready') {
          await this.recordWait('agent_authority')
          return
        }
      }
      await this.recordWait(null)
      if (!await this.beginSending(next.outboxId)) {
        this.settleTerminalWaiters(next.idempotencyKey)
        continue
      }
      if (!this.canDispatch(next.outboxId)) {
        await this.deferUnsentCheckpoint(next.outboxId)
        this.settleTerminalWaiters(next.idempotencyKey)
        continue
      }
      let candidateValidationRejection: RestResponse | undefined
      try {
        const response = restResponseSchema.parse(await this.executeRequest(next, request, agentId))
        if (authenticatedCommand) {
          this.assertUserAuthority(next)
          if (request.type === 'delivery.candidate.create' && response.type === 'rest.error' &&
              response.requestId === request.requestId && response.error.code === 'validation_error' && !response.error.retryable) {
            candidateValidationRejection = response
          }
          if (request.type === 'task.offer.accept') {
            if (humanAuthority?.state !== 'ready') throw new Error('User authority is unavailable.')
            assertExpectedHumanAcceptanceResponse(request, response, humanAuthority)
          }
          else assertExpectedAuthenticatedCommandResponse(request, response)
        } else {
          if (!authority || authority.state !== 'ready') {
            throw new Error('The Agent authority changed before the Cloud response was validated.')
          }
          assertExpectedWriteResponse(next.kind, request, response, {
            agentId: authority.agentId,
            userId: authority.userId,
            deviceId: authority.deviceId
          })
        }
        const deliveredAt = this.now().toISOString()
        await this.options.store.transact((draft) => {
          const entry = requireOutbox(draft.outbox, next.outboxId)
          entry.state = 'delivered'
          entry.updatedAt = deliveredAt
          entry.deliveredAt = deliveredAt
          entry.response = restResponseSchema.parse(response)
          entry.failureReason = undefined
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
          if (candidateValidationRejection && !entry.authorityFence) entry.response = candidateValidationRejection
          entry.failureReason = entry.authorityFence ? 'authority_lost' : cloudFailureReason(error)
          entry.updatedAt = failedAt
        })
        this.settleTerminalWaiters(next.idempotencyKey)
        return
      }
    }
  }

  /**
   * Persists what the head of the queue is waiting for, so the UI can show a
   * concrete reason, and keeps retrying while a precondition is unmet even if
   * no connection event wakes the queue.
   */
  private async recordWait(reason: CollaborationOutboxWait['reason'] | null): Promise<void> {
    const current = this.options.store.snapshot().outboxWait
    if (reason === null) {
      if (current) await this.options.store.transact((draft) => { draft.outboxWait = null })
      return
    }
    if (current?.reason !== reason) {
      const since = this.now().toISOString()
      await this.options.store.transact((draft) => { draft.outboxWait = { reason, since } })
    }
    if (this.stopped || this.waitRetry) return
    this.waitRetry = setTimeout(() => {
      this.waitRetry = undefined
      this.schedule()
    }, WAIT_RETRY_MS)
    this.waitRetry.unref?.()
  }

  private async beginSending(outboxId: string): Promise<boolean> {
    return this.options.store.transact((draft) => {
      const entry = requireOutbox(draft.outbox, outboxId)
      if (enforceWorkerOutboxAuthorityFence(draft, entry) || this.stopped ||
          (entry.state !== 'pending' && entry.state !== 'reconciling')) return false
      try { this.assertUserAuthority(entry) } catch (error) {
        entry.state = 'failed'
        entry.failureReason = cloudFailureReason(error)
        entry.error = safeError(error, this.options.sanitizeText)
        return false
      }
      entry.state = 'sending'
      entry.attempts += 1
      entry.updatedAt = this.now().toISOString()
      entry.error = undefined
      return true
    })
  }

  private canDispatch(outboxId: string): boolean {
    const state = this.options.store.snapshot()
    const entry = requireOutbox(state.outbox, outboxId)
    return !this.stopped && entry.state === 'sending' && !enforceWorkerOutboxAuthorityFence(state, entry)
  }

  private async deferUnsentCheckpoint(outboxId: string): Promise<void> {
    await this.options.store.transact((draft) => {
      const entry = requireOutbox(draft.outbox, outboxId)
      if (!enforceWorkerOutboxAuthorityFence(draft, entry) && entry.state === 'sending') {
        entry.state = 'reconciling'
        entry.updatedAt = this.now().toISOString()
      }
    })
  }

  private async executeRequest(entry: CollaborationOutboxEntry, request: RestRequest, agentId: string | undefined): Promise<RestResponse> {
    this.assertUserAuthority(entry)
    if (requiresAuthenticatedCloudCommand(request.type) && this.options.authenticatedCloudTransport) {
      const result = await boundedCloudStep(this.options.authenticatedCloudTransport.execute({
        contractVersion: 1,
        operationId: AUTHENTICATED_CLOUD_COMMAND_OPERATION_ID,
        payload: authenticatedCloudJsonBody(request)
      }))
      return restResponseSchema.parse(result.body)
    }
    if (!agentId) throw new Error('An Agent authority is required for this Cloud command.')
    return boundedCloudStep(this.options.agentCloudRuntime.execute({ agentId, request }))
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
    if (!entry) return undefined
    try { this.assertUserAuthority(entry) } catch (error) {
      return Promise.reject(error)
    }
    if (entry.state !== 'delivered' && entry.authorityFence) {
      return Promise.reject(new DurableCloudOutboxError('authority_lost', entry.error ?? 'Worker write authority was lost.'))
    }
    if (!['delivered', 'failed'].includes(entry.state)) return undefined
    if (entry.state === 'failed') {
      return Promise.reject(new DurableCloudOutboxError(entry.failureReason ?? 'command_failed',
        entry.error ?? 'Cloud command delivery failed.'))
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

function requiresAuthenticatedCloudCommand(type: RestRequest['type']): boolean {
  return type === 'task.offer.reassign' || type === 'task.offer.accept' || type === 'delivery.candidate.create' || type === 'delivery.revision.request' || type === 'project.final_summary.submit' ||
    type === 'delivery.candidate.review' || type === 'delivery.manifest.seal' ||
    type === 'delivery.adoption.record' || type === 'project.result.publish'
}

function assertExpectedAuthenticatedCommandResponse(
  request: RestRequest,
  response: RestResponse
): void {
  if (response.type === 'rest.error') {
    if (response.requestId === request.requestId) throw new Error(response.error.message)
    throw new Error('Authenticated Cloud write returned a response for another request.')
  }
  if (request.type === 'task.offer.reassign' && !isTaskOfferReassignCollection(request, response)) throw new Error('Unexpected reassignment response.')
  if (response.requestId !== request.requestId || response.type === 'rest.project_page' ||
      response.type === 'rest.project_coordination') {
    throw new Error(`Authenticated Cloud write returned unexpected ${response.type}.`)
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
    if (
      kind === 'task.offer-decision' &&
      response.requestId === request.requestId
    ) return
    throw new Error(response.error.message)
  }
  let expected: boolean
  if (kind === 'task.offer-decision' && request.type === 'task.offer.accept') {
    expected = isExpectedTaskOfferClaimResponse(request, response, actor)
  } else if (kind === 'task.offer-decision' && request.type === 'task.offer.reject') {
    expected = isExpectedTaskOfferRejectResponse(request, response, actor)
  } else if (kind === 'task.progress' && request.type === 'task.execution.start') {
    expected = isExpectedTaskExecutionStartResponse(request, response, actor)
  } else if (kind === 'task.failed' && request.type === 'task.execution.fail') {
    expected = isExpectedTaskExecutionFailureResponse(request, response, actor)

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

function isExpectedCoordinatorResponse(
  request: CoordinatorCloudCommand,
  response: Exclude<RestResponse, { type: 'rest.error' }>,
  actor: CoordinatorActor
): boolean {
  if (response.requestId !== request.requestId) return false
  switch (request.type) {
    case 'project.create':
      return isProjectCreatedResponse(request, response, actor)
    case 'project.requirements.completion.save':
      return response.type === 'rest.entity' &&
        response.entity.type === 'project_requirements_document' &&
        response.entity.projectId === request.projectId &&
        response.entity.state === 'draft' &&
        response.entity.revision === request.expectedRequirementsRevision + 1 &&
        canonicalJson(response.entity.workModules) === canonicalJson(request.workModules) &&
        canonicalJson(response.entity.acceptanceCriteria) ===
          canonicalJson(request.acceptanceCriteria)
    case 'human.needed.create': {
      if (
        response.type !== 'rest.entity' ||
        response.entity.type !== 'human_needed'
      ) return false
      const dedupKeyed = request.context.scope === 'coordinator_project' &&
        request.context.dedupReason !== undefined
      const expectedContext = request.context.scope === 'worker_execution'
        ? {
            scope: 'worker_execution' as const,
            taskId: request.context.taskId,
            executionId: request.context.executionId
          }
        : {
            scope: 'coordinator_project' as const,
            coordinatorAuthorityEpoch: request.context.expectedCoordinatorAuthorityEpoch,
            ...(dedupKeyed
              ? {
                  requirementsDocumentId: request.context.requirementsDocumentId!,
                  planItemId: request.context.planItemId!,
                  dedupReason: request.context.dedupReason!
                }
              : {})
          }
      // A dedup-keyed create may legitimately reuse the still-pending request
      // (design §9.22.2); the reused row carries its own expiry.
      const expiryMatches = dedupKeyed
        ? typeof response.entity.expiresAt === 'string'
        : response.entity.expiresAt === request.expiresAt
      return response.entity.projectId === request.projectId &&
        response.entity.targetUserId === request.targetUserId &&
        response.entity.requestedByAgentId === actor.agentId &&
        response.entity.requiredAssurance === request.requiredAssurance &&
        response.entity.prompt === request.prompt &&
        canonicalJson(response.entity.confirmableAction) ===
          canonicalJson(request.confirmableAction ?? null) &&
        response.entity.status === 'pending' &&
        expiryMatches &&
        response.entity.revision === 1 &&
        canonicalJson(response.entity.context) === canonicalJson(expectedContext)
    }
    case 'project.decision.submit':
      return isProjectDecisionCollection(request, response, actor)
    case 'task.offer.create': {
      const expectedTaskId = canonicalTaskIdForRequirementsModule(request.requirementsDocumentId, request.planItemId)
      return isUserTaskOfferCollection(response, {
        outcome: 'created',
        projectId: request.projectId,
        taskId: expectedTaskId,
        offeredByCoordinatorAgentId: actor.agentId,
        offerExpiresAt: request.offerExpiresAt,
        taskRevision: 1,
        offerRevision: 1
      })
    }
    case 'task.offer.withdraw':
      return isUserTaskOfferCollection(response, {
        outcome: 'withdrawn',
        taskId: request.taskId,
        taskOfferId: request.taskOfferId,
        taskRevision: request.expectedTaskRevision + 1,
        offerRevision: request.expectedOfferRevision + 1
      })
    case 'task.offer.extend':
      return isUserTaskOfferCollection(response, {
        outcome: 'extended',
        taskId: request.taskId,
        taskOfferId: request.taskOfferId,
        offerExpiresAt: request.offerExpiresAt,
        taskRevision: request.expectedTaskRevision,
        offerRevision: request.expectedOfferRevision + 1
      })
  }
  return unexpectedCoordinatorCommand(request)
}

function isTaskOfferReassignCollection(
  request: Extract<CoordinatorUserCloudCommand, { type: 'task.offer.reassign' }>,
  response: Exclude<RestResponse, { type: 'rest.error' }>,
): boolean {
  if (!isUserTaskOfferCollection(response, {
    outcome: 'reassigned',
    taskId: request.taskId,
    workerUserId: request.workerUserId,
    offerExpiresAt: request.offerExpiresAt,
    taskRevision: request.expectedTaskRevision + 1,
    offerRevision: 1
  })) return false
  if (response.type !== 'rest.collection') return false
  const [task, successorOffer] = response.items
  // The command carries no authoritative executionCount baseline. The parsed
  // Cloud Task owns that fact, so accepting this response must not infer one.
  return task?.type === 'task' &&
    successorOffer?.type === 'task_offer' &&
    canonicalJson(task.fileIntent) === canonicalJson(request.nextFileIntent) &&
    successorOffer.taskOfferId !== request.previousTaskOfferId
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
    response.project.status === 'draft' &&
    response.project.coordinatorAuthorityEpoch === 1 &&
    response.project.executionAuthorityEpoch === 1 &&
    response.project.revision === 1 &&
    canonicalJson(response.project.budget) === canonicalJson(request.budget) &&
    ownerMembership.projectId === response.project.projectId &&
    ownerMembership.userId === actor.userId &&
    ownerMembership.state === 'active' &&
    ownerMembership.authorityEpoch === 1 &&
    ownerMembership.revision === 1
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

function isUserTaskOfferCollection(
  response: Exclude<RestResponse, { type: 'rest.error' }>,
  expected: Readonly<{
    outcome: 'created' | 'withdrawn' | 'reassigned' | 'extended'
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
    case 'extended':
      return task.status === 'offered' &&
        offer.state === 'pending'
  }
}

function isExpectedTaskOfferClaimResponse(
  request: Extract<RestRequest, { type: 'task.offer.accept' }>,
  response: Exclude<RestResponse, { type: 'rest.error' }>,
  actor: CoordinatorActor
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
    execution.assigneeUserId === actor.userId &&
    execution.assigneeAgentId === actor.agentId &&
    execution.assigneeDeviceId === actor.deviceId &&
    (execution.contractRevision ?? undefined) === request.expectedContractRevision &&
    (execution.contractDigest ?? undefined) === request.expectedContractDigest &&
    (offer.contractRevision ?? undefined) === request.expectedContractRevision &&
    (offer.contractDigest ?? undefined) === request.expectedContractDigest &&
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

function assertExpectedHumanAcceptanceResponse(
  request: Extract<RestRequest, { type: 'task.offer.accept' }>,
  response: RestResponse,
  actor: Readonly<{ userId: string; deviceId: string }>
): void {
  if (response.type === 'rest.error' && response.requestId === request.requestId) return
  if (
    response.type !== 'rest.collection' ||
    response.nextCursor !== undefined ||
    response.items.length !== 3
  ) {
    throw new Error('Human Task offer acceptance returned an unexpected Cloud response.')
  }
  const [task, execution, offer] = response.items
  if (
    task?.type !== 'task' ||
    execution?.type !== 'task_execution' ||
    offer?.type !== 'task_offer' ||
    task.taskId !== request.taskId ||
    task.revision !== request.expectedTaskRevision + 1 ||
    task.status !== 'in_progress' ||
    task.currentExecutionId !== execution.executionId ||
    execution.taskId !== task.taskId ||
    execution.state !== 'accepted' ||
    execution.assigneeAgentId !== request.agentId ||
    execution.assigneeUserId !== actor.userId || execution.assigneeDeviceId !== actor.deviceId ||
    (request.deviceId !== undefined && execution.assigneeDeviceId !== request.deviceId) ||
    execution.workerAcceptanceProof === null ||
    execution.workerAcceptanceProof === undefined ||
    execution.workerAcceptanceProof.deviceId !== execution.assigneeDeviceId ||
    execution.workerAcceptanceProof.userId !== offer.workerUserId ||
    offer.taskOfferId !== request.taskOfferId ||
    offer.executionId !== execution.executionId ||
    offer.state !== 'accepted' ||
    offer.revision !== request.expectedOfferRevision + 1
  ) {
    throw new Error('Human Task offer acceptance did not return the exact immutable Worker binding.')
  }
}

function isExpectedTaskOfferRejectResponse(
  request: Extract<RestRequest, { type: 'task.offer.reject' }>,
  response: Exclude<RestResponse, { type: 'rest.error' }>,
  actor: CoordinatorActor
): boolean {
  if (
    response.requestId !== request.requestId ||
    response.type !== 'rest.collection' ||
    response.nextCursor !== undefined ||
    response.items.length !== 2
  ) return false
  const [task, offer] = response.items
  return task?.type === 'task' &&
    offer?.type === 'task_offer' &&
    task.taskId === request.taskId &&
    task.revision === request.expectedTaskRevision + 1 &&
    task.status === 'revision_requested' &&
    task.currentExecutionId === null &&
    task.currentExecutionState === null &&
    task.completedAt === null &&
    offer.taskOfferId === request.taskOfferId &&
    offer.taskId === task.taskId &&
    offer.projectId === task.projectId &&
    offer.workerUserId === actor.userId &&
    offer.executionId === null &&
    offer.state === 'rejected' &&
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
  if (task?.type !== 'task' || execution?.type !== 'task_execution') return false
  const retryable = task.executionCount < task.maxRetries + 1
  return task.taskId === request.taskId &&
    task.revision === request.expectedTaskRevision + 1 &&
    task.status === (retryable ? 'revision_requested' : 'failed') &&
    task.currentExecutionId === request.executionId &&
    task.currentExecutionState === 'failed' &&
    task.completedAt === (retryable ? null : request.failedAt) &&
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
