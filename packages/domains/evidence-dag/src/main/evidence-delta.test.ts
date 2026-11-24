import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, mkdtemp, readFile, realpath, rename, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  evidenceDagCommittedSnapshotSchema,
  evidenceDagClosurePolicyV1Schema,
  evidenceDagIndependenceMetadataV1Schema
} from '../contract.js'
import {
  EvidenceDagSealError,
  EvidenceDagDeltaStore,
  EvidenceDeltaChain,
  digest,
  digestBytes,
  evidenceDagDeltaInputFromTrace,
  evaluateEvidenceDagIndependence
} from './evidence-delta.js'

const createdAt = '2026-09-01T00:00:00.000Z'
const scope = {
  runtimeId: 'codex',
  threadId: 'thread-evidence',
  operationId: 'turn-1',
  kind: 'turn' as const,
  workspaceRoot: '/workspace'
}

function appendInput(overrides: Record<string, unknown> = {}) {
  return {
    scope,
    requestedWatermark: '1',
    committedWatermark: '1',
    schemaVersion: 'evidence.delta.v1',
    extractorVersion: 'extractor-1',
    verifierVersion: 'verifier-1',
    idempotencyKey: 'turn-1-idempotency',
    sourceRefs: ['source:1'],
    artifactRefs: ['artifact-version:1'],
    runRefs: ['run:1'],
    payload: { claims: [{ id: 'claim:1', text: 'A result.' }] },
    createdAt,
    ...overrides
  }
}

function snapshotInput(overrides: Record<string, unknown> = {}) {
  return evidenceDagCommittedSnapshotSchema.parse({
    threadId: scope.threadId,
    version: 1,
    digest: `sha256:${'a'.repeat(64)}`,
    inputWatermark: '1',
    schemaVersion: 'evidence.v3',
    extractorVersion: 'extractor.v3',
    verifierVersion: 'verifier.v3',
    artifactDigests: [],
    createdAt,
    ...overrides
  })
}

function completeClosurePolicy(headDigest: string, barrierWatermark = '1') {
  return evidenceDagClosurePolicyV1Schema.parse({
    version: 'EvidenceClosurePolicyV1',
    targetClaimIds: ['claim:1'],
    expectedHeadDigest: headDigest,
    barrierWatermark,
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
  })
}

test('appends immutable deltas and returns the same identity for an exact replay', () => {
  const chain = new EvidenceDeltaChain(scope.threadId)
  const first = chain.append(appendInput())
  const replay = chain.append(appendInput())

  assert.equal(first.idempotent, false)
  assert.equal(replay.idempotent, true)
  assert.equal(replay.delta.deltaDigest, first.delta.deltaDigest)
  assert.equal(chain.head.headDigest, first.delta.deltaDigest)
  assert.equal(chain.head.sequence, 1)
  assert.equal(chain.list().length, 1)
})

test('replays a delta with omitted generated fields without changing its identity', () => {
  const chain = new EvidenceDeltaChain(scope.threadId)
  const first = chain.append(appendInput()).delta
  const replay = chain.append(appendInput({ createdAt: undefined, committedWatermark: undefined }))

  assert.equal(replay.idempotent, true)
  assert.deepEqual(replay.delta, first)
})

test('fails closed when an idempotency key is reused with changed payload', () => {
  const chain = new EvidenceDeltaChain(scope.threadId)
  chain.append(appendInput())
  assert.throws(
    () => chain.append(appendInput({ payload: { claims: [{ id: 'claim:1', text: 'Changed.' }] } })),
    /idempotency key .* reused with different content/u
  )
})

test('rejects runtime or workspace identity drift within one chain', () => {
  const chain = new EvidenceDeltaChain(scope.threadId)
  chain.append(appendInput())
  assert.throws(
    () => chain.append(appendInput({
      operationId: 'turn-2',
      idempotencyKey: 'turn-2-idempotency',
      scope: { ...scope, runtimeId: 'other-runtime' }
    })),
    /scope identity drifted/u
  )
})

test('accepts equivalent workspace paths across turns without rewriting immutable delta identities', () => {
  const nativeWorkspace = join(tmpdir(), 'evidence-workspace')
  const initialWorkspace = process.platform === 'win32'
    ? nativeWorkspace.replace(/\\/g, '/')
    : `${nativeWorkspace}/./`
  const chain = new EvidenceDeltaChain(scope.threadId)
  const first = chain.append(appendInput({ scope: { ...scope, workspaceRoot: initialWorkspace } })).delta
  const nextInput = appendInput({
    scope: { ...scope, operationId: 'turn-2', workspaceRoot: nativeWorkspace },
    idempotencyKey: 'turn-2-idempotency', requestedWatermark: '2', committedWatermark: '2'
  })
  const second = chain.append(nextInput).delta

  assert.deepEqual(chain.list()[0], first)
  assert.equal(first.scope.workspaceRoot, initialWorkspace)
  assert.equal(second.scope.workspaceRoot, nativeWorkspace)
  assert.equal(second.predecessorDigest, first.deltaDigest)
  const reloaded = new EvidenceDeltaChain(scope.threadId, chain.list())
  assert.deepEqual(reloaded.list(), [first, second])
  assert.deepEqual(reloaded.append(nextInput), { delta: second, idempotent: true })
  assert.throws(() => reloaded.append(appendInput({
    scope: { ...scope, operationId: 'turn-3', workspaceRoot: join(nativeWorkspace, 'other') },
    idempotencyKey: 'turn-3-idempotency', requestedWatermark: '3', committedWatermark: '3'
  })), /scope identity drifted/u)
})

test('rejects stale predecessor and stale expected head during seal', () => {
  const chain = new EvidenceDeltaChain(scope.threadId)
  const first = chain.append(appendInput())
  chain.append(appendInput({
    operationId: 'turn-2',
    idempotencyKey: 'turn-2-idempotency',
    requestedWatermark: '2',
    committedWatermark: '2',
    predecessorDigest: first.delta.deltaDigest,
    createdAt: '2026-09-01T00:00:01.000Z'
  }))

  assert.throws(
    () => chain.append(appendInput({
      operationId: 'turn-stale',
      idempotencyKey: 'turn-stale-idempotency',
      predecessorDigest: first.delta.deltaDigest
    })),
    (error: unknown) => error instanceof EvidenceDagSealError && error.code === 'invalid_predecessor'
  )
  const policy = evidenceDagClosurePolicyV1Schema.parse({
    version: 'EvidenceClosurePolicyV1',
    targetClaimIds: ['claim:1'],
    expectedHeadDigest: first.delta.deltaDigest,
    barrierWatermark: '2',
    edgeFamilies: ['provenance'],
    directions: ['inbound'],
    maxDepth: 8,
    termination: 'fixed_point',
    expandEquivalent: true,
    expandRefinement: true,
    cycleHandling: 'allow',
    unknownEdgeHandling: 'record_gap',
    requiredRecords: [],
    requiredExternalRefs: []
  })
  assert.throws(
    () => chain.seal(policy),
    (error: unknown) => error instanceof EvidenceDagSealError && error.code === 'stale_head'
  )
})

test('does not treat an explicit null predecessor as an omitted predecessor', () => {
  const chain = new EvidenceDeltaChain(scope.threadId)
  const first = chain.append(appendInput()).delta

  assert.throws(
    () => chain.append(appendInput({
      operationId: 'turn-2',
      idempotencyKey: 'turn-2-idempotency',
      requestedWatermark: '2',
      committedWatermark: '2',
      predecessorDigest: null,
      createdAt: '2026-09-01T00:00:01.000Z'
    })),
    (error: unknown) => error instanceof EvidenceDagSealError && error.code === 'invalid_predecessor'
  )
  assert.equal(chain.head.headDigest, first.deltaDigest)
})

test('keeps last-good provisional content and bounded failure separate from desired head', () => {
  const chain = new EvidenceDeltaChain(scope.threadId)
  const first = chain.append(appendInput()).delta
  const lastGood = chain.provisional({
    compilerVersion: 'compiler-1',
    policyVersion: 'policy-1',
    desiredHeadDigest: first.deltaDigest,
    now: createdAt
  })
  const second = chain.append(appendInput({
    operationId: 'turn-2',
    idempotencyKey: 'turn-2-idempotency',
    requestedWatermark: '2',
    committedWatermark: '2',
    predecessorDigest: first.deltaDigest,
    createdAt: '2026-09-01T00:00:01.000Z'
  })).delta
  const view = chain.provisional({
    compilerVersion: 'compiler-1',
    policyVersion: 'policy-1',
    desiredHeadDigest: second.deltaDigest,
    failure: {
      code: 'upstream_timeout',
      message: 'Compiler timed out.',
      retryable: true,
      occurredAt: '2026-09-01T00:00:02.000Z'
    },
    now: '2026-09-01T00:00:02.000Z'
  })

  assert.equal(view.summary.freshness, 'failed')
  assert.equal(view.summary.failure?.code, 'upstream_timeout')
  assert.deepEqual(view.lastGood, lastGood.lastGood)
  assert.equal(view.desiredHeadDigest, second.deltaDigest)
  assert.equal(view.appliedHeadDigest, first.deltaDigest)
})

