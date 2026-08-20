import { createHash } from 'node:crypto'
import { join } from 'node:path'
import {
  restRequestSchema,
  type AgentInboxMessage,
  type ManagedProviderContainer,
  type Project,
  type RemoteSessionProjection,
  type RestResponse,
  type Task
} from '@sciforge/collaboration-contracts'
import type {
  DomainMainPackageSecretStoreHost,
  DomainMainPackageSettingsHost
} from '@sciforge/domain-sdk/package-storage'
import type {
  DomainMainRuntimeDisposer,
  DomainMainRuntimeLifecycleContext
} from '@sciforge/domain-sdk/host'
import type {
  CollaborationConnectionConnectInput,
  CollaborationEndpointChallengePollInput,
  CollaborationEndpointChallengeStartInput,
  CollaborationAgentRegisterInput,
  CollaborationManagedContainerManageInput,
  CollaborationPrimaryAgentSelectInput,
  CollaborationProjectionLinkInput,
  CollaborationProjectionShareInput,
  CollaborationProjectionUpdateInput,
  CollaborationStatusSnapshot,
  CollaborationSynchronizationRetryInput,
  CollaborationTaskListInput,
  CollaborationTaskView,
  CollaborationProjectionView
} from '../contract.js'
import {
  CollaborationConnection,
  type CollaborationInboxHandler
} from './connection.js'
import {
  HttpCollaborationCloudClient,
  collaborationRequestId,
  type CollaborationCloudClient
} from './cloud-client.js'
import { DurableCloudOutbox } from './outbox.js'
import {
  ProjectionCoordinator,
  localProjectionFromRemote
} from './projection-coordinator.js'
import { CollaborationSettingsService } from './settings.js'
import {
  CollaborationLocalStore,
  FileCollaborationStateBackend,
  type CollaborationStateBackend
} from './store.js'
import { CollaborationTaskAdapter } from './task-adapter.js'

export type CollaborationRuntimeOptions = Readonly<{
  statePath: string
  packageSettings: DomainMainPackageSettingsHost
  packageSecrets: DomainMainPackageSecretStoreHost
  stateBackend?: CollaborationStateBackend
  createCloudClient?: (baseUrl: string) => CollaborationCloudClient
  sanitizeText?: (value: string) => string
  now?: () => Date
}>

export class CollaborationRuntime {
  private readonly store: CollaborationLocalStore
  private readonly settings: CollaborationSettingsService
  private connection: CollaborationConnection | null = null
  private outbox: DurableCloudOutbox | null = null
  private projections: ProjectionCoordinator | null = null
  private tasks: CollaborationTaskAdapter | null = null
  private context: DomainMainRuntimeLifecycleContext | null = null
  private active = false
  private localAgentIdentity: string | undefined

  constructor(private readonly options: CollaborationRuntimeOptions) {
    this.store = new CollaborationLocalStore(
      options.stateBackend ?? new FileCollaborationStateBackend(options.statePath)
    )
    this.settings = new CollaborationSettingsService(options.packageSettings)
  }

