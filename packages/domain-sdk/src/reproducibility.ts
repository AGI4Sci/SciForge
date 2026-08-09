import { z } from 'zod'

import {
  domainPackageJsonValueSchema,
  type DomainPackageJsonValue
} from './contract.js'

export const SCIFORGE_REPRO_SPEC_VERSION = 'sciforge.rerun.v1' as const
export const SCIFORGE_REPRO_SPEC_RESOURCE_KIND = 'sciforge.repro-spec' as const
export const DOMAIN_EXECUTION_EVENT_VERSION = 'sciforge.execution-event.v1' as const

export const reproducibilityDigestSchema = z.string()
  .trim()
  .regex(/^sha256:[0-9a-f]{64}$/u, 'Expected a lowercase sha256 digest.')

const boundedIdSchema = z.string().trim().min(1).max(512)
const boundedLabelSchema = z.string().trim().min(1).max(1_024)
const timestampSchema = z.string().datetime({ offset: true })

export const reproBreakpointSchema = z.object({
  code: boundedIdSchema,
  component: z.enum([
    'executor',
    'input',
    'code',
    'environment',
    'parameters',
    'tool',
    'approval',
    'artifact',
    'output',
    'randomness',
    'lineage'
  ]),
  message: z.string().trim().min(1).max(4_000),
  activityId: boundedIdSchema.optional(),
  nodeId: boundedIdSchema.optional(),
  blocking: z.boolean()
}).strict()

export const reproArtifactReferenceSchema = z.object({
  id: boundedIdSchema,
  role: boundedIdSchema,
  kind: boundedIdSchema,
  name: boundedLabelSchema.optional(),
  artifactId: boundedIdSchema.optional(),
  artifactVersionId: boundedIdSchema.optional(),
  locator: z.string().trim().min(1).max(16_384).optional(),
  contentDigest: reproducibilityDigestSchema.optional(),
  version: z.string().trim().min(1).max(512).optional(),
  mediaType: z.string().trim().min(1).max(512).optional(),
  required: z.boolean()
}).strict()

export const reproCodeReferenceSchema = reproArtifactReferenceSchema.extend({
  language: z.string().trim().min(1).max(128).optional(),
  repository: z.string().trim().url().max(16_384).optional(),
  commit: z.string().trim().min(7).max(256).optional(),
  swhid: z.string().trim().min(1).max(512).optional(),
  entrypoint: z.string().trim().min(1).max(4_096).optional()
}).strict()

export const reproEnvironmentSchema = z.object({
  id: boundedIdSchema,
  name: boundedLabelSchema.optional(),
  platform: z.string().trim().min(1).max(512).optional(),
  architecture: z.string().trim().min(1).max(128).optional(),
  runtimeVersions: z.record(
    z.string().trim().min(1).max(192),
    z.string().trim().min(1).max(512)
  ),
  containerDigest: reproducibilityDigestSchema.optional(),
  lockDigests: z.array(reproducibilityDigestSchema).max(128),
  contentDigest: reproducibilityDigestSchema.optional(),
  attributes: domainPackageJsonValueSchema.optional()
}).strict()

export const reproParameterSetSchema = z.object({
  id: boundedIdSchema,
  values: domainPackageJsonValueSchema,
  digest: reproducibilityDigestSchema,
  randomSeed: z.union([z.string().max(512), z.number().finite()]).optional()
}).strict()

export const reproToolReferenceSchema = z.object({
  id: boundedIdSchema,
  name: boundedLabelSchema,
  providerId: boundedIdSchema.optional(),
  actionId: boundedIdSchema.optional(),
  version: z.string().trim().min(1).max(512).optional(),
  arguments: domainPackageJsonValueSchema.optional(),
  argumentsDigest: reproducibilityDigestSchema,
  resultDigest: reproducibilityDigestSchema.optional(),
  stochastic: z.boolean(),
  supportsSeed: z.boolean()
}).strict()

export const reproApprovalRequirementSchema = z.object({
  id: boundedIdSchema,
  kind: z.enum(['capability-confirmation', 'workflow-human-approval', 'policy-gate']),
  subjectId: boundedIdSchema,
  mode: boundedIdSchema,
  freshDecisionRequired: z.literal(true),
  historicalDecisionId: boundedIdSchema.optional(),
  historicalDecisionFingerprint: reproducibilityDigestSchema.optional(),
  policyDigest: reproducibilityDigestSchema.optional()
}).strict()

