import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { EXECUTABLE_DATASET_PROVIDER_IDS, executableDatasetProviderIdSchema } from './contract.js'
import { EXECUTABLE_DATASET_PROVIDER_PRESETS } from './provider-presets.js'
import { createDatasetApiService } from './service.js'

test('keeps executable provider schemas and presets in sync', () => {
  assert.deepEqual(Object.keys(EXECUTABLE_DATASET_PROVIDER_PRESETS), [...EXECUTABLE_DATASET_PROVIDER_IDS])
  for (const providerId of EXECUTABLE_DATASET_PROVIDER_IDS) {
    assert.equal(executableDatasetProviderIdSchema.parse(providerId), providerId)
    assert.equal(EXECUTABLE_DATASET_PROVIDER_PRESETS[providerId].source.id, providerId)
  }
})

test('registers a database and reads its metadata endpoint', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-dataset-api-'))
  const server = createServer((request, response) => {
    assert.equal(request.headers.authorization, 'Bearer test-token')
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    assert.equal(url.pathname, '/api/datasets/ds-42/metadata')
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ id: 'ds-42', title: 'Example dataset', files: 1 }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  try {
    const service = createDatasetApiService({ workspaceRoot, env: { DATASET_TOKEN: 'test-token' } })
    await service.register({
      id: 'example',
      name: 'Example database',
      baseUrl: `http://127.0.0.1:${address.port}/api/`,
      metadataEndpoint: 'datasets/{datasetId}/metadata',
      rawDataEndpoint: 'datasets/{datasetId}/raw/{assetId}',
      auth: { type: 'bearer', envVar: 'DATASET_TOKEN' }
    })
    const metadata = await service.metadata({
      sourceId: 'example',
      pathParameters: { datasetId: 'ds-42' }
    })
    assert.deepEqual(metadata.metadata, { id: 'ds-42', title: 'Example dataset', files: 1 })
    const listed = await service.list({})
    assert.equal(listed.sources[0]?.metadataEndpoint, 'datasets/{datasetId}/metadata')
    assert.equal(listed.sources[0]?.auth?.configured, true)
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    await rm(workspaceRoot, { recursive: true, force: true })
  }
})

test('streams raw data to the workspace cache with a checksum and byte range', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-dataset-raw-'))
  const payload = Buffer.from('raw-dataset-payload')
  const service = createDatasetApiService({
    workspaceRoot,
    fetchImpl: async (_url, init) => {
      assert.equal(new Headers(init?.headers).get('range'), 'bytes=0-18')
      return new Response(payload, {
        status: 206,
        headers: {
          'content-type': 'application/octet-stream',
          'content-range': 'bytes 0-18/19',
          'content-disposition': 'attachment; filename="sample.dat"'
        }
      })
    }
  })
  try {
    await service.register({
      id: 'raw-db',
      baseUrl: 'https://example.com/api/',
      metadataEndpoint: 'datasets/{datasetId}/metadata',
      rawDataEndpoint: 'datasets/{datasetId}/raw/{assetId}'
    })
    const result = await service.rawData({
      sourceId: 'raw-db',
      pathParameters: { datasetId: 'ds-1', assetId: 'file-1' },
      range: { start: 0, end: 18 }
    })
    assert.equal(result.response.rangeSatisfied, true)
    assert.equal(result.response.bytes, payload.byteLength)
    assert.equal(await readFile(result.artifact.path, 'utf8'), payload.toString())
    assert.match(result.artifact.sha256, /^[a-f0-9]{64}$/)
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true })
  }
})

test('registers and accesses executable biology provider presets', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-dataset-provider-'))
  const requestedUrls: string[] = []
  const service = createDatasetApiService({
    workspaceRoot,
    fetchImpl: async (url) => {
      requestedUrls.push(String(url))
      return String(url).endsWith('.json')
        ? new Response(JSON.stringify({ primaryAccession: 'P04637' }), {
          headers: { 'content-type': 'application/json' }
        })
        : new Response('>sp|P04637|P53_HUMAN\nMEEPQSDPSV\n', {
          headers: { 'content-type': 'text/plain; format=fasta' }
        })
    }
  })
  try {
    const registration = await service.registerProvider({ providerId: 'uniprot' })
    assert.equal(registration.source.id, 'uniprot')
    assert.deepEqual(registration.usage.metadata, {
      sourceId: 'uniprot',
      pathParameters: { identifier: 'P04637' }
    })
    const metadata = await service.metadata({
      sourceId: 'uniprot',
      pathParameters: { accession: 'P04637' }
    })
    assert.deepEqual(metadata.metadata, { primaryAccession: 'P04637' })
    const raw = await service.rawData({
      sourceId: 'uniprot',
      pathParameters: { accession: 'P04637' },
      outputFileName: 'P04637.fasta'
    })
    assert.equal(await readFile(raw.artifact.path, 'utf8'), '>sp|P04637|P53_HUMAN\nMEEPQSDPSV\n')
    assert.deepEqual(requestedUrls, [
      'https://rest.uniprot.org/uniprotkb/P04637.json',
      'https://rest.uniprot.org/uniprotkb/P04637.fasta'
    ])
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true })
  }
})

