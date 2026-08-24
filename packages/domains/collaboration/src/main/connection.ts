import { createHash, randomUUID } from 'node:crypto'
import {
  encodePairingBindCode,
  restRequestSchema,
  restResponseSchema,
  type AgentInboxMessage,
  type AgentNode,
  type HumanEndpointBinding,
  type ManagedProviderContainer,
  type ProviderLocator,
  type ParticipantProfile,
  type RestRequest,
  type UserPrincipal
} from '@sciforge/collaboration-contracts'
import {
  AgentCloudRuntimeError,
  type AgentCloudRuntime
} from '@sciforge/domain-identity-access/agent-cloud-runtime'
import {
  AUTHENTICATED_CLOUD_COMMAND_OPERATION_ID,
  authenticatedCloudJsonBody,
  type AuthenticatedCloudTransport
} from '@sciforge/domain-identity-access/authenticated-cloud-transport'
import type {
  CollaborationAgentRegisterInput,
  CollaborationConnectionConnectInput,
  CollaborationEndpointChallengePollInput,
  CollaborationEndpointChallengeStartInput,
  CollaborationProviderOption
} from '../contract.js'
import { collaborationRequestId } from './request-id.js'
import { DurableCloudOutbox } from './outbox.js'
import { CollaborationSettingsService, normalizeCollaborationBaseUrl } from './settings.js'
import { CollaborationLocalStore } from './store.js'

export type CollaborationConnectionState = Readonly<{
  state: 'unconfigured' | 'disconnected' | 'connecting' | 'connected' | 'recovering' | 'error'
  lastConnectedAt?: string
  lastError?: string
}>

export type CollaborationInboxHandler = Readonly<{
  handle(message: AgentInboxMessage): Promise<void>
}>

export type CollaborationConnectionOptions = Readonly<{
  store: CollaborationLocalStore
  settings: CollaborationSettingsService
  outbox: DurableCloudOutbox
  authenticatedCloudTransport: AuthenticatedCloudTransport
  agentCloudRuntime: AgentCloudRuntime
  inboxHandler: CollaborationInboxHandler
  afterHeartbeat?: (connectionStatus: 'online' | 'offline') => void | Promise<void>
  sanitizeText?: (value: string) => string
  now?: () => Date
}>

export class CollaborationConnection {
  private readonly now: () => Date
  private connectionState: CollaborationConnectionState = { state: 'unconfigured' }
  private providerOptions: readonly CollaborationProviderOption[] = []
  private abortController: AbortController | null = null
  private pullTail: Promise<void> = Promise.resolve()
  private background: Promise<void>[] = []

  constructor(private readonly options: CollaborationConnectionOptions) {
    this.now = options.now ?? (() => new Date())
  }

  state(): CollaborationConnectionState {
    return this.connectionState
  }

  providers(): readonly CollaborationProviderOption[] {
    return this.providerOptions
  }

  async executeAsUser(request: RestRequest) {
    const parsed = restRequestSchema.parse(request)
    this.requireIdentityReady()
    const response = await this.options.authenticatedCloudTransport.execute({
      contractVersion: 1,
      operationId: AUTHENTICATED_CLOUD_COMMAND_OPERATION_ID,
      payload: authenticatedCloudJsonBody(parsed)
    })
    const body = restResponseSchema.parse(response.body)
    if (body.requestId !== parsed.requestId) {
      throw new Error('Authenticated Cloud response requestId does not match the command.')
    }
    return body
  }

  async executeAsAgent(request: RestRequest) {
    const agentId = await this.requireLocalAgentId()
    return this.options.agentCloudRuntime.execute({
      agentId,
      request: restRequestSchema.parse(request)
    })
  }

  async localAgentId(): Promise<string | undefined> {
    const agents = this.options.store.snapshot().agents.filter((agent) => (
      agent.lifecycleStatus === 'active' && typeof agent.deviceId === 'string'
    ))
    const status = this.options.authenticatedCloudTransport.status()
    if (status.state === 'ready') {
      return agents.find((agent) => agent.deviceId === status.deviceId)?.agentId
    }
    return agents.length === 1 ? agents[0]!.agentId : undefined
  }

