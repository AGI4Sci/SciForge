import type { z } from 'zod'
import type {
  DomainMainHost,
  DomainMainRuntimeDisposer,
  DomainMainRuntimeLifecycleContribution
} from '@sciforge/domain-sdk/host'
import type { TrustedDomainProcessEntryInput } from '@sciforge/domain-sdk/main'
import {
  COLLABORATION_CAPABILITY_IDS,
  collaborationAgentRegisterInputSchema,
  collaborationAgentRegisterResultSchema,
  collaborationConnectionConfigureInputSchema,
  collaborationConnectionConfigureResultSchema,
  collaborationConnectionConnectInputSchema,
  collaborationConnectionConnectResultSchema,
  collaborationEndpointChallengePollInputSchema,
  collaborationEndpointChallengePollResultSchema,
  collaborationEndpointChallengeStartInputSchema,
  collaborationEndpointChallengeStartResultSchema,
  collaborationManagedContainerManageInputSchema,
  collaborationManagedContainerManageResultSchema,
  collaborationPrimaryAgentSelectInputSchema,
  collaborationPrimaryAgentSelectResultSchema,
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
  type CollaborationAgentRegisterInput,
  type CollaborationConnectionConfigureInput,
  type CollaborationConnectionConnectInput,
  type CollaborationEndpointChallengePollInput,
  type CollaborationEndpointChallengeStartInput,
  type CollaborationManagedContainerManageInput,
  type CollaborationPrimaryAgentSelectInput,
  type CollaborationProjectionLinkInput,
  type CollaborationProjectionShareInput,
  type CollaborationProjectionUpdateInput,
  type CollaborationSynchronizationRetryInput,
  type CollaborationTaskListInput
} from './contract.js'
import {
  COLLABORATION_CAPABILITY_FACTORY_CONTRIBUTION,
  COLLABORATION_DOMAIN_MODULE_ID,
  COLLABORATION_RUNTIME_LIFECYCLE_CONTRIBUTION,
  domainPackageDefinition
} from './definition.js'
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

type CapabilityEffect = 'read' | 'external-write'

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

type CollaborationMainHost = DomainMainHost & Readonly<{
  createCollaborationRuntime?: (options: CollaborationRuntimeOptions) => CollaborationRuntime
}>

type OwnedRuntime = Readonly<{
  runtime: CollaborationRuntime
  deactivate: DomainMainRuntimeDisposer
}> & { disposed: boolean }

export function createDomainMainEntry<CapabilityDefinition = unknown>(
  host: CollaborationMainHost
): TrustedDomainProcessEntryInput<CollaborationMainContribution<CapabilityDefinition>> {
  if (!host.packageSettings || !host.packageSecrets) {
    throw new Error('Collaboration requires package-scoped settings and secret storage.')
  }
  const createRuntime = host.createCollaborationRuntime ?? ((options) => new CollaborationRuntime(options))
  let owned: OwnedRuntime | null = null
  let activation: Promise<OwnedRuntime> | null = null

  const requireRuntime = (): CollaborationRuntime => {
    if (!owned || owned.disposed) throw new Error('Collaboration runtime is not active.')
    return owned.runtime
  }
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
        const runtime = createRuntime({
          statePath: collaborationStatePath(context.userDataDir),
          packageSettings: host.packageSettings!,
          packageSecrets: host.packageSecrets!,
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
        value: lifecycle,
        onDispose: async () => {
          const pending = activation
          if (pending) await disposeOwned(await pending)
          else await disposeOwned(owned)
        }
      }
    ]
  }
}

export function createCollaborationCapabilityFactory<CapabilityDefinition>(
  options: Readonly<{
    defineCapability: (options: CollaborationCapabilityOptions) => CapabilityDefinition
    getRuntime: () => CollaborationRuntime
  }>
): CollaborationCapabilityFactory<CapabilityDefinition> {
  const define = (input: Omit<
    CollaborationCapabilityOptions,
    'version' | 'audiences' | 'scope' | 'tags'
  >): CapabilityDefinition => options.defineCapability({
    ...input,
    version: '1.0.0',
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
    handler: CollaborationCapabilityOptions['handler']
  ): CapabilityDefinition => define({
    id,
    title,
    description,
    effect,
    approval: effect === 'external-write' ? 'confirmation' : 'none',
    concurrency: {
      revision: 'none',
      idempotency: effect === 'external-write' ? 'required' : 'none'
    },
    inputSchema,
    outputSchema,
    handler
  })

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
        async () => ({ output: await options.getRuntime().status() })
      ),
      capability(
        COLLABORATION_CAPABILITY_IDS.connectionConfigure,
        'Configure collaboration service',
        'Stores a non-secret HTTPS service location and loads its provider-neutral catalog.',
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
        description: 'Redeems the package-secret polling credential and saves the one-time user credential in the secret store.',
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
        COLLABORATION_CAPABILITY_IDS.agentRegister,
        'Register this Agent',
        'Registers the stable installation and saves the one-time device credential in the package secret store.',
        'external-write',
        collaborationAgentRegisterInputSchema,
        collaborationAgentRegisterResultSchema,
        async (raw) => ({
          output: { agent: await options.getRuntime().registerAgent(
            collaborationAgentRegisterInputSchema.parse(raw) as CollaborationAgentRegisterInput
          ) }
        })
      ),
      capability(
        COLLABORATION_CAPABILITY_IDS.primaryAgentSelect,
        'Select primary Agent',
        'Selects an active Agent owned by the current user without guessing from presence.',
        'external-write',
        collaborationPrimaryAgentSelectInputSchema,
        collaborationPrimaryAgentSelectResultSchema,
        async (raw) => ({
          output: { participant: await options.getRuntime().selectPrimaryAgent(
            collaborationPrimaryAgentSelectInputSchema.parse(raw) as CollaborationPrimaryAgentSelectInput
          ) }
        })
      ),
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
        'Explicitly renames, pauses, resumes, closes, or relinks a stable projection.',
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
        })
      ),
      capability(
        COLLABORATION_CAPABILITY_IDS.managedContainerManage,
        'Manage private collaboration Channel',
        'Creates, refreshes, repairs, or archives the authenticated user private Channel through the durable cloud provisioning path.',
        'external-write',
        collaborationManagedContainerManageInputSchema,
        collaborationManagedContainerManageResultSchema,
        async (raw) => ({
          output: await options.getRuntime().manageContainer(
            collaborationManagedContainerManageInputSchema.parse(raw) as CollaborationManagedContainerManageInput
          )
        })
      )
    ]
  })
}
