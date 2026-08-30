import type { z } from 'zod'
import {
  defineDomainMainInternalServiceDescriptor,
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
  collaborationTaskOfferDecisionInputSchema,
  collaborationTaskOfferDecisionResultSchema,
  collaborationWorkerAcceptanceUpdateInputSchema,
  collaborationWorkerAcceptanceUpdateResultSchema,
  type CollaborationConnectionConfigureInput,
  type CollaborationConnectionConnectInput,
  type CollaborationEndpointChallengePollInput,
  type CollaborationEndpointChallengeStartInput,
  type CollaborationManagedContainerManageInput,
  type CollaborationPrivateChannelDiscoverInput,
  type CollaborationProjectionLinkInput,
  type CollaborationProjectionShareInput,
  type CollaborationProjectionUpdateInput,
  type CollaborationSynchronizationRetryInput,
  type CollaborationTaskListInput,
  type CollaborationTaskOfferDecisionInput,
  type CollaborationWorkerAcceptanceUpdateInput
} from './contract.js'
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

export {
  ProjectionCoordinator,
  localProjectionFromRemote
} from './main/projection-coordinator.js'
export {
  CollaborationLocalStore,
  FileCollaborationStateBackend
} from './main/store.js'
export type { CollaborationStateBackend } from './main/store.js'

type CapabilityEffect = 'read' | 'external-write' | 'destructive'

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
  handler: (input: unknown) => Promise<Readonly<{ output: unknown; changed?: boolean }>>
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
  allowedConsumerModuleIds: ['sciforge.project-coordinator']
})

const workerSessionProjectionDescriptor = defineDomainMainInternalServiceDescriptor({
  location: 'main.internal-service-descriptor',
  serviceId: WORKER_SESSION_PROJECTION_SERVICE_ID,
  contractVersion: WORKER_SESSION_PROJECTION_CONTRACT_VERSION,
  allowedConsumerModuleIds: ['sciforge.project-coordinator']
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
  let owned: OwnedRuntime | null = null
  let activation: Promise<OwnedRuntime> | null = null
  let coordinatorInboxHandler: CoordinatorAgentInboxHandler | null = null

  const requireRuntime = (): CollaborationRuntime => {
    if (!owned || owned.disposed) throw new Error('Collaboration runtime is not active.')
    return owned.runtime
  }
  const coordinatorCloudCommandService = defineCoordinatorCloudCommandService({
    execute: (command) => requireRuntime().executeCoordinatorCloudCommand(command),
    resume: (idempotencyKey, validateCommand) => (
      requireRuntime().resumeCoordinatorCloudCommand(idempotencyKey, validateCommand)
    ),
    subscribe: (handler) => {
      if (coordinatorInboxHandler) {
        throw new Error('The Coordinator Agent Inbox already has its package owner.')
      }
      coordinatorInboxHandler = handler
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
      listBindings: () => requireRuntime().listWorkerSessionBindings()
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
        const runtime = createRuntime({
          statePath: collaborationStatePath(context.userDataDir),
          packageSettings,
          authenticatedCloudTransport,
          agentCloudRuntime,
          coordinatorInboxHandler: () => coordinatorInboxHandler,
          sanitizeText: host.textSanitizer?.sanitizeText
        })
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

  const capabilityFactory = createCollaborationCapabilityFactory({
    defineCapability: host.defineCapability as (
      options: CollaborationCapabilityOptions
    ) => CapabilityDefinition,
    getRuntime: requireRuntime
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
      }
    ]
  }
}

export * from './worker-session-projection.js'

export function createCollaborationCapabilityFactory<CapabilityDefinition>(
  options: Readonly<{
    defineCapability: (options: CollaborationCapabilityOptions) => CapabilityDefinition
    getRuntime: () => CollaborationRuntime
  }>
): CollaborationCapabilityFactory<CapabilityDefinition> {
  const define = (input: Omit<
    CollaborationCapabilityOptions,
    'version' | 'audiences' | 'scope' | 'tags'
  >, version = '1.0.0'): CapabilityDefinition => options.defineCapability({
    ...input,
    version,
    audiences: ['ui'],
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
    version = '1.0.0'
  ): CapabilityDefinition => define({
    id,
    title,
    description,
    effect,
    approval: effect === 'read' ? 'none' : 'confirmation',
    concurrency: {
      revision: 'none',
      idempotency: effect === 'read' ? 'none' : 'required'
    },
    inputSchema,
    outputSchema,
    handler
  }, version)

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
        'Reads the non-secret participant, connection, projection, queue, Project, and Task status.',
        'read',
        collaborationStatusReadInputSchema,
        collaborationStatusReadResultSchema,
        async () => ({ output: await options.getRuntime().status() }),
        '1.1.0'
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
        'Explicitly reconciles durable connection, inbox, outbox, projection, or Task state.',
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
        }
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
        '1.1.0'
      ),
      capability(
        COLLABORATION_CAPABILITY_IDS.workerAcceptanceUpdate,
        'Update local Worker acceptance policy',
        'Stores manual or automatic Task offer handling for this exact local Agent Device.',
        'external-write',
        collaborationWorkerAcceptanceUpdateInputSchema,
        collaborationWorkerAcceptanceUpdateResultSchema,
        async (raw) => ({
          output: await options.getRuntime().updateWorkerAcceptancePolicy(
            collaborationWorkerAcceptanceUpdateInputSchema.parse(raw) as CollaborationWorkerAcceptanceUpdateInput
          )
        })
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
      )
    ]
  })
}
