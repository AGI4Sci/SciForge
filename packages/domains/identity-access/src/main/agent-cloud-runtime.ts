import { once } from 'node:events'
import { randomUUID } from 'node:crypto'

import WebSocket from 'ws'
import {
  agentIdSchema,
  agentNodeSchema,
  restRequestSchema,
  restResponseSchema,
  webSocketMessageSchema,
  type AgentNode,
  type RestRequest,
  type RestResponse,
  type WebSocketMessage
} from '@sciforge/collaboration-contracts'

import {
  AGENT_CLOUD_RUNTIME_CONTRACT_VERSION,
  AgentCloudRuntimeError,
  defineAgentCloudRuntime,
  type AgentCloudRuntime,
  type AgentCloudAuthorityStatus,
  type AgentCloudRotateInput,
  type AgentCloudRevokeInput
} from '../agent-cloud-runtime.js'
import {
  AUTHENTICATED_CLOUD_COMMAND_OPERATION_ID,
  authenticatedCloudJsonBody
} from '../authenticated-cloud-transport.js'
import { createAgentCredentialBootstrap } from './agent-credential-bootstrap.js'
import type { CloudIdentityRuntime } from './cloud-runtime.js'
import type { IdentityPrivateVault } from './private-vault.js'
import {
  domainMainAgentRuntimeReadinessSchema,
  type DomainMainAgentRuntimeReadiness
} from '@sciforge/domain-sdk/agent-execution'

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const MAX_QUEUED_EVENTS = 1_000
const REQUEST_TIMEOUT_MS = 30_000

type StoredAgentAuthority = Readonly<{
  version: 1
  agentId: string
  userId: string
  deviceId: string
  generation: number
  authority: string
}>

type AgentAuthorityState = Readonly<{
  epoch: number
  enabled: boolean
}>

type InFlightAgentAuthorityUse = Readonly<{
  epoch: number
  abort(reason: AgentCloudRuntimeError): void
}>

export type IdentityAgentCloudRuntimeOptions = Readonly<{
  getRuntime: () => CloudIdentityRuntime | null
  vault: IdentityPrivateVault
  getRuntimeReadiness: () => Promise<DomainMainAgentRuntimeReadiness>
  bindAuthorityInvalidator?: (invalidate: (reason: string) => void) => void
  fetchImpl?: typeof fetch
  webSocketFactory?: (url: string, headers: Readonly<Record<string, string>>) => WebSocket
  createBootstrap?: typeof createAgentCredentialBootstrap
}>

export function createIdentityAgentCloudRuntime(
  options: IdentityAgentCloudRuntimeOptions
): AgentCloudRuntime {
  const implementation = new IdentityAgentCloudRuntime(options)
  options.bindAuthorityInvalidator?.((reason) => implementation.invalidateIdentityAuthority(reason))
  return defineAgentCloudRuntime({
    authorityStatus: (agentId) => implementation.authorityStatus(agentId),
    ensureAgent: () => implementation.ensureAgent(),
    rotateAgent: (input) => implementation.rotateAgent(input),
    revokeAgent: (input) => implementation.revokeAgent(input),
    fenceAgent: (agentId) => implementation.fenceAgent(agentId),
    execute: (input, executionOptions) => implementation.execute(
      input.agentId,
      input.request,
      executionOptions
    ),
    pullAgentInbox: (input, executionOptions) => implementation.pullAgentInbox(
      input,
      executionOptions
    ),
    observeAgentInbox: (agentId, signal) => implementation.observeAgentInbox(agentId, signal)
  })
}

class IdentityAgentCloudRuntime {
  readonly #fetch: typeof fetch
  readonly #webSocketFactory: NonNullable<IdentityAgentCloudRuntimeOptions['webSocketFactory']>
  readonly #createBootstrap: typeof createAgentCredentialBootstrap
  readonly #authorityStates = new Map<string, AgentAuthorityState>()
  readonly #inFlightAuthorityUses = new Map<string, Set<InFlightAgentAuthorityUse>>()
  #lifecycleOperation = false

