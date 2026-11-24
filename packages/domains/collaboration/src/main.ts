import { TASK_CHAT_READ, taskChatReadInputSchema, taskChatReadResultSchema } from './chat-association-contract.js'
import type { z } from 'zod'
import {
  defineDomainMainInternalServiceDescriptor,
  type DomainMainCapabilityInvocationContext,
  type DomainMainInternalServiceDescriptor,
  type DomainMainHost,
  type DomainMainRuntimeDisposer,
  type DomainMainRuntimeLifecycleContribution
} from '@sciforge/domain-sdk/host'
import type { TrustedDomainProcessEntryInput } from '@sciforge/domain-sdk/main'
import {
  AUTHENTICATED_CLOUD_TRANSPORT_CONTRACT_VERSION,
  AUTHENTICATED_CLOUD_TRANSPORT_SERVICE_ID,
  type AuthenticatedCloudTransport
} from '@sciforge/domain-identity-access/authenticated-cloud-transport'
import {
  DEVICE_FACT_ATTESTATION_SIGNING_CONTRACT_VERSION,
  DEVICE_FACT_ATTESTATION_SIGNING_SERVICE_ID,
  type DeviceFactAttestationSigningService
} from '@sciforge/domain-identity-access/device-fact-attestation-signing'
import {
  AGENT_CLOUD_RUNTIME_CONTRACT_VERSION,
  AGENT_CLOUD_RUNTIME_SERVICE_ID,
  type AgentCloudRuntime
} from '@sciforge/domain-identity-access/agent-cloud-runtime'
import {
  COLLABORATION_CAPABILITY_IDS,
  collaborationConnectionConfigureInputSchema,
  collaborationConnectionConfigureResultSchema,
  collaborationConnectionConnectInputSchema,
  collaborationConnectionConnectResultSchema,
  collaborationEndpointChallengePollInputSchema,
  collaborationEndpointChallengePollResultSchema,
  collaborationEndpointChallengeStartInputSchema,
  collaborationEndpointChallengeStartResultSchema,
  collaborationManagedContainerManageResultSchema,
  collaborationManagedContainerInspectInputSchema,
  collaborationManagedContainerProvisionInputSchema,
  collaborationManagedContainerArchiveInputSchema,
  collaborationPrivateChannelDiscoverInputSchema,
  collaborationPrivateChannelDiscoverResultSchema,
  collaborationProjectionLinkInputSchema,
  collaborationProjectionLinkResultSchema,
  collaborationProjectionShareInputSchema,
  collaborationProjectionShareResultSchema,
  collaborationProjectionUpdateInputSchema,
  collaborationProjectionUpdateResultSchema,
  collaborationStatusReadInputSchema,
  collaborationStatusReadResultSchema,
  collaborationSynchronizationRetryInputSchema,
  collaborationSynchronizationRetryResultSchema,
  collaborationTaskListInputSchema,
  collaborationTaskListResultSchema,
  collaborationTaskInteractionReadInputSchema,
  collaborationTaskInteractionReadResultSchema,
  collaborationTaskCheckpointAppendInputSchema,
  collaborationTaskCheckpointAppendResultSchema,
  collaborationTaskOfferDecisionInputSchema,
  collaborationTaskPauseInputSchema,
  collaborationTaskPauseResultSchema,
  collaborationTaskStartInputSchema,
  collaborationTaskStartResultSchema,
  collaborationTaskReturnInputSchema,
  collaborationTaskReturnResultSchema,
  collaborationActivityCommentInputSchema,
  collaborationActivityCommentResultSchema,
  collaborationNotificationMarkReadInputSchema,
  collaborationNotificationMarkReadResultSchema,
  collaborationTaskOfferDecisionResultSchema,
  collaborationTaskSessionOpenInputSchema,
  collaborationTaskSessionOpenResultSchema,
  collaborationTaskSessionContinueInputSchema,
  collaborationTaskSessionContinueResultSchema,
  type CollaborationConnectionConfigureInput,
  type CollaborationConnectionConnectInput,
  type CollaborationEndpointChallengePollInput,
  type CollaborationEndpointChallengeStartInput,
  type CollaborationManagedContainerManageInput,
  type CollaborationPrivateChannelDiscoverInput,
  type CollaborationProjectionLinkInput,
  type CollaborationProjectionShareInput,
  type CollaborationProjectionUpdateInput,
  type CollaborationStatusReadInput,
  type CollaborationSynchronizationRetryInput,
  type CollaborationTaskListInput,
  type CollaborationTaskInteractionReadInput,
  type CollaborationTaskCheckpointAppendInput,
  type CollaborationTaskOfferDecisionInput,
} from './contract.js'
import {
  workerDeliveryReadInputSchema,
  workerDeliveryMaterialsInputSchema,
  workerDeliveryMaterialsResultSchema,
  workerDeliveryMaterialImportInputSchema,
  workerDeliveryMaterialImportResultSchema,
  workerDeliveryDraftSaveInputSchema,
  workerDeliveryResultSchema,
  workerDeliveryCancelInputSchema,
  workerDeliverySubmitInputSchema,
  workerResidualDisposeInputSchema
} from './worker-delivery.js'
import {
  COLLABORATION_CAPABILITY_FACTORY_CONTRIBUTION,
  COLLABORATION_COORDINATOR_CLOUD_COMMAND_CONTRACT,
  COLLABORATION_COORDINATOR_CLOUD_COMMAND_CONTRIBUTION,
  COLLABORATION_DOMAIN_MODULE_ID,
  COLLABORATION_RUNTIME_LIFECYCLE_CONTRIBUTION,
  COLLABORATION_RUNTIME_LIFECYCLE_CONTRACT,
  COLLABORATION_WORKER_SESSION_PROJECTION_CONTRACT,
  COLLABORATION_WORKER_SESSION_PROJECTION_CONTRIBUTION,
  domainPackageDefinition
} from './definition.js'
import {
  COORDINATOR_CLOUD_COMMAND_CONTRACT_VERSION,
  COORDINATOR_CLOUD_COMMAND_SERVICE_ID,
  defineCoordinatorCloudCommandService,
  type CoordinatorAgentInboxHandler
} from './coordinator-cloud-command.js'
import {
  WORKER_SESSION_PROJECTION_CONTRACT_VERSION,
  WORKER_SESSION_PROJECTION_SERVICE_ID,
  defineWorkerSessionProjectionService
} from './worker-session-projection.js'
import {
  CollaborationRuntime,
  collaborationStatePath,
  type CollaborationRuntimeOptions
} from './main/runtime.js'
import {
  createCoordinatorMainEntry,
  type ProjectCoordinatorCapabilityFactory
} from './coordinator/main.js'