  async activate(context: DomainMainRuntimeLifecycleContext): Promise<DomainMainRuntimeDisposer> {
    if (this.active) throw new Error('Collaboration runtime is already active.')
    if (!context.agentExecution) {
      throw new Error('Collaboration requires the canonical Agent execution Host.')
    }
    if (!context.turnEvents) {
      throw new Error('Collaboration requires canonical Agent turn lifecycle events.')
    }
    await this.store.open()
    this.context = context
    this.active = true
    const configured = await this.settings.read()
    if (configured.settings) {
      this.localAgentIdentity = this.store.snapshot().agents.find((agent) => (
        agent.installationId === configured.settings!.installationId
      ))?.agentId
    }

    let connection!: CollaborationConnection
    const outbox = new DurableCloudOutbox({
      store: this.store,
      packageSecrets: this.options.packageSecrets,
      cloudClient: () => connection.cloudClient(),
      sanitizeText: this.options.sanitizeText,
      now: this.options.now
    })
    const projections = new ProjectionCoordinator({
      store: this.store,
      agentExecution: context.agentExecution,
      agentThreads: context.agentThreads,
      cloudOutbox: outbox,
      localAgentId: () => this.localAgentIdentity,
      sanitizeText: this.options.sanitizeText,
      now: this.options.now
    })
    let tasks!: CollaborationTaskAdapter
    const inboxHandler: CollaborationInboxHandler = {
      handle: async (message) => {
        if (message.payload.type === 'personal.message.received') {
          await projections.acceptPersonalInbox(message)
          return
        }
        if (
          message.payload.type === 'task.offered' ||
          message.payload.type === 'task.cancelled' ||
          message.payload.type === 'task.updated'
        ) {
          await tasks.handleInbox(message)
          return
        }
        if (message.payload.type === 'agent.revoked') {
          await connection.acceptAgentRevocation(message.payload.agentId, message.createdAt)
          this.localAgentIdentity = undefined
          return
        }
        if (message.payload.type === 'projection.updated') {
          await this.refreshProjectionFromInbox(
            message.payload.projectionId,
            message.payload.revision
          )
          return
        }
        await this.refreshCollaborationFact(message)
      }
    }
    connection = new CollaborationConnection({
      store: this.store,
      settings: this.settings,
      packageSecrets: this.options.packageSecrets,
      outbox,
      createCloudClient: this.options.createCloudClient ?? ((baseUrl) => (
        new HttpCollaborationCloudClient({ baseUrl })
      )),
      inboxHandler,
      sanitizeText: this.options.sanitizeText,
      now: this.options.now
    })
    tasks = new CollaborationTaskAdapter({
      store: this.store,
      connection,
      outbox,
      agentExecution: context.agentExecution,
      localAgentId: () => this.localAgentIdentity,
      sanitizeText: this.options.sanitizeText,
      now: this.options.now
    })
    this.connection = connection
    this.outbox = outbox
    this.projections = projections
    this.tasks = tasks

    const disposeTurnEvents = context.turnEvents.subscribe(async (event) => {
      if (event.kind !== 'after-turn' || !('turnId' in event) || !event.turnId) return
      const matching = this.store.snapshot().projections.filter((projection) => (
        projection.runtimeId === event.runtimeId && projection.threadId === event.threadId
      ))
      if (matching.length !== 1) return
      const thread = await context.agentThreads.read({
        runtimeId: event.runtimeId,
        threadId: event.threadId
      })
      const turn = thread.turns.find((candidate) => candidate.id === event.turnId)
      if (!turn) return
      await projections.mirrorCanonicalTurn({
        runtimeId: event.runtimeId,
        threadId: event.threadId,
        turnId: event.turnId,
        clientDirectiveId: event.clientDirectiveId,
        messages: turn.messages
      })
    })

    await this.reconcileTranscriptSnapshots()
    await projections.recover()
    await connection.activate()
    // Task reconciliation consults canonical cloud state before executing. Run
    // it only after the connection has initialized; an offline activation keeps
    // the runs durable in reconciling state until an explicit recovery/restart.
    await tasks.recover()

    return async () => {
      await disposeTurnEvents()
      await this.dispose()
    }
  }

  async dispose(): Promise<void> {
    if (!this.active) return
    this.active = false
    this.projections?.stop()
    this.tasks?.stop()
    await this.connection?.dispose()
    await Promise.allSettled([
      this.projections?.waitForIdle() ?? Promise.resolve(),
      this.tasks?.waitForIdle() ?? Promise.resolve(),
      this.outbox?.waitForIdle() ?? Promise.resolve()
    ])
    this.connection = null
    this.outbox = null
    this.projections = null
    this.tasks = null
    this.context = null
  }

