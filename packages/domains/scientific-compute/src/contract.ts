import type { DomainCapabilityContract } from '@sciforge/domain-sdk/host'
import { z } from 'zod'

export const SCIENTIFIC_COMPUTE_CAPABILITY_IDS = Object.freeze({
  status: 'scientific-compute.status',
  runBaseline: 'scientific-compute.run-baseline'
} as const)

export const scientificJobScenarioSchema = z.enum([
  'success',
  'blocked',
  'rerun',
  'human-interaction'
])

export type ScientificJobScenario = z.infer<typeof scientificJobScenarioSchema>

const scientificJobStateSchema = z.enum([
  'submitted',
  'running',
  'finished',
  'failed',
  'blocked',
  'cancelled',
  'resumed'
])

const boundedIdSchema = z.string().trim().min(1).max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)

export const scientificComputeStatusInputSchema = z.object({}).strict()

export const scientificComputeStatusResultSchema = z.object({
  provider: z.literal('local-fixture'),
  realScheduler: z.literal(false),
  scenarios: z.array(scientificJobScenarioSchema).length(4)
}).strict()

export type ScientificComputeStatusResult = z.infer<typeof scientificComputeStatusResultSchema>

export const scientificComputeRunBaselineInputSchema = z.object({
  scenario: scientificJobScenarioSchema,
  traceId: boundedIdSchema.optional(),
  jobId: boundedIdSchema.optional(),
  reviewerId: boundedIdSchema.optional()
}).strict()

export type ScientificComputeRunBaselineInput = z.infer<
  typeof scientificComputeRunBaselineInputSchema
>

const scientificComputeResourceUsageSchema = z.object({
  humanMinutes: z.number().finite().nonnegative(),
  gpuHours: z.number().finite().nonnegative(),
  apiTokens: z.number().finite().nonnegative(),
  storageGb: z.number().finite().nonnegative(),
  estimatedUsd: z.number().finite().nonnegative()
}).strict()

const scientificComputeArtifactSummarySchema = z.object({
  artifactId: boundedIdSchema,
  path: z.string().trim().min(1).max(4_096),
  sha256: z.string().regex(/^[a-f0-9]{64}$/)
}).strict()

export const scientificComputeRunBaselineResultSchema = z.object({
  scenario: scientificJobScenarioSchema,
  traceId: boundedIdSchema,
  jobId: boundedIdSchema,
  state: scientificJobStateSchema,
  resourceUsage: scientificComputeResourceUsageSchema,
  artifacts: z.array(scientificComputeArtifactSummarySchema).max(16),
  eventCount: z.number().int().positive(),
  validationOk: z.boolean(),
  jsonl: z.string().max(2_000_000)
}).strict()

export type ScientificComputeRunBaselineResult = z.infer<
  typeof scientificComputeRunBaselineResultSchema
>

export const SCIENTIFIC_COMPUTE_STATUS_CONTRACT: DomainCapabilityContract<
  Record<string, never>,
  ScientificComputeStatusResult
> = Object.freeze({
  actionId: SCIENTIFIC_COMPUTE_CAPABILITY_IDS.status,
  effect: 'read',
  inputSchema: scientificComputeStatusInputSchema,
  outputSchema: scientificComputeStatusResultSchema
})

export const SCIENTIFIC_COMPUTE_RUN_BASELINE_CONTRACT: DomainCapabilityContract<
  ScientificComputeRunBaselineInput,
  ScientificComputeRunBaselineResult
> = Object.freeze({
  actionId: SCIENTIFIC_COMPUTE_CAPABILITY_IDS.runBaseline,
  effect: 'compute',
  inputSchema: scientificComputeRunBaselineInputSchema,
  outputSchema: scientificComputeRunBaselineResultSchema
})

export {
  SCIENTIFIC_COMPUTE_DOMAIN_MODULE_ID,
  SCIENTIFIC_COMPUTE_DOMAIN_PACKAGE_NAME,
  domainPackageDefinition
} from './definition.js'
