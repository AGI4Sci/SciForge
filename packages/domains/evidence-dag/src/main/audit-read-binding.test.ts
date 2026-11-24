import assert from 'node:assert/strict'
import test from 'node:test'
import { EvidenceDeltaChain } from './evidence-delta.js'
import { OwnerAuditIndex } from './audit-index.js'

const digest = 'sha256:' + 'a'.repeat(64)
const ref = { artifactId: 'artifact:one', versionId: 'artifact-version:one', contentDigest: 'b'.repeat(64), byteLength: 1,
  availability: 'available' as const, retention: 'snapshot' as const, accessPolicy: { visibility: 'workspace' as const, principals: [], allowExport: false } }
function fixture() {
  const chain = new EvidenceDeltaChain('codex:thread')
  chain.append({ scope: { runtimeId: 'codex', threadId: 'codex:thread', workspaceRoot: '/workspace', operationId: 'turn:1', kind: 'turn' },
    requestedWatermark: '1', schemaVersion: 'delta.v1', extractorVersion: 'test', verifierVersion: 'test', idempotencyKey: 'fixture-turn-1',
    payload: { claims: [{ id: 'claim:one', ref }] } })
  const closure = chain.seal({ version: 'EvidenceClosurePolicyV1', targetClaimIds: ['claim:one'], expectedHeadDigest: chain.head.headDigest!,
    barrierWatermark: '1', edgeFamilies: [], directions: ['inbound'], maxDepth: 0, termination: 'depth', expandEquivalent: false,
    expandRefinement: false, cycleHandling: 'allow', unknownEdgeHandling: 'ignore', requiredRecords: [], requiredExternalRefs: [] })
  chain.setCommittedEvidenceSnapshot({ threadId: 'codex:thread', digest, version: 1, inputWatermark: '1', schemaVersion: 'evidence.v3',
    extractorVersion: 'test', verifierVersion: 'test', artifactDigests: [], createdAt: '2026-01-01T00:00:00Z' }, closure.closureDigest)
  const index = new OwnerAuditIndex(), chains = new Map([['codex:thread', chain]])
  return { chain, closure, query: (subject: Parameters<OwnerAuditIndex['query']>[1], workspace = '/workspace') => index.query(chains, subject, workspace) }
}

test('closure maps to exact snapshot and captured runtime identity without parsing thread names', () => {
  const f = fixture()
  const result = f.query({ closureDigest: f.closure.closureDigest })
  assert.deepEqual(result.bindings, { scopes: [{ engineThreadId: 'codex:thread', runtimeId: 'codex', threadId: 'codex:thread', snapshotDigest: digest }], reasons: [] })
  assert.deepEqual(f.query({ closureDigest: f.closure.closureDigest }, '/other').bindings.scopes, [])
  assert.deepEqual(f.query({ threadId: 'codex:thread', headDigest: 'sha256:' + 'c'.repeat(64) }).bindings.scopes, [])
})

test('material binding works before any sidechain record and does not invent complete snapshot history', () => {
  const f = fixture()
  const result = f.query({ artifactVersionRef: ref })
  assert.equal(result.evaluation.records.length, 0)
  assert.equal(result.bindings.scopes[0].snapshotDigest, digest)
  assert.ok(result.bindings.reasons.includes('snapshot_history_coverage_limited'))
  assert.deepEqual(f.query({ artifactVersionRef: { ...ref, contentDigest: 'c'.repeat(64) } }).bindings.scopes, [])
})