test('retries transient network failures and preserves the underlying diagnostic', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-dataset-retry-'))
  let attempts = 0
  const service = createDatasetApiService({
    workspaceRoot,
    fetchImpl: async () => {
      attempts += 1
      if (attempts === 1) {
        const cause = Object.assign(new Error('temporary DNS failure'), { code: 'EAI_AGAIN' })
        const error = new TypeError('fetch failed') as TypeError & { cause?: Error }
        error.cause = cause
        throw error
      }
      return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } })
    }
  })
  try {
    await service.register({
      id: 'retry-db',
      baseUrl: 'https://example.com/',
      metadataEndpoint: 'metadata',
      rawDataEndpoint: 'raw'
    })
    const result = await service.metadata({ sourceId: 'retry-db', maxRetries: 1 })
    assert.deepEqual(result.metadata, { ok: true })
    assert.equal(attempts, 2)
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true })
  }
})

test('reports source, host, attempts, and nested network cause when retries are exhausted', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-dataset-diagnostic-'))
  const service = createDatasetApiService({
    workspaceRoot,
    fetchImpl: async () => {
      const cause = Object.assign(new Error('getaddrinfo ENOTFOUND data.example.org'), { code: 'ENOTFOUND' })
      const error = new TypeError('fetch failed') as TypeError & { cause?: Error }
      error.cause = cause
      throw error
    }
  })
  try {
    await service.register({
      id: 'diagnostic-db',
      baseUrl: 'https://data.example.org/',
      metadataEndpoint: 'metadata',
      rawDataEndpoint: 'raw'
    })
    await assert.rejects(
      service.metadata({ sourceId: 'diagnostic-db', maxRetries: 0 }),
      /diagnostic-db.*data\.example\.org.*1 attempt.*ENOTFOUND/s
    )
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true })
  }
})

test('resolves an NCBI Gene ID to a real genomic FASTA sequence', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-dataset-ncbi-gene-'))
  const requestedUrls: string[] = []
  const service = createDatasetApiService({
    workspaceRoot,
    fetchImpl: async (url) => {
      requestedUrls.push(String(url))
      if (String(url).includes('esummary.fcgi')) {
        return new Response(JSON.stringify({
          result: {
            '7157': { genomicinfo: [{ chraccver: 'NC_000017.11', chrstart: 7687490, chrstop: 7668421 }] }
          }
        }), { headers: { 'content-type': 'application/json' } })
      }
      return new Response('>NC_000017.11:7668422-7687491 TP53 genomic region\nACGT\n', {
        headers: { 'content-type': 'text/plain; format=fasta' }
      })
    }
  })
  try {
    await service.registerProvider({ providerId: 'ncbi-eutils' })
    const result = await service.rawData({
      sourceId: 'ncbi-eutils',
      query: { db: 'gene', id: '7157', rettype: 'fasta', retmode: 'text' },
      outputFileName: 'ncbi_gene_7157.fasta',
      expectedFormat: 'fasta'
    })
    assert.equal(result.artifact.format, 'fasta')
    assert.match(await readFile(result.artifact.path, 'utf8'), /^>NC_000017\.11/)
    assert.match(requestedUrls[1] ?? '', /db=nuccore/)
    assert.match(requestedUrls[1] ?? '', /seq_start=7668422/)
    assert.match(requestedUrls[1] ?? '', /seq_stop=7687491/)
    assert.match(requestedUrls[1] ?? '', /strand=2/)
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true })
  }
})

test('rejects a mislabeled FASTA response and removes the temporary artifact', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-dataset-format-'))
  const service = createDatasetApiService({
    workspaceRoot,
    fetchImpl: async () => new Response('This is a gene report, not FASTA.', {
      headers: { 'content-type': 'text/plain' }
    })
  })
  try {
    await service.register({
      id: 'format-db',
      baseUrl: 'https://example.com/',
      metadataEndpoint: 'metadata',
      rawDataEndpoint: 'raw'
    })
    await assert.rejects(
      service.rawData({
        sourceId: 'format-db',
        outputFileName: 'not-really.fasta',
        expectedFormat: 'fasta'
      }),
      /expected FASTA/
    )
    await assert.rejects(readFile(join(
      workspaceRoot,
      '.sciforge',
      'datasets',
      'raw',
      'format-db',
      'not-really.fasta'
    )))
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true })
  }
})

test('rejects insecure remote URLs and secret-bearing stored headers', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-dataset-api-'))
  const service = createDatasetApiService({ workspaceRoot })
  const endpoints = { metadataEndpoint: 'metadata', rawDataEndpoint: 'raw' }
  try {
    await assert.rejects(
      service.register({ id: 'remote', baseUrl: 'http://example.com/data', ...endpoints }),
      /must use HTTPS/
    )
    await assert.rejects(
      service.register({
        id: 'secret',
        baseUrl: 'https://example.com/data',
        ...endpoints,
        defaultHeaders: { Authorization: 'secret' }
      }),
      /auth\.envVar/
    )
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true })
  }
})
