import assert from 'node:assert/strict'
import { mkdtemp, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  evidenceDagClosurePolicyV1Schema,
  type ArtifactVersionRefV1,
  type EvidenceDagAuditQuerySubject,
  type EvidenceDagSidechainRecordV1
} from '../contract.js'
import {
  EVIDENCE_DAG_AUDIT_SCAN_LIMIT,
  evidenceDagAuditQueryOverChains
} from './audit-query.js'
import {
  EvidenceDagDeltaStore,
  EvidenceDeltaChain
} from './evidence-delta.js'
import { EvidenceFileStorage } from './secure-storage.js'
import { OwnerAuditIndex } from './audit-index.js'

const createdAt = '2026-09-01T00:00:00.000Z'

test('owner revision cache sees material changes after 1100 events, isolates exact refs and invalidates replacement/removal', () => {
  const chain = new EvidenceDeltaChain('codex:scale')
  const { closure } = sealChainHead({ chain, payload: { claims: [{ id: 'claim:1' }], sources: [{ id: 'paper', ref: pinnedRef }], edges: [{ source: 'paper', target: 'claim:1', family: 'supports' }] } })
  appendAuditRecord(chain, closure.closureDigest, 'scale-audit', { ref: pinnedRef })
  const chains = new Map([['codex:scale', chain]]), index = new OwnerAuditIndex()
  const subject = { artifactVersionRef: pinnedRef }
  const initial = index.query(chains, subject, '/workspace')
  assert.equal(initial.review.impacts[0].status, 'no-recorded-impact')
  const warm = index.query(chains, subject, '/workspace')
  assert.equal(warm.review.coverageDetails?.scannedDeltas, 0)
  assert.equal(warm.review.coverageDetails?.indexRevision, initial.review.coverageDetails?.indexRevision)
  for (let n = 0; n < 1101; n++) chain.append({ scope: { runtimeId: 'codex', threadId: 'codex:scale', workspaceRoot: '/workspace', operationId: `scale-${n}`, kind: 'turn' }, requestedWatermark: '1', schemaVersion: 'evidence.delta.v1', extractorVersion: 'test', verifierVersion: 'test', idempotencyKey: `scale-event-${n}`, payload: n === 1100 ? { targetRecordId: 'paper', relation: 'corrects', reason: 'later material correction' } : {} })
  const changed = index.query(chains, subject, '/workspace')
  assert.equal(changed.review.impacts[0].status, 'requires-review')
  assert.equal(changed.review.impacts[0].changes[0].reason, 'later material correction')
  assert.ok(changed.review.coverageDetails!.indexRevision > initial.review.coverageDetails!.indexRevision)
  assert.equal(changed.review.coverageDetails?.indexedDeltas, 1102)
  assert.equal(index.query(chains, subject, '/other-workspace').evaluation.records.length, 0)
  for (const ref of [{ ...pinnedRef, artifactId: 'artifact:other' }, { ...pinnedRef, contentDigest: 'd'.repeat(64) }]) assert.equal(index.query(chains, { artifactVersionRef: ref }, '/workspace').evaluation.records.length, 0)
  chains.set('codex:scale', new EvidenceDeltaChain('codex:scale'))
  assert.equal(index.query(chains, subject).evaluation.records.length, 0)
  chains.set('codex:scale', chain)
  assert.equal(index.query(chains, subject).evaluation.records.length, 1)
  chains.clear()
  assert.equal(index.query(chains, subject).evaluation.records.length, 0)
})

test('bounded scientific graph traversal cannot produce a green impact result', () => {
  const chain = new EvidenceDeltaChain('codex:bounded')
  const { closure } = sealChainHead({ chain, payload: { claims: [{ id: 'claim:1' }], edges: [{ source: 'paper', target: 'claim:1', family: 'supports' }], huge: Array.from({ length: 10001 }, () => ({ value: 'x' })) } })
  appendAuditRecord(chain, closure.closureDigest, 'bounded-audit', { ref: pinnedRef })
  const result = new OwnerAuditIndex().query(new Map([['codex:bounded', chain]]), { artifactVersionRef: pinnedRef })
  assert.equal(result.review.bounded, true)
  assert.equal(result.review.impacts[0].status, 'unknown')
  assert.ok(result.review.coverageDetails!.reasons.length)
})

const pinnedRef: ArtifactVersionRefV1 = {
  artifactId: 'artifact:test',
  versionId: 'artifact-version:test-1',
  contentDigest: 'c'.repeat(64),
  byteLength: 9,
  availability: 'available',
  retention: 'reference',
  accessPolicy: { visibility: 'workspace', principals: [], allowExport: false }
}

