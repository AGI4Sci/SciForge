import type {
  DomainArtifactConsumer,
  DomainMainHost,
  DomainMainRuntimeDisposer,
  DomainMainRuntimeLifecycleContribution
} from '@sciforge/domain-sdk/host'
import type { TrustedDomainProcessEntryInput } from '@sciforge/domain-sdk/main'
import type { z } from 'zod'
import {
  PROJECT_DAG_CAPABILITY_IDS,
  projectDagErrorSchema,
  projectDagResolveEvidencePreviewInputSchema,
  projectDagResolveEvidencePreviewResultSchema,
  projectDagSaveGoalInputSchema,
  projectDagSaveGoalResultSchema,
  projectDagUpdateInputSchema,
  projectDagUpdateResultSchema,
  projectDagViewInputSchema,
  projectDagViewResultSchema,
  type ProjectDagError,
  type ProjectDagResolveEvidencePreviewInput,
  type ProjectDagSaveGoalInput,
  type ProjectDagTarget,
  type ProjectDagUpdateInput,
  type ProjectDagViewInput
} from './contract.js'
import {
  PROJECT_DAG_ARTIFACT_CONSUMER_CONTRIBUTION,
  PROJECT_DAG_CAPABILITY_FACTORY_CONTRIBUTION,
  PROJECT_DAG_DOMAIN_MODULE_ID,
  PROJECT_DAG_RUNTIME_LIFECYCLE_CONTRIBUTION,
  domainPackageDefinition
} from './definition.js'
import {
  ProjectDagRuntime,
  ProjectDagRuntimeError,
  type ProjectDagRuntimeOptions
} from './runtime.js'

type CapabilityAudience = 'ui' | 'agent' | 'system'
type CapabilityEffect = 'read' | 'compute'

export type ProjectDagCapabilityHandlerContext = Readonly<{
  caller: Readonly<{
    workspaceId?: string
  }>
}>

export type ProjectDagCapabilityOptions = Readonly<{
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
    input: any,
    context: ProjectDagCapabilityHandlerContext
  ) => Promise<{ output: unknown }>
}>

export type ProjectDagCapabilityBuilder<CapabilityDefinition = unknown> = (
  options: ProjectDagCapabilityOptions
) => CapabilityDefinition

export type ProjectDagCapabilityFactory<CapabilityDefinition = unknown> = Readonly<{
  moduleId: typeof PROJECT_DAG_DOMAIN_MODULE_ID
  policy: Readonly<{
    id: 'project-dag'
    title: 'Project DAG'
    directTransportPrefixes: readonly ['projectDag:']
    allowedDirectTransports: readonly []
  }>
  createDefinitions: () => readonly CapabilityDefinition[]
}>

export type ProjectDagMainContribution<CapabilityDefinition = unknown> =
  | ProjectDagCapabilityFactory<CapabilityDefinition>
  | DomainMainRuntimeLifecycleContribution
  | DomainArtifactConsumer

type ProjectDagMainHost = DomainMainHost & Readonly<{
  createProjectDagRuntime?: (
    options?: ProjectDagRuntimeOptions
  ) => ProjectDagRuntime
}>

type OwnedProjectDagRuntime = {
  runtime: ProjectDagRuntime
  deactivate: DomainMainRuntimeDisposer
  disposed: boolean
}

