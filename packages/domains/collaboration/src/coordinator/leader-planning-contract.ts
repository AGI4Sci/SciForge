import { z } from 'zod'
import { humanDecisionInteractionSchema, humanDecisionOptionSchema } from '@sciforge/collaboration-contracts'

// The pattern excludes whitespace-only IDs, which trim().min() rejects locally.
const assignmentIdOutputSchema = { type: 'string', minLength: 1, maxLength: 256, pattern: '\\S' } as const
const assignmentIdSchema = z.string().trim().min(assignmentIdOutputSchema.minLength).max(assignmentIdOutputSchema.maxLength)

export const leaderDecisionSchema = z.object({
  prompt: z.string().trim().min(1).max(1000),
  interaction: humanDecisionInteractionSchema
}).strict()

export const leaderRecommendationSchema = z.object({
  title: z.string().trim().min(1).max(200),
  rationale: z.string().trim().min(1).max(4000),
  blockers: z.array(z.string().trim().min(1).max(1000)).max(20),
  decisions: z.array(leaderDecisionSchema).max(20),
  assignments: z.array(z.object({
    planItemId: assignmentIdSchema,
    workerUserId: assignmentIdSchema,
    rationale: z.string().trim().min(1).max(1000)
  }).strict()).max(100)
}).strict().refine(value => new Set(value.assignments.map(item => item.planItemId)).size === value.assignments.length,
  'Each work module can be recommended only once.')

export const leaderProposalSchema = leaderRecommendationSchema.safeExtend({
  key: z.string().regex(/^[a-f0-9]{64}$/u),
  projectId: z.string().min(1),
  projectRevision: z.number().int().positive(),
  coordinatorAuthorityEpoch: z.number().int().positive(),
  requirementsDocumentId: z.string().nullable(),
  requirementsRevision: z.number().int().positive().nullable(),
  requirementsContentDigest: z.string().nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  runtimeId: z.string().min(1),
  threadId: z.string().min(1)
})
export type LeaderProposal = z.infer<typeof leaderProposalSchema>

export const leaderRecommendationOutputSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 200 },
    rationale: { type: 'string', minLength: 1, maxLength: 4000 },
    blockers: { type: 'array', maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 1000 } },
    decisions: { type: 'array', maxItems: 20, items: { type: 'object', additionalProperties: false,
      properties: { prompt: { type: 'string', minLength: 1, maxLength: 1000 }, interaction: { anyOf: [
        { type: 'object', additionalProperties: false, properties: { kind: { type: 'string', const: 'clarification' } }, required: ['kind'] },
        { type: 'object', additionalProperties: false, properties: { kind: { type: 'string', const: 'approval' } }, required: ['kind'] },
        { type: 'object', additionalProperties: false, properties: { kind: { type: 'string', const: 'choice' },
          options: { type: 'array', minItems: 2, maxItems: 12, items: z.toJSONSchema(humanDecisionOptionSchema) },
          recommendedOptionId: { type: 'string' } }, required: ['kind', 'options'] }
      ] } }, required: ['prompt', 'interaction'] } },
    assignments: { type: 'array', maxItems: 100, items: { type: 'object', additionalProperties: false,
      properties: { planItemId: assignmentIdOutputSchema, workerUserId: assignmentIdOutputSchema, rationale: { type: 'string', minLength: 1, maxLength: 1000 } },
      required: ['planItemId', 'workerUserId', 'rationale'] } }
  }, required: ['title', 'rationale', 'blockers', 'decisions', 'assignments']
}

export const leaderPlanningStatusSchema = z.object({
  key: z.string().regex(/^[a-f0-9]{64}$/u),
  state: z.enum(['running', 'failed']),
  message: z.string().min(1).max(1000)
}).strict()
export type LeaderPlanningStatus = z.infer<typeof leaderPlanningStatusSchema>
