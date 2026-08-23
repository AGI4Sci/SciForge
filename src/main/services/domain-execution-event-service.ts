import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'

import {
  DOMAIN_EXECUTION_EVENT_VERSION,
  canonicalizeReproValue,
  domainExecutionEventSchema,
  type DomainExecutionEventInput,
  type DomainExecutionEventV1
} from '@sciforge/domain-sdk/reproducibility'
import type { DomainPackageJsonValue } from '@sciforge/domain-sdk/contract'
import type {
  DomainArtifactConsumer,
  DomainExecutionArtifactEvent,
  DomainMainExecutionEventsRouter,
  DomainRuntimeContributionOwner
} from '@sciforge/domain-sdk/host'
import {
  deriveExecutionTraceId,
  type TraceEvent,
  type TraceEventInput
} from '@sciforge/full-trace'
import type {
  DomainExecutionOutboxRecord
} from './domain-execution-event-outbox'

export type DomainExecutionTraceSink = Readonly<{
  append: (input: TraceEventInput<'execution_event'>) => Promise<TraceEvent>
}>

export type DomainExecutionEventServiceOptions = Readonly<{
  trace: DomainExecutionTraceSink
  consumers: readonly DomainArtifactConsumer[]
  outbox?: Readonly<{
    load: () => Promise<void>
    enqueue: (
      event: DomainExecutionEventV1,
      options?: Readonly<{ workspaceBound?: boolean }>
    ) => Promise<DomainExecutionEventV1>
    ready: (now?: number) => readonly DomainExecutionOutboxRecord[]
    nextAttemptAt: () => number | null
    record: (eventId: string) => DomainExecutionOutboxRecord | undefined
    markTraceRecorded: (eventId: string) => Promise<void>
    markDelivered: (eventId: string) => Promise<void>
    markFailed: (eventId: string, error: unknown, retryAfterMs: number) => Promise<void>
  }>
  now?: () => Date
  createEventId?: () => string
  /** Host-private capability caller scope; absent means workspace is unbound. */
  resolveCallerWorkspace?: () => string | undefined
  retryBaseMs?: number
  retryMaxMs?: number
  log?: (level: 'warn' | 'error', message: string, detail?: unknown) => void
  setTimeout?: typeof setTimeout
  clearTimeout?: typeof clearTimeout
}>

/**
 * Canonical bridge from package-owned executions to Full Trace and the DAG
 * artifact stream. Trace persistence always completes before fan-out.
 */
