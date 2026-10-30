import { randomUUID } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import type { Readable, Writable } from 'node:stream'

import {
  WORKSPACE_HOST_LIMITS,
  WORKSPACE_HOST_PROTOCOL_VERSION,
  workspaceHostAcknowledgeSchema,
  workspaceHostFailureCodeSchema,
  workspaceHostHandshakeRequestSchema,
  workspaceHostHandshakeResponseSchema,
  workspaceHostRequestSchema,
  workspaceHostResponseSchema,
  workspaceHostSensitiveControlSchema,
  type WorkspaceHostContributionCohort,
  type WorkspaceHostEvent,
  type WorkspaceHostFailure,
  type WorkspaceHostFailureCode,
  type WorkspaceHostHandshakeRequest,
  type WorkspaceHostHandshakeResponse,
  type WorkspaceHostModelAccess,
  type WorkspaceHostPayload,
  type WorkspaceHostRequest,
  type WorkspaceHostResponse,
  type WorkspaceHostSession,
  type WorkspaceHostEgressAccess,
  type WorkspaceNetworkEgressState
} from '@sciforge/domain-sdk/workspace-host'
import {
  createWorkspaceEgressProcessProxyEnvironment
} from '@sciforge/workspace-egress/process-environment'

import {
  WorkspaceHostJsonLineWriter,
  readWorkspaceHostJsonLines
} from './protocol.js'
import {
  WORKSPACE_HOST_SERVER_VERSION,
  WorkspaceHostService,
  WorkspaceHostServiceError
} from './service.js'
import type { WorkspaceHostJournalEvent } from './journal.js'

export type WorkspaceHostServerOptions = Readonly<{
  service: WorkspaceHostService
  input: Readable
  output: Writable
  contributions?: readonly WorkspaceHostContributionCohort[]
  egressState?: WorkspaceNetworkEgressState
  compatibleClientVersion?: (clientVersion: string) => boolean
  disposeServiceOnClose?: boolean
  deriveEgressStateFromHandshake?: boolean
}>

type WorkspaceHostHandshakeFailure = Extract<
  WorkspaceHostHandshakeResponse,
  { ok: false }
>

export class WorkspaceHostJsonlServer {
  readonly #service: WorkspaceHostService
  readonly #input: Readable
  readonly #writer: WorkspaceHostJsonLineWriter
  readonly #contributions: readonly WorkspaceHostContributionCohort[]
  #egressState: WorkspaceNetworkEgressState
  readonly #compatibleClientVersion: (clientVersion: string) => boolean
  readonly #disposeServiceOnClose: boolean
  readonly #deriveEgressStateFromHandshake: boolean
  #lastAcknowledgedSequence = 0

  constructor(options: WorkspaceHostServerOptions) {
    this.#service = options.service
    this.#input = options.input
    this.#writer = new WorkspaceHostJsonLineWriter(options.output)
    this.#contributions = options.contributions ?? []
    this.#egressState = options.egressState ?? { mode: 'none', status: 'disabled' }
    this.#compatibleClientVersion = options.compatibleClientVersion
      ?? ((version) => majorVersion(version) === majorVersion(WORKSPACE_HOST_SERVER_VERSION))
    this.#disposeServiceOnClose = options.disposeServiceOnClose
      ?? this.#service.lifecycleMode === 'connection-session'
    this.#deriveEgressStateFromHandshake =
      options.deriveEgressStateFromHandshake ?? false
  }

