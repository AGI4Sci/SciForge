import type { z } from 'zod'
import type {
  DomainMainHost,
  DomainMainRuntimeLifecycleContribution
} from '@sciforge/domain-sdk/host'
import type { TrustedDomainProcessEntryInput } from '@sciforge/domain-sdk/main'
import {
  ARTIFACT_VERSIONS_CAPABILITY_IDS,
  artifactVersionBundleExportInputV1Schema,
  artifactVersionBundleExportResultV1Schema,
  artifactVersionBundleImportInputV1Schema,
  artifactVersionBundleImportResultV1Schema,
  artifactVersionBundleVerifyInputV1Schema,
  artifactVersionBundleVerifyResultV1Schema,
  artifactVersionCommitInputV1Schema,
  artifactVersionCommitResultV1Schema,
  artifactVersionCompareInputV1Schema,
  artifactVersionCompareResultV1Schema,
  artifactVersionEventListInputV1Schema,
  artifactVersionEventListResultV1Schema,
  artifactVersionListInputV1Schema,
  artifactVersionListResultV1Schema,
  artifactVersionMaterializeInputV1Schema,
  artifactVersionMaterializeResultV1Schema,
  artifactVersionObserveInputV1Schema,
  artifactVersionReadInputV1Schema,
  artifactVersionReadResultV1Schema,
  artifactVersionRefreshInputV1Schema,
  artifactVersionRefreshResultV1Schema,
  artifactVersionRestoreAsNewInputV1Schema
} from './contract.js'
import {
  ARTIFACT_VERSIONS_CAPABILITY_FACTORY_CONTRIBUTION,
  ARTIFACT_VERSIONS_DOMAIN_MODULE_ID,
  ARTIFACT_VERSIONS_RUNTIME_LIFECYCLE_CONTRIBUTION,
  domainPackageDefinition
} from './definition.js'
import { ArtifactVersionService } from './main/service.js'

type CapabilityAudience = 'ui' | 'agent' | 'system'
type CapabilityEffect = 'read' | 'compute' | 'workspace-write' | 'destructive'

type ArtifactVersionsCapabilityHandlerContext = Readonly<{
  caller: Readonly<{
    audience: CapabilityAudience
    callerId: string
    workspaceId?: string
  }>
}>

export type ArtifactVersionsCapabilityOptions = Readonly<{
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
    context: ArtifactVersionsCapabilityHandlerContext
  ) => Promise<Readonly<{ output: unknown; changed?: boolean }>>
}>

export type ArtifactVersionsCapabilityFactory<CapabilityDefinition = unknown> = Readonly<{
  moduleId: typeof ARTIFACT_VERSIONS_DOMAIN_MODULE_ID
  policy: Readonly<{
    id: 'artifact-versions'
    title: 'Artifact Versions'
    directTransportPrefixes: readonly []
    allowedDirectTransports: readonly []
  }>
  createDefinitions: () => readonly CapabilityDefinition[]
}>

export type ArtifactVersionsMainContribution<CapabilityDefinition = unknown> =
  | ArtifactVersionsCapabilityFactory<CapabilityDefinition>
  | DomainMainRuntimeLifecycleContribution

export function createDomainMainEntry<CapabilityDefinition = unknown>(
  host: DomainMainHost
): TrustedDomainProcessEntryInput<ArtifactVersionsMainContribution<CapabilityDefinition>> {
  let service: ArtifactVersionService | null = null
  let deactivate: (() => Promise<void>) | null = null
  const requireService = () => {
    if (!service) throw new Error('Artifact Versions runtime is not active.')
    return service
  }
  const lifecycle: DomainMainRuntimeLifecycleContribution = Object.freeze({
    activate: async (context) => {
      if (service || deactivate) throw new Error('Artifact Versions runtime is already active.')
      service = new ArtifactVersionService({ userDataDir: context.userDataDir })
      let disposed = false
      const dispose = async () => {
        if (disposed) return
        disposed = true
        service = null
        deactivate = null
      }
      deactivate = dispose
      return dispose
    }
  })
  const capabilityFactory = createArtifactVersionsCapabilityFactory({
    defineCapability: host.defineCapability as (
      options: ArtifactVersionsCapabilityOptions
    ) => CapabilityDefinition,
    getService: requireService
  })
  return {
    definition: domainPackageDefinition,
    contributions: [
      {
        ...ARTIFACT_VERSIONS_CAPABILITY_FACTORY_CONTRIBUTION,
        value: capabilityFactory
      },
      {
        ...ARTIFACT_VERSIONS_RUNTIME_LIFECYCLE_CONTRIBUTION,
        value: lifecycle,
        onDispose: () => {
          void deactivate?.().catch(() => undefined)
        }
      }
    ]
  }
}

