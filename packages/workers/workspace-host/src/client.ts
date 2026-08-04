import { randomUUID } from 'node:crypto'
import type { Readable, Writable } from 'node:stream'

import {
  WORKSPACE_HOST_PROTOCOL_VERSION,
  parseWorkspaceHostOperationInput,
  parseWorkspaceHostOperationOutput,
  workspaceHostAcknowledgeSchema,
  workspaceHostEgressRevokeSchema,
  workspaceHostEgressRenewSchema,
  workspaceHostEventSchema,
  workspaceHostHandshakeResponseSchema,
  workspaceHostOperationContract,
  workspaceHostPayloadSchema,
  workspaceHostModelAccessRenewSchema,
  workspaceHostModelAccessRevokeSchema,
  workspaceHostRequestSchema,
  workspaceHostResponseSchema,
  type WorkspaceHostClient,
  type WorkspaceHostEvent,
  type WorkspaceHostEventListener,
  type WorkspaceHostHandshakeRequest,
  type WorkspaceHostOperation,
  type WorkspaceHostOperationInput,
  type WorkspaceHostOperationOutput,
  type WorkspaceHostPayload,
  type WorkspaceHostReconnectInput,
  type WorkspaceHostRequestOptions,
  type WorkspaceHostSession
} from '@sciforge/domain-sdk/workspace-host'

import {
  WorkspaceHostJsonLineWriter,
  readWorkspaceHostJsonLines
} from './protocol.js'

export type WorkspaceHostTransportStreams = Readonly<{
  input: Readable
  output: Writable
}>

export type WorkspaceHostTransportFactory = (
  handshake: WorkspaceHostHandshakeRequest
) => Promise<WorkspaceHostTransportStreams>

export type WorkspaceHostJsonlClientOptions = Readonly<{
  handshake: Omit<WorkspaceHostHandshakeRequest, 'resume'>
  createTransport: WorkspaceHostTransportFactory
}>

type PendingRequest = {
  operation: WorkspaceHostOperation
  resolve: (value: WorkspaceHostPayload) => void
  reject: (error: Error) => void
  cleanup: () => void
}

export class WorkspaceHostClientError extends Error {
  readonly code: string
  readonly retryable: boolean
  readonly details?: WorkspaceHostPayload

  constructor(
    code: string,
    message: string,
    retryable = false,
    details?: WorkspaceHostPayload
  ) {
    super(message)
    this.name = 'WorkspaceHostClientError'
    this.code = code
    this.retryable = retryable
    this.details = details
  }
}

/**
 * A transport-neutral Node client. SSH, local subprocesses, or tests supply
 * byte streams; this class owns only the canonical Workspace Host protocol.
 */
export class WorkspaceHostJsonlClient implements WorkspaceHostClient {
  readonly #handshake: Omit<WorkspaceHostHandshakeRequest, 'resume'>
  readonly #createTransport: WorkspaceHostTransportFactory
  readonly #listeners = new Set<WorkspaceHostEventListener>()
  readonly #pending = new Map<string, PendingRequest>()
  #session!: WorkspaceHostSession
  #writer?: WorkspaceHostJsonLineWriter
  #generation = 0
  #closed = false
  #lastAcknowledgedSequence = 0

  private constructor(options: WorkspaceHostJsonlClientOptions) {
    this.#handshake = options.handshake
    this.#createTransport = options.createTransport
  }

  static async connect(
    options: WorkspaceHostJsonlClientOptions
  ): Promise<WorkspaceHostJsonlClient> {
    const client = new WorkspaceHostJsonlClient(options)
    await client.#attach()
    return client
  }

  getSession(): WorkspaceHostSession {
    return this.#session
  }