function sealChainHead(input: Readonly<{
  chain: EvidenceDeltaChain
  payload?: Readonly<Record<string, unknown>>
  artifactRefs?: readonly string[]
  requiredExternalRefs?: readonly string[]
  turn?: string
}>) {
  const threadId = input.chain.head.threadId
  const turn = input.turn ?? 'turn-1'
  const appended = input.chain.append({
    scope: {
      runtimeId: 'codex',
      threadId,
      operationId: turn,
      kind: 'turn',
      workspaceRoot: '/workspace'
    },
    requestedWatermark: '1',
    committedWatermark: '1',
    schemaVersion: 'evidence.delta.v1',
    extractorVersion: 'extractor-1',
    verifierVersion: 'verifier-1',
    idempotencyKey: `${threadId}:${turn}`,
    sourceRefs: [],
    artifactRefs: input.artifactRefs ?? [],
    runRefs: [],
    payload: input.payload ?? {},
    createdAt
  })
  const policy = evidenceDagClosurePolicyV1Schema.parse({
    version: 'EvidenceClosurePolicyV1',
    targetClaimIds: ['claim:1'],
    expectedHeadDigest: appended.delta.deltaDigest,
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
    requiredExternalRefs: input.requiredExternalRefs ?? []
  })
  return { delta: appended.delta, closure: input.chain.seal(policy) }
}

function appendAuditRecord(
  chain: EvidenceDeltaChain,
  closureDigest: string,
  recordId: string,
  payload: Readonly<Record<string, unknown>> = {},
  recordCreatedAt = '2026-09-01T00:00:01.000Z'
): EvidenceDagSidechainRecordV1 {
  return chain.appendSidechain({
    threadId: chain.head.threadId,
    recordId,
    recordType: 'audit',
    closureDigest,
    idempotencyKey: `${recordId}-key`,
    payload,
    producerIdentity: 'producer:test',
    createdAt: recordCreatedAt
  }).record
}

function evaluate(
  chains: readonly EvidenceDeltaChain[],
  subject: EvidenceDagAuditQuerySubject,
  workspaceRoot?: string
) {
  return evidenceDagAuditQueryOverChains({ chains, subject, workspaceRoot })
}

test('by closureDigest returns exactly the sidechains bound to that closure', () => {
  const chain = new EvidenceDeltaChain('codex:thread-a')
  const { closure: first } = sealChainHead({ chain })
  const later = appendAuditRecord(chain, first.closureDigest, 'record-later', {}, '2026-09-01T00:00:02.000Z')
  const earlier = appendAuditRecord(chain, first.closureDigest, 'record-earlier', {}, '2026-09-01T00:00:01.500Z')
  // A second closure on the same thread must not leak into the first query.
  const { closure: second } = sealChainHead({ chain, turn: 'turn-2' })
  appendAuditRecord(chain, second.closureDigest, 'record-other')
  // An unrelated thread must not leak either.
  const otherChain = new EvidenceDeltaChain('codex:thread-b')
  const { closure: otherClosure } = sealChainHead({ chain: otherChain })
  appendAuditRecord(otherChain, otherClosure.closureDigest, 'record-foreign')

  const result = evaluate([chain, otherChain], { closureDigest: first.closureDigest })

  assert.deepEqual(
    result.records.map((record) => record.recordId),
    ['record-earlier', 'record-later']
  )
  assert.ok(result.records.every((record) => record.closureDigest === first.closureDigest))
  // The first closure was sealed at an earlier head; the live head has since
  // advanced, so the existing derivation reports the closure as stale.
  assert.equal(result.freshness, 'stale')
  assert.equal(result.complete, false)
  assert.deepEqual(result.gapCodes, ['source_unavailable:project'])
  assert.notEqual(second.closureDigest, first.closureDigest)
})

test('by artifactVersionRef returns membership- and payload-referencing sidechains with exact identity match', () => {
  // Chain A: the closure's member delta payload pins the exact ref. The claim
  // makes the delta part of the sealed closure membership.
  const chainA = new EvidenceDeltaChain('codex:thread-a')
  const { closure: closureA } = sealChainHead({
    chain: chainA,
    payload: {
      claims: [{ id: 'claim:1', text: 'A result.' }],
      trace: [{ id: 'trace-1', ref: pinnedRef }]
    }
  })
  const viaMembership = appendAuditRecord(chainA, closureA.closureDigest, 'record-membership')
  const viaPayload = appendAuditRecord(chainA, closureA.closureDigest, 'record-payload', {
    note: { ref: pinnedRef }
  })
  // Chain C: the closure policy requires the ref identity directly.
  const chainC = new EvidenceDeltaChain('codex:thread-c')
  const { closure: closureC } = sealChainHead({
    chain: chainC,
    requiredExternalRefs: [pinnedRef.versionId]
  })
  appendAuditRecord(chainC, closureC.closureDigest, 'record-policy')
  // Chain B: unrelated content must stay out.
  const chainB = new EvidenceDeltaChain('codex:thread-b')
  const { closure: closureB } = sealChainHead({ chain: chainB })
  appendAuditRecord(chainB, closureB.closureDigest, 'record-unrelated')
  // Chain D: a near miss (different version identity and content) must not
  // match, neither through the structured triple nor the declared version
  // string the closure index legitimately holds.
  const chainD = new EvidenceDeltaChain('codex:thread-d')
  const { closure: closureD } = sealChainHead({
    chain: chainD,
    payload: {
      claims: [{ id: 'claim:1', text: 'A result.' }],
      trace: [{
        id: 'trace-1',
        ref: {
          ...pinnedRef,
          versionId: 'artifact-version:test-2',
          contentDigest: 'd'.repeat(64)
        }
      }]
    }
  })
  appendAuditRecord(chainD, closureD.closureDigest, 'record-near-miss')

  const result = evaluate(
    [chainA, chainB, chainC, chainD],
    { artifactVersionRef: pinnedRef }
  )

  assert.deepEqual(
    [...result.records.map((record) => record.recordId)].sort(),
    ['record-membership', 'record-payload']
  )
  assert.equal(result.freshness, 'pending')
  assert.equal(result.complete, false)
  assert.deepEqual(result.gapCodes, ['source_unavailable:checkpoint'])
})

