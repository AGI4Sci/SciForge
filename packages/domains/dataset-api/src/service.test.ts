import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, symlink } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
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

test('lists exact executable examples for registered provider presets', async (context) => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-dataset-examples-'))
  context.after(() => rm(workspaceRoot, { recursive: true, force: true }))
  const service = createDatasetApiService({ workspaceRoot })
  await service.registerProvider({ providerId: 'string' })
  const listed = await service.list({ sourceIds: ['string'] })
  const source = listed.sources.find((candidate) => candidate.id === 'string')
  assert.equal(Object.keys(listed)[0], 'usageExamplesBySource')
  assert.equal(Object.keys(source ?? {})[0], 'usageExamples')
  assert.deepEqual(listed.usageExamplesBySource.string, source?.usageExamples)
  assert.deepEqual(source?.usageExamples, {
    metadata: {
      sourceId: 'string',
      query: { identifiers: 'TP53', species: 9606 }
    },
    rawData: {
      sourceId: 'string',
      query: { identifiers: 'TP53\rBRCA1', species: 9606 },
      outputFileName: 'string-TP53-BRCA1.tsv',
      expectedFormat: 'text'
    }
  })
})

test('ensures every executable preset without replacing existing source settings', async (context) => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-dataset-defaults-'))
  context.after(() => rm(workspaceRoot, { recursive: true, force: true }))
  const service = createDatasetApiService({ workspaceRoot })
  await service.register({
    id: 'ensembl',
    name: 'Workspace Ensembl mirror',
    baseUrl: 'https://example.org/ensembl/',
    metadataEndpoint: 'lookup/{identifier}',
    rawDataEndpoint: 'sequence/{identifier}'
  })

  const first = await service.ensureProviders({})
  assert.deepEqual(first.sources.map((source) => source.id), [...EXECUTABLE_DATASET_PROVIDER_IDS].sort())
  assert.equal(first.addedSourceIds.length, EXECUTABLE_DATASET_PROVIDER_IDS.length - 1)
  assert.deepEqual(first.preservedSourceIds, ['ensembl'])
  assert.equal(first.sources.find((source) => source.id === 'ensembl')?.baseUrl, 'https://example.org/ensembl/')

  const second = await service.ensureProviders({})
  assert.deepEqual(second.addedSourceIds, [])
  assert.equal(second.preservedSourceIds.length, EXECUTABLE_DATASET_PROVIDER_IDS.length)
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
      pathParameters: { datasetId: 'ds-42' },
      outputFileName: 'ds-42-metadata.json'
    })
    assert.deepEqual(metadata.metadata, { id: 'ds-42', title: 'Example dataset', files: 1 })
    assert.ok(metadata.artifact)
    assert.ok(Object.keys(metadata).indexOf('artifact') < Object.keys(metadata).indexOf('metadata'))
    assert.deepEqual(JSON.parse(await readFile(metadata.artifact.path, 'utf8')), metadata.metadata)
    const metadataManifest = JSON.parse(await readFile(metadata.artifact.manifestPath, 'utf8'))
    assert.equal(metadataManifest.operation, 'dataset_api_metadata')
    assert.equal(metadataManifest.origins[0].source.id, 'example')
    const listed = await service.list({})
    assert.equal(listed.sources[0]?.metadataEndpoint, 'datasets/{datasetId}/metadata')
    assert.equal(listed.sources[0]?.auth?.configured, true)
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    await rm(workspaceRoot, { recursive: true, force: true })
  }
})

test('keeps complete metadata in the artifact while returning a bounded summary', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-dataset-summary-'))
  const complete = {
    primaryAccession: 'P04637',
    comments: Array.from({ length: 120 }, (_, index) => ({
      id: index + 1,
      text: `comment-${index + 1}-${'x'.repeat(2_000)}`,
      evidence: Array.from({ length: 20 }, (_, evidenceIndex) => ({ id: evidenceIndex + 1 }))
    }))
  }
  const service = createDatasetApiService({
    workspaceRoot,
    fetchImpl: async () => new Response(JSON.stringify(complete), {
      headers: { 'content-type': 'application/json' }
    })
  })
  try {
    await service.register({
      id: 'summary-db',
      baseUrl: 'https://example.com/',
      metadataEndpoint: 'metadata/{identifier}',
      rawDataEndpoint: 'raw/{identifier}'
    })
    const result = await service.metadata({
      sourceId: 'summary-db',
      pathParameters: { identifier: 'P04637' },
      responseMode: 'summary',
      outputFileName: 'P04637.json'
    })
    assert.equal(result.metadataResponseMode, 'summary')
    assert.equal(result.metadataTruncated, true)
    assert.equal((result.metadata as typeof complete).primaryAccession, 'P04637')
    assert.equal((result.metadata as typeof complete).comments.length, 2)
    assert.ok(JSON.stringify(result.metadata).length < 8_000)
    assert.ok(result.artifact)
    assert.deepEqual(JSON.parse(await readFile(result.artifact.path, 'utf8')), complete)
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true })
  }
})

