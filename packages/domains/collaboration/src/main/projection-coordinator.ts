import { createHash, randomUUID } from 'node:crypto'
import type {
  AgentInboxMessage,
  PersonalMessageReceivedPayload,
  RemoteSessionProjection
} from '@sciforge/collaboration-contracts'
import type {
  DomainAgentTranscriptMessage,
  DomainMainAgentThreadsHost
} from '@sciforge/domain-sdk/host'
import type { DomainMainAgentExecutionHost } from '@sciforge/domain-sdk/main'
import type {
  CollaborationLocalProjection,
  CollaborationLocalReceipt,
  CollaborationLocalState,
  CollaborationQueueItem
} from './store.js'
import { CollaborationLocalStore } from './store.js'

export type DesktopTranscriptEvent = Readonly<{
  runtimeId: string
  threadId: string
  turnId?: string
  itemId: string
  kind: 'user-message' | 'assistant-message'
  text: string
  occurredAt: string
  clientDirectiveId?: string
}>

export type ProjectionDeliveryCommand = Readonly<{
  projectionId: string
  projectionRevision: number
  localItemId: string
  localTurnId?: string
  kind: 'user_message' | 'assistant_final' | 'system_status'
  text: string
  occurredAt: string
}>

export type ProjectionCloudOutbox = Readonly<{
  enqueueProjectionDelivery(
    command: ProjectionDeliveryCommand,
    idempotencyKey: string
  ): Promise<void>
}>

export type ProjectionCoordinatorOptions = Readonly<{
  store: CollaborationLocalStore
  agentExecution: DomainMainAgentExecutionHost
  agentThreads?: DomainMainAgentThreadsHost
  cloudOutbox: ProjectionCloudOutbox
  localAgentId: () => string | undefined
  sanitizeText?: (value: string) => string
  now?: () => Date
}>

export type PersonalMessageAcceptance = Readonly<{
  duplicate: boolean
  queueItemId: string
  state: CollaborationQueueItem['state']
}>

/**
 * Owns the one local projection execution path.
 *
 * Per-projection promise tails serialize turns, while tails for different
 * projections remain independent. The stable clientDirectiveId is persisted
 * before dispatch and is reused after a crash so the Host's canonical Agent
 * directive ledger, not a second runtime facade, owns turn idempotency.
 */
export class ProjectionCoordinator {
  private readonly drains = new Map<string, Promise<void>>()
  private readonly now: () => Date
  private stopped = false

  constructor(private readonly options: ProjectionCoordinatorOptions) {
    this.now = options.now ?? (() => new Date())
  }

  async recover(): Promise<void> {
    this.stopped = false
    const state = this.options.store.snapshot()
    for (const projection of state.projections) {
      if (projection.projection.status === 'active') this.schedule(projection.projection.projectionId)
    }
  }

  async applyRemoteProjectionUpdate(
    projection: RemoteSessionProjection,
    notifiedRevision: number
  ): Promise<void> {
    const localAgentId = this.options.localAgentId()
    if (!localAgentId) throw new Error('This installation has no active collaboration Agent.')
    await this.options.store.transact((draft) => {
      const local = requireLocalProjection(draft, projection.projectionId)
      if (
        local.projection.agentId !== projection.agentId ||
        local.projection.ownerUserId !== projection.ownerUserId ||
        local.projection.humanEndpointId !== projection.humanEndpointId
      ) {
        throw new Error('Projection update attempted to change its bound security identity.')
      }
      if (projection.agentId !== localAgentId) {
        throw new Error('Projection update targets another Agent node.')
      }
      const agent = draft.agents.find((candidate) => candidate.agentId === localAgentId)
      if (
        !agent ||
        agent.lifecycleStatus !== 'active' ||
        agent.ownerUserId !== projection.ownerUserId
      ) {
        throw new Error('Projection update is not authorized for this local Agent owner.')
      }
      if (
        projection.revision < notifiedRevision ||
        projection.revision < local.projection.revision
      ) {
        throw new Error('Projection refresh returned a stale revision.')
      }
      // Only the cloud-owned entity changes. Exact local Session identity is
      // deliberately outside this assignment and therefore cannot be retargeted.
      local.projection = projection
    })
  }