  async acceptAgentRevocation(agentId: string, occurredAt: string): Promise<void> {
    const localAgentId = await this.localAgentId()
    if (!localAgentId || localAgentId !== agentId) {
      throw new Error('Agent revocation does not target this installation.')
    }
    await this.options.agentCloudRuntime.fenceAgent(agentId)
    const controller = this.abortController
    this.abortController = null
    controller?.abort()
    this.options.outbox.stop()
    await this.options.store.transact((draft) => {
      const agent = draft.agents.find((candidate) => candidate.agentId === agentId)
      if (!agent || agent.lifecycleStatus === 'revoked') return
      agent.lifecycleStatus = 'revoked'
      agent.connectionStatus = 'offline'
      agent.revokedAt = occurredAt
      agent.updatedAt = occurredAt
      agent.revision += 1
    })
    this.connectionState = {
      state: 'error',
      lastConnectedAt: this.connectionState.lastConnectedAt,
      lastError: 'This collaboration Agent registration was revoked.'
    }
  }

  async activate(): Promise<void> {
    const configured = await this.options.settings.read()
    if (!configured.settings) {
      this.connectionState = { state: 'unconfigured' }
      return
    }
    const identityStatus = this.options.authenticatedCloudTransport.status()
    if ('baseUrl' in identityStatus &&
        normalizeCollaborationBaseUrl(configured.settings.baseUrl) !==
          normalizeCollaborationBaseUrl(identityStatus.baseUrl)) {
      throw new Error('Collaboration Cloud settings do not match the active Identity Cloud endpoint.')
    }
    await this.refreshProviderCatalog().catch((error) => this.recordError(error, false))
    const cachedUser = this.options.store.snapshot().user
    if (cachedUser && this.options.authenticatedCloudTransport.status().state === 'ready') {
      try {
        const snapshot = await this.refreshParticipant(cachedUser.userId)
        for (const endpoint of snapshot.humanEndpoints) {
          if (endpoint.status === 'active') {
            await this.refreshEndpointLocators(endpoint.humanEndpointId)
          }
        }
        if (this.providerOptions.some((provider) => provider.managedContainers)) {
          await this.refreshManagedContainers()
        }
      } catch (error) {
        // Cached collaboration state remains usable while offline. A later
        // explicit recovery/restart repeats this canonical cloud refresh.
        this.recordError(error, true)
      }
    }
    const localAgentId = await this.localAgentId()
    if (localAgentId &&
        (await this.options.agentCloudRuntime.authorityStatus(localAgentId)).state === 'ready') {
      // A configured desktop must still activate while the cloud is offline. The
      // durable inbox/outbox and projection recovery remain available, and the
      // explicit recover action retries the same canonical connection path.
      await this.connect().catch(() => undefined)
    } else {
      this.connectionState = { state: 'disconnected' }
    }
  }

  async dispose(): Promise<void> {
    await this.disconnect()
  }

  async configure(baseUrl: string): Promise<void> {
    await this.disconnect()
    const status = this.requireIdentityReady()
    if (normalizeCollaborationBaseUrl(baseUrl) !== normalizeCollaborationBaseUrl(status.baseUrl)) {
      throw new Error('Collaboration Cloud must use the active Identity Cloud endpoint.')
    }
    await this.options.settings.configure(status.baseUrl)
    this.connectionState = { state: 'disconnected' }
    await this.refreshProviderCatalog()
  }

  async applyConnectionAction(input: CollaborationConnectionConnectInput): Promise<void> {
    if (input.action === 'disconnect') {
      const localAgentId = await this.localAgentId()
      if (localAgentId &&
          (await this.options.agentCloudRuntime.authorityStatus(localAgentId)).state === 'ready') {
        await this.heartbeat('offline').catch((error) => {
          this.recordError(error, true)
        })
      }
      await this.disconnect()
      return
    }
    if (input.action === 'recover') {
      this.options.outbox.wake()
    }
    await this.connect()
  }

