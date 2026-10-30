import type { z } from 'zod'
import type {
  DomainArtifactConsumer,
  DomainMainHost,
  DomainMainRuntimeDisposer,
  DomainMainRuntimeLifecycleContribution
} from '@sciforge/domain-sdk/host'
import type { TrustedDomainProcessEntryInput } from '@sciforge/domain-sdk/main'
import {
  RESEARCH_CHECKPOINT_CAPABILITY_IDS,
  researchCheckpointLegacyImportInputV1Schema,
  researchCheckpointLegacyImportResultV1Schema,
  researchCheckpointLegacyPreviewInputV1Schema,
  researchCheckpointLegacyPreviewResultV1Schema,
  researchCheckpointListInputV1Schema,
  researchCheckpointListResultV1Schema,
  researchCheckpointReadInputV1Schema,
  researchCheckpointReadResultV1Schema,
  researchCheckpointResolveInputV1Schema,
  researchCheckpointResolveResultV1Schema,
  researchCheckpointRestoreAsNewInputV1Schema,
  researchCheckpointRestoreAsNewResultV1Schema,
  researchCheckpointStartInputV1Schema,
  researchCheckpointStartResultV1Schema,
  researchCheckpointStatusInputV1Schema,
  researchCheckpointStatusResultV1Schema,
  researchCheckpointStopInputV1Schema,
  researchCheckpointStopResultV1Schema,
  researchCheckpointTurnStatusInputV1Schema,
  researchCheckpointTurnStatusResultV1Schema,
  type ResearchCheckpointLegacyImportInputV1,
  type ResearchCheckpointLegacyPreviewInputV1,
  type ResearchCheckpointListInputV1,
  type ResearchCheckpointReadInputV1,
  type ResearchCheckpointResolveInputV1,
  type ResearchCheckpointRestoreAsNewInputV1,
  type ResearchCheckpointStartInputV1,
  type ResearchCheckpointStatusInputV1,
  type ResearchCheckpointStopInputV1,
  type ResearchCheckpointTurnStatusInputV1
} from './contract.js'
import {
  RESEARCH_CHECKPOINTS_ARTIFACT_CONSUMER_CONTRIBUTION,
  RESEARCH_CHECKPOINTS_CAPABILITY_FACTORY_CONTRIBUTION,
  RESEARCH_CHECKPOINTS_DOMAIN_MODULE_ID,
  RESEARCH_CHECKPOINTS_RUNTIME_LIFECYCLE_CONTRIBUTION,
  RESEARCH_CHECKPOINTS_RUNTIME_LIFECYCLE_CONTRACT,
  domainPackageDefinition
} from './definition.js'
import {
  ResearchCheckpointRuntime,
  checkpointErrorResult,
  type ResearchCheckpointRuntimeOptions
} from './main/runtime.js'

type CapabilityAudience = 'ui' | 'agent' | 'system'
type CapabilityEffect = 'read' | 'workspace-write'

export type ResearchCheckpointsCapabilityContext = Readonly<{
  caller: Readonly<{
    workspaceId?: string
  }>
}>

export type ResearchCheckpointsCapabilityOptions = Readonly<{
  id: string
  version: string
  title: string
  description: string
  audiences: readonly CapabilityAudience[]
  scope: 'workspace'
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
    context: ResearchCheckpointsCapabilityContext
  ) => Promise<Readonly<{ output: unknown; changed?: boolean }>>
}>

export type ResearchCheckpointsCapabilityFactory<CapabilityDefinition = unknown> = Readonly<{
  moduleId: typeof RESEARCH_CHECKPOINTS_DOMAIN_MODULE_ID
  policy: Readonly<{
    id: 'research-checkpoints'
    title: 'Research Checkpoints'
    directTransportPrefixes: readonly []
    allowedDirectTransports: readonly []
  }>
  createDefinitions: () => readonly CapabilityDefinition[]
}>

export type ResearchCheckpointsMainContribution<CapabilityDefinition = unknown> =
  | ResearchCheckpointsCapabilityFactory<CapabilityDefinition>
  | DomainMainRuntimeLifecycleContribution
  | DomainArtifactConsumer