export const reproOutputComparatorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('exact-digest') }).strict(),
  z.object({
    kind: z.literal('json-structural'),
    absoluteTolerance: z.number().finite().nonnegative().optional(),
    relativeTolerance: z.number().finite().nonnegative().optional()
  }).strict(),
  z.object({
    kind: z.literal('numeric'),
    absoluteTolerance: z.number().finite().nonnegative(),
    relativeTolerance: z.number().finite().nonnegative().optional()
  }).strict(),
  z.object({
    kind: z.literal('table'),
    keyColumns: z.array(boundedIdSchema).max(256),
    valueColumns: z.array(boundedIdSchema).max(2_048),
    absoluteTolerance: z.number().finite().nonnegative().optional(),
    relativeTolerance: z.number().finite().nonnegative().optional()
  }).strict()
])

export const reproExpectedOutputSchema = reproArtifactReferenceSchema.extend({
  comparator: reproOutputComparatorSchema,
  baselineDigest: reproducibilityDigestSchema.optional()
}).strict()

export const reproExecutorSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('create-loop'),
    workflow: domainPackageJsonValueSchema,
    workflowDigest: reproducibilityDigestSchema,
    target: z.object({
      kind: z.enum(['workflow', 'node']),
      id: boundedIdSchema
    }).strict()
  }).strict(),
  z.object({
    kind: z.literal('unavailable'),
    reason: z.string().trim().min(1).max(4_000)
  }).strict()
])

export const reproActivitySchema = z.object({
  id: boundedIdSchema,
  type: z.enum(['experiment_run', 'analysis_run', 'workflow_run', 'tool_invocation']),
  name: boundedLabelSchema,
  executor: reproExecutorSchema,
  inputs: z.array(reproArtifactReferenceSchema).max(10_000),
  code: z.array(reproCodeReferenceSchema).max(10_000),
  environments: z.array(reproEnvironmentSchema).max(128),
  parameterSets: z.array(reproParameterSetSchema).max(128),
  tools: z.array(reproToolReferenceSchema).max(10_000),
  approvals: z.array(reproApprovalRequirementSchema).max(10_000),
  outputs: z.array(reproExpectedOutputSchema).max(10_000),
  stochastic: z.boolean(),
  inputFingerprint: reproducibilityDigestSchema,
  specFingerprint: reproducibilityDigestSchema,
  executionContextFingerprint: reproducibilityDigestSchema.optional(),
  baselineOutputFingerprint: reproducibilityDigestSchema.optional()
}).strict()

