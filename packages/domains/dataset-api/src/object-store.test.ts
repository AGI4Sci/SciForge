import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'
import { createDatasetObjectStoreService } from './object-store.js'

test('registers an S3-compatible store without persisting credential values', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-object-store-'))
  const env = {
    PRIVATE_DATA_ACCESS_KEY_ID: 'fixture-access-key',
    PRIVATE_DATA_SECRET_ACCESS_KEY: 'fixture-secret-key'
  }
  try {
    const service = createDatasetObjectStoreService({ workspaceRoot, env })
    const registered = await service.register({
      id: 'private-corpus',
      endpoint: 'http://objects.internal.example',
      bucket: 'private-data',
      prefix: '/corpus/releases/',
      allowInsecureHttp: true,
      credentialEnv: {
        accessKeyId: 'PRIVATE_DATA_ACCESS_KEY_ID',
        secretAccessKey: 'PRIVATE_DATA_SECRET_ACCESS_KEY'
      }
    })
    assert.equal(registered.source.credentials.configured, true)
    assert.equal(registered.source.prefix, 'corpus/releases')
    assert.equal('credentialEnv' in registered.source, false)

    const registryText = await readFile(
      join(workspaceRoot, '.sciforge', 'datasets', 'object-stores.json'),
      'utf8'
    )
    assert.equal(registryText.includes(env.PRIVATE_DATA_ACCESS_KEY_ID), false)
    assert.equal(registryText.includes(env.PRIVATE_DATA_SECRET_ACCESS_KEY), false)
    assert.match(registryText, /PRIVATE_DATA_ACCESS_KEY_ID/)
    assert.match(registryText, /PRIVATE_DATA_SECRET_ACCESS_KEY/)

    const listed = await service.list({})
    assert.equal(listed.stores.length, 1)
    assert.equal(listed.stores[0]?.credentials.configured, true)
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true })
  }
})

test('lists, inspects, and downloads scoped private objects through SigV4 client inputs', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-object-access-'))
  const commands: Array<{ name: string; input: Record<string, unknown> }> = []
  const payload = Buffer.from('{"gene":"TP53"}\n')
  const service = createDatasetObjectStoreService({
    workspaceRoot,
    env: {
      PRIVATE_DATA_ACCESS_KEY_ID: 'fixture-access-key',
      PRIVATE_DATA_SECRET_ACCESS_KEY: 'fixture-secret-key'
    },
    clientFactory: ({ credentials }) => {
      assert.equal(credentials.accessKeyId, 'fixture-access-key')
      assert.equal(credentials.secretAccessKey, 'fixture-secret-key')
      return {
        async send(command: any) {
          const name = command.constructor.name
          commands.push({ name, input: command.input })
          if (name === 'ListObjectsV2Command') {
            return {
              $metadata: { httpStatusCode: 200 },
              Contents: [{
                Key: 'en-database-ncbi-gene/release/gene.jsonl',
                Size: payload.byteLength,
                ETag: '"fixture-etag"',
                LastModified: new Date('2026-01-02T03:04:05Z')
              }],
              KeyCount: 1,
              IsTruncated: false
            }
          }
          if (name === 'HeadObjectCommand') {
            return {
              $metadata: { httpStatusCode: 200 },
              ContentLength: payload.byteLength,
              ContentType: 'application/x-ndjson',
              ETag: '"fixture-etag"',
              LastModified: new Date('2026-01-02T03:04:05Z')
            }
          }
          if (name === 'GetObjectCommand') {
            return {
              $metadata: { httpStatusCode: 206 },
              Body: Readable.from([payload]),
              ContentLength: payload.byteLength,
              ContentRange: `bytes 0-${payload.byteLength - 1}/${payload.byteLength}`,
              ContentType: 'application/x-ndjson',
              ETag: '"fixture-etag"'
            }
          }
          throw new Error(`Unexpected command ${name}`)
        }
      }
    }
  })
  try {
    await service.register({
      id: 'private-ncbi',
      endpoint: 'https://objects.example.org',
      bucket: 'private-hcorpus',
      prefix: 'en-database-ncbi-gene',
      credentialEnv: {
        accessKeyId: 'PRIVATE_DATA_ACCESS_KEY_ID',
        secretAccessKey: 'PRIVATE_DATA_SECRET_ACCESS_KEY'
      }
    })
    const objects = await service.listObjects({ sourceId: 'private-ncbi', prefix: 'release/', maxKeys: 10 })
    assert.equal(objects.objects[0]?.relativeKey, 'release/gene.jsonl')
    assert.equal(objects.objects[0]?.etag, 'fixture-etag')

    const metadata = await service.metadata({ sourceId: 'private-ncbi', key: 'release/gene.jsonl' })
    assert.equal(metadata.metadata.size, payload.byteLength)

    const downloaded = await service.rawData({
      sourceId: 'private-ncbi',
      key: 'release/gene.jsonl',
      outputFileName: 'private-gene.jsonl',
      expectedFormat: 'json',
      range: { start: 0, end: payload.byteLength - 1 }
    })
    assert.equal(await readFile(downloaded.artifact.path, 'utf8'), payload.toString())
    assert.equal(downloaded.artifact.format, 'json')
    assert.equal(downloaded.response.rangeSatisfied, true)
    assert.match(downloaded.artifact.sha256, /^[a-f0-9]{64}$/)
    const manifest = JSON.parse(await readFile(downloaded.artifact.manifestPath, 'utf8'))
    assert.equal(manifest.request.key, 'en-database-ncbi-gene/release/gene.jsonl')
    assert.equal(JSON.stringify(manifest).includes('fixture-secret-key'), false)

    assert.deepEqual(commands.map((command) => command.name), [
      'ListObjectsV2Command',
      'HeadObjectCommand',
      'GetObjectCommand'
    ])
    assert.equal(commands[0]?.input.Prefix, 'en-database-ncbi-gene/release/')
    assert.equal(commands[1]?.input.Key, 'en-database-ncbi-gene/release/gene.jsonl')
    assert.equal(commands[2]?.input.Range, `bytes=0-${payload.byteLength - 1}`)
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true })
  }
})

test('requires explicit insecure HTTP approval and fails closed on missing credentials', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-object-policy-'))
  const service = createDatasetObjectStoreService({ workspaceRoot, env: {} })
  try {
    await assert.rejects(service.register({
      id: 'private-data',
      endpoint: 'http://objects.example.org',
      bucket: 'private-data',
      credentialEnv: { accessKeyId: 'PRIVATE_ACCESS', secretAccessKey: 'PRIVATE_SECRET' }
    }), /allowInsecureHttp=true/)
    await service.register({
      id: 'private-data',
      endpoint: 'http://objects.example.org',
      bucket: 'private-data',
      allowInsecureHttp: true,
      credentialEnv: { accessKeyId: 'PRIVATE_ACCESS', secretAccessKey: 'PRIVATE_SECRET' }
    })
    await assert.rejects(
      service.listObjects({ sourceId: 'private-data' }),
      /credentials are not configured/
    )
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true })
  }
})
