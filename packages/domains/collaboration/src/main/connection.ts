import { createHash, randomUUID } from 'node:crypto'
import {
  encodePairingBindCode,
  restRequestSchema,
  restResponseSchema,
  type AgentInboxMessage,
  type AgentNode,
  type AgentProfilePublicProjection,
  type CloudProjectDashboard,
  type DeviceReadinessProjection,
  type HumanEndpointBinding,
  type ManagedProviderContainer,
  type NotificationProjection,
  type ProviderLocator,
  type ParticipantProfile,
  type RestRequest,
  type RestResponse,
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
  CollaborationConnectionConnectInput,
  CollaborationEndpointChallengePollInput,
  CollaborationEndpointChallengeStartInput,
  CollaborationProviderOption
} from '../contract.js'
import { collaborationRequestId } from './request-id.js'
import { DurableCloudOutbox } from './outbox.js'
import { CollaborationSettingsService, normalizeCollaborationBaseUrl } from './settings.js'
import { CollaborationLocalStore } from './store.js'
import { waitForRefresh } from '../refresh-await.js'

const INBOX_DEFERRED_DIAGNOSTIC = 'collaboration.inbox_deferred'
const DASHBOARD_SYNC_DIAGNOSTIC = 'collaboration.dashboard_sync_error'
const DASHBOARD_READ_CONCURRENCY = 4
const DASHBOARD_REFRESH_TIMEOUT_MS = 30_000

export type CollaborationConnectionState = Readonly<{
  state: 'unconfigured' | 'disconnected' | 'connecting' | 'connected' | 'recovering' | 'error'
  lastConnectedAt?: string
  lastError?: string
}>

export type CollaborationInboxHandler = Readonly<{
  /** Return `deferred` when the message must remain unACKed for a later drain. */
  handle(message: AgentInboxMessage): Promise<void | 'deferred'>
}>

export type CollaborationConnectionOptions = Readonly<{
  store: CollaborationLocalStore
  settings: CollaborationSettingsService
  outbox: DurableCloudOutbox
  authenticatedCloudTransport: AuthenticatedCloudTransport
  agentCloudRuntime: AgentCloudRuntime
  inboxHandler: CollaborationInboxHandler
  afterHeartbeat?: (connectionStatus: 'online' | 'offline') => void | Promise<void>
  onAuthorityLost?: (agentId: string, reason: string, cause: AgentCloudRuntimeError) => void | Promise<void>
  onAuthorityUnverified?: (agentId: string, reason: string) => void | Promise<void>
  sanitizeText?: (value: string) => string
  now?: () => Date
}>

export class CollaborationConnection {
  private readonly now: () => Date
  private connectionState: CollaborationConnectionState = { state: 'unconfigured' }
  private providerOptions: readonly CollaborationProviderOption[] = []
  private readonly dashboards = new Map<string, CloudProjectDashboard>()
  private publicAgentProfiles: readonly AgentProfilePublicProjection[] = []
  private deviceReadiness: readonly DeviceReadinessProjection[] = []
  private notifications: readonly NotificationProjection[] = []
  private abortController: AbortController | null = null
  /**
   * Connect is single-flight. A newer generation may start only after an
   * explicit disconnect or revocation invalidated the in-flight attempt; the
   * generation checks below keep a late heartbeat/poll/catch from that older
   * attempt from mutating the current controller or connection state.
   */
  private connectRun: Promise<void> | undefined
  private connectRunGeneration = 0
  private connectionGeneration = 0
  private pullTail: Promise<void> = Promise.resolve()
  private background: Promise<void>[] = []
  private authorityRecoveryTimer: ReturnType<typeof setTimeout> | undefined
  private authorityRecoveryRun: Promise<void> | undefined
  private authorityRecoveryStopped = false
  private authorityRecoveryDelayMs = 1_000
  private dashboardRefresh: Promise<void> | null = null
  private dashboardRefreshQueued = false
  private dashboardController: AbortController | null = null

