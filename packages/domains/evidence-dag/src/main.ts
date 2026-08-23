import type {
  DomainArtifactConsumer,
  DomainArtifactEvent,
  DomainMainHost,
  DomainMainActionGuard,
  DomainMainRuntimeDisposer,
  DomainMainRuntimeLifecycleContribution,
  DomainMainRuntimeLifecycleContext
} from '@sciforge/domain-sdk/host'
import type { TrustedDomainProcessEntryInput } from '@sciforge/domain-sdk/main'
import type { z } from 'zod'
import {
  EVIDENCE_DAG_CAPABILITY_IDS,
  evidenceDagExportSnapshotProductsInputSchema,
  evidenceDagExportSnapshotProductsOutputSchema,
  evidenceDagPreviewInputSchema,
  evidenceDagPreviewOutputSchema,
  evidenceDagPriorityInputSchema,
  evidenceDagPriorityOutputSchema,
  evidenceDagSnapshotStatusInputSchema,
  evidenceDagSnapshotStatusOutputSchema,
  evidenceDagUpdateInputSchema,
  evidenceDagUpdateOutputSchema,
  evidenceDagViewInputSchema,
  evidenceDagViewOutputSchema
} from './contract.js'
import {
  EVIDENCE_DAG_ARTIFACT_CONSUMER_CONTRIBUTION,
  EVIDENCE_DAG_CAPABILITY_FACTORY_CONTRIBUTION,
  EVIDENCE_DAG_DOMAIN_MODULE_ID,
  EVIDENCE_DAG_RUNTIME_LIFECYCLE_CONTRIBUTION,
  EVIDENCE_DAG_WRITE_EXPORT_ACTION_GUARD_CONTRIBUTION,
  domainPackageDefinition
} from './definition.js'
import {
  EvidenceDagRuntime,
  type EvidenceDagRuntimePort
} from './main/runtime.js'
import { EVIDENCE_DAG_WRITE_EXPORT_ACTION } from './main/gate.js'

export { evidenceTraceFromThread } from './main/artifacts.js'
export {
  artifactVersionCommitPort,
  artifactVersionEventListPort,
  artifactVersionReadPort,
  createEvidenceArtifactVersionClient,
  type EvidenceArtifactVersionClient
} from './main/artifact-version-client.js'

type CapabilityAudience = 'ui' | 'agent' | 'system'
type EvidenceDagCapabilityContext = Readonly<{
  caller: Readonly<{ workspaceId?: string }>
}>

export type EvidenceDagCapabilityOptions = Readonly<{
  id: string
  version: string
  title: string
  description: string
  audiences: readonly CapabilityAudience[]
  scope: 'global' | 'workspace' | 'resource'
  effect: 'read' | 'compute' | 'workspace-write' | 'external-write'
  approval: 'none' | 'confirmation'
  concurrency: Readonly<{
    revision: 'none' | 'optimistic'
    idempotency: 'none' | 'required'
  }>
  tags: readonly string[]
  inputSchema: z.ZodType
  outputSchema: z.ZodType
  handler: (input: any, context?: EvidenceDagCapabilityContext) => Promise<Readonly<{
    output: unknown
    changed?: boolean
  }>>
}>

export type EvidenceDagCapabilityFactory<CapabilityDefinition = unknown> = Readonly<{
  moduleId: typeof EVIDENCE_DAG_DOMAIN_MODULE_ID
  policy: Readonly<{
    id: 'evidence-dag'
    title: 'Evidence DAG'
    directTransportPrefixes: readonly ['evidenceDag:']
    allowedDirectTransports: readonly []
  }>
  createDefinitions: () => readonly CapabilityDefinition[]
}>

export type EvidenceDagMainContribution<CapabilityDefinition = unknown> =
  | EvidenceDagCapabilityFactory<CapabilityDefinition>
  | DomainMainRuntimeLifecycleContribution
  | DomainArtifactConsumer
  | DomainMainActionGuard

type EvidenceDagMainHost = DomainMainHost & Readonly<{
  createEvidenceDagRuntime?: (options: Readonly<{
    userDataDir: string
  }>) => EvidenceDagRuntimePort
}>

type OwnedEvidenceDagRuntime = {
  runtime: EvidenceDagRuntimePort
  deactivate: DomainMainRuntimeDisposer
  disposed: boolean
}

type PendingEvidenceDagActivation = {
  token: { disposeRequested: boolean }
  promise: Promise<OwnedEvidenceDagRuntime>
}

