import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createDatasetApiMcpServer } from './mcp-server.js'
import { createDatasetProcessingService } from './processing.js'
import { createDatasetApiService } from './service.js'

test('exposes metadata and raw-data tools as the Dataset API contract', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-dataset-mcp-'))
  const server = createDatasetApiMcpServer(createDatasetApiService({
    workspaceRoot,
    fetchImpl: async (url) => {
      if (String(url).includes('/large')) {
        return new Response(JSON.stringify({
          id: 'large-dataset',
          description: 'x'.repeat(70 * 1024),
          records: Array.from({ length: 500 }, (_, index) => ({
            id: `record-${index}`,
            sequence: 'M'.repeat(1_000),
            annotations: Array.from({ length: 20 }, (_entry, annotation) => ({ annotation }))
          }))
        }), {
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
      'dataset_api_raw_data',
      'dataset_prepare_plan',
      'dataset_profile',
      'dataset_filter',
      'dataset_select_columns',
      'dataset_transform',
      'dataset_deduplicate',
      'dataset_id_map',
      'dataset_id_map_provider',
      'dataset_join',
      'dataset_structure_profile',
      'dataset_structure_validate',
      'dataset_graph_organize',
      'dataset_validate',
      'dataset_publish'
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
    assert.ok(JSON.stringify(largeMetadata.structuredContent).length < 16 * 1024)
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

test('executes a confirmed conversation-driven processing plan through MCP tools', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-dataset-mcp-processing-'))
  const sourcePath = join(workspaceRoot, 'records.json')
  await writeFile(sourcePath, JSON.stringify([
    { id: 'a', organism: 'human', score: 3 },
    { id: 'b', organism: 'mouse', score: 5 }
  ]))
  const annotationsPath = join(workspaceRoot, 'annotations.json')
  await writeFile(annotationsPath, JSON.stringify([
    { record_id: 'a', pathway: 'R-HSA-TEST' },
    { record_id: 'z', pathway: 'R-HSA-UNMATCHED' }
  ]))
  const server = createDatasetApiMcpServer(
    createDatasetApiService({ workspaceRoot }),
    createDatasetProcessingService({ workspaceRoot })
  )
  const client = new Client({ name: 'dataset-processing-test', version: '0.1.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  try {
    const planCall = await client.callTool({
      name: 'dataset_prepare_plan',
      arguments: {
        objective: 'Keep human records.',
        operations: [
          { tool: 'dataset_filter', description: 'Keep human rows.' },
          { tool: 'dataset_transform', description: 'Normalize the organism field.' },
          { tool: 'dataset_id_map', description: 'Map record identifiers to pathways.' },
          { tool: 'dataset_join', description: 'Join pathway annotations.' },
          { tool: 'dataset_publish', description: 'Publish the result.' }
        ],
        outputs: [{ name: 'human.json', format: 'json' }],
        confirmedByUser: true
      }
    })
    assert.equal(planCall.isError, undefined)
    const planId = ((planCall.structuredContent?.result as {
      plan: { planId: string }
    }).plan.planId)
    const filterCall = await client.callTool({
      name: 'dataset_filter',
      arguments: {
        planId,
        inputArtifact: sourcePath,
        conditions: [{ field: 'organism', operator: 'equals', value: 'human' }],
        outputFileName: 'human.json'
      }
    })
    assert.equal(filterCall.isError, undefined)
    const filterResult = filterCall.structuredContent?.result as {
      artifact: { path: string; manifestPath: string }
      counts: { outputRecords: number }
    }
    assert.equal(filterResult.counts.outputRecords, 1)
    assert.deepEqual(JSON.parse(await readFile(filterResult.artifact.path, 'utf8')), [
      { id: 'a', organism: 'human', score: 3 }
    ])
    assert.equal(JSON.parse(await readFile(filterResult.artifact.manifestPath, 'utf8')).operation, 'dataset_filter')
    const transformCall = await client.callTool({
      name: 'dataset_transform',
      arguments: {
        planId,
        inputArtifact: filterResult.artifact.path,
        operations: [{ operation: 'uppercase', field: 'organism', target: 'organism_standardized' }],
        outputFileName: 'human-standardized.json'
      }
    })
    assert.equal(transformCall.isError, undefined)
    const transformResult = transformCall.structuredContent?.result as { artifact: { path: string } }
    const idMapCall = await client.callTool({
      name: 'dataset_id_map',
      arguments: {
        planId,
        inputArtifact: transformResult.artifact.path,
        mappingArtifact: annotationsPath,
        inputField: 'id',
        mappingFromField: 'record_id',
        mappingToField: 'pathway',
        outputField: 'pathway_id',
        outputFileName: 'human-mapped.json'
      }
    })
    assert.equal(idMapCall.isError, undefined)
    const idMapResult = idMapCall.structuredContent?.result as {
      counts: { mappedRecords: number; unmatchedRecords: number }
    }
    assert.equal(idMapResult.counts.mappedRecords, 1)
    assert.equal(idMapResult.counts.unmatchedRecords, 0)
    const joinCall = await client.callTool({
      name: 'dataset_join',
      arguments: {
        planId,
        leftArtifact: transformResult.artifact.path,
        rightArtifact: annotationsPath,
        keys: [{ left: 'id', right: 'record_id' }],
        joinType: 'left',
        rightPrefix: 'annotation_',
        outputFileName: 'human-annotated.json'
      }
    })
    assert.equal(joinCall.isError, undefined)
    const joinResult = joinCall.structuredContent?.result as {
      artifact: { path: string }
      unmatchedArtifacts: { right: { path: string } }
      counts: { outputRecords: number; unmatchedRightRecords: number }
    }
    assert.equal(joinResult.counts.outputRecords, 1)
    assert.equal(joinResult.counts.unmatchedRightRecords, 1)
    assert.deepEqual(JSON.parse(await readFile(joinResult.artifact.path, 'utf8')), [{
      id: 'a',
      organism: 'human',
      score: 3,
      organism_standardized: 'HUMAN',
      annotation_record_id: 'a',
      annotation_pathway: 'R-HSA-TEST'
    }])
    assert.equal(JSON.parse(await readFile(joinResult.unmatchedArtifacts.right.path, 'utf8'))[0].record_id, 'z')
  } finally {
    await client.close()
    await server.close()
    await rm(workspaceRoot, { recursive: true, force: true })
  }
})

test('propagates API request provenance through processing and publication manifests', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-dataset-mcp-provenance-'))
  const server = createDatasetApiMcpServer(
    createDatasetApiService({
      workspaceRoot,
      fetchImpl: async () => new Response(JSON.stringify([
        { accession: 'P04637', reviewed: true },
        { accession: 'Q9TEST', reviewed: false }
      ]), { headers: { 'content-type': 'application/json' } })
    }),
    createDatasetProcessingService({ workspaceRoot })
  )
  const client = new Client({ name: 'dataset-provenance-test', version: '0.3.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  const call = async (name: string, args: Record<string, unknown>) => {
    const response = await client.callTool({ name, arguments: args })
    assert.equal(response.isError, undefined, `${name} failed`)
    return response.structuredContent?.result as Record<string, any>
  }
  try {
    await call('dataset_api_register', {
      id: 'provenance-db',
      baseUrl: 'https://data.example.org/',
      metadataEndpoint: 'metadata',
      rawDataEndpoint: 'proteins'
    })
    const raw = await call('dataset_api_raw_data', {
      sourceId: 'provenance-db',
      outputFileName: 'proteins.json',
      expectedFormat: 'json'
    })
    const prepared = await call('dataset_prepare_plan', {
      objective: 'Publish reviewed proteins with source provenance.',
      sources: [{ providerId: 'provenance-db', purpose: 'Download protein records.' }],
      operations: [
        { tool: 'dataset_filter', description: 'Keep reviewed records.' },
        { tool: 'dataset_validate', description: 'Validate accessions.' },
        { tool: 'dataset_publish', description: 'Publish the prepared dataset.' }
      ],
      outputs: [{ name: 'reviewed.json', format: 'json' }],
      confirmedByUser: true
    })
    const planId = prepared.plan.planId as string
    const filtered = await call('dataset_filter', {
      planId,
      inputArtifact: raw.artifact.path,
      conditions: [{ field: 'reviewed', operator: 'equals', value: true }],
      outputFileName: 'reviewed.json'
    })
    const validation = await call('dataset_validate', {
      inputArtifact: filtered.artifact.path,
      rules: [{ field: 'accession', required: true }],
      minRecords: 1
    })
    const published = await call('dataset_publish', {
      planId,
      name: 'reviewed-proteins',
      artifacts: [filtered.artifact.path, validation.artifact.path]
    })
    assert.equal(published.publication.artifactCount, 2)
    assert.equal(published.quality.status, 'passed')
    assert.ok(JSON.stringify(published).length < 24 * 1024)
    const filterManifest = JSON.parse(await readFile(filtered.artifact.manifestPath, 'utf8'))
    assert.equal(filterManifest.origins[0].source.id, 'provenance-db')
    assert.equal(filterManifest.origins[0].request.url, 'https://data.example.org/proteins')
    const publicationManifest = JSON.parse(await readFile(published.publication.manifestPath, 'utf8'))
    assert.equal(publicationManifest.provenance.origins.length, 1)
    assert.equal(publicationManifest.provenance.origins[0].source.id, 'provenance-db')
  } finally {
    await client.close()
    await server.close()
    await rm(workspaceRoot, { recursive: true, force: true })
  }
})
