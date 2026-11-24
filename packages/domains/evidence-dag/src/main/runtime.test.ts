import assert from 'node:assert/strict'
import { mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createHash } from 'node:crypto'
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

test('explicit claim submission pins source bytes and remains pending and replayable after restart', async () => {
  const userDataDir = await realpath(await mkdtemp(join(tmpdir(), 'evidence-submit-')))
  const text = 'Observed 59 of 60 crop checks passed.\n'
  const bytes = Buffer.from(text)
  const ref = { artifactId: 'artifact:crop', versionId: 'artifact-version:crop',
    contentDigest: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.length,
    mediaType: 'text/plain', availability: 'available' as const, retention: 'snapshot' as const,
    accessPolicy: { visibility: 'workspace' as const, principals: [], allowExport: true } }
  const input = { runtimeId: 'codex', threadId: 'thread-1', workspaceRoot: '/workspace', idempotencyKey: 'submit-crop-checks',
    claims: [{ text: 'One crop check remains unresolved.', sources: [{ ref, startByte: 0, endByte: bytes.length, quote: text }] }] }
  const scope = { runtimeId: input.runtimeId, threadId: input.threadId, workspaceRoot: input.workspaceRoot }
  const createdAt = '2026-11-20T00:00:00Z'
  let beforeRead = async () => {}
  let artifactUpdatedAt = createdAt
  const options = { userDataDir, artifactVersionReadPort: { read: async () => { await beforeRead(); return ({ ok: true as const, value: {
    ref, dataBase64: bytes.toString('base64'),
    artifact: { artifactId: ref.artifactId, kind: 'document', createdAt, updatedAt: artifactUpdatedAt, currentVersionId: ref.versionId, versionCount: 1 },
    version: { schemaVersion: 1 as const, versionId: ref.versionId, artifactId: ref.artifactId, sequence: 1,
      transactionId: 'transaction:crop', createdAt, intent: 'save' as const,
      storage: { mode: 'snapshot' as const, contentDigest: ref.contentDigest, byteLength: bytes.length },
      dependencies: [], accessPolicy: ref.accessPolicy, metadata: {} }
  } }) } },
    sidecar: { configure: () => undefined, endpoint: () => ({ baseUrl: 'http://127.0.0.1:3897', apiKey: 'fixture' }), ensureReady: async () => undefined, stop: async () => undefined } }
  let runtime = new EvidenceDagRuntime(options)
  await runtime.activate(runtimeContext(userDataDir, '/workspace'))
  try {
    assert.equal(typeof runtime.submitClaims, 'function', 'public runtime must accept explicit version-bound claims')
    const first = await runtime.submitClaims(input)
    assert.equal(first.idempotent, false)
    assert.equal(first.claims[0].reviewStatus, 'pending')
    assert.deepEqual(first.claims[0].sources[0].ref, ref)
    const status = await runtime.snapshotStatus(scope)
    assert.equal(status.committed, null)
    assert.equal((status.provisional?.lastGood?.claims as unknown[]).length, 1)
    await assert.rejects(runtime.submitClaims({ ...input, claims: [{ ...input.claims[0], text: 'Changed claim' }] }), /idempotency|replay/i)
    const head = (await runtime.snapshotStatus(scope)).authoritativeHead
    for (const bad of [
      { ...input, workspaceRoot: '/other' },
      { ...input, idempotencyKey: 'bad-quote', claims: [{ ...input.claims[0], sources: [{ ...input.claims[0].sources[0], quote: 'wrong' }] }] },
      { ...input, idempotencyKey: 'bad-ref', claims: [{ ...input.claims[0], sources: [{ ...input.claims[0].sources[0], ref: { ...ref, contentDigest: '0'.repeat(64) } }] }] }
    ]) await assert.rejects(runtime.submitClaims(bad))
    assert.deepEqual((await runtime.snapshotStatus(scope)).authoritativeHead, head)
    const stored = new EvidenceDagDeltaStore(join(userDataDir, 'evidence-dag', 'deltas.json'))
    const engineThread = await stored.threadIdForWorkspace(evidenceDagThreadId('codex', 'thread-1'), '/workspace')
    const closure = await stored.seal(engineThread, {
      version: 'EvidenceClosurePolicyV1', targetClaimIds: [first.claims[0].id],
      expectedHeadDigest: first.deltaDigest, barrierWatermark: '7', edgeFamilies: ['supports'],
      directions: ['inbound'], maxDepth: 8, termination: 'fixed_point', expandEquivalent: false,
      expandRefinement: false, cycleHandling: 'fail', unknownEdgeHandling: 'fail',
      requiredRecords: [first.claims[0].id], requiredExternalRefs: [ref.versionId]
    })
    assert.equal(closure.status, 'complete')
    assert.ok(closure.includedExternalRefs.includes(ref.versionId))
    await runtime.close()
    runtime = new EvidenceDagRuntime(options)
    const advancedContext = runtimeContext(userDataDir, '/workspace')
    const originalRead = advancedContext.agentThreads.read
    await runtime.activate({ ...advancedContext, agentThreads: { ...advancedContext.agentThreads,
      read: async (request) => ({ ...await originalRead(request), watermark: '8' }) } })
    artifactUpdatedAt = '2026-11-21T00:00:00Z'
    const replay = await runtime.submitClaims(input)
    assert.equal(replay.idempotent, true)
    assert.deepEqual(replay.claims, first.claims)
    assert.equal(replay.deltaDigest, first.deltaDigest)
    beforeRead = async () => { await runtime.close() }
    await assert.rejects(runtime.submitClaims({ ...input, idempotencyKey: 'closed-during-source-read' }), /superseded|closed|enabled/i)
  } finally { await runtime.close() }
})

