import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createDatasetApiMcpServer } from './mcp-server.js'
import { createDatasetApiService } from './service.js'

test('exposes metadata and raw-data tools as the Dataset API contract', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-dataset-mcp-'))
  const server = createDatasetApiMcpServer(createDatasetApiService({
    workspaceRoot,
    fetchImpl: async (url) => {
      if (String(url).includes('/large')) {
        return new Response(JSON.stringify({ id: 'large-dataset', description: 'x'.repeat(70 * 1024) }), {
          headers: { 'content-type': 'application/json' }
        })
      }
      return String(url).includes('/metadata')
        ? new Response(JSON.stringify({ id: 'dataset-1' }), { headers: { 'content-type': 'application/json' } })
        : new Response('raw-bytes', { headers: { 'content-type': 'application/octet-stream' } })
    }
  }))
  const client = new Client({ name: 'dataset-api-test', version: '0.1.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  try {
    const listedTools = await client.listTools()
    assert.deepEqual(listedTools.tools.map((tool) => tool.name), [
      'dataset_api_catalog',
      'dataset_api_register_provider',
      'dataset_api_list',
      'dataset_api_register',
      'dataset_api_metadata',
      'dataset_api_raw_data'
    ])
    const registerProviderTool = listedTools.tools.find((tool) => tool.name === 'dataset_api_register_provider')
    assert.match(registerProviderTool?.description ?? '', /11 executable built-in provider presets/)
    assert.match(registerProviderTool?.description ?? '', /AlphaFold DB API/)
    assert.doesNotMatch(registerProviderTool?.description ?? '', /first supported providers/i)
    const catalog = await client.callTool({
      name: 'dataset_api_catalog',
      arguments: { category: 'structure-and-single-cell' }
    })
    assert.equal(catalog.isError, undefined)
    const catalogResult = catalog.structuredContent?.result as { providers: Array<{ id: string }> }
    assert.deepEqual(catalogResult.providers.map((provider) => provider.id), [
      'rcsb-pdb',
      'alphafold-db',
      'cellxgene-census'
    ])
    const providerRegistration = await client.callTool({
      name: 'dataset_api_register_provider',
      arguments: { providerId: 'uniprot' }
    })
    assert.equal(providerRegistration.isError, undefined)
    const providerResult = providerRegistration.structuredContent?.result as {
      source: { metadataEndpoint: string; rawDataEndpoint: string }
    }
    assert.equal(providerResult.source.metadataEndpoint, 'uniprotkb/{identifier}.json')
    assert.equal(providerResult.source.rawDataEndpoint, 'uniprotkb/{identifier}.fasta')
    await client.callTool({
      name: 'dataset_api_register',
      arguments: {
        id: 'example',
        baseUrl: 'https://example.com/api/',
        metadataEndpoint: 'datasets/{datasetId}/metadata',
        rawDataEndpoint: 'datasets/{datasetId}/raw'
      }
    })
    const metadata = await client.callTool({
      name: 'dataset_api_metadata',
      arguments: { sourceId: 'example', pathParameters: { datasetId: 'dataset-1' } }
    })
    assert.equal(metadata.isError, undefined)
    await client.callTool({
      name: 'dataset_api_register',
      arguments: {
        id: 'large',
        baseUrl: 'https://example.com/api/',
        metadataEndpoint: 'large',
        rawDataEndpoint: 'large-raw'
      }
    })
    const largeMetadata = await client.callTool({
      name: 'dataset_api_metadata',
      arguments: { sourceId: 'large' }
    })
    const largeResult = largeMetadata.structuredContent?.result as {
      metadataTruncated: boolean
      metadata: { description: string }
    }
    assert.equal(largeResult.metadataTruncated, true)
    assert.match(largeResult.metadata.description, /…$/)
    const rawData = await client.callTool({
      name: 'dataset_api_raw_data',
      arguments: {
        sourceId: 'example',
        pathParameters: { datasetId: 'dataset-1' },
        outputFileName: 'dataset-1.bin'
      }
    })
    assert.equal(rawData.isError, undefined)
  } finally {
    await client.close()
    await server.close()
    await rm(workspaceRoot, { recursive: true, force: true })
  }
})

test('returns structured network diagnostics and tells agents not to bypass with shell', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-dataset-mcp-error-'))
  const server = createDatasetApiMcpServer(createDatasetApiService({
    workspaceRoot,
    fetchImpl: async () => {
      const cause = Object.assign(new Error('temporary name resolution failure'), { code: 'EAI_AGAIN' })
      const error = new TypeError('fetch failed') as TypeError & { cause?: Error }
      error.cause = cause
      throw error
    }
  }))
  const client = new Client({ name: 'dataset-api-error-test', version: '0.1.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  try {
    await client.callTool({
      name: 'dataset_api_register',
      arguments: {
        id: 'diagnostic-db',
        baseUrl: 'https://data.example.org/',
        metadataEndpoint: 'metadata',
        rawDataEndpoint: 'raw'
      }
    })
    const result = await client.callTool({
      name: 'dataset_api_metadata',
      arguments: { sourceId: 'diagnostic-db', maxRetries: 0 }
    })
    assert.equal(result.isError, true)
    assert.match((result.content[0] as { text: string }).text, /do not bypass.*shell or curl/i)
    assert.deepEqual(result.structuredContent?.error, {
      code: 'DATASET_API_NETWORK_ERROR',
      message: "Dataset API request to 'diagnostic-db' (data.example.org) failed after 1 attempt: fetch failed; cause=EAI_AGAIN: temporary name resolution failure",
      retryable: true,
      sourceId: 'diagnostic-db',
      host: 'data.example.org',
      attempts: 1,
      causeCode: 'EAI_AGAIN',
      causeMessage: 'temporary name resolution failure'
    })
  } finally {
    await client.close()
    await server.close()
    await rm(workspaceRoot, { recursive: true, force: true })
  }
})
