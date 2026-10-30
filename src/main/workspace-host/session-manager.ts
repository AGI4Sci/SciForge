import {
  WORKSPACE_HOST_OPERATIONS,
  workspaceHostEventSchema,
  workspaceHostFailureSchema,
  workspaceHostModelAccessAcquireInputSchema,
  workspaceHostModelAccessHeartbeatInputSchema,
  workspaceHostModelAccessLeaseSchema,
  workspaceHostModelAccessLeaseStateSchema,
  workspaceHostModelAccessRevokeInputSchema,
  workspaceHostProviderAttachInputSchema,
  workspaceHostSessionSchema,
  workspaceLocatorSchema,
  type WorkspaceHostClient,
  type WorkspaceHostEvent,
  type WorkspaceHostEventListener,
  type WorkspaceHostFailure,
  type WorkspaceHostModelAccessProvider,
  type WorkspaceHostOperation,
  type WorkspaceHostOperationInput,
  type WorkspaceHostOperationOutput,
  type WorkspaceHostProviderAttachInput,
  type WorkspaceHostRequestOptions,
  type WorkspaceHostSession,
  type WorkspaceLocator
} from '@sciforge/domain-sdk/workspace-host'

import type {
  WorkspaceHostConnectionSnapshot,
  WorkspaceHostPlacement
} from '../../shared/workspace-host-state'
import {
  WorkspaceHostProviderRegistry,
  type RegisteredWorkspaceHostProvider
} from '../modules/workspace-host-contributions'

const DEFAULT_RECONNECT_ATTEMPTS = 4
const DEFAULT_RECONNECT_DELAY_MILLISECONDS = 250
const MAX_RECONNECT_DELAY_MILLISECONDS = 4_000
const DEFAULT_HEALTH_CHECK_INTERVAL_MILLISECONDS = 20_000
const DEFAULT_HEALTH_CHECK_TIMEOUT_MILLISECONDS = 10_000

const unavailableWorkspaceModelAccessProvider: WorkspaceHostModelAccessProvider =
  Object.freeze({
    acquire: async () => null,
    heartbeat: async () => {
      throw new WorkspaceHostSessionManagerError(
        'session-unavailable',
        'Workspace Model Access is unavailable for this session.'
      )
    },
    revoke: () => undefined
  })

export type WorkspaceHostSessionManagerOptions = Readonly<{
  now?: () => Date
  reconnectAttempts?: number
  reconnectDelayMilliseconds?: number
  healthCheckIntervalMilliseconds?: number
  healthCheckTimeoutMilliseconds?: number
  wait?: (milliseconds: number, signal?: AbortSignal) => Promise<void>
  scheduleHealthCheck?: (
    listener: () => void,
    milliseconds: number
  ) => () => void
  workspaceModelAccess?: WorkspaceHostModelAccessProvider
  log?: (input: Readonly<{
    level: 'debug' | 'info' | 'warn' | 'error'
    message: string
    providerId?: string
    ownerId?: string
    ownerDisplayName?: string
    sessionId?: string
    detail?: unknown
  }>) => void
}>

export type WorkspaceHostAttachInput = WorkspaceHostProviderAttachInput & Readonly<{
  providerId: string
  signal?: AbortSignal
}>

export type WorkspaceHostReconnectOptions = Readonly<{
  attempts?: number
  signal?: AbortSignal
}>

export type WorkspaceHostConnectionSnapshotListener = (
  snapshot: WorkspaceHostConnectionSnapshot
) => void

/**
 * Consumer-facing port for workspace services and runtime adapters.
 *
 * It deliberately omits acknowledge/reconnect/close. The session manager is
 * the sole owner of transport replay watermarks and connection lifecycle.
 */
export type WorkspaceHostSessionPort = Readonly<{
  getSession(): WorkspaceHostSession
  getConnectionSnapshot(): WorkspaceHostConnectionSnapshot
  request<Operation extends WorkspaceHostOperation>(
    operation: Operation,
    payload: WorkspaceHostOperationInput<Operation>,
    options?: WorkspaceHostRequestOptions
  ): Promise<WorkspaceHostOperationOutput<Operation>>
  subscribe(listener: WorkspaceHostEventListener): () => void
  subscribeConnection(listener: WorkspaceHostConnectionSnapshotListener): () => void
}>

