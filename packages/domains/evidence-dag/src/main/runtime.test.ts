import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { evidenceDagWatermarkCoversValue } from '../contract.js'
import type { DomainMainRuntimeLifecycleContext } from '@sciforge/domain-sdk/host'
import {
  EvidenceDagRuntime,
  evidenceDagWorkspaceRoot,
  updateEvidenceDagVisibleSurfaces
} from './runtime.js'
import {
  EvidenceDagDeltaStore,
  evidenceDagDeltaInputFromTrace
} from './evidence-delta.js'
import { evidenceDagThreadId } from './client.js'
import type { EvidenceDagSidecarPort } from './sidecar.js'

test('reconciles pending work only when the committed watermark fully covers its target', () => {
  assert.equal(evidenceDagWatermarkCoversValue('186', '186'), true)
  assert.equal(evidenceDagWatermarkCoversValue('186:batch:1/4', '186'), false)
  assert.equal(evidenceDagWatermarkCoversValue('186:batch:4/4', '186'), true)
  assert.equal(evidenceDagWatermarkCoversValue('200', '186'), true)
  assert.equal(evidenceDagWatermarkCoversValue('185', '186'), false)
  assert.equal(evidenceDagWatermarkCoversValue('7', '7:artifact-lifecycle:1'), false)
  assert.equal(evidenceDagWatermarkCoversValue('8', '7:artifact-lifecycle:1'), false)
  assert.equal(
    evidenceDagWatermarkCoversValue('7:artifact-lifecycle:1', '7:artifact-lifecycle:1'),
    true
  )
  assert.equal(evidenceDagWatermarkCoversValue('20:event-new', '19:event-old'), true)
  assert.equal(evidenceDagWatermarkCoversValue('19:event-old', '20:event-new'), false)
  assert.equal(
    evidenceDagWatermarkCoversValue('20:event-new:batch:3/4', '20:event-new:batch:1/4'),
    true
  )
  assert.equal(
    evidenceDagWatermarkCoversValue(
      '2026-07-26T07:00:00.000Z',
      '2026-07-26T06:00:00.000Z'
    ),
    true
  )
})

test('requires one unambiguous workspace scope for an update', () => {
  assert.equal(evidenceDagWorkspaceRoot('/workspace', undefined), '/workspace')
  assert.equal(evidenceDagWorkspaceRoot(undefined, '/workspace'), '/workspace')
  assert.throws(
    () => evidenceDagWorkspaceRoot('/workspace/a', '/workspace/b'),
    /does not match/
  )
  assert.throws(
    () => evidenceDagWorkspaceRoot(undefined, undefined),
    /requires a workspace root/
  )
})

test('keeps a thread prioritized until its last visible surface closes', () => {
  const visibleSurfacesByThread = new Map<string, Set<string>>()

  assert.equal(updateEvidenceDagVisibleSurfaces(
    visibleSurfacesByThread,
    'codex',
    'thread-1',
    'surface-a',
    true
  ), true)
  assert.equal(updateEvidenceDagVisibleSurfaces(
    visibleSurfacesByThread,
    'codex',
    'thread-1',
    'surface-b',
    true
  ), true)
  assert.equal(updateEvidenceDagVisibleSurfaces(
    visibleSurfacesByThread,
    'codex',
    'thread-1',
    'surface-a',
    false
  ), true)
  assert.equal(updateEvidenceDagVisibleSurfaces(
    visibleSurfacesByThread,
    'codex',
    'thread-1',
    'surface-b',
    false
  ), false)
})

