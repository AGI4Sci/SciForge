import type { SessionAcceptedInputEvent } from '@sciforge/domain-sdk/agent-execution'
import { referencedTaskIds, TASK_CHAT_END, type TaskChatReadInput } from '../chat-association-contract.js'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import {
  restRequestSchema,
  type AgentInboxMessage,
  type ManagedProviderContainer,
  type NotificationProjection,
  type Project,
  type PublicActivityEvent,
  type RemoteSessionProjection,
  type RestResponse,
  type Task
} from '@sciforge/collaboration-contracts'
import type { AuthenticatedCloudTransport } from '@sciforge/domain-identity-access/authenticated-cloud-transport'
import type { AgentCloudRuntime } from '@sciforge/domain-identity-access/agent-cloud-runtime'
import type { DeviceFactAttestationSigningService } from '@sciforge/domain-identity-access/device-fact-attestation-signing'
import type { DomainMainPackageSettingsHost } from '@sciforge/domain-sdk/package-storage'
import {
  workerSessionExecutionBindingSchema,
  type WorkerSessionExecutionBinding
} from '../worker-session-projection.js'
import type {
  DomainAgentTranscriptMessageEvent,
  DomainMainHumanActionsHost,
  DomainMainRuntimeDisposer,
  DomainMainRuntimeLifecycleContext
} from '@sciforge/domain-sdk/host'
import type {
  CollaborationActivityCommentInput,
  CollaborationConnectionConnectInput,
  CollaborationEndpointChallengePollInput,
  CollaborationEndpointChallengeStartInput,
  CollaborationManagedContainerManageInput,
  CollaborationNotificationMarkReadInput,
  CollaborationProjectionLinkInput,
  CollaborationProjectionShareInput,
  CollaborationProjectionUpdateInput,
  CollaborationStatusReadInput,
  CollaborationStatusSnapshot,
  CollaborationSynchronizationRetryInput,
  CollaborationTaskListInput,
  CollaborationTaskOfferDecisionInput,
  CollaborationTaskReturnInput,
  CollaborationTaskSessionContinueInput,
  CollaborationTaskSessionContinueResult,
  CollaborationTaskView,
  CollaborationOfferAvailability,
  CollaborationProjectionView
} from '../contract.js'
import {
  coordinatorCloudCommandSchema,
  coordinatorUserCloudCommandSchema,
  type CoordinatorUserCloudCommand,
  type CoordinatorUserCloudCommandReplay,
  type CoordinatorUserCloudCommandReplayValidator,
  type CoordinatorAgentInboxHandler,
  type CoordinatorCloudCommand,
  type CoordinatorCloudCommandReplay,
  type CoordinatorCloudCommandReplayValidator
} from '../coordinator-cloud-command.js'
import { CollaborationConnection, type CollaborationInboxHandler } from './connection.js'
import { collaborationRequestId } from './request-id.js'
import { DurableCloudOutbox } from './outbox.js'
import {
  ProjectionCoordinator,
  localProjectionFromRemote
} from './projection-coordinator.js'
import { CollaborationSettingsService } from './settings.js'
import { RemoteApprovalCoordinator } from './remote-approval-coordinator.js'
import {
  CollaborationLocalStore,
  FileCollaborationStateBackend,
  claimLocalSessionProjectionBinding,
  localSessionProjectionBindingFor,
  type CollaborationLocalState,
  type CollaborationPendingTaskOffer,
  type CollaborationLocalProjection,
  type CollaborationTaskRun,
  type CollaborationTaskCheckpoint,
  type CollaborationTaskInteraction,
  type CollaborationStateBackend
} from './store.js'
import { CollaborationTaskAdapter } from './task-adapter.js'
import { workerFollowupView } from '../task-followup.js'
import { parseWorkerRuntimeResult } from '../worker-runtime-result.js'
import type {
  LocalTaskInteractionView,
  TaskInteractionSubmit
} from './task-interaction-controller.js'
import type { TaskCheckpointCreate } from './task-interaction-journal.js'
import { workerResidualDisposeInputSchema } from '../worker-delivery.js'
import type {
  WorkerDeliveryReadInput,
  WorkerDeliveryMaterialsInput,
  WorkerDeliveryMaterialImportInput,
  WorkerDeliveryMaterialsResult,
  WorkerDeliveryDraftSaveInput,
  WorkerDeliverySubmitInput,
  WorkerDeliveryView
} from '../worker-delivery.js'
import type { z } from 'zod'

type WorkerResidualDisposeInput = z.infer<typeof workerResidualDisposeInputSchema>

export type CollaborationRuntimeOptions = Readonly<{
  statePath: string
  packageSettings: DomainMainPackageSettingsHost
  authenticatedCloudTransport: AuthenticatedCloudTransport
  agentCloudRuntime: AgentCloudRuntime
  humanActions: DomainMainHumanActionsHost
  signing: DeviceFactAttestationSigningService
  coordinatorInboxHandler?: () => CoordinatorAgentInboxHandler | null
  onConnectionReady?: () => void | Promise<void>
  stateBackend?: CollaborationStateBackend
  sanitizeText?: (value: string) => string
  now?: () => Date
}>

export function isWorkerTaskInboxPayload(payload: AgentInboxMessage['payload']): boolean {
  return payload.type === 'task.offered' ||
    payload.type === 'task.offer.claimed' ||
    (payload.type === 'task.offer.closed' && payload.audience === 'worker') ||
    payload.type === 'task.delivery.revision_requested' ||
    payload.type === 'task.execution.fenced' ||
    payload.type === 'task.cancelled' ||
    payload.type === 'task.updated' ||
    payload.type === 'collaboration.state.changed'
}

export function isCoordinatorProjectInboxPayload(
  payload: AgentInboxMessage['payload']
): boolean {
  return payload.type === 'project.started' ||
    payload.type === 'project.updated' ||
    payload.type === 'project.plan.confirmed' ||
    payload.type === 'project.requirements.confirmed' ||
    payload.type === 'project.membership.changed' ||
    payload.type === 'task.delivery.sealed' ||
    payload.type === 'task.delivery.adopted' ||
    payload.type === 'project.result.published' ||
    payload.type === 'task.execution.started' ||
    payload.type === 'task.execution.failed' ||
    (payload.type === 'task.offer.closed' && payload.audience === 'coordinator') ||
    payload.type === 'project_record.submitted' ||
    payload.type === 'coordinator.transferred' || (
    payload.type === 'human.answer.received' &&
    payload.answer.context.scope === 'coordinator_project'
  )
}

function projectIdForInboxPayload(
  payload: AgentInboxMessage['payload']
): string | undefined {
  if ('projectId' in payload) return payload.projectId
  if (payload.type === 'human.answer.received') return payload.answer.projectId
  if (payload.type === 'collaboration.state.changed' && 'projectId' in payload.event) {
    return payload.event.projectId
  }
  return undefined
}

export class CollaborationRuntime {
  private readonly store: CollaborationLocalStore
  private readonly settings: CollaborationSettingsService
  private connection: CollaborationConnection | null = null
  private outbox: DurableCloudOutbox | null = null
  private projections: ProjectionCoordinator | null = null
  private tasks: CollaborationTaskAdapter | null = null
  private context: DomainMainRuntimeLifecycleContext | null = null
  private readonly transcriptSubscriptions = new Map<string, Readonly<{
    controller: AbortController
    task: Promise<void>
  }>>()
  private storeOpening: Promise<CollaborationLocalState> | null = null
  private active = false
  private projectionLinkTail: Promise<void> = Promise.resolve()

  constructor(private readonly options: CollaborationRuntimeOptions) {
    this.store = new CollaborationLocalStore(
      options.stateBackend ?? new FileCollaborationStateBackend(options.statePath)
    )
    this.settings = new CollaborationSettingsService(options.packageSettings)
  }