  stop(): void {
    this.stopped = true
  }

  async waitForIdle(projectionId?: string): Promise<void> {
    if (projectionId) {
      await this.drains.get(projectionId)
      return
    }
    await Promise.all([...this.drains.values()])
  }

  async retry(projectionId: string): Promise<void> {
    await this.options.store.transact((draft) => {
      const projection = requireLocalProjection(draft, projectionId)
      if (projection.projection.status !== 'active') {
        throw new Error('Resume the projection before retrying its queue.')
      }
      const item = draft.queue
        .filter((candidate) => (
          candidate.projectionId === projectionId &&
          candidate.direction === 'inbound' &&
          candidate.state === 'failed'
        ))
        .sort((left, right) => left.sequence - right.sequence)[0]
      if (!item) return
      item.state = 'reconciling'
      item.completedAt = undefined
      item.error = undefined
      item.updatedAt = this.now().toISOString()
      const receipt = requiredReceipt(draft, item.queueItemId)
      receipt.status = 'accepted'
      receipt.updatedAt = item.updatedAt
    })
    this.schedule(projectionId)
  }

  async acceptPersonalInbox(message: AgentInboxMessage): Promise<PersonalMessageAcceptance> {
    if (message.payload.type !== 'personal.message.received') {
      throw new Error(`Expected personal.message.received, received ${message.payload.type}.`)
    }
    const localAgentId = this.options.localAgentId()
    if (!localAgentId || message.recipientAgentId !== localAgentId) {
      await this.recordDiagnostic(
        'collaboration.recipient_mismatch',
        'Inbox recipient does not match this Agent node.',
        false
      )
      throw new Error('Collaboration inbox recipient mismatch.')
    }
    const payload = message.payload
    const receiptKey = remoteReceiptKey(payload)
    const contentHash = sha256(payload.text)
    const accepted = await this.options.store.transact((draft) => {
      const existing = draft.receipts.find((receipt) => receipt.receiptKey === receiptKey)
      if (existing) {
        if (existing.contentHash !== contentHash) {
          throw new Error('Provider message identity was reused with different content.')
        }
        const item = requiredQueueItem(draft, existing.queueItemId)
        return {
          duplicate: true,
          queueItemId: item.queueItemId,
          state: item.state
        }
      }

      const projection = requireAuthorizedProjection(draft, payload, localAgentId)
      const echoed = draft.receipts.find((receipt) => (
        receipt.remoteMessageId === payload.providerMessageId
      ))
      const now = this.now().toISOString()
      const sequence = projection.nextSequence
      projection.nextSequence += 1
      const queueItemId = localOpaqueId('lqi')
      const localItemId = localOpaqueId('lit')
      const ignored = Boolean(echoed)
      const item: CollaborationQueueItem = {
        queueItemId,
        projectionId: payload.projectionId,
        sequence,
        direction: 'inbound',
        origin: 'human-endpoint',
        kind: 'user-message',
        senderUserId: payload.senderUserId,
        senderHumanEndpointId: payload.humanEndpointId,
        providerMessageId: payload.providerMessageId,
        localItemId,
        clientDirectiveId: directiveId(payload.projectionId, payload.providerMessageId),
        contentHash,
        text: payload.text,
        state: ignored ? 'ignored' : 'queued',
        attempts: 0,
        createdAt: now,
        updatedAt: now,
        ...(ignored ? { completedAt: now } : {})
      }
      const receipt: CollaborationLocalReceipt = {
        receiptKey,
        contentHash,
        queueItemId,
        projectionId: payload.projectionId,
        status: ignored ? 'ignored' : 'accepted',
        providerMessageId: payload.providerMessageId,
        localItemId,
        attempts: 0,
        createdAt: now,
        updatedAt: now
      }
      draft.queue.push(item)
      draft.receipts.push(receipt)
      return { duplicate: false, queueItemId, state: item.state }
    })
    if (!accepted.duplicate && accepted.state === 'queued') this.schedule(payload.projectionId)
    return accepted
  }

