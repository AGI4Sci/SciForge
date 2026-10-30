import { createHash } from 'node:crypto'
import {
  CAPABILITY_BROKER_CONTRACT_VERSION,
  capabilityIdSchema,
  type CapabilityDescriptor
} from '../../shared/capability-broker'
import {
  DOMAIN_CAPABILITY_EVAL_CONTRACT_VERSION,
  type DomainCapabilityEvalRegistration
} from '@sciforge/domain-sdk/capability-eval'
import { domainPackageJsonValueSchema } from '@sciforge/domain-sdk/contract'
import { z } from 'zod'
import { evalEvaluationDimensionSchema } from './schema'

export { CAPABILITY_BROKER_CONTRACT_VERSION }

const nonEmptyString = z.string().trim().min(1)

export const CAPABILITY_EVAL_PREFLIGHT_CONTRACT_VERSION = 1 as const

export const capabilityEvalPreflightRequestSchema = z.object({
  expectedCapabilityContractVersion: z.number().int().positive(),
  referenceActions: z.array(z.object({
    id: capabilityIdSchema,
    version: nonEmptyString.max(128)
  }).strict()).min(1).max(512),
  requiredContributionActionIds: z.array(capabilityIdSchema).max(512).default([])
}).strict()

export type CapabilityEvalPreflightRequest = z.input<typeof capabilityEvalPreflightRequestSchema>

const capabilityEvalRunContextSchema = z.object({
  caseId: nonEmptyString.max(256),
  runId: nonEmptyString.max(256),
  workspaceDirectory: nonEmptyString.max(4_096),
  userDataDirectory: nonEmptyString.max(4_096).optional(),
  fixtureProfile: nonEmptyString.max(256).optional()
}).strict()

const capabilityEvalVisibleContextComponentSchema = z.object({
  id: nonEmptyString.max(256),
  region: nonEmptyString.max(96),
  component: nonEmptyString.max(192),
  title: z.string().trim().max(256).optional(),
  summary: z.string().max(480),
  visible: z.boolean(),
  priority: z.number().int().optional(),
  state: z.record(z.string().trim().min(1).max(128), domainPackageJsonValueSchema).optional()
}).strict()

export const capabilityEvalVisibleContextSchema = z.object({
  route: z.string().trim().max(512).optional(),
  workspaceRoot: z.string().trim().max(4_096).optional(),
  components: z.array(capabilityEvalVisibleContextComponentSchema).min(1).max(64)
}).strict()

export type CapabilityEvalVisibleContext = z.infer<typeof capabilityEvalVisibleContextSchema>

const capabilityEvalFixtureSchema = z.object({
  fixtureId: nonEmptyString.max(256),
  paths: z.array(nonEmptyString.max(4_096)).max(256),
  metadata: domainPackageJsonValueSchema.optional(),
  visibleContext: capabilityEvalVisibleContextSchema.optional()
}).strict()

const capabilityEvalObservedInvocationSchema = z.object({
  actionId: capabilityIdSchema,
  args: domainPackageJsonValueSchema,
  success: z.boolean(),
  logicalInvocationId: nonEmptyString.max(256).optional(),
  sequence: z.number().int().nonnegative().optional(),
  output: domainPackageJsonValueSchema.optional(),
  errorCode: nonEmptyString.max(128).optional()
}).strict()

export const capabilityEvalPrepareRequestSchema = capabilityEvalRunContextSchema.extend({
  requiredActionIds: z.array(capabilityIdSchema).max(512).default([])
}).strict()

export type CapabilityEvalPrepareRequest = z.infer<typeof capabilityEvalPrepareRequestSchema>

export const capabilityEvalPrepareResponseSchema = z.object({
  contractVersion: z.literal(CAPABILITY_EVAL_PREFLIGHT_CONTRACT_VERSION),
  caseId: nonEmptyString.max(256),
  runId: nonEmptyString.max(256),
  fixtures: z.array(capabilityEvalFixtureSchema).max(512),
  message: nonEmptyString.max(8_000)
}).strict()

export type CapabilityEvalPrepareResponse = z.infer<typeof capabilityEvalPrepareResponseSchema>

export const capabilityEvalInspectRequestSchema = capabilityEvalRunContextSchema.extend({
  requiredActionIds: z.array(capabilityIdSchema).max(512).default([]),
  invocations: z.array(capabilityEvalObservedInvocationSchema).max(2_048).default([])
}).strict()

export type CapabilityEvalInspectRequest = z.infer<typeof capabilityEvalInspectRequestSchema>