  async startChallenge(input: CollaborationEndpointChallengeStartInput): Promise<Readonly<{
    challengeId: string
    pairingCode: string
    expiresAt: string
    instruction: string
  }>> {
    const realmId = input.locator.realmId?.trim()
    if (!realmId) throw new Error('The selected provider requires a realmId locator value.')
    const providerUserId = input.locator.providerUserId?.trim()
    if (!providerUserId) throw new Error('The selected provider requires an exact providerUserId locator value.')
    const request = restRequestSchema.parse({
      protocolVersion: '1.0',
      requestId: collaborationRequestId(),
      type: 'endpoint.challenge.create',
      idempotencyKey: `idem_endpoint.challenge.create.${digest([
        input.providerKey,
        realmId,
        providerUserId,
        String(this.now().getTime())
      ].join('\u0000')).slice(0, 48)}`,
      expectedIdentity: { provider: input.providerKey, realmId, providerUserId }
    })
    const response = await this.executeAsUser(request)
    if (response.type === 'rest.error') throw new Error(response.error.message)
    if (response.type !== 'endpoint.challenge.created') {
      throw new Error(`Endpoint challenge create returned unexpected ${response.type}.`)
    }
    const pairingCommand = `/bind ${encodePairingBindCode({
      challengeId: response.challengeId,
      challengeCode: response.challengeCode
    })}`
    if (pairingCommand.length > 64) {
      throw new Error('Pairing service returned a command that exceeds the supported display length.')
    }
    const providerLabel = this.providerOptions.find((provider) => (
      provider.providerKey === input.providerKey
    ))?.label ?? input.providerKey
    return {
      challengeId: response.challengeId,
      pairingCode: pairingCommand,
      expiresAt: response.expiresAt,
      instruction: `Send this entire command unchanged in a private message to the ${providerLabel} Bot.`
    }
  }

  async pollChallenge(input: CollaborationEndpointChallengePollInput): Promise<
    | Readonly<{ status: 'pending'; expiresAt: string; retryAfterSeconds: number }>
    | Readonly<{ status: 'expired' }>
    | Readonly<{
        status: 'verified'
        userId: string
        humanEndpointId: string
        assurance: 'low' | 'verified' | 'strong'
      }>
  > {
    const response = await this.executeAsUser(restRequestSchema.parse({
      protocolVersion: '1.0',
      requestId: collaborationRequestId(),
      type: 'endpoint.challenge.get',
      challengeId: input.challengeId
    }))
    if (response.type === 'endpoint.challenge.pending') {
      return {
        status: 'pending',
        expiresAt: response.expiresAt,
        retryAfterSeconds: response.retryAfterSeconds
      }
    }
    if (response.type === 'endpoint.challenge.expired' ||
        (response.type === 'rest.error' && response.error.code === 'expired')) {
      return { status: 'expired' }
    }
    if (response.type === 'rest.error') throw new Error(response.error.message)
    if (response.type !== 'endpoint.challenge.verified') {
      throw new Error(`Endpoint challenge query returned unexpected ${response.type}.`)
    }
    const snapshot = await this.refreshParticipant(response.userId)
    await this.refreshEndpointLocators(response.humanEndpointId)
    const endpoint = snapshot.humanEndpoints.find((item) => (
      item.humanEndpointId === response.humanEndpointId
    ))
    return {
      status: 'verified',
      userId: response.userId,
      humanEndpointId: response.humanEndpointId,
      assurance: mapAssurance(endpoint?.assurance ?? response.assurance)
    }
  }