test('appends a durable delta without publishing a per-turn full Snapshot', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'evidence-runtime-background-'))
  const events: string[] = []
  const sidecar: EvidenceDagSidecarPort = {
    configure: () => undefined,
    endpoint: () => ({ baseUrl: 'http://127.0.0.1:3897', apiKey: 'service-key' }),
    ensureReady: async () => {
      events.push('ensure')
    },
    stop: async () => undefined
  }
  const runtime = new EvidenceDagRuntime({
    userDataDir,
    sidecar,
    fetchImpl: async (url) => {
      assert.equal(new URL(String(url)).pathname, '/updates')
      events.push('submit')
      return new Response(JSON.stringify({
        ok: true,
        data: {
          snapshot: {
            threadId: 'codex:thread-1',
            version: 1,
            digest: `sha256:${'a'.repeat(64)}`,
            inputWatermark: '1',
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
  await runtime.activate(runtimeContext(userDataDir))
  await Promise.resolve()
  events.length = 0

  await runtime.consume({
    contractVersion: 1,
    kind: 'turn-completed',
    runtimeId: 'codex',
    threadId: 'thread-1',
    turnId: 'turn-1',
    targetWatermark: '7',
    occurredAt: '2026-07-26T06:00:00.000Z',
    workspaceRoot: '/workspace',
    artifacts: [{ id: 'answer-1', kind: 'assistant_message', text: 'Evidence.' }]
  })
  const persisted = JSON.parse(await readFile(
    join(userDataDir, 'evidence-dag', 'deltas.json'),
    'utf8'
  )) as { chains: Array<{ threadId: string; records: Array<Record<string, unknown>> }> }
  assert.deepEqual(events, [])
  assert.equal(persisted.chains[0]?.threadId, 'codex:thread-1')
  assert.deepEqual(persisted.chains[0]?.records[0]?.scope, {
    runtimeId: 'codex',
    threadId: 'codex:thread-1',
    operationId: 'turn-1',
    kind: 'turn',
    workspaceRoot: '/workspace'
  })
  assert.equal(persisted.chains[0]?.records[0]?.committedWatermark, '7')
  await runtime.close()
})

test('sealing a delta closure materializes the canonical committed Snapshot for Project', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'evidence-runtime-seal-'))
  const requestTime = new Date()
  const requestTimeIso = requestTime.toISOString()
  const requests: Array<{ path: string; body?: Record<string, unknown> }> = []
  const runtime = new EvidenceDagRuntime({
    userDataDir,
    now: () => requestTime,
    sidecar: {
      configure: () => undefined,
      endpoint: () => ({ baseUrl: 'http://127.0.0.1:3897', apiKey: 'service-key' }),
      ensureReady: async () => undefined,
      stop: async () => undefined
    },
    fetchImpl: async (url, init) => {
      const path = new URL(String(url)).pathname
      const body = init?.body
        ? JSON.parse(String(init.body)) as Record<string, unknown>
        : undefined
      requests.push({ path, ...(body ? { body } : {}) })
      if (path === '/audits') {
        return new Response(JSON.stringify({
          ok: true,
          data: {
            completed_at: requestTimeIso,
            risk_digest: {
              status: 'clean',
              total_findings: 0,
              counts_by_severity: { blocker: 0, major: 0, minor: 0, info: 0 },
              highest_severity: 'none'
            }
          }
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return new Response(JSON.stringify({
        ok: true,
        data: {
          snapshot: {
            threadId: 'codex:thread-seal',
            version: 1,
            digest: `sha256:${'b'.repeat(64)}`,
            // Formal Snapshot materialization must bind the exact closure
            // barrier/head rather than a later cumulative watermark.
            inputWatermark: '7',
            schemaVersion: 'evidence.v3',
            extractorVersion: 'extractor.v3',
            verifierVersion: 'verifier.v3',
            artifactDigests: [],
            createdAt: '2026-07-26T06:00:00.000Z',
            status: 'committed'
          }
        }
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
  })
  await runtime.activate(runtimeContext(userDataDir, '/workspace'))
  await runtime.consume({
    contractVersion: 1,
    kind: 'turn-completed',
    runtimeId: 'codex',
    threadId: 'thread-seal',
    turnId: 'turn-seal',
    targetWatermark: '7',
    occurredAt: '2026-07-26T06:00:00.000Z',
    workspaceRoot: '/workspace',
    artifacts: [{
      id: 'answer-seal',
      claimId: 'claim:seal',
      kind: 'assistant_message',
      text: 'Evidence.'
    }]
  })
  const before = await runtime.snapshotStatus({
    runtimeId: 'codex',
    threadId: 'thread-seal',
    workspaceRoot: '/workspace'
  })
  const head = before.authoritativeHead?.headDigest
  assert.ok(head)
  const closure = await runtime.sealClosure({
    runtimeId: 'codex',
    threadId: 'thread-seal',
    workspaceRoot: '/workspace',
    idempotencyKey: 'seal-closure-thread-seal',
    policy: {
      version: 'EvidenceClosurePolicyV1',
      targetClaimIds: ['claim:seal'],
      expectedHeadDigest: head,
      barrierWatermark: '7',
      edgeFamilies: [],
      directions: ['inbound'],
      maxDepth: 0,
      termination: 'depth',
      expandEquivalent: false,
      expandRefinement: false,
      cycleHandling: 'allow',
      unknownEdgeHandling: 'ignore',
      requiredRecords: [],
      requiredExternalRefs: []
    }
  })
  assert.equal(closure.headDigest, head)
  const after = await runtime.snapshotStatus({
    runtimeId: 'codex',
    threadId: 'thread-seal',
    workspaceRoot: '/workspace'
  })
  assert.ok(after.committed)
  assert.equal(after.committed.digest, `sha256:${'b'.repeat(64)}`)
  assert.equal(after.committed.inputWatermark, '7')
  const exportGate = await runtime.guardWriteExport({
    runtimeId: 'codex',
    threadId: 'thread-seal',
    workspaceRoot: '/workspace'
  })
  assert.equal(exportGate.allowed, true, JSON.stringify(exportGate))
  const metadata = exportGate.metadata as { auditState?: unknown } | undefined
  assert.equal(metadata?.auditState, 'fresh')
  assert.deepEqual(requests.map(({ path }) => path), ['/updates', '/audits'])
  assert.equal(requests[0]?.body?.threadId, 'codex:thread-seal')
  assert.equal(requests[0]?.body?.targetWatermark, '7')
  assert.equal(requests[0]?.body?.reason, 'seal_closure')
  assert.equal(requests[0]?.body?.idempotencyKey, 'seal-closure-thread-seal')
  const sealedTrace = requests[0]?.body?.trace as Array<Record<string, unknown>> | undefined
  assert.equal(sealedTrace?.length, 1)
  assert.equal(sealedTrace?.[0]?.kind, 'sciforge.evidence-delta-envelope.v1')
  const sealedDelta = sealedTrace?.[0]?.delta as Record<string, unknown> | undefined
  assert.match(String(sealedDelta?.payloadDigest), /^sha256:[0-9a-f]{64}$/u)
  const sealedPayload = sealedDelta?.payload as Record<string, unknown> | undefined
  const embeddedTrace = sealedPayload?.trace as Array<Record<string, unknown>> | undefined
  assert.equal(embeddedTrace?.[0]?.id, 'answer-seal')
  assert.equal(requests[1]?.body?.targetDigest, `sha256:${'b'.repeat(64)}`)
  const sealed = await runtime.sealClosure({
    runtimeId: 'codex',
    threadId: 'thread-seal',
    workspaceRoot: '/workspace',
    idempotencyKey: 'seal-closure-thread-seal',
    policy: {
      version: 'EvidenceClosurePolicyV1',
      targetClaimIds: ['claim:seal'],
      expectedHeadDigest: head,
      barrierWatermark: '7',
      edgeFamilies: [],
      directions: ['inbound'],
      maxDepth: 0,
      termination: 'depth',
      expandEquivalent: false,
      expandRefinement: false,
      cycleHandling: 'allow',
      unknownEdgeHandling: 'ignore',
      requiredRecords: [],
      requiredExternalRefs: []
    }
  })
  assert.deepEqual(requests.map(({ path }) => path), ['/updates', '/audits'])
  await runtime.close()
})

test('retries Snapshot materialization after a sidecar failure without duplicating the closure', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'evidence-runtime-seal-retry-'))
  let attempts = 0
  const requests: Array<{ path: string; body?: Record<string, unknown> }> = []
  const runtime = new EvidenceDagRuntime({
    userDataDir,
    sidecar: {
      configure: () => undefined,
      endpoint: () => ({ baseUrl: 'http://127.0.0.1:3897', apiKey: 'service-key' }),
      ensureReady: async () => undefined,
      stop: async () => undefined
    },
    fetchImpl: async (url, init) => {
      attempts += 1
      const body = init?.body
        ? JSON.parse(String(init.body)) as Record<string, unknown>
        : undefined
      requests.push({ path: new URL(String(url)).pathname, ...(body ? { body } : {}) })
      if (attempts === 1) throw new Error('temporary sidecar failure')
      return new Response(JSON.stringify({
        ok: true,
        data: {
          snapshot: {
            threadId: 'codex:thread-seal-retry',
            version: 1,
            digest: `sha256:${'c'.repeat(64)}`,
            inputWatermark: '7',
            schemaVersion: 'evidence.v3',
            extractorVersion: 'extractor.v3',
            verifierVersion: 'verifier.v3',
            artifactDigests: [],
            createdAt: '2026-07-26T06:00:00.000Z',
            status: 'committed'
          }
        }
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
  })
  await runtime.activate(runtimeContext(userDataDir, '/workspace'))
  await runtime.consume({
    contractVersion: 1,
    kind: 'turn-completed',
    runtimeId: 'codex',
    threadId: 'thread-seal-retry',
    turnId: 'turn-seal-retry',
    targetWatermark: '7',
    occurredAt: '2026-07-26T06:00:00.000Z',
    workspaceRoot: '/workspace',
    artifacts: [{
      id: 'answer-seal-retry',
      claimId: 'claim:seal-retry',
      kind: 'assistant_message',
      text: 'Evidence.'
    }]
  })
  const head = (await runtime.snapshotStatus({
    runtimeId: 'codex', threadId: 'thread-seal-retry', workspaceRoot: '/workspace'
  })).authoritativeHead?.headDigest
  assert.ok(head)
  const policy = {
    version: 'EvidenceClosurePolicyV1' as const,
    targetClaimIds: ['claim:seal-retry'],
    expectedHeadDigest: head,
    barrierWatermark: '7',
    edgeFamilies: [],
    directions: ['inbound'] as ('inbound' | 'outbound')[],
    maxDepth: 0,
    termination: 'depth' as const,
    expandEquivalent: false,
    expandRefinement: false,
    cycleHandling: 'allow' as const,
    unknownEdgeHandling: 'ignore' as const,
    requiredRecords: [],
    requiredExternalRefs: []
  }
  await assert.rejects(() => runtime.sealClosure({
    runtimeId: 'codex', threadId: 'thread-seal-retry', workspaceRoot: '/workspace',
    idempotencyKey: 'seal-retry-key', policy
  }), /service is unavailable/u)
  await runtime.consume({
    contractVersion: 1,
    kind: 'turn-completed',
    runtimeId: 'codex',
    threadId: 'thread-seal-retry',
    turnId: 'turn-seal-retry-2',
    targetWatermark: '8',
    occurredAt: '2026-07-26T06:00:01.000Z',
    workspaceRoot: '/workspace',
    artifacts: [{
      id: 'answer-seal-retry-2',
      kind: 'assistant_message',
      text: 'Later evidence.'
    }]
  })
  const retry = await runtime.sealClosure({
    runtimeId: 'codex', threadId: 'thread-seal-retry', workspaceRoot: '/workspace',
    idempotencyKey: 'seal-retry-key', policy
  })
  assert.equal(retry.headDigest, head)
  assert.equal((await runtime.snapshotStatus({
    runtimeId: 'codex', threadId: 'thread-seal-retry', workspaceRoot: '/workspace'
  })).committed?.digest, `sha256:${'c'.repeat(64)}`)
  assert.equal(requests[1]?.body?.targetWatermark, '7')
  await runtime.close()
})

test('materializes every closure delta, including correction and assessment records', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'evidence-runtime-seal-deltas-'))
  const requests: Array<{ path: string; body?: Record<string, unknown> }> = []
  const deltaStore = new EvidenceDagDeltaStore(join(userDataDir, 'evidence-dag', 'deltas.json'))
  const runtime = new EvidenceDagRuntime({
    userDataDir,
    deltaStore,
    sidecar: {
      configure: () => undefined,
      endpoint: () => ({ baseUrl: 'http://127.0.0.1:3897', apiKey: 'service-key' }),
      ensureReady: async () => undefined,
      stop: async () => undefined
    },
    fetchImpl: async (url, init) => {
      const path = new URL(String(url)).pathname
      const body = init?.body
        ? JSON.parse(String(init.body)) as Record<string, unknown>
        : undefined
      requests.push({ path, ...(body ? { body } : {}) })
      return new Response(JSON.stringify({ ok: true, data: {
        snapshot: {
          threadId: 'codex:thread-seal-deltas', version: 1,
          digest: `sha256:${'d'.repeat(64)}`, inputWatermark: '8',
          schemaVersion: 'evidence.v3', extractorVersion: 'extractor.v3',
          verifierVersion: 'verifier.v3', artifactDigests: [],
          createdAt: '2026-07-26T06:00:00.000Z', status: 'committed'
        }
      } }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
  })
  await runtime.activate(runtimeContext(userDataDir, '/workspace'))
  const initial = await deltaStore.append(evidenceDagDeltaInputFromTrace({
    runtimeId: 'codex', threadId: 'codex:thread-seal-deltas', workspaceRoot: '/workspace',
    operationId: 'turn-seal-deltas', kind: 'turn', requestedWatermark: '7',
    idempotencyKey: 'turn-seal-deltas', trace: [{ id: 'answer-seal-deltas', sourceRef: 'shared:seal-deltas', text: 'Evidence.' }]
  }))
  const scope = {
    runtimeId: 'codex', threadId: 'codex:thread-seal-deltas', operationId: 'correction',
    kind: 'correction' as const, workspaceRoot: '/workspace'
  }
  assert.equal((await deltaStore.head('codex:thread-seal-deltas')).headDigest, initial.delta.deltaDigest)
  await deltaStore.appendCorrection({
    scope, requestedWatermark: '8', idempotencyKey: 'correction-seal-deltas',
    sourceRefs: ['shared:seal-deltas'],
    correction: {
      recordId: 'correction:seal-deltas', targetRecordId: 'claim:seal-deltas',
      relation: 'corrects', reason: 'Corrected extraction.', producerIdentity: 'agent:producer',
      reviewerIdentity: null, createdAt: '2026-07-26T06:00:01.000Z'
    }, predecessorDigest: initial.delta.deltaDigest
  })
  await deltaStore.append({
    scope: { ...scope, operationId: 'assessment', kind: 'assessment' },
    requestedWatermark: '8', committedWatermark: '8', schemaVersion: 'evidence.delta.v1',
    extractorVersion: 'assessment', verifierVersion: 'assessment',
    idempotencyKey: 'assessment-seal-deltas', sourceRefs: ['shared:seal-deltas'],
    payload: { recordType: 'assessment', assessment: { assessmentId: 'assessment:seal-deltas' } },
    predecessorDigest: (await deltaStore.head('codex:thread-seal-deltas')).headDigest
  })
  const head = (await deltaStore.head('codex:thread-seal-deltas')).headDigest
  assert.ok(head)
  const sealed = await runtime.sealClosure({
    runtimeId: 'codex', threadId: 'thread-seal-deltas', workspaceRoot: '/workspace',
    idempotencyKey: 'seal-closure-deltas',
    policy: {
      version: 'EvidenceClosurePolicyV1', targetClaimIds: ['answer-seal-deltas'],
      expectedHeadDigest: head, barrierWatermark: '8', edgeFamilies: [], directions: ['inbound'],
      maxDepth: 0, termination: 'fixed_point', expandEquivalent: false, expandRefinement: false,
      cycleHandling: 'allow', unknownEdgeHandling: 'ignore',
      requiredRecords: ['correction:seal-deltas'], requiredExternalRefs: []
    }
  })
  assert.equal(sealed.status, 'complete', JSON.stringify(sealed))
  assert.equal(requests.length, 1, JSON.stringify(sealed))
  const envelopes = requests[0]?.body?.trace as Array<Record<string, unknown>>
  assert.equal(envelopes.length, 3)
  assert.deepEqual(
    envelopes.map((item) => (item.delta as Record<string, unknown>).payload)
      .map((payload) => (payload as Record<string, unknown>).recordType ?? 'trace'),
    ['trace', 'correction', 'assessment']
  )
  await runtime.close()
})

test('replays an identical completed event idempotently in the durable delta chain', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'evidence-runtime-replay-'))
  const runtime = new EvidenceDagRuntime({
    userDataDir,
    sidecar: {
      configure: () => undefined,
      endpoint: () => ({ baseUrl: 'http://127.0.0.1:3897', apiKey: 'service-key' }),
      ensureReady: async () => undefined,
      stop: async () => undefined
    }
  })
  await runtime.activate(runtimeContext(userDataDir))
  const event = {
    contractVersion: 1 as const,
    kind: 'turn-completed' as const,
    runtimeId: 'codex',
    threadId: 'thread-replay',
    turnId: 'turn-replay',
    targetWatermark: '9',
    occurredAt: '2026-09-01T00:00:00.000Z',
    workspaceRoot: '/workspace',
    artifacts: [{ id: 'answer-replay', kind: 'assistant_message', text: 'same' }]
  }
  await runtime.consume(event)
  await runtime.consume({
    ...event,
    turnId: 'turn-replay-newer',
    targetWatermark: '10',
    artifacts: [{ id: 'answer-replay-newer', kind: 'assistant_message', text: 'newer' }]
  })
  await runtime.consume(event)
  const persisted = JSON.parse(await readFile(
    join(userDataDir, 'evidence-dag', 'deltas.json'),
    'utf8'
  )) as { chains: Array<{ records: Array<Record<string, unknown>>; provisional?: Record<string, unknown> }> }
  assert.equal(persisted.chains[0]?.records.length, 2)
  assert.equal(
    persisted.chains[0]?.provisional?.desiredHeadDigest,
    persisted.chains[0]?.records[1]?.deltaDigest
  )
  await runtime.close()
})

test('does not enqueue an artifact event that has no workspace scope', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'evidence-runtime-unscoped-'))
  let submitted = false
  const runtime = new EvidenceDagRuntime({
    userDataDir,
    sidecar: {
      configure: () => undefined,
      endpoint: () => ({ baseUrl: 'http://127.0.0.1:3897', apiKey: 'service-key' }),
      ensureReady: async () => undefined,
      stop: async () => undefined
    },
    fetchImpl: async () => {
      submitted = true
      throw new Error('Unscoped artifact events must not reach the service.')
    }
  })
  await runtime.activate(runtimeContext(userDataDir))
  await runtime.consume({
    contractVersion: 1,
    kind: 'turn-completed',
    runtimeId: 'codex',
    threadId: 'thread-1',
    turnId: 'turn-1',
    targetWatermark: '7',
    occurredAt: '2026-07-26T06:00:00.000Z',
    artifacts: [{ id: 'answer-1', kind: 'assistant_message', text: 'Evidence.' }]
  })
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(submitted, false)
  await runtime.close()
})

test('reads the local delta head and provisional view without waiting for the Evidence sidecar', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'evidence-runtime-status-'))
  const runtimeId = 'domain:sciforge.create-loop'
  const threadId = 'execution:execution-1'
  const deltaStore = new EvidenceDagDeltaStore(join(userDataDir, 'evidence-deltas.json'))
  await deltaStore.append(evidenceDagDeltaInputFromTrace({
    runtimeId,
    // Synthetic execution scopes are keyed by the same canonical identity
    // used by the runtime status reader.
    threadId: evidenceDagThreadId(runtimeId, threadId),
    operationId: 'execution-1',
    kind: 'execution',
    requestedWatermark: '1:event-1',
    idempotencyKey: 'execution-status-1',
    workspaceRoot: '/workspace',
    trace: [{ id: 'execution-1' }]
  }))
  let ensureCalls = 0
  let fetchCalls = 0
  const runtime = new EvidenceDagRuntime({
    userDataDir,
    deltaStore,
    sidecar: {
      configure: () => undefined,
      endpoint: () => ({ baseUrl: 'http://127.0.0.1:3897', apiKey: 'service-key' }),
      ensureReady: async () => {
        ensureCalls += 1
        throw new Error('Evidence sidecar is unavailable.')
      },
      stop: async () => undefined
    },
    fetchImpl: async () => {
      fetchCalls += 1
      throw new Error('Evidence sidecar is unavailable.')
    }
  })
  const baseContext = runtimeContext(userDataDir)
  await runtime.activate({
    ...baseContext,
    agentThreads: {
      ...baseContext.agentThreads,
      read: async () => {
        throw new Error('Synthetic execution scope has no Agent thread.')
      }
    }
  })
  await Promise.resolve()
  const activationEnsureCalls = ensureCalls

  const status = await runtime.snapshotStatus({
    runtimeId,
    threadId,
    workspaceRoot: '/workspace'
  })
  assert.equal(status.authoritativeHead?.headDigest, (await deltaStore.head(
    evidenceDagThreadId(runtimeId, threadId)
  )).headDigest)
  assert.equal(status.provisional?.summary.freshness, 'fresh')
  assert.equal(status.committed, null)
  assert.equal(status.pending, null)
  assert.equal(Number.isNaN(Date.parse(status.updatedAt)), false)
  assert.equal(ensureCalls, activationEnsureCalls)
  assert.equal(fetchCalls, 0)
  const mismatched = await runtime.snapshotStatus({
    runtimeId,
    threadId,
    workspaceRoot: '/different-workspace'
  })
  assert.equal(mismatched.authoritativeHead, undefined)
  assert.equal(mismatched.provisional, undefined)
  assert.equal(mismatched.committed, null)
  assert.equal(mismatched.pending, null)
  assert.equal(ensureCalls, activationEnsureCalls)
  await runtime.close()
})

test('does not leak local delta state when Agent authority has no workspace binding', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'evidence-runtime-unbound-status-'))
  const deltaStore = new EvidenceDagDeltaStore(join(userDataDir, 'evidence-deltas.json'))
  await deltaStore.append(evidenceDagDeltaInputFromTrace({
    runtimeId: 'codex',
    threadId: 'thread-1',
    operationId: 'turn-1',
    kind: 'turn',
    requestedWatermark: '7',
    idempotencyKey: 'unbound-status-1',
    workspaceRoot: '/workspace/a',
    trace: [{ id: 'workspace-a-artifact' }]
  }))
  const runtime = new EvidenceDagRuntime({
    userDataDir,
    deltaStore,
    sidecar: {
      configure: () => undefined,
      endpoint: () => ({ baseUrl: 'http://127.0.0.1:3897', apiKey: 'service-key' }),
      ensureReady: async () => undefined,
      stop: async () => undefined
    }
  })
  await runtime.activate(runtimeContext(userDataDir))

  const status = await runtime.snapshotStatus({
    runtimeId: 'codex',
    threadId: 'thread-1',
    workspaceRoot: '/workspace/b'
  })
  assert.equal(status.committed, null)
  assert.equal(status.pending, null)
  const sameWorkspaceWithoutAuthority = await runtime.snapshotStatus({
    runtimeId: 'codex',
    threadId: 'thread-1',
    workspaceRoot: '/workspace/a'
  })
  assert.equal(sameWorkspaceWithoutAuthority.authoritativeHead, undefined)
  assert.equal(sameWorkspaceWithoutAuthority.provisional, undefined)
  assert.equal(sameWorkspaceWithoutAuthority.committed, null)
  await runtime.close()
})

