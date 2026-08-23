import type {
  DomainArtifactConsumer,
  DomainMainAfterTurnEvent,
  DomainMainDurableTurnBoundarySnapshot,
  DomainTurnArtifactEvent
} from '@sciforge/domain-sdk/host'

import {
  TurnArtifactOutbox,
  type TurnArtifactIntent,
  type TurnArtifactReplayIntent,
  type TurnArtifactOutboxRecord,
  type TurnArtifactWatch,
  type PendingTurnArtifactWatch,
  type TurnArtifactStart,
  type TurnArtifactStartDraft,
  type PendingTurnArtifactStart
} from './turn-artifact-outbox'

const LEGACY_ARTIFACT_MATERIALIZATION_MAX_ATTEMPTS = 8

export type TurnArtifactIntentPublisher = Readonly<{
  registerStart: (start: TurnArtifactStartDraft) => Promise<PendingTurnArtifactStart>
  markStartDispatching: (start: TurnArtifactStart) => Promise<PendingTurnArtifactStart>
  bindStart: (start: TurnArtifactStart, watch: TurnArtifactWatch) => Promise<boolean>
  rejectStart: (
    start: TurnArtifactStart,
    settlement: DomainMainAfterTurnEvent
  ) => Promise<boolean>
  pendingStarts: () => Promise<readonly PendingTurnArtifactStart[]>
  pending: () => Promise<readonly PendingTurnArtifactWatch[]>
  appendFilePatchReceipts: TurnArtifactOutbox['appendFilePatchReceipts']
  publish: (intent: TurnArtifactIntent) => Promise<void>
  publishLifecycleSettlement: (event: DomainMainAfterTurnEvent) => Promise<void>
  attachLifecycleSettlementConsumer: (
    consumer: (event: DomainMainAfterTurnEvent) => Promise<void>
  ) => void
  readDurableTurnBoundarySnapshot: () => Promise<DomainMainDurableTurnBoundarySnapshot>
  flushThread: (runtimeId: string, threadId: string) => Promise<void>
}>

