import { z } from 'zod'

import { domainPackageJsonValueSchema, type DomainPackageJsonValue } from './contract.js'

export const DOMAIN_WORKFLOW_TEMPLATE_CONTRACT_VERSION = 1 as const
export const DOMAIN_WORKFLOW_EXECUTION_RECEIPT_CONTRACT_VERSION = 1 as const
export const MAIN_WORKFLOW_EXECUTION_RECEIPT_PROVIDER_CONTRIBUTION_KIND =
  'main.workflow-execution-receipt-provider' as const

export const domainWorkflowTemplateBundleSchema = z.object({
  contractVersion: z.literal(DOMAIN_WORKFLOW_TEMPLATE_CONTRACT_VERSION),
  templateId: z.string().trim().min(1).max(192),
  rootWorkflowId: z.string().trim().min(1).max(256),
  workflows: z.array(domainPackageJsonValueSchema).min(1).max(100),
  initialInput: domainPackageJsonValueSchema,
  metadata: domainPackageJsonValueSchema.optional()
}).strict().superRefine((bundle, context) => {
  const ids = bundle.workflows.flatMap((workflow) => {
    if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow)) return []
    return typeof workflow.id === 'string' ? [workflow.id] : []
  })
  if (!ids.includes(bundle.rootWorkflowId)) {
    context.addIssue({
      code: 'custom',
      path: ['rootWorkflowId'],
      message: 'The root workflow must be present in workflows.'
    })
  }
})

export type DomainWorkflowTemplateBundle = z.infer<typeof domainWorkflowTemplateBundleSchema>

export type DomainWorkflowTemplateBuilder<Input = DomainPackageJsonValue> = Readonly<{
  templateId: string
  build: (
    input: Input,
    context?: Readonly<{ now?: string; defaultModel?: string }>
  ) => DomainWorkflowTemplateBundle
}>

/**
 * Package-owned execution receipt adapter. Workflow engines call this contract
 * and never inspect another domain's private directory or receipt layout.
 */
export type DomainWorkflowExecutionReceiptProvider = Readonly<{
  id: string
  matches: (workflow: unknown) => boolean
  nodeTimeoutMs?: (workflow: unknown, node: unknown) => number
  workflowTimeoutMs?: (workflow: unknown) => number
  normalizeModelOutput?: (input: Readonly<{
    workflow: unknown
    node: unknown
    incoming: unknown
    responseText: string
  }>) => string
  hydrateAgentResult?: (input: Readonly<{
    workflow: unknown
    node: unknown
    text: string
    workspaceRoot: string
    incoming: unknown
    nodeStartedAt: string
  }>) => Promise<string>
  recoverAgentResult?: (input: Readonly<{
    workflow: unknown
    node: unknown
    incoming: unknown
    workspaceRoot: string
    nodeStartedAt: string
  }>) => Promise<string>
  writeRunReceipt?: (input: Readonly<{
    statePath: string
    workflow: unknown
    run: unknown
    workspaceRoot: string
  }>) => Promise<string>
}>

export function defineDomainWorkflowTemplateBuilder<Input>(
  builder: DomainWorkflowTemplateBuilder<Input>
): DomainWorkflowTemplateBuilder<Input> {
  if (!builder.templateId.trim() || typeof builder.build !== 'function') {
    throw new TypeError('Workflow template builders require an id and build function.')
  }
  return Object.freeze(builder)
}

export function defineDomainWorkflowExecutionReceiptProvider(
  provider: DomainWorkflowExecutionReceiptProvider
): DomainWorkflowExecutionReceiptProvider {
  if (!provider.id.trim() || typeof provider.matches !== 'function') {
    throw new TypeError('Workflow execution receipt providers require an id and matcher.')
  }
  return Object.freeze(provider)
}

export function isDomainWorkflowExecutionReceiptProvider(
  value: unknown
): value is DomainWorkflowExecutionReceiptProvider {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const provider = value as Partial<DomainWorkflowExecutionReceiptProvider>
  return typeof provider.id === 'string' && Boolean(provider.id.trim()) &&
    typeof provider.matches === 'function'
}