test('by threadId reports stale freshness on head mismatch without dropping records', () => {
  const chain = new EvidenceDeltaChain('codex:thread-a')
  const { closure } = sealChainHead({ chain })
  const record = appendAuditRecord(chain, closure.closureDigest, 'record-thread')
  chain.provisional({
    compilerVersion: 'evidence-provisional.v1',
    policyVersion: 'evidence-provisional-policy.v1',
    desiredHeadDigest: chain.head.headDigest,
    now: '2026-09-01T00:00:02.000Z'
  })
  const currentHead = chain.head.headDigest!
  assert.equal(chain.provisionalView?.summary.freshness, 'fresh')

  const matching = evaluate([chain], {
    threadId: 'codex:thread-a',
    headDigest: currentHead
  })
  assert.deepEqual(matching.records.map((item) => item.recordId), [record.recordId])
  assert.equal(matching.freshness, 'fresh')
  assert.equal(matching.complete, true)
  assert.deepEqual(matching.gapCodes, [])

  const stale = evaluate([chain], {
    threadId: 'codex:thread-a',
    headDigest: `sha256:${'e'.repeat(64)}`
  })
  assert.deepEqual(stale.records.map((item) => item.recordId), [record.recordId])
  assert.equal(stale.freshness, 'stale')
  assert.equal(stale.complete, true)
})

