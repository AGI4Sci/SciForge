import { z } from 'zod'
import {
  domainPackageModuleIdSchema,
  type DomainPackageJsonValue
} from './contract.js'

/**
 * Main-process contribution used to make a domain package's evaluation
 * inventory and package-owned live evidence discoverable without importing
 * package implementation details into the Host. `actionIds` is the package's
 * Agent-visible inventory; `evaluationActionIds` is the subset with a fixture
 * and independent oracle implemented by this contribution.
 */
export const MAIN_CAPABILITY_EVAL_CONTRIBUTION_KIND = 'main.capability-eval' as const
export const DOMAIN_CAPABILITY_EVAL_CONTRACT_VERSION = 1 as const

export const domainCapabilityEvalContributionContractSchema = z.object({
  contractVersion: z.literal(DOMAIN_CAPABILITY_EVAL_CONTRACT_VERSION),
  kind: z.literal('capability-evaluation'),
  actionSource: z.string().trim().min(1).max(192)
}).strict()

export type DomainCapabilityEvalContributionContract = z.infer<
  typeof domainCapabilityEvalContributionContractSchema
>

export type DomainCapabilityEvalRunContext = Readonly<{
  caseId: string
  runId: string
  workspaceDirectory: string
  userDataDirectory?: string
  /** Stable package-owned fixture profile selected by the case contract. */
  fixtureProfile?: string
}>

export type DomainCapabilityEvalVisibleContextComponent = Readonly<{
  id: string
  region: string
  component: string
  title?: string
  summary: string
  visible: boolean
  priority?: number
  state?: Readonly<Record<string, DomainPackageJsonValue>>
}>

export type DomainCapabilityEvalVisibleContext = Readonly<{
  route?: string
  workspaceRoot?: string
  components: readonly DomainCapabilityEvalVisibleContextComponent[]
}>

export type DomainCapabilityEvalFixture = Readonly<{
  fixtureId: string
  paths: readonly string[]
  metadata?: DomainPackageJsonValue
  /** Trusted visible state published by the harness before the Agent turn. */
  visibleContext?: DomainCapabilityEvalVisibleContext
  cleanup?: () => void | Promise<void>
}>

export type DomainCapabilityEvalObservedInvocation = Readonly<{
  actionId: string
  args: DomainPackageJsonValue
  success: boolean
  logicalInvocationId?: string
  sequence?: number
  output?: DomainPackageJsonValue
  errorCode?: string
}>

export type DomainCapabilityEvalOracleResult = Readonly<{
  taskSuccess?: boolean
  finalState?: DomainPackageJsonValue
  evidence: readonly string[]
  verifiedActions: readonly string[]
  /** Evaluation dimensions explicitly verified by the package-owned oracle. */
  verifiedDimensions?: readonly string[]
  unsupported?: readonly string[]
}>

export type DomainCapabilityEvalContribution = Readonly<{
  moduleId: string
  contractVersion: typeof DOMAIN_CAPABILITY_EVAL_CONTRACT_VERSION
  actionIds: readonly string[]
  evaluationActionIds: readonly string[]
  prepare?: (
    context: DomainCapabilityEvalRunContext
  ) => DomainCapabilityEvalFixture | Promise<DomainCapabilityEvalFixture | undefined> | undefined
  inspect?: (input: Readonly<{
    context: DomainCapabilityEvalRunContext
    fixture?: DomainCapabilityEvalFixture
    invocations: readonly DomainCapabilityEvalObservedInvocation[]
  }>) => DomainCapabilityEvalOracleResult | Promise<DomainCapabilityEvalOracleResult | undefined> | undefined
}>

export type DomainCapabilityEvalRegistration = Readonly<
  DomainCapabilityEvalContribution & {
    contributionId: string
    packageName: string
    moduleVersion: string
    contract: DomainCapabilityEvalContributionContract
  }
>

export function isDomainCapabilityEvalContribution(
  value: unknown,
  moduleId?: string
): value is DomainCapabilityEvalContribution {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  if (typeof candidate.moduleId !== 'string' || !domainPackageModuleIdSchema.safeParse(candidate.moduleId).success) {
    return false
  }
  if (moduleId !== undefined && candidate.moduleId !== moduleId) return false
  if (candidate.contractVersion !== DOMAIN_CAPABILITY_EVAL_CONTRACT_VERSION) return false
  if (!Array.isArray(candidate.actionIds) || candidate.actionIds.length === 0) return false
  if (!Array.isArray(candidate.evaluationActionIds)) return false
  const actionIds = candidate.actionIds
  const evaluationActionIds = candidate.evaluationActionIds
  return actionIds.every((actionId) => typeof actionId === 'string' && actionId.trim().length > 0) &&
    new Set(actionIds).size === actionIds.length &&
    evaluationActionIds.every((actionId) => typeof actionId === 'string' && actionId.trim().length > 0) &&
    new Set(evaluationActionIds).size === evaluationActionIds.length &&
    evaluationActionIds.every((actionId) => actionIds.includes(actionId))
}

export function parseDomainCapabilityEvalContributionContract(
  value: DomainPackageJsonValue | undefined
): DomainCapabilityEvalContributionContract {
  return domainCapabilityEvalContributionContractSchema.parse(value)
}
