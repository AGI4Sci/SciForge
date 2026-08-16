import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  restRequestSchema,
  type AgentInboxMessage,
  type AgentNode,
  type HumanEndpointBinding,
  type ParticipantProfile,
  type RestRequest,
  type UserPrincipal
} from '@sciforge/collaboration-contracts'
import type { DomainMainPackageSecretStoreHost } from '@sciforge/domain-sdk/package-storage'
import type {
  CollaborationAgentRegisterInput,
  CollaborationConnectionConnectInput,
  CollaborationEndpointChallengePollInput,
  CollaborationEndpointChallengeStartInput,
  CollaborationProviderOption
} from '../contract.js'
import type { CollaborationCloudClient } from './cloud-client.js'
import { collaborationRequestId } from './cloud-client.js'
import { DurableCloudOutbox } from './outbox.js'
import { CollaborationSettingsService } from './settings.js'
import { CollaborationLocalStore } from './store.js'

const USER_CREDENTIAL_KEY = 'user-credential' as const
const DEVICE_CREDENTIAL_KEY = 'device-credential' as const
const PAIRING_POLL_KEY = 'pairing-poll' as const

const pairingPollSecretSchema = z.object({
  challengeId: z.string().regex(/^chl_[A-Za-z0-9]{12,64}$/),
  pollSecret: z.string().min(32).max(512),
  expiresAt: z.iso.datetime({ offset: true })
}).strict()

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
  packageSecrets: DomainMainPackageSecretStoreHost
  outbox: DurableCloudOutbox
  createCloudClient: (baseUrl: string) => CollaborationCloudClient
  inboxHandler: CollaborationInboxHandler
  sanitizeText?: (value: string) => string
  now?: () => Date
}>

export class CollaborationConnection {
  private readonly now: () => Date
  private client: CollaborationCloudClient | null = null
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

  cloudClient(): CollaborationCloudClient | null {
    return this.client
  }

  async executeAsUser(request: RestRequest) {
    return this.requireClient().execute(restRequestSchema.parse(request), await this.requireUserCredential())
  }

  async executeAsDevice(request: RestRequest) {
    return this.requireClient().execute(restRequestSchema.parse(request), await this.requireDeviceCredential())
  }

  async localAgentId(): Promise<string | undefined> {
    const configured = await this.options.settings.read()
    if (!configured.settings) return undefined
    return this.options.store.snapshot().agents.find((agent) => (
      agent.installationId === configured.settings!.installationId
    ))?.agentId
  }

