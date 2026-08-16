import { createHash } from 'node:crypto'
import { ZulipProviderError, isZulipProviderError } from './errors.js'
import type { ZulipLocator } from './locator.js'

export type ZulipDeliveryState = 'pending' | 'sent' | 'uncertain' | 'failed'

export type ZulipDeliveryRecord = {
  idempotencyKey: string
  contentHash: string
  locator: ZulipLocator
  state: ZulipDeliveryState
  attempt: number
  createdAt: string
  updatedAt: string
  remoteMessageId?: string
  errorCode?: string
}

export type ZulipDeliveryLedger = {
  get(idempotencyKey: string): Promise<ZulipDeliveryRecord | null>
  begin(record: ZulipDeliveryRecord): Promise<ZulipDeliveryRecord>
  update(record: ZulipDeliveryRecord): Promise<void>
}

export type ZulipDeliveryReconciliation =
  | { status: 'sent'; remoteMessageId: string }
  | { status: 'not_sent' }
  | { status: 'unknown' }

export type ZulipDeliveryReconciler = (
  record: ZulipDeliveryRecord
) => Promise<ZulipDeliveryReconciliation>

export type ZulipSendAttempt = (attempt: number) => Promise<{ remoteMessageId: string }>

export type ZulipDeliveryCoordinatorOptions = {
  ledger: ZulipDeliveryLedger
  reconcile: ZulipDeliveryReconciler
  now?: () => Date
  sleep?: (milliseconds: number) => Promise<void>
  maxAttempts?: number
  initialRetryDelayMs?: number
  maxRetryDelayMs?: number
}

export type ZulipDeliveryResult = {
  remoteMessageId: string
  duplicate: boolean
  reconciled: boolean
  attempts: number
}

export function zulipContentHash(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

export class ZulipDeliveryCoordinator {
  private readonly ledger: ZulipDeliveryLedger
  private readonly reconcile: ZulipDeliveryReconciler
  private readonly now: () => Date
  private readonly sleep: (milliseconds: number) => Promise<void>
  private readonly maxAttempts: number
  private readonly initialRetryDelayMs: number
  private readonly maxRetryDelayMs: number

  constructor(options: ZulipDeliveryCoordinatorOptions) {
    this.ledger = options.ledger
    this.reconcile = options.reconcile
    this.now = options.now ?? (() => new Date())
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))
    this.maxAttempts = options.maxAttempts ?? 3
    this.initialRetryDelayMs = options.initialRetryDelayMs ?? 750
    this.maxRetryDelayMs = options.maxRetryDelayMs ?? 5_000
  }

  async deliver(input: {
    idempotencyKey: string
    locator: ZulipLocator
    content: string
    send: ZulipSendAttempt
  }): Promise<ZulipDeliveryResult> {
    const idempotencyKey = input.idempotencyKey.trim()
    if (!idempotencyKey || idempotencyKey.length > 256) {
      throw new ZulipProviderError('invalid_payload', 'A bounded idempotency key is required.')
    }
    const contentHash = zulipContentHash(input.content)
    const previous = await this.ledger.get(idempotencyKey)
    if (previous) {
      if (previous.contentHash !== contentHash) {
        throw new ZulipProviderError('invalid_payload', 'Idempotency key was reused with different content.')
      }
      if (previous.state === 'sent' && previous.remoteMessageId) {
        return {
          remoteMessageId: previous.remoteMessageId,
          duplicate: true,
          reconciled: false,
          attempts: previous.attempt
        }
      }
      const reconciled = await this.reconcile(previous)
      if (reconciled.status === 'sent') {
        const sent = this.updated(previous, {
          state: 'sent',
          remoteMessageId: reconciled.remoteMessageId
        })
        await this.ledger.update(sent)
        return {
          remoteMessageId: reconciled.remoteMessageId,
          duplicate: true,
          reconciled: true,
          attempts: previous.attempt
        }
      }
      if (reconciled.status === 'unknown') {
        throw new ZulipProviderError('delivery_uncertain', 'Previous Zulip delivery cannot be reconciled safely.')
      }
    }

    const timestamp = this.now().toISOString()
    let record = previous ?? await this.ledger.begin({
      idempotencyKey,
      contentHash,
      locator: input.locator,
      state: 'pending',
      attempt: 0,
      createdAt: timestamp,
      updatedAt: timestamp
    })

    for (let attempt = Math.max(1, record.attempt + 1); attempt <= this.maxAttempts; attempt += 1) {
      record = this.updated(record, { state: 'pending', attempt })
      await this.ledger.update(record)
      try {
        const sent = await input.send(attempt)
        record = this.updated(record, { state: 'sent', remoteMessageId: sent.remoteMessageId })
        await this.ledger.update(record)
        return { remoteMessageId: sent.remoteMessageId, duplicate: false, reconciled: false, attempts: attempt }
      } catch (error) {
        const code = isZulipProviderError(error) ? error.code : 'provider_unavailable'
        const canProveNotSent = isZulipProviderError(error) && (
          error.code === 'rate_limited' ||
          error.code === 'authentication_failed' ||
          error.code === 'permission_denied' ||
          error.code === 'not_found' ||
          error.code === 'invalid_payload'
        )
        if (!canProveNotSent) {
          record = this.updated(record, { state: 'uncertain', errorCode: code })
          await this.ledger.update(record)
          const reconciliation = await this.reconcile(record)
          if (reconciliation.status === 'sent') {
            record = this.updated(record, {
              state: 'sent',
              remoteMessageId: reconciliation.remoteMessageId
            })
            delete record.errorCode
            await this.ledger.update(record)
            return {
              remoteMessageId: reconciliation.remoteMessageId,
              duplicate: false,
              reconciled: true,
              attempts: attempt
            }
          }
          if (reconciliation.status === 'unknown') {
            throw new ZulipProviderError('delivery_uncertain', 'Zulip delivery cannot be reconciled safely.', {
              cause: error
            })
          }
        }
        if (attempt === this.maxAttempts || !isZulipProviderError(error) || !error.retryable) {
          record = this.updated(record, { state: 'failed', errorCode: code })
          await this.ledger.update(record)
          throw error
        }
        const delayMs = error.retryAfterMs ?? Math.min(
          this.maxRetryDelayMs,
          this.initialRetryDelayMs * (2 ** Math.max(0, attempt - 1))
        )
        await this.sleep(delayMs)
      }
    }
    throw new ZulipProviderError('retry_exhausted', 'Zulip delivery retry budget was exhausted.')
  }

  private updated(
    record: ZulipDeliveryRecord,
    patch: Partial<ZulipDeliveryRecord>
  ): ZulipDeliveryRecord {
    const next = { ...record, ...patch, updatedAt: this.now().toISOString() }
    if (patch.remoteMessageId === undefined && 'remoteMessageId' in patch) delete next.remoteMessageId
    if (patch.errorCode === undefined && 'errorCode' in patch) delete next.errorCode
    return next
  }
}