export const sciforgeReproSpecSchema = z.object({
  schemaVersion: z.literal(SCIFORGE_REPRO_SPEC_VERSION),
  specId: boundedIdSchema,
  specDigest: reproducibilityDigestSchema,
  source: z.object({
    snapshotDigest: reproducibilityDigestSchema,
    threadId: boundedIdSchema.optional(),
    conclusionId: boundedIdSchema.optional(),
    activityId: boundedIdSchema.optional()
  }).strict().refine(
    (source) => Boolean(source.conclusionId || source.activityId),
    'A reproducibility source requires a conclusionId or activityId.'
  ),
  target: z.object({
    kind: z.enum(['activity', 'conclusion']),
    id: boundedIdSchema
  }).strict(),
  executionReady: z.boolean(),
  reproducibility: z.enum(['controlled', 'uncontrolled', 'incomplete']),
  activities: z.array(reproActivitySchema).min(1).max(10_000),
  dependencies: z.array(z.object({
    src: boundedIdSchema,
    dst: boundedIdSchema,
    relation: boundedIdSchema
  }).strict()).max(100_000),
  secretSlots: z.array(z.object({
    id: boundedIdSchema,
    name: boundedLabelSchema,
    providerId: boundedIdSchema.optional(),
    required: z.boolean()
  }).strict()).max(10_000),
  breakpoints: z.array(reproBreakpointSchema).max(10_000),
  createdAt: timestampSchema
}).strict().superRefine((spec, context) => {
  const ids = new Set(spec.activities.map((activity) => activity.id))
  if (ids.size !== spec.activities.length) {
    context.addIssue({ code: 'custom', path: ['activities'], message: 'Activity ids must be unique.' })
  }
  for (const [index, edge] of spec.dependencies.entries()) {
    if (!ids.has(edge.src) || !ids.has(edge.dst)) {
      context.addIssue({
        code: 'custom',
        path: ['dependencies', index],
        message: 'Dependency endpoints must reference activities in this spec.'
      })
    }
  }
  if (spec.source.activityId && !ids.has(spec.source.activityId)) {
    context.addIssue({
      code: 'custom',
      path: ['source', 'activityId'],
      message: 'source.activityId must reference an activity in this spec.'
    })
  }
  if (spec.target.kind === 'activity' && !ids.has(spec.target.id)) {
    context.addIssue({
      code: 'custom',
      path: ['target', 'id'],
      message: 'An activity target must reference an activity in this spec.'
    })
  }
  if (spec.target.kind === 'activity' && spec.source.activityId !== spec.target.id) {
    context.addIssue({
      code: 'custom',
      path: ['source', 'activityId'],
      message: 'An activity-targeted spec must identify the same source activity.'
    })
  }
  if (spec.target.kind === 'conclusion' && spec.source.conclusionId !== spec.target.id) {
    context.addIssue({
      code: 'custom',
      path: ['source', 'conclusionId'],
      message: 'A conclusion-targeted spec must identify the same source conclusion.'
    })
  }
  if (hasDependencyCycle(spec.activities.map((activity) => activity.id), spec.dependencies)) {
    context.addIssue({
      code: 'custom',
      path: ['dependencies'],
      message: 'Activity dependencies must be acyclic.'
    })
  }
  const hasBlockingBreakpoint = spec.breakpoints.some((breakpoint) => breakpoint.blocking)
  if (spec.executionReady === hasBlockingBreakpoint) {
    context.addIssue({
      code: 'custom',
      path: ['executionReady'],
      message: 'executionReady must be false exactly when a blocking breakpoint exists.'
    })
  }
  const expectedReproducibility = hasBlockingBreakpoint
    ? 'incomplete'
    : spec.breakpoints.length > 0
      ? 'uncontrolled'
      : 'controlled'
  if (spec.reproducibility !== expectedReproducibility) {
    context.addIssue({
      code: 'custom',
      path: ['reproducibility'],
      message: `reproducibility must be ${expectedReproducibility} for the declared breakpoints.`
    })
  }
  for (const [activityIndex, activity] of spec.activities.entries()) {
    if (activity.executor.kind === 'unavailable' && !spec.breakpoints.some((breakpoint) =>
      breakpoint.blocking &&
      breakpoint.component === 'executor' &&
      (!breakpoint.activityId || breakpoint.activityId === activity.id)
    )) {
      context.addIssue({
        code: 'custom',
        path: ['activities', activityIndex, 'executor'],
        message: 'An unavailable executor requires a blocking executor breakpoint.'
      })
    }
    const hasSeed = activity.parameterSets.some((parameters) => parameters.randomSeed !== undefined)
    const hasUnseedableTool = activity.tools.some((tool) => tool.stochastic && !tool.supportsSeed)
    const isUncontrolledStochastic = activity.stochastic && (!hasSeed || hasUnseedableTool)
    if (isUncontrolledStochastic && !spec.breakpoints.some((breakpoint) =>
      !breakpoint.blocking &&
      breakpoint.component === 'randomness' &&
      (!breakpoint.activityId || breakpoint.activityId === activity.id)
    )) {
      context.addIssue({
        code: 'custom',
        path: ['activities', activityIndex, 'stochastic'],
        message: 'Unseeded or unseedable stochastic activity requires a non-blocking randomness breakpoint.'
      })
    }
    if (!activity.stochastic && activity.tools.some((tool) => tool.stochastic)) {
      context.addIssue({
        code: 'custom',
        path: ['activities', activityIndex, 'stochastic'],
        message: 'An activity containing a stochastic tool must itself be marked stochastic.'
      })
    }
  }
})

export type SciForgeReproSpecV1 = z.infer<typeof sciforgeReproSpecSchema>

/** Canonical bytes hashed for specDigest; the digest field never hashes itself. */
export function canonicalizeReproSpecForDigest(spec: SciForgeReproSpecV1): string {
  const parsed = sciforgeReproSpecSchema.parse(spec)
  const { specDigest: _specDigest, ...body } = parsed
  return canonicalizeReproValue(domainPackageJsonValueSchema.parse(body))
}

export const domainExecutionEventPhaseSchema = z.enum([
  'run_started',
  'activity_started',
  'tool_attempted',
  'governance_decided',
  'approval_requested',
  'approval_resolved',
  'artifact_committed',
  'activity_completed',
  'run_completed',
  'comparison_completed',
  'run_failed'
])