  constructor(private readonly options: IdentityAgentCloudRuntimeOptions) {
    this.#fetch = options.fetchImpl ?? fetch
    this.#webSocketFactory = options.webSocketFactory ?? (
      (url, headers) => new WebSocket(url, { headers })
    )
    this.#createBootstrap = options.createBootstrap ?? createAgentCredentialBootstrap
  }

  invalidateIdentityAuthority(reason: string): void {
    const agentIds = new Set([
      ...this.#authorityStates.keys(),
      ...this.#inFlightAuthorityUses.keys()
    ])
    const failure = new AgentCloudRuntimeError(
      'agent_authority_invalid',
      reason || 'Cloud User or Device authority changed.'
    )
    for (const agentId of agentIds) {
      const current = this.#authorityState(agentId)
      this.#authorityStates.set(agentId, {
        epoch: current.epoch + 1,
        enabled: current.enabled
      })
      const uses = this.#inFlightAuthorityUses.get(agentId)
      this.#inFlightAuthorityUses.delete(agentId)
      for (const use of uses ?? []) use.abort(failure)
    }
  }

  async authorityStatus(rawAgentId: string): Promise<AgentCloudAuthorityStatus> {
    const agentId = agentIdSchema.parse(rawAgentId)
    let identity: Extract<
      ReturnType<CloudIdentityRuntime['authenticatedCloudTransportStatus']>,
      { state: 'ready' }
    >
    try {
      identity = await this.#requireRevalidatedIdentityAuthority()
    } catch (error) {
      return authorityStatusFailure(error)
    }
    let readiness: Extract<DomainMainAgentRuntimeReadiness, { state: 'ready' }>
    try {
      readiness = await this.#requireRuntimeReady()
    } catch (error) {
      return authorityStatusFailure(error)
    }
    if (!this.#authorityState(agentId).enabled) return { state: 'agent_required', agentId }
    let authority: StoredAgentAuthority | null
    try {
      authority = await this.#readAuthority(agentId)
    } catch {
      return { state: 'unavailable', reason: 'Agent authority could not be read securely.' }
    }
    if (!authority) return { state: 'agent_required', agentId }
    if (authority.userId !== identity.userId || authority.deviceId !== identity.deviceId) {
      return { state: 'agent_required', agentId }
    }
    return {
      state: 'ready',
      agentId,
      userId: identity.userId,
      deviceId: identity.deviceId,
      generation: authority.generation,
      runtimeId: readiness.runtimeId,
      capabilityTags: readiness.capabilityTags
    }
  }

  async ensureAgent(): Promise<AgentNode> {
    await this.#requireRevalidatedIdentityAuthority()
    const readiness = await this.#requireRuntimeReady()
    return this.#withLifecycle(async () => {
      const identity = this.#requireIdentityAuthority()
      const bootstrap = this.#createBootstrap()
      const response = await this.#executeAsUser(restRequestSchema.parse({
        protocolVersion: '1.0',
        requestId: requestId(),
        type: 'agent.ensure',
        idempotencyKey: lifecycleIdempotencyKey('ensure'),
        deviceId: identity.deviceId,
        capabilities: readiness.capabilityTags,
        credentialBootstrapPublicKey: bootstrap.publicKey
      }))
      if (response.type !== 'agent.ensured') {
        throw unexpected(response, 'Device Agent ensure')
      }
      if (response.sealedCredential) {
        return this.#commitEnvelope(response.agent, response.sealedCredential, bootstrap.open)
      }
      const agent = agentNodeSchema.parse(response.agent)
      if (agent.ownerUserId !== identity.userId || agent.deviceId !== identity.deviceId ||
          agent.lifecycleStatus !== 'active') {
        throw new AgentCloudRuntimeError(
          'agent_authority_invalid',
          'Cloud returned a Device Agent for a different User or Device.'
        )
      }
      let authority: StoredAgentAuthority | null = null
      try {
        authority = await this.#readAuthority(agent.agentId)
      } catch (error) {
        if (!(error instanceof AgentCloudRuntimeError) || error.code !== 'agent_authority_invalid') {
          throw error
        }
      }
      if (authority && (
        authority.userId !== identity.userId || authority.deviceId !== identity.deviceId
      )) {
        throw new AgentCloudRuntimeError(
          'agent_authority_invalid',
          'Stored Agent authority does not belong to the current User and Device.'
        )
      }
      const authorityState = this.#authorityState(agent.agentId)
      if (authority?.generation === agent.credentialVersion && authorityState.enabled) {
        return agent
      }
      const replacement = this.#createBootstrap()
      const rotated = await this.#executeAsUser(restRequestSchema.parse({
        protocolVersion: '1.0',
        requestId: requestId(),
        type: 'agent.rotate_credential',
        idempotencyKey: lifecycleIdempotencyKey('ensure-rotate'),
        agentId: agent.agentId,
        expectedRevision: agent.revision,
        credentialBootstrapPublicKey: replacement.publicKey
      }))
      if (rotated.type !== 'agent.credential_rotated') {
        throw unexpected(rotated, 'Device Agent authority recovery')
      }
      return this.#commitEnvelope(
        rotated.agent,
        rotated.sealedCredential,
        replacement.open,
        authorityState.epoch
      )
    })
  }

  async rotateAgent(input: AgentCloudRotateInput): Promise<AgentNode> {
    await this.#requireRevalidatedIdentityAuthority()
    await this.#requireRuntimeReady()
    const expectedAuthorityEpoch = this.#authorityState(input.agentId).epoch
    return this.#withLifecycle(async () => {
      const bootstrap = this.#createBootstrap()
      const response = await this.#executeAsUser(restRequestSchema.parse({
        protocolVersion: '1.0',
        requestId: requestId(),
        type: 'agent.rotate_credential',
        idempotencyKey: input.idempotencyKey,
        agentId: input.agentId,
        expectedRevision: input.expectedRevision,
        credentialBootstrapPublicKey: bootstrap.publicKey
      }))
      if (response.type !== 'agent.credential_rotated') {
        throw unexpected(response, 'Agent authority rotation')
      }
      return this.#commitEnvelope(
        response.agent,
        response.sealedCredential,
        bootstrap.open,
        expectedAuthorityEpoch
      )
    })
  }

  async revokeAgent(input: AgentCloudRevokeInput): Promise<AgentNode> {
    this.#fenceAuthority(input.agentId)
    await this.options.vault.remove({
      kind: 'agent-credential',
      agentId: input.agentId
    })
    return this.#withLifecycle(async () => {
      const response = await this.#executeAsUser(restRequestSchema.parse({
        protocolVersion: '1.0',
        requestId: requestId(),
        type: 'agent.revoke',
        idempotencyKey: input.idempotencyKey,
        agentId: input.agentId,
        expectedRevision: input.expectedRevision
      }))
      if (response.type !== 'rest.entity' || response.entity.type !== 'agent_node' ||
          response.entity.agentId !== input.agentId ||
          response.entity.lifecycleStatus !== 'revoked') {
        throw unexpected(response, 'Agent revocation')
      }
      return response.entity
    })
  }

  async fenceAgent(rawAgentId: string): Promise<void> {
    const agentId = agentIdSchema.parse(rawAgentId)
    this.#fenceAuthority(agentId)
    await this.options.vault.remove({ kind: 'agent-credential', agentId })
  }

  async execute(
    rawAgentId: string,
    rawRequest: RestRequest,
    options?: Readonly<{ signal?: AbortSignal }>
  ): Promise<RestResponse> {
    const agentId = agentIdSchema.parse(rawAgentId)
    const request = restRequestSchema.parse(rawRequest)
    return this.#executeWithAgentAuthority(agentId, request, options?.signal)
  }

  async pullAgentInbox(
    input: Readonly<{ agentId: string; afterSequence: number; limit?: number }>,
    options?: Readonly<{ signal?: AbortSignal }>
  ) {
    const response = await this.#executeRaw(
      input.agentId,
      restRequestSchema.parse({
        protocolVersion: '1.0',
        requestId: requestId(),
        type: 'inbox.pull',
        recipientType: 'agent',
        afterSequence: input.afterSequence,
        limit: input.limit ?? 100
      }),
      options
    )
    if (response.type !== 'rest.inbox_page' || response.messages.some((message) => (
      message.recipientType !== 'agent' || message.recipientAgentId !== input.agentId
    ))) {
      throw new AgentCloudRuntimeError(
        'cloud_response_invalid',
        'Cloud returned an invalid Agent Inbox page.'
      )
    }
    return { messages: response.messages, nextSequence: response.nextSequence }
  }

  async *observeAgentInbox(
    rawAgentId: string,
    signal: AbortSignal
  ): AsyncIterable<WebSocketMessage> {
    const agentId = agentIdSchema.parse(rawAgentId)
    await this.#requireRevalidatedIdentityAuthority()
    await this.#requireRuntimeReady()
    const epoch = this.#beginAuthorityUse(agentId)
    const identity = this.#requireIdentityAuthority()
    const authority = await this.#requireAgentAuthority(agentId)
    const authorityAbort = new AbortController()
    let socket: WebSocket | undefined
    let release: () => void = () => undefined
    try {
      release = this.#registerAuthorityUse(agentId, {
        epoch,
        abort: (reason) => {
          authorityAbort.abort(reason)
          if (socket?.readyState === WebSocket.OPEN ||
              socket?.readyState === WebSocket.CONNECTING) {
            socket.close(1008, 'agent authority fenced')
          }
        }
      })
      const url = new URL('v1/events', identity.baseUrl)
      url.protocol = url.protocol === 'http:' ? 'ws:' : 'wss:'
      socket = this.#webSocketFactory(url.toString(), {
        authorization: `Bearer ${authority.authority}`
      })
      authority.authority = ''
      if (authorityAbort.signal.aborted) {
        if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
          socket.close(1008, 'agent authority fenced')
        }
        throw authorityAbort.signal.reason
      }
      const activeSocket = socket
      const close = () => activeSocket.close(1000, 'client shutdown')
      const events: unknown[] = []
      let wake: (() => void) | undefined
      const onMessage = (data: WebSocket.RawData) => {
        try {
          const text = rawDataText(data)
          if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES ||
              events.length >= MAX_QUEUED_EVENTS) {
            activeSocket.close(1009, 'payload too large')
            return
          }
          events.push(JSON.parse(text) as unknown)
          wake?.()
          wake = undefined
        } catch {
          activeSocket.close(1007, 'invalid payload')
        }
      }
      const lifetimeSignal = AbortSignal.any([signal, authorityAbort.signal])
      signal.addEventListener('abort', close, { once: true })
      activeSocket.on('message', onMessage)
      const handshakeSignal = AbortSignal.any([
        lifetimeSignal,
        AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      ])
      try {
        await Promise.race([
          once(activeSocket, 'open'),
          once(activeSocket, 'error').then(([error]) => Promise.reject(error)),
          abortPromise(handshakeSignal)
        ])
        this.#assertAuthorityUseCurrent(agentId, epoch)
        while (!lifetimeSignal.aborted && activeSocket.readyState === WebSocket.OPEN) {
          if (events.length === 0) {
            await Promise.race([
              new Promise<void>((resolve) => { wake = resolve }),
              once(activeSocket, 'close').then(() => undefined),
              abortPromise(lifetimeSignal)
            ])
          }
          while (events.length > 0) {
            this.#assertAuthorityUseCurrent(agentId, epoch)
            yield webSocketMessageSchema.parse(events.shift())
          }
        }
      } finally {
        activeSocket.off('message', onMessage)
        signal.removeEventListener('abort', close)
        if (activeSocket.readyState === WebSocket.OPEN ||
            activeSocket.readyState === WebSocket.CONNECTING) close()
      }
    } finally {
      authority.authority = ''
      release()
    }
  }

  async #executeRaw(
    agentId: string,
    request: RestRequest,
    options?: Readonly<{ signal?: AbortSignal }>
  ): Promise<RestResponse> {
    return this.#executeWithAgentAuthority(
      agentIdSchema.parse(agentId),
      request,
      options?.signal
    )
  }

  async #executeWithAgentAuthority(
    agentId: string,
    request: RestRequest,
    signal?: AbortSignal
  ): Promise<RestResponse> {
    await this.#requireRevalidatedIdentityAuthority()
    await this.#requireRuntimeReady()
    const epoch = this.#beginAuthorityUse(agentId)
    const authority = await this.#requireAgentAuthority(agentId)
    try {
      this.#assertAuthorityUseCurrent(agentId, epoch)
      const controller = new AbortController()
      const release = this.#registerAuthorityUse(agentId, {
        epoch,
        abort: (reason) => controller.abort(reason)
      })
      try {
        const requestSignal = signal
          ? AbortSignal.any([controller.signal, signal])
          : controller.signal
        const response = await this.#request(
          this.#requireIdentityAuthority().baseUrl,
          request,
          authority.authority,
          requestSignal
        )
        this.#assertAuthorityUseCurrent(agentId, epoch)
        return response
      } finally {
        release()
      }
    } finally {
      authority.authority = ''
    }
  }

  async #executeAsUser(request: RestRequest): Promise<RestResponse> {
    const runtime = this.options.getRuntime()
    if (!runtime) throw new AgentCloudRuntimeError('runtime_unavailable', 'Cloud identity runtime is not active.')
    const response = await runtime.executeAuthenticatedCloud({
      contractVersion: 1,
      operationId: AUTHENTICATED_CLOUD_COMMAND_OPERATION_ID,
      payload: authenticatedCloudJsonBody(request)
    })
    const body = restResponseSchema.parse(response.body)
    if (body.requestId !== request.requestId) {
      throw new AgentCloudRuntimeError(
        'cloud_response_invalid',
        'Cloud response does not match the Agent lifecycle request.'
      )
    }
    if (body.type === 'rest.error') throw cloudFailure(body)
    return body
  }

  async #commitEnvelope(
    rawAgent: AgentNode,
    envelope: Parameters<ReturnType<typeof createAgentCredentialBootstrap>['open']>[0],
    open: ReturnType<typeof createAgentCredentialBootstrap>['open'],
    expectedAuthorityEpoch?: number
  ): Promise<AgentNode> {
    const identity = this.#requireIdentityAuthority()
    const agent = agentNodeSchema.parse(rawAgent)
    if (agent.ownerUserId !== identity.userId || agent.deviceId !== identity.deviceId ||
        envelope.agentId !== agent.agentId || envelope.deviceId !== identity.deviceId ||
        envelope.credentialGeneration !== agent.credentialVersion) {
      throw new AgentCloudRuntimeError(
        'agent_authority_invalid',
        'Cloud returned Agent authority for a different User, Device, or Agent.'
      )
    }
    const current = this.#authorityState(agent.agentId)
    const commitEpoch = expectedAuthorityEpoch ?? current.epoch
    this.#assertAuthorityCommitCurrent(
      agent.agentId,
      commitEpoch,
      expectedAuthorityEpoch !== undefined
    )
    let authority = open(envelope)
    try {
      await this.options.vault.write(
        { kind: 'agent-credential', agentId: agent.agentId },
        JSON.stringify({
          version: 1,
          agentId: agent.agentId,
          userId: agent.ownerUserId,
          deviceId: identity.deviceId,
          generation: agent.credentialVersion,
          authority
        } satisfies StoredAgentAuthority)
      )
      try {
        this.#assertAuthorityCommitCurrent(
          agent.agentId,
          commitEpoch,
          expectedAuthorityEpoch !== undefined
        )
        this.#activateReplacementAuthority(agent.agentId, commitEpoch)
      } catch (error) {
        await this.options.vault.remove({
          kind: 'agent-credential',
          agentId: agent.agentId
        })
        throw error
      }
    } finally {
      authority = ''
    }
    return agent
  }

  async #readAuthority(agentId: string): Promise<StoredAgentAuthority | null> {
    const serialized = await this.options.vault.read({ kind: 'agent-credential', agentId })
    if (!serialized) return null
    let value: unknown
    try {
      value = JSON.parse(serialized)
    } catch {
      throw new AgentCloudRuntimeError('agent_authority_invalid', 'Stored Agent authority is invalid.')
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new AgentCloudRuntimeError('agent_authority_invalid', 'Stored Agent authority is invalid.')
    }
    const record = value as Record<string, unknown>
    if (record.version !== 1 || agentIdSchema.safeParse(record.agentId).success === false ||
        record.agentId !== agentId || typeof record.userId !== 'string' ||
        typeof record.deviceId !== 'string' || !Number.isSafeInteger(record.generation) ||
        Number(record.generation) < 1 || typeof record.authority !== 'string' ||
        !/^agent\.[A-Za-z0-9_-]{20,}$/u.test(record.authority) || record.authority.length > 512) {
      throw new AgentCloudRuntimeError('agent_authority_invalid', 'Stored Agent authority is invalid.')
    }
    return record as StoredAgentAuthority
  }

  async #requireAgentAuthority(agentId: string): Promise<StoredAgentAuthority & { authority: string }> {
    const identity = this.#requireIdentityAuthority()
    const authority = await this.#readAuthority(agentId)
    if (!authority) {
      throw new AgentCloudRuntimeError('agent_required', 'Register this Device as an Agent before continuing.')
    }
    if (authority.userId !== identity.userId || authority.deviceId !== identity.deviceId) {
      throw new AgentCloudRuntimeError(
        'agent_authority_invalid',
        'Stored Agent authority does not belong to the current User and Device.'
      )
    }
    return { ...authority }
  }

  #authorityState(agentId: string): AgentAuthorityState {
    return this.#authorityStates.get(agentId) ?? { epoch: 0, enabled: true }
  }

  #beginAuthorityUse(agentId: string): number {
    const state = this.#authorityState(agentId)
    if (!state.enabled) {
      throw new AgentCloudRuntimeError(
        'agent_required',
        'Agent authority has been fenced on this installation.'
      )
    }
    return state.epoch
  }

  #assertAuthorityUseCurrent(agentId: string, epoch: number): void {
    const current = this.#authorityState(agentId)
    if (!current.enabled || current.epoch !== epoch) {
      throw new AgentCloudRuntimeError(
        'agent_required',
        'Agent authority changed while Cloud work was in flight.'
      )
    }
  }

  #assertAuthorityCommitCurrent(
    agentId: string,
    epoch: number,
    allowExplicitRecovery: boolean
  ): void {
    const current = this.#authorityState(agentId)
    if (current.epoch !== epoch || (!current.enabled && !allowExplicitRecovery)) {
      throw new AgentCloudRuntimeError(
        'agent_required',
        'Agent authority changed before replacement authority could be committed.'
      )
    }
  }

  #registerAuthorityUse(
    agentId: string,
    use: InFlightAgentAuthorityUse
  ): () => void {
    this.#assertAuthorityUseCurrent(agentId, use.epoch)
    const uses = this.#inFlightAuthorityUses.get(agentId) ?? new Set()
    uses.add(use)
    this.#inFlightAuthorityUses.set(agentId, uses)
    return () => {
      uses.delete(use)
      if (uses.size === 0) this.#inFlightAuthorityUses.delete(agentId)
    }
  }

  #fenceAuthority(agentId: string): void {
    const current = this.#authorityState(agentId)
    this.#authorityStates.set(agentId, {
      epoch: current.epoch + 1,
      enabled: false
    })
    const reason = new AgentCloudRuntimeError(
      'agent_required',
      'Agent authority was fenced on this installation.'
    )
    const uses = this.#inFlightAuthorityUses.get(agentId)
    this.#inFlightAuthorityUses.delete(agentId)
    for (const use of uses ?? []) use.abort(reason)
  }

  #activateReplacementAuthority(agentId: string, expectedEpoch: number): void {
    const current = this.#authorityState(agentId)
    if (current.epoch !== expectedEpoch) {
      throw new AgentCloudRuntimeError(
        'agent_required',
        'Agent authority changed before replacement authority activation.'
      )
    }
    this.#authorityStates.set(agentId, {
      epoch: current.epoch + 1,
      enabled: true
    })
    const reason = new AgentCloudRuntimeError(
      'agent_required',
      'Agent authority was replaced while Cloud work was in flight.'
    )
    const uses = this.#inFlightAuthorityUses.get(agentId)
    this.#inFlightAuthorityUses.delete(agentId)
    for (const use of uses ?? []) use.abort(reason)
  }

  #requireIdentityAuthority(): Extract<
    ReturnType<CloudIdentityRuntime['authenticatedCloudTransportStatus']>,
    { state: 'ready' }
  > {
    const status = this.options.getRuntime()?.authenticatedCloudTransportStatus()
    if (!status) throw new AgentCloudRuntimeError('runtime_unavailable', 'Cloud identity runtime is not active.')
    if (status.state === 'ready') return status
    if (status.state === 'identity_required') {
      throw new AgentCloudRuntimeError('identity_required', 'Sign in to SciForge Cloud before continuing.')
    }
    if (status.state === 'device_required') {
      throw new AgentCloudRuntimeError('device_required', 'Enroll this Desktop Device before continuing.')
    }
    throw new AgentCloudRuntimeError('runtime_unavailable', status.reason)
  }

  async #requireRevalidatedIdentityAuthority(): Promise<Extract<
    ReturnType<CloudIdentityRuntime['authenticatedCloudTransportStatus']>,
    { state: 'ready' }
  >> {
    const runtime = this.options.getRuntime()
    if (!runtime) {
      throw new AgentCloudRuntimeError(
        'runtime_unavailable',
        'Cloud identity runtime is not active.'
      )
    }
    const status = await runtime.revalidateCurrentDevice()
    if (status.state === 'ready') return status
    if (status.state === 'identity_required') {
      throw new AgentCloudRuntimeError(
        'identity_required',
        'Sign in to SciForge Cloud before continuing.'
      )
    }
    if (status.state === 'device_required') {
      throw new AgentCloudRuntimeError('device_required', status.reason)
    }
    throw new AgentCloudRuntimeError('runtime_unavailable', status.reason)
  }

  async #requireRuntimeReady(): Promise<Extract<
    DomainMainAgentRuntimeReadiness,
    { state: 'ready' }
  >> {
    let readiness: DomainMainAgentRuntimeReadiness
    try {
      readiness = domainMainAgentRuntimeReadinessSchema.parse(
        await this.options.getRuntimeReadiness()
      )
    } catch (error) {
      throw new AgentCloudRuntimeError(
        'runtime_unavailable',
        'AgentRuntime readiness could not be confirmed.',
        undefined,
        { cause: error }
      )
    }
    if (readiness.state !== 'ready') {
      throw new AgentCloudRuntimeError('runtime_required', readiness.reason)
    }
    return readiness
  }

  async #request(
    baseUrl: string,
    request: RestRequest,
    authority: string,
    signal?: AbortSignal
  ): Promise<RestResponse> {
    const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    const combined = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
    let response: Response
    try {
      response = await this.#fetch(new URL('v1/commands', ensureTrailingSlash(baseUrl)), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${authority}`,
          accept: 'application/json',
          'content-type': 'application/json',
          ...('idempotencyKey' in request ? { 'idempotency-key': request.idempotencyKey } : {})
        },
        body: JSON.stringify(request),
        signal: combined
      })
    } catch (error) {
      if (error instanceof AgentCloudRuntimeError) throw error
      if (combined.aborted && combined.reason instanceof AgentCloudRuntimeError) {
        throw combined.reason
      }
      throw new AgentCloudRuntimeError(
        'cloud_unavailable',
        'SciForge Cloud is unavailable.',
        undefined,
        { cause: error }
      )
    }
    const declaredLength = Number(response.headers.get('content-length'))
    if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
      throw new AgentCloudRuntimeError('cloud_response_invalid', 'Cloud response exceeds 2 MiB.')
    }
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > MAX_RESPONSE_BYTES) {
      throw new AgentCloudRuntimeError('cloud_response_invalid', 'Cloud response exceeds 2 MiB.')
    }
    let body: RestResponse
    try {
      body = restResponseSchema.parse(JSON.parse(new TextDecoder().decode(bytes)))
    } catch (error) {
      throw new AgentCloudRuntimeError(
        'cloud_response_invalid',
        'Cloud returned an invalid Agent response.',
        undefined,
        { cause: error }
      )
    }
    if (body.requestId !== request.requestId) {
      throw new AgentCloudRuntimeError('cloud_response_invalid', 'Cloud response requestId does not match.')
    }
    if (!response.ok || body.type === 'rest.error') throw cloudFailure(body)
    return body
  }

  async #withLifecycle<Result>(operation: () => Promise<Result>): Promise<Result> {
    if (this.#lifecycleOperation) {
      throw new AgentCloudRuntimeError('conflict', 'Another Agent lifecycle operation is active.')
    }
    this.#lifecycleOperation = true
    try {
      return await operation()
    } finally {
      this.#lifecycleOperation = false
    }
  }
}

