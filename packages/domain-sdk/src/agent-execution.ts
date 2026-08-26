import { z } from 'zod'

import { domainPackageJsonValueSchema } from './contract.js'

export const domainMainAgentExecutionSessionRequestSchema = z.object({
  runtimeId: z.string().trim().min(1).max(128).optional(),
  workspaceRoot: z.string().trim().min(1).max(4_096).optional(),
  model: z.string().trim().min(1).max(256).optional(),
  reasoningEffort: z.string().trim().min(1).max(64).optional(),
  allowedTools: z.array(
    z.string().trim().min(1).max(192).regex(/^[A-Za-z0-9_.-]+$/)
  ).max(128).refine((tools) => new Set(tools).size === tools.length, {
    message: 'Allowed tool names must be unique.'
  }).optional(),
  interaction: z.enum(['background', 'reviewable']).default('background'),
  mode: z.enum(['agent', 'plan']).default('agent')
}).strict()

export const domainMainAgentExecutionSessionSchema = z.object({
  runtimeId: z.string().trim().min(1).max(128),
  threadId: z.string().trim().min(1).max(256)
}).strict().readonly()

export const domainMainAgentExecutionRequestSchema = z.object({
  ...domainMainAgentExecutionSessionRequestSchema.shape,
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

const agentRuntimeCapabilityTagSchema = z.string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[a-z][a-z0-9_.-]*$/)

/**
 * Token-free Host observation of the canonical local AgentRuntime policy.
 * This is a configuration/readiness fact only; it carries no model endpoint,
 * credential, provider response, or executable implementation detail.
 */
export const domainMainAgentRuntimeReadinessSchema = z.discriminatedUnion('state', [
  z.object({
    state: z.literal('ready'),
    runtimeId: z.string().trim().min(1).max(128),
    capabilityTags: z.array(agentRuntimeCapabilityTagSchema).max(128)
      .refine((values) => new Set(values).size === values.length, {
        message: 'AgentRuntime capability tags must be unique.'
      })
  }).strict().readonly(),
  z.object({
    state: z.literal('not_configured'),
    reason: z.string().trim().min(1).max(512)
  }).strict().readonly(),
  z.object({
    state: z.literal('unavailable'),
    reason: z.string().trim().min(1).max(512)
  }).strict().readonly()
])

export type DomainMainAgentExecutionRequest = z.input<
  typeof domainMainAgentExecutionRequestSchema
>
export type DomainMainAgentExecutionSessionRequest = z.input<
  typeof domainMainAgentExecutionSessionRequestSchema
>
export type DomainMainAgentExecutionSession = z.infer<
  typeof domainMainAgentExecutionSessionSchema
>
export type DomainMainAgentExecutionResult = z.infer<
  typeof domainMainAgentExecutionResultSchema
>
export type DomainMainAgentRuntimeReadiness = z.infer<
  typeof domainMainAgentRuntimeReadinessSchema
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
  /** Optional at the generic SDK boundary; consumers that require execution must fail closed. */
  runtimeReadiness?: () => Promise<DomainMainAgentRuntimeReadiness>
  /**
   * Creates the canonical local Runtime Session without dispatching a turn.
   * Crash-safe callers persist this binding before calling run with a stable
   * clientDirectiveId. Hosts that omit it cannot support durable turn recovery.
   */
  prepareSession?: (
    request: DomainMainAgentExecutionSessionRequest
  ) => Promise<DomainMainAgentExecutionSession>
  run: (
    request: DomainMainAgentExecutionRequest
  ) => Promise<DomainMainAgentExecutionResult>
}>
