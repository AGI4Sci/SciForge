import { z } from 'zod'

export const DOMAIN_EXTERNAL_NAVIGATION_LIMITS = Object.freeze({
  maxUrlCharacters: 4_096
})

export const domainExternalNavigationTargetHandleSchema = z.string()
  .regex(/^portal_[A-Za-z0-9_-]{32}$/u)

export type DomainExternalNavigationTargetHandle = z.infer<
  typeof domainExternalNavigationTargetHandleSchema
>

export const domainExternalNavigationIssueTargetInputSchema = z.object({
  url: z.string().min(1).max(DOMAIN_EXTERNAL_NAVIGATION_LIMITS.maxUrlCharacters),
  expiresAt: z.string().datetime({ offset: true })
}).strict().readonly()

export type DomainExternalNavigationIssueTargetInput = z.infer<
  typeof domainExternalNavigationIssueTargetInputSchema
>

export const domainExternalNavigationIssuedTargetSchema = z.object({
  handle: domainExternalNavigationTargetHandleSchema,
  expiresAt: z.string().datetime({ offset: true })
}).strict().readonly()

export type DomainExternalNavigationIssuedTarget = z.infer<
  typeof domainExternalNavigationIssuedTargetSchema
>

export type DomainExternalNavigationErrorCode =
  | 'invalid_target'
  | 'capacity_exceeded'
  | 'target_unavailable'
  | 'principal_changed'
  | 'cancelled'
  | 'outcome_unknown'
  | 'open_failed'

export class DomainExternalNavigationError extends Error {
  readonly code: DomainExternalNavigationErrorCode

  constructor(
    code: DomainExternalNavigationErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'DomainExternalNavigationError'
    this.code = code
  }
}

export type DomainMainExternalNavigationHost = Readonly<{
  /** Requires an active Broker invocation; caller and Principal are Host-derived. */
  issueTarget(input: DomainExternalNavigationIssueTargetInput):
    DomainExternalNavigationIssuedTarget
  /**
   * Requires an active Broker invocation. A started OS dispatch consumes the
   * target exactly once; cancellation or reauthorization after handoff is an
   * `outcome_unknown` rejection and must never be retried blindly.
   */
  openTarget(input: Readonly<{
    handle: DomainExternalNavigationTargetHandle
    signal?: AbortSignal
  }>): Promise<void>
}>
