import { z } from 'zod'

export const domainMainPowerLeaseRequestSchema = z.object({
  reason: z.string().trim().min(1).max(500)
}).strict()

export type DomainMainPowerLeaseRequest = z.infer<
  typeof domainMainPowerLeaseRequestSchema
>

/**
 * Keeps the application from being suspended until released. Release must be
 * idempotent so package cleanup can safely call it after cancellation.
 */
export type DomainMainPowerLease = Readonly<{
  release: () => void | Promise<void>
}>

export type DomainMainPowerHost = Readonly<{
  acquire: (
    request: DomainMainPowerLeaseRequest
  ) => Promise<DomainMainPowerLease>
}>