  async activate(context: DomainMainRuntimeLifecycleContext): Promise<DomainMainRuntimeDisposer> {
    if (this.active) throw new Error('Collaboration runtime is already active.')
    if (!context.agentExecution?.prepareSession) {
      throw new Error('Collaboration requires the canonical durable Agent execution Host.')
    }
    if (!context.turnEvents) {
      throw new Error('Collaboration requires canonical Agent turn lifecycle events.')
    }
    await this.openLocalStore()
    this.context = context
    this.active = true
    let connection!: CollaborationConnection
    const durableAgentExecution = {
      ...context.agentExecution,
      prepareSession: context.agentExecution.prepareSession
    }
    const outbox = new DurableCloudOutbox({
      store: this.store,
      agentCloudRuntime: this.options.agentCloudRuntime,
      authenticatedCloudTransport: this.options.authenticatedCloudTransport,
      localAgentId: () => connection.localAgentId(),
      sanitizeText: this.options.sanitizeText,
      now: this.options.now
    })
    const projections = new ProjectionCoordinator({
      store: this.store,
      agentExecution: durableAgentExecution,
      agentThreads: context.agentThreads,
      cloudOutbox: outbox,
      localAgentId: () => connection.localAgentId(),
      sanitizeText: this.options.sanitizeText,
      now: this.options.now
    })
    let tasks!: CollaborationTaskAdapter
    const remoteApprovals = context.remoteCapabilityApprovals
      ? new RemoteApprovalCoordinator({
          store: this.store,
          outbox,
          host: context.remoteCapabilityApprovals,
          localAgentId: () => connection.localAgentId(),
          now: this.options.now
        })
      : null
    const inboxHandler: CollaborationInboxHandler = {
      handle: async (message) => {
        if (message.payload.type === 'capability.approval.decision') {
          if (!remoteApprovals) throw new Error('Remote capability approval Host is unavailable.')
          await remoteApprovals.handleInbox(message)
          return
        }
        if (message.payload.type === 'personal.message.received') {
          await projections.acceptPersonalInbox(message)
          return
        }
        if (message.payload.type === 'project.deleted') {
          await tasks.handleProjectUnavailable(message.payload.projectId, {
            kind: 'permanent',
            reason: 'Cloud deleted this Project; local execution was fenced.'
          })
          const handler = this.options.coordinatorInboxHandler?.()
          if (handler) await handler(message)
          return
        }
        const projectId = projectIdForInboxPayload(message.payload)
        if (projectId && !await this.canHandleProjectInbox(projectId)) return
        if (isCoordinatorProjectInboxPayload(message.payload)) {
          const handler = this.options.coordinatorInboxHandler?.()
          if (!handler) {
            // The Coordinator contribution is composed after this runtime. Leave
            // the message at the durable Cloud cursor until its owner subscribes.
            // main.ts wakes the same connection when that subscription is installed.
            return 'deferred'
          }
          await handler(message)
          return
        }
        if (message.payload.type === 'human.answer.received') {
          await tasks.handleInbox(message)
          return
        }
        if (isWorkerTaskInboxPayload(message.payload)) {
          await tasks.handleInbox(message)
          return
        }
        if (message.payload.type === 'agent.revoked') {
          await tasks.fenceLocalAgent(
            message.payload.agentId,
            'Cloud revoked this Agent; all local executions were fenced.'
          )
          await connection.acceptAgentRevocation(message.payload.agentId, message.createdAt)
          return
        }
        if (message.payload.type === 'projection.updated') {
          await this.refreshProjectionFromInbox(
            message.payload.projectionId,
            message.payload.revision
          )
          return
        }
      }
    }
    connection = new CollaborationConnection({
      store: this.store,
      settings: this.settings,
      outbox,
      authenticatedCloudTransport: this.options.authenticatedCloudTransport,
      agentCloudRuntime: this.options.agentCloudRuntime,
      inboxHandler,
      afterHeartbeat: async (connectionStatus) => {
        if (connectionStatus === 'online' && connection.state().state !== 'connected') {
          await this.reconcileProjectFacts()
          await this.options.onConnectionReady?.()
        }
        await tasks.publishAvailability(connectionStatus)
        if (connectionStatus === 'online') tasks.wake()
      },
      onAuthorityLost: (agentId, reason, cause) => tasks.fenceLocalAgent(
        agentId,
        `Identity authority was lost: ${reason}`,
        cause
      ),
      onAuthorityUnverified: (agentId, reason) => tasks.suspendLocalAgent(agentId, reason),
      sanitizeText: this.options.sanitizeText,
      now: this.options.now
    })
    tasks = new CollaborationTaskAdapter({
      wakeups: context.wakeups,
      store: this.store,
      connection,
      outbox,
      agentExecution: durableAgentExecution,
      humanActions: this.options.humanActions,
      signing: this.options.signing,
      authenticatedCloudTransport: this.options.authenticatedCloudTransport,
      localAgentId: () => connection.localAgentId(),
      workspaceRootForExecution: (executionId) => join(
        dirname(this.options.statePath),
        'worker-workspaces',
        executionId
      ),
      workspaceDisplayNameForProject: (projectId) => this.store.snapshot().projects.find(
        (project) => project.projectId === projectId
      )?.displayName,
      sanitizeText: this.options.sanitizeText,
      now: this.options.now
    })
    this.connection = connection
    this.outbox = outbox
    this.projections = projections
    this.tasks = tasks

    const disposeAcceptedInput = context.turnEvents.subscribeAcceptedInput?.(event => this.recordAcceptedTaskChatInput(event))
    const disposeAdmission = context.turnEvents.subscribeRequiredAdmission?.((event) => tasks.acceptSessionAdmission(event))
    const disposeOutput = context.turnEvents.subscribeRequiredOutput?.((event) =>
      tasks.acceptSessionOutput(event, (ref) => context.agentThreads.read(ref)))
    const disposeTurnEvents = context.turnEvents.subscribe(async (event) => {
      if (event.kind !== 'after-turn' || !('turnId' in event) || !event.turnId) return
      await this.recordTaskChatTurn(event.runtimeId, event.threadId, event.turnId, event.occurredAt, event.principal?.subject, event.clientDirectiveId)
      const matching = activeProjectionBindingsForSession(
        this.store.snapshot().projections,
        event.runtimeId,
        event.threadId
      )
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
      this.syncTranscriptSubscriptions()
    })
    const disposeRemoteApprovals = remoteApprovals?.subscribe() ?? (() => undefined)

    const traced = process.env.SCIFORGE_STARTUP_TRACE === '1'
    const lap = async <T>(step: string, run: () => Promise<T>): Promise<T> => {
      const at = Date.now()
      try {
        return await run()
      } finally {
        if (traced) {
          context.log({
            level: 'info',
            message: 'Collaboration startup step.',
            detail: { step, elapsedMs: Date.now() - at }
          })
        }
      }
    }
    await lap('transcript-snapshots', () => this.reconcileTranscriptSnapshots())
    await lap('projection-recovery', () => projections.recover())
    this.syncTranscriptSubscriptions()
    await lap('connection-activate', () => connection.activate())
    // Each canonical online transition reconciles Project visibility before
    // Task recovery can execute; offline runs remain durable until that transition.
    await lap('task-recovery', () => tasks.recover())
    await lap('availability-publish', () =>
      tasks.publishAvailability(connection.state().state === 'connected' ? 'online' : 'offline')
    )

    return async () => {
      await disposeAcceptedInput?.()
      await disposeAdmission?.()
      await disposeOutput?.()
      await disposeTurnEvents()
      disposeRemoteApprovals()
      await this.dispose()
    }
  }