  async registerAgent(input: CollaborationAgentRegisterInput): Promise<AgentNode> {
    const identity = this.requireIdentityReady()
    const state = this.options.store.snapshot()
    if (state.user && state.user.userId !== identity.userId) {
      throw new Error('Cached collaboration state belongs to another OIDC User.')
    }
    const registrationIntent = {
      deviceId: identity.deviceId,
      ownerUserId: identity.userId,
      displayName: input.displayName.trim(),
      nodeType: input.nodeType,
      capabilities: [...input.capabilities].sort()
    }
    let agent: AgentNode | undefined
    let recoverExisting = false
    try {
      agent = await this.options.agentCloudRuntime.registerAgent({
        idempotencyKey: `idem_agent.register.${digest(JSON.stringify(registrationIntent)).slice(0, 48)}`,
        displayName: registrationIntent.displayName,
        nodeType: registrationIntent.nodeType,
        capabilities: registrationIntent.capabilities
      })
    } catch (error) {
      recoverExisting = error instanceof AgentCloudRuntimeError &&
        error.cloudCode === 'idempotency_conflict'
      if (!recoverExisting) throw error
    }
    if (recoverExisting) {
      const snapshot = await this.refreshParticipant(identity.userId)
      const existing = snapshot.agents.find((agent) => (
        agent.deviceId === identity.deviceId
        && agent.ownerUserId === identity.userId
        && agent.lifecycleStatus === 'active'
      ))
      if (!existing) {
        agent = undefined
      } else {
        // Authority rotation invalidates the active Identity-owned Agent
        // transport. Stop the loops first so connect() starts one replacement.
        await this.disconnect()
        agent = await this.options.agentCloudRuntime.rotateAgent({
          idempotencyKey: `idem_agent.rotate_credential.${digest([
            existing.agentId,
            String(existing.revision),
            String(this.now().getTime())
          ].join('\u0000')).slice(0, 48)}`,
          agentId: existing.agentId,
          expectedRevision: existing.revision
        })
      }
    }
    if (!agent) {
      throw new Error('Agent registration recovery could not find an active Agent for this Device.')
    }
    if (agent.deviceId !== identity.deviceId || agent.ownerUserId !== identity.userId) {
      throw new Error('Agent registration does not match the current User and Device.')
    }
    await this.options.store.transact((draft) => {
      draft.agents = replaceBy(draft.agents, agent, (item) => item.agentId)
    })
    // Registration can atomically promote the first Agent to participant
    // primary and advance the participant revision. Refresh through the OIDC
    // transport before connecting through Identity-owned Agent authority.
    await this.refreshParticipant(identity.userId)
    await this.connect()
    return agent
  }

  async selectPrimaryAgent(
    agentId: string,
    expectedParticipantRevision: number
  ): Promise<ParticipantProfile> {
    const state = this.options.store.snapshot()
    const user = state.user
    const participant = state.participant
    if (!user || !participant) throw new Error('Participant binding is incomplete.')
    const agent = state.agents.find((candidate) => candidate.agentId === agentId)
    if (!agent || agent.ownerUserId !== user.userId || agent.lifecycleStatus !== 'active') {
      throw new Error('Primary Agent must be an active Agent owned by the current user.')
    }
    if (participant.revision !== expectedParticipantRevision) {
      throw new Error('Participant revision is stale.')
    }
    const response = await this.executeAsUser(restRequestSchema.parse({
      protocolVersion: '1.0',
      requestId: collaborationRequestId(),
      type: 'participant.update_primary',
      idempotencyKey: `idem_participant.primary.${digest([
        participant.participantId,
        agentId,
        String(expectedParticipantRevision)
      ].join('\u0000')).slice(0, 48)}`,
      userId: user.userId,
      expectedRevision: expectedParticipantRevision,
      primaryHumanEndpointId: participant.primaryHumanEndpointId,
      primaryAgentId: agentId
    }))
    if (response.type === 'rest.error') throw new Error(response.error.message)
    if (response.type !== 'rest.entity' || response.entity.type !== 'participant_profile') {
      throw new Error(`Primary Agent update returned unexpected ${response.type}.`)
    }
    const participantEntity = response.entity
    await this.options.store.transact((draft) => { draft.participant = participantEntity })
    return participantEntity
  }

