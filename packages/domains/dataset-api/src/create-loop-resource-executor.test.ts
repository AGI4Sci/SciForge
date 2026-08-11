import assert from 'node:assert/strict'
import test from 'node:test'
import type { DomainMainSystemCapabilityInvoker } from '@sciforge/domain-sdk/host'
import { createDatasetApiCreateLoopResourceExecutor } from './create-loop-resource-executor.js'

test('maps resource operations to fixed Dataset API capability contracts', async () => {
  const calls: Array<{
    actionId: string
    effect: string
    input: unknown
    workspaceId?: string
    idempotencyKey?: string
  }> = []
  const invoke = (async (contract, input, options) => {
    calls.push({
      actionId: contract.actionId,
      effect: contract.effect,
      input,
      workspaceId: options?.workspaceId,
      idempotencyKey: options?.idempotencyKey
    })
    return {
      datasetApi: {
        actionId: contract.actionId,
        success: true,
        result: {
          artifact: { path: '/workspace/.sciforge/datasets/raw/uniprot.json' },
          source: { id: 'uniprot' }
        }
      }
    }
  }) as DomainMainSystemCapabilityInvoker['invoke']
  const executor = createDatasetApiCreateLoopResourceExecutor({ invoke })

  await assert.doesNotReject(executor.execute({
    providerId: 'dataset-api',
    resourceId: 'uniprot',
    operationId: 'metadata',
    input: { sourceId: 'uniprot', pathParameters: { identifier: 'P04637' } },
    workspaceRoot: '/workspace',
    idempotencyKey: 'resource-run-1'
  }))
  assert.deepEqual(calls, [{
    actionId: 'dataset-api.metadata',
    effect: 'workspace-write',
    input: { sourceId: 'uniprot', pathParameters: { identifier: 'P04637' } },
    workspaceId: '/workspace',
    idempotencyKey: 'resource-run-1'
  }])
})

test('rejects unknown operations before invoking the capability broker', async () => {
  const invoke = (() => {
    throw new Error('must not invoke')
  }) as DomainMainSystemCapabilityInvoker['invoke']
  const executor = createDatasetApiCreateLoopResourceExecutor({ invoke })

  await assert.rejects(executor.execute({
    providerId: 'dataset-api',
    resourceId: 'uniprot',
    operationId: 'arbitrary-capability',
    input: {},
    workspaceRoot: '/workspace',
    idempotencyKey: 'resource-run-2'
  }), /is not supported/)
})

test('binds metadata inputs to the selected resource', async () => {
  const invoke = (() => {
    throw new Error('must not invoke')
  }) as DomainMainSystemCapabilityInvoker['invoke']
  const executor = createDatasetApiCreateLoopResourceExecutor({ invoke })

  await assert.rejects(executor.execute({
    providerId: 'dataset-api',
    resourceId: 'uniprot',
    operationId: 'metadata',
    input: { sourceId: 'ensembl', pathParameters: { identifier: 'P04637' } },
    workspaceRoot: '/workspace',
    idempotencyKey: 'resource-run-3'
  }), /cannot execute an input for source 'ensembl'/)
})
