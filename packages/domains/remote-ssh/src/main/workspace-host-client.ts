import { randomUUID } from 'node:crypto'
import {
  WORKSPACE_HOST_LIMITS,
  WORKSPACE_HOST_PROTOCOL_VERSION,
  workspaceHostEventSchema,
  workspaceHostAcknowledgeSchema,
  workspaceHostEgressRenewSchema,
  workspaceHostEgressRevokeSchema,
  workspaceHostHandshakeRequestSchema,
  workspaceHostHandshakeResponseSchema,
  workspaceHostModelAccessRenewSchema,
  workspaceHostModelAccessRevokeSchema,
  workspaceHostOperationSchema,
  workspaceHostPayloadSchema,
  workspaceHostRequestSchema,
  workspaceHostResponseSchema,
  type WorkspaceHostClient,
  type WorkspaceHostContributionCohort,
  type WorkspaceHostEvent,
  type WorkspaceHostEventListener,
  type WorkspaceHostEgressAccess,
  type WorkspaceHostFailure,
  type WorkspaceHostHandshakeRequest,
  type WorkspaceHostOperation,
  type WorkspaceHostOperationInput,
  type WorkspaceHostOperationOutput,
  type WorkspaceHostPayload,
  type WorkspaceHostModelAccess,
  type WorkspaceHostReconnectInput,
  type WorkspaceHostRequestOptions,
  type WorkspaceHostResume,
  type WorkspaceHostSession
} from '@sciforge/domain-sdk/workspace-host'
import type {
  RemoteSshStreamingProcess
} from './process-runner.js'
import {
  RemoteWorkspaceSshError
} from './workspace-server-deployment.js'

const MAX_WIRE_LINE_BYTES = WORKSPACE_HOST_LIMITS.maxPayloadBytes + 64 * 1024
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000

export type RemoteWorkspaceHostConnectionFactory = (
  input: Readonly<{ resume?: WorkspaceHostResume; signal?: AbortSignal }>
) => Promise<
  RemoteSshStreamingProcess |
  Readonly<{
    process: RemoteSshStreamingProcess
    egressAccess: WorkspaceHostEgressAccess
    modelAccess?: WorkspaceHostModelAccess
    sensitiveAccess?: RemoteWorkspaceHostSensitiveAccessController
  }>
>

export type RemoteWorkspaceHostSensitiveAccessController = Readonly<{
  bind(input: Readonly<{
    sessionId: string
    renewEgress(expiresAt: string): Promise<void>
    revokeEgress(): Promise<void>
    renewModelAccess(expiresAt: string): Promise<void>
    revokeModelAccess(): Promise<void>
  }>): void
}>

export type RemoteWorkspaceHostClientLog = (
  entry: Readonly<{
    level: 'debug' | 'info' | 'warn' | 'error'
    message: string
  }>
) => void

export type RemoteWorkspaceHostClientOptions = Readonly<{
  clientVersion: string
  workspaceRoot: string
  contributions: readonly WorkspaceHostContributionCohort[]
  egressMode: 'none' | 'local' | 'remote-target'
  egressAccess?: WorkspaceHostEgressAccess
  connect: RemoteWorkspaceHostConnectionFactory
  resume?: WorkspaceHostResume
  signal?: AbortSignal
  log?: RemoteWorkspaceHostClientLog
}>

export class RemoteWorkspaceHostRequestError extends Error {
  readonly failure: WorkspaceHostFailure

  constructor(failure: WorkspaceHostFailure) {
    super(failure.message)
    this.name = 'RemoteWorkspaceHostRequestError'
    this.failure = failure
  }
}

export async function connectRemoteWorkspaceHostClient(
  options: RemoteWorkspaceHostClientOptions
): Promise<WorkspaceHostClient> {
  const client = new RemoteWorkspaceHostClient(options)
  await client.initialize(options.resume, options.signal)
  return client
}