test('keeps shallow identifier and label fields visible in summarized result records', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-dataset-label-summary-'))
  const service = createDatasetApiService({
    workspaceRoot,
    fetchImpl: async () => new Response(JSON.stringify({
      results: [{ id: 'GO:1902749', name: 'regulation of cell cycle G2/M phase transition', definition: { text: 'x'.repeat(2_000) } }],
      genes: [{ geneName: { value: 'TP53' }, details: { text: 'x'.repeat(2_000) } }],
      pageInfo: { total: 1 }
    }), { headers: { 'content-type': 'application/json' } })
  })
  try {
    await service.register({
      id: 'ontology-db',
      baseUrl: 'https://example.com/',
      metadataEndpoint: 'terms/{identifier}',
      rawDataEndpoint: 'terms/{identifier}/raw'
    })
    const result = await service.metadata({
      sourceId: 'ontology-db',
      pathParameters: { identifier: 'GO:1902749' },
      responseMode: 'summary'
    })
    assert.deepEqual((result.metadata as { results: unknown[] }).results[0], {
      id: 'GO:1902749',
      name: 'regulation of cell cycle G2/M phase transition',
      definition: { fieldCount: 1 }
    })
    assert.deepEqual((result.metadata as { genes: unknown[] }).genes[0], {
      geneName: { value: 'TP53' },
      details: { fieldCount: 1 }
    })
    assert.ok(JSON.stringify(result.metadata).length < 8_000)
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true })
  }
})

test('streams raw data to the workspace cache with a checksum and byte range', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-dataset-raw-'))
  let payload = Buffer.from('raw-dataset-payload')
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
    const manifest = JSON.parse(await readFile(result.artifact.manifestPath, 'utf8'))
    assert.equal(manifest.operation, 'dataset_api_raw_data')
    assert.equal(manifest.request.url, 'https://example.com/api/datasets/ds-1/raw/file-1')
    const reused = await service.rawData({
      sourceId: 'raw-db',
      pathParameters: { datasetId: 'ds-1', assetId: 'file-1' },
      range: { start: 0, end: 18 },
      overwrite: true
    })
    assert.equal(reused.artifact.path, result.artifact.path)
    assert.equal(reused.artifact.reused, true)
    const originalPayload = payload.toString()
    payload = Buffer.from('changed-raw-dataset-payload')
    const versioned = await service.rawData({
      sourceId: 'raw-db',
      pathParameters: { datasetId: 'ds-1', assetId: 'file-1' },
      range: { start: 0, end: 18 },
      overwrite: true
    })
    assert.notEqual(versioned.artifact.path, result.artifact.path)
    assert.match(versioned.artifact.path, /sample-[a-f0-9]{12}\.dat$/)
    assert.equal(await readFile(result.artifact.path, 'utf8'), originalPayload)
    assert.equal(await readFile(versioned.artifact.path, 'utf8'), payload.toString())
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true })
  }
})