  async mirrorDesktopEvent(event: DesktopTranscriptEvent): Promise<void> {
    if (!event.text.trim()) return
    const matching = this.options.store.snapshot().projections.filter((candidate) => (
      candidate.projection.status === 'active' &&
      candidate.runtimeId === event.runtimeId &&
      candidate.threadId === event.threadId
    ))
    if (matching.length === 0) return
    if (matching.length > 1) {
      await this.recordDiagnostic(
        'collaboration.local_binding_ambiguous',
        'More than one active projection is bound to the same local Session.',
        false
      )
      throw new Error('Ambiguous local Session projection binding.')
    }
    const projection = matching[0]!
    const receiptKey = desktopReceiptKey(event)
    const localItemId = transcriptLocalItemId(event)
    const hash = sha256(event.text)
    const queued = await this.options.store.transact((draft) => {
      const existing = draft.receipts.find((receipt) => receipt.receiptKey === receiptKey)
      if (existing) {
        if (existing.contentHash !== hash) throw new Error('Desktop item identity collision.')
        return null
      }
      const local = requireLocalProjection(draft, projection.projection.projectionId)
      const now = this.now().toISOString()
      const queueItemId = localOpaqueId('lqi')
      const kind = event.kind === 'user-message' ? 'user-message' : 'assistant-reply'
      const item: CollaborationQueueItem = {
        queueItemId,
        projectionId: local.projection.projectionId,
        sequence: local.nextSequence,
        direction: 'outbound',
        origin: event.kind === 'user-message' ? 'desktop' : 'agent',
        kind,
        senderUserId: event.kind === 'user-message' ? local.projection.ownerUserId : undefined,
        localItemId,
        clientDirectiveId: event.clientDirectiveId,
        contentHash: hash,
        text: event.text,
        state: 'delivering',
        attempts: 0,
        turnId: event.turnId,
        createdAt: now,
        updatedAt: now
      }
      local.nextSequence += 1
      draft.queue.push(item)
      draft.receipts.push({
        receiptKey,
        contentHash: hash,
        queueItemId,
        projectionId: local.projection.projectionId,
        status: 'processing',
        localItemId,
        turnId: event.turnId,
        attempts: 0,
        createdAt: now,
        updatedAt: now
      })
      return { item, projectionRevision: local.projection.revision }
    })
    if (!queued) return
    try {
      await this.options.cloudOutbox.enqueueProjectionDelivery({
        projectionId: queued.item.projectionId,
        projectionRevision: queued.projectionRevision,
        localItemId: queued.item.localItemId!,
        ...(queued.item.turnId ? { localTurnId: queued.item.turnId } : {}),
        kind: queued.item.kind === 'user-message' ? 'user_message' : 'assistant_final',
        text: queued.item.text,
        occurredAt: queued.item.createdAt
      }, outboundIdempotencyKey(queued.item.queueItemId))
    } catch (error) {
      await this.failDelivery(queued.item.queueItemId, error)
    }
  }

  async reconcileCanonicalTurn(input: Readonly<{
    runtimeId: string
    threadId: string
    turnId: string
    messages: readonly DomainAgentTranscriptMessage[]
  }>): Promise<void> {
    const existingReceipts = new Set(
      this.options.store.snapshot().receipts.map((receipt) => receipt.receiptKey)
    )
    const missingMessages = input.messages.filter((message) => !existingReceipts.has(
      desktopReceiptKey({
        runtimeId: input.runtimeId,
        threadId: input.threadId,
        itemId: message.itemId
      })
    ))
    if (missingMessages.length === 0) return
    await this.mirrorCanonicalTurn({ ...input, messages: missingMessages })
  }