type ManagedWorkspaceHostSession = {
  provider: RegisteredWorkspaceHostProvider
  client: WorkspaceHostClient
  controller: AbortController
  session: WorkspaceHostSession
  phase: WorkspaceHostConnectionSnapshot['phase']
  lastAcknowledgedSequence: number
  lastObservedSequence: number
  reconnectAttempt?: number
  failure?: WorkspaceHostFailure
  updatedAt: string
  eventListeners: Set<WorkspaceHostEventListener>
  snapshotListeners: Set<WorkspaceHostConnectionSnapshotListener>
  unsubscribeClient: () => void
  eventQueue: Promise<void>
  cancelHealthCheck: () => void
  reconnectPromise?: Promise<WorkspaceHostConnectionSnapshot>
  closed: boolean
}

export class WorkspaceHostSessionManager {
  readonly #sessions = new Map<string, ManagedWorkspaceHostSession>()
  readonly #now: () => Date
  readonly #reconnectAttempts: number
  readonly #reconnectDelayMilliseconds: number
  readonly #healthCheckIntervalMilliseconds: number
  readonly #healthCheckTimeoutMilliseconds: number
  readonly #wait: (milliseconds: number, signal?: AbortSignal) => Promise<void>
  readonly #scheduleHealthCheck: NonNullable<
    WorkspaceHostSessionManagerOptions['scheduleHealthCheck']
  >
  readonly #workspaceModelAccess: WorkspaceHostModelAccessProvider
  readonly #log: NonNullable<WorkspaceHostSessionManagerOptions['log']>
  #disposed = false