  constructor(private readonly options: CollaborationConnectionOptions) {
    this.now = options.now ?? (() => new Date())
  }

  state(): CollaborationConnectionState {
    return this.connectionState
  }

  providers(): readonly CollaborationProviderOption[] {
    return this.providerOptions
  }

  cloudDashboards(): readonly CloudProjectDashboard[] {
    return [...this.dashboards.values()].map((dashboard) => structuredClone(dashboard))
  }

  publicCoordinationSlices(): Readonly<{
    agentProfiles: readonly AgentProfilePublicProjection[]
    devices: readonly DeviceReadinessProjection[]
    notifications: readonly NotificationProjection[]
  }> {
    return {
      agentProfiles: structuredClone(this.publicAgentProfiles),
      devices: structuredClone(this.deviceReadiness),
      notifications: structuredClone(this.notifications)
    }
  }

  async executeAsUser(request: RestRequest, options?: Readonly<{ signal?: AbortSignal }>) {
    const parsed = restRequestSchema.parse(request)
    this.requireIdentityReady()
    const response = await this.options.authenticatedCloudTransport.execute({
      contractVersion: 1,
      operationId: AUTHENTICATED_CLOUD_COMMAND_OPERATION_ID,
      payload: authenticatedCloudJsonBody(parsed)
    }, options)
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

  /**
   * The one source of this installation's current Agent identity. Every local
   * consumer reads it here, so an identity that becomes ready after startup is
   * seen by the outbox and the Worker intake at the same moment as the
   * connection itself.
   */
  localAgentId(): string | undefined {
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
    const localAgentId = this.localAgentId()
    if (!localAgentId || localAgentId !== agentId) {
      throw new Error('Agent revocation does not target this installation.')
    }
    await this.options.agentCloudRuntime.fenceAgent(agentId)
    this.connectionGeneration += 1
    this.dashboardController?.abort(new Error('Collaboration Agent authority was revoked.'))
    this.dashboardRefreshQueued = false
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
      lastError: 'This Desktop Agent was revoked.'
    }
  }

  async activate(): Promise<void> {
    const configured = await this.options.settings.read()
    if (!configured.settings) {
      this.connectionState = { state: 'unconfigured' }
      // A signed-in Desktop joins Collaboration on its identity's Cloud without a manual step.
      if (this.options.authenticatedCloudTransport.status().state === 'ready') {
        await this.configure().catch((error) => { this.recordError(error, true) })
      }
      return
    }
    this.authorityRecoveryStopped = false
    const identityStatus = this.options.authenticatedCloudTransport.status()
    if ('baseUrl' in identityStatus &&
        normalizeCollaborationBaseUrl(configured.settings.baseUrl) !==
          normalizeCollaborationBaseUrl(identityStatus.baseUrl)) {
      throw new Error('Collaboration Cloud settings do not match the active Identity Cloud endpoint.')
    }
    if (identityStatus.state === 'ready') {
      try {
        await this.refreshCloudState()
      } catch {
        // Cached collaboration state remains usable while offline. A later
        // explicit recovery/restart repeats this canonical cloud refresh.
      }
    }
    const localAgentId = this.localAgentId()
    if (localAgentId &&
        (await this.options.agentCloudRuntime.authorityStatus(localAgentId)).state === 'ready') {
      // A configured desktop must still activate while the cloud is offline. The
      // durable inbox/outbox and projection recovery remain available, and the
      // explicit recover action retries the same canonical connection path.
      await this.connect().catch(() => undefined)
    } else {
      this.connectionState = { state: 'disconnected' }
    }
    // Identity may become ready after this startup activation. The same
    // authority-recovery path that resumes a lost connection then joins.
    if (this.connectionState.state !== 'connected') this.scheduleAuthorityRecovery()
  }

  async dispose(): Promise<void> {
    this.stopAuthorityRecovery()
    await this.disconnect()
  }