test('canonicalizes reused artifact aliases before validating their manifests', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-dataset-alias-'))
  const service = createDatasetApiService({
    workspaceRoot,
    fetchImpl: async (url) => String(url).includes('/metadata/')
      ? new Response(JSON.stringify({ primaryAccession: 'P04637' }), {
        headers: { 'content-type': 'application/json' }
      })
      : new Response('>sp|P04637|P53_HUMAN\nMEEPQSDPSV\n', {
        headers: { 'content-type': 'text/plain; format=fasta' }
      })
  })
  try {
    await service.register({
      id: 'alias-db',
      baseUrl: 'https://example.com/',
      metadataEndpoint: 'metadata/{identifier}',
      rawDataEndpoint: 'raw/{identifier}'
    })

    const metadata = await service.metadata({
      sourceId: 'alias-db',
      pathParameters: { identifier: 'P04637' },
      outputFileName: 'p04637-metadata.json'
    })
    assert.ok(metadata.artifact)
    const metadataAlias = join(dirname(metadata.artifact.path), 'P04637-metadata.json')
    await symlink(metadata.artifact.path, metadataAlias).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error
    })
    await symlink(metadata.artifact.manifestPath, `${metadataAlias}.manifest.json`).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code !== 'EEXIST') throw error
      }
    )
    const reusedMetadata = await service.metadata({
      sourceId: 'alias-db',
      pathParameters: { identifier: 'P04637' },
      outputFileName: 'P04637-metadata.json'
    })
    assert.ok(reusedMetadata.artifact)
    assert.equal(reusedMetadata.artifact.path, metadata.artifact.path)
    assert.equal(reusedMetadata.artifact.manifestPath, metadata.artifact.manifestPath)
    assert.equal(reusedMetadata.artifact.reused, true)

    const raw = await service.rawData({
      sourceId: 'alias-db',
      pathParameters: { identifier: 'P04637' },
      outputFileName: 'p04637.fasta'
    })
    const rawAlias = join(dirname(raw.artifact.path), 'P04637.fasta')
    await symlink(raw.artifact.path, rawAlias).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error
    })
    await symlink(raw.artifact.manifestPath, `${rawAlias}.manifest.json`).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code !== 'EEXIST') throw error
      }
    )
    const reusedRaw = await service.rawData({
      sourceId: 'alias-db',
      pathParameters: { identifier: 'P04637' },
      outputFileName: 'P04637.fasta',
      expectedFormat: 'fasta',
      overwrite: true
    })
    assert.equal(reusedRaw.artifact.path, raw.artifact.path)
    assert.equal(reusedRaw.artifact.manifestPath, raw.artifact.manifestPath)
    assert.equal(reusedRaw.artifact.reused, true)
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
    assert.equal(registration.reused, false)
    assert.deepEqual(registration.usage.metadata, {
      sourceId: 'uniprot',
      pathParameters: { identifier: 'P04637' }
    })
    const repeatedRegistration = await service.registerProvider({ providerId: 'uniprot' })
    assert.equal(repeatedRegistration.reused, true)
    assert.equal(repeatedRegistration.source.createdAt, registration.source.createdAt)
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
    assert.equal(raw.artifact.preview, '>sp|P04637|P53_HUMAN\nMEEPQSDPSV\n')
    assert.equal(raw.artifact.previewTruncated, false)
    assert.deepEqual(requestedUrls, [
      'https://rest.uniprot.org/uniprotkb/P04637.json',
      'https://rest.uniprot.org/uniprotkb/P04637.fasta'
    ])
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true })
  }
})

test('returns a compact raw-data receipt with artifact identity before a bounded preview', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-dataset-compact-receipt-'))
  const payload = JSON.stringify({
    id: 'R-HSA-109581',
    events: Array.from({ length: 200 }, (_, index) => ({
      id: `event-${index + 1}`,
      description: `event-description-${index + 1}-${'x'.repeat(160)}`
    }))
  })
  const service = createDatasetApiService({
    workspaceRoot,
    fetchImpl: async () => new Response(payload, {
      headers: { 'content-type': 'application/json' }
    })
  })
  try {
    await service.register({
      id: 'compact-db',
      baseUrl: 'https://example.com/',
      metadataEndpoint: 'metadata/{identifier}',
      rawDataEndpoint: 'raw/{identifier}'
    })
    const result = await service.rawData({
      sourceId: 'compact-db',
      pathParameters: { identifier: 'R-HSA-109581' },
      outputFileName: 'R-HSA-109581.json',
      expectedFormat: 'json'
    })
    const serialized = JSON.stringify(result)
    assert.equal(Object.keys(result)[0], 'artifact')
    assert.equal(result.artifact.previewTruncated, true)
    assert.ok(Buffer.byteLength(result.artifact.preview ?? '') <= 2 * 1024)
    assert.ok(serialized.length < 8_000)
    assert.ok(serialized.includes(JSON.stringify(result.artifact.path)))
    assert.ok(serialized.includes(JSON.stringify(result.artifact.manifestPath)))
    assert.ok(serialized.includes(result.artifact.sha256))
    assert.equal(await readFile(result.artifact.path, 'utf8'), payload)
    const manifest = JSON.parse(await readFile(result.artifact.manifestPath, 'utf8'))
    assert.equal(manifest.path, result.artifact.path)
    assert.equal(manifest.sha256, result.artifact.sha256)
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

test('uses three retries by default for intermittently unavailable dataset services', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-dataset-default-retry-'))
  let attempts = 0
  const service = createDatasetApiService({
    workspaceRoot,
    fetchImpl: async () => {
      attempts += 1
      if (attempts <= 3) {
        const cause = Object.assign(new Error('temporary upstream reset'), { code: 'ECONNRESET' })
        const error = new TypeError('fetch failed') as TypeError & { cause?: Error }
        error.cause = cause
        throw error
      }
      return new Response(JSON.stringify({ id: 'ENSG00000141510' }), {
        headers: { 'content-type': 'application/json' }
      })
    }
  })
  try {
    await service.register({
      id: 'intermittent-db',
      baseUrl: 'https://example.com/',
      metadataEndpoint: 'metadata/{identifier}',
      rawDataEndpoint: 'raw/{identifier}'
    })
    const result = await service.metadata({
      sourceId: 'intermittent-db',
      pathParameters: { identifier: 'ENSG00000141510' }
    })
    assert.deepEqual(result.metadata, { id: 'ENSG00000141510' })
    assert.equal(attempts, 4)
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