export function createDomainMainEntry(
  host: ProjectDagMainHost
): TrustedDomainProcessEntryInput<ProjectDagMainContribution> {
  const createRuntime = host.createProjectDagRuntime ?? ((options) =>
    new ProjectDagRuntime(options))
  let owned: OwnedProjectDagRuntime | null = null
  let activation: Promise<OwnedProjectDagRuntime> | null = null
  const getRuntime = (): ProjectDagRuntime => {
    if (!owned || owned.disposed) throw runtimeNotActiveError()
    return owned.runtime
  }
  const disposeOwned = async (
    record: OwnedProjectDagRuntime | null
  ): Promise<void> => {
    if (!record || record.disposed) return
    record.disposed = true
    if (owned === record) owned = null
    await record.deactivate()
  }
  const capabilityFactory = createProjectDagCapabilityFactory({
    defineCapability: host.defineCapability as ProjectDagCapabilityBuilder,
    getRuntime
  })
  const lifecycle: DomainMainRuntimeLifecycleContribution = Object.freeze({
    activate: async (context) => {
      if (owned || activation) {
        throw new Error('Project DAG runtime lifecycle is already active.')
      }
      const pending = (async (): Promise<OwnedProjectDagRuntime> => {
        const runtime = createRuntime()
        try {
          const deactivate = await runtime.activate(context)
          const record = { runtime, deactivate, disposed: false }
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
    consume: async (event) => getRuntime().consumeArtifact(event)
  })
  return {
    definition: domainPackageDefinition,
    contributions: [
      {
        ...PROJECT_DAG_CAPABILITY_FACTORY_CONTRIBUTION,
        value: capabilityFactory
      },
      {
        ...PROJECT_DAG_RUNTIME_LIFECYCLE_CONTRIBUTION,
        value: lifecycle,
        onDispose: async () => {
          const pending = activation
          if (pending) {
            await disposeOwned(await pending)
            return
          }
          await disposeOwned(owned)
        }
      },
      {
        ...PROJECT_DAG_ARTIFACT_CONSUMER_CONTRIBUTION,
        value: artifactConsumer
      }
    ]
  }
}

export function createProjectDagCapabilityFactory<CapabilityDefinition>(
  options: Readonly<{
    defineCapability: ProjectDagCapabilityBuilder<CapabilityDefinition>
    getRuntime: () => Pick<
      ProjectDagRuntime,
      'view' | 'update' | 'saveGoal' | 'resolveEvidencePreview'
    >
  }>
): ProjectDagCapabilityFactory<CapabilityDefinition> {
  const { defineCapability, getRuntime } = options
  return Object.freeze({
    moduleId: PROJECT_DAG_DOMAIN_MODULE_ID,
    policy: Object.freeze({
      id: 'project-dag' as const,
      title: 'Project DAG' as const,
      directTransportPrefixes: Object.freeze(['projectDag:']) as readonly ['projectDag:'],
      allowedDirectTransports: Object.freeze([]) as readonly []
    }),
    createDefinitions: () => [
      defineCapability({
        id: PROJECT_DAG_CAPABILITY_IDS.view,
        version: '1.0.0',
        title: 'View Project DAG',
        description: 'Reads the canonical committed Project graph and current update state.',
        audiences: ['ui', 'agent', 'system'],
        scope: 'workspace',
        effect: 'read',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'none' },
        tags: ['project-dag', 'graph', 'status'],
        inputSchema: projectDagViewInputSchema,
        outputSchema: projectDagViewResultSchema,
        handler: async (input, context) => ({
          output: await operationResult(() =>
            getRuntime().view(withCallerWorkspace(
              input as ProjectDagViewInput,
              context
            ))
          )
        })
      }),
      defineCapability({
        id: PROJECT_DAG_CAPABILITY_IDS.update,
        version: '1.0.0',
        title: 'Update Project DAG',
        description: 'Submits one idempotent durable Project update from committed Evidence snapshots.',
        audiences: ['ui', 'agent', 'system'],
        scope: 'workspace',
        effect: 'compute',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'required' },
        tags: ['project-dag', 'graph', 'compile'],
        inputSchema: projectDagUpdateInputSchema,
        outputSchema: projectDagUpdateResultSchema,
        handler: async (input, context) => ({
          output: await operationResult(() =>
            getRuntime().update(withCallerWorkspace(
              input as ProjectDagUpdateInput,
              context
            ))
          )
        })
      }),
      defineCapability({
        id: PROJECT_DAG_CAPABILITY_IDS.saveGoal,
        version: '1.0.0',
        title: 'Save Project DAG goal',
        description: 'Creates or updates the Project research goal and schedules canonical recompilation.',
        audiences: ['ui', 'agent', 'system'],
        scope: 'workspace',
        effect: 'compute',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'required' },
        tags: ['project-dag', 'goal'],
        inputSchema: projectDagSaveGoalInputSchema,
        outputSchema: projectDagSaveGoalResultSchema,
        handler: async (input, context) => ({
          output: await operationResult(() =>
            getRuntime().saveGoal(withCallerWorkspace(
              input as ProjectDagSaveGoalInput,
              context
            ))
          )
        })
      }),
      defineCapability({
        id: PROJECT_DAG_CAPABILITY_IDS.resolveEvidencePreview,
        version: '1.0.0',
        title: 'Resolve Project DAG evidence preview',
        description: 'Resolves one provenance-verified Project Claim evidence file.',
        audiences: ['ui', 'agent', 'system'],
        scope: 'workspace',
        effect: 'read',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'none' },
        tags: ['project-dag', 'evidence', 'preview'],
        inputSchema: projectDagResolveEvidencePreviewInputSchema,
        outputSchema: projectDagResolveEvidencePreviewResultSchema,
        handler: async (input, context) => ({
          output: await operationResult(() =>
            getRuntime().resolveEvidencePreview(withCallerWorkspace(
              input as ProjectDagResolveEvidencePreviewInput,
              context
            ))
          )
        })
      })
    ]
  })
}

function runtimeNotActiveError(): ProjectDagRuntimeError {
  return new ProjectDagRuntimeError(projectDagErrorSchema.parse({
    code: 'upstream_unavailable',
    message: 'Project DAG runtime lifecycle is not active.',
    retryable: true
  }))
}

async function operationResult<T>(operation: () => Promise<T>): Promise<
  { ok: true; data: T } | { ok: false; error: ProjectDagError }
> {
  try {
    return { ok: true, data: await operation() }
  } catch (error) {
    if (error instanceof ProjectDagRuntimeError) {
      return { ok: false, error: error.error }
    }
    return {
      ok: false,
      error: projectDagErrorSchema.parse({
        code: 'internal_error',
        message: error instanceof Error ? error.message : String(error),
        retryable: false
      })
    }
  }
}

function withCallerWorkspace<T extends ProjectDagTarget>(
  input: T,
  context: ProjectDagCapabilityHandlerContext
): T {
  const callerWorkspace = context.caller.workspaceId?.trim()
  if (!callerWorkspace) return input
  if (input.workspaceRoot && input.workspaceRoot !== callerWorkspace) {
    throw new ProjectDagRuntimeError(projectDagErrorSchema.parse({
      code: 'access_restricted',
      message: 'Project DAG workspaceRoot must match the caller workspace.',
      retryable: false
    }))
  }
  return {
    ...input,
    workspaceRoot: callerWorkspace
  }
}
