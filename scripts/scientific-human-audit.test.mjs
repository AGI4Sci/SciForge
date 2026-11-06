import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { digest } from './local-release/release.mjs'
import { runHumanAudit, scoreHuman } from './scientific-human-audit.mjs'
test('pending human import has null human measurements', async () => {
  const report = await runHumanAudit(resolve('scripts/scientific-human-audit.manifest.json'))
  assert.equal(report.human.status, 'not measured'); assert.equal(report.human.defects, null)
  assert.equal(report.human.reviewDurationMs, null); assert.deepEqual(report.queries, [])
})
test('scoring counts misses, false positives and exact evidence spans separately', () => {
  const ref = { independentlyAnnotated: true, annotator: 'reference-reviewer', issues: [{ id: 'natural', caseId: 'a' }, { id: 'missed', caseId: 'a' }] }
  const cases = [{ id: 'a', materialIds: ['m'] }], materials = [{ id: 'm', text: 'evidence text' }]
  const result = scoreHuman(ref, [{ id: 'seed', caseId: 'a' }], { status: 'completed', reviewer: 'test-only', reviewDurationMs: 10, completedCaseIds: ['a'], findings: [
    { caseId: 'a', issueId: 'natural', materialId: 'm', start: 0, end: 8, quote: 'evidence' },
    { caseId: 'a', issueId: 'unknown', materialId: 'm', start: 0, end: 8, quote: 'wrong' }
  ] }, materials, cases)
  assert.equal(result.defects.reference.detected, 1); assert.deepEqual(result.defects.reference.missedIds, ['missed'])
  assert.deepEqual(result.defects.seeded.missedIds, ['seed']); assert.equal(result.defects.falsePositives, 1)
  assert.deepEqual(result.lookup.map(v => v.verifiedExactSpan), [true, false])
  assert.equal(scoreHuman(null, [], null, materials, cases).reviewDurationMs, null)
})
test('authorized fixture executes production owner and client, refuses tampered input', async () => {
  const root = await mkdtemp(join(resolve(tmpdir()), 'human-audit-fixture-'))
  const text = 'TEST ONLY: no real participant or real scientific material.', sha256 = digest(text)
  await writeFile(join(root, 'material.txt'), text)
  const manifest = { schemaVersion: 1, status: 'ready', materials: [{ id: 'material', path: 'material.txt', sha256, sourceKind: 'authorized-local-sanitized', authorization: 'Deterministic test fixture authored for this test only; not a real-input measurement' }], cases: [{ id: 'test', materialIds: ['material'], reference: { artifactId: 'artifact:test', versionId: 'artifact-version:test', contentDigest: sha256, byteLength: Buffer.byteLength(text), availability: 'available', retention: 'reference', accessPolicy: { visibility: 'workspace', principals: [], allowExport: false } }, basePayload: { claims: [{ id: 'claim:test', text: 'Test claim', limitations: ['TEST_ONLY_LIMITATION'] }] } }] }
  manifest.cases[0].targetClaimIds = ['claim:test']
  manifest.cases[0].basePayload.edges = [{ source: 'source:old', target: 'claim:test', family: 'supports' }]
  manifest.cases[0].changedPayloads = [{ correction: { targetRecordId: 'source:old', relation: 'supersedes', reason: 'TEST_ONLY_MATERIAL_CHANGE' } }]
  const path = join(root, 'manifest.json'); await writeFile(path, JSON.stringify(manifest))
  const report = await runHumanAudit(path)
  assert.equal(report.queries.length, 1); assert.ok(report.queries[0].result.scientificReview)
  assert.equal(report.queries[0].result.scientificReview.impacts[0].status, 'requires-review')
  assert.equal(report.queries[0].result.scientificReview.conditions.find(c => c.axis === 'scope').status, 'recorded')
  assert.equal(report.materials[0].sha256, sha256); assert.equal(report.human.status, 'not measured')
  await writeFile(join(root, 'material.txt'), 'tampered')
  await assert.rejects(runHumanAudit(path), /integrity mismatch/)
})