test('retries a failed provisional compile during restart reconciliation', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'evidence-delta-reconcile-')))
  const storagePath = join(directory, 'evidence-deltas.json')
  const store = new EvidenceDagDeltaStore(storagePath)
  const first = await store.append(appendInput())
  await store.compileProvisional(scope.threadId, {
    compilerVersion: 'compiler-1',
    policyVersion: 'policy-1',
    desiredHeadDigest: first.delta.deltaDigest,
    failure: {
      code: 'upstream_timeout',
      message: 'Compiler timed out.',
      retryable: true,
      occurredAt: '2026-09-01T00:00:01.000Z'
    },
    now: '2026-09-01T00:00:01.000Z'
  })

  const restarted = new EvidenceDagDeltaStore(storagePath)
  await restarted.reconcileProvisional({
    compilerVersion: 'compiler-1',
    policyVersion: 'policy-1',
    now: '2026-09-01T00:00:02.000Z'
  })
  const recovered = await restarted.provisional(scope.threadId)
  assert.equal(recovered?.summary.freshness, 'fresh')
  assert.equal(recovered?.summary.failure, null)
  assert.equal(recovered?.appliedHeadDigest, first.delta.deltaDigest)
})

test('recompiles a fresh provisional view when compiler or policy identity changes', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'evidence-delta-versioned-reconcile-')))
  const storagePath = join(directory, 'evidence-deltas.json')
  const store = new EvidenceDagDeltaStore(storagePath)
  const first = await store.append(appendInput())
  await store.compileProvisional(scope.threadId, {
    compilerVersion: 'compiler-1',
    policyVersion: 'policy-1',
    desiredHeadDigest: first.delta.deltaDigest,
    now: '2026-09-01T00:00:01.000Z'
  })

  await store.reconcileProvisional({
    compilerVersion: 'compiler-2',
    policyVersion: 'policy-2',
    now: '2026-09-01T00:00:02.000Z'
  })
  const recovered = await store.provisional(scope.threadId)
  assert.equal(recovered?.compilerVersion, 'compiler-2')
  assert.equal(recovered?.policyVersion, 'policy-2')
  assert.equal(recovered?.summary.freshness, 'fresh')
})

test('seals only the exact expected head and records barrier gaps', () => {
  const chain = new EvidenceDeltaChain(scope.threadId)
  const first = chain.append(appendInput())
  const policy = evidenceDagClosurePolicyV1Schema.parse({
    version: 'EvidenceClosurePolicyV1',
    targetClaimIds: ['claim:1'],
    expectedHeadDigest: first.delta.deltaDigest,
    barrierWatermark: '2',
    edgeFamilies: ['provenance'],
    directions: ['inbound'],
    maxDepth: 8,
    termination: 'fixed_point',
    expandEquivalent: true,
    expandRefinement: true,
    cycleHandling: 'allow',
    unknownEdgeHandling: 'record_gap',
    requiredRecords: ['claim:1'],
    requiredExternalRefs: ['artifact-version:1']
  })
  const closure = chain.seal(policy)

  assert.equal(closure.status, 'incomplete')
  assert.deepEqual(closure.gapCodes, ['missing_delta'])
  assert.deepEqual(closure.includedDeltaDigests, [first.delta.deltaDigest])
  assert.deepEqual(closure.includedExternalRefs, [
    'artifact-version:1',
    'run:1',
    'source:1'
  ])
  assert.equal(closure.closureDigest, digest({
    threadId: scope.threadId,
    headDigest: first.delta.deltaDigest,
    policyDigest: closure.policyDigest,
    status: 'incomplete',
    includedDeltaDigests: [first.delta.deltaDigest],
    includedExternalRefs: ['artifact-version:1', 'run:1', 'source:1'],
    gapCodes: ['missing_delta']
  }))
})

test('preserves an immutable closure byte-for-byte on an exact re-seal', () => {
  const chain = new EvidenceDeltaChain(scope.threadId)
  const first = chain.append(appendInput()).delta
  const policy = evidenceDagClosurePolicyV1Schema.parse({
    version: 'EvidenceClosurePolicyV1',
    targetClaimIds: ['claim:1'],
    expectedHeadDigest: first.deltaDigest,
    barrierWatermark: '1',
    edgeFamilies: ['provenance'],
    directions: ['inbound'],
    maxDepth: 8,
    termination: 'fixed_point',
    expandEquivalent: true,
    expandRefinement: true,
    cycleHandling: 'allow',
    unknownEdgeHandling: 'record_gap',
    requiredRecords: ['claim:1'],
    requiredExternalRefs: ['artifact-version:1']
  })

  const sealed = chain.seal(policy)
  const replay = chain.seal(policy)
  assert.deepEqual(replay, sealed)
  assert.equal(chain.closures().length, 1)
})

test('binds seal idempotency keys to one immutable closure across restart', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'evidence-seal-idempotency-')))
  const storagePath = join(directory, 'deltas.json')
  const store = new EvidenceDagDeltaStore(storagePath)
  const first = await store.append(appendInput())
  const policy = evidenceDagClosurePolicyV1Schema.parse({
    version: 'EvidenceClosurePolicyV1',
    targetClaimIds: ['claim:1'],
    expectedHeadDigest: first.delta.deltaDigest,
    barrierWatermark: '1',
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
  })
  const closure = await store.seal(scope.threadId, policy, 'seal-key-1')
  const restarted = new EvidenceDagDeltaStore(storagePath)
  const replay = await restarted.seal(scope.threadId, policy, 'seal-key-1')
  assert.deepEqual(replay, closure)
  await assert.rejects(() => restarted.seal(scope.threadId, {
    ...policy,
    targetClaimIds: ['claim:2']
  }, 'seal-key-1'), /reused for a different closure/u)
})

test('retries an idempotent seal after a newer delta advances the live head', () => {
  const chain = new EvidenceDeltaChain(scope.threadId)
  const first = chain.append(appendInput()).delta
  const policy = evidenceDagClosurePolicyV1Schema.parse({
    version: 'EvidenceClosurePolicyV1',
    targetClaimIds: ['claim:1'],
    expectedHeadDigest: first.deltaDigest,
    barrierWatermark: '1',
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
  })
  const closure = chain.seal(policy, 'seal-retry-after-head-advance')
  chain.append(appendInput({
    operationId: 'turn-2',
    idempotencyKey: 'turn-2-idempotency',
    requestedWatermark: '2',
    committedWatermark: '2',
    predecessorDigest: first.deltaDigest,
    createdAt: '2026-09-01T00:00:01.000Z'
  }))

  assert.deepEqual(
    chain.seal(policy, 'seal-retry-after-head-advance'),
    closure
  )
  assert.throws(
    () => chain.seal({ ...policy, barrierWatermark: '2' }, 'seal-retry-after-head-advance'),
    (error: unknown) => error instanceof EvidenceDagSealError && error.code === 'invalid_sidechain'
  )
})

test('persists the latest committed Snapshot while retaining historical closure bindings', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'evidence-snapshot-bindings-')))
  const storagePath = join(directory, 'deltas.json')
  const store = new EvidenceDagDeltaStore(storagePath)
  const first = await store.append(appendInput())
  const firstPolicy = evidenceDagClosurePolicyV1Schema.parse({
    version: 'EvidenceClosurePolicyV1',
    targetClaimIds: ['claim:1'],
    expectedHeadDigest: first.delta.deltaDigest,
    barrierWatermark: '1',
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
  })
  const firstClosure = await store.seal(scope.threadId, firstPolicy, 'seal-binding-1')
  const firstSnapshot = evidenceDagCommittedSnapshotSchema.parse({
    threadId: scope.threadId,
    version: 1,
    digest: `sha256:${'1'.repeat(64)}`,
    inputWatermark: '1',
    schemaVersion: 'evidence.v3',
    extractorVersion: 'extractor.v3',
    verifierVersion: 'verifier.v3',
    artifactDigests: [],
    createdAt
  })
  await store.recordCommittedSnapshot(scope.threadId, firstSnapshot, firstClosure.closureDigest)

  const second = await store.append(appendInput({
    operationId: 'turn-2',
    idempotencyKey: 'turn-2-idempotency',
    requestedWatermark: '2',
    committedWatermark: '2',
    predecessorDigest: first.delta.deltaDigest,
    createdAt: '2026-09-01T00:00:01.000Z'
  }))
  const secondClosure = await store.seal(scope.threadId, evidenceDagClosurePolicyV1Schema.parse({
    ...firstPolicy,
    expectedHeadDigest: second.delta.deltaDigest,
    barrierWatermark: '2'
  }), 'seal-binding-2')
  const secondSnapshot = evidenceDagCommittedSnapshotSchema.parse({
    ...firstSnapshot,
    version: 2,
    digest: `sha256:${'2'.repeat(64)}`,
    inputWatermark: '2',
    createdAt: '2026-09-01T00:00:01.000Z'
  })
  await store.recordCommittedSnapshot(scope.threadId, secondSnapshot, secondClosure.closureDigest)

  const restarted = new EvidenceDagDeltaStore(storagePath)
  const restored = await restarted.chain(scope.threadId)
  assert.deepEqual(restored.committedEvidenceSnapshot, secondSnapshot)
  assert.equal(restored.committedSnapshotClosure, secondClosure.closureDigest)
  assert.deepEqual(restored.committedSnapshotClosureEntries(), [
    [firstClosure.closureDigest, firstSnapshot.digest],
    [secondClosure.closureDigest, secondSnapshot.digest]
  ])
})

test('requires every committed Snapshot to bind to an existing complete closure', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'evidence-snapshot-binding-required-')))
  const store = new EvidenceDagDeltaStore(join(directory, 'deltas.json'))
  await store.append(appendInput())
  const snapshot = snapshotInput()

  await assert.rejects(
    () => store.recordCommittedSnapshot(scope.threadId, snapshot, undefined as never),
    (error: unknown) => error instanceof EvidenceDagSealError &&
      error.code === 'invalid_sidechain' &&
      /requires a closure digest/u.test(error.message)
  )
  await assert.rejects(
    () => store.recordCommittedSnapshot(scope.threadId, snapshot, `sha256:${'f'.repeat(64)}`),
    /unknown closure/u
  )
  assert.equal(await store.committedSnapshot(scope.threadId), null)
})