export const domainExecutionEventSchema = z.object({
  schemaVersion: z.literal(DOMAIN_EXECUTION_EVENT_VERSION),
  eventId: boundedIdSchema,
  phase: domainExecutionEventPhaseSchema,
  producer: z.object({
    moduleId: boundedIdSchema,
    moduleVersion: z.string().trim().min(1).max(128)
  }).strict(),
  executionId: boundedIdSchema,
  runId: boundedIdSchema,
  activityId: boundedIdSchema.optional(),
  specDigest: reproducibilityDigestSchema.optional(),
  rerunOfRunId: boundedIdSchema.optional(),
  traceId: boundedIdSchema.optional(),
  scope: z.object({
    runtimeId: boundedIdSchema.optional(),
    threadId: boundedIdSchema.optional(),
    turnId: boundedIdSchema.optional()
  }).strict().optional(),
  workspaceRoot: z.string().trim().min(1).max(16_384).optional(),
  occurredAt: timestampSchema,
  payload: domainPackageJsonValueSchema.optional(),
  artifacts: z.array(domainPackageJsonValueSchema).max(10_000).default([])
}).strict()

export type DomainExecutionEventV1 = z.infer<typeof domainExecutionEventSchema>
export type DomainExecutionEventInput = Omit<
  z.input<typeof domainExecutionEventSchema>,
  'schemaVersion' | 'eventId' | 'producer' | 'occurredAt'
> & Readonly<{
  schemaVersion?: typeof DOMAIN_EXECUTION_EVENT_VERSION
  eventId?: string
  occurredAt?: string
}>

/**
 * RFC 8785 JSON Canonicalization Scheme rendering. Object names are ordered by
 * UTF-16 code units and finite numbers use ECMAScript JSON serialization.
 * Hashing remains in the Node-owning producer.
 */
export function canonicalizeReproValue(value: DomainPackageJsonValue): string {
  return serializeCanonicalJson(domainPackageJsonValueSchema.parse(value))
}

function serializeCanonicalJson(value: DomainPackageJsonValue): string {
  if (value === null) return 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'string') {
    assertValidUnicode(value)
    const serialized = JSON.stringify(value)
    if (serialized === undefined) throw new TypeError('Value is not canonical JSON.')
    return serialized
  }
  if (typeof value === 'number') {
    const serialized = JSON.stringify(value)
    if (serialized === undefined) throw new TypeError('Value is not canonical JSON.')
    return serialized
  }
  if (Array.isArray(value)) {
    return `[${value.map(serializeCanonicalJson).join(',')}]`
  }
  const keys = Object.keys(value)
  keys.forEach(assertValidUnicode)
  return `{${keys
    .sort()
    .map((key) => `${JSON.stringify(key)}:${serializeCanonicalJson(value[key]!)}`)
    .join(',')}}`
}

/** RFC 8785 forbids lone UTF-16 surrogates because they are not Unicode scalar values. */
function assertValidUnicode(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (!Number.isInteger(next) || next < 0xdc00 || next > 0xdfff) {
        throw new TypeError('Canonical JSON cannot contain a lone UTF-16 surrogate.')
      }
      index += 1
      continue
    }
    if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new TypeError('Canonical JSON cannot contain a lone UTF-16 surrogate.')
    }
  }
}

function hasDependencyCycle(
  activityIds: readonly string[],
  dependencies: readonly Readonly<{ src: string; dst: string }>[]
): boolean {
  const incoming = new Map(activityIds.map((id) => [id, 0]))
  const outgoing = new Map(activityIds.map((id) => [id, [] as string[]]))
  for (const dependency of dependencies) {
    if (!incoming.has(dependency.src) || !incoming.has(dependency.dst)) continue
    outgoing.get(dependency.src)!.push(dependency.dst)
    incoming.set(dependency.dst, incoming.get(dependency.dst)! + 1)
  }
  const ready = [...incoming.entries()]
    .filter(([, count]) => count === 0)
    .map(([id]) => id)
  let visited = 0
  while (ready.length > 0) {
    const current = ready.pop()!
    visited += 1
    for (const next of outgoing.get(current) ?? []) {
      const count = incoming.get(next)! - 1
      incoming.set(next, count)
      if (count === 0) ready.push(next)
    }
  }
  return visited !== activityIds.length
}