class RemoteWorkspaceHostClient implements WorkspaceHostClient {
  private readonly listeners = new Set<WorkspaceHostEventListener>()
  private readonly pending = new Map<string, PendingRequest>()
  private readonly connectFactory: RemoteWorkspaceHostConnectionFactory
  private readonly handshakeBase: Omit<WorkspaceHostHandshakeRequest, 'resume'>
  private readonly defaultEgressAccess: WorkspaceHostEgressAccess
  private readonly log: RemoteWorkspaceHostClientLog
  private process?: RemoteSshStreamingProcess
  private session?: WorkspaceHostSession
  private writeQueue: Promise<void> = Promise.resolve()
  private reconnecting?: Promise<WorkspaceHostSession>
  private lastAcknowledgedSequence = 0
  private lastObservedSequence = 0
  private generation = 0
  private closed = false

  constructor(options: RemoteWorkspaceHostClientOptions) {
    this.connectFactory = options.connect
    this.log = options.log ?? (() => undefined)
    const handshake = workspaceHostHandshakeRequestSchema.parse({
      protocolVersion: WORKSPACE_HOST_PROTOCOL_VERSION,
      clientVersion: options.clientVersion,
      workspaceRoot: options.workspaceRoot,
      contributions: options.contributions,
      egressMode: options.egressMode,
      ...(options.egressAccess ? { egressAccess: options.egressAccess } : {})
    })
    const { egressAccess, ...handshakeBase } = handshake
    this.handshakeBase = handshakeBase
    this.defaultEgressAccess = egressAccess ?? { mode: 'none' }
  }

  getSession(): WorkspaceHostSession {
    if (!this.session) throw disconnectedError('Remote Workspace session is not connected.')
    return this.session
  }