test('appends a threadless execution delta through the canonical synthetic scope', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'evidence-runtime-execution-'))
  const runtime = new EvidenceDagRuntime({
    userDataDir,
    sidecar: {
      configure: () => undefined,
      endpoint: () => ({ baseUrl: 'http://127.0.0.1:3897', apiKey: 'service-key' }),
      ensureReady: async () => undefined,
      stop: async () => undefined
    },
    fetchImpl: async () => {
      throw new Error('Automatic execution capture must not publish a full Snapshot.')
    }
  })
  await runtime.activate(runtimeContext(userDataDir))
  await runtime.consume({
    contractVersion: 1,
    kind: 'execution-completed',
    producer: { moduleId: 'sciforge.create-loop', moduleVersion: '1.0.0' },
    executionId: 'workflow-9',
    runId: 'run-9',
    targetWatermark: 'event-9',
    workspaceRoot: '/workspace',
    occurredAt: '2026-08-05T00:00:00.000Z',
    artifacts: [{
      schemaVersion: 'sciforge.execution-event.v1',
      eventId: 'event-9',
      phase: 'run_completed'
    }]
  })
  const persisted = JSON.parse(await readFile(
    join(userDataDir, 'evidence-dag', 'deltas.json'),
    'utf8'
  )) as { chains: Array<{ threadId: string; records: Array<Record<string, unknown>> }> }
  assert.equal(
    persisted.chains[0]?.threadId,
    'domain:sciforge.create-loop:execution:workflow-9'
  )
  assert.deepEqual(persisted.chains[0]?.records[0]?.runRefs, ['run-9'])
  assert.equal(persisted.chains[0]?.records[0]?.committedWatermark, 'event-9')
  await runtime.close()
})