type ResearchCheckpointsMainHost = DomainMainHost & Readonly<{
  createResearchCheckpointRuntime?: (
    options: ResearchCheckpointRuntimeOptions
  ) => ResearchCheckpointRuntime
}>

type OwnedRuntime = Readonly<{
  runtime: ResearchCheckpointRuntime
  deactivate: DomainMainRuntimeDisposer
}> & { disposed: boolean }

export function createDomainMainEntry<CapabilityDefinition = unknown>(
  host: ResearchCheckpointsMainHost
): TrustedDomainProcessEntryInput<ResearchCheckpointsMainContribution<CapabilityDefinition>> {
  const createRuntime = host.createResearchCheckpointRuntime ?? ((options) =>
    new ResearchCheckpointRuntime(options))
  let owned: OwnedRuntime | null = null
  let activation: Promise<OwnedRuntime> | null = null
  const requireRuntime = () => {
    if (!owned || owned.disposed) throw new Error('Research Checkpoints runtime is not active.')
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
      if (owned || activation) throw new Error('Research Checkpoints runtime lifecycle is already active.')
      const pending = (async (): Promise<OwnedRuntime> => {
        const runtime = createRuntime({
          userDataDir: context.userDataDir,
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
  const artifactConsumer: DomainArtifactConsumer = Object.freeze({
    consume: (event) => requireRuntime().consume(event)
  })
  const capabilityFactory = createResearchCheckpointsCapabilityFactory({
    defineCapability: host.defineCapability as (
      options: ResearchCheckpointsCapabilityOptions
    ) => CapabilityDefinition,
    getRuntime: requireRuntime
  })
  return {
    definition: domainPackageDefinition,
    contributions: [
      {
        ...RESEARCH_CHECKPOINTS_CAPABILITY_FACTORY_CONTRIBUTION,
        value: capabilityFactory
      },
      {
        ...RESEARCH_CHECKPOINTS_RUNTIME_LIFECYCLE_CONTRIBUTION,
        contract: RESEARCH_CHECKPOINTS_RUNTIME_LIFECYCLE_CONTRACT,
        value: lifecycle,
        onDispose: async () => {
          const pending = activation
          if (pending) await disposeOwned(await pending)
          else await disposeOwned(owned)
        }
      },
      {
        ...RESEARCH_CHECKPOINTS_ARTIFACT_CONSUMER_CONTRIBUTION,
        value: artifactConsumer
      }
    ]
  }
}

export function createResearchCheckpointsCapabilityFactory<CapabilityDefinition>(
  options: Readonly<{
    defineCapability: (
      options: ResearchCheckpointsCapabilityOptions
    ) => CapabilityDefinition
    getRuntime: () => Pick<ResearchCheckpointRuntime,
      'start' | 'stop' | 'checkpointStatus' | 'read' | 'list' | 'turnStatus' | 'resolve' | 'restoreAsNew' |
      'previewLegacy' | 'importLegacy'>
  }>
): ResearchCheckpointsCapabilityFactory<CapabilityDefinition> {
  const define = (
    input: Omit<ResearchCheckpointsCapabilityOptions, 'version' | 'audiences' | 'scope' | 'tags'> &
      Readonly<{ audiences?: readonly CapabilityAudience[] }>
  ): CapabilityDefinition => {
    const { audiences, ...definition } = input
    return options.defineCapability({
      ...definition,
      version: '1.0.0',
      audiences: audiences ?? ['ui', 'agent', 'system'],
      scope: 'workspace',
      tags: ['research', 'checkpoint', 'artifact', 'chat', 'provenance']
    })
  }
  return Object.freeze({
    moduleId: RESEARCH_CHECKPOINTS_DOMAIN_MODULE_ID,
    policy: Object.freeze({
      id: 'research-checkpoints' as const,
      title: 'Research Checkpoints' as const,
      directTransportPrefixes: Object.freeze([]) as readonly [],
      allowedDirectTransports: Object.freeze([]) as readonly []
    }),
    createDefinitions: () => [
      define({
        id: RESEARCH_CHECKPOINT_CAPABILITY_IDS.start,
        title: 'Start research recording',
        description: 'Opts the exact workspace runtime/thread into durable Research Checkpoints.',
        effect: 'workspace-write',
        audiences: ['ui'],
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'required' },
        inputSchema: researchCheckpointStartInputV1Schema,
        outputSchema: researchCheckpointStartResultV1Schema,
        handler: async (raw, context) => mutationResult(async () => {
          const input = researchCheckpointStartInputV1Schema.parse(raw)
          return options.getRuntime().start(workspace(context), input as ResearchCheckpointStartInputV1)
        })
      }),
      define({
        id: RESEARCH_CHECKPOINT_CAPABILITY_IDS.stop,
        title: 'Stop research recording',
        description: 'Stops automatic checkpoint creation without deleting immutable history.',
        effect: 'workspace-write',
        audiences: ['ui'],
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'required' },
        inputSchema: researchCheckpointStopInputV1Schema,
        outputSchema: researchCheckpointStopResultV1Schema,
        handler: async (raw, context) => mutationResult(async () => {
          const input = researchCheckpointStopInputV1Schema.parse(raw)
          return options.getRuntime().stop(workspace(context), input as ResearchCheckpointStopInputV1)
        })
      }),
      define({
        id: RESEARCH_CHECKPOINT_CAPABILITY_IDS.status,
        title: 'Read research recording status',
        description: 'Reads the latest exact recording binding for one runtime/thread.',
        effect: 'read',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'none' },
        inputSchema: researchCheckpointStatusInputV1Schema,
        outputSchema: researchCheckpointStatusResultV1Schema,
        handler: async (raw, context) => readResult(async () => {
          const input = researchCheckpointStatusInputV1Schema.parse(raw) as ResearchCheckpointStatusInputV1
          return options.getRuntime().checkpointStatus(
            workspace(context),
            input.runtimeId,
            input.threadId
          )
        })
      }),
      define({
        id: RESEARCH_CHECKPOINT_CAPABILITY_IDS.turnStatus,
        title: 'Read exact turn checkpoint status',
        description: 'Reads durable pending/committed/conflict/failure status for one producing turn.',
        effect: 'read',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'none' },
        inputSchema: researchCheckpointTurnStatusInputV1Schema,
        outputSchema: researchCheckpointTurnStatusResultV1Schema,
        handler: async (raw, context) => readResult(async () => {
          const input = researchCheckpointTurnStatusInputV1Schema.parse(raw) as ResearchCheckpointTurnStatusInputV1
          return options.getRuntime().turnStatus(
            workspace(context),
            input.runtimeId,
            input.threadId,
            input.turnId
          )
        })
      }),
      define({
        id: RESEARCH_CHECKPOINT_CAPABILITY_IDS.read,
        title: 'Read exact Research Checkpoint',
        description: 'Reads a committed checkpoint by recording or exact Artifact Version.',
        effect: 'read',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'none' },
        inputSchema: researchCheckpointReadInputV1Schema,
        outputSchema: researchCheckpointReadResultV1Schema,
        handler: async (raw, context) => readResult(async () => {
          const input = researchCheckpointReadInputV1Schema.parse(raw)
          return options.getRuntime().read(workspace(context), input as ResearchCheckpointReadInputV1)
        })
      }),
      define({
        id: RESEARCH_CHECKPOINT_CAPABILITY_IDS.list,
        title: 'List Research Checkpoints',
        description: 'Lists bounded committed checkpoint versions without scanning Artifact history.',
        effect: 'read',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'none' },
        inputSchema: researchCheckpointListInputV1Schema,
        outputSchema: researchCheckpointListResultV1Schema,
        handler: async (raw, context) => readResult(async () => {
          const input = researchCheckpointListInputV1Schema.parse(raw)
          return options.getRuntime().list(workspace(context), input as ResearchCheckpointListInputV1)
        })
      }),
      define({
        id: RESEARCH_CHECKPOINT_CAPABILITY_IDS.resolve,
        title: 'Resolve stale Research Checkpoint',
        description: 'Explicitly rebases or discards one stale checkpoint while preserving immutable history.',
        effect: 'workspace-write',
        audiences: ['ui'],
        approval: 'confirmation',
        concurrency: { revision: 'none', idempotency: 'required' },
        inputSchema: researchCheckpointResolveInputV1Schema,
        outputSchema: researchCheckpointResolveResultV1Schema,
        handler: async (raw, context) => mutationResult(async () => {
          const input = researchCheckpointResolveInputV1Schema.parse(raw)
          return options.getRuntime().resolve(
            workspace(context),
            input as ResearchCheckpointResolveInputV1
          )
        })
      }),
      define({
        id: RESEARCH_CHECKPOINT_CAPABILITY_IDS.restoreAsNew,
        title: 'Restore Research Checkpoint as new Version',
        description: 'Restores historical bytes and advances the owning recording to the exact new current Version.',
        effect: 'workspace-write',
        audiences: ['ui'],
        approval: 'confirmation',
        concurrency: { revision: 'none', idempotency: 'required' },
        inputSchema: researchCheckpointRestoreAsNewInputV1Schema,
        outputSchema: researchCheckpointRestoreAsNewResultV1Schema,
        handler: async (raw, context) => mutationResult(async () => {
          const input = researchCheckpointRestoreAsNewInputV1Schema.parse(raw)
          return options.getRuntime().restoreAsNew(
            workspace(context),
            input as ResearchCheckpointRestoreAsNewInputV1
          )
        })
      }),
      define({
        id: RESEARCH_CHECKPOINT_CAPABILITY_IDS.previewLegacy,
        title: 'Preview selectable legacy research turns',
        description: 'Lists bounded durable turn summaries and computes a selection-bound transcript digest.',
        effect: 'read',
        audiences: ['ui'],
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'none' },
        inputSchema: researchCheckpointLegacyPreviewInputV1Schema,
        outputSchema: researchCheckpointLegacyPreviewResultV1Schema,
        handler: async (raw, context) => readResult(async () => {
          const input = researchCheckpointLegacyPreviewInputV1Schema.parse(raw)
          return options.getRuntime().previewLegacy(
            workspace(context),
            input as ResearchCheckpointLegacyPreviewInputV1
          )
        })
      }),
      define({
        id: RESEARCH_CHECKPOINT_CAPABILITY_IDS.importLegacy,
        title: 'Import selected legacy research turns',
        description: 'Reads selected durable turns and saves an explicitly incomplete legacy checkpoint.',
        effect: 'workspace-write',
        audiences: ['ui'],
        approval: 'confirmation',
        concurrency: { revision: 'none', idempotency: 'required' },
        inputSchema: researchCheckpointLegacyImportInputV1Schema,
        outputSchema: researchCheckpointLegacyImportResultV1Schema,
        handler: async (raw, context) => mutationResult(async () => {
          const input = researchCheckpointLegacyImportInputV1Schema.parse(raw)
          return options.getRuntime().importLegacy(
            workspace(context),
            input as ResearchCheckpointLegacyImportInputV1
          )
        })
      })
    ]
  })
}

function workspace(context: ResearchCheckpointsCapabilityContext): string {
  const value = context.caller.workspaceId?.trim()
  if (!value) throw new Error('Research Checkpoints capability requires caller workspace scope.')
  return value
}

async function readResult<T>(operation: () => Promise<T>): Promise<Readonly<{ output: unknown }>> {
  try {
    return { output: { ok: true, value: await operation() } }
  } catch (error) {
    return { output: { ok: false, issue: checkpointErrorResult(error) } }
  }
}

async function mutationResult<T>(
  operation: () => Promise<T>
): Promise<Readonly<{ output: unknown; changed?: boolean }>> {
  try {
    // These capabilities mutate the domain-owned registry through its durable
    // journal. They do not mutate a Broker resource/revision and therefore
    // must not claim `changed`, which would require a resource handle.
    return { output: { ok: true, value: await operation() } }
  } catch (error) {
    return { output: { ok: false, issue: checkpointErrorResult(error) } }
  }
}
