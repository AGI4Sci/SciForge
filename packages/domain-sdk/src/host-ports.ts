import { z } from 'zod'
import type { DomainMainSystemCapabilityInvoker } from './host.js'
import type { DomainPackageJsonValue } from './contract.js'

/**
 * Main-process contribution used to expose a domain package's capability-backed
 * host ports to approved Host callers without importing package implementation
 * details into the Host. Each port executes through the package-scoped system
 * capability invoker, so ports stay on the same governed path as the composed
 * domain packages themselves.
 */
export const MAIN_HOST_PORTS_CONTRIBUTION_KIND = 'main.host-ports.v1' as const
export const DOMAIN_HOST_PORTS_CONTRACT_VERSION = 1 as const

export const domainHostPortsContributionContractSchema = z.object({
  contractVersion: z.literal(DOMAIN_HOST_PORTS_CONTRACT_VERSION),
  kind: z.literal('host-ports'),
  portSource: z.string().trim().min(1).max(192)
}).strict()

export type DomainHostPortsContributionContract = z.infer<
  typeof domainHostPortsContributionContractSchema
>

export type DomainHostPortsPortMap = Readonly<Record<string, (input: unknown) => Promise<unknown>>>

export type DomainHostPortsContribution = Readonly<{
  createPorts: (
    invoker: DomainMainSystemCapabilityInvoker,
    workspaceId: string
  ) => DomainHostPortsPortMap
}>

export type DomainHostPortsRegistration = Readonly<
  DomainHostPortsContribution & {
    contributionId: string
    packageName: string
    moduleVersion: string
    owner: Readonly<{
      moduleId: string
      moduleVersion: string
    }>
    contract: DomainHostPortsContributionContract
  }
>

export function isDomainHostPortsContribution(
  value: unknown
): value is DomainHostPortsContribution {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.createPorts === 'function'
}

export function parseDomainHostPortsContributionContract(
  value: DomainPackageJsonValue | undefined
): DomainHostPortsContributionContract {
  return domainHostPortsContributionContractSchema.parse(value)
}