  constructor(
    private readonly registry: WorkspaceHostProviderRegistry,
    options: WorkspaceHostSessionManagerOptions = {}
  ) {
    this.#now = options.now ?? (() => new Date())
    this.#reconnectAttempts = positiveInteger(
      options.reconnectAttempts,
      DEFAULT_RECONNECT_ATTEMPTS,
      'reconnectAttempts'
    )
    this.#reconnectDelayMilliseconds = positiveInteger(
      options.reconnectDelayMilliseconds,
      DEFAULT_RECONNECT_DELAY_MILLISECONDS,
      'reconnectDelayMilliseconds'
    )
    this.#healthCheckIntervalMilliseconds = positiveInteger(
      options.healthCheckIntervalMilliseconds,
      DEFAULT_HEALTH_CHECK_INTERVAL_MILLISECONDS,
      'healthCheckIntervalMilliseconds'
    )
    this.#healthCheckTimeoutMilliseconds = positiveInteger(
      options.healthCheckTimeoutMilliseconds,
      DEFAULT_HEALTH_CHECK_TIMEOUT_MILLISECONDS,
      'healthCheckTimeoutMilliseconds'
    )
    this.#wait = options.wait ?? waitFor
    this.#scheduleHealthCheck = options.scheduleHealthCheck ?? scheduleOnce
    this.#workspaceModelAccess = options.workspaceModelAccess ??
      unavailableWorkspaceModelAccessProvider
    this.#log = options.log ?? (() => undefined)
  }

  async attach(input: WorkspaceHostAttachInput): Promise<WorkspaceHostConnectionSnapshot> {
    this.#assertActive()
    const provider = this.registry.require(input.providerId)
    const attachInput = workspaceHostProviderAttachInputSchema.parse({
      authorizedSessionId: input.authorizedSessionId,
      ...(input.resume ? { resume: input.resume } : {})
    })
    const controller = linkedAbortController(input.signal)
    const ownerId = provider.owner.moduleId
    this.#log({
      level: 'info',
      message: 'Attaching Workspace Host provider.',
      providerId: provider.providerId,
      ownerId
    })

    let client: WorkspaceHostClient | undefined
    try {
      client = await provider.provider.attach(attachInput, Object.freeze({
        owner: provider.owner,
        signal: controller.signal,
        workspaceModelAccess: this.#scopedWorkspaceModelAccess(controller.signal),
        log: (entry) => this.#log({
          ...entry,
          providerId: provider.providerId,
          ownerId
        })
      }))
      const session = workspaceHostSessionSchema.parse(client.getSession())
      const existing = this.#sessions.get(session.sessionId)
      if (existing && !existing.closed) {
        throw new WorkspaceHostSessionManagerError(
          'duplicate-session',
          `Workspace Host session ${session.sessionId} is already attached.`
        )
      }
      const managed = this.#createManagedSession(
        provider,
        client,
        controller,
        session,
        attachInput.resume?.lastAcknowledgedSequence
      )
      this.#sessions.set(session.sessionId, managed)
      managed.unsubscribeClient = client.subscribe((event) => {
        managed.eventQueue = managed.eventQueue
          .then(() => this.#acceptEvent(managed, event))
          .catch((error) => this.#handleEventFailure(managed, error))
      })
      this.#publishSnapshot(managed)
      this.#scheduleNextHealthCheck(managed)
      return this.#snapshot(managed)
    } catch (error) {
      controller.abort(error)
      if (client) await client.close('Workspace Host attachment rejected.').catch(() => undefined)
      throw error
    }
  }

  list(): readonly WorkspaceHostConnectionSnapshot[] {
    return Object.freeze([...this.#sessions.values()].map((managed) => this.#snapshot(managed)))
  }

  get(locatorOrSessionId: WorkspaceLocator | string): WorkspaceHostConnectionSnapshot | undefined {
    const managed = this.#sessions.get(sessionIdFrom(locatorOrSessionId))
    return managed ? this.#snapshot(managed) : undefined
  }

  portFor(locator: WorkspaceLocator): WorkspaceHostSessionPort {
    const parsed = workspaceLocatorSchema.parse(locator)
    this.#requireManaged(parsed)
    return Object.freeze({
      getSession: () => this.#requireManaged(parsed).session,
      getConnectionSnapshot: () => this.#snapshot(this.#requireManaged(parsed)),
      request: <Operation extends WorkspaceHostOperation>(
        operation: Operation,
        payload: WorkspaceHostOperationInput<Operation>,
        options?: WorkspaceHostRequestOptions
      ) => this.request(parsed, operation, payload, options),
      subscribe: (listener: WorkspaceHostEventListener) =>
        this.subscribeEvents(parsed, listener),
      subscribeConnection: (listener: WorkspaceHostConnectionSnapshotListener) =>
        this.subscribeSnapshot(parsed, listener)
    })
  }

  async resolvePlacement(locator: WorkspaceLocator): Promise<WorkspaceHostPlacement> {
    const parsed = workspaceLocatorSchema.parse(locator)
    const managed = this.#requireManaged(parsed)
    if (managed.phase !== 'connected') {
      throw new WorkspaceHostSessionManagerError(
        'session-unavailable',
        `Workspace Host session ${parsed.hostSessionId} is ${managed.phase}.`
      )
    }
    return Object.freeze({
      locator: parsed,
      session: managed.session
    })
  }

  request<Operation extends WorkspaceHostOperation>(
    locator: WorkspaceLocator,
    operation: Operation,
    payload: WorkspaceHostOperationInput<Operation>,
    options?: WorkspaceHostRequestOptions
  ): Promise<WorkspaceHostOperationOutput<Operation>> {
    const managed = this.#requireConnected(locator)
    return managed.client.request(operation, payload, options).catch((error) => {
      if (isRetryableTransportFailure(error)) {
        this.#beginAutomaticReconnect(managed, error)
      }
      throw error
    })
  }

  subscribeEvents(
    locatorOrSessionId: WorkspaceLocator | string,
    listener: WorkspaceHostEventListener
  ): () => void {
    const managed = this.#requireManaged(locatorOrSessionId)
    managed.eventListeners.add(listener)
    return () => managed.eventListeners.delete(listener)
  }

  subscribeSnapshot(
    locatorOrSessionId: WorkspaceLocator | string,
    listener: WorkspaceHostConnectionSnapshotListener
  ): () => void {
    const managed = this.#requireManaged(locatorOrSessionId)
    managed.snapshotListeners.add(listener)
    listener(this.#snapshot(managed))
    return () => managed.snapshotListeners.delete(listener)
  }

  async reconnect(
    locatorOrSessionId: WorkspaceLocator | string,
    options: WorkspaceHostReconnectOptions = {}
  ): Promise<WorkspaceHostConnectionSnapshot> {
    this.#assertActive()
    const managed = this.#requireManaged(locatorOrSessionId)
    if (managed.closed) {
      throw new WorkspaceHostSessionManagerError(
        'session-closed',
        `Workspace Host session ${managed.session.sessionId} is closed.`
      )
    }
    const attempts = positiveInteger(
      options.attempts,
      this.#reconnectAttempts,
      'attempts'
    )
    if (managed.reconnectPromise) return managed.reconnectPromise
    const reconnectPromise = this.#performReconnect(managed, attempts, options)
      .finally(() => {
        if (managed.reconnectPromise === reconnectPromise) {
          managed.reconnectPromise = undefined
        }
      })
    managed.reconnectPromise = reconnectPromise
    return reconnectPromise
  }

  async #performReconnect(
    managed: ManagedWorkspaceHostSession,
    attempts: number,
    options: WorkspaceHostReconnectOptions
  ): Promise<WorkspaceHostConnectionSnapshot> {
    const signal = combinedAbortSignal(managed.controller.signal, options.signal)
    managed.cancelHealthCheck()
    managed.cancelHealthCheck = () => undefined
    managed.phase = 'reconnecting'
    managed.lastObservedSequence = managed.lastAcknowledgedSequence
    this.#touch(managed)

    let lastError: unknown
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      throwIfAborted(signal)
      managed.reconnectAttempt = attempt
      this.#touch(managed)
      try {
        const session = workspaceHostSessionSchema.parse(await managed.client.reconnect({
          lastAcknowledgedSequence: managed.lastAcknowledgedSequence,
          signal
        }))
        if (managed.closed) return this.#snapshot(managed)
        this.#assertSameSession(managed, session)
        managed.session = session
        managed.phase = 'connected'
        managed.reconnectAttempt = undefined
        managed.failure = undefined
        this.#touch(managed)
        this.#scheduleNextHealthCheck(managed)
        return this.#snapshot(managed)
      } catch (error) {
        lastError = error
        if (managed.closed) return this.#snapshot(managed)
        if (isReplayGap(error)) {
          managed.phase = 'replay-required'
          managed.failure = failureFrom(error, 'replay-gap')
          managed.reconnectAttempt = undefined
          this.#touch(managed)
          return this.#snapshot(managed)
        }
        if (attempt === attempts || signal.aborted) break
        await this.#wait(reconnectDelayFor(
          this.#reconnectDelayMilliseconds,
          attempt
        ), signal)
      }
    }

    managed.phase = 'failed'
    managed.failure = failureFrom(lastError, 'disconnected')
    managed.reconnectAttempt = undefined
    this.#touch(managed)
    throw new WorkspaceHostSessionManagerError(
      'reconnect-failed',
      managed.failure.message,
      { cause: lastError }
    )
  }

  async close(
    locatorOrSessionId: WorkspaceLocator | string,
    reason?: string
  ): Promise<void> {
    const managed = this.#requireManaged(locatorOrSessionId)
    if (managed.closed) return
    managed.closed = true
    managed.phase = 'closed'
    managed.cancelHealthCheck()
    managed.cancelHealthCheck = () => undefined
    managed.unsubscribeClient()
    managed.controller.abort(reason)
    this.#touch(managed)
    await managed.eventQueue.catch(() => undefined)
    await managed.client.close(reason)
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return
    this.#disposed = true
    const results = await Promise.allSettled(
      [...this.#sessions.values()].map((managed) => (
        managed.closed
          ? Promise.resolve()
          : this.close(managed.session.sessionId, 'Workspace Host manager disposed.')
      ))
    )
    const failures = results
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => result.reason)
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) {
      throw new AggregateError(failures, 'Workspace Host session disposal failed.')
    }
  }

  #createManagedSession(
    provider: RegisteredWorkspaceHostProvider,
    client: WorkspaceHostClient,
    controller: AbortController,
    session: WorkspaceHostSession,
    resumedAcknowledgedSequence?: number
  ): ManagedWorkspaceHostSession {
    const acknowledgedSequence = resumedAcknowledgedSequence ?? session.eventSequence
    return {
      provider,
      client,
      controller,
      session,
      phase: 'connected',
      lastAcknowledgedSequence: acknowledgedSequence,
      lastObservedSequence: acknowledgedSequence,
      updatedAt: this.#now().toISOString(),
      eventListeners: new Set(),
      snapshotListeners: new Set(),
      unsubscribeClient: () => undefined,
      eventQueue: Promise.resolve(),
      cancelHealthCheck: () => undefined,
      closed: false
    }
  }

  #scheduleNextHealthCheck(managed: ManagedWorkspaceHostSession): void {
    managed.cancelHealthCheck()
    managed.cancelHealthCheck = () => undefined
    if (
      this.#disposed ||
      managed.closed ||
      managed.phase !== 'connected'
    ) return
    managed.cancelHealthCheck = this.#scheduleHealthCheck(() => {
      managed.cancelHealthCheck = () => undefined
      void this.#runHealthCheck(managed)
    }, this.#healthCheckIntervalMilliseconds)
  }

  #scopedWorkspaceModelAccess(
    sessionSignal: AbortSignal
  ): WorkspaceHostModelAccessProvider {
    return Object.freeze({
      acquire: async (input) => {
        const { signal, ...parsed } = input
        const request = workspaceHostModelAccessAcquireInputSchema.parse(parsed)
        const lease = await this.#workspaceModelAccess.acquire({
          ...request,
          signal: combinedAbortSignal(sessionSignal, signal)
        })
        return lease ? workspaceHostModelAccessLeaseSchema.parse(lease) : null
      },
      heartbeat: async (input) => workspaceHostModelAccessLeaseStateSchema.parse(
        await this.#workspaceModelAccess.heartbeat(
          workspaceHostModelAccessHeartbeatInputSchema.parse(input)
        )
      ),
      revoke: async (input) => this.#workspaceModelAccess.revoke(
        workspaceHostModelAccessRevokeInputSchema.parse(input)
      )
    })
  }

  async #runHealthCheck(managed: ManagedWorkspaceHostSession): Promise<void> {
    if (
      this.#disposed ||
      managed.closed ||
      managed.phase !== 'connected'
    ) return
    try {
      await managed.client.request(WORKSPACE_HOST_OPERATIONS.health, {}, {
        timeoutMilliseconds: this.#healthCheckTimeoutMilliseconds,
        signal: managed.controller.signal
      })
      this.#scheduleNextHealthCheck(managed)
    } catch (error) {
      if (
        managed.controller.signal.aborted ||
        managed.closed ||
        this.#disposed
      ) return
      this.#beginAutomaticReconnect(managed, error)
    }
  }

  #beginAutomaticReconnect(
    managed: ManagedWorkspaceHostSession,
    error: unknown
  ): void {
    if (
      this.#disposed ||
      managed.closed ||
      managed.phase === 'replay-required' ||
      managed.reconnectPromise
    ) return
    managed.failure = failureFrom(error, 'disconnected')
    void this.reconnect(managed.session.sessionId).catch((reconnectError) => {
      this.#log({
        level: 'warn',
        message: safeErrorMessage(reconnectError),
        providerId: managed.provider.providerId,
        ownerId: managed.provider.owner.moduleId,
        ownerDisplayName: managed.provider.ownerDisplayName,
        sessionId: managed.session.sessionId
      })
    })
  }

  async #acceptEvent(
    managed: ManagedWorkspaceHostSession,
    input: WorkspaceHostEvent
  ): Promise<void> {
    if (managed.closed) return
    if (managed.phase === 'failed' || managed.phase === 'replay-required') return
    const event = workspaceHostEventSchema.parse(input)
    if (event.sessionId !== managed.session.sessionId) {
      throw new WorkspaceHostSessionManagerError(
        'session-mismatch',
        `Workspace Host event belongs to unexpected session ${event.sessionId}.`
      )
    }
    if (event.sequence <= managed.lastAcknowledgedSequence) {
      await acknowledgeOrThrow(managed.client, managed.lastAcknowledgedSequence)
      return
    }
    const expected = managed.lastObservedSequence + 1
    if (event.sequence !== expected) {
      throw new WorkspaceHostSessionManagerError(
        'event-sequence-gap',
        `Expected Workspace Host event sequence ${expected}, received ${event.sequence}.`
      )
    }
    managed.lastObservedSequence = event.sequence
    for (const listener of managed.eventListeners) await listener(event)
    await acknowledgeOrThrow(managed.client, event.sequence)
    managed.lastAcknowledgedSequence = event.sequence
    managed.session = workspaceHostSessionSchema.parse({
      ...managed.session,
      eventSequence: Math.max(managed.session.eventSequence, event.sequence),
      replay: {
        earliestSequence: managed.session.replay.earliestSequence,
        latestSequence: Math.max(managed.session.replay.latestSequence, event.sequence)
      }
    })
    managed.phase = 'connected'
    managed.failure = undefined
    this.#touch(managed)
  }

  #handleEventFailure(managed: ManagedWorkspaceHostSession, error: unknown): void {
    if (managed.closed) return
    managed.lastObservedSequence = managed.lastAcknowledgedSequence
    if (isRetryableTransportFailure(error)) {
      this.#beginAutomaticReconnect(managed, error)
      return
    }
    managed.phase = isSequenceFailure(error) ? 'replay-required' : 'failed'
    managed.failure = failureFrom(
      error,
      isSequenceFailure(error) ? 'replay-gap' : 'disconnected'
    )
    this.#touch(managed)
    this.#log({
      level: 'warn',
      message: managed.failure.message,
      providerId: managed.provider.providerId,
      ownerId: managed.provider.owner.moduleId,
      ownerDisplayName: managed.provider.ownerDisplayName,
      sessionId: managed.session.sessionId
    })
  }

  #requireConnected(locator: WorkspaceLocator): ManagedWorkspaceHostSession {
    const parsed = workspaceLocatorSchema.parse(locator)
    const managed = this.#requireManaged(parsed)
    if (managed.phase !== 'connected') {
      throw new WorkspaceHostSessionManagerError(
        'session-unavailable',
        `Workspace Host session ${parsed.hostSessionId} is ${managed.phase}.`
      )
    }
    return managed
  }

  #requireManaged(
    locatorOrSessionId: WorkspaceLocator | string
  ): ManagedWorkspaceHostSession {
    const sessionId = sessionIdFrom(locatorOrSessionId)
    const managed = this.#sessions.get(sessionId)
    if (!managed) {
      throw new WorkspaceHostSessionManagerError(
        'session-not-found',
        `Workspace Host session ${sessionId} is not attached.`
      )
    }
    return managed
  }

  #assertSameSession(
    managed: ManagedWorkspaceHostSession,
    session: WorkspaceHostSession
  ): void {
    if (
      session.sessionId !== managed.session.sessionId ||
      session.locator.hostSessionId !== managed.session.locator.hostSessionId ||
      session.locator.path !== managed.session.locator.path
    ) {
      throw new WorkspaceHostSessionManagerError(
        'session-mismatch',
        'Workspace Host reconnect returned a different session or workspace locator.'
      )
    }
  }

  #snapshot(managed: ManagedWorkspaceHostSession): WorkspaceHostConnectionSnapshot {
    return Object.freeze({
      providerId: managed.provider.providerId,
      ownerId: managed.provider.owner.moduleId,
      ownerDisplayName: managed.provider.ownerDisplayName,
      locator: managed.session.locator,
      session: managed.session,
      phase: managed.phase,
      lastAcknowledgedSequence: managed.lastAcknowledgedSequence,
      ...(managed.reconnectAttempt === undefined
        ? {}
        : { reconnectAttempt: managed.reconnectAttempt }),
      ...(managed.failure ? { failure: managed.failure } : {}),
      updatedAt: managed.updatedAt
    })
  }

  #touch(managed: ManagedWorkspaceHostSession): void {
    managed.updatedAt = this.#now().toISOString()
    this.#publishSnapshot(managed)
  }

  #publishSnapshot(managed: ManagedWorkspaceHostSession): void {
    const snapshot = this.#snapshot(managed)
    for (const listener of managed.snapshotListeners) listener(snapshot)
  }

  #assertActive(): void {
    if (this.#disposed) {
      throw new WorkspaceHostSessionManagerError(
        'manager-disposed',
        'Workspace Host session manager has been disposed.'
      )
    }
  }
}

