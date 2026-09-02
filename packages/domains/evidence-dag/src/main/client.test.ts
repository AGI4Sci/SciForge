import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import {
  EVIDENCE_DAG_SERVICE_VERSION,
  EvidenceDagServiceClient,
  EvidenceDagServiceError
} from './client.js'

test('rejects an HTTP-healthy service with the old worker version', async () => {
  const client = new EvidenceDagServiceClient({
    endpoint: () => ({ baseUrl: 'http://127.0.0.1:3897', apiKey: 'test-token' }),
    fetchImpl: async () => new Response(JSON.stringify({
      ok: true,
      data: { service: 'evidence-dag-engine', version: '0.2.0' }
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })
  })
  await assert.rejects(client.health(), (error: unknown) => {
    assert.ok(error instanceof EvidenceDagServiceError)
    assert.match(error.message, new RegExp(EVIDENCE_DAG_SERVICE_VERSION.replaceAll('.', '\\.')))
    return true
  })
})

test('submits the canonical L0 manual audit request', async () => {
  let body: Record<string, unknown> | undefined
  const client = new EvidenceDagServiceClient({
    endpoint: () => ({ baseUrl: 'http://127.0.0.1:3897', apiKey: 'test-token' }),
    fetchImpl: async (_url, init) => {
      body = JSON.parse(String(init?.body))
      return new Response(JSON.stringify({
        ok: true,
        data: {
          completed_at: '2026-07-26T06:00:00.000Z',
          risk_digest: { highest_severity: 'none' }
        }
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
  })
  await client.audit('codex:thread-1', `sha256:${'b'.repeat(64)}`)
  assert.deepEqual(body, {
    threadId: 'codex:thread-1',
    targetDigest: `sha256:${'b'.repeat(64)}`,
    level: 'L0',
    trigger: 'manual',
    threshold: 0.7
  })
})

test('materializes a committed Snapshot only through an explicit closure seal', async () => {
  let body: Record<string, unknown> | undefined
  const snapshotDigest = `sha256:${'d'.repeat(64)}`
  const client = new EvidenceDagServiceClient({
    endpoint: () => ({ baseUrl: 'http://127.0.0.1:3897', apiKey: 'test-token' }),
    fetchImpl: async (_url, init) => {
      body = JSON.parse(String(init?.body))
      return new Response(JSON.stringify({ ok: true, data: {
        snapshot: {
          threadId: 'codex:thread-1', version: 1, digest: snapshotDigest,
          inputWatermark: '7', schemaVersion: 'evidence.v3',
          extractorVersion: 'extractor.v3', verifierVersion: 'verifier.v3',
          artifactDigests: [], createdAt: '2026-07-26T06:00:00.000Z', status: 'committed'
        }
      } }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
  })
  const result = await client.commitSnapshot({
    threadId: 'codex:thread-1', targetWatermark: '7', workspaceRoot: '/workspace',
    trace: [{ id: 'answer-1' }], idempotencyKey: 'seal-key-client'
  })
  assert.equal(result.digest, snapshotDigest)
  assert.deepEqual(body, {
    threadId: 'codex:thread-1', targetWatermark: '7', reason: 'seal_closure',
    priority: 'immediate', trace: [{ id: 'answer-1' }], workspaceRoot: '/workspace',
    queuedAt: body?.queuedAt, correlationId: 'seal-key-client', idempotencyKey: 'seal-key-client'
  })
})

test('rejects a committed Snapshot returned for a different Evidence thread', async () => {
  const client = new EvidenceDagServiceClient({
    endpoint: () => ({ baseUrl: 'http://127.0.0.1:3897', apiKey: 'test-token' }),
    fetchImpl: async () => new Response(JSON.stringify({ ok: true, data: {
      snapshot: {
        threadId: 'codex:other-thread', version: 1, digest: `sha256:${'e'.repeat(64)}`,
        inputWatermark: '7', schemaVersion: 'evidence.v3',
        extractorVersion: 'extractor.v3', verifierVersion: 'verifier.v3',
        artifactDigests: [], createdAt: '2026-07-26T06:00:00.000Z', status: 'committed'
      }
    } }), { status: 200, headers: { 'content-type': 'application/json' } })
  })
  await assert.rejects(
    () => client.commitSnapshot({
      threadId: 'codex:thread-1', targetWatermark: '7', trace: [],
      workspaceRoot: '/workspace', idempotencyKey: 'seal-key-thread-1'
    }),
    /different thread/u
  )
})

test('requests deterministic products for only the caller-pinned snapshot', async () => {
  let path = ''
  let body: Record<string, unknown> | undefined
  const snapshotDigest = `sha256:${'c'.repeat(64)}`
  const kinds = [
    'prov-json', 'ro-crate', 'datacite', 'audit-report', 'reproduction-report'
  ] as const
  const products = kinds.map((product) => {
    const content = `${JSON.stringify({ product })}\n`
    return {
      product,
      fileName: `${product}.json`,
      mediaType: 'application/json',
      content,
      contentDigest: createHash('sha256').update(content).digest('hex'),
      byteLength: Buffer.byteLength(content)
    }
  })
  const client = new EvidenceDagServiceClient({
    endpoint: () => ({ baseUrl: 'http://127.0.0.1:3897', apiKey: 'test-token' }),
    fetchImpl: async (url, init) => {
      path = new URL(String(url)).pathname
      body = JSON.parse(String(init?.body))
      return new Response(JSON.stringify({
        ok: true,
        data: {
          schemaVersion: 'sciforge-evidence-products.v1',
          threadId: 'codex:thread-1',
          snapshotDigest,
          sourceArtifactVersionRefs: [],
          products
        }
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
  })
  const datacite = {
    doi: '10.12345/sciforge.snapshot',
    title: 'Pinned Snapshot',
    creators: [{ name: 'Ada' }],
    publisher: 'SciForge Laboratory',
    publicationYear: 2026,
    projectId: 'project:snapshot'
  }
  const result = await client.snapshotProducts('codex:thread-1', snapshotDigest, datacite)
  assert.equal(path, '/snapshot-products')
  assert.deepEqual(body, {
    threadId: 'codex:thread-1',
    snapshotDigest,
    datacite
  })
  assert.deepEqual(result.products.map((product) => product.product), kinds)
})