  async status(): Promise<CollaborationStatusSnapshot> {
    const connection = this.requireConnection()
    const state = this.store.snapshot()
    const configured = await this.settings.read()
    const participant = state.user && state.participant
      ? {
          userId: state.user.userId,
          displayName: state.user.displayName,
          status: state.user.status,
          revision: state.participant.revision,
          complete: state.participant.status === 'active',
          ...(state.participant.primaryHumanEndpointId
            ? { primaryHumanEndpointId: state.participant.primaryHumanEndpointId }
            : {}),
          ...(state.participant.primaryAgentId
            ? { primaryAgentId: state.participant.primaryAgentId }
            : {}),
          endpoints: state.endpoints.map((endpoint) => ({
            humanEndpointId: endpoint.humanEndpointId,
            providerKey: endpoint.identity.provider,
            displayName: endpoint.displayName,
            status: endpoint.status,
            assurance: mapAssurance(endpoint.assurance),
            projectionLocators: state.endpointLocators
              .filter((item) => item.humanEndpointId === endpoint.humanEndpointId)
              .map((item) => item.locator),
            verifiedAt: endpoint.verifiedAt,
            ...(endpoint.lastSeenAt ? { lastSeenAt: endpoint.lastSeenAt } : {})
          })),
          agents: state.agents.map((agent) => ({
            agentId: agent.agentId,
            ownerUserId: agent.ownerUserId,
            displayName: agent.displayName,
            nodeType: agent.nodeType,
            status: agent.lifecycleStatus === 'revoked' ? 'revoked' as const : agent.connectionStatus,
            capabilities: agent.capabilities,
            ...(agent.lastSeenAt ? { lastSeenAt: agent.lastSeenAt } : {}),
            primary: state.participant?.primaryAgentId === agent.agentId
          }))
        }
      : undefined
    const projections = state.projections.map((projection) => (
      this.projectionView(projection.projection)
    ))
    const projectViews = state.projects.map((project) => ({
      projectId: project.projectId,
      name: project.displayName,
      state: mapProjectState(project.status),
      revision: project.revision,
      coordinatorAgentId: project.coordinatorAgentId,
      memberUserIds: project.memberUserIds,
      tasks: state.tasks.filter((task) => task.projectId === project.projectId).map(mapTaskView)
    }))
    const connectionState = connection.state()
    const deviceCredentialAvailable = await this.options.packageSecrets.has('device-credential')
    const localAgent = configured.settings
      ? state.agents.find((agent) => (
          agent.installationId === configured.settings!.installationId
          && agent.lifecycleStatus === 'active'
        ))
      : undefined
    return {
      revision: state.revision,
      connection: {
        configured: configured.settings !== null,
        ...(configured.settings ? { baseUrl: configured.settings.baseUrl } : {}),
        state: configured.settings ? connectionState.state : 'unconfigured',
        deviceCredentialAvailable,
        ...(localAgent ? { localAgentId: localAgent.agentId } : {}),
        ...(connectionState.lastConnectedAt ? { lastConnectedAt: connectionState.lastConnectedAt } : {}),
        lastInboxSequence: state.lastInboxSequence,
        pendingOutboxCount: state.outbox.filter((entry) => (
          entry.state !== 'delivered'
        )).length,
        ...(connectionState.lastError ? { lastError: connectionState.lastError } : {})
      },
      providerOptions: [...connection.providers()],
      managedContainers: state.managedContainers,
      ...(participant ? { participant } : {}),
      projections,
      projects: projectViews,
      queue: state.queue.slice(-10_000).map((item) => ({
        queueItemId: item.queueItemId,
        projectionId: item.projectionId,
        sequence: item.sequence,
        origin: item.origin,
        kind: item.kind,
        state: item.state,
        attempts: item.attempts,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        ...(item.error ? { error: item.error } : {})
      })),
      diagnostics: state.diagnostics
    }
  }

  async configureConnection(baseUrl: string): Promise<CollaborationStatusSnapshot['connection']> {
    await this.requireConnection().configure(baseUrl)
    return (await this.status()).connection
  }

  async changeConnection(input: CollaborationConnectionConnectInput): Promise<CollaborationStatusSnapshot['connection']> {
    await this.requireConnection().applyConnectionAction(input)
    return (await this.status()).connection
  }

  startChallenge(input: CollaborationEndpointChallengeStartInput) {
    return this.requireConnection().startChallenge(input)
  }

  pollChallenge(input: CollaborationEndpointChallengePollInput) {
    return this.requireConnection().pollChallenge(input)
  }

  async registerAgent(input: CollaborationAgentRegisterInput) {
    const agent = await this.requireConnection().registerAgent(input)
    this.localAgentIdentity = agent.agentId
    return (await this.status()).participant!.agents.find((candidate) => (
      candidate.agentId === agent.agentId
    ))!
  }

  async selectPrimaryAgent(input: CollaborationPrimaryAgentSelectInput) {
    await this.requireConnection().selectPrimaryAgent(
      input.agentId,
      input.expectedParticipantRevision
    )
    return (await this.status()).participant!
  }