test('rejects a Snapshot whose watermark does not cover its closure barrier or head', () => {
  const chain = new EvidenceDeltaChain(scope.threadId)
  const first = chain.append(appendInput()).delta
  const barrierClosure = chain.seal(completeClosurePolicy(first.deltaDigest, '1'))

  assert.throws(
    () => chain.setCommittedEvidenceSnapshot(snapshotInput({ inputWatermark: '0' }), barrierClosure.closureDigest),
    /(?:does not cover|must exactly match) the closure barrier/u
  )

  const second = chain.append(appendInput({
    operationId: 'turn-2',
    idempotencyKey: 'turn-2-idempotency',
    requestedWatermark: '2',
    committedWatermark: '2',
    predecessorDigest: first.deltaDigest,
    createdAt: '2026-09-01T00:00:01.000Z'
  })).delta
  const historicalBarrierClosure = chain.seal(completeClosurePolicy(second.deltaDigest, '1'))
  assert.equal(historicalBarrierClosure.status, 'complete')
  assert.throws(
    () => chain.setCommittedEvidenceSnapshot(
      snapshotInput({ inputWatermark: '1', digest: `sha256:${'b'.repeat(64)}` }),
      historicalBarrierClosure.closureDigest
    ),
    /must exactly match the closure head/u
  )
})

test('rejects a Snapshot watermark that only covers a closure barrier and head', () => {
  const chain = new EvidenceDeltaChain(scope.threadId)
  const first = chain.append(appendInput()).delta
  const closure = chain.seal(completeClosurePolicy(first.deltaDigest, '1'))

  assert.throws(
    () => chain.setCommittedEvidenceSnapshot(
      snapshotInput({ inputWatermark: '2' }),
      closure.closureDigest
    ),
    /must exactly match the closure barrier/u
  )
})

test('accepts only a Snapshot watermark exactly equal to the closure barrier and head', () => {
  const chain = new EvidenceDeltaChain(scope.threadId)
  const first = chain.append(appendInput()).delta
  const closure = chain.seal(completeClosurePolicy(first.deltaDigest, '1'))

  chain.setCommittedEvidenceSnapshot(snapshotInput({ inputWatermark: '1' }), closure.closureDigest)

  assert.equal(chain.committedEvidenceSnapshot?.inputWatermark, '1')
})

test('rejects committed Snapshot version regressions and same-version identity drift', () => {
  const chain = new EvidenceDeltaChain(scope.threadId)
  const first = chain.append(appendInput()).delta
  const closure = chain.seal(completeClosurePolicy(first.deltaDigest))
  const committed = snapshotInput()
  chain.setCommittedEvidenceSnapshot(committed, closure.closureDigest)

  assert.throws(
    () => chain.setCommittedEvidenceSnapshot(
      snapshotInput({ version: 0, digest: `sha256:${'c'.repeat(64)}` }),
      closure.closureDigest
    ),
    /version regressed/u
  )
  assert.throws(
    () => chain.setCommittedEvidenceSnapshot(
      snapshotInput({ inputWatermark: '2' }),
      closure.closureDigest
    ),
    /identity was mutated/u
  )
  assert.deepEqual(chain.committedEvidenceSnapshot, committed)
})

test('keeps a historical closure valid after appending a newer head', () => {
  const chain = new EvidenceDeltaChain(scope.threadId)
  const first = chain.append(appendInput()).delta
  const policy = evidenceDagClosurePolicyV1Schema.parse({
    version: 'EvidenceClosurePolicyV1',
    targetClaimIds: ['claim:1'],
    expectedHeadDigest: first.deltaDigest,
    barrierWatermark: '1',
    edgeFamilies: ['provenance'],
    directions: ['inbound'],
    maxDepth: 8,
    termination: 'fixed_point',
    expandEquivalent: true,
    expandRefinement: true,
    cycleHandling: 'allow',
    unknownEdgeHandling: 'record_gap',
    requiredRecords: ['claim:1'],
    requiredExternalRefs: []
  })
  const closure = chain.seal(policy)
  chain.append(appendInput({
    operationId: 'turn-2',
    idempotencyKey: 'turn-2-idempotency',
    requestedWatermark: '2',
    committedWatermark: '2',
    predecessorDigest: first.deltaDigest,
    createdAt: '2026-09-01T00:00:01.000Z'
  }))

  const restarted = new EvidenceDeltaChain(scope.threadId, chain.list(), {
    closures: [closure]
  })
  assert.deepEqual(restarted.closures(), [closure])
})

test('appends sidechain records without backfilling the sealed closure and replays them idempotently', () => {
  const chain = new EvidenceDeltaChain(scope.threadId)
  const first = chain.append(appendInput()).delta
  const closure = chain.seal(evidenceDagClosurePolicyV1Schema.parse({
    version: 'EvidenceClosurePolicyV1',
    targetClaimIds: ['claim:1'],
    expectedHeadDigest: first.deltaDigest,
    barrierWatermark: '1',
    edgeFamilies: ['provenance'],
    directions: ['inbound'],
    maxDepth: 8,
    termination: 'fixed_point',
    expandEquivalent: true,
    expandRefinement: true,
    cycleHandling: 'allow',
    unknownEdgeHandling: 'record_gap',
    requiredRecords: ['claim:1'],
    requiredExternalRefs: ['artifact-version:1']
  }))
  const input = {
    threadId: scope.threadId,
    recordId: 'review:1',
    recordType: 'review' as const,
    closureDigest: closure.closureDigest,
    idempotencyKey: 'review-1-idempotency',
    payload: { verdict: 'hold' },
    producerIdentity: 'researcher:1',
    reviewerIdentity: 'reviewer:1',
    createdAt: '2026-09-01T00:00:02.000Z'
  }

  const firstAppend = chain.appendSidechain(input)
  const replay = chain.appendSidechain({ ...input, createdAt: undefined })

  assert.equal(firstAppend.idempotent, false)
  assert.equal(replay.idempotent, true)
  assert.deepEqual(replay.record, firstAppend.record)
  assert.deepEqual(chain.closures(), [closure])
  assert.deepEqual(chain.sidechainRecords(), [firstAppend.record])
})

test('requires a complete closure Snapshot for approval and certification sidechains', () => {
  const chain = new EvidenceDeltaChain(scope.threadId)
  const first = chain.append(appendInput()).delta
  const closure = chain.seal(completeClosurePolicy(first.deltaDigest))
  const approval = {
    threadId: scope.threadId,
    recordId: 'approval:1',
    recordType: 'approval' as const,
    closureDigest: closure.closureDigest,
    idempotencyKey: 'approval-1-idempotency',
    payload: { classification: 'certified' },
    producerIdentity: 'researcher:1',
    reviewerIdentity: 'reviewer:1',
    createdAt: '2026-09-01T00:00:02.000Z'
  }

  assert.throws(
    () => chain.appendSidechain(approval),
    (error: unknown) => error instanceof EvidenceDagSealError &&
      /require a complete closure bound to a committed Snapshot/u.test(error.message)
  )
  chain.setCommittedEvidenceSnapshot(snapshotInput(), closure.closureDigest)
  const appended = chain.appendSidechain(approval)
  assert.equal(appended.idempotent, false)
  assert.equal(appended.record.recordType, 'approval')
})

test('canonicalizes closure policy sets before deriving the policy digest', () => {
  const chain = new EvidenceDeltaChain(scope.threadId)
  const first = chain.append(appendInput()).delta
  const base = {
    version: 'EvidenceClosurePolicyV1' as const,
    targetClaimIds: ['claim:1'],
    expectedHeadDigest: first.deltaDigest,
    barrierWatermark: '1',
    edgeFamilies: ['provenance', 'equivalent'],
    directions: ['inbound', 'outbound'],
    maxDepth: 8,
    termination: 'fixed_point' as const,
    expandEquivalent: true,
    expandRefinement: true,
    cycleHandling: 'allow' as const,
    unknownEdgeHandling: 'record_gap' as const,
    requiredRecords: ['claim:1'],
    requiredExternalRefs: ['artifact-version:1']
  }
  const firstClosure = chain.seal(evidenceDagClosurePolicyV1Schema.parse(base))
  const reorderedClosure = chain.seal(evidenceDagClosurePolicyV1Schema.parse({
    ...base,
    edgeFamilies: ['equivalent', 'provenance'],
    directions: ['outbound', 'inbound']
  }))
  assert.deepEqual(reorderedClosure, firstClosure)
})

test('records semantic risk gaps for included contradiction and negative-result records', () => {
  const chain = new EvidenceDeltaChain(scope.threadId)
  const first = chain.append(appendInput({
    payload: {
      claims: [{ id: 'claim:1', text: 'A result.' }],
      interpretation: 'contradiction unresolved; negative result requires review',
      gapCodes: ['contradiction_unresolved', 'negative_result_missing']
    }
  })).delta
  const policy = evidenceDagClosurePolicyV1Schema.parse({
    version: 'EvidenceClosurePolicyV1',
    targetClaimIds: ['claim:1'],
    expectedHeadDigest: first.deltaDigest,
    barrierWatermark: '1',
    edgeFamilies: ['provenance'],
    directions: ['inbound'],
    maxDepth: 8,
    termination: 'fixed_point',
    expandEquivalent: true,
    expandRefinement: true,
    cycleHandling: 'allow',
    unknownEdgeHandling: 'record_gap',
    requiredRecords: ['claim:1'],
    requiredExternalRefs: []
  })

  const closure = chain.seal(policy)
  assert.deepEqual(closure.gapCodes, ['contradiction_unresolved', 'negative_result_missing'])
  assert.equal(closure.status, 'incomplete')
})