export class DomainExecutionEventService implements DomainMainExecutionEventsRouter {
  readonly #trace: DomainExecutionTraceSink
  readonly #consumers: readonly DomainArtifactConsumer[]
  readonly #outbox?: NonNullable<DomainExecutionEventServiceOptions['outbox']>
  readonly #now: () => Date
  readonly #createEventId: () => string
  readonly #resolveCallerWorkspace?: () => string | undefined
  readonly #retryBaseMs: number
  readonly #retryMaxMs: number
  readonly #log?: DomainExecutionEventServiceOptions['log']
  readonly #setTimeout: typeof setTimeout
  readonly #clearTimeout: typeof clearTimeout
  #deliveryQueue: Promise<void> = Promise.resolve()
  #deliveryStarted: boolean
  #deliveryStart: Promise<void> | null = null
  #retryTimer: ReturnType<typeof setTimeout> | null = null
  #nextInMemorySequence = 1
  readonly #inMemoryTerminalKeys = new Map<string, string>()
  readonly #inMemoryEventIntents = new Map<string, Readonly<{
    intent: string
    sequence: number
  }>>()
  #closed = false

  constructor(options: DomainExecutionEventServiceOptions) {
    this.#trace = options.trace
    this.#consumers = Object.freeze([...options.consumers])
    this.#outbox = options.outbox
    this.#deliveryStarted = !this.#outbox
    this.#now = options.now ?? (() => new Date())
    this.#createEventId = options.createEventId ?? (() => `execution-event-${randomUUID()}`)
    this.#resolveCallerWorkspace = options.resolveCallerWorkspace
    this.#retryBaseMs = positiveDuration(options.retryBaseMs ?? 1_000, 'retryBaseMs')
    this.#retryMaxMs = positiveDuration(options.retryMaxMs ?? 60_000, 'retryMaxMs')
    if (this.#retryMaxMs < this.#retryBaseMs) {
      throw new TypeError('retryMaxMs must be greater than or equal to retryBaseMs.')
    }
    this.#log = options.log
    this.#setTimeout = options.setTimeout ?? setTimeout
    this.#clearTimeout = options.clearTimeout ?? clearTimeout
  }

  async publish(
    owner: DomainRuntimeContributionOwner,
    input: DomainExecutionEventInput
  ): Promise<DomainExecutionEventV1> {
    if (this.#closed) throw new Error('Domain execution event service is closed.')
    assertOwnedExecutionScope(owner.moduleId, input.scope)
    const workspaceBinding = this.#bindWorkspace(input.workspaceRoot)
    const { workspaceRoot: _claimedWorkspaceRoot, ...packageInput } = input
    const occurredAt = input.occurredAt?.trim() || this.#now().toISOString()
    const traceId = input.traceId?.trim() || deriveExecutionTraceId({
      moduleId: owner.moduleId,
      executionId: input.executionId
    })
    const event = deepFreeze(domainExecutionEventSchema.parse({
      ...packageInput,
      schemaVersion: DOMAIN_EXECUTION_EVENT_VERSION,
      eventId: input.eventId?.trim() || this.#createEventId(),
      producer: owner,
      ...(workspaceBinding.workspaceRoot
        ? { workspaceRoot: workspaceBinding.workspaceRoot }
        : {}),
      occurredAt,
      traceId
    }))

    if (event.phase === 'run_completed' || event.phase === 'run_failed') {
      if (!this.#outbox) {
        const sequence = this.#acceptInMemoryTerminal(event)
        await this.#appendTrace(event)
        await this.#publishCompleted(event, sequence, workspaceBinding.bound)
      } else {
        // Durable enqueue is the package-visible acceptance boundary. Full
        // Trace and consumer delivery continue in the Host-owned retry loop.
        const accepted = await this.#outbox.enqueue(event, {
          workspaceBound: workspaceBinding.bound
        })
        this.#scheduleReplay()
        return accepted
      }
    } else {
      await this.#appendTrace(event)
    }
    return event
  }

  /** Idempotently opens durable delivery after every artifact consumer is active. */
  async startDelivery(): Promise<void> {
    if (this.#closed) return
    if (this.#deliveryStart) return this.#deliveryStart
    this.#deliveryStarted = true
    const pending = this.replayPending()
    this.#deliveryStart = pending
    try {
      await pending
    } catch (error) {
      this.#scheduleReplay(this.#retryBaseMs)
      throw error
    } finally {
      if (this.#deliveryStart === pending) this.#deliveryStart = null
    }
  }

  /** Replays every due terminal event retained after a partial/failed fan-out. */
  async replayPending(): Promise<void> {
    if (this.#closed || !this.#deliveryStarted || !this.#outbox) return
    await this.#serializeDelivery(async () => {
      await this.#outbox!.load()
      if (this.#closed || !this.#deliveryStarted) return
      const failures: unknown[] = []
      for (const record of this.#outbox!.ready()) {
        try {
          await this.#process(record)
        } catch (error) {
          failures.push(error)
        }
      }
      this.#scheduleReplay()
      if (failures.length > 0) {
        throw new AggregateError(failures, 'Pending domain execution fan-out failed.')
      }
    })
  }

  async close(): Promise<void> {
    this.#closed = true
    if (this.#retryTimer) {
      this.#clearTimeout(this.#retryTimer)
      this.#retryTimer = null
    }
    await this.#deliveryStart?.catch(() => undefined)
    await this.#deliveryQueue.catch(() => undefined)
  }

  async #process(record: DomainExecutionOutboxRecord): Promise<void> {
    const { event } = record
    try {
      if (!record.traceRecorded) {
        await this.#appendTrace(event)
        await this.#outbox!.markTraceRecorded(event.eventId)
      }
      await this.#publishCompleted(event, record.sequence, record.workspaceBound)
      await this.#outbox!.markDelivered(event.eventId)
      this.#scheduleReplay()
    } catch (error) {
      const retryAfterMs = Math.min(
        this.#retryMaxMs,
        this.#retryBaseMs * (2 ** Math.min(16, record.attempts))
      )
      await this.#outbox!.markFailed(event.eventId, error, retryAfterMs)
      this.#scheduleReplay()
      throw error
    }
  }

  async #appendTrace(event: DomainExecutionEventV1): Promise<void> {
    await this.#trace.append({
      eventId: event.eventId,
      traceId: event.traceId?.trim() || deriveExecutionTraceId({
        moduleId: event.producer.moduleId,
        executionId: event.executionId
      }),
      source: `domain-execution:${event.producer.moduleId}`,
      kind: 'execution_event',
      timestamp: event.occurredAt,
      ...(event.scope?.runtimeId ? { runtimeId: event.scope.runtimeId } : {}),
      ...(event.scope?.threadId ? { threadId: event.scope.threadId } : {}),
      ...(event.scope?.turnId ? { turnId: event.scope.turnId } : {}),
      payload: {
        schemaVersion: event.schemaVersion,
        phase: event.phase,
        producer: event.producer,
        executionId: event.executionId,
        runId: event.runId,
        ...(event.activityId ? { activityId: event.activityId } : {}),
        ...(event.specDigest ? { specDigest: event.specDigest } : {}),
        ...(event.rerunOfRunId ? { rerunOfRunId: event.rerunOfRunId } : {}),
        event
      }
    })
  }

  async #publishCompleted(
    event: DomainExecutionEventV1,
    sequence: number,
    workspaceBound: boolean
  ): Promise<void> {
    if (this.#consumers.length === 0) return
    const consumerEvent = executionEventForConsumer(event, workspaceBound)
    const artifactEvent: DomainExecutionArtifactEvent = Object.freeze({
      contractVersion: 1,
      kind: 'execution-completed',
      hostBinding: Object.freeze({
        contractVersion: 1,
        acceptanceSequence: sequence,
        workspaceBinding: workspaceBound ? 'capability-caller' : 'unbound',
        ...(workspaceBound && consumerEvent.workspaceRoot
          ? { workspaceRoot: consumerEvent.workspaceRoot }
          : {})
      }),
      producer: Object.freeze({ ...consumerEvent.producer }),
      executionId: consumerEvent.executionId,
      runId: consumerEvent.runId,
      ...(consumerEvent.activityId ? { activityId: consumerEvent.activityId } : {}),
      // Evidence coalesces events in one stable workflow/thread scope. The
      // Host acceptance sequence is authoritative; producer timestamps are
      // descriptive data and cannot move the committed watermark forward.
      targetWatermark: executionArtifactWatermark(sequence, consumerEvent.eventId),
      ...(consumerEvent.scope?.runtimeId ? { runtimeId: consumerEvent.scope.runtimeId } : {}),
      ...(consumerEvent.scope?.threadId ? { threadId: consumerEvent.scope.threadId } : {}),
      ...(consumerEvent.scope?.turnId ? { turnId: consumerEvent.scope.turnId } : {}),
      ...(workspaceBound && consumerEvent.workspaceRoot
        ? { workspaceRoot: consumerEvent.workspaceRoot }
        : {}),
      occurredAt: consumerEvent.occurredAt,
      artifacts: Object.freeze([consumerEvent, ...consumerEvent.artifacts])
    })
    const results = await Promise.allSettled(
      this.#consumers.map((consumer) => consumer.consume(artifactEvent))
    )
    const failures = results.flatMap((result) => result.status === 'rejected' ? [result.reason] : [])
    if (failures.length > 0) {
      this.#log?.('error', 'A completed domain execution could not reach every artifact consumer.', {
        eventId: event.eventId,
        failures
      })
      throw new AggregateError(failures, 'Domain execution artifact fan-out failed.')
    }
  }

  #bindWorkspace(claimedWorkspace: string | undefined): Readonly<{
    bound: boolean
    workspaceRoot?: string
  }> {
    const callerWorkspace = this.#resolveCallerWorkspace?.()?.trim()
    if (!callerWorkspace) return Object.freeze({ bound: false })
    const claimed = claimedWorkspace?.trim()
    if (claimed && resolve(claimed) !== resolve(callerWorkspace)) {
      throw new Error('Domain execution workspace does not match the capability caller workspace.')
    }
    return Object.freeze({ bound: true, workspaceRoot: callerWorkspace })
  }

  #acceptInMemoryTerminal(event: DomainExecutionEventV1): number {
    const intent = canonicalizeReproValue(event as unknown as DomainPackageJsonValue)
    const accepted = this.#inMemoryEventIntents.get(event.eventId)
    if (accepted !== undefined && accepted.intent !== intent) {
      throw new Error(`Domain execution eventId collision: ${event.eventId}`)
    }
    if (accepted !== undefined) return accepted.sequence
    const terminalKey = [
      event.producer.moduleId,
      event.executionId,
      event.runId
    ].join('\u0000')
    const acceptedEventId = this.#inMemoryTerminalKeys.get(terminalKey)
    if (acceptedEventId !== undefined && acceptedEventId !== event.eventId) {
      throw new Error(
        `Domain execution terminal collision for ${event.producer.moduleId}:${event.executionId}:${event.runId} (${acceptedEventId} vs ${event.eventId}).`
      )
    }
    const sequence = this.#nextInMemorySequence
    this.#nextInMemorySequence += 1
    this.#inMemoryEventIntents.set(event.eventId, Object.freeze({ intent, sequence }))
    this.#inMemoryTerminalKeys.set(terminalKey, event.eventId)
    return sequence
  }

  async #serializeDelivery<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.#deliveryQueue.then(operation, operation)
    this.#deliveryQueue = pending.then(() => undefined, () => undefined)
    return pending
  }

  #scheduleReplay(fallbackDelayMs?: number): void {
    if (this.#closed || !this.#deliveryStarted || !this.#outbox) return
    if (fallbackDelayMs !== undefined && this.#retryTimer) return
    const nextAttemptAt = fallbackDelayMs === undefined
      ? this.#outbox.nextAttemptAt()
      : Date.now() + fallbackDelayMs
    if (this.#retryTimer) {
      this.#clearTimeout(this.#retryTimer)
      this.#retryTimer = null
    }
    if (nextAttemptAt === null) return
    this.#retryTimer = this.#setTimeout(() => {
      this.#retryTimer = null
      void this.replayPending().catch((error) => {
        this.#log?.('error', 'Durable domain execution fan-out retry failed.', error)
        this.#scheduleReplay(this.#retryBaseMs)
      })
    }, Math.max(0, nextAttemptAt - Date.now()))
    this.#retryTimer.unref?.()
  }
}