export type WorkspaceHostSessionManagerErrorCode =
  | 'acknowledgement-failed'
  | 'duplicate-session'
  | 'event-sequence-gap'
  | 'manager-disposed'
  | 'reconnect-failed'
  | 'session-closed'
  | 'session-mismatch'
  | 'session-not-found'
  | 'session-unavailable'

export class WorkspaceHostSessionManagerError extends Error {
  constructor(
    readonly code: WorkspaceHostSessionManagerErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'WorkspaceHostSessionManagerError'
  }
}

function sessionIdFrom(locatorOrSessionId: WorkspaceLocator | string): string {
  if (typeof locatorOrSessionId === 'string') {
    const sessionId = locatorOrSessionId.trim()
    if (!sessionId) {
      throw new WorkspaceHostSessionManagerError(
        'session-not-found',
        'Workspace Host session ID must be non-empty.'
      )
    }
    return sessionId
  }
  return workspaceLocatorSchema.parse(locatorOrSessionId).hostSessionId
}

function linkedAbortController(signal?: AbortSignal): AbortController {
  const controller = new AbortController()
  if (!signal) return controller
  if (signal.aborted) {
    controller.abort(signal.reason)
    return controller
  }
  signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true })
  return controller
}

function combinedAbortSignal(
  managerSignal: AbortSignal,
  callerSignal?: AbortSignal
): AbortSignal {
  return callerSignal
    ? AbortSignal.any([managerSignal, callerSignal])
    : managerSignal
}