  async configure(baseUrl?: string): Promise<void> {
    this.authorityRecoveryDelayMs = 1_000
    this.authorityRecoveryStopped = false
    const status = this.requireIdentityReady()
    if (baseUrl !== undefined && normalizeCollaborationBaseUrl(baseUrl) !== normalizeCollaborationBaseUrl(status.baseUrl)) {
      throw new Error('Collaboration Cloud must use the active Identity Cloud endpoint.')
    }
    await this.disconnect()
    await this.options.settings.configure(status.baseUrl)
    this.connectionState = { state: 'disconnected' }
    await this.refreshCloudState()
    await this.connect()
  }

  async applyConnectionAction(input: CollaborationConnectionConnectInput): Promise<void> {
    this.authorityRecoveryDelayMs = 1_000
    if (input.action === 'disconnect') {
      this.stopAuthorityRecovery()
      const localAgentId = this.localAgentId()
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
      this.authorityRecoveryStopped = false
      this.options.outbox.wake()
    }
    if (input.action === 'connect') this.authorityRecoveryStopped = false
    await this.refreshCloudState()
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

  async ensureLocalAgent(): Promise<AgentNode> {
    const identity = this.requireIdentityReady()
    await this.options.store.prepareForAuthenticatedUser(identity.userId)
    const state = this.options.store.snapshot()
    if (state.user && state.user.userId !== identity.userId) {
      throw new Error('Cached collaboration state belongs to another OIDC User.')
    }
    const agent = await this.options.agentCloudRuntime.ensureAgent()
    if (agent.deviceId !== identity.deviceId || agent.ownerUserId !== identity.userId) {
      throw new Error('The ensured Agent does not match the current User and Device.')
    }
    await this.options.store.transact((draft) => {
      draft.agents = replaceBy(draft.agents, agent, (item) => item.agentId)
    })
    return agent
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

  connect(): Promise<void> {
    if (this.abortController && this.connectionState.state === 'connected') {
      return Promise.resolve()
    }
    if (this.connectRun && this.connectRunGeneration === this.connectionGeneration) {
      // Reuse the in-flight attempt. Replacing it would leave its heartbeat,
      // inbox pull and late catch racing the attempt that is supposed to win.
      return this.connectRun
    }
    const generation = this.connectionGeneration + 1
    this.connectionGeneration = generation
    this.connectRunGeneration = generation
    const run = this.connectAttempt(generation).finally(() => {
      if (this.connectRun === run) this.connectRun = undefined
    })
    this.connectRun = run
    return run
  }

  private async connectAttempt(generation: number): Promise<void> {
    if (!this.isCurrentGeneration(generation)) return
    if (this.abortController) {
      // The previous attempt left a live poller (for example after a poll
      // failure). An explicit connect/recover must replace it, not resolve
      // silently without touching the connection.
      await this.stopCurrentConnection()
    }
    if (!this.isCurrentGeneration(generation)) return
    const agentId = await this.requireLocalAgentId()
    if (!this.isCurrentGeneration(generation)) return
    let controller: AbortController | undefined
    try {
      const authority = await this.options.agentCloudRuntime.authorityStatus(agentId)
      if (!this.isCurrentGeneration(generation)) return
      if (authority.state !== 'ready') throw authorityStatusError(authority)
      this.connectionState = { state: 'connecting' }
      controller = new AbortController()
      this.abortController = controller
      await this.heartbeat('online', controller.signal)
      if (!this.isCurrentGeneration(generation)) {
        controller.abort()
        return
      }
      await this.pullInbox(controller.signal)
      if (!this.isCurrentGeneration(generation)) {
        controller.abort()
        return
      }
      await this.recordConnected()
      if (!this.isCurrentGeneration(generation)) {
        controller.abort()
        return
      }
      this.options.outbox.start()
      this.background = [
        this.pollLoop(agentId, controller.signal),
        this.notificationLoop(agentId, controller.signal)
      ]
    } catch (error) {
      controller?.abort(error)
      // A superseded attempt reports nothing: its late failure must not clear
      // the current controller or overwrite the newer connection state.
      if (!this.isCurrentGeneration(generation)) return
      if (await this.failClosedAuthority(agentId, error)) throw error
      this.abortController = null
      this.recordError(error, true)
      throw error
    }
  }

  async disconnect(): Promise<void> {
    // Invalidate the in-flight generation first so a late heartbeat, inbox
    // pull or catch from the cancelled attempt cannot touch this connection.
    this.connectionGeneration += 1
    this.dashboardController?.abort(new Error('Collaboration connection changed.'))
    this.dashboardRefreshQueued = false
    const controller = this.abortController
    this.abortController = null
    if (controller) controller.abort()
    const background = this.background
    this.background = []
    this.options.outbox.stop()
    await Promise.allSettled(background)
    if ((await this.options.settings.read()).settings) {
      this.connectionState = { state: 'disconnected' }
    }
  }

  private isCurrentGeneration(generation: number): boolean {
    return this.connectionGeneration === generation
  }

  private assertConnectionActive(signal?: AbortSignal): void {
    if (signal?.aborted) throw new Error('The connection attempt was cancelled.')
  }

  /** Abort a previous live connection without invalidating the new attempt. */
  private async stopCurrentConnection(): Promise<void> {
    const controller = this.abortController
    this.abortController = null
    if (controller) controller.abort()
    const background = this.background
    this.background = []
    this.options.outbox.stop()
    await Promise.allSettled(background)
  }

  /** Re-run the canonical inbox drain after a deferred owner becomes ready. */
  resumeInbox(): void {
    if (this.connectionState.state !== 'connected') return
    void this.pullInbox(this.abortController?.signal).catch((error: unknown) => {
      if (this.abortController) this.recordError(error, true)
    })
  }

  private async refreshCloudState(): Promise<void> {
    try {
      await this.refreshProviderCatalog()
      const agent = await this.ensureLocalAgent()
      const snapshot = await this.refreshParticipant(agent.ownerUserId)
      // Dashboard hydration is an additive read projection. A Cloud version
      // that predates the optional fields must not prevent the canonical
      // participant/provider/inbox connection from recovering.
      await this.refreshDashboards().catch(() => undefined)
      for (const endpoint of snapshot.humanEndpoints) {
        if (endpoint.status === 'active') {
          await this.refreshEndpointLocators(endpoint.humanEndpointId)
        }
      }
      if (this.providerOptions.some((provider) => provider.managedContainers)) {
        await this.refreshManagedContainers()
      }
      await this.clearDiagnostics('collaboration.cloud_sync_error')
    } catch (error) {
      this.recordDiagnostic(error, true, 'collaboration.cloud_sync_error')
      throw error
    }
  }

  /**
   * The single Dashboard refresh path. Connect/recover, Cloud wake hints,
   * completed Desktop commands, the foreground page refresh and the Dashboard
   * shell's explicit refresh all call it. Commands and wake hints coalesce
   * into a queued re-read; page reads only join the current refresh.
   */
  refreshDashboards(): Promise<void> {
    if (this.dashboardRefresh) {
      this.dashboardRefreshQueued = true
      return this.dashboardRefresh
    }
    const controller = new AbortController()
    const generation = this.connectionGeneration
    this.dashboardController = controller
    const timer = setTimeout(() => controller.abort(new Error('Dashboard refresh timed out.')), DASHBOARD_REFRESH_TIMEOUT_MS)
    const run = async (): Promise<void> => {
      do {
        this.dashboardRefreshQueued = false
        try {
          await waitForRefresh(this.refreshProjectDashboards(controller.signal, generation), controller.signal)
          await this.clearDiagnostics(DASHBOARD_SYNC_DIAGNOSTIC).catch(() => undefined)
        } catch (error) {
          controller.abort(error)
          // Persist before releasing the single flight: a following success
          // must see and clear this diagnostic, including for joined reads.
          if (this.isCurrentGeneration(generation)) await this.recordDiagnostic(error, true, DASHBOARD_SYNC_DIAGNOSTIC)
          throw error
        }
      } while (this.dashboardRefreshQueued)
    }
    const pending = run().finally(() => {
      clearTimeout(timer)
      controller.abort()
      if (this.dashboardRefresh === pending) this.dashboardRefresh = null
      if (this.dashboardController === controller) this.dashboardController = null
    })
    this.dashboardRefresh = pending
    return pending
  }

  /**
   * The foreground page refresh path. It joins the same single-flight
   * Dashboard read, records the existing Dashboard diagnostic when the read
   * fails, and clears it after a successful read; a failed refresh never
   * interrupts the page's status response.
   */
  async refreshDashboardsForPage(): Promise<void> {
    if (this.options.authenticatedCloudTransport.status().state !== 'ready') return
    // Polling must not extend an in-flight read past the next polling tick.
    // The shared refresh owns diagnostics regardless of who initiated it.
    await (this.dashboardRefresh ?? this.refreshDashboards()).catch(() => undefined)
  }

  /**
   * Hydrate the UI from the existing OIDC user project/read command. The local
   * store remains a cache; no Dashboard task or notification authority is
   * created here. A failed refresh leaves the last Cloud snapshot available
   * and is reported by the normal connection diagnostic path.
   */
  private async refreshProjectDashboards(signal: AbortSignal, generation: number): Promise<void> {
    const identity = this.requireIdentityReady()
    const assertCurrent = () => {
      signal.throwIfAborted()
      const current = this.requireIdentityReady()
      if (!this.isCurrentGeneration(generation) || current.baseUrl !== identity.baseUrl ||
          current.userId !== identity.userId || current.deviceId !== identity.deviceId ||
          current.deviceRevision !== identity.deviceRevision) throw new Error('Dashboard authority changed.')
    }
    const projects: Array<{ projectId: string }> = []
    let cursor: string | undefined
    for (let page = 0; page < 1_000; page += 1) {
      assertCurrent()
      const response = await this.executeAsUser(restRequestSchema.parse({
        protocolVersion: '1.0',
        requestId: collaborationRequestId(),
        type: 'project.list',
        ...(cursor ? { cursor } : {}),
        limit: 250
      }), { signal })
      assertCurrent()
      if (response.type === 'rest.error') {
        // Invited members have a deliberately bounded Cloud read surface; the
        // dashboard projection is optional for them until the plan is accepted.
        if (response.error.code === 'permission_denied') return
        throw new Error(response.error.message)
      }
      if (response.type !== 'rest.project_page') {
        throw new Error(`Project list returned unexpected ${response.type}.`)
      }
      projects.push(...response.projects.map(({ projectId }) => ({ projectId })))
      cursor = response.nextCursor
      if (!cursor) break
    }
    if (cursor) throw new Error('Project list pagination exceeded the safe page limit.')

    const next = new Map<string, CloudProjectDashboard>()
    let profiles: AgentProfilePublicProjection[] = []
    let devices: DeviceReadinessProjection[] = []
    let notifications: NotificationProjection[] = []
    const collections = [
      'user_label_facts', 'agent_label_facts', 'memberships', 'worker_availability',
      'plans', 'tasks', 'executions', 'offers', 'result_submissions',
      'review_decisions', 'project_records'
    ] as const
    const responses: Array<Extract<RestResponse, { type: 'rest.project_coordination' }> | undefined> = new Array(projects.length)
    let nextIndex = 0
    await Promise.all(Array.from({ length: Math.min(DASHBOARD_READ_CONCURRENCY, projects.length) }, async () => {
      while (nextIndex < projects.length) {
        assertCurrent()
        const index = nextIndex++
        const response = await this.executeAsUser(restRequestSchema.parse({
          protocolVersion: '1.0', requestId: collaborationRequestId(),
          type: 'project.coordination.read', projectId: projects[index]!.projectId,
          collections: collections.map((collection) => ({ collection, limit: 250 }))
        }), { signal })
        assertCurrent()
        if (response.type === 'rest.error') {
          if (response.error.code === 'permission_denied') continue
          throw new Error(response.error.message)
        }
        if (response.type !== 'rest.project_coordination' || response.project.projectId !== projects[index]!.projectId ||
            (response.dashboard && response.dashboard.projectId !== projects[index]!.projectId)) {
          throw new Error('Project coordination read returned an unexpected project or response.')
        }
        responses[index] = response
      }
    }))
    assertCurrent()
    for (const response of responses) {
      if (!response) continue
      if (response.dashboard) next.set(response.project.projectId, response.dashboard)
      profiles.push(...(response.agentProfiles ?? []))
      devices.push(...(response.devices ?? []))
      notifications.push(...(response.notifications ?? []))
    }
    this.dashboards.clear()
    for (const [projectId, dashboard] of next) this.dashboards.set(projectId, dashboard)
    this.publicAgentProfiles = profiles
    this.deviceReadiness = devices
    this.notifications = notifications
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
          placeholder: provider.provider === 'zulip'
            ? 'Numeric user ID of the Zulip account to pair'
            : 'Exact provider account identity'
        }
      ]
    }))
  }

  async refreshEndpointLocators(humanEndpointId: string): Promise<number> {
    const agentId = await this.requireLocalAgentId()
    const locators: Array<{ humanEndpointId: string; locator: ProviderLocator }> = []
    let cursor: string | undefined
    let pageCount = 0
    do {
      const response = await this.executeAsUser(restRequestSchema.parse({
        protocolVersion: '1.0',
        requestId: collaborationRequestId(),
        type: 'endpoint.locator.list',
        humanEndpointId,
        agentId,
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
    const agentId = await this.requireLocalAgentId()
    const response = await this.executeAsUser(restRequestSchema.parse({
      protocolVersion: '1.0',
      requestId: collaborationRequestId(),
      type: 'managed_container.list',
      agentId
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

  private async pollLoop(agentId: string, signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      await delay(15_000, signal).catch(() => undefined)
      if (signal.aborted) return
      try {
        await this.heartbeat('online', signal)
        if (signal.aborted) return
        await this.pullInbox(signal)
        if (signal.aborted) return
        await this.recordConnected()
        if (signal.aborted) return
        this.options.outbox.start()
      } catch (error) {
        if (signal.aborted) return
        if (await this.failClosedAuthority(agentId, error)) return
        this.recordError(error, true)
      }
    }
  }

  private async heartbeat(
    connectionStatus: 'online' | 'offline',
    signal?: AbortSignal
  ): Promise<void> {
    this.assertConnectionActive(signal)
    const localAgentId = this.localAgentId()
    const agent = this.options.store.snapshot().agents.find((candidate) => (
      candidate.agentId === localAgentId
    ))
    if (!agent || agent.lifecycleStatus !== 'active') {
      throw new Error('This installation has no active Desktop Agent.')
    }
    const authority = await this.options.agentCloudRuntime.authorityStatus(agent.agentId)
    this.assertConnectionActive(signal)
    if (authority.state !== 'ready') throw authorityStatusError(authority)
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
        capabilities: authority.capabilityTags
      })
    })
    this.assertConnectionActive(signal)
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
            // The wake hint already proves that an authoritative re-read is
            // needed; unrelated/deferred inbox handling must not delay it.
            void this.refreshDashboards().catch(() => undefined)
            await this.pullInbox(signal)
          }
          if (event.type === 'connection.error') throw new Error(event.error.message)
        }
      } catch (error) {
        if (signal.aborted) return
        if (await this.failClosedAuthority(agentId, error)) return
        this.connectionState = {
          state: 'recovering',
          lastConnectedAt: this.connectionState.lastConnectedAt,
          lastError: safeError(error, this.options.sanitizeText)
        }
        await delay(5_000, signal).catch(() => undefined)
      }
    }
  }

  private pullInbox(signal?: AbortSignal): Promise<void> {
    const drain = async () => {
      if (signal?.aborted) return
      const localAgentId = await this.requireLocalAgentId()
      const pageLimit = 100
      for (let pageCount = 0; pageCount < 1_000; pageCount += 1) {
        if (signal?.aborted) return
        const afterSequence = this.options.store.snapshot().lastInboxSequence
        const page = await this.options.agentCloudRuntime.pullAgentInbox({
          agentId: localAgentId,
          afterSequence,
          limit: pageLimit
        })
        if (signal?.aborted) return
        const sorted = [...page.messages].sort((left, right) => left.sequence - right.sequence)
        for (const message of sorted) {
          if (signal?.aborted) return
          if (message.recipientType !== 'agent') continue
          if (!localAgentId || message.recipientAgentId !== localAgentId) {
            throw new Error('Cloud returned an inbox message for another Agent.')
          }
          if (message.sequence <= this.options.store.snapshot().lastInboxSequence) continue
          const disposition = await this.options.inboxHandler.handle(message)
          if (disposition === 'deferred') {
            await this.recordInboxDeferred(message.sequence)
            return
          }
          await this.persistInboxAck(message)
          await this.clearDiagnostics(INBOX_DEFERRED_DIAGNOSTIC)
        }
        if (page.messages.length < pageLimit) return
        if (this.options.store.snapshot().lastInboxSequence <= afterSequence) {
          throw new Error('Agent inbox refill did not advance its durable sequence.')
        }
      }
      throw new Error('Agent inbox refill exceeded the safe page limit.')
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
    const agentId = this.localAgentId()
    if (!agentId) throw new Error('This installation has no active Desktop Agent.')
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
    this.recordDiagnostic(error, recoverable, 'collaboration.connection_error')
  }

  private async recordDiagnostic(error: unknown, recoverable: boolean, code: string): Promise<void> {
    const message = safeError(error, this.options.sanitizeText)
    await this.options.store.transact((draft) => {
      draft.diagnostics = [...draft.diagnostics, {
        code,
        severity: 'error' as const,
        message,
        occurredAt: this.now().toISOString(),
        recoverable
      }].slice(-256)
    }).catch(() => undefined)
  }

  /**
   * A deferred message keeps the durable cursor where it is while the
   * connection stays healthy. Surface that pause once so a Coordinator that
   * never subscribes is diagnosable instead of silently stalling the Inbox.
   */
  private async recordInboxDeferred(sequence: number): Promise<void> {
    if (this.options.store.snapshot().diagnostics.some(
      (diagnostic) => diagnostic.code === INBOX_DEFERRED_DIAGNOSTIC
    )) return
    await this.options.store.transact((draft) => {
      draft.diagnostics = [...draft.diagnostics, {
        code: INBOX_DEFERRED_DIAGNOSTIC,
        severity: 'warning' as const,
        message: `Agent inbox is paused at sequence ${sequence} until its Project Coordinator subscribes.`,
        occurredAt: this.now().toISOString(),
        recoverable: true
      }].slice(-256)
    })
  }

  private async recordConnected(): Promise<void> {
    this.authorityRecoveryDelayMs = 1_000
    this.connectionState = {
      state: 'connected',
      lastConnectedAt: this.now().toISOString()
    }
    await this.clearDiagnostics('collaboration.connection_error')
  }

  private async clearDiagnostics(code: string): Promise<void> {
    if (!this.options.store.snapshot().diagnostics.some(
      (diagnostic) => diagnostic.code === code
    )) return
    await this.options.store.transact((draft) => {
      draft.diagnostics = draft.diagnostics.filter(
        (diagnostic) => diagnostic.code !== code
      )
    })
  }

  private async failClosedAuthority(agentId: string, error: unknown): Promise<boolean> {
    if (!(error instanceof AgentCloudRuntimeError) || ![
      'identity_required',
      'authority_unverified',
      'device_required',
      'agent_required',
      'agent_authority_invalid'
    ].includes(error.code)) return false

    this.dashboardController?.abort(error)
    this.dashboardRefreshQueued = false
    const controller = this.abortController
    this.abortController = null
    controller?.abort(error)
    this.options.outbox.stop()
    const temporary = error.code === 'authority_unverified'
    if (temporary) await this.options.onAuthorityUnverified?.(agentId, error.message)
    else await this.options.onAuthorityLost?.(agentId, error.message, error)
    this.recordError(error, temporary)
    this.scheduleAuthorityRecovery()
    return true
  }

  private scheduleAuthorityRecovery(delayMs = this.authorityRecoveryDelayMs): void {
    if (this.authorityRecoveryStopped || this.authorityRecoveryTimer || this.authorityRecoveryRun) return
    const timer = setTimeout(() => {
      this.authorityRecoveryTimer = undefined
      this.authorityRecoveryRun = this.recoverAfterAuthorityChange()
        .catch(() => undefined)
        .finally(() => {
          this.authorityRecoveryRun = undefined
          if (this.connectionState.state === 'connected') {
            this.authorityRecoveryDelayMs = 1_000
            return
          }
          this.authorityRecoveryDelayMs = Math.min(this.authorityRecoveryDelayMs * 2, 30_000)
          this.scheduleAuthorityRecovery()
        })
    }, delayMs)
    timer.unref?.()
    this.authorityRecoveryTimer = timer
  }

  private stopAuthorityRecovery(): void {
    this.authorityRecoveryStopped = true
    if (this.authorityRecoveryTimer) clearTimeout(this.authorityRecoveryTimer)
    this.authorityRecoveryTimer = undefined
  }

  private async recoverAfterAuthorityChange(): Promise<void> {
    if (this.abortController || this.connectionState.state === 'connecting' ||
        this.connectionState.state === 'connected') return
    if (this.options.authenticatedCloudTransport.status().state !== 'ready') return
    try {
      let agentId = this.localAgentId()
      if (!agentId ||
          (await this.options.agentCloudRuntime.authorityStatus(agentId)).state !== 'ready') {
        // A Desktop that started while Identity was unavailable has no local
        // Agent yet; the canonical cloud sync ensures it before connecting.
        await this.refreshCloudState()
        agentId = this.localAgentId()
      }
      if (!agentId ||
          (await this.options.agentCloudRuntime.authorityStatus(agentId)).state !== 'ready') return
      this.connectionState = {
        state: 'recovering',
        lastConnectedAt: this.connectionState.lastConnectedAt
      }
      await this.refreshCloudState()
      await this.connect()
    } catch (error) {
      this.recordError(error, true)
    }
  }
}

function authorityStatusError(
  status: Exclude<Awaited<ReturnType<AgentCloudRuntime['authorityStatus']>>, { state: 'ready' }>
): AgentCloudRuntimeError {
  if (status.state === 'identity_required') {
    return new AgentCloudRuntimeError(
      'identity_required',
      'Sign in to SciForge Cloud before continuing.'
    )
  }
  if (status.state === 'device_required') {
    return new AgentCloudRuntimeError(
      'device_required',
      'Enroll this Desktop Device before continuing.'
    )
  }
  if (status.state === 'agent_required') {
    return new AgentCloudRuntimeError(
      'agent_required',
      'Register this Device as an Agent before continuing.'
    )
  }
  return new AgentCloudRuntimeError(
    status.reasonCode === 'authority_unverified' ? 'authority_unverified' :
      status.reasonCode === 'authority_rejected' ? 'agent_authority_invalid' : 'runtime_unavailable',
    status.reason
  )
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