  async run(): Promise<void> {
    const frames = readWorkspaceHostJsonLines(this.#input)
    const first = await frames.next()
    if (first.done) {
      throw new Error('Workspace Host client closed before handshake.')
    }
    let handshake: WorkspaceHostHandshakeRequest
    try {
      handshake = workspaceHostHandshakeRequestSchema.parse(first.value)
    } catch {
      await this.#writeHandshakeFailure(
        'invalid-request',
        'First Workspace Host frame must be a valid handshake request.'
      )
      await this.#writer.close()
      return
    }

    const preparation = await this.#prepareHandshake(handshake)
    if (!preparation.ok) {
      await this.#writer.write(workspaceHostHandshakeResponseSchema.parse(preparation))
      this.#service.configureProcessProxyEnvironment(undefined)
      this.#service.configureModelAccess(undefined)
      await this.#writer.close()
      return
    }

    const queuedEvents: WorkspaceHostEvent[] = []
    let ready = false
    const unsubscribe = this.#service.journal.subscribe((event) => {
      const frame = this.#eventFrame(event)
      if (!ready) {
        queuedEvents.push(frame)
        return
      }
      void this.#writer.write(frame).catch(() => undefined)
    })
    const pending = new Set<Promise<void>>()
    try {
      await this.#writer.write(workspaceHostHandshakeResponseSchema.parse({
        protocolVersion: WORKSPACE_HOST_PROTOCOL_VERSION,
        ok: true,
        session: this.#session()
      }))
      for (const event of preparation.replayEvents) {
        await this.#writer.write(this.#eventFrame(event))
      }
      const replayThrough = preparation.replayEvents.at(-1)?.seq
        ?? preparation.replayThrough
      for (const event of queuedEvents) {
        if (event.sequence > replayThrough) await this.#writer.write(event)
      }
      ready = true

      for await (const frame of frames) {
        const request = workspaceHostRequestSchema.safeParse(frame)
        if (request.success) {
          const task = this.#handleRequest(request.data)
          pending.add(task)
          void task.finally(() => pending.delete(task))
          continue
        }
        const acknowledgement = workspaceHostAcknowledgeSchema.safeParse(frame)
        if (acknowledgement.success) {
          if (
            acknowledgement.data.sessionId !== this.#service.sessionId
            || acknowledgement.data.sequence > this.#service.journal.latestSeq
          ) {
            throw new Error('Workspace Host acknowledgement is invalid for this session.')
          }
          this.#lastAcknowledgedSequence = Math.max(
            this.#lastAcknowledgedSequence,
            acknowledgement.data.sequence
          )
          continue
        }
        const sensitiveControl = workspaceHostSensitiveControlSchema.safeParse(frame)
        if (sensitiveControl.success) {
          this.#handleSensitiveControl(sensitiveControl.data)
          continue
        }
        throw new Error('Workspace Host received an unknown or invalid frame.')
      }
      await Promise.allSettled(pending)
    } finally {
      unsubscribe()
      this.#service.configureProcessProxyEnvironment(undefined)
      this.#service.configureModelAccess(undefined)
      if (this.#disposeServiceOnClose) this.#service.dispose()
      await this.#writer.close().catch(() => undefined)
    }
  }

  async #prepareHandshake(
    handshake: WorkspaceHostHandshakeRequest
  ): Promise<
    | WorkspaceHostHandshakeFailure
    | {
        ok: true
        replayEvents: readonly WorkspaceHostJournalEvent<WorkspaceHostPayload>[]
        replayThrough: number
      }
  > {
    if (!this.#compatibleClientVersion(handshake.clientVersion)) {
      return handshakeFailure(
        'compatibility-error',
        `Client ${handshake.clientVersion} is incompatible with server ${WORKSPACE_HOST_SERVER_VERSION}.`
      )
    }
    if (
      !this.#deriveEgressStateFromHandshake
      && handshake.egressMode !== this.#egressState.mode
    ) {
      return handshakeFailure(
        'compatibility-error',
        'Requested network egress does not match the attached Workspace Host route.'
      )
    }
    if (this.#deriveEgressStateFromHandshake) {
      this.#egressState = handshake.egressMode === 'none'
        ? { mode: 'none', status: 'disabled' }
        : { mode: handshake.egressMode, status: 'connecting' }
    }
    const egressFailure = this.#configureEgressAccess(
      handshake.egressMode,
      handshake.egressAccess
    )
    if (egressFailure) return egressFailure
    const modelAccessFailure = this.#configureModelAccess(handshake.modelAccess)
    if (modelAccessFailure) return modelAccessFailure
    try {
      if (await realpath(handshake.workspaceRoot) !== this.#service.workspaceRoot) {
        return handshakeFailure(
          'path-outside-workspace',
          'Handshake workspace root does not match the authorized server root.'
        )
      }
    } catch {
      return handshakeFailure('not-found', 'Handshake workspace root is unavailable.')
    }
    if (!sameContributionCohort(handshake.contributions, this.#contributions)) {
      return handshakeFailure(
        'compatibility-error',
        'Desktop and Workspace Host domain contribution cohorts do not match.'
      )
    }
    if (!handshake.resume) {
      return {
        ok: true,
        replayEvents: [],
        replayThrough: this.#service.journal.latestSeq
      }
    }
    if (handshake.resume.sessionId !== this.#service.sessionId) {
      return handshakeFailure('session-expired', 'Workspace Host session is no longer available.')
    }
    if (handshake.resume.lastAcknowledgedSequence > this.#service.journal.latestSeq) {
      return handshakeFailure(
        'invalid-request',
        'Resume sequence is newer than the Workspace Host session.'
      )
    }
    const replay = this.#service.journal.replay(
      handshake.resume.lastAcknowledgedSequence
    )
    if (replay.status === 'gap') {
      return handshakeFailure(
        'replay-gap',
        'Workspace Host event replay window no longer contains the requested sequence.',
        {
          earliestSequence: replay.earliestSeq,
          latestSequence: replay.latestSeq
        }
      )
    }
    this.#lastAcknowledgedSequence = handshake.resume.lastAcknowledgedSequence
    return {
      ok: true,
      replayEvents: replay.events,
      replayThrough: replay.latestSeq
    }
  }

  #configureEgressAccess(
    mode: WorkspaceHostHandshakeRequest['egressMode'],
    access: WorkspaceHostEgressAccess | undefined
  ): WorkspaceHostHandshakeFailure | undefined {
    if (mode === 'none') {
      this.#service.configureProcessProxyEnvironment(undefined)
      this.#egressState = { mode: 'none', status: 'disabled' }
      return undefined
    }
    if (!access || access.mode !== mode) {
      return handshakeFailure(
        'egress-unavailable',
        'Workspace Host egress access is required for the selected route.'
      )
    }
    const expiresAtMs = Date.parse(access.expiresAt)
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
      return handshakeFailure(
        'egress-unavailable',
        'Workspace Host egress access has expired.'
      )
    }
    let environment: NodeJS.ProcessEnv
    try {
      const endpoint = new URL(access.proxyEndpoint)
      environment = createWorkspaceEgressProcessProxyEnvironment({
        endpoint: {
          protocol: 'http-connect',
          host: endpoint.hostname.replace(/^\[|\]$/g, ''),
          port: Number(endpoint.port)
        },
        credential: access.authorization
      })
    } catch {
      return handshakeFailure(
        'egress-unavailable',
        'Workspace Host egress access is invalid.'
      )
    }
    this.#service.configureProcessProxyEnvironment(environment, access.expiresAt)
    this.#egressState = {
      mode,
      status: 'ready',
      leaseExpiresAt: access.expiresAt
    }
    return undefined
  }

  #configureModelAccess(
    access: WorkspaceHostModelAccess | undefined
  ): WorkspaceHostHandshakeFailure | undefined {
    if (!access) {
      this.#service.configureModelAccess(undefined)
      return undefined
    }
    const expiresAtMs = Date.parse(access.expiresAt)
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
      return handshakeFailure(
        'egress-unavailable',
        'Workspace Host model access has expired.'
      )
    }
    this.#service.configureModelAccess(access)
    return undefined
  }

  #handleSensitiveControl(
    control: ReturnType<typeof workspaceHostSensitiveControlSchema.parse>
  ): void {
    if (control.sessionId !== this.#service.sessionId) {
      throw new Error('Workspace Host sensitive control is invalid for this session.')
    }
    switch (control.control) {
      case 'egress-renew':
        if (
          this.#egressState.mode === 'none'
          || !this.#service.renewProcessProxyEnvironment(control.expiresAt)
        ) {
          throw new Error('Workspace Host egress renewal is invalid for this session.')
        }
        this.#egressState = {
          mode: this.#egressState.mode,
          status: 'ready',
          leaseExpiresAt: control.expiresAt
        }
        return
      case 'egress-revoke':
        this.#service.configureProcessProxyEnvironment(undefined)
        this.#egressState = {
          mode: this.#egressState.mode,
          status: this.#egressState.mode === 'none' ? 'disabled' : 'revoked'
        }
        return
      case 'model-access-renew':
        if (!this.#service.renewModelAccess(control.expiresAt)) {
          throw new Error('Workspace Host model access renewal is invalid for this session.')
        }
        return
      case 'model-access-revoke':
        this.#service.configureModelAccess(undefined)
    }
  }

  #session(): WorkspaceHostSession {
    const latestSequence = this.#service.journal.latestSeq
    const earliestSequence = latestSequence === 0
      ? 0
      : this.#service.journal.earliestSeq
    return {
      protocolVersion: WORKSPACE_HOST_PROTOCOL_VERSION,
      serverVersion: WORKSPACE_HOST_SERVER_VERSION,
      serverInstanceId: this.#service.serverInstanceId,
      sessionId: this.#service.sessionId,
      lifecycleMode: this.#service.lifecycleMode,
      locator: {
        contractVersion: WORKSPACE_HOST_PROTOCOL_VERSION,
        hostSessionId: this.#service.sessionId,
        path: this.#service.workspaceRoot
      },
      platform: {
        os: this.#service.platform as 'linux' | 'darwin' | 'win32',
        architecture: this.#service.architecture as 'x64' | 'arm64'
      },
      capabilities: [...this.#service.capabilities],
      contributions: [...this.#contributions],
      eventSequence: latestSequence,
      replay: { earliestSequence, latestSequence },
      egress: this.#egressState
    }
  }

  async #handleRequest(request: WorkspaceHostRequest): Promise<void> {
    let response: WorkspaceHostResponse
    if (request.sessionId !== this.#service.sessionId) {
      response = failedResponse(
        request,
        'session-expired',
        'Workspace Host request belongs to a different session.'
      )
    } else if (!this.#service.capabilities.some(
      (capability) => capability.operation === request.operation
    )) {
      response = failedResponse(
        request,
        'unsupported-operation',
        `Workspace Host operation "${request.operation}" is unavailable.`
      )
    } else {
      try {
        const result = await this.#service.request(request.operation, request.payload)
        response = workspaceHostResponseSchema.parse({
          protocolVersion: WORKSPACE_HOST_PROTOCOL_VERSION,
          sessionId: this.#service.sessionId,
          requestId: request.requestId,
          ok: true,
          result
        })
      } catch (error) {
        response = failedResponseFromError(request, error)
      }
    }
    await this.#writer.write(response)
  }

  #eventFrame(
    event: Readonly<{
      seq: number
      emittedAt: string
      type: string
      payload: WorkspaceHostPayload
    }>
  ): WorkspaceHostEvent {
    return {
      protocolVersion: WORKSPACE_HOST_PROTOCOL_VERSION,
      sessionId: this.#service.sessionId,
      eventId: `${this.#service.sessionId}:${event.seq}`,
      sequence: event.seq,
      kind: event.type,
      occurredAt: event.emittedAt,
      payload: event.payload
    }
  }

  async #writeHandshakeFailure(
    code: WorkspaceHostFailureCode,
    message: string
  ): Promise<void> {
    await this.#writer.write(workspaceHostHandshakeResponseSchema.parse(
      handshakeFailure(code, message)
    ))
  }
}