const capabilityEvalOracleResultSchema = z.object({
  taskSuccess: z.boolean().optional(),
  finalState: domainPackageJsonValueSchema.optional(),
  evidence: z.array(nonEmptyString.max(4_096)).max(512).default([]),
  verifiedActions: z.array(capabilityIdSchema).max(512).default([]),
  verifiedDimensions: z.array(evalEvaluationDimensionSchema).max(32).default([]),
  unsupported: z.array(nonEmptyString.max(4_096)).max(512).default([])
}).strict()

export const capabilityEvalInspectResponseSchema = z.object({
  contractVersion: z.literal(CAPABILITY_EVAL_PREFLIGHT_CONTRACT_VERSION),
  caseId: nonEmptyString.max(256),
  runId: nonEmptyString.max(256),
  taskSuccess: z.boolean().optional(),
  finalState: domainPackageJsonValueSchema.optional(),
  evidence: z.array(nonEmptyString.max(4_096)).max(2_048).default([]),
  verifiedActions: z.array(capabilityIdSchema).max(512).default([]),
  verifiedDimensions: z.array(evalEvaluationDimensionSchema).max(32).default([]),
  unsupported: z.array(nonEmptyString.max(4_096)).max(2_048).default([]),
  results: z.array(z.object({
    contributionId: nonEmptyString.max(192),
    moduleId: nonEmptyString.max(192),
    result: capabilityEvalOracleResultSchema
  }).strict()).max(512),
  message: nonEmptyString.max(8_000)
}).strict()

export type CapabilityEvalInspectResponse = z.infer<typeof capabilityEvalInspectResponseSchema>

const contributionSchema = z.object({
  contributionId: nonEmptyString.max(192),
  moduleId: nonEmptyString.max(192),
  packageName: nonEmptyString.max(214),
  moduleVersion: nonEmptyString.max(128),
  contractVersion: z.literal(DOMAIN_CAPABILITY_EVAL_CONTRACT_VERSION),
  actionIds: z.array(capabilityIdSchema).max(512),
  evaluationActionIds: z.array(capabilityIdSchema).max(512),
  contract: domainPackageJsonValueSchema
}).strict()

export const capabilityEvalPreflightSnapshotSchema = z.object({
  contractVersion: z.literal(CAPABILITY_EVAL_PREFLIGHT_CONTRACT_VERSION),
  capabilityContractVersion: z.number().int().positive(),
  status: z.enum(['ready', 'incomplete', 'incompatible']),
  registryFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  referenceActionIds: z.array(capabilityIdSchema).max(512),
  actualAgentActionIds: z.array(capabilityIdSchema).max(512),
  missingActionIds: z.array(capabilityIdSchema).max(512),
  unexpectedActionIds: z.array(capabilityIdSchema).max(512),
  versionMismatches: z.array(z.object({
    actionId: capabilityIdSchema,
    expected: nonEmptyString.max(128),
    actual: nonEmptyString.max(128)
  }).strict()).max(512),
  requiredContributionActionIds: z.array(capabilityIdSchema).max(512),
  missingContributionActionIds: z.array(capabilityIdSchema).max(512),
  contributionActionIds: z.array(capabilityIdSchema).max(512),
  evaluationActionIds: z.array(capabilityIdSchema).max(512),
  contributions: z.array(contributionSchema).max(512),
  message: nonEmptyString.max(8_000)
}).strict()

export type CapabilityEvalPreflightSnapshot = z.infer<typeof capabilityEvalPreflightSnapshotSchema>

export class CapabilityEvalPreflightError extends Error {
  readonly snapshot: CapabilityEvalPreflightSnapshot

  constructor(snapshot: CapabilityEvalPreflightSnapshot) {
    super(snapshot.message)
    this.name = 'CapabilityEvalPreflightError'
    this.snapshot = snapshot
  }
}

