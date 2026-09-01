import {
  createArtifactVersionCommitPortV1,
  createArtifactVersionReadPortV1
} from '@sciforge/domain-artifact-versions/contract'
import type { DomainMainHost } from '@sciforge/domain-sdk/host'
import type { TrustedDomainProcessEntryInput } from '@sciforge/domain-sdk/main'
import {
  createScientificPlottingService,
  type ScientificPlottingService
} from '@sciforge/scientific-plotting/service'
import {
  scientificPlottingCompareRequestSchema,
  scientificPlottingCompareResultSchema,
  scientificPlottingMapDataRequestSchema,
  scientificPlottingMapDataResultSchema,
  scientificPlottingRenderRequestSchema,
  scientificPlottingRenderResultSchema,
  scientificPlottingRerunRequestSchema,
  scientificPlottingRerunResultSchema,
  scientificPlottingStatusInputSchema,
  scientificPlottingStatusResultSchema,
  SCIENTIFIC_PLOTTING_CAPABILITY_IDS
} from './contract.js'
import {
  SCIENTIFIC_PLOTTING_CAPABILITY_FACTORY_CONTRIBUTION,
  SCIENTIFIC_PLOTTING_AGENT_ROUTING_CONTRIBUTION,
  SCIENTIFIC_PLOTTING_AGENT_ROUTING_CONTRACT,
  SCIENTIFIC_PLOTTING_DOMAIN_MODULE_ID,
  domainPackageDefinition
} from './definition.js'
import type { z } from 'zod'

type CapabilityEffect = 'read' | 'compute' | 'workspace-write'
type CapabilityScope = 'global' | 'workspace'
type CapabilityContext = Readonly<{ caller: Readonly<{ workspaceId?: string }> }>

export type ScientificPlottingCapabilityOptions = Readonly<{
  id: string
  version: string
  title: string
  description: string
  audiences: readonly ('ui' | 'agent' | 'system')[]
  scope: CapabilityScope
  effect: CapabilityEffect
  approval: 'none'
  concurrency: Readonly<{
    revision: 'none'
    idempotency: 'none' | 'required'
  }>
  tags: readonly string[]
  inputSchema: z.ZodType
  outputSchema: z.ZodType
  handler: (
    input: any,
    context: CapabilityContext
  ) => Promise<Readonly<{ output: unknown; changed?: boolean }>>
}>

export type ScientificPlottingCapabilityFactory<CapabilityDefinition = unknown> = Readonly<{
  moduleId: typeof SCIENTIFIC_PLOTTING_DOMAIN_MODULE_ID
  policy: Readonly<{
    id: 'scientific-plotting'
    title: 'Scientific Plotting'
    directTransportPrefixes: readonly ['scientific-plotting:', 'mcp:scientific-plotting-']
    allowedDirectTransports: readonly []
  }>
  createDefinitions: () => readonly CapabilityDefinition[]
}>

type ScientificPlottingMainHost = DomainMainHost & Readonly<{
  createService?: (workspaceRoot?: string) => ScientificPlottingService
}>

export function createDomainMainEntry<CapabilityDefinition = unknown>(
  host: ScientificPlottingMainHost
): TrustedDomainProcessEntryInput<
  ScientificPlottingCapabilityFactory<CapabilityDefinition> | null
> {
  const services = new Map<string, ScientificPlottingService>()
  const statusService = host.createService?.() ?? createScientificPlottingService()
  const serviceFor = (workspaceRoot: string): ScientificPlottingService => {
    let service = services.get(workspaceRoot)
    if (!service) {
      if (host.createService) {
        service = host.createService(workspaceRoot)
      } else {
        if (!host.capabilities) {
          throw new Error('Scientific Plotting requires the Artifact Versions capability host.')
        }
        service = createScientificPlottingService({
          artifactVersionCommitPort: createArtifactVersionCommitPortV1(
            host.capabilities,
            workspaceRoot
          ),
          artifactVersionReadPort: createArtifactVersionReadPortV1(
            host.capabilities,
            workspaceRoot
          )
        })
      }
      services.set(workspaceRoot, service)
    }
    return service
  }
  return {
    definition: domainPackageDefinition,
    contributions: [{
      ...SCIENTIFIC_PLOTTING_CAPABILITY_FACTORY_CONTRIBUTION,
      value: createScientificPlottingCapabilityFactory({
        defineCapability: host.defineCapability as (
          options: ScientificPlottingCapabilityOptions
        ) => CapabilityDefinition,
        statusService,
        serviceFor
      }),
      onDispose: () => services.clear()
    }, {
      ...SCIENTIFIC_PLOTTING_AGENT_ROUTING_CONTRIBUTION,
      value: null,
      contract: SCIENTIFIC_PLOTTING_AGENT_ROUTING_CONTRACT
    }]
  }
}