export type TurnArtifactHandoffServiceOptions = Readonly<{
  outbox: TurnArtifactOutbox
  consumers: readonly DomainArtifactConsumer[]
  materialize: (intent: TurnArtifactReplayIntent) => Promise<DomainTurnArtifactEvent>
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
  #deliverLifecycleSettlement: ((event: DomainMainAfterTurnEvent) => Promise<void>) | null = null
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

  async registerStart(start: TurnArtifactStartDraft): Promise<PendingTurnArtifactStart> {
    if (this.#closed) throw new Error('Completed turn artifact handoff is closed.')
    return this.#outboxOperation(() => this.#outbox.registerStart(start))
  }

  async markStartDispatching(start: TurnArtifactStart): Promise<PendingTurnArtifactStart> {
    if (this.#closed) throw new Error('Completed turn artifact handoff is closed.')
    return this.#outboxOperation(() => this.#outbox.markStartDispatching(start))
  }

  async bindStart(start: TurnArtifactStart, watch: TurnArtifactWatch): Promise<boolean> {
    if (this.#closed) throw new Error('Completed turn artifact handoff is closed.')
    return this.#outboxOperation(() => this.#outbox.bindStart(start, watch))
  }

  async rejectStart(
    start: TurnArtifactStart,
    settlement: DomainMainAfterTurnEvent
  ): Promise<boolean> {
    if (this.#closed) throw new Error('Completed turn artifact handoff is closed.')
    const applied = await this.#outboxOperation(() => this.#outbox.rejectStart(start, settlement))
    if (applied) {
      await this.flushThread(settlement.runtimeId, settlement.threadId).catch((error) => {
        this.#log?.('error', 'Durable turn lifecycle settlement delivery failed.', error)
        this.#scheduleNextReplay()
      })
    }
    return applied
  }

  async pendingStarts(): Promise<readonly PendingTurnArtifactStart[]> {
    if (this.#closed) return []
    await this.#outboxOperation(() => this.#outbox.load())
    return this.#outbox.pendingStarts()
  }

  /** Enumerates only turns accepted by this Host generation, never old history. */
  async pending(): Promise<readonly PendingTurnArtifactWatch[]> {
    if (this.#closed) return []
    await this.#outboxOperation(() => this.#outbox.load())
    return this.#outbox.pendingWatches()
  }

  async appendFilePatchReceipts(
    input: Pick<TurnArtifactWatch, 'runtimeId' | 'threadId' | 'turnId'>,
    values: Parameters<TurnArtifactOutbox['appendFilePatchReceipts']>[1]
  ): Promise<void> {
    if (this.#closed) throw new Error('Completed turn artifact handoff is closed.')
    await this.#outboxOperation(() => this.#outbox.appendFilePatchReceipts(input, values))
  }

  /** Persists the deterministic intent before any adapter read or consumer call. */
  async publish(intent: TurnArtifactIntent): Promise<void> {
    if (this.#closed) throw new Error('Completed turn artifact handoff is closed.')
    await this.#outboxOperation(() => this.#outbox.completeWatch(intent))
    this.#scheduleReplay(0)
  }

  async publishLifecycleSettlement(event: DomainMainAfterTurnEvent): Promise<void> {
    if (this.#closed) throw new Error('Turn lifecycle settlement handoff is closed.')
    await this.#outboxOperation(() => this.#outbox.enqueueLifecycleSettlement(event))
    await this.flushThread(event.runtimeId, event.threadId).catch((error) => {
      this.#log?.('error', 'Durable turn lifecycle settlement delivery failed.', error)
      this.#scheduleNextReplay()
    })
  }

  attachLifecycleSettlementConsumer(
    consumer: (event: DomainMainAfterTurnEvent) => Promise<void>
  ): void {
    if (this.#deliverLifecycleSettlement && this.#deliverLifecycleSettlement !== consumer) {
      throw new Error('Turn lifecycle settlement consumer is already attached.')
    }
    this.#deliverLifecycleSettlement = consumer
  }

  async readDurableTurnBoundarySnapshot(): Promise<DomainMainDurableTurnBoundarySnapshot> {
    if (this.#closed) throw new Error('Completed turn artifact handoff is closed.')
    await this.#outboxOperation(() => this.#outbox.load())
    return this.#outbox.durableTurnBoundarySnapshot()
  }

  async flushThread(runtimeId: string, threadId: string): Promise<void> {
    if (this.#closed) throw new Error('Completed turn artifact handoff is closed.')
    await this.#outboxOperation(() => this.#outbox.load())
    await this.#serializeDelivery(async () => {
      const failures: unknown[] = []
      for (const record of this.#outbox.lifecycleSettlementsForThread(runtimeId, threadId)) {
        try {
          await this.#processLifecycleSettlement(record)
        } catch (error) {
          failures.push(error)
        }
      }
      if (failures.length === 0) {
        for (const record of this.#outbox.recordsForThread(runtimeId, threadId)) {
          try {
            await this.#process(record)
          } catch (error) {
            failures.push(error)
          }
        }
      }
      if (failures.length === 0) {
        const unresolved = this.#outbox.unresolvedCapturesForThread(runtimeId, threadId)
        if (unresolved.length > 0) {
          failures.push(new Error(
            `Turn handoff has ${unresolved.length} unresolved accepted/prepared predecessor(s).`
          ))
        }
      }
      this.#scheduleNextReplay()
      if (failures.length > 0) {
        throw new AggregateError(failures, 'Turn handoff predecessor flush failed.')
      }
    })
  }

  /** Replays every due materialization/fan-out after Host activation or a retry. */
  async replayPending(): Promise<void> {
    if (this.#closed) return
    await this.#outboxOperation(() => this.#outbox.load())
    await this.#serializeDelivery(async () => {
      const failures: unknown[] = []
      const blockedThreads = new Set<string>()
      for (const record of this.#outbox.readyLifecycleSettlements()) {
        if (this.#closed) break
        try {
          await this.#processLifecycleSettlement(record)
        } catch (error) {
          failures.push(error)
          blockedThreads.add(`${record.event.runtimeId}\u0000${record.event.threadId}`)
          if (this.#closed) break
        }
      }
      for (const record of this.#outbox.ready()) {
        if (this.#closed) break
        if (blockedThreads.has(`${record.intent.runtimeId}\u0000${record.intent.threadId}`)) continue
        try {
          await this.#process(record)
        } catch (error) {
          failures.push(error)
          // A post-rename ambiguity poisons the shared writer. Do not let this
          // Host generation fan out any later record from an uncertain view.
          if (this.#closed) break
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
        const pendingFanout = await this.#outboxOperation(
          () => this.#outbox.markMaterialized(record.key, materialized)
        )
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
      await this.#outboxOperation(() => this.#outbox.markDelivered(record.key))
    } catch (error) {
      if (this.#outbox.poisonedError) {
        this.#failStop()
        throw error
      }
      const nextAttempts = record.attempts + 1
      if (
        record.stage === 'pending_materialization' &&
        record.legacyArtifactOnly &&
        nextAttempts >= LEGACY_ARTIFACT_MATERIALIZATION_MAX_ATTEMPTS
      ) {
        await this.#outboxOperation(
          () => this.#outbox.markLegacyMaterializationQuarantined(record.key, error)
        )
        this.#log?.(
          'error',
          'Legacy completed turn artifact materialization was quarantined after bounded retries.',
          {
            key: record.key,
            attempts: nextAttempts,
            error
          }
        )
        return
      }
      const retryAfterMs = Math.min(
        this.#retryMaxMs,
        this.#retryBaseMs * (2 ** Math.min(16, record.attempts))
      )
      await this.#outboxOperation(() => this.#outbox.markFailed(record.key, error, retryAfterMs))
      throw error
    }
  }

  async #processLifecycleSettlement(
    record: ReturnType<TurnArtifactOutbox['readyLifecycleSettlements']>[number]
  ): Promise<void> {
    try {
      if (!this.#deliverLifecycleSettlement) {
        throw new Error('Turn lifecycle settlement consumer is unavailable.')
      }
      await this.#deliverLifecycleSettlement(record.event)
      await this.#outboxOperation(() => this.#outbox.markLifecycleSettlementDelivered(record.key))
    } catch (error) {
      if (this.#outbox.poisonedError) {
        this.#failStop()
        throw error
      }
      const retryAfterMs = Math.min(
        this.#retryMaxMs,
        this.#retryBaseMs * (2 ** Math.min(16, record.attempts))
      )
      await this.#outboxOperation(
        () => this.#outbox.markLifecycleSettlementFailed(record.key, error, retryAfterMs)
      )
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

  async #outboxOperation<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    } catch (error) {
      if (this.#outbox.poisonedError) this.#failStop()
      throw error
    }
  }

  #failStop(): void {
    this.#closed = true
    if (this.#retryTimer) {
      this.#clearTimeout(this.#retryTimer)
      this.#retryTimer = null
    }
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