test('auditQuery invokes no write path', async (t) => {
  const userDataDir = await realpath(await mkdtemp(join(tmpdir(), 'evidence-audit-readonly-')))
  const store = new EvidenceDagDeltaStore(join(userDataDir, 'deltas.json'))
  const scope = {
    runtimeId: 'codex',
    threadId: 'codex:thread-a',
    operationId: 'turn-1',
    kind: 'turn' as const,
    workspaceRoot: '/workspace'
  }
  const appended = await store.append({
    scope,
    requestedWatermark: '1',
    committedWatermark: '1',
    schemaVersion: 'evidence.delta.v1',
    extractorVersion: 'extractor-1',
    verifierVersion: 'verifier-1',
    idempotencyKey: 'codex:thread-a:turn-1',
    sourceRefs: [],
    artifactRefs: [],
    runRefs: [],
    payload: {
      claims: [{ id: 'claim:1', text: 'A result.' }],
      trace: [{ id: 'trace-1', ref: pinnedRef }]
    },
    createdAt
  })
  const policy = evidenceDagClosurePolicyV1Schema.parse({
    version: 'EvidenceClosurePolicyV1',
    targetClaimIds: ['claim:1'],
    expectedHeadDigest: appended.delta.deltaDigest,
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
  const closure = await store.seal('codex:thread-a', policy, 'audit-readonly-seal')
  await store.appendSidechain({
    threadId: 'codex:thread-a',
    recordId: 'record-readonly',
    recordType: 'audit',
    closureDigest: closure.closureDigest,
    idempotencyKey: 'record-readonly-key',
    payload: {},
    producerIdentity: 'producer:test',
    createdAt: '2026-09-01T00:00:01.000Z'
  })

  const writeText = t.mock.method(EvidenceFileStorage.prototype, 'writeText', () => undefined)
  try {
    const byClosure = (await store.queryAudit({ closureDigest: closure.closureDigest })).evaluation
    assert.deepEqual(byClosure.records.map((record) => record.recordId), ['record-readonly'])
    const byThread = (await store.queryAudit({ threadId: 'codex:thread-a' })).evaluation
    assert.equal(byThread.records.length, 1)
    const byRef = (await store.queryAudit({ artifactVersionRef: pinnedRef })).evaluation
    assert.equal(byRef.records.length, 1)
    const reloaded = await new EvidenceDagDeltaStore(join(userDataDir, 'deltas.json')).queryAudit({ artifactVersionRef: pinnedRef })
    assert.equal(reloaded.evaluation.records.length, 1)
    assert.equal(reloaded.review.coverageDetails?.indexedChains, 1)
    assert.equal(writeText.mock.callCount(), 0)
  } finally {
    t.mock.restoreAll()
  }
})

test('unknown subjects return empty records with explicit completeness gaps', () => {
  const chain = new EvidenceDeltaChain('codex:thread-a')
  const { closure } = sealChainHead({ chain })
  appendAuditRecord(chain, closure.closureDigest, 'record-known')

  const unknownClosure = evaluate([chain], { closureDigest: `sha256:${'f'.repeat(64)}` })
  assert.deepEqual(unknownClosure.records, [])
  assert.equal(unknownClosure.freshness, 'unknown')
  assert.equal(unknownClosure.complete, false)
  assert.deepEqual(unknownClosure.gapCodes, ['source_unavailable:project'])

  const unknownThread = evaluate([chain], { threadId: 'codex:thread-missing' })
  assert.deepEqual(unknownThread.records, [])
  assert.equal(unknownThread.freshness, 'unknown')
  // A threadId subject is natively Evidence-owned: an empty thread is the
  // authoritative Evidence answer, so no cross-domain gap is claimed.
  assert.equal(unknownThread.complete, true)
  assert.deepEqual(unknownThread.gapCodes, [])

  const unknownRef = evaluate([chain], {
    artifactVersionRef: { ...pinnedRef, versionId: 'artifact-version:missing' }
  })
  assert.deepEqual(unknownRef.records, [])
  assert.equal(unknownRef.freshness, 'unknown')
  assert.equal(unknownRef.complete, false)
  assert.deepEqual(unknownRef.gapCodes, ['source_unavailable:checkpoint'])
})

test('exact index skips unrelated history without hiding later referencing records', () => {
  // Unrelated historical deltas are indexed once and consume no result budget.
  const filler = new EvidenceDeltaChain('codex:thread-filler')
  const fillerDeltas: string[] = []
  for (let index = 0; index < EVIDENCE_DAG_AUDIT_SCAN_LIMIT - 3; index += 1) {
    const previous = fillerDeltas.at(-1) ?? null
    const appended = filler.append({
      scope: {
        runtimeId: 'codex',
        threadId: 'codex:thread-filler',
        operationId: `turn-${index}`,
        kind: 'turn',
        workspaceRoot: '/workspace'
      },
      requestedWatermark: '1',
      committedWatermark: '1',
      schemaVersion: 'evidence.delta.v1',
      extractorVersion: 'extractor-1',
      verifierVersion: 'verifier-1',
      idempotencyKey: `filler:turn-${index}`,
      sourceRefs: [],
      artifactRefs: [],
      runRefs: [],
      payload: { claims: [{ id: 'claim:1', text: `Filler ${index}.` }] },
      predecessorDigest: previous,
      createdAt
    })
    fillerDeltas.push(appended.delta.deltaDigest)
  }
  const fillerPolicy = evidenceDagClosurePolicyV1Schema.parse({
    version: 'EvidenceClosurePolicyV1',
    targetClaimIds: ['claim:1'],
    expectedHeadDigest: fillerDeltas.at(-1),
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
  const fillerClosure = filler.seal(fillerPolicy)
  assert.equal(fillerClosure.includedDeltaDigests.length, fillerDeltas.length)
  appendAuditRecord(filler, fillerClosure.closureDigest, 'record-filler')

  const holder = new EvidenceDeltaChain('codex:thread-holder')
  const { closure: holderClosure } = sealChainHead({
    chain: holder,
    payload: { trace: [{ id: 'trace-1', ref: pinnedRef }] }
  })
  appendAuditRecord(holder, holderClosure.closureDigest, 'record-holder-unrelated')
  appendAuditRecord(holder, holderClosure.closureDigest, 'record-holder-referenced', {
    note: { ref: pinnedRef }
  })

  const result = evaluate([filler, holder], { artifactVersionRef: pinnedRef })

  // The owner sees the later holder even beyond the old scan limit.
  assert.deepEqual(result.records.map(record => record.recordId), ['record-holder-referenced'])
  assert.equal(result.freshness, 'pending')
  assert.equal(result.complete, false)
  assert.deepEqual(result.gapCodes, ['source_unavailable:checkpoint'])
})

test('warm production owner indexes only a one-delta suffix and keeps unrelated chain cached', t => {
  const chain = new EvidenceDeltaChain('codex:suffix'), other = new EvidenceDeltaChain('codex:other')
  const { closure } = sealChainHead({ chain, payload: { claims: [{ id: 'claim:1' }], sources: [{ id: 'paper', ref: pinnedRef }], edges: [{ source: 'paper', target: 'claim:1', family: 'supports' }] } })
  appendAuditRecord(chain, closure.closureDigest, 'suffix-record', { ref: pinnedRef })
  sealChainHead({ chain: other })
  const append = (n: number, target = chain) => target.append({ scope: { runtimeId: 'codex', threadId: target.head.threadId, workspaceRoot: '/workspace', operationId: `suffix-${n}`, kind: 'turn' }, requestedWatermark: '1', schemaVersion: 'evidence.delta.v1', extractorVersion: 'test', verifierVersion: 'test', idempotencyKey: `suffix-event-${n}`, payload: {} })
  for (let n = 0; n < 1100; n++) append(n)
  const index = new OwnerAuditIndex(), chains = new Map([[chain.head.threadId, chain], [other.head.threadId, other]])
  const subject = { threadId: chain.head.threadId }
  index.query(chains, subject)
  const suffix = t.mock.method(chain, 'auditSuffix'), otherSuffix = t.mock.method(other, 'auditSuffix')
  append(1101)
  t.mock.method(chain, 'list', () => { throw new Error('query copied history') })
  t.mock.method(chain, 'closures', () => { throw new Error('query copied closures') })
  t.mock.method(chain, 'sidechainRecords', () => { throw new Error('query copied records') })
  const changed = index.query(chains, subject)
  assert.equal(changed.review.coverageDetails?.scannedDeltas, 1)
  assert.equal(changed.review.coverageDetails?.extractionNodes, 1)
  assert.equal(suffix.mock.callCount(), 1)
  assert.equal(otherSuffix.mock.callCount(), 0)
  assert.equal(suffix.mock.calls[0].arguments[0].deltas, 1101)
  const read = chain.auditSuffix({ deltas: 0, closures: 0, records: 0 }, 1).deltas[0]
  assert.throws(() => { (read.payload as Record<string, unknown>).injected = true }, TypeError)
  append(5000, other)
  const cached = index.query(chains, subject)
  assert.equal(cached.review.coverageDetails?.queryNodes, 0)
  assert.equal(cached.evaluation.records.length, 1)
})

test('bootstrap advances in bounded suffixes and incomplete identity extraction cannot claim absence', () => {
  const chain = new EvidenceDeltaChain('codex:bootstrap')
  for (let n = 0; n < 2200; n++) chain.append({ scope: { runtimeId: 'codex', threadId: chain.head.threadId, workspaceRoot: '/workspace', operationId: `boot-${n}`, kind: 'turn' }, requestedWatermark: '1', schemaVersion: 'evidence.delta.v1', extractorVersion: 'test', verifierVersion: 'test', idempotencyKey: `bootstrap-${n}`, payload: {} })
  const index = new OwnerAuditIndex(), chains = new Map([[chain.head.threadId, chain]])
  const first = index.query(chains, { artifactVersionRef: pinnedRef })
  assert.equal(first.review.coverageDetails?.scannedDeltas, 2048)
  assert.equal(first.review.coverageDetails?.indexedDeltas, 2048)
  assert.equal(first.review.coverageDetails?.totalRelevantDeltas, 2200)
  assert.ok(first.review.coverageDetails?.reasons.includes('index-bootstrap-incomplete'))
  assert.ok(first.evaluation.gapCodes.includes('scan_bounded'))
  const second = index.query(chains, { threadId: chain.head.threadId })
  assert.equal(second.review.coverageDetails?.scannedDeltas, 152)
  assert.equal(second.review.coverageDetails?.indexedDeltas, 2200)
  const hidden = new EvidenceDeltaChain('codex:hidden')
  sealChainHead({ chain: hidden, payload: { huge: Array.from({ length: 10001 }, () => 0), hidden: { ref: pinnedRef } } })
  const result = new OwnerAuditIndex().query(new Map([[hidden.head.threadId, hidden]]), { artifactVersionRef: pinnedRef })
  assert.ok(result.evaluation.gapCodes.includes('scan_bounded'))
  assert.equal(result.review.bounded, true)
})

test('scientific graph uses one total query budget across many records', () => {
  const chain = new EvidenceDeltaChain('codex:shared-budget')
  const { closure } = sealChainHead({ chain, payload: { claims: [{ id: 'claim:1', controls: ['comparison'] }], sources: [{ id: 'paper', ref: pinnedRef }], edges: [{ source: 'paper', target: 'claim:1', family: 'supports' }], assessments: Array.from({ length: 150 }, () => ({ id: 'unrelated' })) } })
  for (let n = 0; n < 90; n++) appendAuditRecord(chain, closure.closureDigest, `budget-record-${n}`, { ref: pinnedRef })
  const result = new OwnerAuditIndex().query(new Map([[chain.head.threadId, chain]]), { artifactVersionRef: pinnedRef })
  assert.equal(result.review.coverageDetails?.queryNodes, 10000)
  assert.equal(result.review.bounded, true)
  assert.ok(result.review.coverageDetails!.omittedRecords > 0)
  assert.ok(result.review.impacts.every(impact => impact.status !== 'no-recorded-impact'))
})

test('lifecycle source aliases require exact artifact/version/digest and ambiguous events remain unknown', () => {
  for (const event of [
    { artifactId: 'artifact:other', contentDigest: pinnedRef.contentDigest, expected: 'no-recorded-impact' },
    { artifactId: pinnedRef.artifactId, contentDigest: 'd'.repeat(64), expected: 'no-recorded-impact' },
    { artifactId: pinnedRef.artifactId, contentDigest: pinnedRef.contentDigest, expected: 'requires-review' },
    { artifactId: pinnedRef.artifactId, expected: 'unknown' },
    { expected: 'unknown' }
  ]) {
    const chain = new EvidenceDeltaChain('codex:lifecycle')
    const { closure } = sealChainHead({ chain, payload: { claims: [{ id: 'claim:1' }], sources: [{ id: 'paper', ref: pinnedRef }], edges: [{ source: 'paper', target: 'claim:1', family: 'supports' }] } })
    appendAuditRecord(chain, closure.closureDigest, 'lifecycle-record', { ref: pinnedRef })
    const { expected, ...identity } = event
    chain.append({ scope: { runtimeId: 'codex', threadId: chain.head.threadId, workspaceRoot: '/workspace', operationId: 'lifecycle', kind: 'turn' }, requestedWatermark: '1', schemaVersion: 'evidence.delta.v1', extractorVersion: 'test', verifierVersion: 'test', idempotencyKey: 'lifecycle-event', payload: { eventId: 'evt:1', type: 'availability-changed', versionId: pinnedRef.versionId, ...identity } })
    const result = new OwnerAuditIndex().query(new Map([[chain.head.threadId, chain]]), { artifactVersionRef: pinnedRef })
    assert.equal(result.review.impacts[0].status, expected)
  }
})

test('conflicting full-ref metadata produces an explicit identity gap and unknown impact', () => {
  const chain = new EvidenceDeltaChain('codex:metadata')
  const { closure } = sealChainHead({ chain, payload: { claims: [{ id: 'claim:1' }], sources: [{ id: 'paper', ref: pinnedRef }], edges: [{ source: 'paper', target: 'claim:1', family: 'supports' }] } })
  appendAuditRecord(chain, closure.closureDigest, 'metadata-record', { ref: pinnedRef })
  const index = new OwnerAuditIndex(), chains = new Map([[chain.head.threadId, chain]])
  for (const ref of [{ ...pinnedRef, byteLength: 10 }, { ...pinnedRef, accessPolicy: { ...pinnedRef.accessPolicy, allowExport: true } }]) {
    const result = index.query(chains, { artifactVersionRef: ref })
    assert.ok(result.evaluation.gapCodes.includes('identity_metadata_conflict'))
    assert.equal(result.review.impacts[0].status, 'unknown')
  }
})

test('unknown-root legacy records and cross-workspace records never leak to scoped queries', () => {
  const legacy = new EvidenceDeltaChain('codex:legacy-scope')
  const snapshot = { threadId: legacy.head.threadId, version: 1, digest: `sha256:${'d'.repeat(64)}`, inputWatermark: '1', schemaVersion: 'evidence.v3', extractorVersion: 'extractor.v3', verifierVersion: 'verifier.v3', artifactDigests: [], createdAt }
  legacy.importLegacyRoot({ snapshot, snapshotBytes: Buffer.from(JSON.stringify(snapshot)), ancestry: 'proven' })
  const closure = legacy.seal(evidenceDagClosurePolicyV1Schema.parse({ version: 'EvidenceClosurePolicyV1', targetClaimIds: ['claim:legacy'], expectedHeadDigest: legacy.head.headDigest, barrierWatermark: '1', edgeFamilies: [], directions: ['inbound'], maxDepth: 0, termination: 'depth', expandEquivalent: false, expandRefinement: false, cycleHandling: 'allow', unknownEdgeHandling: 'ignore', requiredRecords: [], requiredExternalRefs: [] }))
  appendAuditRecord(legacy, closure.closureDigest, 'private-legacy', { ref: pinnedRef })
  assert.equal(evaluate([legacy], { threadId: legacy.head.threadId }, '/workspace').records.length, 0)
  assert.equal(new OwnerAuditIndex().query(new Map([[legacy.head.threadId, legacy]]), { artifactVersionRef: pinnedRef }, '/workspace').evaluation.records.length, 0)
  const chain = new EvidenceDeltaChain('codex:foreign')
  const { closure: scoped } = sealChainHead({ chain })
  appendAuditRecord(chain, scoped.closureDigest, 'foreign-record', { ref: pinnedRef })
  assert.equal(evaluate([chain], { artifactVersionRef: pinnedRef }, '/foreign').records.length, 0)
})

test('canonical store query uses suffix append and discards a failed persisted append', async t => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'audit-store-suffix-')))
  const store = new EvidenceDagDeltaStore(join(directory, 'deltas.json'))
  const input = { scope: { runtimeId: 'codex', threadId: 'codex:store-suffix', operationId: 'store-1', workspaceRoot: directory, kind: 'turn' as const }, requestedWatermark: '1', schemaVersion: 'evidence.delta.v1', extractorVersion: 'test', verifierVersion: 'test', idempotencyKey: 'store-suffix-1', payload: {} }
  await store.append(input)
  const subject = { threadId: input.scope.threadId }
  await store.queryAudit(subject, directory)
  await store.append({ ...input, idempotencyKey: 'store-suffix-2' })
  const added = await store.queryAudit(subject, directory)
  assert.equal(added.review.coverageDetails?.scannedDeltas, 1)
  assert.equal(added.review.coverageDetails?.indexedDeltas, 2)
  const write = t.mock.method(EvidenceFileStorage.prototype, 'writeText', () => { throw new Error('persist interrupted') })
  await assert.rejects(store.append({ ...input, idempotencyKey: 'store-suffix-3' }), /persist interrupted/)
  write.mock.restore()
  const rolledBack = await store.queryAudit(subject, directory)
  assert.equal(rolledBack.review.coverageDetails?.indexedDeltas, 2)
  assert.equal(rolledBack.review.coverageDetails?.scannedDeltas, 2)
  assert.equal((await new EvidenceDagDeltaStore(join(directory, 'deltas.json')).queryAudit(subject, directory)).review.coverageDetails?.indexedDeltas, 2)
})