  async linkProjection(input: CollaborationProjectionLinkInput): Promise<CollaborationProjectionView> {
    const state = this.store.snapshot()
    const user = state.user
    if (!user) throw new Error('Verify a human endpoint before sharing a Session.')
    const agent = state.agents.find((candidate) => candidate.agentId === input.agentId)
    if (!agent || agent.ownerUserId !== user.userId || agent.lifecycleStatus !== 'active') {
      throw new Error('Projection Agent must be active and owned by the current user.')
    }
    const endpoint = state.endpoints.find((candidate) => candidate.humanEndpointId === input.humanEndpointId)
    if (!endpoint || endpoint.userId !== user.userId || endpoint.status !== 'active') {
      throw new Error('Projection endpoint must be active and owned by the current user.')
    }
    if (
      endpoint.identity.provider !== input.locator.provider ||
      endpoint.identity.realmId !== input.locator.realmId
    ) {
      throw new Error('Projection locator does not belong to the verified endpoint realm.')
    }
    if (input.mode === 'existing' && state.projections.some((candidate) => (
      candidate.projection.status !== 'closed' &&
      candidate.runtimeId === input.runtimeId &&
      candidate.threadId === input.threadId
    ))) {
      throw new Error('This local Session already has an active remote projection.')
    }
    const idempotencyKey = `idem_projection.create.${digest(JSON.stringify({
      userId: user.userId,
      agentId: input.agentId,
      endpointId: input.humanEndpointId,
      locator: input.locator,
      runtimeId: input.runtimeId,
      threadId: input.mode === 'existing' ? input.threadId : null
    })).slice(0, 48)}`
    const response = await this.requireConnection().executeAsUser(restRequestSchema.parse({
      protocolVersion: '1.0',
      requestId: collaborationRequestId(),
      type: 'projection.create',
      idempotencyKey,
      ownerUserId: user.userId,
      agentId: input.agentId,
      humanEndpointId: input.humanEndpointId,
      locator: input.locator,
      displayName: input.displayName,
      allowedSenderUserIds: [user.userId]
    }))
    const projection = requireProjectionResponse(response)
    await this.store.transact((draft) => {
      draft.projections.push(localProjectionFromRemote(projection, {
        runtimeId: input.runtimeId,
        ...(input.mode === 'existing' ? { threadId: input.threadId } : {}),
        ...(input.workspaceRoot ? { workspaceRoot: input.workspaceRoot } : {}),
        bindingMode: input.mode
      }))
    })
    if (input.mode === 'existing') await this.reconcileProjectionTranscript(projection.projectionId)
    return this.projectionView(projection)
  }

  async updateProjection(input: CollaborationProjectionUpdateInput): Promise<CollaborationProjectionView> {
    const local = this.store.snapshot().projections.find((candidate) => (
      candidate.projection.projectionId === input.projectionId
    ))
    if (!local) throw new Error('Projection was not found.')
    if (local.projection.revision !== input.expectedRevision) throw new Error('Projection revision is stale.')
    if (input.action === 'relink') {
      if (local.projection.status !== 'paused') throw new Error('Pause a projection before relinking it.')
      await this.store.transact((draft) => {
        const target = draft.projections.find((candidate) => (
          candidate.projection.projectionId === input.projectionId
        ))!
        target.runtimeId = input.runtimeId
        target.threadId = input.threadId
        target.workspaceRoot = input.workspaceRoot
        target.bindingMode = 'existing'
        target.lastError = undefined
      })
      await this.reconcileProjectionTranscript(input.projectionId)
      return this.projectionView(local.projection)
    }
    const response = await this.requireConnection().executeAsUser(restRequestSchema.parse({
      protocolVersion: '1.0',
      requestId: collaborationRequestId(),
      type: 'projection.update',
      idempotencyKey: `idem_projection.${input.action}.${digest(`${input.projectionId}\u0000${input.expectedRevision}`).slice(0, 48)}`,
      projectionId: input.projectionId,
      expectedRevision: input.expectedRevision,
      ...(input.action === 'rename' ? { displayName: input.displayName } : {}),
      ...(input.action === 'pause' ? { status: 'paused' as const } : {}),
      ...(input.action === 'resume' ? { status: 'active' as const } : {}),
      ...(input.action === 'close' ? { status: 'closed' as const } : {})
    }))
    const projection = requireProjectionResponse(response)
    await this.replaceProjection(projection)
    if (projection.status === 'active') await this.requireProjections().recover()
    return this.projectionView(projection)
  }