export function buildCapabilityEvalPreflightSnapshot(input: Readonly<{
  request: CapabilityEvalPreflightRequest
  descriptors: readonly CapabilityDescriptor[]
  contributions: readonly DomainCapabilityEvalRegistration[]
}>): CapabilityEvalPreflightSnapshot {
  const request = capabilityEvalPreflightRequestSchema.parse(input.request)
  const descriptors = input.descriptors
    .filter((descriptor) => descriptor.audiences.includes('agent'))
    .sort((left, right) => left.id.localeCompare(right.id))
  const referenceActions = [...request.referenceActions]
    .sort((left, right) => left.id.localeCompare(right.id))
  const referenceById = new Map(referenceActions.map((action) => [action.id, action]))
  const descriptorById = new Map(descriptors.map((descriptor) => [descriptor.id, descriptor]))
  const referenceActionIds = referenceActions.map((action) => action.id)
  const actualAgentActionIds = descriptors.map((descriptor) => descriptor.id)
  const missingActionIds = referenceActionIds.filter((id) => !descriptorById.has(id))
  const unexpectedActionIds = actualAgentActionIds.filter((id) => !referenceById.has(id))
  const versionMismatches = referenceActions.flatMap((reference) => {
    const actual = descriptorById.get(reference.id)?.version
    return actual && actual !== reference.version
      ? [{ actionId: reference.id, expected: reference.version, actual }]
      : []
  })
  const contributionActionIds = [...new Set(input.contributions.flatMap((contribution) => contribution.actionIds))]
    .sort((left, right) => left.localeCompare(right))
  const evaluationActionIds = [...new Set(input.contributions.flatMap((contribution) => contribution.evaluationActionIds))]
    .sort((left, right) => left.localeCompare(right))
  const evaluationActionIdSet = new Set(evaluationActionIds)
  const requiredContributionActionIds = [...new Set(request.requiredContributionActionIds)]
    .sort((left, right) => left.localeCompare(right))
  const missingContributionActionIds = requiredContributionActionIds
    .filter((id) => !evaluationActionIdSet.has(id))
  const registryFingerprint = createHash('sha256')
    .update(JSON.stringify(descriptors.map((descriptor) => ({
      contractVersion: descriptor.contractVersion,
      id: descriptor.id,
      version: descriptor.version
    }))))
    .digest('hex')
  const status = request.expectedCapabilityContractVersion !== CAPABILITY_BROKER_CONTRACT_VERSION
    ? 'incompatible'
    : missingActionIds.length > 0 || unexpectedActionIds.length > 0 || versionMismatches.length > 0 ||
        missingContributionActionIds.length > 0
      ? 'incomplete'
      : 'ready'
  const message = status === 'incompatible'
    ? `Capability broker contract mismatch: evaluator expects ${request.expectedCapabilityContractVersion}, Host provides ${CAPABILITY_BROKER_CONTRACT_VERSION}.`
    : status === 'incomplete'
      ? preflightIncompleteMessage({
          missingActionIds,
          unexpectedActionIds,
          versionMismatches,
          missingContributionActionIds
        })
      : `Capability evaluation preflight is ready with ${actualAgentActionIds.length} Agent-visible actions.`

  return capabilityEvalPreflightSnapshotSchema.parse({
    contractVersion: CAPABILITY_EVAL_PREFLIGHT_CONTRACT_VERSION,
    capabilityContractVersion: CAPABILITY_BROKER_CONTRACT_VERSION,
    status,
    registryFingerprint,
    referenceActionIds,
    actualAgentActionIds,
    missingActionIds,
    unexpectedActionIds,
    versionMismatches,
    requiredContributionActionIds,
    missingContributionActionIds,
    contributionActionIds,
    evaluationActionIds,
    contributions: input.contributions.map((contribution) => ({
      contributionId: contribution.contributionId,
      moduleId: contribution.moduleId,
      packageName: contribution.packageName,
      moduleVersion: contribution.moduleVersion,
      contractVersion: contribution.contractVersion,
      actionIds: [...contribution.actionIds].sort((left, right) => left.localeCompare(right)),
      evaluationActionIds: [...contribution.evaluationActionIds].sort((left, right) => left.localeCompare(right)),
      contract: contribution.contract
    })),
    message
  })
}

function preflightIncompleteMessage(input: Readonly<{
  missingActionIds: readonly string[]
  unexpectedActionIds: readonly string[]
  versionMismatches: readonly Readonly<{ actionId: string; expected: string; actual: string }>[]
  missingContributionActionIds: readonly string[]
}>): string {
  const reasons = [
    input.missingActionIds.length > 0 ? `missing actions: ${input.missingActionIds.join(', ')}` : '',
    input.unexpectedActionIds.length > 0 ? `unexpected actions: ${input.unexpectedActionIds.join(', ')}` : '',
    input.versionMismatches.length > 0
      ? `version drift: ${input.versionMismatches.map((item) => `${item.actionId} (${item.expected} -> ${item.actual})`).join(', ')}`
      : '',
    input.missingContributionActionIds.length > 0
      ? `missing eval contributions: ${input.missingContributionActionIds.join(', ')}`
      : ''
  ].filter(Boolean)
  return `Capability evaluation preflight is incomplete: ${reasons.join('; ')}.`
}