function runtimeContext(
  userDataDir: string,
  workspaceRoot?: string,
  withArtifact = false
): DomainMainRuntimeLifecycleContext {
  return {
    owner: { moduleId: 'sciforge.evidence-dag', moduleVersion: '1.0.0' },
    signal: new AbortController().signal,
    userDataDir,
    appRoot: '/workspace/app',
    environment: {},
    agentThreads: {
      list: async () => [],
      read: async () => ({
        id: 'thread-1',
        runtimeId: 'codex',
        watermark: '7',
        turns: [],
        artifacts: withArtifact
          ? [{ id: 'answer-1', kind: 'assistant_message', text: 'Evidence.' }]
          : [],
        ...(workspaceRoot ? { workspaceRoot } : {})
      }),
      subscribeMessages: async function* () {},
      hasActiveTurns: () => false
    },
    capabilities: {
      invoke: async () => {
        throw new Error('Unexpected capability invocation.')
      },
      createApprovedBatch: () => {
        throw new Error('Unexpected capability invocation.')
      }
    },
    modelAccess: {
      textReasoner: async () => ({
        baseUrl: 'http://127.0.0.1:3892/v1',
        apiKey: 'router-key',
        model: 'sciforge-router'
      })
    },
    executionEvents: {
      publish: async () => { throw new Error('Unexpected execution event.') }
    },
    workflowExecutionReceipts: [],
    enablement: {
      isEnabled: async () => true,
      subscribe: () => () => undefined
    },
    log: () => undefined
  }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.fail('Condition was not reached before timeout.')
}
