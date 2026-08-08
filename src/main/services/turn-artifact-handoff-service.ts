import type {
  DomainArtifactConsumer,
  DomainTurnArtifactEvent
} from '@sciforge/domain-sdk/host'

import {
  TurnArtifactOutbox,
  type TurnArtifactIntent,
  type TurnArtifactOutboxRecord
} from './turn-artifact-outbox'

export type TurnArtifactIntentPublisher = Readonly<{
  publish: (intent: TurnArtifactIntent) => Promise<void>
}>

export type TurnArtifactHandoffServiceOptions = Readonly<{
  outbox: TurnArtifactOutbox
  consumers: readonly DomainArtifactConsumer[]
  materialize: (intent: TurnArtifactIntent) => Promise<DomainTurnArtifactEvent>
  retryBaseMs?: number
  retryMaxMs?: number
  log?: (level: 'warn' | 'error', message: string, detail?: unknown) => void
  setTimeout?: typeof setTimeout
  clearTimeout?: typeof clearTimeout
}>

/** Durable intent -> materialization -> all-consumer handoff for completed turns. */
export class TurnArtifactHandoffService implements TurnArtifactIntentPublisher {
  readonly #outbox: TurnArtifactOutbox
  readonly #consumers: readonly DomainArtifactConsumer[]
  readonly #materialize: TurnArtifactHandoffServiceOptions['materialize']
  readonly #retryBaseMs: number
  readonly #retryMaxMs: number
  readonly #log?: TurnArtifactHandoffServiceOptions['log']
  readonly #setTimeout: typeof setTimeout
  readonly #clearTimeout: typeof clearTimeout
  #deliveryQueue: Promise<void> = Promise.resolve()
  #retryTimer: ReturnType<typeof setTimeout> | null = null
  #closed = false

  constructor(options: TurnArtifactHandoffServiceOptions) {
    this.#outbox = options.outbox
    this.#consumers = Object.freeze([...options.consumers])
    this.#materialize = options.materialize
    this.#retryBaseMs = positiveDuration(options.retryBaseMs ?? 1_000, 'retryBaseMs')
    this.#retryMaxMs = positiveDuration(options.retryMaxMs ?? 60_000, 'retryMaxMs')
    if (this.#retryMaxMs < this.#retryBaseMs) {
      throw new TypeError('retryMaxMs must be greater than or equal to retryBaseMs.')
    }
    this.#log = options.log
    this.#setTimeout = options.setTimeout ?? setTimeout
    this.#clearTimeout = options.clearTimeout ?? clearTimeout
  }

  /** Persists the deterministic intent before any adapter read or consumer call. */
  async publish(intent: TurnArtifactIntent): Promise<void> {
    if (this.#closed) throw new Error('Completed turn artifact handoff is closed.')
    await this.#outbox.enqueueIntent(intent)
    this.#scheduleReplay(0)
  }

  /** Replays every due materialization/fan-out after Host activation or a retry. */
  async replayPending(): Promise<void> {
    if (this.#closed) return
    await this.#outbox.load()
    await this.#serializeDelivery(async () => {
      const failures: unknown[] = []
      for (const record of this.#outbox.ready()) {
        try {
          await this.#process(record)
        } catch (error) {
          failures.push(error)
        }
      }
      this.#scheduleNextReplay()
      if (failures.length > 0) {
        throw new AggregateError(failures, 'Completed turn artifact handoff failed.')
      }
    })
  }

  async close(): Promise<void> {
    if (!this.#closed) this.#closed = true
    if (this.#retryTimer) {
      this.#clearTimeout(this.#retryTimer)
      this.#retryTimer = null
    }
    await this.#deliveryQueue.catch(() => undefined)
  }

  async #process(initial: TurnArtifactOutboxRecord): Promise<void> {
    let record = initial
    try {
      let event: DomainTurnArtifactEvent
      if (record.stage === 'pending_materialization') {
        const materialized = await this.#materialize(record.intent)
        const pendingFanout = await this.#outbox.markMaterialized(record.key, materialized)
        record = pendingFanout
        event = pendingFanout.event
      } else {
        event = record.event
      }
      const results = await Promise.allSettled(
        this.#consumers.map((consumer) => consumer.consume(event))
      )
      const failures = results.flatMap((result) => (
        result.status === 'rejected' ? [result.reason] : []
      ))
      if (failures.length > 0) {
        this.#log?.('error', 'A completed Agent turn could not reach every artifact consumer.', {
          key: record.key,
          failures
        })
        throw new AggregateError(failures, 'Completed turn artifact fan-out failed.')
      }
      await this.#outbox.markDelivered(record.key)
    } catch (error) {
      const retryAfterMs = Math.min(
        this.#retryMaxMs,
        this.#retryBaseMs * (2 ** Math.min(16, record.attempts))
      )
      await this.#outbox.markFailed(record.key, error, retryAfterMs)
      throw error
    }
  }

  async #serializeDelivery<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.#deliveryQueue.then(operation, operation)
    this.#deliveryQueue = pending.then(() => undefined, () => undefined)
    return pending
  }

  #scheduleReplay(delayMs: number): void {
    if (this.#closed) return
    if (this.#retryTimer) this.#clearTimeout(this.#retryTimer)
    this.#retryTimer = this.#setTimeout(() => {
      this.#retryTimer = null
      void this.replayPending().catch((error) => {
        this.#log?.('error', 'Durable completed turn artifact replay failed.', error)
      })
    }, Math.max(0, delayMs))
    this.#retryTimer.unref?.()
  }

  #scheduleNextReplay(): void {
    const nextAttemptAt = this.#outbox.nextAttemptAt()
    if (nextAttemptAt === null) {
      if (this.#retryTimer) {
        this.#clearTimeout(this.#retryTimer)
        this.#retryTimer = null
      }
      return
    }
    this.#scheduleReplay(nextAttemptAt - Date.now())
  }
}

function positiveDuration(value: number, field: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${field} must be a positive duration.`)
  }
  return value
}
