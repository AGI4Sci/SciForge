import { projectIdSchema, userIdSchema, agentIdSchema, projectResultIdSchema, deliveryManifestIdSchema } from '@sciforge/collaboration-contracts'
import { z } from 'zod'

/** A local observation, never a scientific verdict or Cloud work authorization. */
export const resultAssessmentDecisionSchema = z.object({
  action: z.enum(['no_action', 'update_context', 'propose_next_step', 'human_decision']),
  rationale: z.string().trim().min(1).max(2000),
  suggestion: z.string().trim().max(4000),
  limitations: z.array(z.string().trim().min(1).max(1000)).max(12)
}).strict().readonly()

export const resultAssessmentSchema = z.object({
  key: z.string().regex(/^[a-f0-9]{64}$/u),
  projectId: projectIdSchema,
  principalUserId: userIdSchema,
  coordinatorAgentId: agentIdSchema,
  coordinatorAuthorityEpoch: z.number().int().nonnegative(),
  projectRevision: z.number().int().nonnegative(),
  projectResultId: projectResultIdSchema,
  deliveryManifestId: deliveryManifestIdSchema,
  manifestDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  projectVersion: z.number().int().nonnegative(),
  policyVersion: z.literal('observe-1'),
  limits: z.object({ perSourceAttempts: z.literal(2), perAuthorityAttempts: z.literal(20), deadlineMs: z.number().int().min(1).max(60_000), queueDeadlineMs: z.literal(300_000) }).strict().readonly(),
  state: z.enum(['queued', 'running', 'completed', 'unknown', 'stale']),
  attempt: z.number().int().min(0).max(2),
  leaseId: z.string().min(1),
  queuedAt: z.string().datetime(),
  queueExpiresAt: z.string().datetime(),
  startedAt: z.string().datetime(),
  leaseExpiresAt: z.string().datetime(),
  decision: resultAssessmentDecisionSchema.nullable(),
  detail: z.string().max(1000)
}).strict().refine((entry) => (entry.state === 'completed') === (entry.decision !== null), 'Only completed observations carry a decision.').readonly()
export type ResultAssessment = z.infer<typeof resultAssessmentSchema>