export {
  createProjectCoordinatorCapabilityFactory
} from './coordinator/main.js'
export type {
  ProjectCoordinatorCapabilityFactory,
  ProjectCoordinatorCapabilityOptions
} from './coordinator/main.js'

export {
  ProjectionCoordinator,
  localProjectionFromRemote
} from './main/projection-coordinator.js'
export {
  CollaborationLocalStore,
  FileCollaborationStateBackend
} from './main/store.js'
export {
  CollaborationSettingsService
} from './main/settings.js'
export type {
  CollaborationStateBackend
} from './main/store.js'
export {
  collaborationTaskCheckpointSchema,
  collaborationTaskInteractionSchema
} from './task-interaction.js'
export type {
  CollaborationTaskCheckpoint,
  CollaborationTaskInteraction
} from './task-interaction.js'
export {
  TaskInteractionJournal
} from './main/task-interaction-journal.js'
export type {
  TaskCheckpointCreate,
  TaskInteractionCreate,
  TaskInteractionTransition
} from './main/task-interaction-journal.js'
export {
  TaskInteractionController
} from './main/task-interaction-controller.js'
export type {
  LocalTaskInteractionView,
  TaskInteractionDispatchRequest,
  TaskInteractionDispatchResult,
  TaskInteractionSubmit
} from './main/task-interaction-controller.js'
export {
  localTaskInteractionEventSchema,
  localTaskInteractionStateSchema,
  transitionLocalTaskInteractionState
} from './main/task-interaction-contract.js'
export type {
  LocalTaskInteractionEvent,
  LocalTaskInteractionState
} from './main/task-interaction-contract.js'

type CapabilityEffect = 'read' | 'workspace-write' | 'external-write' | 'destructive'

export type CollaborationCapabilityOptions = Readonly<{
  id: string
  version: string
  title: string
  description: string
  audiences: readonly ('ui' | 'agent' | 'system')[]
  scope: 'global'
  effect: CapabilityEffect
  approval: 'none' | 'confirmation'
  concurrency: Readonly<{
    revision: 'none'
    idempotency: 'none' | 'required'
  }>
  tags: readonly string[]
  inputSchema: z.ZodType
  outputSchema: z.ZodType
  handler: (
    input: unknown,
    context?: DomainMainCapabilityInvocationContext
  ) => Promise<Readonly<{ output: unknown; changed?: boolean }>>
}>

export type CollaborationCapabilityFactory<CapabilityDefinition = unknown> = Readonly<{
  moduleId: typeof COLLABORATION_DOMAIN_MODULE_ID
  policy: Readonly<{
    id: 'collaboration'
    title: 'Collaboration'
    directTransportPrefixes: readonly []
    allowedDirectTransports: readonly []
  }>
  createDefinitions: () => readonly CapabilityDefinition[]
}>

type CollaborationMainContribution<CapabilityDefinition = unknown> =
  | CollaborationCapabilityFactory<CapabilityDefinition>
  | DomainMainRuntimeLifecycleContribution
  | DomainMainInternalServiceDescriptor

type CollaborationMainHost = DomainMainHost & Readonly<{
  createCollaborationRuntime?: (options: CollaborationRuntimeOptions) => CollaborationRuntime
}>

type OwnedRuntime = Readonly<{
  runtime: CollaborationRuntime
  deactivate: DomainMainRuntimeDisposer
}> & { disposed: boolean }

const coordinatorCloudCommandDescriptor = defineDomainMainInternalServiceDescriptor({
  location: 'main.internal-service-descriptor',
  serviceId: COORDINATOR_CLOUD_COMMAND_SERVICE_ID,
  contractVersion: COORDINATOR_CLOUD_COMMAND_CONTRACT_VERSION,
  allowedConsumerModuleIds: ['sciforge.collaboration']
})

const workerSessionProjectionDescriptor = defineDomainMainInternalServiceDescriptor({
  location: 'main.internal-service-descriptor',
  serviceId: WORKER_SESSION_PROJECTION_SERVICE_ID,
  contractVersion: WORKER_SESSION_PROJECTION_CONTRACT_VERSION,
  allowedConsumerModuleIds: ['sciforge.collaboration']
})