  async refreshParticipant(userId?: string): Promise<Readonly<{
    user: UserPrincipal
    participant: ParticipantProfile
    humanEndpoints: readonly HumanEndpointBinding[]
    agents: readonly AgentNode[]
  }>> {
    const targetUserId = userId ?? this.options.store.snapshot().user?.userId
    if (!targetUserId) throw new Error('No collaboration user is bound.')
    const response = await this.executeAsUser(restRequestSchema.parse({
      protocolVersion: '1.0',
      requestId: collaborationRequestId(),
      type: 'participant.get',
      userId: targetUserId
    }))
    if (response.type === 'rest.error') throw new Error(response.error.message)
    if (response.type !== 'participant.snapshot') {
      throw new Error(`Participant query returned unexpected ${response.type}.`)
    }
    await this.options.store.transact((draft) => {
      draft.user = response.user
      draft.participant = response.participant
      draft.endpoints = [...response.humanEndpoints]
      draft.agents = [...response.agents]
    })
    return response
  }

  async connect(): Promise<void> {
    if (this.abortController) return
    const agentId = await this.requireLocalAgentId()
    const authority = await this.options.agentCloudRuntime.authorityStatus(agentId)
    if (authority.state !== 'ready') {
      throw new Error('Agent authority is unavailable for this installation.')
    }
    this.connectionState = { state: 'connecting' }
    const controller = new AbortController()
    this.abortController = controller
    try {
      await this.heartbeat('online')
      await this.pullInbox()
      this.connectionState = {
        state: 'connected',
        lastConnectedAt: this.now().toISOString()
      }
      this.options.outbox.start()
      this.background = [
        this.pollLoop(controller.signal),
        this.notificationLoop(agentId, controller.signal)
      ]
    } catch (error) {
      this.abortController = null
      this.recordError(error, true)
      throw error
    }
  }

  async disconnect(): Promise<void> {
    const controller = this.abortController
    this.abortController = null
    if (controller) controller.abort()
    this.options.outbox.stop()
    await Promise.allSettled(this.background)
    this.background = []
    if ((await this.options.settings.read()).settings) {
      this.connectionState = { state: 'disconnected' }
    }
  }

  private async refreshProviderCatalog(): Promise<void> {
    const response = await this.executeAsUser(restRequestSchema.parse({
      protocolVersion: '1.0',
      requestId: collaborationRequestId(),
      type: 'endpoint.catalog.get'
    }))
    if (response.type === 'rest.error') throw new Error(response.error.message)
    if (response.type !== 'endpoint.catalog') {
      throw new Error(`Provider catalog returned unexpected ${response.type}.`)
    }
    this.providerOptions = response.providers.map((provider) => ({
      providerKey: provider.provider,
      label: provider.displayName,
      realmLabel: provider.onboarding.realmLabel,
      containerLabel: provider.onboarding.containerLabel,
      topicLabel: provider.onboarding.topicLabel,
      managedContainers: provider.capabilities.managedContainers === true,
      locatorFields: [
        {
          key: 'realmId',
          label: 'Organization / realm ID',
          required: true,
          placeholder: 'Provider organization identity'
        },
        {
          key: 'providerUserId',
          label: provider.onboarding.accountLabel,
          required: true,
          placeholder: 'Exact provider account identity'
        }
      ]
    }))
  }

  async refreshEndpointLocators(humanEndpointId: string): Promise<number> {
    const locators: Array<{ humanEndpointId: string; locator: ProviderLocator }> = []
    let cursor: string | undefined
    let pageCount = 0
    do {
      const response = await this.executeAsUser(restRequestSchema.parse({
        protocolVersion: '1.0',
        requestId: collaborationRequestId(),
        type: 'endpoint.locator.list',
        humanEndpointId,
        ...(cursor ? { cursor } : {}),
        limit: 500
      }))
      if (response.type === 'rest.error') throw new Error(response.error.message)
      if (response.type !== 'endpoint.locator_page') {
        throw new Error(`Endpoint locator query returned unexpected ${response.type}.`)
      }
      locators.push(...response.locators.map((locator) => ({ humanEndpointId, locator })))
      cursor = response.nextCursor
      pageCount += 1
      if (pageCount > 1_000) throw new Error('Endpoint locator pagination exceeded the safe page limit.')
    } while (cursor)
    await this.options.store.transact((draft) => {
      draft.endpointLocators = [
        ...draft.endpointLocators.filter((item) => item.humanEndpointId !== humanEndpointId),
        ...locators
      ]
    })
    return locators.length
  }