test('applies unknown-edge policy to edges reached after the first traversal step', () => {
  const chain = new EvidenceDeltaChain(scope.threadId)
  const first = chain.append(appendInput({
    payload: {
      claims: [{ id: 'claim:1', text: 'A result.' }],
      edges: [{ source: 'claim:2', target: 'claim:1', family: 'provenance' }]
    }
  })).delta
  const second = chain.append(appendInput({
    operationId: 'turn-2',
    idempotencyKey: 'turn-2-idempotency',
    requestedWatermark: '2',
    committedWatermark: '2',
    predecessorDigest: first.deltaDigest,
    payload: {
      claims: [{ id: 'claim:2', text: 'Upstream.' }],
      edges: [{ source: 'claim:3', target: 'claim:2', family: 'future-family' }],
      gapCodes: []
    },
    createdAt: '2026-09-01T00:00:01.000Z'
  })).delta
  const policy = evidenceDagClosurePolicyV1Schema.parse({
    version: 'EvidenceClosurePolicyV1',
    targetClaimIds: ['claim:1'],
    expectedHeadDigest: second.deltaDigest,
    barrierWatermark: '2',
    edgeFamilies: ['provenance'],
    directions: ['inbound'],
    maxDepth: 8,
    termination: 'fixed_point',
    expandEquivalent: true,
    expandRefinement: true,
    cycleHandling: 'allow',
    unknownEdgeHandling: 'record_gap',
    requiredRecords: [],
    requiredExternalRefs: []
  })
  const closure = chain.seal(policy)
  assert.ok(closure.gapCodes.includes('unsupported_edge_family'))
})

test('does not mistake a derivation diamond for a cycle', () => {
  const chain = new EvidenceDeltaChain(scope.threadId)
  const first = chain.append(appendInput({
    payload: {
      claims: [{ id: 'claim:1' }, { id: 'claim:2' }, { id: 'claim:3' }],
      edges: [
        { source: 'claim:1', target: 'claim:2', family: 'provenance' },
        { source: 'claim:1', target: 'claim:3', family: 'provenance' },
        { source: 'claim:2', target: 'claim:3', family: 'provenance' }
      ]
    }
  })).delta
  const closure = chain.seal(evidenceDagClosurePolicyV1Schema.parse({
    version: 'EvidenceClosurePolicyV1',
    targetClaimIds: ['claim:1'],
    expectedHeadDigest: first.deltaDigest,
    barrierWatermark: '1',
    edgeFamilies: ['provenance'],
    directions: ['outbound'],
    maxDepth: 8,
    termination: 'fixed_point',
    expandEquivalent: true,
    expandRefinement: true,
    cycleHandling: 'fail',
    unknownEdgeHandling: 'record_gap',
    requiredRecords: ['claim:3'],
    requiredExternalRefs: []
  }))

  assert.equal(closure.status, 'complete')
  assert.ok(!closure.gapCodes.includes('lineage_incomplete'))
})

test('includes records that share an upstream reference with the target closure', () => {
  const chain = new EvidenceDeltaChain(scope.threadId)
  const first = chain.append(appendInput({
    sourceRefs: ['source:shared'],
    payload: { claims: [{ id: 'claim:1' }] }
  })).delta
  const second = chain.append(appendInput({
    operationId: 'turn-2',
    idempotencyKey: 'turn-2-idempotency',
    requestedWatermark: '2',
    committedWatermark: '2',
    predecessorDigest: first.deltaDigest,
    sourceRefs: ['source:shared'],
    payload: { claims: [{ id: 'claim:2' }] },
    createdAt: '2026-09-01T00:00:01.000Z'
  })).delta
  const closure = chain.seal(evidenceDagClosurePolicyV1Schema.parse({
    version: 'EvidenceClosurePolicyV1',
    targetClaimIds: ['claim:1'],
    expectedHeadDigest: second.deltaDigest,
    barrierWatermark: '2',
    edgeFamilies: [],
    directions: ['inbound'],
    maxDepth: 0,
    termination: 'fixed_point',
    expandEquivalent: true,
    expandRefinement: true,
    cycleHandling: 'allow',
    unknownEdgeHandling: 'ignore',
    requiredRecords: ['claim:2'],
    requiredExternalRefs: []
  }))

  assert.deepEqual(closure.includedDeltaDigests, [first.deltaDigest, second.deltaDigest].sort())
  assert.ok(!closure.gapCodes.includes('lineage_incomplete'))
})

test('fails closed when the head watermark cannot be compared to the barrier', () => {
  const chain = new EvidenceDeltaChain(scope.threadId)
  const first = chain.append(appendInput({
    requestedWatermark: 'opaque:head',
    committedWatermark: 'opaque:head'
  }))
  const policy = evidenceDagClosurePolicyV1Schema.parse({
    version: 'EvidenceClosurePolicyV1',
    targetClaimIds: ['claim:1'],
    expectedHeadDigest: first.delta.deltaDigest,
    barrierWatermark: 'opaque:barrier',
    edgeFamilies: ['provenance'],
    directions: ['inbound'],
    maxDepth: 8,
    termination: 'fixed_point',
    expandEquivalent: true,
    expandRefinement: true,
    cycleHandling: 'allow',
    unknownEdgeHandling: 'record_gap',
    requiredRecords: [],
    requiredExternalRefs: []
  })

  const closure = chain.seal(policy)
  assert.equal(closure.status, 'incomplete')
  assert.deepEqual(closure.gapCodes, ['missing_delta'])
})

test('fails closed when an earlier delta watermark cannot be compared to the barrier', () => {
  const chain = new EvidenceDeltaChain(scope.threadId)
  const first = chain.append(appendInput({
    idempotencyKey: 'first-watermark-family',
    payload: { claims: [{ id: 'claim:prior', text: 'Prior result.' }] }
  }))
  const second = chain.append(appendInput({
    idempotencyKey: 'second-watermark-family',
    requestedWatermark: 'opaque:head',
    committedWatermark: 'opaque:head',
    predecessorDigest: first.delta.deltaDigest,
    payload: { claims: [{ id: 'claim:1', text: 'Current result.' }] }
  }))

  const closure = chain.seal(evidenceDagClosurePolicyV1Schema.parse({
    ...completeClosurePolicy(second.delta.deltaDigest, 'opaque:head'),
    expectedHeadDigest: second.delta.deltaDigest
  }))

  assert.equal(closure.status, 'incomplete')
  assert.ok(closure.gapCodes.includes('missing_delta'))
})

test('closure classifies lifecycle records by their captured thread boundary without conflating receipt coverage', () => {
  const chain = new EvidenceDeltaChain(scope.threadId)
  const first = chain.append(appendInput())
  const lifecycle = chain.append(appendInput({
    scope: { ...scope, kind: 'artifact_lifecycle', operationId: 'artifact-lifecycle:42' },
    idempotencyKey: 'lifecycle-receipt-42',
    predecessorDigest: first.delta.deltaDigest,
    requestedWatermark: '1:artifact-lifecycle:42',
    committedWatermark: '1:artifact-lifecycle:42',
    payload: { claims: [{ id: 'claim:lifecycle', text: 'Captured lifecycle obligation.' }] }
  }))
  const head = chain.append(appendInput({
    predecessorDigest: lifecycle.delta.deltaDigest,
    idempotencyKey: 'manual-after-lifecycle',
    requestedWatermark: '2', committedWatermark: '2'
  }))
  const historical = chain.seal(completeClosurePolicy(head.delta.deltaDigest, '2'))
  assert.ok(historical.gapCodes.includes('missing_delta'))
  const closure = chain.seal({
    ...completeClosurePolicy(head.delta.deltaDigest, '2'),
    watermarkPolicy: 'captured-thread-v2',
    targetClaimIds: ['claim:1', 'claim:lifecycle'],
    requiredRecords: ['claim:lifecycle']
  })
  assert.equal(closure.status, 'complete')
  assert.ok(closure.includedDeltaDigests.includes(lifecycle.delta.deltaDigest))
  const restored = new EvidenceDeltaChain(scope.threadId, chain.list(), { closures: [historical, closure] })
  assert.equal(restored.head.headDigest, head.delta.deltaDigest)
})

test('requires explicit independence metadata for semantic assessments', () => {
  const valid = evidenceDagIndependenceMetadataV1Schema.parse({
    producerIdentity: 'agent:producer',
    reviewerIdentity: 'tool:verifier',
    producerInvocationId: 'invocation:producer',
    reviewerInvocationId: 'invocation:reviewer',
    producerPromptDigest: `sha256:${'a'.repeat(64)}`,
    reviewerPromptDigest: null,
    producerContextDigest: `sha256:${'b'.repeat(64)}`,
    reviewerContextDigest: null,
    effectiveContextDigest: `sha256:${'b'.repeat(64)}`,
    modelOrToolVersion: 'verifier-1',
    predicate: 'deterministic_tool',
    result: 'independent',
    assessedAt: createdAt
  })
  assert.equal(valid.result, 'independent')
  assert.equal(evidenceDagIndependenceMetadataV1Schema.safeParse({ ...valid, result: 'maybe' }).success, false)
  assert.equal(evaluateEvidenceDagIndependence({
    producerInvocationId: 'invocation:1',
    reviewerInvocationId: 'invocation:1',
    predicate: 'distinct_invocation'
  }), 'not_independent')
  assert.equal(evaluateEvidenceDagIndependence({
    producerInvocationId: 'invocation:1',
    predicate: 'distinct_invocation'
  }), 'not_independently_assessed')

  const chain = new EvidenceDeltaChain(scope.threadId)
  assert.throws(
    () => chain.appendAssessment({
      scope: { ...scope, kind: 'assessment' },
      requestedWatermark: '1',
      idempotencyKey: 'assessment-missing-1',
      assessment: { verdict: 'supported' }
    }),
    /requires explicit independence metadata/u
  )
})

