import { describe, expect, it, vi } from 'vitest'
import type { DomainRendererCapabilityInvoker } from '@sciforge/domain-sdk/host'
import { datasetPreparePlanWireSchema } from '../contract.js'
import {
  confirmDatasetPlan,
  createDatasetApiCreateLoopResourceProvider,
  readDatasetExecutionReceipt,
  readDatasetPlanDraft
} from './CreateLoopDatasetResourceProvider.js'

describe('Create Loop Dataset API resource provider', () => {
  it('discovers workspace sources and creates an executable resource node', async () => {
    const invokeMock = vi.fn(async (contract: { actionId: string }) => {
      if (contract.actionId === 'dataset-api.ensure-providers') {
        return {
          datasetApi: {
            actionId: 'dataset-api.ensure-providers' as const,
            success: true as const,
            result: { sources: [], addedSourceIds: [], preservedSourceIds: [] }
          }
        }
      }
      return {
        datasetApi: {
          actionId: 'dataset-api.list' as const,
          success: true as const,
          result: {
            sources: [{
              id: 'uniprot',
              name: 'UniProt REST',
              description: 'Protein records.',
              baseUrl: 'https://rest.uniprot.org/',
              metadataEndpoint: 'uniprotkb/{identifier}.json',
              rawDataEndpoint: 'uniprotkb/{identifier}.fasta',
              usageExamples: {
                metadata: {
                  sourceId: 'uniprot',
                  pathParameters: { identifier: 'P04637' }
                },
                rawData: {
                  sourceId: 'uniprot',
                  pathParameters: { identifier: 'P04637' },
                  outputFileName: 'P04637.fasta',
                  expectedFormat: 'fasta'
                }
              }
            }]
          }
        }
      }
    })
    const invoker: DomainRendererCapabilityInvoker = {
      invoke: invokeMock as unknown as DomainRendererCapabilityInvoker['invoke'],
      observe: async () => { throw new Error('not used') }
    }
    const provider = createDatasetApiCreateLoopResourceProvider(invoker)

    const resources = await provider.loadResources('/workspace/project')
    expect(invokeMock).toHaveBeenCalledWith(
      expect.objectContaining({ actionId: 'dataset-api.ensure-providers', effect: 'workspace-write' }),
      {},
      { workspaceId: '/workspace/project' }
    )
    expect(invokeMock).toHaveBeenCalledWith(
      expect.objectContaining({ actionId: 'dataset-api.list', effect: 'read' }),
      {},
      { workspaceId: '/workspace/project' }
    )
    expect(invokeMock).toHaveBeenCalledTimes(2)
    expect(resources).toHaveLength(3)
    expect(resources[0]).toMatchObject({
      id: 'uniprot',
      name: 'UniProt REST',
      detail: 'https://rest.uniprot.org/',
      paletteVisibility: 'hidden'
    })
    expect(resources[1]).toMatchObject({
      id: 'dataset-query',
      nameKey: 'datasetResourceQuery',
      role: 'operation'
    })
    expect(resources[2]).toMatchObject({
      id: 'dataset-processing-plan',
      role: 'operation'
    })

    const node = provider.createNode(resources[0]!, { x: 120, y: 240 })
    expect(node).toMatchObject({
      type: 'resource',
      name: 'UniProt REST',
      position: { x: 120, y: 240 },
      config: {
        providerId: 'dataset-api',
        resourceId: 'uniprot',
        operationId: 'metadata',
        actionId: 'dataset-api.metadata',
        effect: 'workspace-write'
      }
    })
    expect(JSON.parse(node.config.inputTemplate)).toEqual({
      sourceId: 'uniprot',
      responseMode: 'summary',
      outputFileName: 'uniprot-metadata.json',
      pathParameters: { identifier: 'P04637' }
    })

    const queryNode = provider.createNode(resources[1]!, { x: 300, y: 240 })
    expect(queryNode).toMatchObject({
      name: 'Query dataset',
      config: {
        resourceId: 'uniprot',
        resourceName: 'UniProt REST',
        actionId: 'dataset-api.metadata'
      }
    })
    expect(JSON.parse(queryNode.config.inputTemplate)).toMatchObject({
      sourceId: 'uniprot',
      pathParameters: { identifier: 'P04637' }
    })
  })

  it('automatically registers presets and exposes query and plan operations', async () => {
    let registered = false
    const invokeMock = vi.fn(async (contract: { actionId: string }) => {
      if (contract.actionId === 'dataset-api.ensure-providers') {
        registered = true
        return {
          datasetApi: {
            actionId: 'dataset-api.ensure-providers' as const,
            success: true as const,
            result: { sources: [], addedSourceIds: ['string'], preservedSourceIds: [] }
          }
        }
      }
      return {
        datasetApi: {
          actionId: 'dataset-api.list' as const,
          success: true as const,
          result: {
            sources: registered ? [{
              id: 'string',
              name: 'STRING API',
              baseUrl: 'https://string-db.org/api/',
              metadataEndpoint: 'json/get_string_ids',
              rawDataEndpoint: 'tsv/network',
              usageExamples: {
                metadata: { sourceId: 'string', query: { identifiers: 'TP53', species: 9606 } },
                rawData: {
                  sourceId: 'string',
                  query: { identifiers: 'TP53\rBRCA1', species: 9606 },
                  outputFileName: 'string-TP53-BRCA1.tsv',
                  expectedFormat: 'text'
                }
              }
            }] : []
          }
        }
      }
    })
    const invoker: DomainRendererCapabilityInvoker = {
      invoke: invokeMock as unknown as DomainRendererCapabilityInvoker['invoke'],
      observe: async () => { throw new Error('not used') }
    }
    const provider = createDatasetApiCreateLoopResourceProvider(invoker)

    const resources = await provider.loadResources('/workspace/project')
    expect(resources).toHaveLength(3)
    expect(resources[0]).toMatchObject({
      id: 'string',
      role: 'data-source',
      paletteVisibility: 'hidden'
    })
    expect(resources[0]).toMatchObject({
      id: 'string',
      name: 'STRING API',
      detail: 'https://string-db.org/api/'
    })

    const node = provider.createNode(resources[0]!, { x: 100, y: 200 })
    expect(JSON.parse(node.config.inputTemplate)).toEqual({
      sourceId: 'string',
      responseMode: 'summary',
      outputFileName: 'string-metadata.json',
      query: { identifiers: 'TP53', species: 9606 }
    })

    expect(resources[1]).toMatchObject({ id: 'dataset-query', role: 'operation' })
    const planNode = provider.createNode(resources[2]!, { x: 300, y: 200 })
    expect(planNode.config).toMatchObject({
      resourceId: 'dataset-processing-plan',
      operationId: 'prepare-plan',
      actionId: 'dataset-api.prepare-plan'
    })
    const planInput = JSON.parse(planNode.config.inputTemplate)
    expect(planInput).toMatchObject({ operations: [{ tool: 'dataset_profile' }] })
    expect(planInput).not.toHaveProperty('confirmedByUser')
    expect(() => datasetPreparePlanWireSchema.parse(planInput)).not.toThrow()
  })

  it('confirms a prepared plan through explicit renderer approval', async () => {
    const invokeMock = vi.fn(async () => ({
      datasetApi: {
        actionId: 'dataset-api.confirm-plan' as const,
        success: true as const,
        result: { planId: 'plan-123', status: 'confirmed' }
      }
    }))
    const invoker: DomainRendererCapabilityInvoker = {
      invoke: invokeMock as unknown as DomainRendererCapabilityInvoker['invoke'],
      observe: async () => { throw new Error('not used') }
    }

    await expect(confirmDatasetPlan(invoker, '/workspace/project', 'plan-123')).resolves.toEqual({
      planId: 'plan-123',
      status: 'confirmed'
    })
    expect(invokeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actionId: 'dataset-api.confirm-plan',
        effect: 'external-write'
      }),
      { planId: 'plan-123' },
      {
        workspaceId: '/workspace/project',
        approval: { mode: 'confirmation' }
      }
    )
  })

  it('parses draft and canonical execution receipts', () => {
    expect(readDatasetPlanDraft(JSON.stringify({
      datasetApi: { result: { planId: 'plan-123', status: 'draft' } }
    }))).toEqual({ planId: 'plan-123', status: 'draft' })

    expect(readDatasetExecutionReceipt(JSON.stringify({
      datasetApi: {
        result: {
          execution: {
            planId: 'plan-123',
            runId: 'run-456',
            status: 'succeeded',
            completedSteps: 2,
            failedSteps: 0,
            totalSteps: 2,
            steps: [
              { status: 'succeeded' },
              { status: 'succeeded' }
            ]
          }
        }
      }
    }))).toEqual({
      planId: 'plan-123',
      runId: 'run-456',
      completed: 2,
      total: 2,
      failed: false
    })
  })
})