  async refreshManagedContainers(): Promise<readonly ManagedProviderContainer[]> {
    const response = await this.executeAsUser(restRequestSchema.parse({
      protocolVersion: '1.0',
      requestId: collaborationRequestId(),
      type: 'managed_container.list'
    }))
    if (response.type === 'rest.error') throw new Error(response.error.message)
    if (response.type !== 'rest.collection' || response.items.some((item) => item.type !== 'managed_provider_container')) {
      throw new Error(`Managed Channel query returned unexpected ${response.type}.`)
    }
    const managedContainers = response.items.filter((item): item is ManagedProviderContainer => (
      item.type === 'managed_provider_container'
    ))
    await this.options.store.transact((draft) => { draft.managedContainers = managedContainers })
    return managedContainers
  }

  private async pollLoop(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      await delay(15_000, signal).catch(() => undefined)
      if (signal.aborted) return
      try {
        await this.heartbeat('online')
        await this.pullInbox()
        this.connectionState = {
          state: 'connected',
          lastConnectedAt: this.now().toISOString()
        }
        this.options.outbox.start()
      } catch (error) {
        this.recordError(error, true)
      }
    }
  }

  private async heartbeat(connectionStatus: 'online' | 'offline'): Promise<void> {
    const localAgentId = await this.localAgentId()
    const agent = this.options.store.snapshot().agents.find((candidate) => (
      candidate.agentId === localAgentId
    ))
    if (!agent || agent.lifecycleStatus !== 'active') {
      throw new Error('This installation has no active collaboration Agent registration.')
    }
    const response = await this.options.agentCloudRuntime.execute({
      agentId: agent.agentId,
      request: restRequestSchema.parse({
        protocolVersion: '1.0',
        requestId: collaborationRequestId(),
        type: 'agent.heartbeat',
        idempotencyKey: `idem_agent.heartbeat.${digest([
          agent.agentId,
          String(agent.revision),
          connectionStatus
        ].join('\u0000')).slice(0, 48)}`,
        agentId: agent.agentId,
        expectedRevision: agent.revision,
        connectionStatus,
        capabilities: agent.capabilities
      })
    })
    if (response.type === 'rest.error') throw new Error(response.error.message)
    if (
      response.type !== 'rest.entity' ||
      response.entity.type !== 'agent_node' ||
      response.entity.agentId !== agent.agentId ||
      response.entity.ownerUserId !== agent.ownerUserId
    ) {
      throw new Error(`Agent heartbeat returned an invalid response (${response.type}).`)
    }
    const updatedAgent = response.entity
    await this.options.store.transact((draft) => {
      draft.agents = replaceBy(draft.agents, updatedAgent, (item) => item.agentId)
    })
    await this.options.afterHeartbeat?.(connectionStatus)
  }

  private async notificationLoop(agentId: string, signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        for await (const event of this.options.agentCloudRuntime.observeAgentInbox(agentId, signal)) {
          if (event.type === 'inbox.available' && event.recipientType === 'agent') {
            await this.pullInbox()
          }
          if (event.type === 'connection.error') throw new Error(event.error.message)
        }
      } catch (error) {
        if (signal.aborted) return
        this.connectionState = {
          state: 'recovering',
          lastConnectedAt: this.connectionState.lastConnectedAt,
          lastError: safeError(error, this.options.sanitizeText)
        }
        await delay(5_000, signal).catch(() => undefined)
      }
    }
  }

  private pullInbox(): Promise<void> {
    const drain = async () => {
      const afterSequence = this.options.store.snapshot().lastInboxSequence
      const localAgentId = await this.requireLocalAgentId()
      const page = await this.options.agentCloudRuntime.pullAgentInbox({
        agentId: localAgentId,
        afterSequence,
        limit: 100
      })
      const sorted = [...page.messages].sort((left, right) => left.sequence - right.sequence)
      for (const message of sorted) {
        if (message.recipientType !== 'agent') continue
        if (!localAgentId || message.recipientAgentId !== localAgentId) {
          throw new Error('Cloud returned an inbox message for another Agent.')
        }
        if (message.sequence <= this.options.store.snapshot().lastInboxSequence) continue
        await this.options.inboxHandler.handle(message)
        await this.persistInboxAck(message)
      }
    }
    // A rejected event must stop this cursor advance, but it must not poison
    // the serialized pull tail forever. Explicit recovery can re-fetch the same
    // unacknowledged event after the authorization/binding issue is repaired.
    this.pullTail = this.pullTail.then(drain, drain)
    return this.pullTail
  }

  private async persistInboxAck(message: AgentInboxMessage): Promise<void> {
    const idempotencyKey = `idem_inbox.ack.${digest(message.inboxMessageId).slice(0, 48)}`
    const request = restRequestSchema.parse({
      protocolVersion: '1.0',
      requestId: collaborationRequestId(),
      type: 'inbox.ack',
      idempotencyKey,
      inboxMessageId: message.inboxMessageId,
      sequence: message.sequence
    })
    await this.options.store.transact((draft) => {
      if (message.sequence !== draft.lastInboxSequence + 1 && draft.lastInboxSequence !== 0) {
        throw new Error('Agent inbox sequence contains a gap.')
      }
      draft.lastInboxSequence = message.sequence
      if (draft.outbox.some((entry) => entry.idempotencyKey === idempotencyKey)) return
      const now = this.now().toISOString()
      draft.outbox.push({
        outboxId: `obx_${randomUUID().replaceAll('-', '')}`,
        idempotencyKey,
        kind: 'inbox.ack',
        body: request,
        state: 'pending',
        attempts: 0,
        createdAt: now,
        updatedAt: now
      })
    })
    this.options.outbox.wake()
  }

  private async requireLocalAgentId(): Promise<string> {
    const agentId = await this.localAgentId()
    if (!agentId) throw new Error('This installation has no active collaboration Agent registration.')
    return agentId
  }

  private requireIdentityReady(): Extract<
    ReturnType<AuthenticatedCloudTransport['status']>,
    { state: 'ready' }
  > {
    const status = this.options.authenticatedCloudTransport.status()
    if (status.state === 'ready') return status
    if (status.state === 'identity_required') throw new Error('Sign in to SciForge Cloud before using collaboration.')
    if (status.state === 'device_required') throw new Error('Enroll this Desktop Device before using collaboration.')
    throw new Error(status.reason)
  }

  private recordError(error: unknown, recoverable: boolean): void {
    const message = safeError(error, this.options.sanitizeText)
    this.connectionState = {
      state: 'error',
      lastConnectedAt: this.connectionState.lastConnectedAt,
      lastError: message
    }
    void this.options.store.transact((draft) => {
      draft.diagnostics = [...draft.diagnostics, {
        code: 'collaboration.connection_error',
        severity: 'error' as const,
        message,
        occurredAt: this.now().toISOString(),
        recoverable
      }].slice(-256)
    }).catch(() => undefined)
  }
}

function mapAssurance(value: HumanEndpointBinding['assurance']): 'low' | 'verified' | 'strong' {
  if (value === 'strong') return 'strong'
  return value === 'verified' ? 'verified' : 'low'
}

function replaceBy<Value>(
  values: readonly Value[],
  replacement: Value,
  id: (value: Value) => string
): Value[] {
  return [...values.filter((value) => id(value) !== id(replacement)), replacement]
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason)
      return
    }
    const timeout = setTimeout(resolve, milliseconds)
    signal.addEventListener('abort', () => {
      clearTimeout(timeout)
      reject(signal.reason)
    }, { once: true })
  })
}

function safeError(error: unknown, sanitizeText?: (value: string) => string): string {
  const value = error instanceof Error ? error.message : 'Collaboration connection failed.'
  return (sanitizeText?.(value) ?? value)
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{6,}/giu, '[REDACTED]')
    .replace(/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/gu, '[REDACTED]')
    .slice(0, 4_000)
}

export function isIdempotentWriteRequest(request: RestRequest): request is RestRequest & { idempotencyKey: string } {
  return 'idempotencyKey' in request
}