  async request<Operation extends WorkspaceHostOperation>(
    operation: Operation,
    payload: WorkspaceHostOperationInput<Operation>,
    options: WorkspaceHostRequestOptions = {}
  ): Promise<WorkspaceHostOperationOutput<Operation>> {
    if (this.#closed || !this.#writer) {
      throw new WorkspaceHostClientError('disconnected', 'Workspace Host client is disconnected.')
    }
    if (!this.#session.capabilities.some((capability) => capability.operation === operation)) {
      throw new WorkspaceHostClientError(
        'unsupported-operation',
        `Workspace Host operation "${operation}" is unavailable.`
      )
    }
    if (
      options.timeoutMilliseconds !== undefined
      && (
        !Number.isInteger(options.timeoutMilliseconds)
        || options.timeoutMilliseconds < 1
        || options.timeoutMilliseconds > 10 * 60_000
      )
    ) {
      throw new WorkspaceHostClientError(
        'invalid-request',
        'Workspace Host timeout must be between 1 and 600000 milliseconds.'
      )
    }
    if (options.signal?.aborted) {
      throw new WorkspaceHostClientError(
        'cancelled',
        'Workspace Host request was cancelled.'
      )
    }
    const contract = workspaceHostOperationContract(operation)
    const parsedPayload = contract
      ? parseWorkspaceHostOperationInput(contract.operation, payload)
      : workspaceHostPayloadSchema.parse(payload)
    const requestId = options.requestId ?? randomUUID()
    const frame = workspaceHostRequestSchema.parse({
      protocolVersion: WORKSPACE_HOST_PROTOCOL_VERSION,
      sessionId: this.#session.sessionId,
      requestId,
      operation,
      payload: parsedPayload,
      ...(options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
      ...(options.expectedRevision ? { expectedRevision: options.expectedRevision } : {})
    })
    if (this.#pending.has(requestId)) {
      throw new WorkspaceHostClientError('invalid-request', `Request id ${requestId} is in use.`)
    }
    return new Promise<WorkspaceHostPayload>((resolveRequest, rejectRequest) => {
      const timeout = options.timeoutMilliseconds
        ? setTimeout(() => {
            this.#pending.delete(requestId)
            rejectRequest(new WorkspaceHostClientError(
              'deadline-exceeded',
              `Workspace Host request ${requestId} exceeded its deadline.`
            ))
          }, options.timeoutMilliseconds)
        : undefined
      timeout?.unref()
      const onAbort = (): void => {
        this.#pending.delete(requestId)
        rejectRequest(new WorkspaceHostClientError(
          'cancelled',
          `Workspace Host request ${requestId} was cancelled.`
        ))
      }
      options.signal?.addEventListener('abort', onAbort, { once: true })
      const cleanup = (): void => {
        if (timeout) clearTimeout(timeout)
        options.signal?.removeEventListener('abort', onAbort)
      }
      this.#pending.set(requestId, {
        operation,
        resolve: resolveRequest,
        reject: rejectRequest,
        cleanup
      })
      void this.#writer!.write(frame).catch((error) => {
        const pending = this.#pending.get(requestId)
        if (!pending) return
        this.#pending.delete(requestId)
        pending.cleanup()
        pending.reject(asError(error))
      })
    }) as Promise<WorkspaceHostOperationOutput<Operation>>
  }

  subscribe(listener: WorkspaceHostEventListener): () => void {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  async acknowledge(sequence: number): Promise<void> {
    if (this.#closed || !this.#writer) {
      throw new WorkspaceHostClientError('disconnected', 'Workspace Host client is disconnected.')
    }
    const acknowledgement = workspaceHostAcknowledgeSchema.parse({
      protocolVersion: WORKSPACE_HOST_PROTOCOL_VERSION,
      sessionId: this.#session.sessionId,
      sequence
    })
    await this.#writer.write(acknowledgement)
    this.#lastAcknowledgedSequence = Math.max(this.#lastAcknowledgedSequence, sequence)
  }

  async renewEgress(expiresAt: string): Promise<void> {
    if (this.#closed || !this.#writer) {
      throw new WorkspaceHostClientError('disconnected', 'Workspace Host client is disconnected.')
    }
    if (this.#session.egress.mode === 'none') {
      throw new WorkspaceHostClientError(
        'egress-unavailable',
        'Workspace Host session does not have a network egress route.'
      )
    }
    await this.#writer.write(workspaceHostEgressRenewSchema.parse({
      protocolVersion: WORKSPACE_HOST_PROTOCOL_VERSION,
      sessionId: this.#session.sessionId,
      control: 'egress-renew',
      expiresAt
    }))
    this.#session = {
      ...this.#session,
      egress: {
        mode: this.#session.egress.mode,
        status: 'ready',
        leaseExpiresAt: expiresAt
      }
    }
  }

  async revokeEgress(): Promise<void> {
    const writer = this.#connectedWriter()
    await writer.write(workspaceHostEgressRevokeSchema.parse({
      protocolVersion: WORKSPACE_HOST_PROTOCOL_VERSION,
      sessionId: this.#session.sessionId,
      control: 'egress-revoke'
    }))
    this.#session = {
      ...this.#session,
      egress: {
        mode: this.#session.egress.mode,
        status: this.#session.egress.mode === 'none' ? 'disabled' : 'revoked'
      }
    }
  }

  async renewModelAccess(expiresAt: string): Promise<void> {
    const writer = this.#connectedWriter()
    await writer.write(workspaceHostModelAccessRenewSchema.parse({
      protocolVersion: WORKSPACE_HOST_PROTOCOL_VERSION,
      sessionId: this.#session.sessionId,
      control: 'model-access-renew',
      expiresAt
    }))
  }

  async revokeModelAccess(): Promise<void> {
    const writer = this.#connectedWriter()
    await writer.write(workspaceHostModelAccessRevokeSchema.parse({
      protocolVersion: WORKSPACE_HOST_PROTOCOL_VERSION,
      sessionId: this.#session.sessionId,
      control: 'model-access-revoke'
    }))
  }

  async reconnect(input: WorkspaceHostReconnectInput): Promise<WorkspaceHostSession> {
    if (this.#closed) {
      throw new WorkspaceHostClientError('disconnected', 'Workspace Host client is closed.')
    }
    if (input.signal?.aborted) {
      throw new WorkspaceHostClientError('cancelled', 'Workspace Host reconnect was cancelled.')
    }
    this.#lastAcknowledgedSequence = input.lastAcknowledgedSequence
    this.#generation += 1
    this.#rejectPending('disconnected', 'Workspace Host transport is reconnecting.')
    const previousWriter = this.#writer
    this.#writer = undefined
    if (previousWriter) await previousWriter.close().catch(() => undefined)
    await this.#attach({
      sessionId: this.#session.sessionId,
      lastAcknowledgedSequence: input.lastAcknowledgedSequence
    })
    return this.#session
  }

  async close(reason?: string): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    this.#generation += 1
    this.#rejectPending('disconnected', reason ?? 'Workspace Host client closed.')
    const writer = this.#writer
    this.#writer = undefined
    if (writer) await writer.close()
    this.#listeners.clear()
  }

  async #attach(resume?: {
    sessionId: string
    lastAcknowledgedSequence: number
  }): Promise<void> {
    const generation = ++this.#generation
    const handshake: WorkspaceHostHandshakeRequest = {
      ...this.#handshake,
      ...(resume ? { resume } : {})
    }
    const transport = await this.#createTransport(handshake)
    const writer = new WorkspaceHostJsonLineWriter(transport.output)
    const frames = readWorkspaceHostJsonLines(transport.input)
    await writer.write(handshake)
    const first = await frames.next()
    if (first.done) {
      throw new WorkspaceHostClientError(
        'disconnected',
        'Workspace Host transport closed during handshake.'
      )
    }
    const response = workspaceHostHandshakeResponseSchema.parse(first.value)
    if (!response.ok) {
      throw new WorkspaceHostClientError(
        response.failure.code,
        response.failure.message,
        response.failure.retryable,
        response.failure.details
      )
    }
    if (this.#closed || generation !== this.#generation) {
      await writer.close()
      throw new WorkspaceHostClientError('cancelled', 'Workspace Host connection was superseded.')
    }
    this.#writer = writer
    this.#session = response.session
    void this.#readLoop(frames, generation)
  }

  async #readLoop(
    frames: AsyncGenerator<unknown>,
    generation: number
  ): Promise<void> {
    try {
      for await (const frame of frames) {
        if (generation !== this.#generation) return
        const response = workspaceHostResponseSchema.safeParse(frame)
        if (response.success) {
          this.#receiveResponse(response.data)
          continue
        }
        const event = workspaceHostEventSchema.parse(frame)
        for (const listener of this.#listeners) {
          void Promise.resolve(listener(event)).catch(() => undefined)
        }
      }
      if (!this.#closed && generation === this.#generation) {
        this.#writer = undefined
        this.#rejectPending('disconnected', 'Workspace Host transport closed.')
      }
    } catch {
      if (!this.#closed && generation === this.#generation) {
        this.#writer = undefined
        this.#rejectPending('disconnected', 'Workspace Host transport failed.')
      }
    }
  }

  #receiveResponse(
    response: ReturnType<typeof workspaceHostResponseSchema.parse>
  ): void {
    const pending = this.#pending.get(response.requestId)
    if (!pending) return
    this.#pending.delete(response.requestId)
    pending.cleanup()
    if (!response.ok) {
      pending.reject(new WorkspaceHostClientError(
        response.failure.code,
        response.failure.message,
        response.failure.retryable,
        response.failure.details
      ))
      return
    }
    try {
      const contract = workspaceHostOperationContract(pending.operation)
      const result = contract
        ? parseWorkspaceHostOperationOutput(contract.operation, response.result)
        : workspaceHostPayloadSchema.parse(response.result)
      pending.resolve(result as WorkspaceHostPayload)
    } catch (error) {
      pending.reject(asError(error))
    }
  }

  #rejectPending(code: string, message: string): void {
    for (const pending of this.#pending.values()) {
      pending.cleanup()
      pending.reject(new WorkspaceHostClientError(code, message))
    }
    this.#pending.clear()
  }

  #connectedWriter(): WorkspaceHostJsonLineWriter {
    if (this.#closed || !this.#writer) {
      throw new WorkspaceHostClientError('disconnected', 'Workspace Host client is disconnected.')
    }
    return this.#writer
  }
}

export async function createWorkspaceHostJsonlClient(
  options: WorkspaceHostJsonlClientOptions
): Promise<WorkspaceHostClient> {
  return WorkspaceHostJsonlClient.connect(options)
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}