  async mirrorCanonicalTurn(input: Readonly<{
    runtimeId: string
    threadId: string
    turnId: string
    clientDirectiveId?: string
    messages: readonly DomainAgentTranscriptMessage[]
  }>): Promise<void> {
    const state = this.options.store.snapshot()
    const remoteDirective = input.clientDirectiveId
      ? state.queue.some((item) => (
          item.direction === 'inbound' && item.clientDirectiveId === input.clientDirectiveId
        ))
      : state.receipts.some((receipt) => (
          receipt.turnId === input.turnId &&
          state.queue.some((item) => (
            item.queueItemId === receipt.queueItemId && item.direction === 'inbound'
          ))
        ))
    for (const message of input.messages) {
      if (remoteDirective && message.kind === 'user-message') continue
      await this.mirrorDesktopEvent({
        runtimeId: input.runtimeId,
        threadId: input.threadId,
        turnId: message.turnId ?? input.turnId,
        itemId: message.itemId,
        kind: message.kind,
        text: message.text,
        occurredAt: message.occurredAt ?? this.now().toISOString(),
        ...(input.clientDirectiveId ? { clientDirectiveId: input.clientDirectiveId } : {})
      })
    }
  }

  private schedule(projectionId: string): void {
    if (this.stopped) return
    const current = this.drains.get(projectionId) ?? Promise.resolve()
    const next = current.then(
      () => this.drainProjection(projectionId),
      () => this.drainProjection(projectionId)
    ).finally(() => {
      if (this.drains.get(projectionId) === next) this.drains.delete(projectionId)
    })
    this.drains.set(projectionId, next)
  }

  private async drainProjection(projectionId: string): Promise<void> {
    while (!this.stopped) {
      const state = this.options.store.snapshot()
      const projection = state.projections.find((candidate) => (
        candidate.projection.projectionId === projectionId
      ))
      if (!projection || projection.projection.status !== 'active') return
      const item = state.queue
        .filter((candidate) => (
          candidate.projectionId === projectionId &&
          candidate.direction === 'inbound' &&
          candidate.kind === 'user-message' &&
          (candidate.state === 'queued' || candidate.state === 'reconciling')
        ))
        .sort((left, right) => left.sequence - right.sequence)[0]
      if (!item) return
      await this.executeInbound(projection, item)
    }
  }