test('deep extraction and large record projections stay bounded without a false complete result', () => {
  const chain = new EvidenceDeltaChain('codex:deep')
  let deep: unknown = { ref: pinnedRef }
  for (let depth = 0; depth < 90; depth++) deep = { nested: deep }
  const { closure } = sealChainHead({ chain, payload: { claims: [{ id: 'claim:1' }], deep } })
  appendAuditRecord(chain, closure.closureDigest, 'large-record', { ref: pinnedRef, huge: 'x'.repeat(700000) })
  const result = new OwnerAuditIndex().query(new Map([[chain.head.threadId, chain]]), { threadId: chain.head.threadId })
  assert.equal(result.evaluation.records.length, 0)
  assert.equal(result.evaluation.complete, false)
  assert.ok(result.evaluation.gapCodes.includes('scan_bounded'))
  assert.equal(result.review.bounded, true)
})

test('missing exact material identity and absent relation stay unknown', () => {
  for (const payload of [
    { claims: [{ id: 'claim:1' }], edges: [{ source: 'paper', target: 'claim:1', family: 'supports' }] },
    { claims: [{ id: 'claim:1' }], sources: [{ id: 'paper', ref: pinnedRef }] }
  ]) {
    const chain = new EvidenceDeltaChain('codex:unknown')
    const { closure } = sealChainHead({ chain, payload })
    appendAuditRecord(chain, closure.closureDigest, 'unknown-record')
    const result = new OwnerAuditIndex().query(new Map([[chain.head.threadId, chain]]), { threadId: chain.head.threadId })
    assert.equal(result.review.impacts[0].status, 'unknown')
  }
})

