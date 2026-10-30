import { z } from 'zod'
import {
  domainPackageJsonValueSchema,
  type DomainPackageJsonValue
} from '@sciforge/domain-sdk/contract'
import {
  MAIN_EXTENSION_CONTRIBUTION_KIND,
  type DomainMainContributionHost
} from '@sciforge/domain-sdk/host'

export const CREATE_LOOP_RESOURCE_EXECUTOR_KIND =
  MAIN_EXTENSION_CONTRIBUTION_KIND
export const CREATE_LOOP_RESOURCE_EXECUTOR_LOCATION =
  'create-loop.resource-executor' as const

export const createLoopResourceExecutorContractSchema = z.object({
  location: z.literal(CREATE_LOOP_RESOURCE_EXECUTOR_LOCATION),
  providerId: z.string().trim().min(1).max(160)
}).strict()

export const createLoopResourceExecutionResultSchema = z.object({
  result: domainPackageJsonValueSchema,
  artifactPaths: z.array(z.string().trim().min(1).max(4_096)).max(1_000).optional(),
  message: z.string().trim().min(1).max(1_000).optional()
}).strict()

export type CreateLoopResourceExecutionInput = Readonly<{
  providerId: string
  resourceId: string
  operationId: string
  input: DomainPackageJsonValue
  workspaceRoot: string
  idempotencyKey: string
}>

export type CreateLoopResourceExecutionResult = z.infer<
  typeof createLoopResourceExecutionResultSchema
>

export type CreateLoopResourceExecutor = Readonly<{
  id: string
  execute: (
    input: CreateLoopResourceExecutionInput
  ) => Promise<CreateLoopResourceExecutionResult>
}>

export function isCreateLoopResourceExecutor(
  value: unknown
): value is CreateLoopResourceExecutor {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Partial<CreateLoopResourceExecutor>
  return typeof candidate.id === 'string' && candidate.id.trim().length > 0 &&
    typeof candidate.execute === 'function'
}

export function collectCreateLoopResourceExecutors(
  host?: DomainMainContributionHost
): readonly CreateLoopResourceExecutor[] {
  const executors: CreateLoopResourceExecutor[] = []
  const ids = new Set<string>()
  for (const contribution of host?.list(CREATE_LOOP_RESOURCE_EXECUTOR_KIND) ?? []) {
    if (
      !contribution.contract ||
      typeof contribution.contract !== 'object' ||
      Array.isArray(contribution.contract) ||
      contribution.contract.location !== CREATE_LOOP_RESOURCE_EXECUTOR_LOCATION
    ) {
      continue
    }
    const contract = createLoopResourceExecutorContractSchema.safeParse(
      contribution.contract
    )
    if (!contract.success) {
      throw new TypeError(
        `Create Loop resource executor ${contribution.id} has an invalid contract.`
      )
    }
    if (
      !isCreateLoopResourceExecutor(contribution.value) ||
      contribution.value.id !== contract.data.providerId
    ) {
      throw new TypeError(
        `Create Loop resource executor ${contribution.id} does not match provider ${contract.data.providerId}.`
      )
    }
    if (ids.has(contribution.value.id)) {
      throw new TypeError(
        `Create Loop resource executor ${contribution.value.id} is duplicated.`
      )
    }
    ids.add(contribution.value.id)
    executors.push(contribution.value)
  }
  return Object.freeze(executors)
}
