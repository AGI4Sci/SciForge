import assert from 'node:assert/strict'
import test from 'node:test'
import { researchAuditEvidenceAuditQueryOutputSchema } from '@sciforge/domain-sdk/research-audit'
import { materialReviewDiscussion, materialReviewStatus, MATERIAL_REVIEW_CONTEXT_LIMIT } from './material-review-discussion'

const scope = { runtimeId: 'codex', threadId: 'parent', workspaceRoot: '/research' }
const reference = { artifactId: 'artifact:a', versionId: 'artifact-version:old', contentDigest: 'a'.repeat(64), byteLength: 32, availability: 'available' as const, retention: 'reference' as const, accessPolicy: { visibility: 'workspace' as const, principals: [], allowExport: false } }
const make = () => researchAuditEvidenceAuditQueryOutputSchema.parse({ subject: { artifactVersionRef: reference }, records: [], completeness: { complete: false, gapCodes: ['unmapped'] }, freshness: 'fresh', source: 'evidence-dag', scientificReview: { coverage: 'recorded-links-only', bounded: false, impacts: [], conditions: ['independence', 'controls', 'negative-results', 'reproduction', 'scope'].map(axis => ({ axis, status: 'unknown', observations: [] })) } })

test('material discussion is an exact parent-scoped draft with unknowns, never a model dispatch or approval', () => {
  const request = materialReviewDiscussion(scope, reference, make())
  assert.equal(request.parentThreadId, scope.threadId)
  assert.equal(request.runtimeId, scope.runtimeId)
  assert.equal(request.workspaceRoot, scope.workspaceRoot)
  assert.equal(request.title, '讨论材料')
  assert.equal(request.question, undefined)
  assert.equal(Object.hasOwn(request, 'question'), false)
  assert.ok(request.context!.text.includes(JSON.stringify(reference)))
  assert.match(request.context!.text, /unmapped/)
  assert.match(request.context!.text, /不构成人工审阅/)
  assert.deepEqual(materialReviewStatus(make()), { attention: true, label: '核查范围有缺口' })
  const result = make(); result.subject = { artifactVersionRef: { ...reference, accessPolicy: { ...reference.accessPolicy, allowExport: true } } }
  assert.throws(() => materialReviewDiscussion(scope, reference, result), /身份不一致/)
})

test('large review context keeps exact identity, marks omissions and never exceeds its disclosed bound', () => {
  const result = make()
  result.scientificReview!.conditions[0].observations = Array.from({ length: 20 }, (_, index) => ({ targetId: `claim:${index}`, recordDigest: 'sha256:' + 'b'.repeat(64), closureDigest: 'sha256:' + 'c'.repeat(64), digest: 'sha256:' + 'd'.repeat(64), field: 'independence', text: '未验证。'.repeat(400) }))
  const text = materialReviewDiscussion(scope, reference, result).context!.text
  assert.ok(text.length <= MATERIAL_REVIEW_CONTEXT_LIMIT)
  assert.ok(text.includes(JSON.stringify(reference)))
  assert.match(text, /部分观察\/影响未带入/)
})

test('changed material stays actionable; fresh bytes and an empty impact list never imply human approval', () => {
  const result = make()
  result.scientificReview!.impacts.push({ recordDigest: 'sha256:' + 'b'.repeat(64), closureDigest: 'sha256:' + 'c'.repeat(64), status: 'requires-review', affectedIds: ['claim:a'], affected: [{ id: 'claim:a', title: '需复核条件' }], changes: [] })
  assert.deepEqual(materialReviewStatus(result), { attention: true, label: '1 项影响待复核' })
  assert.match(materialReviewDiscussion(scope, reference, result).context!.text, /需复核条件/)
})