test('includes assessment and correction records reached only through target identifiers', () => {
  const chain = new EvidenceDeltaChain(scope.threadId)
  const first = chain.append(appendInput()).delta
  const correction = chain.appendCorrection({
    scope: { ...scope, operationId: 'correction-target-id', kind: 'correction' },
    requestedWatermark: '2',
    idempotencyKey: 'correction-target-id-key',
    correction: {
      recordId: 'correction:target-id',
      targetRecordId: 'claim:1',
      relation: 'corrects',
      reason: 'Corrected extraction.',
      producerIdentity: 'researcher:1',
      reviewerIdentity: null,
      createdAt: '2026-09-01T00:00:01.000Z'
    },
    predecessorDigest: first.deltaDigest,
    createdAt: '2026-09-01T00:00:01.000Z'
  }).delta
  const closure = chain.seal(evidenceDagClosurePolicyV1Schema.parse({
    ...completeClosurePolicy(correction.deltaDigest, '2'),
    expectedHeadDigest: correction.deltaDigest,
    requiredRecords: ['correction:target-id']
  }))

  assert.equal(closure.status, 'complete', JSON.stringify(closure))
  assert.deepEqual(closure.includedDeltaDigests, [first.deltaDigest, correction.deltaDigest].sort())
})

test('does not satisfy required records with an external ref of the same identity', () => {
  const chain = new EvidenceDeltaChain(scope.threadId)
  const first = chain.append(appendInput({
    sourceRefs: ['claim:required-only-as-ref'],
    artifactRefs: [],
    runRefs: []
  })).delta
  const closure = chain.seal(evidenceDagClosurePolicyV1Schema.parse({
    ...completeClosurePolicy(first.deltaDigest),
    requiredRecords: ['claim:required-only-as-ref']
  }))

  assert.equal(closure.status, 'incomplete')
  assert.ok(closure.gapCodes.includes('lineage_incomplete'))
})

test('does not mark an explicitly independent assessment as independence unknown', () => {
  const chain = new EvidenceDeltaChain(scope.threadId)
  const first = chain.append(appendInput({
    sourceRefs: ['source:shared-assessment']
  })).delta
  const assessment = chain.appendAssessment({
    scope: { ...scope, operationId: 'assessment-independent', kind: 'assessment' },
    requestedWatermark: '2',
    idempotencyKey: 'assessment-independent-key',
    sourceRefs: ['source:shared-assessment'],
    assessment: {
      assessmentId: 'assessment:independent',
      targetId: 'claim:1',
      independenceMetadata: {
        producerIdentity: 'agent:producer',
        reviewerIdentity: 'tool:verifier',
        producerInvocationId: 'invocation:producer',
        reviewerInvocationId: 'invocation:reviewer',
        producerPromptDigest: `sha256:${'a'.repeat(64)}`,
        reviewerPromptDigest: null,
        producerContextDigest: `sha256:${'b'.repeat(64)}`,
        reviewerContextDigest: null,
        effectiveContextDigest: `sha256:${'c'.repeat(64)}`,
        modelOrToolVersion: 'verifier-1',
        predicate: 'deterministic_tool',
        result: 'independent',
        assessedAt: createdAt
      }
    },
    predecessorDigest: first.deltaDigest,
    createdAt: '2026-09-01T00:00:01.000Z'
  }).delta
  const closure = chain.seal(evidenceDagClosurePolicyV1Schema.parse({
    ...completeClosurePolicy(assessment.deltaDigest, '2'),
    expectedHeadDigest: assessment.deltaDigest,
    requiredRecords: ['assessment:independent']
  }))

  assert.equal(closure.status, 'complete', JSON.stringify(closure))
  assert.ok(!closure.gapCodes.includes('independence_unknown'))
})

test('appends correction metadata as a new immutable delta', () => {
  const chain = new EvidenceDeltaChain(scope.threadId)
  const first = chain.append(appendInput()).delta
  const correction = chain.appendCorrection({
    scope: { ...scope, operationId: 'correction-1', kind: 'correction' },
    requestedWatermark: '2',
    idempotencyKey: 'correction-1-key',
    correction: {
      recordId: 'claim:1:corrected',
      targetRecordId: 'claim:1',
      relation: 'corrects',
      reason: 'The extracted wording omitted the applicability limit.',
      producerIdentity: 'researcher:1',
      reviewerIdentity: null,
      createdAt: '2026-09-01T00:00:01.000Z'
    },
    predecessorDigest: first.deltaDigest,
    createdAt: '2026-09-01T00:00:01.000Z'
  }).delta

  assert.equal(correction.predecessorDigest, first.deltaDigest)
  assert.equal(correction.sequence, 2)
  assert.deepEqual(correction.payload, {
    recordType: 'correction',
    correction: {
      recordId: 'claim:1:corrected',
      targetRecordId: 'claim:1',
      relation: 'corrects',
      reason: 'The extracted wording omitted the applicability limit.',
      producerIdentity: 'researcher:1',
      reviewerIdentity: null,
      createdAt: '2026-09-01T00:00:01.000Z'
    }
  })
})

test('retains structured lineage activity and version references in delta indexes', () => {
  const input = evidenceDagDeltaInputFromTrace({
    runtimeId: scope.runtimeId,
    threadId: scope.threadId,
    operationId: 'plot-operation-0001',
    kind: 'scientific_provenance',
    requestedWatermark: '2',
    idempotencyKey: 'lineage-index-1',
    workspaceRoot: scope.workspaceRoot,
    trace: [{
      evidenceLineage: {
        activity: { id: 'analysis-run:1', type: 'analysis_run' },
        inputs: [{ id: 'dataset-version:1', type: 'dataset_version' }],
        outputs: [{
          artifact: { artifactVersionRef: { versionId: 'artifact-version:1' } }
        }]
      }
    }]
  })

  assert.deepEqual(input.runRefs, ['analysis-run:1'])
  assert.deepEqual(input.sourceRefs, ['dataset-version:1'])
  assert.deepEqual(input.artifactRefs, ['artifact-version:1'])
})

test('allows interpretive contradiction cycles even when acyclic lineage is strict', () => {
  const chain = new EvidenceDeltaChain(scope.threadId)
  const first = chain.append(appendInput({
    payload: {
      claims: [{ id: 'claim:1' }, { id: 'claim:2' }],
      edges: [{ source: 'claim:2', target: 'claim:1', family: 'contradiction' }]
    }
  })).delta
  const second = chain.append(appendInput({
    operationId: 'turn-2',
    idempotencyKey: 'turn-2-idempotency',
    requestedWatermark: '2',
    committedWatermark: '2',
    predecessorDigest: first.deltaDigest,
    payload: {
      claims: [{ id: 'claim:2' }],
      gapCodes: ['contradiction_unresolved'],
      edges: [{ source: 'claim:1', target: 'claim:2', family: 'contradiction' }]
    },
    createdAt: '2026-09-01T00:00:01.000Z'
  })).delta
  const closure = chain.seal(evidenceDagClosurePolicyV1Schema.parse({
    version: 'EvidenceClosurePolicyV1',
    targetClaimIds: ['claim:1'],
    expectedHeadDigest: second.deltaDigest,
    barrierWatermark: '2',
    edgeFamilies: ['contradiction'],
    directions: ['outbound', 'inbound'],
    maxDepth: 8,
    termination: 'fixed_point',
    expandEquivalent: true,
    expandRefinement: true,
    cycleHandling: 'fail',
    unknownEdgeHandling: 'record_gap',
    requiredRecords: ['claim:2'],
    requiredExternalRefs: []
  }))
  assert.equal(closure.status, 'incomplete')
  assert.ok(closure.gapCodes.includes('contradiction_unresolved'))
  assert.ok(!closure.gapCodes.includes('lineage_incomplete'))
})

test('fails closed when an assessment claims independence despite shared invocation context', () => {
  const chain = new EvidenceDeltaChain(scope.threadId)
  assert.throws(() => chain.appendAssessment({
    scope: { ...scope, kind: 'assessment' },
    requestedWatermark: '1',
    idempotencyKey: 'assessment-self-1',
    assessment: {
      independenceMetadata: {
        producerIdentity: 'agent:producer',
        reviewerIdentity: 'agent:producer',
        producerInvocationId: 'invocation:1',
        reviewerInvocationId: 'invocation:1',
        producerPromptDigest: null,
        reviewerPromptDigest: null,
        producerContextDigest: null,
        reviewerContextDigest: null,
        effectiveContextDigest: null,
        modelOrToolVersion: 'verifier-1',
        predicate: 'distinct_invocation',
        result: 'independent',
        assessedAt: createdAt
      }
    }
  }), /contradicts/u)
  assert.equal(chain.list().length, 0)
})

test('persists committed deltas and restores the authoritative head after restart', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'evidence-delta-store-')))
  const storagePath = join(directory, 'evidence-deltas.json')
  const store = new EvidenceDagDeltaStore(storagePath)
  const first = await store.append(appendInput())

  const restarted = new EvidenceDagDeltaStore(storagePath)
  const restored = await restarted.chain(scope.threadId)
  assert.equal(restored.head.headDigest, first.delta.deltaDigest)
  assert.equal(restored.head.sequence, 1)
  assert.deepEqual(restored.list(), [first.delta])
  assert.match(await readFile(storagePath, 'utf8'), /"version":1/u)
})

