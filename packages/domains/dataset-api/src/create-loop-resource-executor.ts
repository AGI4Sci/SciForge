import type {
  DomainCapabilityContract,
  DomainMainSystemCapabilityInvoker
} from '@sciforge/domain-sdk/host'
import type { DomainPackageJsonValue } from '@sciforge/domain-sdk/contract'
import type { CreateLoopResourceExecutor } from '@sciforge/domain-create-loop/resource-executor'
import {
  DATASET_API_CAPABILITY_IDS,
  datasetApiCapabilityOutputSchema,
  datasetApiMetadataInputSchema,
  datasetApiRawDataInputSchema,
  datasetExecutePlanInputSchema,
  datasetPreparePlanWireSchema,
  datasetResumePlanInputSchema
} from './contract.js'

export const DATASET_API_CREATE_LOOP_RESOURCE_EXECUTOR_ID = 'dataset-api' as const

const operationContracts = Object.freeze({
  metadata: Object.freeze({
    actionId: DATASET_API_CAPABILITY_IDS.metadata,
    effect: 'workspace-write' as const,
    inputSchema: datasetApiMetadataInputSchema.omit({ workspaceRoot: true }),
    outputSchema: datasetApiCapabilityOutputSchema
  }),
  'raw-data': Object.freeze({
    actionId: DATASET_API_CAPABILITY_IDS.rawData,
    effect: 'workspace-write' as const,
    inputSchema: datasetApiRawDataInputSchema.omit({ workspaceRoot: true }),
    outputSchema: datasetApiCapabilityOutputSchema
  }),
  'prepare-plan': Object.freeze({
    actionId: DATASET_API_CAPABILITY_IDS.preparePlan,
    effect: 'workspace-write' as const,
    inputSchema: datasetPreparePlanWireSchema,
    outputSchema: datasetApiCapabilityOutputSchema
  }),
  'execute-plan': Object.freeze({
    actionId: DATASET_API_CAPABILITY_IDS.executePlan,
    effect: 'workspace-write' as const,
    inputSchema: datasetExecutePlanInputSchema.omit({ workspaceRoot: true }),
    outputSchema: datasetApiCapabilityOutputSchema
  }),
  'resume-plan': Object.freeze({
    actionId: DATASET_API_CAPABILITY_IDS.resumePlan,
    effect: 'workspace-write' as const,
    inputSchema: datasetResumePlanInputSchema.omit({ workspaceRoot: true }),
    outputSchema: datasetApiCapabilityOutputSchema
  })
})

export function createDatasetApiCreateLoopResourceExecutor(
  capabilities?: DomainMainSystemCapabilityInvoker
): CreateLoopResourceExecutor {
  return Object.freeze({
    id: DATASET_API_CREATE_LOOP_RESOURCE_EXECUTOR_ID,
    execute: async (request) => {
      if (request.providerId !== DATASET_API_CREATE_LOOP_RESOURCE_EXECUTOR_ID) {
        throw new Error(`Dataset API cannot execute provider '${request.providerId}'.`)
      }
      if (!(request.operationId in operationContracts)) {
        throw new Error(`Dataset API resource operation '${request.operationId}' is not supported.`)
      }
      if (!capabilities) {
        throw new Error('Dataset API resource execution requires the Host capability broker.')
      }
      assertResourceBinding(request.operationId, request.resourceId, request.input)
      const output = await invokeDatasetApiOperation(
        capabilities,
        request.operationId as keyof typeof operationContracts,
        request.input,
        request.workspaceRoot,
        request.idempotencyKey
      )
      const parsed = datasetApiCapabilityOutputSchema.parse(output)
      return {
        result: parsed.datasetApi.result,
        artifactPaths: collectArtifactPaths(parsed.datasetApi.result),
        message: `${request.resourceId} · ${request.operationId}`
      }
    }
  })
}

function assertResourceBinding(
  operationId: string,
  resourceId: string,
  input: DomainPackageJsonValue
): void {
  if (operationId !== 'metadata' && operationId !== 'raw-data') return
  const inputSourceId = input && typeof input === 'object' && !Array.isArray(input)
    ? input.sourceId
    : undefined
  if (inputSourceId !== resourceId) {
    throw new Error(
      `Dataset API resource '${resourceId}' cannot execute an input for source '${String(inputSourceId ?? '')}'.`
    )
  }
}

async function invokeDatasetApiOperation(
  capabilities: DomainMainSystemCapabilityInvoker,
  operationId: keyof typeof operationContracts,
  rawInput: unknown,
  workspaceRoot: string,
  idempotencyKey: string
): Promise<unknown> {
  switch (operationId) {
    case 'metadata':
      return invokeOperation(capabilities, operationContracts.metadata, rawInput, workspaceRoot, idempotencyKey)
    case 'raw-data':
      return invokeOperation(capabilities, operationContracts['raw-data'], rawInput, workspaceRoot, idempotencyKey)
    case 'prepare-plan':
      return invokeOperation(capabilities, operationContracts['prepare-plan'], rawInput, workspaceRoot, idempotencyKey)
    case 'execute-plan':
      return invokeOperation(capabilities, operationContracts['execute-plan'], rawInput, workspaceRoot, idempotencyKey)
    case 'resume-plan':
      return invokeOperation(capabilities, operationContracts['resume-plan'], rawInput, workspaceRoot, idempotencyKey)
  }
}

async function invokeOperation<TInput, TOutput>(
  capabilities: DomainMainSystemCapabilityInvoker,
  contract: DomainCapabilityContract<TInput, TOutput>,
  rawInput: unknown,
  workspaceRoot: string,
  idempotencyKey: string
): Promise<TOutput> {
  const input = contract.inputSchema.parse(rawInput)
  return capabilities.invoke(contract, input, { workspaceId: workspaceRoot, idempotencyKey })
}

function collectArtifactPaths(value: DomainPackageJsonValue): string[] {
  const paths = new Set<string>()
  const visit = (entry: DomainPackageJsonValue, depth: number): void => {
    if (depth > 10 || paths.size >= 1_000 || entry === null) return
    if (Array.isArray(entry)) {
      for (const item of entry) visit(item, depth + 1)
      return
    }
    if (typeof entry !== 'object') return
    for (const [key, item] of Object.entries(entry)) {
      if (key === 'path' && typeof item === 'string' && item.startsWith('/')) {
        paths.add(item)
      } else {
        visit(item, depth + 1)
      }
    }
  }
  visit(value, 0)
  return [...paths]
}