  async shareProjection(input: CollaborationProjectionShareInput): Promise<CollaborationProjectionView> {
    const local = this.store.snapshot().projections.find((candidate) => (
      candidate.projection.projectionId === input.projectionId
    ))
    if (!local || local.projection.revision !== input.expectedRevision) {
      throw new Error('Projection revision is stale.')
    }
    const allowedSenderUserIds = [...new Set([
      local.projection.ownerUserId,
      ...input.allowUserIds
    ])]
    const response = await this.requireConnection().executeAsUser(restRequestSchema.parse({
      protocolVersion: '1.0',
      requestId: collaborationRequestId(),
      type: 'projection.update',
      idempotencyKey: `idem_projection.share.${digest(JSON.stringify({
        projectionId: input.projectionId,
        revision: input.expectedRevision,
        allowedSenderUserIds
      })).slice(0, 48)}`,
      projectionId: input.projectionId,
      expectedRevision: input.expectedRevision,
      allowedSenderUserIds
    }))
    const projection = requireProjectionResponse(response)
    await this.replaceProjection(projection)
    return this.projectionView(projection)
  }

  async retrySynchronization(input: CollaborationSynchronizationRetryInput): Promise<void> {
    if (input.scope === 'connection' || input.scope === 'inbox') {
      await this.requireConnection().applyConnectionAction({ action: 'recover' })
      return
    }
    if (input.scope === 'outbox') {
      await this.requireOutbox().retry(input.id)
      return
    }
    if (input.scope === 'projection') {
      await this.requireProjections().retry(input.id!)
      return
    }
    if (input.scope === 'task') await this.requireTasks().recover()
  }

  async manageContainer(input: CollaborationManagedContainerManageInput): Promise<Readonly<{
    managedContainer: ManagedProviderContainer | null
    locatorCount?: number
  }>> {
    const connection = this.requireConnection()
    if (input.action === 'refresh-locators') {
      return {
        managedContainer: null,
        locatorCount: await connection.refreshEndpointLocators(input.humanEndpointId)
      }
    }
    if (input.action === 'refresh-status') {
      const containers = await connection.refreshManagedContainers()
      for (const container of containers) {
        if (!container.container || container.status === 'archived') continue
        await connection.executeAsUser(restRequestSchema.parse({
          protocolVersion: '1.0',
          requestId: collaborationRequestId(),
          type: 'managed_container.inspect',
          idempotencyKey: `idem_managed_container.inspect.${digest(`${container.managedContainerId}\u0000${container.revision}`).slice(0, 48)}`,
          managedContainerId: container.managedContainerId,
          expectedRevision: container.revision
        }))
      }
      await connection.refreshManagedContainers()
      return { managedContainer: null }
    }
    const state = this.store.snapshot()
    let response: RestResponse
    if (input.action === 'ensure') {
      if (!state.user) throw new Error('A verified user is required to create a managed Channel.')
      const provider = state.endpoints.find((endpoint) => (
        endpoint.humanEndpointId === input.humanEndpointId
      ))?.identity.provider
      if (!provider || !connection.providers().some((option) => (
        option.providerKey === provider && option.managedContainers
      ))) {
        throw new Error('This endpoint Provider does not offer managed Channels.')
      }
      const displayName = managedContainerDisplayName(state.user.userId)
      const existing = state.managedContainers.find((container) => (
        container.humanEndpointId === input.humanEndpointId
      ))
      const requestId = collaborationRequestId()
      const retryToken = existing?.status === 'failed' && !existing.container
        ? `${existing.revision}\u0000${requestId}`
        : undefined
      response = await connection.executeAsUser(restRequestSchema.parse({
        protocolVersion: '1.0',
        requestId,
        type: 'managed_container.ensure',
        idempotencyKey: managedContainerEnsureIdempotencyKey(
          state.user.userId,
          input.humanEndpointId,
          retryToken
        ),
        humanEndpointId: input.humanEndpointId,
        displayName,
        policy: {
          version: 1,
          visibility: 'private',
          history: 'protected',
          membership: 'owner_and_message_bot',
          memberManagement: 'provisioning_service_only',
          channelManagement: 'provisioning_service_only',
          ownerCanSend: true,
          ownerCanCreateTopics: true,
          messageBotCanSend: true,
          messageBotCreatesProjectTopics: false
        }
      }))
    } else {
      response = await connection.executeAsUser(restRequestSchema.parse({
        protocolVersion: '1.0',
        requestId: collaborationRequestId(),
        type: input.action === 'reconcile'
          ? 'managed_container.reconcile'
          : 'managed_container.archive',
        idempotencyKey: `idem_managed_container.${input.action}.${digest(`${input.managedContainerId}\u0000${input.expectedRevision}`).slice(0, 48)}`,
        managedContainerId: input.managedContainerId,
        expectedRevision: input.expectedRevision
      }))
    }
    if (response.type === 'rest.error') throw new Error(response.error.message)
    if (response.type !== 'rest.entity' || response.entity.type !== 'managed_provider_container') {
      throw new Error(`Managed Channel command returned unexpected ${response.type}.`)
    }
    const managedContainer = response.entity
    await this.store.transact((draft) => {
      draft.managedContainers = [
        ...draft.managedContainers.filter((item) => (
          item.managedContainerId !== managedContainer.managedContainerId
        )),
        managedContainer
      ]
    })
    return { managedContainer }
  }