  async dispose(): Promise<void> {
    if (!this.active) return
    this.active = false
    for (const subscription of this.transcriptSubscriptions.values()) {
      subscription.controller.abort()
    }
    await Promise.allSettled(
      [...this.transcriptSubscriptions.values()].map((subscription) => subscription.task)
    )
    this.transcriptSubscriptions.clear()
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

  /** Wake the connection after the package Coordinator subscribes to its inbox. */
  resumeInbox(): void {
    this.connection?.resumeInbox()
  }

  async status(input: CollaborationStatusReadInput = {}): Promise<CollaborationStatusSnapshot> {
    const connection = this.requireConnection()
    if (input.refreshDashboards) await connection.refreshDashboardsForPage()
    const state = this.store.snapshot()
    const configured = await this.settings.read()
    const connectionState = connection.state()
    const localAgentId = connection.localAgentId()
    const agentAuthorityReady = localAgentId
      ? (await this.options.agentCloudRuntime.authorityStatus(localAgentId)).state === 'ready'
      : false
    const localAgent = state.agents.find((agent) => agent.agentId === localAgentId)
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
            ...(agent.lastSeenAt ? { lastSeenAt: agent.lastSeenAt } : {})
          }))
        }
      : undefined
    const projections = state.projections.map((projection) => (
      this.projectionView(projection.projection)
    ))
    const taskViews = this.taskViews(state, {})
    const projectViews = state.projects.map((project) => ({
      projectId: project.projectId,
      name: project.displayName,
      state: mapProjectState(project.status),
      revision: project.revision,
      coordinatorAgentId: project.coordinatorAgentId,
      tasks: taskViews.filter((task) => task.projectId === project.projectId)
    }))
    const dashboards = connection.cloudDashboards()
    const coordinationSlices = connection.publicCoordinationSlices()
    return {
      revision: state.revision,
      connection: {
        configured: configured.settings !== null,
        ...(configured.settings ? { baseUrl: configured.settings.baseUrl } : {}),
        state: configured.settings ? connectionState.state : 'unconfigured',
        agentAuthorityReady,
        ...(localAgent ? { localAgentId: localAgent.agentId } : {}),
        ...(connectionState.lastConnectedAt ? { lastConnectedAt: connectionState.lastConnectedAt } : {}),
        lastInboxSequence: state.lastInboxSequence,
        pendingOutboxCount: state.outbox.filter((entry) => (
          entry.state !== 'delivered'
        )).length,
        ...(state.outboxWait ? { outboxWait: state.outboxWait } : {}),
        ...(connectionState.lastError ? { lastError: connectionState.lastError } : {})
      },
      providerOptions: [...connection.providers()],
      managedContainers: state.managedContainers,
      ...(participant ? { participant } : {}),
      projections,
      projects: projectViews,
      dashboards: [...dashboards],
      ...(coordinationSlices.agentProfiles.length > 0
        ? { agentProfiles: [...coordinationSlices.agentProfiles] }
        : {}),
      ...(coordinationSlices.devices.length > 0
        ? { devices: [...coordinationSlices.devices] }
        : {}),
      ...(coordinationSlices.notifications.length > 0
        ? { notifications: [...coordinationSlices.notifications] }
        : {}),
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

  /** Current exact Agent identity owned by this local runtime, if active. */
  localAgentId(): string | undefined {
    return this.connection?.localAgentId()
  }

  async configureConnection(baseUrl?: string): Promise<CollaborationStatusSnapshot['connection']> {
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

  async linkProjection(input: CollaborationProjectionLinkInput): Promise<CollaborationProjectionView> {
    const previous = this.projectionLinkTail
    let release!: () => void
    this.projectionLinkTail = new Promise<void>((resolve) => { release = resolve })
    await previous
    try {
      return await this.linkProjectionSerial(input)
    } finally {
      release()
    }
  }

  private async linkProjectionSerial(input: CollaborationProjectionLinkInput): Promise<CollaborationProjectionView> {
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
    if (input.mode === 'existing' && (
      localSessionProjectionBindingFor(state, input.runtimeId, input.threadId) ||
      state.projections.some((candidate) => (
        candidate.runtimeId === input.runtimeId && candidate.threadId === input.threadId
      ))
    )) {
      throw new Error('This local Session is permanently bound to one phone Topic.')
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
      if (input.mode === 'existing') {
        claimLocalSessionProjectionBinding(
          draft,
          projection,
          input.runtimeId,
          input.threadId,
          projection.updatedAt
        )
      }
      draft.projections.push(localProjectionFromRemote(projection, {
        runtimeId: input.runtimeId,
        ...(input.mode === 'existing' ? { threadId: input.threadId } : {}),
        ...(input.workspaceRoot ? { workspaceRoot: input.workspaceRoot } : {}),
        bindingMode: input.mode
      }))
    })
    if (input.mode === 'existing') {
      await this.reconcileProjectionTranscript(projection.projectionId)
      this.syncTranscriptSubscriptions()
    }
    return this.projectionView(projection)
  }

  async updateProjection(input: CollaborationProjectionUpdateInput): Promise<CollaborationProjectionView> {
    const local = this.store.snapshot().projections.find((candidate) => (
      candidate.projection.projectionId === input.projectionId
    ))
    if (!local) throw new Error('Projection was not found.')
    if (local.projection.revision !== input.expectedRevision) throw new Error('Projection revision is stale.')
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
    }))
    const projection = requireProjectionResponse(response)
    await this.replaceProjection(projection)
    if (projection.status === 'active') await this.requireProjections().recover()
    this.syncTranscriptSubscriptions()
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
    if (input.scope === 'dashboard') await this.requireConnection().refreshDashboards()
  }

  /** A human public comment; the Cloud appends the redacted activity event. */
  async publishActivityComment(input: CollaborationActivityCommentInput): Promise<Readonly<{
    event: PublicActivityEvent
    mentionedUserIds: readonly string[]
  }>> {
    const response = await this.requireConnection().executeAsUser(restRequestSchema.parse({
      protocolVersion: '1.0',
      requestId: collaborationRequestId(),
      type: 'project.activity.comment',
      idempotencyKey: `idem_project.activity.comment.${digest(input.commentId).slice(0, 48)}`,
      projectId: input.projectId,
      taskId: input.taskId,
      text: input.text,
      mentionedUserIds: input.mentionedUserIds,
      visibility: 'project_public'
    }))
    if (response.type === 'rest.error') throw new Error(response.error.message)
    if (response.type !== 'rest.public_activity_published') {
      throw new Error(`Public comment returned unexpected ${response.type}.`)
    }
    await this.refreshDashboardsAfterCommand()
    return { event: response.event, mentionedUserIds: response.mentionedUserIds }
  }

  /** Marks one durable notification read with its expected revision. */
  async markNotificationRead(
    input: CollaborationNotificationMarkReadInput
  ): Promise<NotificationProjection> {
    const response = await this.requireConnection().executeAsUser(restRequestSchema.parse({
      protocolVersion: '1.0',
      requestId: collaborationRequestId(),
      type: 'notification.mark_read',
      idempotencyKey: `idem_notification.mark_read.${digest(
        `${input.notificationId}\u0000${input.expectedRevision}`
      ).slice(0, 48)}`,
      notificationId: input.notificationId,
      expectedRevision: input.expectedRevision
    }))
    if (response.type === 'rest.error') throw new Error(response.error.message)
    if (response.type !== 'rest.notification_marked') {
      throw new Error(`Notification read returned unexpected ${response.type}.`)
    }
    await this.refreshDashboardsAfterCommand()
    return response.notification
  }

  /**
   * A completed Desktop command re-reads the Dashboard projections. The command
   * itself already succeeded, so a failed re-read is reported as a diagnostic
   * by the connection rather than turning the command into a failure.
   */
  private async refreshDashboardsAfterCommand(): Promise<void> {
    await this.requireConnection().refreshDashboards().catch(() => undefined)
  }

  async discoverPrivateChannels(humanEndpointId: string): Promise<Readonly<{ locatorCount: number }>> {
    return {
      locatorCount: await this.requireConnection().refreshEndpointLocators(humanEndpointId)
    }
  }

  async manageContainer(input: CollaborationManagedContainerManageInput): Promise<Readonly<{
    managedContainer: ManagedProviderContainer | null
    locatorCount?: number
  }>> {
    const connection = this.requireConnection()
    if (input.action === 'refresh-locators') {
      return { managedContainer: null, locatorCount: await connection.refreshEndpointLocators(input.humanEndpointId) }
    }
    if (input.action === 'refresh-status') {
      const containers = await connection.refreshManagedContainers()
      const localAgentId = connection.localAgentId()
      if (!localAgentId) throw new Error('Register this computer before refreshing managed Channels.')
      const pending = new Map<string, number>()
      for (const container of containers) {
        if (!container.container || !['active', 'drifted', 'failed'].includes(container.status)) continue
        pending.set(container.managedContainerId, container.revision)
        await connection.executeAsUser(restRequestSchema.parse({
          protocolVersion: '1.0', requestId: collaborationRequestId(), type: 'managed_container.inspect',
          idempotencyKey: `idem_managed_container.inspect.${digest(`${container.managedContainerId}\u0000${container.revision}`).slice(0, 48)}`,
          managedContainerId: container.managedContainerId, agentId: localAgentId, expectedRevision: container.revision
        }))
      }
      for (let attempt = 0; attempt < 40 && pending.size > 0; attempt += 1) {
        await delay(250)
        for (const container of await connection.refreshManagedContainers()) {
          const previousRevision = pending.get(container.managedContainerId)
          if (previousRevision !== undefined && container.revision !== previousRevision) pending.delete(container.managedContainerId)
        }
      }
      return { managedContainer: null }
    }
    const state = this.store.snapshot()
    const localAgentId = connection.localAgentId()
    if (!localAgentId) throw new Error('Register this computer before managing a Channel.')
    let response: RestResponse
    if (input.action === 'ensure') {
      if (!state.user) throw new Error('A verified user is required to create a managed Channel.')
      const provider = state.endpoints.find((endpoint) => endpoint.humanEndpointId === input.humanEndpointId)?.identity.provider
      if (!provider || !connection.providers().some((option) => option.providerKey === provider && option.managedContainers)) {
        throw new Error('This endpoint Provider does not offer managed Channels.')
      }
      const existing = state.managedContainers.find((container) => container.humanEndpointId === input.humanEndpointId)
      const requestId = collaborationRequestId()
      const retryToken = existing?.status === 'failed' && !existing.container
        ? `${existing.revision}\u0000${requestId}` : undefined
      response = await connection.executeAsUser(restRequestSchema.parse({
        protocolVersion: '1.0', requestId, type: 'managed_container.ensure',
        idempotencyKey: managedContainerEnsureIdempotencyKey(state.user.userId, input.humanEndpointId, retryToken),
        humanEndpointId: input.humanEndpointId, agentId: localAgentId,
        policy: {
          version: 1, visibility: 'private', history: 'protected', membership: 'owner_and_message_bot',
          memberManagement: 'provisioning_service_only', channelManagement: 'provisioning_service_only',
          ownerCanSend: true, ownerCanCreateTopics: true, messageBotCanSend: true,
          messageBotCreatesProjectTopics: false
        }
      }))
    } else {
      response = await connection.executeAsUser(restRequestSchema.parse({
        protocolVersion: '1.0', requestId: collaborationRequestId(),
        type: input.action === 'reconcile' ? 'managed_container.reconcile' : 'managed_container.archive',
        idempotencyKey: `idem_managed_container.${input.action}.${digest(`${input.managedContainerId}\u0000${input.expectedRevision}`).slice(0, 48)}`,
        managedContainerId: input.managedContainerId, agentId: localAgentId,
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
        ...draft.managedContainers.filter((item) => item.managedContainerId !== managedContainer.managedContainerId),
        managedContainer
      ]
    })
    return { managedContainer }
  }

  readTaskChats(input: TaskChatReadInput) {
    const state = this.store.snapshot()
    const identity = this.options.authenticatedCloudTransport.status()
    if (identity.state !== 'ready' || state.user?.userId !== identity.userId) return { associations: [], activeTaskId: null }
    const visible = new Set(state.projects.filter(project => !state.projectUnavailableFences.some(fence => fence.projectId === project.projectId)).map(project => project.projectId))
    const associations = state.taskChatAssociations.filter(item => item.userId === identity.userId && visible.has(item.projectId) && (!input.taskId || item.taskId === input.taskId) && (!input.runtimeId || item.runtimeId === input.runtimeId) && (!input.threadId || item.threadId === input.threadId))
      // Optional fields in existing in-memory state may be explicitly undefined.
      // Publish their absent wire shape without weakening the capability JSON check.
      .map(({ turnId, clientDirectiveId, endedAt, endMessageId, ...association }) => ({
        ...association,
        ...(turnId === undefined ? {} : { turnId }),
        ...(clientDirectiveId === undefined ? {} : { clientDirectiveId }),
        ...(endedAt === undefined ? {} : { endedAt }),
        ...(endMessageId === undefined ? {} : { endMessageId })
      }))
    const key = JSON.stringify([identity.userId, input.runtimeId, input.threadId])
    const dedicated = state.taskRuns.find(run => run.runtimeId === input.runtimeId && run.threadId === input.threadId && run.execution?.assigneeUserId === identity.userId && visible.has(run.offer.projectId))
    return { associations, detached: state.taskChatClosedSessions.includes(key), activeTaskId: !input.runtimeId || !input.threadId || state.taskChatClosedSessions.includes(key) ? null : associations.at(-1)?.taskId ?? dedicated?.offer.taskId ?? null }
  }

  private async recordAcceptedTaskChatInput(event: SessionAcceptedInputEvent): Promise<void> {
    const identity = this.options.authenticatedCloudTransport.status()
    if (identity.state !== 'ready' || this.store.snapshot().user?.userId !== identity.userId || event.principal?.subject !== identity.userId) return
    const { runtimeId, threadId } = event
    const key = JSON.stringify([identity.userId, runtimeId, threadId])
    const occurredAt = (this.options.now?.() ?? new Date()).toISOString()
    await this.store.transact(state => {
      if (state.user?.userId !== identity.userId) return
      const inputKey = JSON.stringify([identity.userId, runtimeId, threadId, event.receipt.clientDirectiveId, event.receipt.revision])
      if (state.taskChatAcceptedInputs.includes(inputKey)) return
      const previous = [...state.taskChatAssociations].reverse().find(item => item.userId === identity.userId && item.runtimeId === runtimeId && item.threadId === threadId)
      const explicitIds = referencedTaskIds(event.text)
      if (explicitIds.length > 1) throw new Error('每条消息只能关联一个任务，请移除其他任务后再发送。')
      if (event.text.includes(TASK_CHAT_END) && !explicitIds.length) {
        state.taskChatAcceptedInputs.push(inputKey)
        if (!state.taskChatClosedSessions.includes(key)) state.taskChatClosedSessions.push(key)
        if (previous && !previous.endedAt) { previous.endedAt = occurredAt; previous.endMessageId = event.receipt.clientDirectiveId }
        return
      }
      const dedicated = state.taskRuns.find(run => run.runtimeId === runtimeId && run.threadId === threadId && run.execution?.assigneeUserId === identity.userId)
      const inheritedTaskId = previous?.taskId ?? dedicated?.offer.taskId
      const ids = explicitIds.length ? explicitIds : inheritedTaskId && !state.taskChatClosedSessions.includes(key) ? [inheritedTaskId] : []
      if (!ids.length) return
      state.taskChatAcceptedInputs.push(inputKey)
      for (const taskId of ids) {
        const task = state.tasks.find(item => item.taskId === taskId) ?? this.connection?.cloudDashboards().filter(dashboard => !dashboard.revoked && !dashboard.stale).flatMap(dashboard => dashboard.tasks).find(item => item.taskId === taskId)
        if (!task || !state.projects.some(item => item.projectId === task.projectId) || state.projectUnavailableFences.some(item => item.projectId === task.projectId)) continue
        if (previous && previous.taskId !== taskId && !previous.endedAt) { previous.endedAt = occurredAt; previous.endMessageId = event.receipt.clientDirectiveId }
        state.taskChatClosedSessions = state.taskChatClosedSessions.filter(item => item !== key)
        state.taskChatAssociations.push({ userId: identity.userId, projectId: task.projectId, taskId, runtimeId, threadId, ...(event.receipt.turnId === undefined ? {} : { turnId: event.receipt.turnId }), clientDirectiveId: event.receipt.clientDirectiveId, messageId: event.receipt.clientDirectiveId, occurredAt })
      }
    })
  }

  private async recordTaskChatTurn(runtimeId: string, threadId: string, turnId: string, _occurredAt: string, subject?: string, clientDirectiveId?: string): Promise<void> {
    const identity = this.options.authenticatedCloudTransport.status()
    if (!clientDirectiveId || identity.state !== 'ready' || subject !== identity.userId) return
    const thread = await this.context!.agentThreads.read({ runtimeId, threadId })
    const turn = thread.turns.find(item => item.id === turnId)
    const message = turn?.messages.find(item => item.kind === 'user-message')
    await this.store.transact(state => {
      for (const item of state.taskChatAssociations) {
        if (item.userId === identity.userId && item.runtimeId === runtimeId && item.threadId === threadId && item.clientDirectiveId === clientDirectiveId) {
          item.turnId = turnId
          if (message) item.messageId = message.itemId
        }
      }
    })
  }

  listTasks(input: CollaborationTaskListInput): readonly CollaborationTaskView[] {
    return this.taskViews(this.store.snapshot(), input)
  }

  private taskViews(
    snapshot: CollaborationLocalState,
    input: CollaborationTaskListInput
  ): readonly CollaborationTaskView[] {
    const states = new Set(input.states ?? [])
    const projectIds = new Set(snapshot.projects.map(({ projectId }) => projectId))
    return [
      ...snapshot.pendingTaskOffers
        .filter((offer) => (
          projectIds.has(offer.projectId) && (!input.projectId || offer.projectId === input.projectId)
        ))
        .map((offer) => mapPendingTaskOfferView(
          offer,
          this.tasks?.offerAvailability(offer.taskOfferId) ?? {
            state: 'unverified', reason: 'recovery_evidence_missing',
            canAccept: false, canReject: false, canDismiss: false
          },
          snapshot.tasks.find((task) => task.taskId === offer.taskId)
        )),
      ...snapshot.taskRuns
        .filter((run) => (
          projectIds.has(run.offer.projectId) && (!input.projectId || run.offer.projectId === input.projectId)
        ))
        .map((run) => collaborationTaskViewForRun(
          run,
          snapshot.taskInteractions
        ))
    ]
      .filter((task) => states.size === 0 || states.has(task.state))
  }

  /**
   * Persist and, when the exact Worker Runtime Session is available, dispatch
   * one local human intervention. Cloud Task/Execution facts remain owned by
   * their existing canonical capabilities.
   */
  submitTaskInteraction(input: TaskInteractionSubmit): Promise<CollaborationTaskInteraction> {
    return this.requireTasks().submitTaskInteraction(input)
  }

  /**
   * Authorize an ordinary Agent Session against the exact local Worker run.
   * The capability broker authenticates the Principal and Session envelope;
   * this domain joins those facts to its own durable execution ownership.
   */
  authorizeTaskInteraction(
    input: Readonly<{ projectId: string; taskId: string; executionId?: string | null }>,
    session: Readonly<{ runtimeId: string; threadId: string }>,
    principalUserId: string
  ): void {
    const state = this.store.snapshot()
    if (state.user?.userId !== principalUserId) {
      throw new Error('The current Principal does not own this local collaboration identity.')
    }
    const candidates = state.taskRuns.filter((run) => (
      run.offer.projectId === input.projectId &&
      run.offer.taskId === input.taskId &&
      (!input.executionId || run.offer.executionId === input.executionId)
    ))
    const boundRuns = candidates.filter((candidate) => (
      candidate.runtimeId === session.runtimeId && candidate.threadId === session.threadId
    ))
    if (boundRuns.length !== 1) {
      throw new Error('The ordinary Agent Session is not bound to this exact Worker execution.')
    }
    const run = boundRuns[0]
    if (input.executionId && run.offer.executionId !== input.executionId) {
      throw new Error('The requested execution does not match the bound Worker Session.')
    }
    if (
      !run.execution ||
      run.execution.assigneeUserId !== principalUserId ||
      run.execution.assigneeAgentId !== this.localAgentId()
    ) {
      throw new Error('The current Principal and local Agent Device do not own this Worker execution.')
    }
  }

  appendTaskCheckpoint(input: TaskCheckpointCreate): Promise<CollaborationTaskCheckpoint> {
    return this.requireTasks().appendTaskCheckpoint(input)
  }

  /** Local reads remain available offline, but never across Host/store accounts. */
  authorizeTaskInteractionRead(principalUserId: string): void {
    const identity = this.options.authenticatedCloudTransport.status()
    if (!principalUserId || this.store.snapshot().user?.userId !== principalUserId ||
        ('userId' in identity && identity.userId !== principalUserId)) {
      throw new Error('The current Principal does not own this local collaboration identity.')
    }
  }

  async readTaskInteractionView(
    input: Readonly<{ projectId: string; taskId: string; executionId?: string }>,
    access: Readonly<{ userId: string; assertCurrent(): void }>
  ): Promise<LocalTaskInteractionView> {
    access.assertCurrent()
    await this.openLocalStore()
    access.assertCurrent()
    this.authorizeTaskInteractionRead(access.userId)
    const view = this.taskInteractionView(input.projectId, input.taskId, input.executionId, access.userId)
    access.assertCurrent()
    this.authorizeTaskInteractionRead(access.userId)
    return view
  }

  taskInteractionView(
    projectId: string,
    taskId: string,
    executionId: string | undefined,
    principalUserId: string
  ): LocalTaskInteractionView {
    this.authorizeTaskInteractionRead(principalUserId)
    return this.requireTasks().taskInteractionView(projectId, taskId, executionId)
  }

  listTaskInteractions(
    projectId: string,
    taskId: string | undefined,
    principalUserId: string
  ): readonly CollaborationTaskInteraction[] {
    this.authorizeTaskInteractionRead(principalUserId)
    return this.requireTasks().listTaskInteractions(projectId, taskId)
  }

  listTaskCheckpoints(
    projectId: string,
    taskId: string | undefined,
    principalUserId: string
  ): readonly CollaborationTaskCheckpoint[] {
    this.authorizeTaskInteractionRead(principalUserId)
    return this.requireTasks().listTaskCheckpoints(projectId, taskId)
  }

  private openLocalStore(): Promise<CollaborationLocalState> {
    return this.storeOpening ??= this.store.open()
  }

  async listWorkerSessionBindings(): Promise<readonly WorkerSessionExecutionBinding[]> {
    await this.openLocalStore()
    const snapshot = this.store.snapshot()
    return Object.freeze(snapshot.taskRuns.flatMap((run) => {
      if (
        !run.runtimeId ||
        !run.threadId ||
        !run.execution ||
        !run.task
      ) return []
      return [workerSessionExecutionBindingSchema.parse({
        schemaVersion: 1,
        projectId: run.offer.projectId,
        taskId: run.offer.taskId,
        executionId: run.offer.executionId,
        runtimeId: run.runtimeId,
        threadId: run.threadId,
        workerUserId: run.execution.assigneeUserId,
        assigneeAgentId: run.execution.assigneeAgentId,
        assigneeDeviceId: run.execution.assigneeDeviceId,
        taskRevision: run.task.revision,
        executionRevision: run.execution.revision,
        executionState: run.execution.state,
        fenceStatus: run.state === 'fenced' || run.state === 'failed' ? 'fenced' : run.execution.fence.status,
        projectExecutionAuthorityEpoch:
          run.execution.fence.projectExecutionAuthorityEpoch,
        userTaskAuthorityEpoch: run.execution.fence.userTaskAuthorityEpoch,
        updatedAt: run.updatedAt
      })]
    }))
  }

  async decideTaskOffer(input: CollaborationTaskOfferDecisionInput): Promise<void> {
    await this.requireTasks().decideOffer(input.taskOfferId, { decision: input.decision })
    await this.refreshDashboardsAfterCommand()
  }

  async openTaskSession(input: Readonly<{ projectId: string; taskId: string; executionId?: string }>) {
    const identity = this.options.authenticatedCloudTransport.status()
    if (identity.state !== 'ready' || this.store.snapshot().user?.userId !== identity.userId) throw new Error('请使用当前协作账户打开任务会话。')
    const runs = this.store.snapshot().taskRuns.filter((run) => run.offer.projectId === input.projectId &&
      run.offer.taskId === input.taskId && (!input.executionId || run.offer.executionId === input.executionId) &&
      run.execution?.assigneeUserId === identity.userId && run.execution.assigneeAgentId === this.localAgentId())
    if (runs.length !== 1) throw new Error('请指定当前任务执行，再打开会话。')
    const session = await this.requireTasks().ensureTaskSession({ ...input, executionId: runs[0]!.offer.executionId }, identity.userId)
    return { opened: true as const, sessionId: session.threadId, ...session }
  }

  async pauseTask(input: Readonly<{ projectId: string; taskId: string; executionId: string }>): Promise<void> {
    const identity = this.options.authenticatedCloudTransport.status()
    const run = this.store.snapshot().taskRuns.find((candidate) => candidate.offer.executionId === input.executionId)
    if (identity.state !== 'ready' || this.store.snapshot().user?.userId !== identity.userId ||
        !run || run.offer.projectId !== input.projectId || run.offer.taskId !== input.taskId ||
        run.execution?.assigneeUserId !== identity.userId || run.execution.assigneeAgentId !== this.localAgentId()) {
      throw new Error('只有当前电脑上的任务执行人可以暂停任务。')
    }
    if (this.taskInteractionView(input.projectId, input.taskId, input.executionId, identity.userId).state === 'paused_local') return
    const interaction = await this.submitTaskInteraction({ ...input, kind: 'pause', origin: 'human' })
    if (interaction.state !== 'applied') throw new Error(interaction.error ?? '任务暂停尚未完成，请检查当前任务状态。')
  }

  async startTask(input: Parameters<CollaborationTaskAdapter['startTask']>[0]): Promise<void> {
    const identity = this.options.authenticatedCloudTransport.status()
    if (identity.state !== 'ready' || this.store.snapshot().user?.userId !== identity.userId) throw new Error('请使用当前协作账户开始任务。')
    await this.requireTasks().startTask(input, identity.userId)
    await this.refreshDashboardsAfterCommand()
  }

  async continueTaskSession(input: CollaborationTaskSessionContinueInput): Promise<CollaborationTaskSessionContinueResult> {
    const identity = this.options.authenticatedCloudTransport.status()
    if (identity.state !== 'ready' || this.store.snapshot().user?.userId !== identity.userId) throw new Error('请使用当前协作账户接续任务。')
    const result = await this.requireTasks().continueTaskSession(input, identity.userId)
    await this.refreshDashboardsAfterCommand()
    return result
  }

  async returnTask(input: CollaborationTaskReturnInput): Promise<void> {
    const identity = this.options.authenticatedCloudTransport.status()
    if (identity.state !== 'ready' || this.store.snapshot().user?.userId !== identity.userId) {
      throw new Error('请使用当前协作账户退回任务。')
    }
    await this.requireTasks().returnTask(input, identity.userId)
    await this.refreshDashboardsAfterCommand()
  }

  /**
   * The sole Coordinator Agent write path. The internal-service caller cannot
   * nominate an Agent; the durable outbox binds the currently active local
   * Agent immediately before Identity executes the strict Cloud command.
   */
  async executeCoordinatorCloudCommand(command: CoordinatorCloudCommand): Promise<RestResponse> {
    const response = await this.requireOutbox().enqueueAndWait(
      'coordinator.command',
      coordinatorCloudCommandSchema.parse(command)
    )
    await this.refreshDashboardsAfterCommand()
    return response
  }

  async resumeCoordinatorCloudCommand(
    idempotencyKey: string,
    validateCommand: CoordinatorCloudCommandReplayValidator
  ): Promise<CoordinatorCloudCommandReplay | null> {
    const replay = await this.requireOutbox().resumeAndWait(
      'coordinator.command',
      idempotencyKey,
      (request) => validateCommand(coordinatorCloudCommandSchema.parse(request))
    )
    if (!replay) return null
    return Object.freeze({
      command: coordinatorCloudCommandSchema.parse(replay.request),
      response: replay.response
    })
  }

  /**
   * Human Owner/Worker decisions travel with User credentials on the same
   * durable outbox; the authenticated transport binds the current User/Device.
   */
  async executeCoordinatorUserCloudCommand(command: CoordinatorUserCloudCommand): Promise<RestResponse> {
    const response = await this.requireOutbox().enqueueAndWait(
      'delivery.command',
      coordinatorUserCloudCommandSchema.parse(command)
    )
    await this.refreshDashboardsAfterCommand()
    return response
  }

  async resumeCoordinatorUserCloudCommand(
    idempotencyKey: string,
    validateCommand: CoordinatorUserCloudCommandReplayValidator
  ): Promise<CoordinatorUserCloudCommandReplay | null> {
    const replay = await this.requireOutbox().resumeAndWait(
      'delivery.command',
      idempotencyKey,
      (request) => validateCommand(coordinatorUserCloudCommandSchema.parse(request))
    )
    if (!replay) return null
    return Object.freeze({
      command: coordinatorUserCloudCommandSchema.parse(replay.request),
      response: replay.response
    })
  }

  async workerDeliveryView(input: WorkerDeliveryReadInput, source?: Readonly<{ runtimeId: string; threadId: string; userId: string; assertCurrent(): void }>): Promise<WorkerDeliveryView> {
    if (source) await this.authorizeAgentDraftContext(input, source)
    return this.requireTasks().refreshWorkerDelivery(input)
  }

  listWorkerDeliveryMaterials(input: WorkerDeliveryMaterialsInput): Promise<WorkerDeliveryMaterialsResult> {
    return this.requireTasks().listWorkerDeliveryMaterials(input)
  }

  importWorkerDeliveryMaterial(input: WorkerDeliveryMaterialImportInput) {
    const identity = this.options.authenticatedCloudTransport.status()
    if (identity.state !== 'ready' || identity.userId !== this.store.snapshot().user?.userId) {
      throw new Error('请先连接当前任务执行人的云端账户。')
    }
    return this.requireTasks().importWorkerDeliveryMaterial(input)
  }

  async saveWorkerDeliveryDraft(input: WorkerDeliveryDraftSaveInput, source?: Readonly<{ runtimeId: string; threadId: string; userId: string; assertCurrent(): void }>): Promise<WorkerDeliveryView> {
    if (!source) return this.requireTasks().saveWorkerDeliveryDraft(input)
    const sourceChat = await this.authorizeAgentDraftContext(input, source)
    return this.requireTasks().saveWorkerDeliveryDraft(input, sourceChat)
  }

  private async authorizeAgentDraftContext(input: WorkerDeliveryReadInput, source: Readonly<{ runtimeId: string; threadId: string; userId: string; assertCurrent(): void }>) {
    source.assertCurrent()
    const identity = this.options.authenticatedCloudTransport.status()
    const run = this.store.snapshot().taskRuns.find(item => item.offer.executionId === input.executionId)
    if (identity.state !== 'ready' || identity.userId !== source.userId || this.store.snapshot().user?.userId !== source.userId || run?.execution?.assigneeUserId !== source.userId || run.offer.taskId !== input.taskId || run.offer.projectId !== input.projectId) throw new Error('只有当前任务执行人可以从关联聊天写入草稿。')
    if (!this.store.snapshot().projects.some(project => project.projectId === input.projectId) || this.store.snapshot().projectUnavailableFences.some(fence => fence.projectId === input.projectId)) throw new Error('项目访问权限已失效。')
    const thread = await this.context!.agentThreads.read({ runtimeId: source.runtimeId, threadId: source.threadId })
    const turn = thread.turns.at(-1)
    const association = this.readTaskChats({ runtimeId: source.runtimeId, threadId: source.threadId })
    if (!turn || (association.activeTaskId !== input.taskId)) throw new Error('请先在当前聊天中引用此任务。')
    source.assertCurrent()
    return { runtimeId: source.runtimeId, threadId: source.threadId, turnId: turn.id }

  }

  async cancelFailedWorkerDelivery(input: import('../worker-delivery.js').WorkerDeliveryCancelInput): Promise<WorkerDeliveryView> {
    return this.requireTasks().cancelFailedWorkerDelivery(input)
  }

  async submitWorkerDelivery(input: WorkerDeliverySubmitInput): Promise<WorkerDeliveryView> {
    const view = await this.requireTasks().submitWorkerDelivery(input)
    await this.refreshDashboardsAfterCommand()
    return view
  }

  async disposeWorkerResidual(input: WorkerResidualDisposeInput): Promise<WorkerDeliveryView> {
    return this.requireTasks().disposeWorkerResidual(input)
  }

  private async reconcileTranscriptSnapshots(): Promise<void> {
    for (const projection of this.store.snapshot().projections) {
      if (projection.threadId) {
        await this.reconcileProjectionTranscript(projection.projection.projectionId)
      }
    }
  }

  private async reconcileProjectionTranscript(projectionId: string): Promise<void> {
    const state = this.store.snapshot()
    const projection = state.projections.find((candidate) => (
      candidate.projection.projectionId === projectionId
    ))
    if (!projection?.threadId || !this.context) return
    const finalizedTurnIds = new Set(state.queue
      .filter((item) => (
        item.projectionId === projectionId &&
        item.direction === 'outbound' &&
        item.kind === 'assistant-reply' &&
        Boolean(item.turnId)
      ))
      .map((item) => item.turnId!))
    const recoverableTurnIds = new Set(state.queue
      .filter((item) => (
        item.projectionId === projectionId &&
        item.direction === 'inbound' &&
        item.origin === 'human-endpoint' &&
        item.kind === 'user-message' &&
        item.state === 'completed' &&
        Boolean(item.turnId) &&
        !finalizedTurnIds.has(item.turnId!)
      ))
      .map((item) => item.turnId!))
    if (recoverableTurnIds.size === 0) return
    const thread = await this.context.agentThreads.read({
      runtimeId: projection.runtimeId,
      threadId: projection.threadId
    })
    for (const turn of thread.turns) {
      if (!recoverableTurnIds.has(turn.id)) continue
      await this.requireProjections().reconcileCanonicalTurn({
        runtimeId: projection.runtimeId,
        threadId: projection.threadId,
        turnId: turn.id,
        messages: turn.messages
      })
    }
  }

  private async canHandleProjectInbox(projectId: string): Promise<boolean> {
    return await this.refreshProjectFact(projectId) === 'available'
  }

  private async reconcileProjectFacts(): Promise<void> {
    const state = this.store.snapshot()
    const projectIds = new Set([
      ...state.projects.map(({ projectId }) => projectId),
      ...state.projectUnavailableFences.map(({ projectId }) => projectId),
      ...state.pendingTaskOffers.map(({ projectId }) => projectId),
      ...state.taskRuns.map(({ offer }) => offer.projectId)
    ])
    await Promise.allSettled([...projectIds].map((projectId) => this.refreshProjectFact(projectId)))
  }

  private async refreshProjectFact(projectId: string): Promise<'available' | 'unavailable'> {
    const fence = this.store.snapshot().projectUnavailableFences.find((candidate) => (
      candidate.projectId === projectId
    ))
    if (fence?.kind === 'permanent') return 'unavailable'
    const response = await this.requireConnection().executeAsAgent(restRequestSchema.parse({
      protocolVersion: '1.0',
      requestId: collaborationRequestId(),
      type: 'project.get',
      projectId
    }))
    if (response.type === 'rest.error') {
      if (response.error.code === 'not_found' || response.error.code === 'permission_denied') {
        await this.requireTasks().handleProjectUnavailable(projectId, {
          kind: response.error.code === 'not_found' ? 'permanent' : 'permission-denied',
          reason: response.error.code === 'not_found'
            ? 'Cloud deleted this Project; local execution was fenced.'
            : 'Cloud revoked visibility for this Project; local execution was fenced.'
        })
        return 'unavailable'
      }
      throw new Error(response.error.message)
    }
    if (response.type !== 'rest.entity' || response.entity.type !== 'project') {
      throw new Error(`Project refresh returned unexpected ${response.type}.`)
    }
    const project = response.entity
    const restored = await this.store.transact((draft) => {
      if (draft.projectUnavailableFences.some((candidate) => (
        candidate.projectId === projectId && candidate.kind === 'permanent'
      ))) return false
      draft.projects = replaceById(draft.projects, project, (candidate) => candidate.projectId)
      draft.projectUnavailableFences = draft.projectUnavailableFences.filter((candidate) => (
        candidate.projectId !== projectId
      ))
      return true
    })
    return restored ? 'available' : 'unavailable'
  }

  private async refreshProjectionFromInbox(
    projectionId: string,
    notifiedRevision: number
  ): Promise<void> {
    const response = await this.requireConnection().executeAsAgent(restRequestSchema.parse({
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
    this.syncTranscriptSubscriptions()
  }

  private syncTranscriptSubscriptions(): void {
    if (!this.active || !this.context || !this.projections) return
    const desired = new Map<string, Readonly<{ runtimeId: string; threadId: string }>>()
    for (const projection of this.store.snapshot().projections) {
      if (projection.projection.status !== 'active' || !projection.threadId) continue
      const identity = transcriptSubscriptionKey(projection.runtimeId, projection.threadId)
      desired.set(identity, Object.freeze({
        runtimeId: projection.runtimeId,
        threadId: projection.threadId
      }))
    }
    for (const [identity, subscription] of this.transcriptSubscriptions) {
      if (!desired.has(identity)) {
        this.transcriptSubscriptions.delete(identity)
        subscription.controller.abort()
      }
    }
    for (const [identity, target] of desired) {
      if (this.transcriptSubscriptions.has(identity)) continue
      const controller = new AbortController()
      const task = this.consumeTranscriptProgress(target, controller.signal)
        .catch(() => undefined)
        .finally(() => {
          if (this.transcriptSubscriptions.get(identity)?.controller === controller) {
            this.transcriptSubscriptions.delete(identity)
          }
        })
      this.transcriptSubscriptions.set(identity, Object.freeze({ controller, task }))
    }
  }

  private async consumeTranscriptProgress(
    target: Readonly<{ runtimeId: string; threadId: string }>,
    signal: AbortSignal
  ): Promise<void> {
    let afterSequence: number | undefined
    while (this.active && !signal.aborted && this.context && this.projections) {
      try {
        if (afterSequence === undefined) {
          const thread = await this.context.agentThreads.read(target)
          const watermark = Number(thread.watermark)
          if (Number.isSafeInteger(watermark) && watermark >= 0) afterSequence = watermark
        }
        for await (const message of this.context.agentThreads.subscribeMessages({
          ...target,
          ...(afterSequence === undefined ? {} : { afterSequence }),
          signal
        })) {
          afterSequence = Math.max(afterSequence ?? 0, message.sequence)
          await this.mirrorLiveProgress(target, message)
        }
      } catch {
        if (signal.aborted || !this.active) return
      }
      await abortableDelay(1_000, signal)
    }
  }

  private async mirrorLiveProgress(
    target: Readonly<{ runtimeId: string; threadId: string }>,
    message: DomainAgentTranscriptMessageEvent
  ): Promise<void> {
    if (message.kind !== 'assistant-progress' || !message.turnId) return
    const matching = activeProjectionBindingsForSession(
      this.store.snapshot().projections,
      target.runtimeId,
      target.threadId
    )
    if (matching.length !== 1) return
    await this.requireProjections().mirrorCanonicalTurn({
      runtimeId: target.runtimeId,
      threadId: target.threadId,
      turnId: message.turnId,
      messages: [message]
    })
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
export function activeProjectionBindingsForSession(
  projections: readonly CollaborationLocalProjection[],
  runtimeId: string,
  threadId: string
): CollaborationLocalProjection[] {
  return projections.filter((projection) => (
    projection.projection.status === 'active' &&
    projection.runtimeId === runtimeId &&
    projection.threadId === threadId
  ))
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

export function collaborationTaskViewForRun(
  run: CollaborationTaskRun,
  interactions: readonly CollaborationTaskInteraction[] = []
): CollaborationTaskView {
  const latestTurn = [...run.agentJournal].reverse().find((entry) => entry.turnId)?.turnId
  const latestOutcome = [...run.agentJournal].reverse().find((entry) => (
    entry.state === 'observed_success' || entry.state === 'observed_failure' || entry.state === 'dispatched' || entry.state === 'prepared'
  ))
  const failure = latestOutcome?.state === 'observed_failure' ? latestOutcome.failure : null
  const retryInteraction = [...interactions].reverse().find((interaction) => (
    interaction.executionId === run.offer.executionId && interaction.kind === 'retry'
  ))
  // This state describes an explicit human reexecution, not automatic Runtime retryability.
  const retryState = !failure
    ? 'unavailable' as const
    : retryInteraction && retryInteraction.updatedAt >= (latestOutcome?.observedAt ?? '')
      ? ['queued', 'dispatching', 'awaiting_cloud'].includes(retryInteraction.state)
        ? 'retrying' as const
        : retryInteraction.state === 'failed' || retryInteraction.state === 'rejected'
          ? 'failed' as const
          : 'available' as const
      : 'available' as const
  const humanQuestion = needsHumanQuestion(run)
  const followup = workerFollowupView(run.followups.at(-1), run.agentJournal.at(-1))
  if (!run.execution) {
    throw new Error('A claimed local Task run is missing its immutable Worker execution.')
  }
  return {
    taskId: run.offer.taskId,
    projectId: run.offer.projectId,
    taskOfferId: run.offer.taskOfferId,
    workerUserId: run.execution.assigneeUserId,
    executionId: run.offer.executionId,
    ...(run.executionMode !== undefined ? { executionMode: run.executionMode } : {}),
    ...(run.execution.contractRevision ?? run.task?.contractRevision ?? run.offer.contractRevision
      ? { contractRevision: run.execution.contractRevision ?? run.task?.contractRevision ?? run.offer.contractRevision! }
      : {}),
    ...(run.execution.contractDigest ?? run.task?.contractDigest ?? run.offer.contractDigest
      ? { contractDigest: run.execution.contractDigest ?? run.task?.contractDigest ?? run.offer.contractDigest! }
      : {}),
    assigneeAgentId: run.offer.recipientAgentId,
    hasDedicatedSession: Boolean(run.runtimeId && run.threadId),
    revision: run.task?.revision ?? run.expectedTaskRevision,
    title: run.task?.title ?? 'Pending Task offer',
    state: run.state,
    ...(followup ? { followup } : {}),
    decisionRequired: false,
    preflightReasons: run.latestPreflight?.reasons ?? [],
    ...(latestTurn ? { localTurnId: latestTurn } : {}),
    ...(failure && latestOutcome?.turnId && !run.authorityFencedAt &&
      run.execution.fence.status === 'open' && ['running', 'waiting-result-confirm'].includes(run.state)
      ? { reexecutionInputId: latestOutcome.clientDirectiveId } : {}),
    ...(run.resultSummary
      ? { resultSummary: boundedTaskPresentationText(run.resultSummary, 4_000) }
      : {}),
    ...(failure ? {
      failure: {
        code: failure.code,
        message: boundedTaskPresentationText(failure.message, 4_000),
        retryable: failure.retryable,
        retryState
      }
    } : {}),
    ...(run.offer.revisionInstruction
      ? { revisionInstruction: boundedTaskPresentationText(run.offer.revisionInstruction, 4_000) }
      : {}),
    ...(humanQuestion ? { needsHumanQuestion: humanQuestion } : {}),
    updatedAt: run.updatedAt,
    ...(run.error ? { error: run.error } : failure ? { error: failure.message } : {})
  }
}

function boundedTaskPresentationText(value: string, maxCodeUnits: number): string {
  if (value.length <= maxCodeUnits) return value
  let truncated = ''
  for (const character of value) {
    if (truncated.length + character.length > maxCodeUnits - 1) break
    truncated += character
  }
  return `${truncated.trimEnd()}…`
}

function needsHumanQuestion(run: CollaborationTaskRun): string | undefined {
  if (run.state !== 'needs-human') return undefined
  const resultText = [...run.agentJournal].reverse().find((entry) => (
    entry.state === 'observed_success' && entry.safeResultText
  ))?.safeResultText
  if (!resultText) return undefined
  try {
    const result = parseWorkerRuntimeResult(resultText)
    return result.outcome === 'needs_human' ? result.question : undefined
  } catch {
    return undefined
  }
}

function mapPendingTaskOfferView(
  offer: CollaborationPendingTaskOffer,
  availability: CollaborationOfferAvailability,
  task?: Task
): CollaborationTaskView {
  const state = offer.state === 'pending'
    ? 'offered' as const
    : offer.state === 'claiming'
      ? 'accept-pending-sync' as const
      : offer.state === 'claimed_elsewhere'
        ? 'claimed-elsewhere' as const
        : offer.state === 'dismissed'
          ? 'dismissed' as const
          : offer.state === 'closed' && offer.closedOutcome === 'timed_out'
            ? 'expired' as const
            : offer.state
  return {
    taskId: offer.taskId,
    projectId: offer.projectId,
    taskOfferId: offer.taskOfferId,
    workerUserId: offer.workerUserId,
    ...(offer.contractRevision
      ? { contractRevision: offer.contractRevision! }
      : {}),
    ...(offer.contractDigest
      ? { contractDigest: offer.contractDigest! }
      : {}),
    hasDedicatedSession: false,
    revision: task?.revision ?? offer.currentTaskRevision,
    title: task?.title ?? 'Pending Task offer',
    state,
    decisionRequired: availability.canAccept,
    offerAvailability: availability,
    preflightReasons: offer.preflightReasons,
    ...(offer.revisionInstruction
      ? { revisionInstruction: boundedTaskPresentationText(offer.revisionInstruction, 4_000) }
      : {}),
    updatedAt: offer.updatedAt,
    ...(offer.error ? { error: offer.error } : {})
  }
}

function replaceById<Value>(
  values: readonly Value[],
  replacement: Value,
  id: (value: Value) => string
): Value[] {
  return [...values.filter((value) => id(value) !== id(replacement)), replacement]
}

export function managedContainerEnsureIdempotencyKey(
  userId: string,
  humanEndpointId: string,
  retryToken?: string
): string {
  const attempt = retryToken ? `\u0000retry\u0000${retryToken}` : ''
  return `idem_managed_container.ensure.${digest(`${userId}\u0000${humanEndpointId}${attempt}`).slice(0, 48)}`
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function transcriptSubscriptionKey(runtimeId: string, threadId: string): string {
  return JSON.stringify([runtimeId.trim(), threadId.trim()])
}

function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const finish = (): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', finish)
      resolve()
    }
    const timer = setTimeout(finish, milliseconds)
    signal.addEventListener('abort', finish, { once: true })
  })
}