  async request<Operation extends WorkspaceHostOperation>(
    operation: Operation,
    payload: WorkspaceHostOperationInput<Operation>,
    options: WorkspaceHostRequestOptions = {}
  ): Promise<WorkspaceHostOperationOutput<Operation>> {
    this.assertOpen()
    const session = this.getSession()
    const requestId = options.requestId ?? `whreq_${randomUUID().replaceAll('-', '')}`
    if (this.pending.has(requestId)) {
      throw new Error(`Workspace Host request ID is already active: ${requestId}`)
    }
    const request = workspaceHostRequestSchema.parse({
      protocolVersion: WORKSPACE_HOST_PROTOCOL_VERSION,
      sessionId: session.sessionId,
      requestId,
      operation: workspaceHostOperationSchema.parse(operation),
      payload: workspaceHostPayloadSchema.parse(payload as WorkspaceHostPayload),
      ...(options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
      ...(options.expectedRevision ? { expectedRevision: options.expectedRevision } : {})
    })
    const timeoutMs = options.timeoutMilliseconds ?? DEFAULT_REQUEST_TIMEOUT_MS
    if (
      !Number.isInteger(timeoutMs) ||
      timeoutMs < 1 ||
      timeoutMs > WORKSPACE_HOST_LIMITS.maxRequestTimeoutMilliseconds
    ) {
      throw new Error('Workspace Host request timeout is outside the supported range.')
    }
    if (options.signal?.aborted) throw cancelledError()

    const response = new Promise<WorkspaceHostPayload>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId)
        reject(new RemoteWorkspaceHostRequestError({
          code: 'deadline-exceeded',
          message: 'Workspace Host request timed out.',
          retryable: true
        }))
      }, timeoutMs)
      timeout.unref?.()
      const onAbort = () => {
        this.pending.delete(requestId)
        clearTimeout(timeout)
        reject(cancelledError())
      }
      options.signal?.addEventListener('abort', onAbort, { once: true })
      this.pending.set(requestId, {
        resolve,
        reject,
        dispose: () => {
          clearTimeout(timeout)
          options.signal?.removeEventListener('abort', onAbort)
        }
      })
    })

    try {
      await this.writeLine(request)
    } catch (error) {
      const pending = this.pending.get(requestId)
      this.pending.delete(requestId)
      pending?.dispose()
      pending?.reject(error)
    }
    return response as Promise<WorkspaceHostOperationOutput<Operation>>
  }

  subscribe(listener: WorkspaceHostEventListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async acknowledge(sequence: number): Promise<void> {
    if (
      !Number.isSafeInteger(sequence) ||
      sequence < this.lastAcknowledgedSequence ||
      sequence > this.lastObservedSequence
    ) {
      throw new Error('Workspace Host acknowledgement is outside the observed event range.')
    }
    await this.writeLine(workspaceHostAcknowledgeSchema.parse({
      protocolVersion: WORKSPACE_HOST_PROTOCOL_VERSION,
      sessionId: this.getSession().sessionId,
      sequence
    }))
    this.lastAcknowledgedSequence = Math.max(this.lastAcknowledgedSequence, sequence)
  }

  reconnect(input: WorkspaceHostReconnectInput): Promise<WorkspaceHostSession> {
    this.assertOpen()
    if (this.reconnecting) return this.reconnecting
    const current = this.getSession()
    if (
      !Number.isSafeInteger(input.lastAcknowledgedSequence) ||
      input.lastAcknowledgedSequence < 0 ||
      input.lastAcknowledgedSequence > this.lastObservedSequence
    ) {
      return Promise.reject(new Error(
        'Workspace Host reconnect acknowledgement is outside the observed event range.'
      ))
    }
    this.reconnecting = this.replaceConnection({
      sessionId: current.sessionId,
      lastAcknowledgedSequence: input.lastAcknowledgedSequence
    }, input.signal).finally(() => {
      this.reconnecting = undefined
    })
    return this.reconnecting
  }

  async close(reason?: string): Promise<void> {
    if (this.closed) return
    if (reason !== undefined && (reason.trim().length < 1 ||
      reason.length > WORKSPACE_HOST_LIMITS.maxCloseReasonCharacters)) {
      throw new Error('Workspace Host close reason is invalid.')
    }
    this.closed = true
    this.rejectPending(disconnectedError(reason ?? 'Remote Workspace session was closed.'))
    const process = this.process
    this.process = undefined
    this.session = undefined
    if (process) await process.dispose()
  }

  async initialize(resume?: WorkspaceHostResume, signal?: AbortSignal): Promise<void> {
    await this.establishConnection(resume, signal)
  }

  private async replaceConnection(
    resume: WorkspaceHostResume,
    signal?: AbortSignal
  ): Promise<WorkspaceHostSession> {
    const previous = this.process
    this.process = undefined
    this.session = undefined
    this.rejectPending(disconnectedError('Remote Workspace connection is reconnecting.'))
    if (previous) await previous.dispose()
    return this.establishConnection(resume, signal)
  }

  private async establishConnection(
    resume?: WorkspaceHostResume,
    signal?: AbortSignal
  ): Promise<WorkspaceHostSession> {
    if (signal?.aborted) throw cancelledError()
    const generation = ++this.generation
    const connected = await this.connectFactory({
      ...(resume ? { resume } : {}),
      ...(signal ? { signal } : {})
    })
    const process = isRemoteWorkspaceConnection(connected)
      ? connected.process
      : connected
    const egressAccess = isRemoteWorkspaceConnection(connected)
      ? connected.egressAccess
      : this.defaultEgressAccess
    const modelAccess = isRemoteWorkspaceConnection(connected)
      ? connected.modelAccess
      : undefined
    if (this.closed || generation !== this.generation) {
      await process.dispose()
      throw disconnectedError('Remote Workspace connection was superseded.')
    }
    this.process = process

    const firstLine = deferred<unknown>()
    const pendingEnvelopes: unknown[] = []
    let lineBuffer = Buffer.alloc(0)
    let handshaken = false
    let wireReady = false
    process.stdout.on('data', (chunk: Buffer | string) => {
      if (generation !== this.generation) return
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      lineBuffer = Buffer.concat([lineBuffer, bytes])
      if (lineBuffer.byteLength > MAX_WIRE_LINE_BYTES && !lineBuffer.includes(0x0a)) {
        firstLine.reject(protocolError('Workspace Host wire line exceeds its limit.'))
        void process.dispose()
        return
      }
      while (true) {
        const newline = lineBuffer.indexOf(0x0a)
        if (newline < 0) break
        const line = lineBuffer.subarray(0, newline)
        lineBuffer = lineBuffer.subarray(newline + 1)
        if (line.byteLength === 0) continue
        if (line.byteLength > MAX_WIRE_LINE_BYTES) {
          firstLine.reject(protocolError('Workspace Host wire line exceeds its limit.'))
          void process.dispose()
          return
        }
        let decoded: unknown
        try {
          decoded = JSON.parse(line.toString('utf8'))
        } catch {
          firstLine.reject(protocolError('Workspace Host emitted invalid JSON.'))
          void process.dispose()
          return
        }
        if (!handshaken) {
          handshaken = true
          firstLine.resolve(decoded)
        } else if (!wireReady) {
          pendingEnvelopes.push(decoded)
        } else {
          this.acceptEnvelope(decoded, generation)
        }
      }
    })
    let diagnosticBytes = 0
    process.stderr.on('data', (chunk: Buffer | string) => {
      if (generation !== this.generation || diagnosticBytes >= 32_768) return
      const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk
      const remaining = 32_768 - diagnosticBytes
      const bounded = text.slice(0, remaining)
      diagnosticBytes += Buffer.byteLength(bounded)
      this.log({ level: 'warn', message: `Workspace server: ${bounded}` })
    })
    void process.exit.then((exit) => {
      if (generation !== this.generation || this.closed) return
      const error = disconnectedError(
        `Remote Workspace transport closed (code ${String(exit.exitCode)}, signal ${String(exit.signal)}).`
      )
      firstLine.reject(error)
      this.rejectPending(error)
    }, (cause) => {
      if (generation !== this.generation || this.closed) return
      const error = new RemoteWorkspaceSshError(
        'workspace_server_connection_lost',
        'Remote Workspace transport failed.',
        { retryable: true, cause }
      )
      firstLine.reject(error)
      this.rejectPending(error)
    })

    const handshake = workspaceHostHandshakeRequestSchema.parse({
      ...this.handshakeBase,
      egressAccess,
      ...(modelAccess ? { modelAccess } : {}),
      ...(resume ? { resume } : {})
    })
    await this.writeLine(handshake)
    let response: ReturnType<typeof workspaceHostHandshakeResponseSchema.parse>
    try {
      response = workspaceHostHandshakeResponseSchema.parse(await firstLine.promise)
    } catch (cause) {
      await process.dispose()
      throw new RemoteWorkspaceSshError(
        'workspace_server_incompatible',
        'Workspace Host handshake response is invalid.',
        { cause }
      )
    }
    if (!response.ok) {
      await process.dispose()
      throw new RemoteWorkspaceHostRequestError(response.failure)
    }
    this.session = response.session
    if (isRemoteWorkspaceConnection(connected)) {
      connected.sensitiveAccess?.bind({
        sessionId: response.session.sessionId,
        renewEgress: (expiresAt) => this.writeLineToProcess(
          process,
          workspaceHostEgressRenewSchema.parse({
            protocolVersion: WORKSPACE_HOST_PROTOCOL_VERSION,
            sessionId: response.session.sessionId,
            control: 'egress-renew',
            expiresAt
          })
        ),
        revokeEgress: () => this.writeLineToProcess(
          process,
          workspaceHostEgressRevokeSchema.parse({
            protocolVersion: WORKSPACE_HOST_PROTOCOL_VERSION,
            sessionId: response.session.sessionId,
            control: 'egress-revoke'
          })
        ),
        renewModelAccess: (expiresAt) => this.writeLineToProcess(
          process,
          workspaceHostModelAccessRenewSchema.parse({
            protocolVersion: WORKSPACE_HOST_PROTOCOL_VERSION,
            sessionId: response.session.sessionId,
            control: 'model-access-renew',
            expiresAt
          })
        ),
        revokeModelAccess: () => this.writeLineToProcess(
          process,
          workspaceHostModelAccessRevokeSchema.parse({
            protocolVersion: WORKSPACE_HOST_PROTOCOL_VERSION,
            sessionId: response.session.sessionId,
            control: 'model-access-revoke'
          })
        )
      })
    }
    this.lastObservedSequence =
      resume?.lastAcknowledgedSequence ?? response.session.eventSequence
    this.lastAcknowledgedSequence =
      resume?.lastAcknowledgedSequence ?? response.session.eventSequence
    wireReady = true
    for (const envelope of pendingEnvelopes) this.acceptEnvelope(envelope, generation)
    return response.session
  }

  private acceptEnvelope(value: unknown, generation: number): void {
    if (generation !== this.generation || this.closed) return
    try {
      if (isRecord(value) && Object.hasOwn(value, 'requestId')) {
        const response = workspaceHostResponseSchema.parse(value)
        if (response.sessionId !== this.getSession().sessionId) {
          void this.abortProtocol('Workspace Host response belongs to another session.')
          return
        }
        const pending = this.pending.get(response.requestId)
        if (!pending) return
        this.pending.delete(response.requestId)
        pending.dispose()
        if (response.ok) pending.resolve(response.result)
        else pending.reject(new RemoteWorkspaceHostRequestError(response.failure))
        return
      }
      const event = workspaceHostEventSchema.parse(value)
      if (
        event.sessionId !== this.getSession().sessionId ||
        event.sequence <= this.lastObservedSequence
      ) {
        void this.abortProtocol('Workspace Host event sequence or session is invalid.')
        return
      }
      this.lastObservedSequence = event.sequence
      for (const listener of this.listeners) {
        void Promise.resolve(listener(event)).catch((cause) => {
          this.log({
            level: 'error',
            message: cause instanceof Error
              ? `Workspace Host event listener failed: ${cause.message}`
              : 'Workspace Host event listener failed.'
          })
        })
      }
    } catch {
      void this.abortProtocol('Workspace Host emitted an invalid response or event envelope.')
    }
  }

  private async abortProtocol(message: string): Promise<void> {
    const error = protocolError(message)
    this.rejectPending(error)
    const process = this.process
    this.process = undefined
    this.session = undefined
    if (process) await process.dispose()
  }

  private writeLine(value: unknown): Promise<void> {
    const process = this.process
    if (!process) return Promise.reject(disconnectedError('Remote Workspace is disconnected.'))
    return this.writeLineToProcess(process, value)
  }

  private writeLineToProcess(
    process: RemoteSshStreamingProcess,
    value: unknown
  ): Promise<void> {
    const encoded = `${JSON.stringify(value)}\n`
    if (Buffer.byteLength(encoded) > MAX_WIRE_LINE_BYTES) {
      return Promise.reject(protocolError('Workspace Host request exceeds the wire limit.'))
    }
    const write = this.writeQueue.then(() => process.write(encoded))
    this.writeQueue = write.catch(() => undefined)
    return write
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.dispose()
      pending.reject(error)
    }
    this.pending.clear()
  }

  private assertOpen(): void {
    if (this.closed) throw disconnectedError('Remote Workspace client is closed.')
  }
}