  listTasks(input: CollaborationTaskListInput): readonly CollaborationTaskView[] {
    const states = new Set(input.states ?? [])
    return this.store.snapshot().tasks
      .filter((task) => !input.projectId || task.projectId === input.projectId)
      .map(mapTaskView)
      .filter((task) => states.size === 0 || states.has(task.state))
  }

  private async reconcileTranscriptSnapshots(): Promise<void> {
    for (const projection of this.store.snapshot().projections) {
      if (projection.threadId) {
        await this.reconcileProjectionTranscript(projection.projection.projectionId)
      }
    }
  }

  private async reconcileProjectionTranscript(projectionId: string): Promise<void> {
    const projection = this.store.snapshot().projections.find((candidate) => (
      candidate.projection.projectionId === projectionId
    ))
    if (!projection?.threadId || !this.context) return
    const thread = await this.context.agentThreads.read({
      runtimeId: projection.runtimeId,
      threadId: projection.threadId
    })
    for (const turn of thread.turns) {
      await this.requireProjections().reconcileCanonicalTurn({
        runtimeId: projection.runtimeId,
        threadId: projection.threadId,
        turnId: turn.id,
        messages: turn.messages
      })
    }
  }

  private async refreshCollaborationFact(message: AgentInboxMessage): Promise<void> {
    const projectId = 'projectId' in message.payload ? message.payload.projectId : undefined
    if (!projectId) return
    const response = await this.requireConnection().executeAsDevice(restRequestSchema.parse({
      protocolVersion: '1.0',
      requestId: collaborationRequestId(),
      type: 'project.get',
      projectId
    }))
    if (response.type !== 'rest.entity' || response.entity.type !== 'project') return
    const project = response.entity
    await this.store.transact((draft) => {
      draft.projects = replaceById(draft.projects, project, (candidate) => candidate.projectId)
    })
  }

  private async refreshProjectionFromInbox(
    projectionId: string,
    notifiedRevision: number
  ): Promise<void> {
    const response = await this.requireConnection().executeAsDevice(restRequestSchema.parse({
      protocolVersion: '1.0',
      requestId: collaborationRequestId(),
      type: 'projection.get',
      projectionId
    }))
    const projection = requireProjectionResponse(response)
    if (projection.projectionId !== projectionId) {
      throw new Error('Projection refresh returned a different projection identity.')
    }
    await this.requireProjections().applyRemoteProjectionUpdate(
      projection,
      notifiedRevision
    )
  }