test('roundtrips JSON payload snapshots before hashing and replays equivalent JSON idempotently', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'evidence-json-payload-')))
  const storagePath = join(directory, 'deltas.json')
  const store = new EvidenceDagDeltaStore(storagePath)
  const payload = {
    trace: [{ kind: 'message', optional: undefined, nested: { absent: undefined, explicit: null } }],
    values: [undefined, null, { absent: undefined, value: 'original' }]
  }
  const expected = {
    trace: [{ kind: 'message', nested: { explicit: null } }],
    values: [null, null, { value: 'original' }]
  }
  const original = structuredClone(payload)
  const appended = await store.append(appendInput({ payload }))
  // Load first: this reproduced the writer's payload-digest mismatch before the fix.
  const restarted = new EvidenceDagDeltaStore(storagePath)
  assert.deepEqual((await restarted.chain(scope.threadId)).list(), [appended.delta])
  assert.deepEqual(appended.delta.payload, expected)
  assert.equal(appended.delta.payloadDigest, digest(expected))
  payload.trace[0]!.kind = 'changed'
  ;(payload.values[2] as { value: string }).value = 'changed'
  assert.deepEqual((await store.chain(scope.threadId)).list()[0]!.payload, expected)
  for (const current of [store, restarted]) {
    assert.equal((await current.append(appendInput({ payload: original }))).idempotent, true)
    assert.equal((await current.append(appendInput({ payload: expected }))).idempotent, true)
    assert.equal((await current.append(appendInput({ payload: JSON.parse(JSON.stringify(expected)) }))).idempotent, true)
    await assert.rejects(() => current.append(appendInput({ payload: { ...expected, extra: null } })), /different content/u)
  }
  const pristine = await readFile(storagePath, 'utf8')
  for (const field of ['payload', 'payloadDigest', 'deltaDigest'] as const) {
    const corrupted = JSON.parse(pristine)
    corrupted.chains[0].records[0][field] = field === 'payload' ? { changed: true } : `sha256:${'0'.repeat(64)}`
    await writeFile(storagePath, JSON.stringify(corrupted))
    const isolated = new EvidenceDagDeltaStore(storagePath)
    await isolated.load()
    const recovery = isolated.recoveryStatus()[0]!
    assert.equal(await readFile(join(directory, recovery.archiveName), 'utf8'), JSON.stringify(corrupted))
    const recovered = (await isolated.chain(scope.threadId)).list()
    assert.equal(recovered.length, 1)
    assert.equal(recovered[0]!.payload.recordType, 'integrity_isolation')
    assert.notEqual(recovered[0]!.deltaDigest, corrupted.chains[0].records[0].deltaDigest)
  }
})

test('archives invalid UTF8 bytes exactly and verifies their digest after restart', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'evidence-raw-bytes-')))
  const path = join(directory, 'deltas.json')
  await new EvidenceDagDeltaStore(path).append(appendInput({ payload: { text: 'BYTE_TARGET' } }))
  const damaged = await readFile(path)
  const offset = damaged.indexOf('BYTE_TARGET')
  assert.ok(offset >= 0)
  damaged[offset] = 0xff
  await writeFile(path, damaged)
  const store = new EvidenceDagDeltaStore(path)
  await store.load()
  const recovery = store.recoveryStatus()[0]!
  assert.equal(recovery.archiveDigest, digestBytes(damaged))
  assert.deepEqual(await readFile(join(directory, recovery.archiveName)), damaged)
  const restarted = new EvidenceDagDeltaStore(path)
  await restarted.load()
  assert.deepEqual(restarted.recoveryStatus(), [recovery])
  assert.equal((await restarted.chain(scope.threadId)).list()[0]!.payload.recordType, 'integrity_isolation')
  assert.deepEqual(await readFile(join(directory, recovery.archiveName)), damaged)
})

test('retains verifiable recovery lineage after repeated same-chain damage and restart', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'evidence-repeat-recovery-')))
  const path = join(directory, 'deltas.json')
  const original = new EvidenceDagDeltaStore(path)
  await original.append(appendInput())
  await original.append(appendInput({ idempotencyKey: 'repeat-2', requestedWatermark: '2', committedWatermark: '2' }))
  const healthy = (await original.append(appendInput({ scope: { ...scope, threadId: 'healthy' } }))).delta
  const archives: Buffer[] = []
  let recoveries: ReturnType<EvidenceDagDeltaStore['recoveryStatus']> = []
  for (const recordIndex of [1, 0, 0]) {
    const document = JSON.parse(await readFile(path, 'utf8'))
    document.chains.find((entry: { threadId: string }) => entry.threadId === scope.threadId).records[recordIndex].payload = { damaged: archives.length }
    const damaged = Buffer.from(JSON.stringify(document))
    archives.push(damaged)
    await writeFile(path, damaged)
    const recovered = new EvidenceDagDeltaStore(path)
    await recovered.load()
    const history = recovered.recoveryStatus()
    assert.deepEqual(history.slice(0, -1), recoveries)
    recoveries = history
    assert.equal(history.length, archives.length)
    assert.deepEqual((await recovered.chain('healthy')).list(), [healthy])
    const restarted = new EvidenceDagDeltaStore(path)
    await restarted.load()
    assert.deepEqual(restarted.recoveryStatus(), history)
    assert.deepEqual((await restarted.chain('healthy')).list(), [healthy])
    for (let index = 0; index < history.length; index++) {
      assert.deepEqual(await readFile(join(directory, history[index]!.archiveName)), archives[index])
      assert.equal(history[index]!.archiveDigest, digestBytes(archives[index]!))
    }
  }
  const active = await readFile(path)
  // Missing and modified historical archives must fail without replacing active bytes.
  const archivePath = join(directory, recoveries[0]!.archiveName)
  const movedPath = `${archivePath}.held`
  await rename(archivePath, movedPath)
  await assert.rejects(new EvidenceDagDeltaStore(path).load(), /ENOENT/u)
  assert.deepEqual(await readFile(path), active)
  await rename(movedPath, archivePath)
  await writeFile(archivePath, 'tampered')
  await assert.rejects(new EvidenceDagDeltaStore(path).load(), /quarantine archive digest mismatch/u)
  assert.deepEqual(await readFile(path), active)
  await writeFile(archivePath, archives[0]!)
  const drifted = JSON.parse(active.toString('utf8'))
  drifted.chains.find((entry: { threadId: string }) => entry.threadId === scope.threadId).records[0].scope.operationId = 'forged-operation'
  await writeFile(path, JSON.stringify(drifted))
  const driftedBytes = await readFile(path)
  await assert.rejects(new EvidenceDagDeltaStore(path).load(), /recovery metadata/u)
  assert.deepEqual(await readFile(path), driftedBytes)
  const forged = JSON.parse(active.toString('utf8'))
  forged.recoveries[0].detectedAt = '2026-01-01T00:00:00.000Z'
  await writeFile(path, JSON.stringify(forged))
  const forgedBytes = await readFile(path)
  await assert.rejects(new EvidenceDagDeltaStore(path).load(), /recovery metadata/u)
  assert.deepEqual(await readFile(path), forgedBytes)
})

test('does not acknowledge isolation when archive persistence fails and retries from untouched original bytes', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'evidence-isolation-failure-')))
  const path = join(directory, 'deltas.json')
  await new EvidenceDagDeltaStore(path).append(appendInput())
  const document = JSON.parse(await readFile(path, 'utf8'))
  document.chains[0].records[0].payload = { damaged: true }
  const raw = JSON.stringify(document)
  await writeFile(path, raw)
  const archivePath = join(directory, `deltas-quarantine-${digestBytes(Buffer.from(raw)).slice(7)}.json`)
  await mkdir(archivePath)
  const store = new EvidenceDagDeltaStore(path)
  await assert.rejects(store.load(), /nonregular|directory/u)
  assert.equal(await readFile(path, 'utf8'), raw)
  await rename(archivePath, `${archivePath}.blocked`)
  await store.load()
  assert.equal(store.recoveryStatus().length, 1)
  assert.equal(await readFile(archivePath, 'utf8'), raw)
})

test('isolates the damaged suffix, preserves other histories, and resumes append across restart without certifying the gap', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'evidence-isolation-')))
  const path = join(directory, 'deltas.json')
  const original = new EvidenceDagDeltaStore(path)
  const first = (await original.append(appendInput())).delta
  await original.append(appendInput({ idempotencyKey: 'turn-2-isolation', requestedWatermark: '2', committedWatermark: '2' }))
  await original.append(appendInput({ idempotencyKey: 'turn-3-isolation', requestedWatermark: '3', committedWatermark: '3' }))
  const independent = (await original.append(appendInput({ scope: { ...scope, threadId: 'independent' } }))).delta
  const corrupted = JSON.parse(await readFile(path, 'utf8'))
  const damaged = corrupted.chains.find((chain: { threadId: string }) => chain.threadId === scope.threadId)
  damaged.records[1].payload = { damaged: true }
  const raw = JSON.stringify(corrupted) + '\n'
  await writeFile(path, raw)
  const recovered = new EvidenceDagDeltaStore(path)
  await recovered.load()
  const recovery = recovered.recoveryStatus()[0]!
  assert.equal(recovery.verifiedPrefixLength, 1)
  assert.equal(recovery.quarantinedRecordCount, 2)
  assert.equal(await readFile(join(directory, recovery.archiveName), 'utf8'), raw)
  assert.deepEqual((await recovered.chain('independent')).list(), [independent])
  assert.deepEqual((await recovered.chain(scope.threadId)).list()[0], first)
  const continuation = appendInput({ idempotencyKey: 'turn-4-isolation', requestedWatermark: '4', committedWatermark: '4' })
  const next = (await recovered.append(continuation)).delta
  const reopened = new EvidenceDagDeltaStore(path)
  await reopened.load()
  assert.deepEqual(reopened.recoveryStatus(), [recovery])
  assert.equal((await reopened.append(continuation)).idempotent, true)
  assert.equal((await reopened.chain(scope.threadId)).list().length, 3)
  const view = await reopened.compileProvisional(scope.threadId, { compilerVersion: 'test', policyVersion: 'test' })
  assert.equal(view.summary.coverage.complete, false)
  const closure = await reopened.seal(scope.threadId, completeClosurePolicy(next.deltaDigest, '4'))
  assert.equal(closure.status, 'incomplete')
  assert.ok(closure.gapCodes.includes('lineage_incomplete'))
  const pristineRecovered = await readFile(path, 'utf8')
  for (const mutate of [
    (document: any) => { document.recoveries = [] },
    (document: any) => { document.recoveries[0].verifiedPrefixLength = -1 },
    (document: any) => { document.recoveries[0].quarantinedRecordCount++ },
    (document: any) => { document.recoveries[0].code = 'delta_digest_mismatch' },
    (document: any) => { document.recoveries[0].archiveDigest = `sha256:${'0'.repeat(64)}` }
  ]) {
    const modified = JSON.parse(pristineRecovered)
    mutate(modified)
    await writeFile(path, JSON.stringify(modified))
    await assert.rejects(new EvidenceDagDeltaStore(path).load(), /recovery metadata/u)
  }
  await writeFile(path, pristineRecovered)
  await writeFile(join(directory, recovery.archiveName), 'changed')
  await assert.rejects(new EvidenceDagDeltaStore(path).load(), /quarantine archive digest mismatch/u)
})