function failedResponseFromError(
  request: WorkspaceHostRequest,
  error: unknown
): WorkspaceHostResponse {
  if (error instanceof WorkspaceHostServiceError) {
    return failedResponse(
      request,
      failureCode(error.code),
      error.message,
      error.retryable,
      error.details
    )
  }
  if (isNodeError(error) && error.code === 'ENOENT') {
    return failedResponse(request, 'not-found', 'Workspace path was not found.')
  }
  if (isNodeError(error) && (error.code === 'EACCES' || error.code === 'EPERM')) {
    return failedResponse(request, 'permission-denied', 'Workspace operation is not permitted.')
  }
  return failedResponse(request, 'internal-error', 'Workspace Host operation failed.')
}

function failedResponse(
  request: WorkspaceHostRequest,
  code: WorkspaceHostFailureCode,
  message: string,
  retryable = false,
  details?: WorkspaceHostPayload
): WorkspaceHostResponse {
  return workspaceHostResponseSchema.parse({
    protocolVersion: WORKSPACE_HOST_PROTOCOL_VERSION,
    sessionId: request.sessionId,
    requestId: request.requestId,
    ok: false,
    failure: {
      code,
      message: message.slice(0, WORKSPACE_HOST_LIMITS.maxFailureMessageCharacters),
      retryable,
      ...(details !== undefined ? { details } : {})
    }
  })
}