  private projectionView(projection: RemoteSessionProjection): CollaborationProjectionView {
    const state = this.store.snapshot()
    const local = state.projections.find((candidate) => (
      candidate.projection.projectionId === projection.projectionId
    ))
    if (!local) throw new Error('Local projection binding was not found.')
    const agent = state.agents.find((candidate) => candidate.agentId === projection.agentId)
    if (!agent) throw new Error('Projection Agent was not found.')
    return {
      projectionId: projection.projectionId,
      ownerUserId: projection.ownerUserId,
      agentId: projection.agentId,
      agentOwnerUserId: agent.ownerUserId,
      humanEndpointId: projection.humanEndpointId,
      runtimeId: local.runtimeId,
      ...(local.threadId ? { threadId: local.threadId } : {}),
      ...(local.workspaceRoot ? { workspaceRoot: local.workspaceRoot } : {}),
      displayName: projection.displayName,
      remoteDisplay: [
        projection.locator.containerDisplayName,
        projection.locator.topicDisplayName
      ].filter(Boolean).join(' / ') || undefined,
      remoteLocator: projection.locator,
      status: projection.status,
      allowUserIds: projection.allowedSenderUserIds,
      revision: projection.revision,
      queueDepth: state.queue.filter((item) => (
        item.projectionId === projection.projectionId &&
        !['completed', 'failed', 'ignored'].includes(item.state)
      )).length,
      ...(local.lastSynchronizedAt ? { lastSynchronizedAt: local.lastSynchronizedAt } : {}),
      ...(local.lastError ? { lastError: local.lastError } : {})
    }
  }

  private async replaceProjection(projection: RemoteSessionProjection): Promise<void> {
    await this.store.transact((draft) => {
      const local = draft.projections.find((candidate) => (
        candidate.projection.projectionId === projection.projectionId
      ))
      if (!local) throw new Error('Local projection binding was not found.')
      local.projection = projection
    })
  }

  private requireConnection(): CollaborationConnection {
    if (!this.connection || !this.active) throw new Error('Collaboration runtime is not active.')
    return this.connection
  }

  private requireOutbox(): DurableCloudOutbox {
    if (!this.outbox || !this.active) throw new Error('Collaboration runtime is not active.')
    return this.outbox
  }

  private requireProjections(): ProjectionCoordinator {
    if (!this.projections || !this.active) throw new Error('Collaboration runtime is not active.')
    return this.projections
  }

  private requireTasks(): CollaborationTaskAdapter {
    if (!this.tasks || !this.active) throw new Error('Collaboration runtime is not active.')
    return this.tasks
  }
}

export function collaborationStatePath(userDataDir: string): string {
  return join(userDataDir, 'domains', 'collaboration', 'state.json')
}

function requireProjectionResponse(response: RestResponse): RemoteSessionProjection {
  if (response.type === 'rest.error') throw new Error(response.error.message)
  if (response.type !== 'rest.entity' || response.entity.type !== 'remote_session_projection') {
    throw new Error(`Projection operation returned unexpected ${response.type}.`)
  }
  return response.entity
}

function mapAssurance(value: 'verified' | 'strong'): 'verified' | 'strong' {
  return value
}

function mapProjectState(status: Project['status']): 'active' | 'paused' | 'completed' | 'cancelled' {
  return status === 'draft' ? 'paused' : status
}

function mapTaskView(task: Task): CollaborationTaskView {
  const state = task.status === 'needs_human'
    ? 'needs-human'
    : task.status === 'succeeded'
      ? 'completed'
      : task.status === 'rejected'
        ? 'cancelled'
        : task.status
  return {
    taskId: task.taskId,
    projectId: task.projectId,
    assigneeAgentId: task.assigneeAgentId,
    revision: task.revision,
    title: task.title,
    state,
    ...(task.activeTurnId ? { localTurnId: task.activeTurnId } : {}),
    updatedAt: task.updatedAt
  }
}

function replaceById<Value>(
  values: readonly Value[],
  replacement: Value,
  id: (value: Value) => string
): Value[] {
  return [...values.filter((value) => id(value) !== id(replacement)), replacement]
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function managedContainerDisplayName(userId: string): string {
  // Collaboration Server stableDigest() JSON-encodes scalar values before
  // hashing. Keep the Desktop request aligned with that server-derived name.
  return `sciforge-${digest(JSON.stringify(userId)).slice(0, 12)}`
}

export function managedContainerEnsureIdempotencyKey(
  userId: string,
  humanEndpointId: string,
  retryToken?: string
): string {
  const attempt = retryToken ? `\u0000retry\u0000${retryToken}` : ''
  return `idem_managed_container.ensure.${digest(`${userId}\u0000${humanEndpointId}${attempt}`).slice(0, 48)}`
}