test('bootstrap work is globally capped across chains and a second index does not count old work', () => {
  const chains = new Map<string, EvidenceDeltaChain>()
  for (let c = 0; c < 2; c++) {
    const chain = new EvidenceDeltaChain(`codex:global-${c}`)
    chains.set(chain.head.threadId, chain)
    for (let n = 0; n < 1100; n++) chain.append({ scope: { runtimeId: 'codex', threadId: chain.head.threadId, workspaceRoot: '/workspace', operationId: `global-${n}`, kind: 'turn' }, requestedWatermark: '1', schemaVersion: 'evidence.delta.v1', extractorVersion: 'test', verifierVersion: 'test', idempotencyKey: `global-${n}`, payload: {} })
  }
  const index = new OwnerAuditIndex()
  assert.equal(index.query(chains, { artifactVersionRef: pinnedRef }).review.coverageDetails?.scannedDeltas, 2048)
  assert.equal(index.query(chains, { artifactVersionRef: pinnedRef }).review.coverageDetails?.scannedDeltas, 152)
  const reused = new OwnerAuditIndex().query(chains, { threadId: 'codex:global-0' })
  assert.equal(reused.review.coverageDetails?.scannedDeltas, 0)
  assert.equal(reused.review.coverageDetails?.extractionNodes, 0)
})