export function createScientificPlottingCapabilityFactory<CapabilityDefinition>(options: Readonly<{
  defineCapability: (options: ScientificPlottingCapabilityOptions) => CapabilityDefinition
  statusService: ScientificPlottingService
  serviceFor: (workspaceRoot: string) => ScientificPlottingService
}>): ScientificPlottingCapabilityFactory<CapabilityDefinition> {
  const define = (
    input: Omit<ScientificPlottingCapabilityOptions, 'version' | 'tags'>
  ): CapabilityDefinition => options.defineCapability({
    ...input,
    version: '1.0.0',
    tags: ['scientific-plotting', 'figure', 'provenance', 'reproducibility']
  })
  return Object.freeze({
    moduleId: SCIENTIFIC_PLOTTING_DOMAIN_MODULE_ID,
    policy: Object.freeze({
      id: 'scientific-plotting' as const,
      title: 'Scientific Plotting' as const,
      directTransportPrefixes: Object.freeze(['scientific-plotting:', 'mcp:scientific-plotting-']) as readonly ['scientific-plotting:', 'mcp:scientific-plotting-'],
      allowedDirectTransports: Object.freeze([]) as readonly []
    }),
    createDefinitions: () => [
      define({
        id: SCIENTIFIC_PLOTTING_CAPABILITY_IDS.status,
        title: 'Read Scientific Plotting status',
        description: 'Checks the deterministic renderer and its supported scientific templates.',
        audiences: ['ui', 'agent', 'system'],
        scope: 'global',
        effect: 'read',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'none' },
        inputSchema: scientificPlottingStatusInputSchema,
        outputSchema: scientificPlottingStatusResultSchema,
        handler: async () => ({ output: await options.statusService.status() })
      }),
      define({
        id: SCIENTIFIC_PLOTTING_CAPABILITY_IDS.mapData,
        title: 'Map data to a scientific plot recipe',
        description: 'Maps structured data without rendering and records explicit transformations and statistics.',
        audiences: ['ui', 'agent', 'system'],
        scope: 'workspace',
        effect: 'compute',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'required' },
        inputSchema: scientificPlottingMapDataRequestSchema,
        outputSchema: scientificPlottingMapDataResultSchema,
        handler: async (input, context) => {
          const workspaceRoot = requireWorkspace(context)
          return {
            output: await options.serviceFor(workspaceRoot).mapData({
              ...input,
              workspaceRoot
            })
          }
        }
      }),
      define({
        id: SCIENTIFIC_PLOTTING_CAPABILITY_IDS.render,
        title: 'Render and version a scientific plot',
        description: 'Renders a versioned PNG with exact data, statistics, recipe, environment, manifest, and logs.',
        audiences: ['ui', 'agent', 'system'],
        scope: 'workspace',
        effect: 'workspace-write',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'required' },
        inputSchema: scientificPlottingRenderRequestSchema,
        outputSchema: scientificPlottingRenderResultSchema,
        handler: async (input, context) => {
          const workspaceRoot = requireWorkspace(context)
          return {
            output: await options.serviceFor(workspaceRoot).render({
              ...input,
              workspaceRoot
            })
          }
        }
      }),
      define({
        id: SCIENTIFIC_PLOTTING_CAPABILITY_IDS.rerun,
        title: 'Rerun a pinned scientific plot recipe',
        description: 'Reruns exact historical inputs and reports replication or divergence without reading latest.',
        audiences: ['ui', 'agent', 'system'],
        scope: 'workspace',
        effect: 'workspace-write',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'required' },
        inputSchema: scientificPlottingRerunRequestSchema,
        outputSchema: scientificPlottingRerunResultSchema,
        handler: async (input, context) => {
          const workspaceRoot = requireWorkspace(context)
          return {
            output: await options.serviceFor(workspaceRoot).rerun({
              ...input,
              workspaceRoot
            })
          }
        }
      }),
      define({
        id: SCIENTIFIC_PLOTTING_CAPABILITY_IDS.compare,
        title: 'Compare scientific plot versions',
        description: 'Compares output, data, statistics, transforms, style, sources, and environment.',
        audiences: ['ui', 'agent', 'system'],
        scope: 'workspace',
        effect: 'read',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'none' },
        inputSchema: scientificPlottingCompareRequestSchema,
        outputSchema: scientificPlottingCompareResultSchema,
        handler: async (input, context) => {
          const workspaceRoot = requireWorkspace(context)
          return {
            output: await options.serviceFor(workspaceRoot).compare({
              ...input,
              workspaceRoot
            })
          }
        }
      })
    ]
  })
}

function requireWorkspace(context: CapabilityContext): string {
  const workspaceRoot = context.caller.workspaceId?.trim()
  if (!workspaceRoot) throw new Error('Scientific Plotting requires a workspace-scoped caller.')
  return workspaceRoot
}
