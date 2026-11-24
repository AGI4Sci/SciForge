import { z } from 'zod'

export const REVIEW_CONTROL_CAPABILITY_IDS = Object.freeze({
  receiptCommit: 'review.receipt.commit',
  suggest: 'review.suggest',
  coverage: 'review.coverage'
})

const reference = z.string().trim().min(1)
const timestamp = z.string().datetime({ offset: true })

export const reviewReceiptSchema = z.strictObject({
  artifactVersion: reference,
  fieldPath: reference.optional(),
  actorHash: reference,
  openedAt: timestamp,
  submittedAt: timestamp,
  verdict: z.enum(['accepted', 'corrected', 'rejected', 'needs_revision', 'unresolved', 'skipped']),
  // No reason code is accepted until its closed vocabulary is approved.
  reasonCode: z.never().optional(),
  prev: reference.nullable().optional(),
  digest: reference.optional()
}).refine((value) => Date.parse(value.submittedAt) >= Date.parse(value.openedAt), {
  path: ['submittedAt'], message: 'submittedAt precedes openedAt.'
})
export type ReviewReceipt = z.infer<typeof reviewReceiptSchema>

export const reviewSuggestionSchema = z.strictObject({
  nodeId: reference,
  rank: z.number().int().nonnegative(),
  reason: z.enum(['type_prior', 'downstream_impact', 'low_confidence', 'unreviewed']),
  expectedGain: z.number(),
  costMinutes: z.number().nonnegative()
})
export type ReviewSuggestion = z.infer<typeof reviewSuggestionSchema>

export const coverageReportSchema = z.strictObject({
  known: z.number().int().nonnegative(),
  flagged: z.number().int().nonnegative(),
  reviewed: z.number().int().nonnegative(),
  unreachable: z.number().int().nonnegative(),
  unreviewed: z.number().int().nonnegative()
})
export type CoverageReport = z.infer<typeof coverageReportSchema>

export const reviewReceiptCommitInputSchema = z.strictObject({
  operationId: z.string().trim().min(8).max(200),
  receipt: reviewReceiptSchema
})
export const reviewReceiptCommitResultSchema = z.strictObject({
  artifactId: reference, versionId: reference, contentDigest: reference
})