export function createArtifactVersionsCapabilityFactory<CapabilityDefinition>(
  options: Readonly<{
    defineCapability: (
      options: ArtifactVersionsCapabilityOptions
    ) => CapabilityDefinition
    getService: () => ArtifactVersionService
  }>
): ArtifactVersionsCapabilityFactory<CapabilityDefinition> {
  const define = (
    input: Omit<ArtifactVersionsCapabilityOptions, 'version' | 'scope' | 'tags'>
  ): CapabilityDefinition => options.defineCapability({
    ...input,
    version: '1.0.0',
    scope: 'workspace',
    tags: ['artifact', 'versioning', 'provenance', 'reproducibility']
  })
  const workspace = (context: ArtifactVersionsCapabilityHandlerContext) => {
    const value = context.caller.workspaceId?.trim()
    if (!value) throw new Error('Artifact Versions capability requires caller workspace scope.')
    return value
  }
  const access = (context: ArtifactVersionsCapabilityHandlerContext) => {
    const callerId = context.caller.callerId?.trim()
    if (!callerId) throw new Error('Artifact Versions capability requires caller identity.')
    return {
      audience: context.caller.audience,
      callerId
    } as const
  }
  return Object.freeze({
    moduleId: ARTIFACT_VERSIONS_DOMAIN_MODULE_ID,
    policy: Object.freeze({
      id: 'artifact-versions' as const,
      title: 'Artifact Versions' as const,
      directTransportPrefixes: Object.freeze([]) as readonly [],
      allowedDirectTransports: Object.freeze([]) as readonly []
    }),
    createDefinitions: () => [
      define({
        id: ARTIFACT_VERSIONS_CAPABILITY_IDS.commit,
        title: 'Commit artifact versions',
        description: 'Atomically commits one or more immutable artifact versions.',
        audiences: ['ui', 'agent', 'system'],
        effect: 'workspace-write',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'required' },
        inputSchema: artifactVersionCommitInputV1Schema,
        outputSchema: artifactVersionCommitResultV1Schema,
        handler: async (raw, context) => mutationResponse(
          await options.getService().commit(
            workspace(context),
            artifactVersionCommitInputV1Schema.parse(raw),
            access(context)
          )
        )
      }),
      define({
        id: ARTIFACT_VERSIONS_CAPABILITY_IDS.observe,
        title: 'Observe workspace artifact',
        description: 'Hashes a workspace file and records a referenced or snapshotted version.',
        audiences: ['ui', 'agent', 'system'],
        effect: 'workspace-write',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'required' },
        inputSchema: artifactVersionObserveInputV1Schema,
        outputSchema: artifactVersionCommitResultV1Schema,
        handler: async (raw, context) => mutationResponse(
          await options.getService().observe(
            workspace(context),
            artifactVersionObserveInputV1Schema.parse(raw),
            access(context)
          )
        )
      }),
      define({
        id: ARTIFACT_VERSIONS_CAPABILITY_IDS.read,
        title: 'Read artifact version',
        description: 'Reads integrity-checked bytes for one pinned artifact version.',
        audiences: ['ui', 'agent', 'system'],
        effect: 'read',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'none' },
        inputSchema: artifactVersionReadInputV1Schema,
        outputSchema: artifactVersionReadResultV1Schema,
        handler: async (raw, context) => ({
          output: await options.getService().read(
            workspace(context),
            artifactVersionReadInputV1Schema.parse(raw),
            access(context)
          )
        })
      }),
      define({
        id: ARTIFACT_VERSIONS_CAPABILITY_IDS.list,
        title: 'List artifact version history',
        description: 'Lists immutable versions in the caller workspace.',
        audiences: ['ui', 'agent', 'system'],
        effect: 'read',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'none' },
        inputSchema: artifactVersionListInputV1Schema,
        outputSchema: artifactVersionListResultV1Schema,
        handler: async (raw, context) => ({
          output: await options.getService().list(
            workspace(context),
            artifactVersionListInputV1Schema.parse(raw),
            access(context)
          )
        })
      }),
      define({
        id: ARTIFACT_VERSIONS_CAPABILITY_IDS.materialize,
        title: 'Materialize artifact version',
        description: 'Writes verified version bytes to a caller-workspace destination.',
        audiences: ['ui', 'agent'],
        effect: 'workspace-write',
        approval: 'confirmation',
        concurrency: { revision: 'none', idempotency: 'required' },
        inputSchema: artifactVersionMaterializeInputV1Schema,
        outputSchema: artifactVersionMaterializeResultV1Schema,
        handler: async (raw, context) => mutationResponse(
          await options.getService().materialize(
            workspace(context),
            artifactVersionMaterializeInputV1Schema.parse(raw),
            access(context)
          )
        )
      }),
      define({
        id: ARTIFACT_VERSIONS_CAPABILITY_IDS.restoreAsNew,
        title: 'Restore artifact as a new version',
        description: 'Recommits historical bytes as a new current version without rewriting history.',
        audiences: ['ui', 'agent', 'system'],
        effect: 'workspace-write',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'required' },
        inputSchema: artifactVersionRestoreAsNewInputV1Schema,
        outputSchema: artifactVersionCommitResultV1Schema,
        handler: async (raw, context) => mutationResponse(
          await options.getService().restoreAsNew(
            workspace(context),
            artifactVersionRestoreAsNewInputV1Schema.parse(raw),
            access(context)
          )
        )
      }),
      define({
        id: ARTIFACT_VERSIONS_CAPABILITY_IDS.compare,
        title: 'Compare artifact versions',
        description: 'Compares content, metadata, media type, and pinned dependencies.',
        audiences: ['ui', 'agent', 'system'],
        effect: 'read',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'none' },
        inputSchema: artifactVersionCompareInputV1Schema,
        outputSchema: artifactVersionCompareResultV1Schema,
        handler: async (raw, context) => ({
          output: await options.getService().compare(
            workspace(context),
            artifactVersionCompareInputV1Schema.parse(raw),
            access(context)
          )
        })
      }),
      define({
        id: ARTIFACT_VERSIONS_CAPABILITY_IDS.exportBundle,
        title: 'Export artifact version bundle',
        description: 'Exports selected version histories and content-addressed snapshot objects.',
        audiences: ['ui', 'agent'],
        effect: 'workspace-write',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'required' },
        inputSchema: artifactVersionBundleExportInputV1Schema,
        outputSchema: artifactVersionBundleExportResultV1Schema,
        handler: async (raw, context) => mutationResponse(
          await options.getService().exportBundle(
            workspace(context),
            artifactVersionBundleExportInputV1Schema.parse(raw),
            access(context)
          )
        )
      }),
      define({
        id: ARTIFACT_VERSIONS_CAPABILITY_IDS.importBundle,
        title: 'Import artifact version bundle',
        description: 'Verifies and atomically imports a portable artifact version bundle.',
        audiences: ['ui', 'agent'],
        effect: 'workspace-write',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'required' },
        inputSchema: artifactVersionBundleImportInputV1Schema,
        outputSchema: artifactVersionBundleImportResultV1Schema,
        handler: async (raw, context) => mutationResponse(
          await options.getService().importBundle(
            workspace(context),
            artifactVersionBundleImportInputV1Schema.parse(raw),
            access(context)
          )
        )
      }),
      define({
        id: ARTIFACT_VERSIONS_CAPABILITY_IDS.verifyBundle,
        title: 'Verify artifact version bundle',
        description: 'Verifies bundle manifest, references, and snapshot object digests.',
        audiences: ['ui', 'agent', 'system'],
        effect: 'read',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'none' },
        inputSchema: artifactVersionBundleVerifyInputV1Schema,
        outputSchema: artifactVersionBundleVerifyResultV1Schema,
        handler: async (raw, context) => ({
          output: await options.getService().verifyBundle(
            workspace(context),
            artifactVersionBundleVerifyInputV1Schema.parse(raw)
          )
        })
      }),
      define({
        id: ARTIFACT_VERSIONS_CAPABILITY_IDS.listEvents,
        title: 'List artifact lifecycle events',
        description: 'Reads the durable ordered artifact lifecycle event stream.',
        audiences: ['ui', 'agent', 'system'],
        effect: 'read',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'none' },
        inputSchema: artifactVersionEventListInputV1Schema,
        outputSchema: artifactVersionEventListResultV1Schema,
        handler: async (raw, context) => ({
          output: await options.getService().listEvents(
            workspace(context),
            artifactVersionEventListInputV1Schema.parse(raw),
            access(context)
          )
        })
      }),
      define({
        id: ARTIFACT_VERSIONS_CAPABILITY_IDS.refresh,
        title: 'Refresh artifact lifecycle state',
        description: 'Checks observed workspace sources for missing, restored, or changed content.',
        audiences: ['ui', 'agent', 'system'],
        effect: 'compute',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'required' },
        inputSchema: artifactVersionRefreshInputV1Schema,
        outputSchema: artifactVersionRefreshResultV1Schema,
        handler: async (raw, context) => ({
          output: await options.getService().refresh(
            workspace(context),
            artifactVersionRefreshInputV1Schema.parse(raw),
            access(context)
          )
        })
      })
    ]
  })
}

function mutationResponse(output: unknown): Readonly<{
  output: unknown
}> {
  return { output }
}
