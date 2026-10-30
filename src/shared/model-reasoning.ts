/**
 * Renderer-visible surface for model reasoning-level discovery.
 *
 * The renderer never sees the vocabulary file, cache internals or provider
 * credentials — only the resolved outcome and the user-triggered probe report.
 */
import { z } from 'zod'

export const modelReasoningQuerySchema = z
  .object({
    provider: z.string().min(1).max(120),
    model: z.string().min(1).max(200),
    protocol: z.string().min(1).max(60),
    endpoint: z.string().max(500).nullish()
  })
  .strict()

export const modelReasoningStateSchema = z.enum(['known', 'unsupported', 'unknown'])
export const modelReasoningCompletenessSchema = z.enum(['complete', 'partial']).nullable()
export const modelReasoningSourceSchema = z.enum(['upstream', 'catalog', 'vocabulary', 'cache', 'none'])

export const modelReasoningOutcomeSchema = z
  .object({
    state: modelReasoningStateSchema,
    levels: z.array(z.string()).max(32),
    completeness: modelReasoningCompletenessSchema,
    defaultLevel: z.string().nullable(),
    source: modelReasoningSourceSchema,
    verifiedAt: z.string().nullable(),
    checkedAt: z.string(),
    attachEffort: z.boolean(),
    /**
     * True when the shown observation is a cached last-valid result whose
     * re-check failed or is backoff-blocked — the UI labels it as possibly
     * outdated instead of pretending it was just verified.
     */
    stale: z.boolean().optional(),
    refreshError: z.string().max(300).optional()
  })
  .strict()

export const modelReasoningDiscoverInputSchema = modelReasoningQuerySchema
  .extend({ force: z.boolean().optional() })
  .strict()

export const modelReasoningProbeInputSchema = z
  .object({
    requestId: z.string().min(1).max(120),
    query: modelReasoningQuerySchema,
    levels: z.array(z.string().min(1).max(40)).min(1).max(12),
    maxLevels: z.number().int().min(1).max(8).optional()
  })
  .strict()

export const modelReasoningProbeReportSchema = z
  .object({
    requestId: z.string(),
    acceptedLevels: z.array(z.string()),
    rejectedLevels: z.array(z.string()),
    skippedLevels: z.array(z.string()),
    truncated: z.boolean(),
    cancelled: z.boolean(),
    errors: z.array(z.string()),
    meaning: z.literal('parameter-accepted-only')
  })
  .strict()

export const modelReasoningCancelInputSchema = z.object({ requestId: z.string().min(1).max(120) }).strict()
export const modelReasoningCancelResultSchema = z.object({ cancelled: z.boolean() }).strict()

export type ModelReasoningQuery = z.infer<typeof modelReasoningQuerySchema>
export type ModelReasoningOutcome = z.infer<typeof modelReasoningOutcomeSchema>
export type ModelReasoningProbeInput = z.infer<typeof modelReasoningProbeInputSchema>
export type ModelReasoningProbeReport = z.infer<typeof modelReasoningProbeReportSchema>

export type ModelReasoningApi = {
  /** Resolve the reasoning-level evidence for a binding. Never throws, never blocks. */
  discover: (input: ModelReasoningQuery & { force?: boolean }) => Promise<ModelReasoningOutcome>
  /** User-triggered probe. Acceptance evidence only; may cost tokens. */
  probe: (input: ModelReasoningProbeInput) => Promise<ModelReasoningProbeReport>
  cancelProbe: (input: { requestId: string }) => Promise<{ cancelled: boolean }>
}