test('a shared version-string graph node cannot guess between complete artifact identities', () => {
  const chain = new EvidenceDeltaChain('codex:collision')
  const { closure } = sealChainHead({ chain, payload: { claims: [{ id: 'claim:1' }], sources: [{ id: pinnedRef.versionId, ref: pinnedRef }, { id: pinnedRef.versionId, ref: { ...pinnedRef, artifactId: 'artifact:other' } }], edges: [{ source: pinnedRef.versionId, target: 'claim:1', family: 'supports' }] } })
  appendAuditRecord(chain, closure.closureDigest, 'collision-record')
  chain.append({ scope: { runtimeId: 'codex', threadId: chain.head.threadId, workspaceRoot: '/workspace', operationId: 'collision', kind: 'turn' }, requestedWatermark: '1', schemaVersion: 'evidence.delta.v1', extractorVersion: 'test', verifierVersion: 'test', idempotencyKey: 'collision-event', payload: { eventId: 'event:collision', type: 'availability-changed', versionId: pinnedRef.versionId, artifactId: pinnedRef.artifactId, contentDigest: pinnedRef.contentDigest } })
  const result = new OwnerAuditIndex().query(new Map([[chain.head.threadId, chain]]), { threadId: chain.head.threadId })
  assert.equal(result.review.impacts[0].status, 'unknown')
})