test('trace, assessment, correction and sidechain writers share JSON-stable payload identities', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'evidence-json-writers-')))
  const storagePath = join(directory, 'deltas.json')
  const store = new EvidenceDagDeltaStore(storagePath)
  const trace = evidenceDagDeltaInputFromTrace({
    ...scope, requestedWatermark: '1', idempotencyKey: 'trace-json', createdAt,
    trace: [{ kind: 'system', detail: undefined, values: [undefined, null] }]
  })
  await store.append(trace)
  const assessment = {
    scope, requestedWatermark: '2', idempotencyKey: 'assessment-json', createdAt,
    assessment: {
      outcome: 'hold', detail: undefined, nested: { explicit: null, absent: undefined },
      independenceMetadata: {
        producerIdentity: 'producer:1', reviewerIdentity: null,
        producerInvocationId: 'invocation:1', reviewerInvocationId: null,
        producerPromptDigest: null, reviewerPromptDigest: null,
        producerContextDigest: null, reviewerContextDigest: null, effectiveContextDigest: null,
        modelOrToolVersion: 'test', predicate: 'distinct_invocation',
        result: 'not_independently_assessed', assessedAt: createdAt
      }
    }
  }
  await store.appendAssessment(assessment)
  const correction = {
    scope: { ...scope, kind: 'correction' as const }, requestedWatermark: '3',
    idempotencyKey: 'correction-json', createdAt,
    correction: {
      recordId: 'corrected', targetRecordId: 'original', relation: 'corrects' as const,
      reason: 'Correct the result.', producerIdentity: 'researcher:1', reviewerIdentity: null, createdAt
    }
  }
  const corrected = await store.appendCorrection(correction)
  const closure = await store.seal(scope.threadId, completeClosurePolicy(corrected.delta.deltaDigest, '3'))
  const sidechain = {
    threadId: scope.threadId, recordId: 'review-json', recordType: 'review' as const,
    closureDigest: closure.closureDigest, idempotencyKey: 'sidechain-json',
    payload: { verdict: 'hold', detail: undefined, nested: [{ absent: undefined, explicit: null }, undefined] },
    producerIdentity: 'reviewer:1', createdAt
  }
  const appended = await store.appendSidechain(sidechain)
  const expected = { verdict: 'hold', nested: [{ explicit: null }, null] }
  assert.deepEqual(appended.record.payload, expected)
  sidechain.payload.verdict = 'changed'
  assert.deepEqual((await store.sidechains(scope.threadId))[0]!.payload, expected)
  const restarted = new EvidenceDagDeltaStore(storagePath)
  assert.deepEqual((await restarted.chain(scope.threadId)).list(), (await store.chain(scope.threadId)).list())
  assert.deepEqual(await restarted.sidechains(scope.threadId), [appended.record])
  for (const current of [store, restarted]) {
    assert.equal((await current.append(JSON.parse(JSON.stringify(trace)))).idempotent, true)
    assert.equal((await current.appendAssessment(JSON.parse(JSON.stringify(assessment)))).idempotent, true)
    assert.equal((await current.appendCorrection(correction)).idempotent, true)
    assert.equal((await current.appendSidechain({ ...sidechain, payload: expected })).idempotent, true)
    assert.equal((await current.appendSidechain({ ...sidechain, payload: { ...expected, detail: undefined } })).idempotent, true)
  }
  const pristine = await readFile(storagePath, 'utf8')
  for (const field of ['payload', 'recordDigest'] as const) {
    const corrupted = JSON.parse(pristine)
    corrupted.chains[0].sidechains[0][field] = field === 'payload' ? { changed: true } : `sha256:${'0'.repeat(64)}`
    await writeFile(storagePath, JSON.stringify(corrupted))
    await assert.rejects(() => new EvidenceDagDeltaStore(storagePath).load(), /sidechain digest does not match/u)
  }
})

test('rolls back the in-memory head when the atomic delta replacement fails', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'evidence-delta-store-failure-')))
  const storagePath = join(directory, 'evidence-deltas.json')
  const store = new EvidenceDagDeltaStore(storagePath)
  await store.load()
  // Turn the destination into a directory after load so rename fails only
  // after the candidate chain has been materialized in memory.
  await mkdir(storagePath)

  await assert.rejects(() => store.append(appendInput()), /EISDIR|directory/u)
  assert.equal((await store.head(scope.threadId)).headDigest, null)
  assert.equal((await store.chain(scope.threadId)).list().length, 0)
})

test('rolls back sidechain memory when its atomic replacement fails', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'evidence-sidechain-store-failure-')))
  const storagePath = join(directory, 'evidence-deltas.json')
  const store = new EvidenceDagDeltaStore(storagePath)
  const first = await store.append(appendInput())
  const closure = await store.seal(scope.threadId, evidenceDagClosurePolicyV1Schema.parse({
    version: 'EvidenceClosurePolicyV1',
    targetClaimIds: ['claim:1'],
    expectedHeadDigest: first.delta.deltaDigest,
    barrierWatermark: '1',
    edgeFamilies: ['provenance'],
    directions: ['inbound'],
    maxDepth: 8,
    termination: 'fixed_point',
    expandEquivalent: true,
    expandRefinement: true,
    cycleHandling: 'allow',
    unknownEdgeHandling: 'record_gap',
    requiredRecords: ['claim:1'],
    requiredExternalRefs: ['artifact-version:1']
  }))
  const existing = await store.appendSidechain({
    threadId: scope.threadId,
    recordId: 'review:existing',
    recordType: 'review',
    closureDigest: closure.closureDigest,
    idempotencyKey: 'review-existing-idempotency',
    payload: { verdict: 'hold' },
    producerIdentity: 'researcher:1',
    createdAt: '2026-09-01T00:00:02.000Z'
  })

  await rename(storagePath, `${storagePath}.backup`)
  await mkdir(storagePath)
  await assert.rejects(() => store.appendSidechain({
    threadId: scope.threadId,
    recordId: 'review:new',
    recordType: 'review',
    closureDigest: closure.closureDigest,
    idempotencyKey: 'review-new-idempotency',
    payload: { verdict: 'approve' },
    producerIdentity: 'researcher:1',
    createdAt: '2026-09-01T00:00:03.000Z'
  }), /EISDIR|directory/u)
  assert.deepEqual(await store.sidechains(scope.threadId), [existing.record])
})

test('persists sidechains and restores them after restart', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'evidence-sidechain-store-')))
  const storagePath = join(directory, 'evidence-deltas.json')
  const store = new EvidenceDagDeltaStore(storagePath)
  const first = await store.append(appendInput())
  const closure = await store.seal(scope.threadId, evidenceDagClosurePolicyV1Schema.parse({
    version: 'EvidenceClosurePolicyV1',
    targetClaimIds: ['claim:1'],
    expectedHeadDigest: first.delta.deltaDigest,
    barrierWatermark: '1',
    edgeFamilies: ['provenance'],
    directions: ['inbound'],
    maxDepth: 8,
    termination: 'fixed_point',
    expandEquivalent: true,
    expandRefinement: true,
    cycleHandling: 'allow',
    unknownEdgeHandling: 'record_gap',
    requiredRecords: ['claim:1'],
    requiredExternalRefs: ['artifact-version:1']
  }))
  const appended = await store.appendSidechain({
    threadId: scope.threadId,
    recordId: 'audit:1',
    recordType: 'audit',
    closureDigest: closure.closureDigest,
    idempotencyKey: 'audit-1-idempotency',
    payload: { outcome: 'complete' },
    producerIdentity: 'system:evidence-audit',
    createdAt: '2026-09-01T00:00:02.000Z'
  })

  const restarted = new EvidenceDagDeltaStore(storagePath)
  assert.deepEqual(await restarted.sidechains(scope.threadId), [appended.record])
  const replay = await restarted.appendSidechain({
    threadId: scope.threadId,
    recordId: 'audit:1',
    recordType: 'audit',
    closureDigest: closure.closureDigest,
    idempotencyKey: 'audit-1-idempotency',
    payload: { outcome: 'complete' },
    producerIdentity: 'system:evidence-audit'
  })
  assert.equal(replay.idempotent, true)
  assert.deepEqual(replay.record, appended.record)
})