export function createDomainMainEntry<CapabilityDefinition = unknown>(
  host: CollaborationMainHost
): TrustedDomainProcessEntryInput<CollaborationMainContribution<CapabilityDefinition>> {
  const packageSettings = host.packageSettings
  const internalServices = host.internalServices
  if (!packageSettings || !internalServices) {
    throw new Error('Collaboration requires package storage and Identity Cloud service mediation.')
  }
  const createRuntime = host.createCollaborationRuntime ?? ((options) => new CollaborationRuntime(options))
  // Local journal reads remain available while network activation is pending or failed.
  let localRuntime: CollaborationRuntime | null = null
  let owned: OwnedRuntime | null = null
  let activation: Promise<OwnedRuntime> | null = null
  let coordinatorInboxHandler: CoordinatorAgentInboxHandler | null = null
  let coordinatorReadySweep: (() => Promise<void>) | null = null

  const requireRuntime = (): CollaborationRuntime => {
    if (!owned || owned.disposed) throw new Error('Collaboration runtime is not active.')
    return owned.runtime
  }
  const coordinatorCloudCommandService = defineCoordinatorCloudCommandService({
    localAgentId: () => owned && !owned.disposed
      ? owned.runtime.localAgentId()
      : undefined,
    execute: (command) => requireRuntime().executeCoordinatorCloudCommand(command),
    executeUser: (command) => requireRuntime().executeCoordinatorUserCloudCommand(command),
    resume: (idempotencyKey, validateCommand) => (
      requireRuntime().resumeCoordinatorCloudCommand(idempotencyKey, validateCommand)
    ),
    resumeUser: (idempotencyKey, validateCommand) => (
      requireRuntime().resumeCoordinatorUserCloudCommand(idempotencyKey, validateCommand)
    ),
    subscribe: (handler) => {
      if (coordinatorInboxHandler) {
        throw new Error('The Coordinator Agent Inbox already has its package owner.')
      }
      coordinatorInboxHandler = handler
      localRuntime?.resumeInbox()
      return () => {
        if (coordinatorInboxHandler === handler) coordinatorInboxHandler = null
      }
    }
  })
  internalServices.register({
    serviceId: COORDINATOR_CLOUD_COMMAND_SERVICE_ID,
    contractVersion: COORDINATOR_CLOUD_COMMAND_CONTRACT_VERSION,
    allowedConsumerModuleIds: coordinatorCloudCommandDescriptor.allowedConsumerModuleIds,
    service: coordinatorCloudCommandService
  })
  internalServices.register({
    serviceId: WORKER_SESSION_PROJECTION_SERVICE_ID,
    contractVersion: WORKER_SESSION_PROJECTION_CONTRACT_VERSION,
    allowedConsumerModuleIds: workerSessionProjectionDescriptor.allowedConsumerModuleIds,
    service: defineWorkerSessionProjectionService({
      listBindings: async () => {
        if (!localRuntime) throw new Error('Collaboration local runtime is not initialized.')
        return localRuntime.listWorkerSessionBindings()
      }
    })
  })
  const disposeOwned = async (record: OwnedRuntime | null): Promise<void> => {
    if (!record || record.disposed) return
    record.disposed = true
    if (owned === record) owned = null
    await record.deactivate()
  }

  const lifecycle: DomainMainRuntimeLifecycleContribution = Object.freeze({
    activate: async (context) => {
      if (owned || activation) throw new Error('Collaboration runtime lifecycle is already active.')
      const pending = (async (): Promise<OwnedRuntime> => {
        const authenticatedCloudTransport = internalServices.acquire<AuthenticatedCloudTransport>(
          AUTHENTICATED_CLOUD_TRANSPORT_SERVICE_ID,
          AUTHENTICATED_CLOUD_TRANSPORT_CONTRACT_VERSION
        )
        const agentCloudRuntime = internalServices.acquire<AgentCloudRuntime>(
          AGENT_CLOUD_RUNTIME_SERVICE_ID,
          AGENT_CLOUD_RUNTIME_CONTRACT_VERSION
        )
        const signing = internalServices.acquire<DeviceFactAttestationSigningService>(
          DEVICE_FACT_ATTESTATION_SIGNING_SERVICE_ID,
          DEVICE_FACT_ATTESTATION_SIGNING_CONTRACT_VERSION
        )
        if (!host.humanActions) {
          throw new Error('Collaboration delivery confirmation requires the Host human-action boundary.')
        }
        const runtime = createRuntime({
          statePath: collaborationStatePath(context.userDataDir),
          packageSettings,
          authenticatedCloudTransport,
          agentCloudRuntime,
          humanActions: host.humanActions,
          signing,
          coordinatorInboxHandler: () => coordinatorInboxHandler,
          onConnectionReady: async () => {
            await coordinatorReadySweep?.()
          },
          sanitizeText: host.textSanitizer?.sanitizeText
        })
        localRuntime = runtime
        try {
          const deactivate = await runtime.activate(context)
          const record: OwnedRuntime = { runtime, deactivate, disposed: false }
          owned = record
          return record
        } catch (error) {
          await runtime.dispose().catch(() => undefined)
          throw error
        }
      })()
      activation = pending
      try {
        const record = await pending
        return () => disposeOwned(record)
      } finally {
        if (activation === pending) activation = null
      }
    }
  })

  // Coordinator is an internal module of this package. Its main entry is
  // composed only after Collaboration has registered the command and Worker
  // projection services it consumes, so the Host still sees one package owner
  // and one generated main entry.
  if (!host.portableResources) {
    throw new Error('Collaboration requires portable resources for Coordinator artifact review.')
  }
  const coordinatorEntry = createCoordinatorMainEntry<CapabilityDefinition>(host, {
    registerConnectionReadySweep: (sweep) => {
      coordinatorReadySweep = sweep
      return () => {
        if (coordinatorReadySweep === sweep) coordinatorReadySweep = null
      }
    }
  })
  const coordinatorCapabilityFactory = coordinatorEntry.contributions.find(
    ({ kind }) => kind === 'main.capability-factory'
  )?.value as ProjectCoordinatorCapabilityFactory<CapabilityDefinition> | undefined
  if (!coordinatorCapabilityFactory) {
    throw new Error('Collaboration Coordinator capability factory is missing.')
  }
  const capabilityFactory = createCollaborationCapabilityFactory({
    defineCapability: host.defineCapability as (
      options: CollaborationCapabilityOptions
    ) => CapabilityDefinition,
    getRuntime: requireRuntime,
    getCoordinatorDefinitions: () => coordinatorCapabilityFactory.createDefinitions()
  })

  return {
    definition: domainPackageDefinition,
    contributions: [
      {
        ...COLLABORATION_CAPABILITY_FACTORY_CONTRIBUTION,
        value: capabilityFactory
      },
      {
        ...COLLABORATION_RUNTIME_LIFECYCLE_CONTRIBUTION,
        contract: COLLABORATION_RUNTIME_LIFECYCLE_CONTRACT,
        value: lifecycle,
        onDispose: async () => {
          const pending = activation
          if (pending) await disposeOwned(await pending)
          else await disposeOwned(owned)
          localRuntime = null
        }
      },
      {
        ...COLLABORATION_COORDINATOR_CLOUD_COMMAND_CONTRIBUTION,
        contract: COLLABORATION_COORDINATOR_CLOUD_COMMAND_CONTRACT,
        value: coordinatorCloudCommandDescriptor
      },
      {
        ...COLLABORATION_WORKER_SESSION_PROJECTION_CONTRIBUTION,
        contract: COLLABORATION_WORKER_SESSION_PROJECTION_CONTRACT,
        value: workerSessionProjectionDescriptor
      },
      ...coordinatorEntry.contributions.filter(({ kind }) => kind !== 'main.capability-factory')
    ]
  }
}

