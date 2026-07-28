import { z } from 'zod'

export const domainMainAgentExecutionRequestSchema = z.object({
  runtimeId: z.string().trim().min(1).max(128),
  prompt: z.string().min(1).max(1_000_000),
  workspaceRoot: z.string().min(1).max(4_096),
  model: z.string().trim().min(1).max(256).optional(),
  reasoningEffort: z.string().trim().min(1).max(64).optional(),
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
export type DomainMainAgentExecutionResult = z.infer<
  typeof domainMainAgentExecutionResultSchema
>

/**
 * Runs an agent through a host-owned runtime without exposing the host's
 * provider, thread, turn, or transport implementations.
 */
export type DomainMainAgentExecutionHost = Readonly<{
  run: (
    request: DomainMainAgentExecutionRequest
  ) => Promise<DomainMainAgentExecutionResult>
}>
