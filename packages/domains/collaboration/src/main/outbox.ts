import { createHash, randomUUID } from 'node:crypto'
import {
  restRequestSchema,
  type RestRequest
} from '@sciforge/collaboration-contracts'
import type { DomainMainPackageSecretStoreHost } from '@sciforge/domain-sdk/package-storage'
import type { ProjectionCloudOutbox, ProjectionDeliveryCommand } from './projection-coordinator.js'
import type { CollaborationOutboxEntry } from './store.js'
import { CollaborationLocalStore } from './store.js'
import {
  HttpCollaborationCloudClient,
  type CollaborationCloudClient
} from './cloud-client.js'

export const COLLABORATION_DEVICE_CREDENTIAL_SECRET_KEY = 'device-credential' as const

export type DurableCloudOutboxOptions = Readonly<{
  store: CollaborationLocalStore
  packageSecrets: DomainMainPackageSecretStoreHost
  cloudClient: () => CollaborationCloudClient | null
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
      const client = this.options.cloudClient()
      if (!client) return
      const secret = await this.options.packageSecrets.read(COLLABORATION_DEVICE_CREDENTIAL_SECRET_KEY)
      if (!secret) return
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
        const response = await client.execute(request, { value: secret })
        if (response.type === 'rest.error') throw new Error(response.error.message)
        if (response.type !== 'rest.receipt') {
          throw new Error(`Cloud write returned unexpected ${response.type}.`)
        }
        const deliveredAt = this.now().toISOString()
        await this.options.store.transact((draft) => {
          const entry = requireOutbox(draft.outbox, next.outboxId)
          entry.state = 'delivered'
          entry.updatedAt = deliveredAt
          entry.deliveredAt = deliveredAt
          if (request.type !== 'projection.message.publish') return
          const receipt = draft.receipts.find((candidate) => (
            candidate.localItemId === request.localItemId &&
            candidate.projectionId === request.projectionId
          ))
          if (!receipt) return
          receipt.status = 'delivered'
          receipt.updatedAt = deliveredAt
          if (
            response.receipt.type === 'projection.message.receipt' &&
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

export function createHttpCloudClient(baseUrl: string): CollaborationCloudClient {
  return new HttpCollaborationCloudClient({ baseUrl })
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