test('damaged history isolates durably before consumer acknowledgement and allows subsequent input and exit after restart', async () => {
  const userDataDir = await realpath(await mkdtemp(join(tmpdir(), 'evidence-consumer-isolation-')))
  const path = join(userDataDir, 'evidence-dag', 'deltas.json')
  const sidecar = { configure: () => undefined, endpoint: () => ({ baseUrl: 'http://127.0.0.1:3897', apiKey: 'fixture' }), ensureReady: async () => undefined, stop: async () => undefined }
  const event = (turnId: string, targetWatermark: string) => ({ contractVersion: 1 as const, kind: 'turn-completed' as const,
    runtimeId: 'codex', threadId: 'thread-1', workspaceRoot: '/workspace', turnId, targetWatermark,
    occurredAt: '2026-11-13T00:00:00Z', artifacts: [{ id: turnId, text: 'synthetic evidence' }] })
  const initial = new EvidenceDagRuntime({ userDataDir, sidecar })
  await initial.activate(runtimeContext(userDataDir, '/workspace'))
  await initial.consume(event('failed-turn', '1'))
  await initial.close()
  const document = JSON.parse(await readFile(path, 'utf8'))
  document.chains[0].records[0].payload = { damaged: true }
  const raw = JSON.stringify(document)
  await writeFile(path, raw)
  for (const turn of ['failed-turn', 'next-turn']) {
    const runtime = new EvidenceDagRuntime({ userDataDir, sidecar })
    await runtime.activate(runtimeContext(userDataDir, '/workspace'))
    try {
      await runtime.consume(event(turn, turn === 'failed-turn' ? '1' : '2'))
      const persisted = JSON.parse(await readFile(path, 'utf8'))
      assert.equal(persisted.recoveries.length, 1)
      assert.equal(await readFile(join(userDataDir, 'evidence-dag', persisted.recoveries[0].archiveName), 'utf8'), raw)
      const status = await runtime.snapshotStatus({ runtimeId: 'codex', threadId: 'thread-1', workspaceRoot: '/workspace' })
      assert.equal(status.coverage?.complete, false)
      assert.equal(status.freshness, 'failed')
      assert.equal(status.failure?.retryable, false)
      assert.match(status.failure!.message, /历史证据不完整/u)
    } finally { await runtime.close() }
  }
  const reopened = new EvidenceDagDeltaStore(path)
  const records = (await reopened.chain('codex:thread-1')).list()
  assert.equal(records.length, 3)
  assert.equal(records[0]!.payload.recordType, 'integrity_isolation')
  assert.equal(records[2]!.scope.operationId, 'next-turn')
})