export * from './worker-session-projection.js'

export function createCollaborationCapabilityFactory<CapabilityDefinition>(
  options: Readonly<{
    defineCapability: (options: CollaborationCapabilityOptions) => CapabilityDefinition
    getRuntime: () => CollaborationRuntime
    getCoordinatorDefinitions?: () => readonly CapabilityDefinition[]
  }>
): CollaborationCapabilityFactory<CapabilityDefinition> {
  const define = (input: Omit<
    CollaborationCapabilityOptions,
    'version' | 'audiences' | 'scope' | 'tags'
  >, version = '1.0.0', audiences: readonly ('ui' | 'agent' | 'system')[] = ['ui']): CapabilityDefinition => options.defineCapability({
    ...input,
    version,
    audiences,
    scope: 'global',
    tags: ['collaboration', 'user', 'device', 'session', 'project']
  })
  const capability = (
    id: string,
    title: string,
    description: string,
    effect: CapabilityEffect,
    inputSchema: z.ZodType,
    outputSchema: z.ZodType,
    handler: CollaborationCapabilityOptions['handler'],
    version = '1.0.0',
    audiences: readonly ('ui' | 'agent' | 'system')[] = ['ui'],
    approval: 'none' | 'confirmation' = effect === 'read' ? 'none' : 'confirmation'
  ): CapabilityDefinition => define({
    id,
    title,
    description,
    effect,
    approval,
    concurrency: {
      revision: 'none',
      idempotency: effect === 'read' ? 'none' : 'required'
    },
    inputSchema,
    outputSchema,
    handler
  }, version, audiences)

  return Object.freeze({
    moduleId: COLLABORATION_DOMAIN_MODULE_ID,
    policy: Object.freeze({
      id: 'collaboration' as const,
      title: 'Collaboration' as const,
      directTransportPrefixes: Object.freeze([]) as readonly [],
      allowedDirectTransports: Object.freeze([]) as readonly []
    }),
    createDefinitions: () => [
      capability(
        COLLABORATION_CAPABILITY_IDS.statusRead,
        'Read collaboration status',
        'Reads the non-secret participant, connection, projection, queue, Project, and Task status. A foreground refresh may also re-read Cloud Dashboard projections.',
        'read',
        collaborationStatusReadInputSchema,
        collaborationStatusReadResultSchema,
        async (raw) => ({
          output: await options.getRuntime().status(
            collaborationStatusReadInputSchema.parse(raw) as CollaborationStatusReadInput
          )
        }),
        '3.1.0'
      ),
      capability(
        COLLABORATION_CAPABILITY_IDS.connectionConfigure,
        'Configure collaboration service',
        'Stores the active Identity Cloud service location, loads its provider-neutral catalog, and reconnects the local Agent.',
        'external-write',
        collaborationConnectionConfigureInputSchema,
        collaborationConnectionConfigureResultSchema,
        async (raw) => {
          const input = collaborationConnectionConfigureInputSchema.parse(raw) as CollaborationConnectionConfigureInput
          return { output: { connection: await options.getRuntime().configureConnection(input.baseUrl) } }
        }
      ),
      capability(
        COLLABORATION_CAPABILITY_IDS.connectionConnect,
        'Change collaboration connection',
        'Connects, disconnects, or explicitly recovers the Agent device connection.',
        'external-write',
        collaborationConnectionConnectInputSchema,
        collaborationConnectionConnectResultSchema,
        async (raw) => {
          const input = collaborationConnectionConnectInputSchema.parse(raw) as CollaborationConnectionConnectInput
          return { output: { connection: await options.getRuntime().changeConnection(input) } }
        }
      ),
      capability(
        COLLABORATION_CAPABILITY_IDS.endpointChallengeStart,
        'Start endpoint verification',
        'Starts a short-lived provider identity challenge without returning its polling secret.',
        'external-write',
        collaborationEndpointChallengeStartInputSchema,
        collaborationEndpointChallengeStartResultSchema,
        async (raw) => ({
          output: await options.getRuntime().startChallenge(
            collaborationEndpointChallengeStartInputSchema.parse(raw) as CollaborationEndpointChallengeStartInput
          )
        })
      ),
      define({
        id: COLLABORATION_CAPABILITY_IDS.endpointChallengePoll,
        title: 'Poll endpoint verification',
        description: 'Reads the authenticated OIDC User endpoint challenge until the exact provider identity is verified.',
        effect: 'read',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'none' },
        inputSchema: collaborationEndpointChallengePollInputSchema,
        outputSchema: collaborationEndpointChallengePollResultSchema,
        handler: async (raw) => ({
          output: await options.getRuntime().pollChallenge(
            collaborationEndpointChallengePollInputSchema.parse(raw) as CollaborationEndpointChallengePollInput
          )
        })
      }),
      capability(
        COLLABORATION_CAPABILITY_IDS.projectionLink,
        'Link Session projection',
        'Creates a stable personal Topic projection for an explicit existing or new local Session.',
        'external-write',
        collaborationProjectionLinkInputSchema,
        collaborationProjectionLinkResultSchema,
        async (raw) => ({
          output: { projection: await options.getRuntime().linkProjection(
            collaborationProjectionLinkInputSchema.parse(raw) as CollaborationProjectionLinkInput
          ) }
        })
      ),
      capability(
        COLLABORATION_CAPABILITY_IDS.projectionUpdate,
        'Update Session projection',
        'Explicitly renames, pauses, or resumes a stable projection.',
        'external-write',
        collaborationProjectionUpdateInputSchema,
        collaborationProjectionUpdateResultSchema,
        async (raw) => ({
          output: { projection: await options.getRuntime().updateProjection(
            collaborationProjectionUpdateInputSchema.parse(raw) as CollaborationProjectionUpdateInput
          ) }
        })
      ),
      capability(
        COLLABORATION_CAPABILITY_IDS.projectionShare,
        'Share Session projection',
        'Updates the explicit sender user allowlist while retaining the original executing Agent owner.',
        'external-write',
        collaborationProjectionShareInputSchema,
        collaborationProjectionShareResultSchema,
        async (raw) => ({
          output: { projection: await options.getRuntime().shareProjection(
            collaborationProjectionShareInputSchema.parse(raw) as CollaborationProjectionShareInput
          ) }
        })
      ),
      capability(
        COLLABORATION_CAPABILITY_IDS.synchronizationRetry,
        'Retry collaboration synchronization',
        'Explicitly reconciles durable connection, inbox, outbox, projection, Task, or Dashboard projection state.',
        'external-write',
        collaborationSynchronizationRetryInputSchema,
        collaborationSynchronizationRetryResultSchema,
        async (raw) => {
          const input = collaborationSynchronizationRetryInputSchema.parse(raw) as CollaborationSynchronizationRetryInput
          await options.getRuntime().retrySynchronization(input)
          return {
            output: {
              accepted: true,
              connection: (await options.getRuntime().status()).connection
            }
          }
        },
        '1.1.0'
      ),
      capability(
        COLLABORATION_CAPABILITY_IDS.privateChannelDiscover,
        'Discover private collaboration Channels',
        'Discovers Topics only from provider-attested private Channels containing the verified user and message Bot.',
        'read',
        collaborationPrivateChannelDiscoverInputSchema,
        collaborationPrivateChannelDiscoverResultSchema,
        async (raw) => {
          const input = collaborationPrivateChannelDiscoverInputSchema.parse(raw) as CollaborationPrivateChannelDiscoverInput
          return { output: await options.getRuntime().discoverPrivateChannels(input.humanEndpointId) }
        }
      ),
      capability(
        TASK_CHAT_READ,
        '读取任务关联聊天',
        '读取当前用户本机的任务聊天来源；不会向其他项目成员公开私人聊天。',
        'read', taskChatReadInputSchema, taskChatReadResultSchema,
        async (raw) => ({ output: options.getRuntime().readTaskChats(taskChatReadInputSchema.parse(raw)) })
      ),
      capability(
        COLLABORATION_CAPABILITY_IDS.taskList,
        'List collaboration Tasks',
        'Reads local canonical cloud Task projections and restart reconciliation state.',
        'read',
        collaborationTaskListInputSchema,
        collaborationTaskListResultSchema,
        async (raw) => ({
          output: {
            tasks: options.getRuntime().listTasks(
              collaborationTaskListInputSchema.parse(raw) as CollaborationTaskListInput
            )
          }
        }),
        '2.0.0'
      ),
      capability(
        COLLABORATION_CAPABILITY_IDS.taskInteractionRead,
        'Read local Task interactions',
        'Reads durable local human interventions and checkpoints together with the observed Cloud execution state.',
        'read',
        collaborationTaskInteractionReadInputSchema,
        collaborationTaskInteractionReadResultSchema,
        async (raw, context) => {
          const input = collaborationTaskInteractionReadInputSchema.parse(raw) as CollaborationTaskInteractionReadInput
          if (!context?.caller.principal) throw new Error('This Task read requires a current Host Principal.')
          context.assertPrincipalCurrent()
          const userId = context.caller.principal.subject
          const runtime = options.getRuntime()
          authorizeAgentTaskInteraction(runtime, input, context)
          const view = await runtime.readTaskInteractionView(input, {
            userId, assertCurrent: () => context.assertPrincipalCurrent()
          })
          context.assertPrincipalCurrent()
          runtime.authorizeTaskInteractionRead(userId)
          return { output: { view } }
        },
        '1.0.0',
        ['ui', 'agent']
      ),
      capability(
        COLLABORATION_CAPABILITY_IDS.workerDeliveryRead,
        'Read the Worker Delivery state',
        'Reads the local draft, current declared outputs, computed confirmation target, sealed history, durable Delivery operation and residual instructions for the exact Worker execution.',
        'read',
        workerDeliveryReadInputSchema,
        workerDeliveryResultSchema,
        async (raw, context) => {
          const input = workerDeliveryReadInputSchema.parse(raw)
          if (context?.caller.audience !== 'agent') return { output: { delivery: await options.getRuntime().workerDeliveryView(input) } }
          context.assertPrincipalCurrent()
          if (!context.caller.principal || !context.ordinarySession) throw new Error('读取任务草稿需要当前用户及已关联的聊天。')
          return { output: { delivery: await options.getRuntime().workerDeliveryView(input, {
            ...context.ordinarySession, userId: context.caller.principal.subject,
            assertCurrent: () => context.assertPrincipalCurrent()
          }) } }
        },
        '1.3.0', ['ui', 'agent']
      ),
      capability(
        COLLABORATION_CAPABILITY_IDS.workerDeliveryMaterialsList,
        'List current Task workspace delivery materials',
        'Reads bounded file metadata from the exact local execution workspace without reading unselected content.',
        'read',
        workerDeliveryMaterialsInputSchema,
        workerDeliveryMaterialsResultSchema,
        async (raw) => ({ output: await options.getRuntime().listWorkerDeliveryMaterials(workerDeliveryMaterialsInputSchema.parse(raw)) }),
        '1.0.0',
        ['ui']
      ),
      capability(
        COLLABORATION_CAPABILITY_IDS.workerDeliveryMaterialImport,
        'Import a local Task delivery material',
        'Copies explicitly selected file bytes into the owned local Task execution workspace without creating an AI Session or publishing to Cloud.',
        'workspace-write',
        workerDeliveryMaterialImportInputSchema,
        workerDeliveryMaterialImportResultSchema,
        async (raw) => ({ output: await options.getRuntime().importWorkerDeliveryMaterial(workerDeliveryMaterialImportInputSchema.parse(raw)) }),
        '1.0.0', ['ui'], 'none'
      ),
      capability(
        COLLABORATION_CAPABILITY_IDS.workerDeliveryDraftSave,
        'Save the local Worker Delivery draft',
        'Saves the member explanation, required-output material binding, additional selections and AI suggestion decision in the exact local Task execution without publishing files.',
        'workspace-write',
        workerDeliveryDraftSaveInputSchema,
        workerDeliveryResultSchema,
        async (raw, context) => {
          const input = workerDeliveryDraftSaveInputSchema.parse(raw)
          if (context?.caller.audience !== 'agent') {
            return { output: { delivery: await options.getRuntime().saveWorkerDeliveryDraft(input) } }
          }
          context.assertPrincipalCurrent()
          if (!context.caller.principal || !context.ordinarySession) throw new Error('写入任务草稿需要当前用户及已关联的聊天。')
          const delivery = await options.getRuntime().saveWorkerDeliveryDraft(input, {
            ...context.ordinarySession, userId: context.caller.principal.subject,
            assertCurrent: () => context.assertPrincipalCurrent()
          })
          return { output: { delivery } }
        },
        '1.3.0',
        ['ui', 'agent'],
        'none'
      ),
      capability(
        COLLABORATION_CAPABILITY_IDS.workerDeliveryCancel,
        'Cancel an uncommitted failed Worker submission',
        'Archives the exact frozen snapshot and human proof, verifies Cloud precommit authority, and restores editing only for a parked object upload limit failure.',
        'workspace-write', workerDeliveryCancelInputSchema, workerDeliveryResultSchema,
        async (raw, context) => {
          if (context && context.caller.audience !== 'ui') throw new Error('撤回失败提交需要用户从界面确认。')
          return { output: { delivery: await options.getRuntime().cancelFailedWorkerDelivery(workerDeliveryCancelInputSchema.parse(raw)) } }
        }, '1.0.0', ['ui']
      ),
      capability(
        COLLABORATION_CAPABILITY_IDS.deliverySubmit,
        'Confirm and submit the current Worker Delivery draft',
        'Runs the Session barrier, freezes current files and the member explanation, binds exact human confirmation, then stages, reviews and seals through the canonical Cloud Delivery commands.',
        'external-write',
        workerDeliverySubmitInputSchema,
        workerDeliveryResultSchema,
        async (raw, context) => {
          if (context && context.caller.audience !== 'ui') {
            throw new Error('Delivery confirmation requires a fresh human action from the UI.')
          }
          const input = workerDeliverySubmitInputSchema.parse(raw)
          return {
            output: {
              delivery: await options.getRuntime().submitWorkerDelivery(input)
            }
          }
        },
        '1.2.0',
        ['ui']
      ),
      capability(
        COLLABORATION_CAPABILITY_IDS.workerResidualDispose,
        'Dispose a preserved Worker instruction',
        'Records the explicit disposition of one preserved residual instruction; content is never replayed automatically.',
        'workspace-write',
        workerResidualDisposeInputSchema,
        workerDeliveryResultSchema,
        async (raw) => ({
          output: {
            delivery: await options.getRuntime().disposeWorkerResidual(
              workerResidualDisposeInputSchema.parse(raw)
            )
          }
        }),
        '1.2.0'
      ),
      capability(
        COLLABORATION_CAPABILITY_IDS.taskCheckpointAppend,
        'Append a local Task checkpoint',
        'Appends a durable local progress checkpoint without changing Cloud Task or Execution state.',
        'workspace-write',
        collaborationTaskCheckpointAppendInputSchema,
        collaborationTaskCheckpointAppendResultSchema,
        async (raw, context) => {
          const input = collaborationTaskCheckpointAppendInputSchema.parse(raw) as CollaborationTaskCheckpointAppendInput
          const runtime = options.getRuntime()
          authorizeAgentTaskInteraction(runtime, input, context)
          if (!context?.caller.principal) throw new Error('This Task read requires a current Host Principal.')
          context.assertPrincipalCurrent()
          const userId = context.caller.principal.subject
          runtime.authorizeTaskInteractionRead(userId)
          const checkpoint = await runtime.appendTaskCheckpoint(
            context.caller.audience === 'agent' ? { ...input, source: 'agent' } : input
          )
          const view = await runtime.readTaskInteractionView({ ...input, executionId: input.executionId ?? undefined }, {
            userId, assertCurrent: () => context.assertPrincipalCurrent()
          })
          context.assertPrincipalCurrent()
          runtime.authorizeTaskInteractionRead(userId)
          return { output: { checkpoint, view }, changed: true }
        },
        '1.0.0',
        ['ui', 'agent']
      ),
      capability(
        COLLABORATION_CAPABILITY_IDS.taskOfferDecide,
        'Decide a Worker Task offer',
        'Claims one User-targeted offer on this Device, rejects it for the Worker User across Devices, or dismisses it only on this Device.',
        'external-write',
        collaborationTaskOfferDecisionInputSchema,
        collaborationTaskOfferDecisionResultSchema,
        async (raw) => {
          await options.getRuntime().decideTaskOffer(
            collaborationTaskOfferDecisionInputSchema.parse(raw) as CollaborationTaskOfferDecisionInput
          )
          return { output: { accepted: true as const } }
        },
        '1.1.0'
      ),
      capability(
        COLLABORATION_CAPABILITY_IDS.taskPause,
        '暂停本机任务执行',
        '当前执行人明确暂停本机已授权任务；不改变其他成员的执行权限。',
        'workspace-write', collaborationTaskPauseInputSchema, collaborationTaskPauseResultSchema,
        async (raw, context) => {
          if (context && context.caller.audience !== 'ui') throw new Error('暂停任务需要成员明确决定。')
          await options.getRuntime().pauseTask(collaborationTaskPauseInputSchema.parse(raw))
          return { output: { paused: true as const } }
        }, '1.0.0', ['ui']
      ),
      capability(
        COLLABORATION_CAPABILITY_IDS.taskStart,
        '选择任务执行方式',
        '成员明确选择自行完成或启动 AI；接受派单本身不会授权 AI 执行。',
        'external-write', collaborationTaskStartInputSchema, collaborationTaskStartResultSchema,
        async (raw, context) => {
          if (context && context.caller.audience !== 'ui') throw new Error('启动任务需要成员明确授权。')
          await options.getRuntime().startTask(collaborationTaskStartInputSchema.parse(raw))
          return { output: { started: true as const } }
        }, '1.0.0', ['ui']
      ),
      capability(
        COLLABORATION_CAPABILITY_IDS.taskReturn,
        '退回无法完成的任务',
        '被派成员确认原因后终止本机执行，通过现有失败上报交由 Coordinator 重新派发。',
        'external-write',
        collaborationTaskReturnInputSchema,
        collaborationTaskReturnResultSchema,
        async (raw, context) => {
          if (context && context.caller.audience !== 'ui') {
            throw new Error('退回任务需要成员在协作页确认。')
          }
          await options.getRuntime().returnTask(collaborationTaskReturnInputSchema.parse(raw))
          return { output: { returned: true as const } }
        }
      ),
      capability(
        COLLABORATION_CAPABILITY_IDS.activityComment,
        'Publish a public Project comment',
        'Publishes the current User comment and exact Project member mentions as a redacted public activity event; it never changes Task state or reads a private Session.',
        'external-write',
        collaborationActivityCommentInputSchema,
        collaborationActivityCommentResultSchema,
        async (raw) => ({
          output: await options.getRuntime().publishActivityComment(
            collaborationActivityCommentInputSchema.parse(raw)
          )
        })
      ),
      capability(
        COLLABORATION_CAPABILITY_IDS.notificationMarkRead,
        'Mark a Collaboration notification read',
        'Marks one durable notification for the current User read with an expected revision.',
        'external-write',
        collaborationNotificationMarkReadInputSchema,
        collaborationNotificationMarkReadResultSchema,
        async (raw) => ({
          output: {
            notification: await options.getRuntime().markNotificationRead(
              collaborationNotificationMarkReadInputSchema.parse(raw)
            )
          }
        })
      ),
      capability(
        COLLABORATION_CAPABILITY_IDS.taskSessionContinue,
        '显式创建任务接续会话',
        '核对当前执行权限、旧会话停机和已决回执，封住旧输入并创建可追溯接续；通过持久指令接续原授权任务，不重发旧回合。',
        'workspace-write', collaborationTaskSessionContinueInputSchema, collaborationTaskSessionContinueResultSchema,
        async (raw, context) => {
          if (context && context.caller.audience !== 'ui') throw new Error('接续任务需要成员在协作页明确确认。')
          return { output: await options.getRuntime().continueTaskSession(collaborationTaskSessionContinueInputSchema.parse(raw)) }
        }, '1.0.0', ['ui']
      ),
      capability(
        COLLABORATION_CAPABILITY_IDS.taskSessionOpen,
        '打开任务协作聊天',
        '为当前执行人打开或创建任务聊天并带入上下文；不会发送消息或启动 AI。',
        'workspace-write',
        collaborationTaskSessionOpenInputSchema,
        collaborationTaskSessionOpenResultSchema,
        async (raw, context) => {
          if (context && context.caller.audience !== 'ui') throw new Error('打开任务聊天需要用户操作。')
          return { output: await options.getRuntime().openTaskSession(collaborationTaskSessionOpenInputSchema.parse(raw)) }
        },
        '2.0.0',
        ['ui'],
        'none'
      ),
      capability(
        COLLABORATION_CAPABILITY_IDS.managedContainerInspect,
        'Inspect private collaboration Channel',
        'Reads or refreshes the authenticated user managed Channel and locator status.',
        'read',
        collaborationManagedContainerInspectInputSchema,
        collaborationManagedContainerManageResultSchema,
        async (raw) => ({
          output: await options.getRuntime().manageContainer(
            collaborationManagedContainerInspectInputSchema.parse(raw) as CollaborationManagedContainerManageInput
          )
        })
      ),
      capability(
        COLLABORATION_CAPABILITY_IDS.managedContainerProvision,
        'Provision private collaboration Channel',
        'Creates or repairs the authenticated user managed Channel through the durable provisioning path.',
        'external-write',
        collaborationManagedContainerProvisionInputSchema,
        collaborationManagedContainerManageResultSchema,
        async (raw) => ({
          output: await options.getRuntime().manageContainer(
            collaborationManagedContainerProvisionInputSchema.parse(raw) as CollaborationManagedContainerManageInput
          )
        })
      ),
      capability(
        COLLABORATION_CAPABILITY_IDS.managedContainerArchive,
        'Archive private collaboration Channel',
        'Destructively archives the authenticated user managed Channel and pauses its fixed Sessions.',
        'destructive',
        collaborationManagedContainerArchiveInputSchema,
        collaborationManagedContainerManageResultSchema,
        async (raw) => ({
          output: await options.getRuntime().manageContainer(
            collaborationManagedContainerArchiveInputSchema.parse(raw) as CollaborationManagedContainerManageInput
          )
        })
      ),
      ...(options.getCoordinatorDefinitions?.() ?? [])
    ]
  })
}

function authorizeAgentTaskInteraction(
  runtime: CollaborationRuntime,
  input: Readonly<{
    projectId: string
    taskId: string
    executionId?: string | null
    origin?: string
    source?: string
  }>,
  context: DomainMainCapabilityInvocationContext | undefined
): void {
  if (context?.caller.audience !== 'agent') return
  context.assertPrincipalCurrent()
  if (!context.caller.principal) {
    throw new Error('This Agent operation requires a current Host Principal.')
  }
  if (input.origin !== undefined && input.origin !== 'agent') {
    throw new Error('Agent Task interactions must use the agent origin.')
  }
  if (input.source !== undefined && input.source !== 'agent') {
    throw new Error('Agent Task checkpoints must use the agent source.')
  }
  if (!context.ordinarySession) {
    throw new Error('This Agent operation requires a Host-authenticated ordinary Session.')
  }
  if (!input.executionId) {
    throw new Error('Agent Task operations require an exact executionId.')
  }
  runtime.authorizeTaskInteraction(
    input,
    context.ordinarySession,
    context.caller.principal.subject
  )
  context.assertPrincipalCurrent()
}