function executionEventForConsumer(
  event: DomainExecutionEventV1,
  workspaceBound: boolean
): DomainExecutionEventV1 {
  if (workspaceBound || !event.workspaceRoot) return event
  const { workspaceRoot: _untrustedWorkspace, ...unbound } = event
  return deepFreeze(domainExecutionEventSchema.parse(unbound))
}

function assertOwnedExecutionScope(
  producerModuleId: string,
  scope: DomainExecutionEventInput['scope']
): void {
  const producer = producerModuleId.trim()
  const runtimeId = scope?.runtimeId?.trim()
  const threadId = scope?.threadId?.trim()
  if (Boolean(runtimeId) !== Boolean(threadId)) {
    throw new Error('Domain execution scope must bind runtimeId and threadId together.')
  }
  if (
    runtimeId &&
    runtimeId !== producer &&
    runtimeId !== `domain:${producer}`
  ) {
    throw new Error('Domain execution scope is not owned by its producer module.')
  }
}

function executionArtifactWatermark(sequence: number, eventId: string): string {
  if (!Number.isSafeInteger(sequence) || sequence <= 0) {
    throw new Error('Domain execution acceptance sequence must be a positive safe integer.')
  }
  return `${sequence}:${eventId}`
}

function positiveDuration(value: number, field: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${field} must be a positive duration.`)
  }
  return value
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}