  async acceptAgentRevocation(agentId: string, occurredAt: string): Promise<void> {
    const localAgentId = await this.localAgentId()
    if (!localAgentId || localAgentId !== agentId) {
      throw new Error('Agent revocation does not target this installation.')
    }
    await this.options.packageSecrets.remove(DEVICE_CREDENTIAL_KEY)
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
    this.client = this.options.createCloudClient(configured.settings.baseUrl)
    await this.refreshProviderCatalog().catch((error) => this.recordError(error, false))
    const cachedUser = this.options.store.snapshot().user
    if (cachedUser && await this.options.packageSecrets.has(USER_CREDENTIAL_KEY)) {
      try {
        const snapshot = await this.refreshParticipant(cachedUser.userId)
        for (const endpoint of snapshot.humanEndpoints) {
          if (endpoint.status === 'active') {
            await this.refreshEndpointLocators(endpoint.humanEndpointId)
          }
        }
      } catch (error) {
        // Cached collaboration state remains usable while offline. A later
        // explicit recovery/restart repeats this canonical cloud refresh.
        this.recordError(error, true)
      }
    }
    if (await this.options.packageSecrets.has(DEVICE_CREDENTIAL_KEY)) {
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
    const settings = await this.options.settings.configure(baseUrl)
    this.client = this.options.createCloudClient(settings.baseUrl)
    this.connectionState = { state: 'disconnected' }
    await this.refreshProviderCatalog()
  }

  async applyConnectionAction(input: CollaborationConnectionConnectInput): Promise<void> {
    if (input.action === 'disconnect') {
      const credential = await this.options.packageSecrets.read(DEVICE_CREDENTIAL_KEY)
      if (credential && this.client) {
        await this.heartbeat({ value: credential }, 'offline').catch((error) => {
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
    const client = this.requireClient()
    const realmId = input.locator.realmId?.trim()
    if (!realmId) throw new Error('The selected provider requires a realmId locator value.')
    const request = restRequestSchema.parse({
      protocolVersion: '1.0',
      requestId: collaborationRequestId(),
      type: 'pairing.begin',
      idempotencyKey: `idem_pairing.begin.${digest([
        input.providerKey,
        realmId,
        input.requestedDisplayName,
        String(this.now().getTime())
      ].join('\u0000')).slice(0, 48)}`,
      provider: input.providerKey,
      realmId,
      requestedDisplayName: input.requestedDisplayName
    })
    const response = await client.execute(request)
    if (response.type === 'rest.error') throw new Error(response.error.message)
    if (response.type !== 'pairing.begun') {
      throw new Error(`Pairing begin returned unexpected ${response.type}.`)
    }
    const pairingCommand = `sciforge-pair ${response.challengeId} ${response.challengeCode}`
    if (pairingCommand.length > 64) {
      throw new Error('Pairing service returned a command that exceeds the supported display length.')
    }
    await this.options.packageSecrets.write(PAIRING_POLL_KEY, JSON.stringify({
      challengeId: response.challengeId,
      pollSecret: response.pollSecret,
      expiresAt: response.expiresAt
    }))
    const providerLabel = this.providerOptions.find((provider) => (
      provider.providerKey === input.providerKey
    ))?.label ?? input.providerKey
    return {
      challengeId: response.challengeId,
      pairingCode: pairingCommand,
      expiresAt: response.expiresAt,
      instruction: `Send this entire command unchanged in ${providerLabel}, in the designated pairing topic or any topic visible to its SciForge integration.`
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
    const rawSecret = await this.options.packageSecrets.read(PAIRING_POLL_KEY)
    if (!rawSecret) return { status: 'expired' }
    const poll = pairingPollSecretSchema.parse(JSON.parse(rawSecret) as unknown)
    if (poll.challengeId !== input.challengeId || Date.parse(poll.expiresAt) <= this.now().getTime()) {
      await this.options.packageSecrets.remove(PAIRING_POLL_KEY)
      return { status: 'expired' }
    }
    const response = await this.requireClient().execute(restRequestSchema.parse({
      protocolVersion: '1.0',
      requestId: collaborationRequestId(),
      type: 'pairing.redeem',
      idempotencyKey: `idem_pairing.redeem.${digest(poll.challengeId).slice(0, 48)}`,
      pollSecret: poll.pollSecret
    }))
    if (response.type === 'pairing.pending') {
      return {
        status: 'pending',
        expiresAt: poll.expiresAt,
        retryAfterSeconds: response.retryAfterSeconds
      }
    }
    if (response.type === 'rest.error' && response.error.code === 'expired') {
      await this.options.packageSecrets.remove(PAIRING_POLL_KEY)
      return { status: 'expired' }
    }
    if (response.type === 'rest.error') throw new Error(response.error.message)
    if (response.type !== 'pairing.verified') {
      throw new Error(`Pairing redeem returned unexpected ${response.type}.`)
    }
    await this.options.packageSecrets.write(USER_CREDENTIAL_KEY, response.userCredential)
    await this.options.packageSecrets.remove(PAIRING_POLL_KEY)
    const snapshot = await this.refreshParticipant(response.userId)
    await this.refreshEndpointLocators(response.humanEndpointId)
    const endpoint = snapshot.humanEndpoints.find((item) => (
      item.humanEndpointId === response.humanEndpointId
    ))
    return {
      status: 'verified',
      userId: response.userId,
      humanEndpointId: response.humanEndpointId,
      assurance: mapAssurance(endpoint?.assurance ?? 'verified')
    }
  }

  async registerAgent(input: CollaborationAgentRegisterInput): Promise<AgentNode> {
    const settings = await this.options.settings.require()
    const credential = await this.requireUserCredential()
    const state = this.options.store.snapshot()
    if (!state.user) throw new Error('Verify a human endpoint before registering this Agent.')
    const response = await this.requireClient().execute(restRequestSchema.parse({
      protocolVersion: '1.0',
      requestId: collaborationRequestId(),
      type: 'agent.register',
      idempotencyKey: `idem_agent.register.${digest(settings.installationId).slice(0, 48)}`,
      ownerUserId: state.user.userId,
      installationId: settings.installationId,
      displayName: input.displayName,
      nodeType: input.nodeType,
      capabilities: input.capabilities
    }), credential)
    if (response.type === 'rest.error') throw new Error(response.error.message)
    if (response.type !== 'agent.registered') {
      throw new Error(`Agent registration returned unexpected ${response.type}.`)
    }
    await this.options.packageSecrets.write(DEVICE_CREDENTIAL_KEY, response.deviceCredential)
    await this.options.store.transact((draft) => {
      draft.agents = replaceBy(draft.agents, response.agent, (item) => item.agentId)
    })
    // Registration can atomically promote the first Agent to participant
    // primary and advance the participant revision. Refresh with the existing
    // user credential before connecting so renderer CAS inputs never expose the
    // pre-registration snapshot. The one-time device credential remains opaque
    // in the secret store until the device connection path reads it.
    await this.refreshParticipant(state.user.userId)
    await this.connect()
    return response.agent
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
    const response = await this.requireClient().execute(restRequestSchema.parse({
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
    }), await this.requireUserCredential())
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
    const response = await this.requireClient().execute(restRequestSchema.parse({
      protocolVersion: '1.0',
      requestId: collaborationRequestId(),
      type: 'participant.get',
      userId: targetUserId
    }), await this.requireUserCredential())
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
    const client = this.requireClient()
    const credential = await this.requireDeviceCredential()
    this.connectionState = { state: 'connecting' }
    const controller = new AbortController()
    this.abortController = controller
    try {
      await this.heartbeat(credential, 'online')
      await this.pullInbox(credential)
      this.connectionState = {
        state: 'connected',
        lastConnectedAt: this.now().toISOString()
      }
      this.options.outbox.start()
      this.background = [
        this.pollLoop(credential, controller.signal),
        this.notificationLoop(client, credential, controller.signal)
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
    if (this.client) this.connectionState = { state: 'disconnected' }
  }

  private async refreshProviderCatalog(): Promise<void> {
    const response = await this.requireClient().execute(restRequestSchema.parse({
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
      locatorFields: [{
        key: 'realmId',
        label: 'Organization / realm ID',
        required: true,
        placeholder: 'Provider organization identity'
      }]
    }))
  }

  private async refreshEndpointLocators(humanEndpointId: string): Promise<void> {
    const response = await this.requireClient().execute(restRequestSchema.parse({
      protocolVersion: '1.0',
      requestId: collaborationRequestId(),
      type: 'endpoint.locator.list',
      humanEndpointId,
      limit: 100
    }), await this.requireUserCredential())
    if (response.type === 'rest.error') throw new Error(response.error.message)
    if (response.type !== 'endpoint.locator_page') {
      throw new Error(`Endpoint locator query returned unexpected ${response.type}.`)
    }
    await this.options.store.transact((draft) => {
      draft.endpointLocators = [
        ...draft.endpointLocators.filter((item) => item.humanEndpointId !== humanEndpointId),
        ...response.locators.map((locator) => ({ humanEndpointId, locator }))
      ]
    })
  }

  private async pollLoop(credential: Readonly<{ value: string }>, signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      await delay(15_000, signal).catch(() => undefined)
      if (signal.aborted) return
      try {
        await this.heartbeat(credential, 'online')
        await this.pullInbox(credential)
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

  private async heartbeat(
    credential: Readonly<{ value: string }>,
    connectionStatus: 'online' | 'offline'
  ): Promise<void> {
    const settings = await this.options.settings.require()
    const agent = this.options.store.snapshot().agents.find((candidate) => (
      candidate.installationId === settings.installationId
    ))
    if (!agent || agent.lifecycleStatus !== 'active') {
      throw new Error('This installation has no active collaboration Agent registration.')
    }
    const response = await this.requireClient().execute(restRequestSchema.parse({
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
    }), credential)
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
  }

  private async notificationLoop(
    client: CollaborationCloudClient,
    credential: Readonly<{ value: string }>,
    signal: AbortSignal
  ): Promise<void> {
    while (!signal.aborted) {
      try {
        for await (const event of client.observeAgentInbox(credential, signal)) {
          if (event.type === 'inbox.available' && event.recipientType === 'agent') {
            await this.pullInbox(credential)
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

  private pullInbox(credential: Readonly<{ value: string }>): Promise<void> {
    const drain = async () => {
      const afterSequence = this.options.store.snapshot().lastInboxSequence
      const page = await this.requireClient().pullAgentInbox({
        afterSequence,
        limit: 100,
        credential
      })
      const sorted = [...page.messages].sort((left, right) => left.sequence - right.sequence)
      const installationId = (await this.options.settings.require()).installationId
      for (const message of sorted) {
        if (message.recipientType !== 'agent') continue
        const localAgentId = this.options.store.snapshot().agents.find((agent) => (
          agent.installationId === installationId
        ))?.agentId
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

  private requireClient(): CollaborationCloudClient {
    if (!this.client) throw new Error('Collaboration service is not configured.')
    return this.client
  }

  private async requireUserCredential(): Promise<Readonly<{ value: string }>> {
    const value = await this.options.packageSecrets.read(USER_CREDENTIAL_KEY)
    if (!value) throw new Error('Verified collaboration user credential is unavailable.')
    return { value }
  }

  private async requireDeviceCredential(): Promise<Readonly<{ value: string }>> {
    const value = await this.options.packageSecrets.read(DEVICE_CREDENTIAL_KEY)
    if (!value) throw new Error('Agent device credential is unavailable.')
    return { value }
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
