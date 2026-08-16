import { z } from 'zod'

import { domainPackageJsonValueSchema } from './contract.js'

export const domainMainAgentExecutionRequestSchema = z.object({
  runtimeId: z.string().trim().min(1).max(128).optional(),
  threadId: z.string().trim().min(1).max(256).optional(),
  clientDirectiveId: z.string()
    .trim()
    .min(1)
    .max(256)
    .regex(
      /^[A-Za-z0-9][A-Za-z0-9._:-]*$/,
      'Use a stable opaque directive ID containing letters, numbers, dots, underscores, colons, or hyphens.'
    )
    .optional(),
  prompt: z.string().min(1).max(1_000_000),
  /** Bounded caller provenance persisted with the canonical user directive. */
  metadata: domainPackageJsonValueSchema.optional(),
  workspaceRoot: z.string().trim().min(1).max(4_096).optional(),
  model: z.string().trim().min(1).max(256).optional(),
  reasoningEffort: z.string().trim().min(1).max(64).optional(),
  allowedTools: z.array(
    z.string().trim().min(1).max(192).regex(/^[A-Za-z0-9_.-]+$/)
  ).max(128).refine((tools) => new Set(tools).size === tools.length, {
    message: 'Allowed tool names must be unique.'
  }).optional(),
  interaction: z.enum(['background', 'reviewable']).default('background'),
  mode: z.enum(['agent', 'plan']).default('agent'),
  signal: z.instanceof(AbortSignal).optional()
}).strict().superRefine((request, context) => {
  if (request.threadId && !request.runtimeId) {
    context.addIssue({
      code: 'custom',
      path: ['runtimeId'],
      message: 'An existing thread requires its explicit runtime ID.'
    })
  }
})

export const domainMainAgentExecutionResultSchema = z.object({
  runtimeId: z.string().trim().min(1).max(128),
  threadId: z.string().trim().min(1).max(256),
  turnId: z.string().trim().min(1).max(256),
  state: z.enum(['completed', 'failed', 'cancelled']),
  text: z.string().max(5_000_000),
}).strict()

export type DomainMainAgentExecutionRequest = z.input<
  typeof domainMainAgentExecutionRequestSchema
>
export type DomainMainAgentExecutionResult = z.infer<
  typeof domainMainAgentExecutionResultSchema
>

/**
 * Runs one turn through the canonical host-owned runtime and capability path
 * without exposing provider or transport implementations.
 *
 * Omitting threadId starts one thread; workspaceRoot is optional so a package
 * can create an unbound conversation. Supplying threadId continues that exact
 * thread and therefore also requires runtimeId. For an existing thread,
 * workspaceRoot is only an expected binding: the Host must reject a mismatch
 * rather than retargeting the thread. A caller that can retry a logical
 * directive supplies one stable clientDirectiveId on every attempt so the
 * Host's canonical directive ledger can reconcile it without a second turn.
 */
export type DomainMainAgentExecutionHost = Readonly<{
  run: (
    request: DomainMainAgentExecutionRequest
  ) => Promise<DomainMainAgentExecutionResult>
}>
