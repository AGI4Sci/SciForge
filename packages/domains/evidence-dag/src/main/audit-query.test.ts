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

const createdAt = '2026-09-01T00:00:00.000Z'

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
  const viaPolicy = appendAuditRecord(chainC, closureC.closureDigest, 'record-policy')
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
    ['record-membership', 'record-payload', 'record-policy']
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
    const chains = await store.auditChains()
    const byClosure = evaluate(chains, { closureDigest: closure.closureDigest })
    assert.deepEqual(byClosure.records.map((record) => record.recordId), ['record-readonly'])
    const byThread = evaluate(chains, { threadId: 'codex:thread-a' })
    assert.equal(byThread.records.length, 1)
    const byRef = evaluate(chains, { artifactVersionRef: pinnedRef })
    assert.equal(byRef.records.length, 1)
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

test('the cross-thread scan is bounded and reports scan_bounded when truncated', () => {
  // Budget: one unit per closure, member delta, and sidechain examined. The
  // first chain consumes the whole budget on member-delta payloads, so the
  // referencing sidechain in the second chain is never examined.
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

  // closure(filler) + filler member deltas + filler sidechain exhaust the
  // budget before the holder chain's records are examined.
  assert.deepEqual(result.records, [])
  assert.equal(result.freshness, 'unknown')
  assert.equal(result.complete, false)
  assert.deepEqual(result.gapCodes, ['source_unavailable:checkpoint', 'scan_bounded'])
})