function unexpected(response: RestResponse, operation: string): AgentCloudRuntimeError {
  if (response.type === 'rest.error') return cloudFailure(response)
  return new AgentCloudRuntimeError(
    'cloud_response_invalid',
    `${operation} returned an unexpected response.`
  )
}

function authorityStatusFailure(error: unknown): AgentCloudAuthorityStatus {
  if (!(error instanceof AgentCloudRuntimeError)) {
    return { state: 'unavailable', reason: 'Agent authority could not be confirmed.' }
  }
  if (error.code === 'identity_required') return { state: 'identity_required' }
  if (error.code === 'device_required') return { state: 'device_required' }
  if (error.code === 'runtime_required') {
    return { state: 'runtime_required', reason: error.message }
  }
  return { state: 'unavailable', reason: error.message }
}

function cloudFailure(response: RestResponse): AgentCloudRuntimeError {
  if (response.type !== 'rest.error') {
    return new AgentCloudRuntimeError('cloud_unavailable', 'SciForge Cloud rejected the Agent request.')
  }
  return new AgentCloudRuntimeError(
    response.error.code === 'idempotency_conflict'
      ? 'conflict'
      : 'cloud_unavailable',
    response.error.message,
    response.error.code
  )
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`
}

function requestId(): `req_${string}` {
  return `req_${randomUUID().replaceAll('-', '')}`
}

function lifecycleIdempotencyKey(operation: string): `idem_${string}` {
  return `idem_agent.${operation}.${randomUUID().replaceAll('-', '')}`
}

function abortPromise(signal: AbortSignal): Promise<never> {
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  })
}

function rawDataText(data: WebSocket.RawData): string {
  if (typeof data === 'string') return data
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8')
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8')
  return data.toString('utf8')
}