test('rejects a persisted closure whose immutable digest was modified', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'evidence-delta-store-corrupt-')))
  const storagePath = join(directory, 'evidence-deltas.json')
  const store = new EvidenceDagDeltaStore(storagePath)
  const first = await store.append(appendInput())
  await store.seal(scope.threadId, evidenceDagClosurePolicyV1Schema.parse({
    version: 'EvidenceClosurePolicyV1',
    targetClaimIds: ['claim:1'],
    expectedHeadDigest: first.delta.deltaDigest,
    barrierWatermark: '1',
    edgeFamilies: ['provenance'],
    directions: ['inbound'],
    maxDepth: 8,
    termination: 'fixed_point',
    expandEquivalent: true,
    expandRefinement: true,
    cycleHandling: 'allow',
    unknownEdgeHandling: 'record_gap',
    requiredRecords: ['claim:1'],
    requiredExternalRefs: ['artifact-version:1']
  }))
  const corrupted = JSON.parse(await readFile(storagePath, 'utf8')) as {
    chains: Array<{ closures?: Array<Record<string, unknown>> }>
  }
  corrupted.chains[0]!.closures![0]!.closureDigest = `sha256:${'0'.repeat(64)}`
  await writeFile(storagePath, `${JSON.stringify(corrupted)}\n`)
  await assert.rejects(() => new EvidenceDagDeltaStore(storagePath).load(), /closure digest does not match/u)
})

test('rejects a persisted closure that cherry-picks membership with a recomputed digest', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'evidence-delta-store-cherry-pick-')))
  const storagePath = join(directory, 'evidence-deltas.json')
  const store = new EvidenceDagDeltaStore(storagePath)
  const first = await store.append(appendInput())
  const policy = evidenceDagClosurePolicyV1Schema.parse({
    version: 'EvidenceClosurePolicyV1',
    targetClaimIds: ['claim:1'],
    expectedHeadDigest: first.delta.deltaDigest,
    barrierWatermark: '1',
    edgeFamilies: ['provenance'],
    directions: ['inbound'],
    maxDepth: 8,
    termination: 'fixed_point',
    expandEquivalent: true,
    expandRefinement: true,
    cycleHandling: 'allow',
    unknownEdgeHandling: 'record_gap',
    requiredRecords: ['claim:1'],
    requiredExternalRefs: ['artifact-version:1']
  })
  const closure = await store.seal(scope.threadId, policy)
  const corrupted = JSON.parse(await readFile(storagePath, 'utf8')) as {
    chains: Array<{ closures?: Array<Record<string, unknown>> }>
  }
  const stored = corrupted.chains[0]!.closures![0]!
  stored.includedDeltaDigests = []
  stored.closureDigest = digest({
    threadId: closure.threadId,
    headDigest: closure.headDigest,
    policyDigest: closure.policyDigest,
    status: closure.status,
    includedDeltaDigests: [],
    includedExternalRefs: closure.includedExternalRefs,
    gapCodes: closure.gapCodes
  })
  await writeFile(storagePath, `${JSON.stringify(corrupted)}\n`)
  await assert.rejects(
    () => new EvidenceDagDeltaStore(storagePath).load(),
    /membership does not match/u
  )
})

test('rejects a persisted legacy root whose byte digest or status was modified', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'evidence-delta-store-legacy-corrupt-')))
  const storagePath = join(directory, 'evidence-deltas.json')
  const chain = new EvidenceDeltaChain(scope.threadId)
  const snapshot = {
    threadId: scope.threadId,
    version: 1,
    digest: `sha256:${'c'.repeat(64)}`,
    inputWatermark: '1',
    schemaVersion: 'evidence.v3',
    extractorVersion: 'extractor.v3',
    verifierVersion: 'verifier.v3',
    artifactDigests: [],
    createdAt,
  }
  chain.importLegacyRoot({ snapshot, snapshotBytes: new TextEncoder().encode('{"snapshot":true}'), ancestry: 'proven' })
  await new EvidenceDagDeltaStore(storagePath).importLegacyRoot(scope.threadId, {
    snapshot,
    snapshotBytes: new TextEncoder().encode('{"snapshot":true}'),
    ancestry: 'proven'
  })
  const stored = JSON.parse(await readFile(storagePath, 'utf8')) as {
    chains: Array<{ legacyRoot: Record<string, unknown> }>
  }
  stored.chains[0]!.legacyRoot.snapshotBytesDigest = `sha256:${'0'.repeat(64)}`
  await writeFile(storagePath, `${JSON.stringify(stored)}\n`)
  await assert.rejects(
    () => new EvidenceDagDeltaStore(storagePath).load(),
    /bytes digest does not match/u
  )
})

test('rejects a legacy root whose snapshot scope differs from its chain', () => {
  const chain = new EvidenceDeltaChain(scope.threadId)
  assert.throws(
    () => chain.importLegacyRoot({
      snapshot: {
        threadId: 'another-thread',
        version: 1,
        digest: `sha256:${'c'.repeat(64)}`,
        inputWatermark: '1',
        schemaVersion: 'evidence.v3',
        extractorVersion: 'extractor.v3',
        verifierVersion: 'verifier.v3',
        artifactDigests: [],
        createdAt
      },
      snapshotBytes: new TextEncoder().encode('{"snapshot":true}'),
      ancestry: 'proven'
    }),
    (error: unknown) => error instanceof EvidenceDagSealError && error.code === 'invalid_legacy_root'
  )
})

test('preserves legacy snapshot bytes while dropping old read-model fields from identity', () => {
  const chain = new EvidenceDeltaChain(scope.threadId)
  const snapshot = {
    threadId: scope.threadId,
    version: 1,
    digest: `sha256:${'d'.repeat(64)}`,
    inputWatermark: '1',
    schemaVersion: 'evidence.v3',
    extractorVersion: 'extractor.v3',
    verifierVersion: 'verifier.v3',
    artifactDigests: [],
    createdAt,
    humanReview: { status: 'pending', reviewedBy: 'reviewer:1' }
  }
  const bytes = new TextEncoder().encode(JSON.stringify(snapshot))
  const root = chain.importLegacyRoot({ snapshot, snapshotBytes: bytes, ancestry: 'unproven' })

  assert.equal('humanReview' in root.snapshot, false)
  assert.equal(Buffer.from(root.snapshotBytesBase64, 'base64').toString('utf8'), JSON.stringify(snapshot))
  assert.equal(root.status, 'legacy/incomplete')
})


test('explicit gap policy preserves recorded negatives while legacy keyword closures restart unchanged', () => {
  const chain = new EvidenceDeltaChain(scope.threadId)
  const delta = chain.append(appendInput({ payload: { claims: [{ id: 'claim:1', negativeResults: ['No benefit'], reproduction: { outcome: 'failed' } }] } })).delta
  const current = chain.seal(completeClosurePolicy(delta.deltaDigest))
  assert.equal(current.policy.semanticGapPolicy, 'explicit-v2')
  assert.deepEqual(current.gapCodes, [])
  const legacy = chain.seal({ ...completeClosurePolicy(delta.deltaDigest), semanticGapPolicy: 'keyword-v1' })
  assert.ok(legacy.gapCodes.includes('negative_result_missing'))
  // Pre-versioned on-disk identity, with the exact legacy digest algorithm.
  delete legacy.policy.semanticGapPolicy
  legacy.policyDigest = digest(legacy.policy)
  legacy.closureDigest = digest({ threadId: legacy.threadId, headDigest: legacy.headDigest, policyDigest: legacy.policyDigest, status: legacy.status, includedDeltaDigests: legacy.includedDeltaDigests, includedExternalRefs: legacy.includedExternalRefs, gapCodes: legacy.gapCodes })
  const saved = JSON.stringify(legacy)
  const restarted = new EvidenceDeltaChain(scope.threadId, chain.list(), { closures: [legacy, current] })
  assert.equal(JSON.stringify(restarted.closures().find(item => item.closureDigest === legacy.closureDigest)), saved)
  assert.deepEqual(restarted.closures().find(item => item.closureDigest === current.closureDigest), current)
})


test('baseline pre-policy-version closures and formal approval survive restart byte-for-byte', async () => {
  const fixture = JSON.parse(await readFile(new URL('../../../../../tests/fixtures/scientific-audit-old-closure.json', import.meta.url), 'utf8'))
  assert.equal(fixture.baseline, 'cbaff179ea7e8dd012cccc27aa931b0ae7ba9804')
  const restored = new EvidenceDeltaChain('codex:historical', fixture.records, fixture)
  assert.deepEqual(restored.closures(), fixture.closures)
  assert.deepEqual(restored.sidechainRecords(), fixture.sidechains)
  assert.equal(restored.committedSnapshotClosure, fixture.committedSnapshotClosureDigest)
  assert.ok(restored.closures().some(item => item.gapCodes.includes('negative_result_missing')))
  assert.equal(restored.sidechainRecords().find(item => item.recordType === 'approval')?.reviewerIdentity, 'human:original-reviewer')
})


test('superseded queued derivation leaves accepted raw delta and prior view intact', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'evidence-cancelled-derivation-')))
  const store = new EvidenceDagDeltaStore(join(directory, 'deltas.json'))
  const appended = await store.append(appendInput())
  const before = await store.provisional(scope.threadId)
  await assert.rejects(store.compileProvisional(scope.threadId, {
    compilerVersion: 'compiler', policyVersion: 'policy', desiredHeadDigest: appended.delta.deltaDigest
  }, () => false), /superseded/)
  assert.equal((await store.head(scope.threadId)).headDigest, appended.delta.deltaDigest)
  assert.deepEqual(await store.provisional(scope.threadId), before)
})
