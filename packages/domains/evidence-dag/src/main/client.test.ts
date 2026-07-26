import assert from 'node:assert/strict'
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

test('maps incomplete worker responses to the public typed error contract', async () => {
  const client = new EvidenceDagServiceClient({
    endpoint: () => ({ baseUrl: 'http://127.0.0.1:3897', apiKey: 'test-token' }),
    now: () => new Date('2026-07-26T06:00:00.000Z'),
    fetchImpl: async () => new Response(JSON.stringify({
      ok: false,
      error: {
        code: 'router_response_incomplete',
        message: 'The model exhausted max_output_tokens.',
        retryable: false,
        incompleteReason: 'max_output_tokens',
        attempts: 2,
        responseStatus: 'incomplete'
      },
      provenance: { requestId: 'request-1' }
    }), {
      status: 503,
      headers: { 'content-type': 'application/json' }
    })
  })

  await assert.rejects(
    client.update({
      jobId: 'job-1',
      engineThreadId: 'codex:thread-1',
      targetWatermark: '1',
      reason: 'turn_committed',
      priority: 'normal',
      workspaceRoot: '/workspace',
      trace: [{ id: 'artifact-1', type: 'artifact' }]
    }),
    (error: unknown) => {
      assert.ok(error instanceof EvidenceDagServiceError)
      assert.equal(error.diagnostic.code, 'model_output_incomplete')
      assert.equal(error.diagnostic.incompleteReason, 'max_output_tokens')
      assert.equal(error.diagnostic.attempts, 2)
      assert.equal(error.diagnostic.responseStatus, 'incomplete')
      assert.equal(error.diagnostic.requestId, 'request-1')
      return true
    }
  )
})

test('uses stable per-batch idempotency keys and returns only canonical snapshot fields', async () => {
  const bodies: Record<string, unknown>[] = []
  const progress: Array<{ completedBatches: number; totalBatches: number }> = []
  const digest = `sha256:${'a'.repeat(64)}`
  const client = new EvidenceDagServiceClient({
    endpoint: () => ({ baseUrl: 'http://127.0.0.1:3897', apiKey: 'test-token' }),
    fetchImpl: async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)))
      return new Response(JSON.stringify({
        ok: true,
        data: {
          snapshot: {
            threadId: 'codex:thread-1',
            version: 1,
            digest,
            inputWatermark: '1:batch:2/2',
            schemaVersion: '1',
            extractorVersion: '1',
            verifierVersion: '1',
            artifactDigests: [],
            createdAt: '2026-07-26T06:00:00.000Z',
            status: 'committed',
            humanReview: { ignored: true }
          }
        }
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
  })
  const snapshot = await client.update(
    {
      jobId: 'job-1',
      engineThreadId: 'codex:thread-1',
      targetWatermark: '1',
      reason: 'turn_committed',
      priority: 'normal',
      workspaceRoot: '/workspace',
      rebuild: true,
      rebuildRationale: 'corruption recovery',
      trace: Array.from({ length: 11 }, (_, index) => ({ id: `artifact-${index}` }))
    },
    (activity) => {
      progress.push({
        completedBatches: activity.completedBatches,
        totalBatches: activity.totalBatches
      })
    }
  )
  assert.equal(bodies.length, 2)
  assert.ok(bodies.every((body) => body.workspaceRoot === '/workspace'))
  assert.equal(bodies[0]?.idempotencyKey, 'job-1:1/2')
  assert.equal(bodies[1]?.idempotencyKey, 'job-1:2/2')
  assert.equal(bodies[0]?.rebuild, true)
  assert.equal(bodies[0]?.rebuildRationale, 'corruption recovery')
  assert.equal('rebuild' in bodies[1]!, false)
  assert.equal('rebuildRationale' in bodies[1]!, false)
  assert.deepEqual(progress, [
    { completedBatches: 1, totalBatches: 2 },
    { completedBatches: 2, totalBatches: 2 }
  ])
  assert.equal(snapshot.digest, digest)
  assert.equal('status' in snapshot, false)
})

test('resumes at the first uncommitted batch with stable idempotency keys', async () => {
  const bodies: Record<string, unknown>[] = []
  const digest = `sha256:${'a'.repeat(64)}`
  const client = new EvidenceDagServiceClient({
    endpoint: () => ({ baseUrl: 'http://127.0.0.1:3897', apiKey: 'test-token' }),
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      bodies.push(body)
      return new Response(JSON.stringify({
        ok: true,
        data: {
          snapshot: {
            threadId: 'codex:thread-1',
            version: bodies.length + 1,
            digest,
            inputWatermark: body.targetWatermark,
            schemaVersion: '1',
            extractorVersion: '1',
            verifierVersion: '1',
            artifactDigests: [],
            createdAt: '2026-07-26T06:00:00.000Z',
            status: 'committed'
          }
        }
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
  })

  const snapshot = await client.update({
    jobId: 'job-1',
    engineThreadId: 'codex:thread-1',
    targetWatermark: '1',
    reason: 'turn_committed',
    priority: 'normal',
    workspaceRoot: '/workspace',
    rebuild: true,
    rebuildRationale: 'corruption recovery',
    resumeAfterBatch: 1,
    trace: Array.from({ length: 21 }, (_, index) => ({ id: `artifact-${index}` }))
  })

  assert.deepEqual(
    bodies.map((body) => body.idempotencyKey),
    ['job-1:2/3', 'job-1:3/3']
  )
  assert.ok(bodies.every((body) =>
    !('rebuild' in body) && !('rebuildRationale' in body)
  ))
  assert.equal(snapshot.inputWatermark, '1:batch:3/3')
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