test('native seal reuses historical mapping after a newer closure without moving current', async () => {
  const userDataDir = await realpath(await mkdtemp(join(tmpdir(), 'evidence-native-history-')))
  let watermark = '7', commits = 0
  const runtime = new EvidenceDagRuntime({ userDataDir,
    sidecar: { configure: () => undefined, endpoint: () => ({ baseUrl: 'http://127.0.0.1:3897', apiKey: 'synthetic' }), ensureReady: async () => undefined, stop: async () => undefined },
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(String(init?.body))
      commits++
      return new Response(JSON.stringify({ ok: true, data: { snapshot: { threadId: 'codex:history', version: body.targetWatermark === '7' ? 1 : 2,
        digest: 'sha256:' + (body.targetWatermark === '7' ? 'a' : 'b').repeat(64), inputWatermark: body.targetWatermark,
        schemaVersion: 'evidence.v3', extractorVersion: 'extractor.v3', verifierVersion: 'verifier.v3', artifactDigests: [], createdAt: '2026-07-26T00:00:00Z', status: 'committed' } } }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
  })
  const scope = { runtimeId: 'codex', threadId: 'history', workspaceRoot: '/workspace' }
  await runtime.activate(runtimeContext(userDataDir, '/workspace'))
  const append = () => runtime.consume({ contractVersion: 1, kind: 'turn-completed', ...scope, turnId: 'turn-' + watermark, targetWatermark: watermark,
    occurredAt: '2026-07-26T00:00:00Z', artifacts: [{ id: 'claim-' + watermark, claimId: 'claim:history', text: 'Synthetic' }] })
  const request = async (key: string) => ({ ...scope, idempotencyKey: key, policy: { version: 'EvidenceClosurePolicyV1' as const, targetClaimIds: ['claim:history'],
    expectedHeadDigest: (await runtime.snapshotStatus(scope)).authoritativeHead!.headDigest!, barrierWatermark: watermark, edgeFamilies: [], directions: ['inbound' as const],
    maxDepth: 0, termination: 'depth' as const, expandEquivalent: false, expandRefinement: false, cycleHandling: 'allow' as const, unknownEdgeHandling: 'ignore' as const,
    requiredRecords: [], requiredExternalRefs: [] } })
  try {
    await append(); const first = await request('native-old-seal'); const receipt = await runtime.sealClosure(first)
    watermark = '8'; await append(); await runtime.sealClosure(await request('native-new-seal'))
    const current = (await runtime.snapshotStatus(scope)).committed
    commits = 0; assert.deepEqual(await runtime.sealClosure(first), receipt); assert.equal(commits, 0)
    assert.deepEqual((await runtime.snapshotStatus(scope)).committed, current)
    await assert.rejects(runtime.sealClosure({ ...first, policy: { ...first.policy, maxDepth: 1 } }), /idempotency|replay/i)
  } finally { await runtime.close() }
})

test('keeps migrated thread capture isolated and replayable without rewriting its original evidence', async () => {
  const userDataDir = await realpath(await mkdtemp(join(tmpdir(), 'evidence-workspace-move-')))
  let workspaceRoot = '/workspace/a'
  const baseContext = runtimeContext(userDataDir, workspaceRoot)
  const context: DomainMainRuntimeLifecycleContext = { ...baseContext, agentThreads: {
    ...baseContext.agentThreads,
    read: async input => ({ ...await baseContext.agentThreads.read(input), workspaceRoot })
  } }
  const runtime = new EvidenceDagRuntime({ userDataDir,
    sidecar: { configure: () => undefined, endpoint: () => ({ baseUrl: 'http://127.0.0.1:3897', apiKey: 'fixture' }), ensureReady: async () => undefined, stop: async () => undefined },
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(String(init?.body))
      assert.match(body.threadId, /^codex:thread-1:workspace:[0-9a-f]{64}$/u)
      assert.equal(body.workspaceRoot, '/workspace/b')
      return new Response(JSON.stringify({ ok: true, data: { snapshot: {
        threadId: body.threadId, version: 1, digest: 'sha256:' + 'c'.repeat(64), inputWatermark: body.targetWatermark,
        schemaVersion: 'evidence.v3', extractorVersion: 'extractor.v3', verifierVersion: 'verifier.v3', artifactDigests: [],
        createdAt: '2026-11-12T00:00:00Z', status: 'committed'
      } } }), { headers: { 'content-type': 'application/json' } })
    }
  })
  const event = (root: string, turnId: string, targetWatermark: string) => ({
    contractVersion: 1 as const, kind: 'turn-completed' as const, runtimeId: 'codex', threadId: 'thread-1',
    workspaceRoot: root, turnId, targetWatermark, occurredAt: '2026-11-12T00:00:00Z', artifacts: [{ id: turnId, claimId: 'claim:move', text: 'Synthetic workspace evidence.' }]
  })
  const storePath = join(userDataDir, 'evidence-dag', 'deltas.json')
  await runtime.activate(context)
  try {
    await runtime.consume(event(workspaceRoot, 'turn-a', '1'))
    const original = JSON.parse(await readFile(storePath, 'utf8')).chains[0]
    workspaceRoot = '/workspace/b'
    await runtime.consume(event(workspaceRoot, 'turn-b', '2'))
    const migrated = await runtime.snapshotStatus({ runtimeId: 'codex', threadId: 'thread-1', workspaceRoot })
    assert.equal(migrated.authoritativeHead?.sequence, 1)
    const view = await runtime.view({ runtimeId: 'codex', threadId: 'thread-1', workspaceRoot })
    assert.equal(new URL(view.url!).searchParams.get('thread'), migrated.authoritativeHead?.threadId)
    assert.deepEqual(view.status.authoritativeHead, migrated.authoritativeHead)
    await Promise.all([
      runtime.consume(event('/workspace/a', 'turn-a', '1')),
      runtime.consume(event('/workspace/b', 'turn-b', '2'))
    ])
    const persisted = JSON.parse(await readFile(storePath, 'utf8'))
    assert.equal(persisted.chains.length, 2)
    assert.deepEqual(persisted.chains.find((chain: { threadId: string }) => chain.threadId === original.threadId).records, original.records)
    assert.deepEqual((await runtime.snapshotStatus({ runtimeId: 'codex', threadId: 'thread-1', workspaceRoot })).authoritativeHead, migrated.authoritativeHead)
    const reopened = new EvidenceDagDeltaStore(storePath)
    const reopenedId = await reopened.threadIdForWorkspace('codex:thread-1', workspaceRoot)
    assert.deepEqual((await reopened.chain(reopenedId)).head, migrated.authoritativeHead)
    const closure = await runtime.sealClosure({ runtimeId: 'codex', threadId: 'thread-1', workspaceRoot,
      idempotencyKey: 'workspace-b-seal', policy: { version: 'EvidenceClosurePolicyV1', targetClaimIds: ['claim:move'],
        expectedHeadDigest: migrated.authoritativeHead!.headDigest!, barrierWatermark: '2', edgeFamilies: [], directions: ['inbound'],
        maxDepth: 0, termination: 'depth', expandEquivalent: false, expandRefinement: false, cycleHandling: 'allow',
        unknownEdgeHandling: 'ignore', requiredRecords: [], requiredExternalRefs: [] }
    })
    assert.equal(closure.threadId, reopenedId)
    assert.equal((await runtime.snapshotStatus({ runtimeId: 'codex', threadId: 'thread-1', workspaceRoot })).committed?.threadId, reopenedId)
    workspaceRoot = '/workspace/a'
    const restored = await runtime.snapshotStatus({ runtimeId: 'codex', threadId: 'thread-1', workspaceRoot })
    assert.equal(restored.authoritativeHead?.headDigest, original.records[0].deltaDigest)
  } finally { await runtime.close() }
})

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
  const userDataDir = await realpath(await mkdtemp(join(tmpdir(), 'evidence-runtime-background-')))
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
  const userDataDir = await realpath(await mkdtemp(join(tmpdir(), 'evidence-runtime-seal-')))
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
  const userDataDir = await realpath(await mkdtemp(join(tmpdir(), 'evidence-runtime-seal-retry-')))
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
  const userDataDir = await realpath(await mkdtemp(join(tmpdir(), 'evidence-runtime-seal-deltas-')))
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
  const userDataDir = await realpath(await mkdtemp(join(tmpdir(), 'evidence-runtime-replay-')))
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
  const userDataDir = await realpath(await mkdtemp(join(tmpdir(), 'evidence-runtime-unscoped-')))
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
  const userDataDir = await realpath(await mkdtemp(join(tmpdir(), 'evidence-runtime-status-')))
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
  const userDataDir = await realpath(await mkdtemp(join(tmpdir(), 'evidence-runtime-unbound-status-')))
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
  const userDataDir = await realpath(await mkdtemp(join(tmpdir(), 'evidence-runtime-execution-')))
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

test('pinned graph view starts the read service and binds exact snapshot or reports missing', async () => {
  const userDataDir = await realpath(await mkdtemp(join(tmpdir(), 'evidence-pinned-view-')))
  let ready = 0, unavailable = false
  const digest = 'sha256:' + 'a'.repeat(64)
  const runtime = new EvidenceDagRuntime({ userDataDir,
    sidecar: { configure: () => undefined, endpoint: () => ({ baseUrl: 'http://127.0.0.1:3897', apiKey: 'fixture' }), ensureReady: async () => { ready++ }, stop: async () => undefined },
    fetchImpl: async (url, init) => {
      assert.equal(init?.method, 'GET')
      assert.equal(new URL(String(url)).searchParams.get('snapshotDigest'), digest)
      if (unavailable) throw new Error('sidecar offline')
      return new Response(JSON.stringify({ ok: true, data: { binding: { status: 'resolved', snapshotDigest: digest }, snapshot: {
        threadId: 'codex:thread-1', digest, version: 1, inputWatermark: '1', schemaVersion: 'evidence.v3', extractorVersion: 'extractor.v3',
        verifierVersion: 'verifier.v3', artifactDigests: [], createdAt: '2026-01-01T00:00:00Z', status: 'committed'
      } } }), { headers: { 'content-type': 'application/json' } })
    }
  })
  await runtime.activate(runtimeContext(userDataDir, '/workspace'))
  const activationReadiness = ready
  try {
    const request = { runtimeId: 'codex', threadId: 'thread-1', workspaceRoot: '/workspace', snapshotDigest: digest }
    const resolved = await runtime.view(request)
    assert.equal(resolved.binding?.status, 'resolved')
    assert.equal(new URL(resolved.url!).searchParams.get('snapshotDigest'), digest)
    assert.equal(resolved.status.committed?.digest, digest)
    unavailable = true
    const missing = await runtime.view(request)
    assert.equal(missing.url, null)
    assert.equal(missing.binding?.status, 'missing')
    assert.equal(ready, activationReadiness + 2)
    const query = await runtime.auditQuery({ subject: { threadId: 'codex:thread-1' }, workspaceRoot: '/workspace' })
    assert.equal(query.reviewDecisions?.status, 'unavailable')
    assert.deepEqual(query.records, [])
    assert.equal(ready, activationReadiness + 2)
  } finally { await runtime.close() }
})

test('audit query reads exact closure decisions after current host authorization and preserves records when offline', async () => {
  const userDataDir = await realpath(await mkdtemp(join(tmpdir(), 'evidence-review-query-')))
  const path = join(userDataDir, 'fixture-deltas.json'), deltaStore = new EvidenceDagDeltaStore(path)
  const digest = 'sha256:' + 'd'.repeat(64), engineThreadId = 'codex:thread-1'
  const appended = await deltaStore.append(evidenceDagDeltaInputFromTrace({ runtimeId: 'codex', threadId: engineThreadId,
    workspaceRoot: '/workspace', operationId: 'one', kind: 'turn', requestedWatermark: '1', idempotencyKey: 'fixture-turn-one',
    trace: [{ id: 'claim:one', text: 'A fixture claim' }], createdAt: '2026-01-01T00:00:00Z' }))
  const closure = await deltaStore.seal(engineThreadId, { version: 'EvidenceClosurePolicyV1', targetClaimIds: ['claim:one'],
    expectedHeadDigest: appended.delta.deltaDigest, barrierWatermark: '1', edgeFamilies: [], directions: ['inbound'], maxDepth: 0,
    termination: 'depth', expandEquivalent: false, expandRefinement: false, cycleHandling: 'allow', unknownEdgeHandling: 'ignore', requiredRecords: [], requiredExternalRefs: [] })
  await deltaStore.recordCommittedSnapshot(engineThreadId, { threadId: engineThreadId, digest, version: 1, inputWatermark: '1',
    schemaVersion: 'evidence.v3', extractorVersion: 'test', verifierVersion: 'test', artifactDigests: [], createdAt: '2026-01-01T00:00:00Z' }, closure.closureDigest)
  await deltaStore.appendSidechain({ threadId: engineThreadId, closureDigest: closure.closureDigest, recordId: 'audit:one', recordType: 'audit',
    producerIdentity: 'fixture', idempotencyKey: 'fixture-audit-one', payload: {}, createdAt: '2026-01-01T00:00:00Z' })
  let offline = false, requests = 0, ready = 0, ambiguous = false
  const runtime = new EvidenceDagRuntime({ userDataDir, deltaStore,
    sidecar: { configure: () => undefined, endpoint: () => ({ baseUrl: 'http://127.0.0.1:3897', apiKey: 'fixture' }), ensureReady: async () => { ready++ }, stop: async () => undefined },
    fetchImpl: async (url, init) => {
      requests++
      const query = new URL(String(url))
      assert.equal(query.pathname, '/threads/codex%3Athread-1/human-reviews')
      assert.equal(query.searchParams.get('snapshotDigest'), digest)
      assert.equal(init?.method, 'GET')
      if (offline) throw new Error('offline')
      return new Response(JSON.stringify({ ok: true, data: { status: 'available', reasons: [], scope: { threadId: engineThreadId, snapshotDigest: digest, artifactVersionRef: null }, asOf: query.searchParams.get('asOf'), records: [{
        eventId: 'event:one', sequence: 1, type: 'HumanReviewDecisionRecorded', persistent: true, idempotencyKey: 'fixture-one',
        occurredAt: '2026-01-01T00:00:00Z', threadId: engineThreadId, snapshotDigest: digest, reviewPacketId: 'packet:one',
        action: 'approve', actor: 'fixture-label', rationale: 'Exact scope only', reviewReceipt: {
          scope: { kind: 'review-packet', snapshotDigest: digest, reviewPacketId: 'packet:one', targetIds: ['claim:one'], assessmentIds: [] },
          identity: { status: 'unverified', source: 'caller-label', principal: null }, timing: { status: 'unknown', elapsedMs: null, activeMs: null }, previousDecisionEventId: null
        }
      }] } }), { headers: { 'content-type': 'application/json' } })
    }
  })
  const baseContext = runtimeContext(userDataDir, '/workspace')
  const context = { ...baseContext, agentThreads: { ...baseContext.agentThreads, read: async (input: { runtimeId: string; threadId: string }) => ({ ...await baseContext.agentThreads.read(input), id: ambiguous ? input.threadId : 'thread-1' }) } }
  await runtime.activate(context)
  try {
    await runtime.snapshotStatus({ runtimeId: 'codex', threadId: 'thread-1', workspaceRoot: '/workspace' })
    const before = await readFile(path, 'utf8'), activationReadiness = ready
    const input = { subject: { closureDigest: closure.closureDigest }, workspaceRoot: '/workspace', asOf: '2026-01-02T00:00:00Z' }
    const available = await runtime.auditQuery(input)
    assert.equal(available.reviewDecisions?.status, 'available')
    assert.equal(available.reviewDecisions?.records[0].eventId, 'event:one')
    assert.equal(available.records.length, 1)
    offline = true
    const missing = await runtime.auditQuery(input)
    assert.equal(missing.reviewDecisions?.status, 'unavailable')
    assert.deepEqual(missing.records, available.records)
    assert.equal(requests, 2)
    assert.equal(ready, activationReadiness + 2)
    assert.equal(await readFile(path, 'utf8'), before)
    assert.equal((await runtime.auditQuery({ ...input, workspaceRoot: '/other' })).reviewDecisions?.status, 'unavailable')
    assert.equal(requests, 2)
    ambiguous = true
    assert.equal((await runtime.auditQuery(input)).reviewDecisions?.status, 'unavailable')
    assert.equal(requests, 2)
  } finally { await runtime.close() }
})

test('closed runtime keeps accepted raw delta without publishing a late derived view', async () => {
  const userDataDir = await realpath(await mkdtemp(join(tmpdir(), 'evidence-close-derivation-')))
  const store = new EvidenceDagDeltaStore(join(userDataDir, 'fixture.json'))
  const runtime = new EvidenceDagRuntime({ userDataDir, deltaStore: store,
    sidecar: { configure: () => undefined, endpoint: () => ({ baseUrl: 'http://127.0.0.1:3897', apiKey: 'fixture' }), ensureReady: async () => undefined, stop: async () => undefined } })
  await runtime.activate(runtimeContext(userDataDir, '/workspace'))
  await runtime.snapshotStatus({ runtimeId: 'codex', threadId: 'thread-1', workspaceRoot: '/workspace' })
  const append = store.append.bind(store)
  let accepted!: () => void, release!: () => void
  const reached = new Promise<void>(resolve => { accepted = resolve })
  const blocked = new Promise<void>(resolve => { release = resolve })
  store.append = async input => { const result = await append(input); accepted(); await blocked; return result }
  const pending = runtime.consume({ contractVersion: 1, kind: 'turn-completed', runtimeId: 'codex', threadId: 'thread-1',
    workspaceRoot: '/workspace', turnId: 'late', targetWatermark: '7', occurredAt: '2026-07-26T00:00:00Z',
    artifacts: [{ id: 'claim:late', text: 'Persist this produced research fact.' }] })
  await reached
  await runtime.close()
  release()
  await pending
  assert.ok((await store.head('codex:thread-1')).headDigest)
  assert.equal(await store.provisional('codex:thread-1'), null)
})