function positiveInteger(
  input: number | undefined,
  fallback: number,
  name: string
): number {
  const value = input ?? fallback
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${name} must be a positive safe integer.`)
  }
  return value
}

function reconnectDelayFor(base: number, attempt: number): number {
  return Math.min(base * (2 ** Math.max(0, attempt - 1)), MAX_RECONNECT_DELAY_MILLISECONDS)
}

function waitFor(milliseconds: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(signal.reason)
    }, { once: true })
  })
}

function scheduleOnce(listener: () => void, milliseconds: number): () => void {
  const timer = setTimeout(listener, milliseconds)
  timer.unref()
  return () => clearTimeout(timer)
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason
}

function isSequenceFailure(error: unknown): boolean {
  return error instanceof WorkspaceHostSessionManagerError &&
    error.code === 'event-sequence-gap'
}

function isReplayGap(error: unknown): boolean {
  const failure = failureRecord(error)
  return failure?.code === 'replay-gap'
}

function isRetryableTransportFailure(error: unknown): boolean {
  if (
    error instanceof WorkspaceHostSessionManagerError &&
    error.code === 'acknowledgement-failed'
  ) return true
  const failure = failureRecord(error)
  if (!failure) return false
  const code = typeof failure.code === 'string' ? failure.code : ''
  if (code === 'cancelled') return false
  if (
    code === 'disconnected' ||
    code === 'deadline-exceeded' ||
    code === 'workspace_server_connection_lost'
  ) return true
  return failure.retryable === true && (
    code.includes('connection') ||
    code.includes('transport')
  )
}

async function acknowledgeOrThrow(
  client: WorkspaceHostClient,
  sequence: number
): Promise<void> {
  try {
    await client.acknowledge(sequence)
  } catch (cause) {
    throw new WorkspaceHostSessionManagerError(
      'acknowledgement-failed',
      safeErrorMessage(cause),
      { cause }
    )
  }
}

function failureFrom(
  error: unknown,
  fallbackCode: WorkspaceHostFailure['code']
): WorkspaceHostFailure {
  const parsed = workspaceHostFailureSchema.safeParse(failureRecord(error) ?? error)
  if (parsed.success) return parsed.data
  return {
    code: fallbackCode,
    message: safeErrorMessage(error),
    retryable: fallbackCode === 'disconnected'
  }
}

function failureRecord(error: unknown): Record<string, unknown> | undefined {
  if (!isRecord(error)) return undefined
  return isRecord(error.failure) ? error.failure : error
}

function safeErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  const trimmed = raw.trim() || 'Workspace Host operation failed.'
  return trimmed.slice(0, 2_000)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