type PendingRequest = Readonly<{
  resolve(value: WorkspaceHostPayload): void
  reject(error: unknown): void
  dispose(): void
}>

function deferred<Value>(): Readonly<{
  promise: Promise<Value>
  resolve(value: Value): void
  reject(error: unknown): void
}> {
  let resolve!: (value: Value) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<Value>((accept, decline) => {
    resolve = accept
    reject = decline
  })
  void promise.catch(() => undefined)
  return { promise, resolve, reject }
}

function disconnectedError(message: string): RemoteWorkspaceSshError {
  return new RemoteWorkspaceSshError(
    'workspace_server_connection_lost',
    message,
    { retryable: true }
  )
}

function protocolError(message: string): RemoteWorkspaceSshError {
  return new RemoteWorkspaceSshError('workspace_server_incompatible', message)
}

function cancelledError(): RemoteWorkspaceHostRequestError {
  return new RemoteWorkspaceHostRequestError({
    code: 'cancelled',
    message: 'Workspace Host request was cancelled.',
    retryable: false
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isRemoteWorkspaceConnection(
  value: RemoteSshStreamingProcess | Readonly<{
    process: RemoteSshStreamingProcess
    egressAccess: WorkspaceHostEgressAccess
  }>
): value is Readonly<{
  process: RemoteSshStreamingProcess
  egressAccess: WorkspaceHostEgressAccess
}> {
  return 'process' in value
}
