import { z } from 'zod'

export const domainMainAgentCanonicalObservationSchema = z.object({
  kind: z.literal('target-semantic-tree'),
  targetId: z.string().trim().min(1).max(1_024),
  revision: z.string().trim().min(1).max(256),
  semanticTree: z.array(z.record(z.string(), z.unknown())).max(256)
}).strict().superRefine((observation, context) => {
  if (JSON.stringify(observation.semanticTree).length > 64_000) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['semanticTree'],
      message: 'Canonical semantic observations must not exceed 64 KB.'
    })
  }
})

export const domainMainAgentExecutionRequestSchema = z.object({
  runtimeId: z.string().trim().min(1).max(128).optional(),
  prompt: z.string().min(1).max(1_000_000),
  workspaceRoot: z.string().min(1).max(4_096),
  model: z.string().trim().min(1).max(256).optional(),
  reasoningEffort: z.string().trim().min(1).max(64).optional(),
  imageUrls: z.array(
    z.string().max(12_000_000).refine(
      (value) => /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value),
      { message: 'Agent execution images must be base64 PNG, JPEG, or WebP data URLs.' }
    )
  ).max(4).refine(
    (images) => images.reduce((total, image) => total + image.length, 0) <= 24_000_000,
    { message: 'Agent execution images exceed the 24 MB aggregate limit.' }
  ).optional(),
  allowedTools: z.array(
    z.string().trim().min(1).max(192).regex(/^[A-Za-z0-9_.-]+$/)
  ).max(128).refine((tools) => new Set(tools).size === tools.length, {
    message: 'Allowed tool names must be unique.'
  }).optional(),
  /**
   * Host-trusted, target-bound state captured by a main-process domain before
   * starting this hidden execution. Renderer IPC cannot supply this field.
   */
  canonicalObservation: domainMainAgentCanonicalObservationSchema.optional(),
  mode: z.enum(['agent', 'plan']).default('agent'),
  signal: z.instanceof(AbortSignal).optional()
}).strict()

export const domainMainAgentExecutionResultSchema = z.object({
  text: z.string().max(5_000_000),
  threadId: z.string().trim().min(1).max(256).optional()
}).strict()

export type DomainMainAgentExecutionRequest = z.input<
  typeof domainMainAgentExecutionRequestSchema
>
export type DomainMainAgentCanonicalObservation = z.infer<
  typeof domainMainAgentCanonicalObservationSchema
>
export type DomainMainAgentExecutionResult = z.infer<
  typeof domainMainAgentExecutionResultSchema
>

/**
 * Runs an agent through a host-owned runtime without exposing the host's
 * provider, thread, turn, or transport implementations. Omitting runtimeId
 * selects the user's active runtime through the Host.
 */
export type DomainMainAgentExecutionHost = Readonly<{
  run: (
    request: DomainMainAgentExecutionRequest
  ) => Promise<DomainMainAgentExecutionResult>
}>
