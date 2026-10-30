import type { DomainMainHost } from '@sciforge/domain-sdk/host'
import type { DomainCapabilityEvalContribution } from '@sciforge/domain-sdk/capability-eval'
import type { TrustedDomainProcessEntryInput } from '@sciforge/domain-sdk/main'
import type { z } from 'zod'
import {
  SCIENTIFIC_COMPUTE_CAPABILITY_IDS,
  scientificComputeRunBaselineInputSchema,
  scientificComputeRunBaselineResultSchema,
  scientificComputeStatusInputSchema,
  scientificComputeStatusResultSchema
} from './contract.js'
import {
  SCIENTIFIC_COMPUTE_CAPABILITY_FACTORY_CONTRIBUTION,
  SCIENTIFIC_COMPUTE_CAPABILITY_EVAL_CONTRIBUTION,
  SCIENTIFIC_COMPUTE_CAPABILITY_EVAL_CONTRACT,
  SCIENTIFIC_COMPUTE_DOMAIN_MODULE_ID,
  domainPackageDefinition
} from './definition.js'
import { SCIENTIFIC_COMPUTE_CAPABILITY_EVAL_CONTRIBUTION as SCIENTIFIC_COMPUTE_CAPABILITY_EVAL_VALUE } from './capability-eval.js'
import {
  createScientificJobBaselineTrace
} from './scientific-job.js'

type ScientificComputeCapabilityOptions = Readonly<{
  id: string
  version: string
  title: string
  description: string
  audiences: readonly ('ui' | 'agent' | 'system')[]
  scope: 'global'
  effect: 'read' | 'compute'
  approval: 'none'
  concurrency: Readonly<{
    revision: 'none'
    idempotency: 'none' | 'required'
  }>
  tags: readonly string[]
  inputSchema: z.ZodType
  outputSchema: z.ZodType
  handler: (input: unknown) => Promise<Readonly<{ output: unknown }>>
}>

export type ScientificComputeCapabilityFactory<CapabilityDefinition = unknown> = Readonly<{
  moduleId: typeof SCIENTIFIC_COMPUTE_DOMAIN_MODULE_ID
  policy: Readonly<{
    id: 'scientific-compute'
    title: 'Scientific Compute'
    directTransportPrefixes: readonly ['scientific-compute:']
    allowedDirectTransports: readonly []
  }>
  createDefinitions: () => readonly CapabilityDefinition[]
}>

export function createDomainMainEntry<CapabilityDefinition = unknown>(
  host: DomainMainHost
): TrustedDomainProcessEntryInput<
  ScientificComputeCapabilityFactory<CapabilityDefinition> | DomainCapabilityEvalContribution
> {
  return {
    definition: domainPackageDefinition,
    contributions: [
      {
        ...SCIENTIFIC_COMPUTE_CAPABILITY_FACTORY_CONTRIBUTION,
        value: createScientificComputeCapabilityFactory(
          host.defineCapability as (
            options: ScientificComputeCapabilityOptions
          ) => CapabilityDefinition
        )
      },
      {
        ...SCIENTIFIC_COMPUTE_CAPABILITY_EVAL_CONTRIBUTION,
        contract: SCIENTIFIC_COMPUTE_CAPABILITY_EVAL_CONTRACT,
        value: SCIENTIFIC_COMPUTE_CAPABILITY_EVAL_VALUE
      }
    ]
  }
}

export function createScientificComputeCapabilityFactory<CapabilityDefinition>(
  defineCapability: (
    options: ScientificComputeCapabilityOptions
  ) => CapabilityDefinition
): ScientificComputeCapabilityFactory<CapabilityDefinition> {
  const define = (
    options: Omit<ScientificComputeCapabilityOptions, 'version' | 'tags'>
  ): CapabilityDefinition => defineCapability({
    ...options,
    version: '1.0.0',
    tags: ['scientific-compute', 'local-fixture', 'trace', 'reproducibility']
  })

  return Object.freeze({
    moduleId: SCIENTIFIC_COMPUTE_DOMAIN_MODULE_ID,
    policy: Object.freeze({
      id: 'scientific-compute' as const,
      title: 'Scientific Compute' as const,
      directTransportPrefixes: Object.freeze(['scientific-compute:']) as readonly ['scientific-compute:'],
      allowedDirectTransports: Object.freeze([]) as readonly []
    }),
    createDefinitions: () => [
      define({
        id: SCIENTIFIC_COMPUTE_CAPABILITY_IDS.status,
        title: 'Read Scientific Compute status',
        description: 'Reports the deterministic local fixture provider; no real scheduler is configured.',
        audiences: ['ui', 'agent', 'system'],
        scope: 'global',
        effect: 'read',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'none' },
        inputSchema: scientificComputeStatusInputSchema,
        outputSchema: scientificComputeStatusResultSchema,
        handler: async (input) => {
          scientificComputeStatusInputSchema.parse(input)
          return {
            output: scientificComputeStatusResultSchema.parse({
              provider: 'local-fixture',
              realScheduler: false,
              scenarios: ['success', 'blocked', 'rerun', 'human-interaction']
            })
          }
        }
      }),
      define({
        id: SCIENTIFIC_COMPUTE_CAPABILITY_IDS.runBaseline,
        title: 'Run Scientific Compute baseline',
        description: 'Builds a deterministic local job-loop trace without submitting external work.',
        audiences: ['ui', 'agent', 'system'],
        scope: 'global',
        effect: 'compute',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'required' },
        inputSchema: scientificComputeRunBaselineInputSchema,
        outputSchema: scientificComputeRunBaselineResultSchema,
        handler: async (input) => {
          const parsed = scientificComputeRunBaselineInputSchema.parse(input)
          const trace = createScientificJobBaselineTrace(parsed)
          if (!trace.validation.ok) {
            throw new Error(`Scientific Compute baseline trace is invalid: ${trace.validation.issues
              .map((issue) => issue.code)
              .join(', ')}`)
          }
          return {
            output: scientificComputeRunBaselineResultSchema.parse({
              scenario: trace.scenario,
              traceId: trace.traceId,
              jobId: trace.jobId,
              state: trace.state,
              resourceUsage: trace.resourceUsage,
              artifacts: trace.artifacts.map(({ artifactId, path, sha256 }) => ({
                artifactId,
                path,
                sha256
              })),
              eventCount: trace.events.length,
              validationOk: trace.validation.ok,
              jsonl: trace.events.map((event) => JSON.stringify(event)).join('\n')
            })
          }
        }
      })
    ]
  })
}