  private async executeInbound(
    projectionSnapshot: CollaborationLocalProjection,
    itemSnapshot: CollaborationQueueItem
  ): Promise<void> {
    const startedAt = this.now().toISOString()
    const current = await this.options.store.transact((draft) => {
      const projection = requireLocalProjection(draft, projectionSnapshot.projection.projectionId)
      const item = requiredQueueItem(draft, itemSnapshot.queueItemId)
      if (item.state !== 'queued' && item.state !== 'reconciling') return null
      if (projection.projection.status !== 'active') return null
      item.state = 'executing'
      item.attempts += 1
      item.updatedAt = startedAt
      item.error = undefined
      const receipt = requiredReceipt(draft, item.queueItemId)
      receipt.status = 'processing'
      receipt.attempts = item.attempts
      receipt.updatedAt = startedAt
      return { projection: structuredClone(projection), item: structuredClone(item) }
    })
    if (!current) return

    try {
      const result = await this.options.agentExecution.run({
        runtimeId: current.projection.runtimeId,
        ...(current.projection.threadId ? { threadId: current.projection.threadId } : {}),
        ...(current.projection.workspaceRoot ? { workspaceRoot: current.projection.workspaceRoot } : {}),
        clientDirectiveId: current.item.clientDirectiveId!,
        prompt: current.item.text,
        metadata: {
          source: 'collaboration.remote-session-projection',
          projectionId: current.item.projectionId,
          senderUserId: current.item.senderUserId!,
          senderHumanEndpointId: current.item.senderHumanEndpointId!,
          providerMessageId: current.item.providerMessageId!
        },
        interaction: 'reviewable',
        mode: 'agent'
      })
      const completedAt = this.now().toISOString()
      if (result.state !== 'completed') {
        await this.markExecutionFailed(
          current.item.queueItemId,
          `Agent turn ended in ${result.state}.`,
          result.turnId,
          completedAt
        )
        return
      }
      await this.options.store.transact((draft) => {
        const projection = requireLocalProjection(draft, current.projection.projection.projectionId)
        const item = requiredQueueItem(draft, current.item.queueItemId)
        if (!projection.threadId) {
          projection.runtimeId = result.runtimeId
          projection.threadId = result.threadId
        } else if (
          projection.runtimeId !== result.runtimeId || projection.threadId !== result.threadId
        ) {
          throw new Error('Canonical Agent execution returned a different Session binding.')
        }
        item.state = 'completed'
        item.turnId = result.turnId
        item.updatedAt = completedAt
        item.completedAt = completedAt
        const receipt = requiredReceipt(draft, item.queueItemId)
        receipt.status = 'completed'
        receipt.turnId = result.turnId
        receipt.updatedAt = completedAt
        projection.lastSynchronizedAt = completedAt
        projection.lastError = undefined
      })
      if (this.options.agentThreads) {
        try {
          const thread = await this.options.agentThreads.read({
            runtimeId: result.runtimeId,
            threadId: result.threadId
          })
          const turn = thread.turns.find((candidate) => candidate.id === result.turnId)
          if (turn) {
            await this.mirrorCanonicalTurn({
              runtimeId: result.runtimeId,
              threadId: result.threadId,
              turnId: result.turnId,
              clientDirectiveId: current.item.clientDirectiveId,
              messages: turn.messages
            })
          }
        } catch (error) {
          await this.recordDiagnostic(
            'collaboration.transcript_reconciliation_failed',
            safeError(error, this.options.sanitizeText),
            true
          )
        }
      }
    } catch (error) {
      await this.markExecutionFailed(
        current.item.queueItemId,
        safeError(error, this.options.sanitizeText),
        undefined,
        this.now().toISOString()
      )
    }
  }

  private async markExecutionFailed(
    queueItemId: string,
    message: string,
    turnId: string | undefined,
    completedAt: string
  ): Promise<void> {
    await this.options.store.transact((draft) => {
      const item = requiredQueueItem(draft, queueItemId)
      item.state = 'failed'
      item.error = message
      item.turnId = turnId
      item.updatedAt = completedAt
      item.completedAt = completedAt
      const receipt = requiredReceipt(draft, queueItemId)
      receipt.status = 'failed'
      receipt.turnId = turnId
      receipt.updatedAt = completedAt
      const projection = requireLocalProjection(draft, item.projectionId)
      projection.lastError = message
      draft.diagnostics = [
        ...draft.diagnostics,
        {
          code: 'collaboration.agent_execution_failed',
          severity: 'error' as const,
          message,
          occurredAt: completedAt,
          recoverable: true
        }
      ].slice(-256)
    })
  }

  private async failDelivery(queueItemId: string, error: unknown): Promise<void> {
    const failedAt = this.now().toISOString()
    await this.options.store.transact((draft) => {
      const item = requiredQueueItem(draft, queueItemId)
      item.state = 'failed'
      item.error = safeError(error, this.options.sanitizeText)
      item.updatedAt = failedAt
      item.completedAt = failedAt
      const receipt = requiredReceipt(draft, queueItemId)
      receipt.status = 'failed'
      receipt.updatedAt = failedAt
    })
  }

  private async recordDiagnostic(
    code: string,
    message: string,
    recoverable: boolean
  ): Promise<void> {
    await this.options.store.transact((draft) => {
      draft.diagnostics = [
        ...draft.diagnostics,
        {
          code,
          severity: 'error' as const,
          message,
          occurredAt: this.now().toISOString(),
          recoverable
        }
      ].slice(-256)
    })
  }
}

