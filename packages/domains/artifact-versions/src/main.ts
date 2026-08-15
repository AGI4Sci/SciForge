import type { z } from 'zod'
import {
  defineDomainMainSystemCapabilityGrant,
  type DomainMainHost,
  type DomainMainRuntimeLifecycleContribution,
  type DomainMainSystemCapabilityGrant
} from '@sciforge/domain-sdk/host'
import type { TrustedDomainProcessEntryInput } from '@sciforge/domain-sdk/main'
import {
  ARTIFACT_VERSIONS_CAPABILITY_IDS,
  ARTIFACT_VERSIONS_SYSTEM_CAPABILITY_GRANTS,
  artifactVersionBundleExportInputV1Schema,
  artifactVersionBundleExportInputV2Schema,
  artifactVersionBundleExportResultV1Schema,
  artifactVersionBundleExportResultV2Schema,
  artifactVersionBundleImportInputV1Schema,
  artifactVersionBundleImportResultV1Schema,
  artifactVersionBundleVerifyInputV1Schema,
  artifactVersionBundleVerifyResultV1Schema,
  artifactVersionBundleVerifyResultV2Schema,
  artifactVersionCommitInputV1Schema,
  artifactVersionCommitResultV1Schema,
  artifactVersionCommitInputV2Schema,
  artifactVersionCommitResultV2Schema,
  artifactVersionCompareInputV1Schema,
  artifactVersionCompareResultV1Schema,
  artifactVersionDescribeInputV2Schema,
  artifactVersionDescribeResultV2Schema,
  artifactVersionEventListInputV1Schema,
  artifactVersionEventListResultV1Schema,
  artifactVersionListInputV1Schema,
  artifactVersionListInputV2Schema,
  artifactVersionListResultV1Schema,
  artifactVersionListResultV2Schema,
  artifactVersionMaterializeInputV1Schema,
  artifactVersionMaterializeResultV1Schema,
  artifactVersionObserveInputV1Schema,
  artifactVersionReadInputV1Schema,
  artifactVersionReadRangeInputV2Schema,
  artifactVersionReadRangeResultV2Schema,
  artifactVersionReadResultV1Schema,
  artifactVersionRefreshInputV1Schema,
  artifactVersionRefreshResultV1Schema,
  artifactVersionRestoreAsNewInputV1Schema,
  artifactVersionStageAbortInputV2Schema,
  artifactVersionStageAbortResultV2Schema,
  artifactVersionStageAppendInputV2Schema,
  artifactVersionStageAppendResultV2Schema,
  artifactVersionStageBeginInputV2Schema,
  artifactVersionStageBeginResultV2Schema,
  artifactVersionStageSealInputV2Schema,
  artifactVersionStageSealResultV2Schema
} from './contract.js'
import {
  ARTIFACT_VERSIONS_CAPABILITY_FACTORY_CONTRIBUTION,
  ARTIFACT_VERSIONS_DOMAIN_MODULE_ID,
  ARTIFACT_VERSIONS_IDENTITY_GRANT_CONTRIBUTION,
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
    capabilityGrants?: readonly string[]
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
  | DomainMainSystemCapabilityGrant

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
      },
      {
        ...ARTIFACT_VERSIONS_IDENTITY_GRANT_CONTRIBUTION,
        value: defineDomainMainSystemCapabilityGrant({
          id: ARTIFACT_VERSIONS_SYSTEM_CAPABILITY_GRANTS.selectIdentities,
          eligibility: 'trusted-domain-runtime',
          description: 'Select immutable Artifact and Version identities during an atomic commit.'
        })
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
      callerId,
      ...(context.caller.capabilityGrants?.length
        ? { capabilityGrants: Object.freeze([...context.caller.capabilityGrants]) }
        : {})
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
        handler: async (raw, context) => {
          const input = artifactVersionCommitInputV1Schema.parse(raw)
          return mutationResponse(await options.getService().commit(
            workspace(context),
            input,
            access(context)
          ))
        }
      }),
      define({
        id: ARTIFACT_VERSIONS_CAPABILITY_IDS.commitV2,
        title: 'Commit artifact versions V2',
        description: 'Commits versions with staged content and system-owned deterministic identities.',
        audiences: ['system'],
        effect: 'workspace-write',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'required' },
        inputSchema: artifactVersionCommitInputV2Schema,
        outputSchema: artifactVersionCommitResultV2Schema,
        handler: async (raw, context) => {
          const input = artifactVersionCommitInputV2Schema.parse(raw)
          if (input.candidates.some((candidate) => (
            candidate.requestedArtifactId || candidate.requestedVersionId
          )) && !context.caller.capabilityGrants?.includes(
            ARTIFACT_VERSIONS_SYSTEM_CAPABILITY_GRANTS.selectIdentities
          )) {
            throw new Error('Caller-selected identities require the Artifact Versions identity-selection grant.')
          }
          return mutationResponse(await options.getService().commitV2(
            workspace(context), input, access(context)
          ))
        }
      }),
      define({
        id: ARTIFACT_VERSIONS_CAPABILITY_IDS.stageBeginV2,
        title: 'Begin staged artifact object',
        description: 'Creates a caller-bound bounded streaming object upload.',
        audiences: ['system'],
        effect: 'workspace-write',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'required' },
        inputSchema: artifactVersionStageBeginInputV2Schema,
        outputSchema: artifactVersionStageBeginResultV2Schema,
        handler: async (raw, context) => mutationResponse(
          await options.getService().stageBegin(
            workspace(context),
            artifactVersionStageBeginInputV2Schema.parse(raw),
            access(context)
          )
        )
      }),
      define({
        id: ARTIFACT_VERSIONS_CAPABILITY_IDS.stageAppendV2,
        title: 'Append staged artifact object chunk',
        description: 'Appends one integrity-checked sequential chunk to a staged object.',
        audiences: ['system'],
        effect: 'workspace-write',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'required' },
        inputSchema: artifactVersionStageAppendInputV2Schema,
        outputSchema: artifactVersionStageAppendResultV2Schema,
        handler: async (raw, context) => mutationResponse(
          await options.getService().stageAppend(
            workspace(context),
            artifactVersionStageAppendInputV2Schema.parse(raw),
            access(context)
          )
        )
      }),
      define({
        id: ARTIFACT_VERSIONS_CAPABILITY_IDS.stageSealV2,
        title: 'Seal staged artifact object',
        description: 'Verifies and seals a staged object for single-use commit.',
        audiences: ['system'],
        effect: 'workspace-write',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'required' },
        inputSchema: artifactVersionStageSealInputV2Schema,
        outputSchema: artifactVersionStageSealResultV2Schema,
        handler: async (raw, context) => mutationResponse(
          await options.getService().stageSeal(
            workspace(context),
            artifactVersionStageSealInputV2Schema.parse(raw),
            access(context)
          )
        )
      }),
      define({
        id: ARTIFACT_VERSIONS_CAPABILITY_IDS.stageAbortV2,
        title: 'Abort staged artifact object',
        description: 'Discards an uncommitted staged object owned by the system caller.',
        audiences: ['system'],
        effect: 'workspace-write',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'required' },
        inputSchema: artifactVersionStageAbortInputV2Schema,
        outputSchema: artifactVersionStageAbortResultV2Schema,
        handler: async (raw, context) => mutationResponse(
          await options.getService().stageAbort(
            workspace(context),
            artifactVersionStageAbortInputV2Schema.parse(raw),
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
        id: ARTIFACT_VERSIONS_CAPABILITY_IDS.readRangeV2,
        title: 'Read exact artifact content range',
        description: 'Reads one bounded integrity-checked range from a snapshot version.',
        audiences: ['ui', 'agent', 'system'],
        effect: 'read',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'none' },
        inputSchema: artifactVersionReadRangeInputV2Schema,
        outputSchema: artifactVersionReadRangeResultV2Schema,
        handler: async (raw, context) => ({
          output: await options.getService().readRange(
            workspace(context),
            artifactVersionReadRangeInputV2Schema.parse(raw),
            access(context)
          )
        })
      }),
      define({
        id: ARTIFACT_VERSIONS_CAPABILITY_IDS.describeV2,
        title: 'Describe exact artifact version',
        description: 'Returns one exact version, stable reference, current state, and local ordinal.',
        audiences: ['ui', 'agent', 'system'],
        effect: 'read',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'none' },
        inputSchema: artifactVersionDescribeInputV2Schema,
        outputSchema: artifactVersionDescribeResultV2Schema,
        handler: async (raw, context) => ({
          output: await options.getService().describe(
            workspace(context),
            artifactVersionDescribeInputV2Schema.parse(raw),
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
          output: await options.getService().listV1(
            workspace(context),
            artifactVersionListInputV1Schema.parse(raw),
            access(context)
          )
        })
      }),
      define({
        id: ARTIFACT_VERSIONS_CAPABILITY_IDS.listV2,
        title: 'List enriched artifact version history',
        description: 'Lists immutable versions with research filters, ordinals, and current state.',
        audiences: ['ui', 'agent', 'system'],
        effect: 'read',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'none' },
        inputSchema: artifactVersionListInputV2Schema,
        outputSchema: artifactVersionListResultV2Schema,
        handler: async (raw, context) => ({
          output: await options.getService().list(
            workspace(context),
            artifactVersionListInputV2Schema.parse(raw),
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
        id: ARTIFACT_VERSIONS_CAPABILITY_IDS.exportBundleV2,
        title: 'Export artifact version directory bundle',
        description: 'Exports selected version histories as a V2 directory bundle.',
        audiences: ['ui', 'agent'],
        effect: 'workspace-write',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'required' },
        inputSchema: artifactVersionBundleExportInputV2Schema,
        outputSchema: artifactVersionBundleExportResultV2Schema,
        handler: async (raw, context) => mutationResponse(
          await options.getService().exportBundle(
            workspace(context),
            artifactVersionBundleExportInputV2Schema.parse(raw),
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
          output: await options.getService().verifyBundleV1(
            workspace(context),
            artifactVersionBundleVerifyInputV1Schema.parse(raw)
          )
        })
      }),
      define({
        id: ARTIFACT_VERSIONS_CAPABILITY_IDS.verifyBundleV2,
        title: 'Verify artifact version bundle V2',
        description: 'Verifies either portable bundle format and reports the detected format.',
        audiences: ['ui', 'agent', 'system'],
        effect: 'read',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'none' },
        inputSchema: artifactVersionBundleVerifyInputV1Schema,
        outputSchema: artifactVersionBundleVerifyResultV2Schema,
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