export function createDomainMainEntry<CapabilityDefinition = unknown>(
  host: EvidenceDagMainHost
): TrustedDomainProcessEntryInput<EvidenceDagMainContribution<CapabilityDefinition>> {
  const createRuntime = host.createEvidenceDagRuntime ?? ((options) =>
    new EvidenceDagRuntime(options))
  let owned: OwnedEvidenceDagRuntime | null = null
  let activation: PendingEvidenceDagActivation | null = null
  const requireRuntime = (): EvidenceDagRuntimePort => {
    if (!owned || owned.disposed) {
      throw new Error('Evidence DAG runtime is not active.')
    }
    return owned.runtime
  }
  const disposeOwned = async (
    record: OwnedEvidenceDagRuntime | null
  ): Promise<void> => {
    if (!record || record.disposed) return
    record.disposed = true
    if (owned === record) owned = null
    await record.deactivate()
  }
  const disposeCurrent = async (): Promise<void> => {
    const pending = activation
    if (pending) pending.token.disposeRequested = true
    await disposeOwned(owned)
    if (!pending) return
    try {
      await disposeOwned(await pending.promise)
    } catch {
      // Failed activation owns its pre-activation cleanup.
    }
  }
  const lifecycle: DomainMainRuntimeLifecycleContribution = Object.freeze({
    activate: async (context: DomainMainRuntimeLifecycleContext) => {
      if (owned || activation) {
        throw new Error('Evidence DAG runtime lifecycle is already active.')
      }
      const token = { disposeRequested: false }
      const pendingPromise = (async (): Promise<OwnedEvidenceDagRuntime> => {
        const runtime = createRuntime({ userDataDir: context.userDataDir })
        let deactivate: DomainMainRuntimeDisposer
        try {
          deactivate = await runtime.activate(context)
        } catch (error) {
          await runtime.close().catch(() => undefined)
          throw error
        }
        const record = { runtime, deactivate, disposed: false }
        if (token.disposeRequested) {
          await disposeOwned(record)
          throw new Error('Evidence DAG runtime activation was disposed before completion.')
        }
        owned = record
        return record
      })()
      const pending = { token, promise: pendingPromise }
      activation = pending
      try {
        const record = await pendingPromise
        if (record.disposed) {
          throw new Error('Evidence DAG runtime activation was disposed before completion.')
        }
        return () => disposeOwned(record)
      } finally {
        if (activation === pending) activation = null
      }
    }
  })
  const artifactConsumer: DomainArtifactConsumer = Object.freeze({
    consume: (event: DomainArtifactEvent) => requireRuntime().consume(event)
  })
  const actionGuard: DomainMainActionGuard = Object.freeze({
    actions: Object.freeze([EVIDENCE_DAG_WRITE_EXPORT_ACTION]),
    evaluate: ({ payload }) => requireRuntime().guardWriteExport(payload)
  })
  const capabilityFactory = createEvidenceDagCapabilityFactory({
    defineCapability: host.defineCapability as (
      options: EvidenceDagCapabilityOptions
    ) => CapabilityDefinition,
    getRuntime: requireRuntime
  })

  return {
    definition: domainPackageDefinition,
    contributions: [
      {
        ...EVIDENCE_DAG_CAPABILITY_FACTORY_CONTRIBUTION,
        value: capabilityFactory
      },
      {
        ...EVIDENCE_DAG_RUNTIME_LIFECYCLE_CONTRIBUTION,
        value: lifecycle,
        onDispose: () => {
          void disposeCurrent().catch(() => undefined)
        }
      },
      {
        ...EVIDENCE_DAG_ARTIFACT_CONSUMER_CONTRIBUTION,
        value: artifactConsumer
      },
      {
        ...EVIDENCE_DAG_WRITE_EXPORT_ACTION_GUARD_CONTRIBUTION,
        value: actionGuard
      }
    ]
  }
}