function requireAuthorizedProjection(
  state: CollaborationLocalState,
  payload: PersonalMessageReceivedPayload,
  localAgentId: string
): CollaborationLocalProjection {
  const projection = requireLocalProjection(state, payload.projectionId)
  if (projection.projection.agentId !== localAgentId) {
    throw new Error('Projection belongs to another Agent node.')
  }
  if (projection.projection.revision !== payload.projectionRevision) {
    throw new Error('Projection revision is stale; refresh the binding before executing.')
  }
  if (projection.projection.status !== 'active') {
    throw new Error(`Projection is ${projection.projection.status}; it cannot execute messages.`)
  }
  if (!projection.projection.allowedSenderUserIds.includes(payload.senderUserId)) {
    throw new Error('Sender is not in the projection allowlist.')
  }
  const agent = state.agents.find((candidate) => candidate.agentId === localAgentId)
  if (!agent || agent.lifecycleStatus !== 'active') throw new Error('Local Agent is not active.')
  if (agent.ownerUserId !== projection.projection.ownerUserId) {
    throw new Error('Projection owner and executing Agent owner do not match.')
  }
  return projection
}

function requireLocalProjection(
  state: CollaborationLocalState,
  projectionId: string
): CollaborationLocalProjection {
  const projection = state.projections.find((candidate) => (
    candidate.projection.projectionId === projectionId
  ))
  if (!projection) throw new Error('Local projection binding was not found.')
  return projection
}

function requiredQueueItem(state: CollaborationLocalState, queueItemId: string): CollaborationQueueItem {
  const item = state.queue.find((candidate) => candidate.queueItemId === queueItemId)
  if (!item) throw new Error('Projection queue item was not found.')
  return item
}

function requiredReceipt(state: CollaborationLocalState, queueItemId: string): CollaborationLocalReceipt {
  const receipt = state.receipts.find((candidate) => candidate.queueItemId === queueItemId)
  if (!receipt) throw new Error('Projection receipt was not found.')
  return receipt
}

function remoteReceiptKey(payload: PersonalMessageReceivedPayload): string {
  return `provider:${payload.projectionId}:${payload.providerMessageId}`
}

function directiveId(projectionId: string, providerMessageId: string): string {
  return `collab-${sha256(`${projectionId}\u0000${providerMessageId}`).slice(0, 48)}`
}

function outboundIdempotencyKey(queueItemId: string): string {
  return `idem_projection.${sha256(queueItemId).slice(0, 48)}`
}

function transcriptLocalItemId(event: DesktopTranscriptEvent): string {
  return `lit_${sha256(JSON.stringify([
    event.runtimeId,
    event.threadId,
    event.itemId
  ])).slice(0, 48)}`
}

function desktopReceiptKey(event: Pick<DesktopTranscriptEvent, 'runtimeId' | 'threadId' | 'itemId'>): string {
  return `desktop:${event.runtimeId}:${event.threadId}:${event.itemId}`
}

function localOpaqueId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll('-', '')}`
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function safeError(error: unknown, sanitizeText?: (value: string) => string): string {
  const message = error instanceof Error ? error.message : 'Collaboration operation failed.'
  return structuralRedact(sanitizeText?.(message) ?? message).slice(0, 4_000)
}

function structuralRedact(value: string): string {
  return value
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{6,}/giu, '[REDACTED]')
    .replace(/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/gu, '[REDACTED]')
    .replace(/([a-z][a-z0-9+.-]*:\/\/[^\s:/]+:)[^\s@]+@/giu, '$1[REDACTED]@')
}

export function localProjectionFromRemote(
  projection: RemoteSessionProjection,
  input: Readonly<{
    runtimeId: string
    threadId?: string
    workspaceRoot?: string
    bindingMode: 'existing' | 'new'
  }>
): CollaborationLocalProjection {
  return {
    projection,
    runtimeId: input.runtimeId,
    ...(input.threadId ? { threadId: input.threadId } : {}),
    ...(input.workspaceRoot ? { workspaceRoot: input.workspaceRoot } : {}),
    bindingMode: input.bindingMode,
    nextSequence: 1
  }
}