test('canonical lifecycle event detail retains previous exact identity for source aliases', async () => {
  const { artifactVersionLifecycleEventV1Schema } = await import('@sciforge/domain-artifact-versions/contract')
  const chain = new EvidenceDeltaChain('codex:canonical-detail')
  const { closure } = sealChainHead({ chain, payload: { claims: [{ id: 'claim:1' }], sources: [{ id: 'paper', ref: pinnedRef }], edges: [{ source: 'paper', target: 'claim:1', family: 'supports' }] } })
  appendAuditRecord(chain, closure.closureDigest, 'canonical-detail-record', { ref: pinnedRef })
  const event = artifactVersionLifecycleEventV1Schema.parse({ schemaVersion: 1, eventId: 'artifact-event:canonical-detail', sequence: 1, type: 'artifact-content-changed', artifactId: pinnedRef.artifactId, versionId: 'artifact-version:new', previousVersionId: pinnedRef.versionId, createdAt, detail: { previousContentDigest: pinnedRef.contentDigest, contentDigest: 'd'.repeat(64) } })
  chain.append({ scope: { runtimeId: 'codex', threadId: chain.head.threadId, workspaceRoot: '/workspace', operationId: 'canonical-detail', kind: 'turn' }, requestedWatermark: '1', schemaVersion: 'evidence.delta.v1', extractorVersion: 'test', verifierVersion: 'test', idempotencyKey: 'canonical-detail-event', payload: { lifecycleEvents: [event] } })
  const result = new OwnerAuditIndex().query(new Map([[chain.head.threadId, chain]]), { artifactVersionRef: pinnedRef })
  assert.equal(result.review.impacts[0].status, 'requires-review')
  assert.equal(result.review.impacts[0].changes[0].reason, 'artifact-content-changed')
})

test('canonical new-version digest never substitutes for missing previous-version digest', async () => {
  const { artifactVersionLifecycleEventV1Schema } = await import('@sciforge/domain-artifact-versions/contract')
  const chain = new EvidenceDeltaChain('codex:canonical-missing-detail')
  const { closure } = sealChainHead({ chain, payload: { claims: [{ id: 'claim:1' }], sources: [{ id: 'paper', ref: pinnedRef }], edges: [{ source: 'paper', target: 'claim:1', family: 'supports' }] } })
  appendAuditRecord(chain, closure.closureDigest, 'canonical-missing-detail-record', { ref: pinnedRef })
  const event = artifactVersionLifecycleEventV1Schema.parse({ schemaVersion: 1, eventId: 'artifact-event:canonical-missing-detail', sequence: 1, type: 'artifact-content-changed', artifactId: pinnedRef.artifactId, versionId: 'artifact-version:new', previousVersionId: pinnedRef.versionId, createdAt, detail: { contentDigest: pinnedRef.contentDigest } })
  chain.append({ scope: { runtimeId: 'codex', threadId: chain.head.threadId, workspaceRoot: '/workspace', operationId: 'canonical-missing-detail', kind: 'turn' }, requestedWatermark: '1', schemaVersion: 'evidence.delta.v1', extractorVersion: 'test', verifierVersion: 'test', idempotencyKey: 'canonical-missing-detail-event', payload: { lifecycleEvents: [event] } })
  const result = new OwnerAuditIndex().query(new Map([[chain.head.threadId, chain]]), { artifactVersionRef: pinnedRef })
  assert.equal(result.review.impacts[0].status, 'unknown')
  assert.equal(result.review.bounded, true)
})

test('an exact closure not reached by cold bootstrap reports omitted coverage', () => {
  const chain = new EvidenceDeltaChain('codex:cold-closure')
  for (let n = 0; n < 2050; n++) chain.append({ scope: { runtimeId: 'codex', threadId: chain.head.threadId, workspaceRoot: '/workspace', operationId: `cold-${n}`, kind: 'turn' }, requestedWatermark: '1', schemaVersion: 'evidence.delta.v1', extractorVersion: 'test', verifierVersion: 'test', idempotencyKey: `cold-closure-${n}`, payload: {} })
  const { closure } = sealChainHead({ chain })
  appendAuditRecord(chain, closure.closureDigest, 'cold-closure-record')
  const index = new OwnerAuditIndex(), chains = new Map([[chain.head.threadId, chain]])
  const first = index.query(chains, { closureDigest: closure.closureDigest }, '/workspace')
  assert.equal(first.review.bounded, true)
  assert.ok(first.review.coverageDetails?.reasons.includes('index-bootstrap-incomplete'))
  assert.ok(first.evaluation.gapCodes.includes('scan_bounded'))
  assert.equal(first.evaluation.records.length, 0)
  const second = index.query(chains, { closureDigest: closure.closureDigest }, '/workspace')
  assert.equal(second.evaluation.records.length, 1)
})