function handshakeFailure(
  code: WorkspaceHostFailureCode,
  message: string,
  details?: WorkspaceHostPayload
): WorkspaceHostHandshakeFailure {
  return {
    protocolVersion: WORKSPACE_HOST_PROTOCOL_VERSION,
    ok: false,
    failure: {
      code,
      message,
      retryable: false,
      ...(details !== undefined ? { details } : {})
    }
  }
}

function failureCode(code: string): WorkspaceHostFailureCode {
  const canonical = workspaceHostFailureCodeSchema.safeParse(code)
  if (canonical.success) return canonical.data
  switch (code) {
    case 'unsupported_operation':
    case 'capability_unavailable':
      return 'unsupported-operation'
    case 'invalid_request':
    case 'invalid_file_type':
    case 'invalid_process_input':
    case 'invalid_process_cursor':
      return 'invalid-request'
    case 'not_found':
    case 'process_not_found':
      return 'not-found'
    case 'permission_denied':
      return 'permission-denied'
    case 'path_outside_workspace':
    case 'invalid_workspace_root':
      return 'path-outside-workspace'
    case 'revision_conflict':
      return 'conflict'
    case 'payload_too_large':
      return 'payload-too-large'
    case 'process_exited':
      return 'conflict'
    default:
      return 'internal-error'
  }
}

function sameContributionCohort(
  left: readonly WorkspaceHostContributionCohort[],
  right: readonly WorkspaceHostContributionCohort[]
): boolean {
  const key = (item: WorkspaceHostContributionCohort): string =>
    `${item.packageName}\0${item.moduleId}\0${item.moduleVersion}`
  const leftKeys = [...left].map(key).sort()
  const rightKeys = [...right].map(key).sort()
  return leftKeys.length === rightKeys.length
    && leftKeys.every((value, index) => value === rightKeys[index])
}

function majorVersion(version: string): string {
  return version.split('.')[0] ?? version
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}