export function createEvidenceDagCapabilityFactory<CapabilityDefinition>(
  options: Readonly<{
    defineCapability: (options: EvidenceDagCapabilityOptions) => CapabilityDefinition
    getRuntime: () => EvidenceDagRuntimePort
  }>
): EvidenceDagCapabilityFactory<CapabilityDefinition> {
  const define = (
    input: Omit<EvidenceDagCapabilityOptions, 'version' | 'audiences' | 'scope' | 'tags'> &
      Readonly<{
        audiences?: readonly CapabilityAudience[]
        scope?: EvidenceDagCapabilityOptions['scope']
      }>
  ) => {
    const { audiences = ['ui', 'agent'], scope = 'global', ...definition } = input
    return options.defineCapability({
      ...definition,
      version: '1.0.0',
      audiences,
      scope,
      tags: ['evidence', 'dag', 'provenance']
    })
  }
  return Object.freeze({
    moduleId: EVIDENCE_DAG_DOMAIN_MODULE_ID,
    policy: Object.freeze({
      id: 'evidence-dag' as const,
      title: 'Evidence DAG' as const,
      directTransportPrefixes: Object.freeze(['evidenceDag:']) as readonly ['evidenceDag:'],
      allowedDirectTransports: Object.freeze([]) as readonly []
    }),
    createDefinitions: () => [
      define({
        id: EVIDENCE_DAG_CAPABILITY_IDS.view,
        title: 'View Evidence DAG',
        description: 'Reads the last committed Evidence graph and its separate pending delta.',
        scope: 'workspace',
        effect: 'read',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'none' },
        audiences: ['ui', 'agent'],
        inputSchema: evidenceDagViewInputSchema,
        outputSchema: evidenceDagViewOutputSchema,
        handler: async (input, context) => ({
          output: await options.getRuntime().view({
            ...input,
            workspaceRoot: evidenceWorkspaceFromCaller(context)
          })
        })
      }),
      define({
        id: EVIDENCE_DAG_CAPABILITY_IDS.snapshotStatus,
        title: 'Read Evidence snapshot status',
        description: 'Reads durable Evidence snapshot state without requiring the UI sidecar.',
        scope: 'workspace',
        effect: 'read',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'none' },
        audiences: ['system'],
        inputSchema: evidenceDagSnapshotStatusInputSchema,
        outputSchema: evidenceDagSnapshotStatusOutputSchema,
        handler: async (input, context) => ({
          output: await options.getRuntime().snapshotStatus({
            ...input,
            workspaceRoot: evidenceWorkspaceFromCaller(context)
          })
        })
      }),
      define({
        id: EVIDENCE_DAG_CAPABILITY_IDS.update,
        title: 'Update Evidence DAG',
        description: 'Queues one durable Evidence-only update for a completed agent thread.',
        scope: 'workspace',
        effect: 'compute',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'required' },
        inputSchema: evidenceDagUpdateInputSchema,
        outputSchema: evidenceDagUpdateOutputSchema,
        handler: async (input, context) => ({
          output: await options.getRuntime().update({
            ...input,
            workspaceRoot: evidenceWorkspaceFromCaller(context)
          })
        })
      }),
      define({
        id: EVIDENCE_DAG_CAPABILITY_IDS.priority,
        title: 'Set Evidence DAG priority',
        description: 'Adjusts scheduling priority without creating another update path.',
        scope: 'workspace',
        effect: 'compute',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'required' },
        inputSchema: evidenceDagPriorityInputSchema,
        outputSchema: evidenceDagPriorityOutputSchema,
        handler: async (input, context) => ({
          output: await options.getRuntime().priority({
            ...input,
            workspaceRoot: evidenceWorkspaceFromCaller(context)
          })
        })
      }),
      define({
        id: EVIDENCE_DAG_CAPABILITY_IDS.resolvePreview,
        title: 'Resolve Evidence preview',
        description: 'Resolves a pinned provenance tuple to a verified workspace-local file.',
        scope: 'workspace',
        effect: 'read',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'none' },
        inputSchema: evidenceDagPreviewInputSchema,
        outputSchema: evidenceDagPreviewOutputSchema,
        handler: async (input, context) => ({
          output: await options.getRuntime().preview({
            ...input,
            workspaceRoot: evidenceWorkspaceFromCaller(context)
          })
        })
      }),
      define({
        id: EVIDENCE_DAG_CAPABILITY_IDS.exportSnapshotProducts,
        title: 'Export versioned Evidence Snapshot products',
        description: 'Projects one pinned snapshot to PROV, RO-Crate, DataCite, audit, and reproduction artifacts in one atomic version commit.',
        scope: 'workspace',
        effect: 'workspace-write',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'required' },
        inputSchema: evidenceDagExportSnapshotProductsInputSchema,
        outputSchema: evidenceDagExportSnapshotProductsOutputSchema,
        handler: async (input, context) => {
          const workspaceRoot = evidenceWorkspaceFromCaller(context)
          return {
            output: await options.getRuntime().exportSnapshotProducts({
              ...input,
              workspaceRoot
            })
          }
        }
      })
    ]
  })
}

function evidenceWorkspaceFromCaller(context?: EvidenceDagCapabilityContext): string {
  const workspaceRoot = context?.caller.workspaceId?.trim()
  if (!workspaceRoot) {
    throw new Error('Evidence DAG capability requires a workspace-scoped caller.')
  }
  return workspaceRoot
}
