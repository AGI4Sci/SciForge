import { z } from 'zod'

/**
 * Main-process contribution kind for package-owned Agent routing guidance.
 *
 * The Host only composes and presents these contracts to the AgentRuntime. A
 * package owns the intent semantics, workflow steps, and reproducibility
 * requirements; the Host must not branch on a domain ID to implement them.
 */
export const MAIN_AGENT_ROUTING_CONTRIBUTION_KIND = 'main.agent-routing' as const

const routingTokenSchema = z.string()
  .trim()
  .min(1)
  .max(192)
  .regex(/^[a-z][a-z0-9_.:_-]*$/u)

const routingTextSchema = z.string().trim().min(1).max(2_000)

const routingWorkflowStepSchema = z.object({
  id: routingTokenSchema,
  description: routingTextSchema,
  tool: routingTokenSchema.optional(),
  capabilityId: routingTokenSchema.optional(),
  appliesToRoutes: z.array(routingTokenSchema).max(16).optional()
}).strict()

/**
 * Declarative, package-owned instructions that are injected into the
 * provider-neutral Agent prompt. The contract is intentionally structured so
 * the Host can render a bounded catalog without interpreting domain IDs.
 */
export const domainMainAgentRoutingContractSchema = z.object({
  intent: routingTokenSchema,
  title: routingTextSchema,
  summary: routingTextSchema,
  triggerHints: z.array(routingTextSchema).max(24).default([]),
  allowedRoutes: z.array(routingTokenSchema).min(1).max(16),
  workflow: z.array(routingWorkflowStepSchema).min(1).max(32),
  reproducibilityRequirements: z.array(routingTextSchema).min(1).max(32)
}).strict().superRefine((contract, context) => {
  if (new Set(contract.allowedRoutes).size !== contract.allowedRoutes.length) {
    context.addIssue({
      code: 'custom',
      path: ['allowedRoutes'],
      message: 'Agent routing allowed routes must be unique.'
    })
  }
  const workflowIds = contract.workflow.map((step) => step.id)
  if (new Set(workflowIds).size !== workflowIds.length) {
    context.addIssue({
      code: 'custom',
      path: ['workflow'],
      message: 'Agent routing workflow step IDs must be unique.'
    })
  }
})

type ParsedDomainMainAgentRoutingContract = z.output<
  typeof domainMainAgentRoutingContractSchema
>
type ParsedDomainMainAgentRoutingWorkflowStep = z.output<
  typeof routingWorkflowStepSchema
>

export type DomainMainAgentRoutingContract = Readonly<{
  intent: ParsedDomainMainAgentRoutingContract['intent']
  title: ParsedDomainMainAgentRoutingContract['title']
  summary: ParsedDomainMainAgentRoutingContract['summary']
  triggerHints: readonly ParsedDomainMainAgentRoutingContract['triggerHints'][number][]
  allowedRoutes: readonly ParsedDomainMainAgentRoutingContract['allowedRoutes'][number][]
  workflow: readonly Readonly<{
    id: ParsedDomainMainAgentRoutingWorkflowStep['id']
    description: ParsedDomainMainAgentRoutingWorkflowStep['description']
    tool?: ParsedDomainMainAgentRoutingWorkflowStep['tool']
    capabilityId?: ParsedDomainMainAgentRoutingWorkflowStep['capabilityId']
    appliesToRoutes?: readonly NonNullable<ParsedDomainMainAgentRoutingWorkflowStep['appliesToRoutes']>[number][]
  }>[]
  reproducibilityRequirements: readonly ParsedDomainMainAgentRoutingContract['reproducibilityRequirements'][number][]
}>

export function defineDomainMainAgentRoutingContract(
  input: z.input<typeof domainMainAgentRoutingContractSchema>
): DomainMainAgentRoutingContract {
  const parsed = domainMainAgentRoutingContractSchema.parse(input)
  return Object.freeze({
    ...parsed,
    triggerHints: Object.freeze([...parsed.triggerHints]),
    allowedRoutes: Object.freeze([...parsed.allowedRoutes]),
    workflow: Object.freeze(parsed.workflow.map(({ appliesToRoutes, ...step }) => Object.freeze({
      ...step,
      ...(appliesToRoutes
        ? { appliesToRoutes: Object.freeze([...appliesToRoutes]) }
        : {})
    }))),
    reproducibilityRequirements: Object.freeze([...parsed.reproducibilityRequirements])
  })
}

export function isDomainMainAgentRoutingContract(
  value: unknown
): value is DomainMainAgentRoutingContract {
  return domainMainAgentRoutingContractSchema.safeParse(value).success
}
