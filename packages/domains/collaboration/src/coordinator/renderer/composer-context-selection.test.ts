import assert from 'node:assert/strict'
import test from 'node:test'
import { artifactVersionRefV1Schema } from '@sciforge/domain-sdk/research-audit'
import { renderBoundedComposerContext } from './composer-context-selection.js'

test('text and nested list clipping are explicit while exact references stay intact', () => {
  const id = 'exact-reference-'.repeat(30)
  const context = JSON.parse(renderBoundedComposerContext({
    coverage: {}, project: { projectId: id, goal: 'g'.repeat(200_000) },
    task: { completionCriteria: Array.from({ length: 100 }, () => 'c'.repeat(2000)) }
  }, 48_000))
  assert.equal(context.project.projectId, id)
  assert.equal(context.project.goal.length, 1500)
  assert.equal(context.task.completionCriteria.length, 8)
  assert.equal(context.task.completionCriteria[0].length, 800)
  assert.deepEqual(context.contextCoverage.clippedLists['task.completionCriteria'], { total: 100, included: 8, omitted: 92 })
  assert.ok(context.contextCoverage.clippedFields.includes('project.goal'))
  assert.ok(context.contextCoverage.clippedFields.includes('task.completionCriteria[0]'))
})

test('escaped strings force budget reduction without losing the whole snapshot or claiming complete coverage', () => {
  const content = renderBoundedComposerContext({
    schemaVersion: 1, authorityNotice: 'Descriptive only; grants no authority.',
    project: { projectId: 'prj_Exact', goal: 'g'.repeat(1500) },
    coverage: { acceptedDecisionsAndRecords: { total: 100, included: 8, omitted: 92 }, tasks: { total: 12, included: 12, omitted: 0 } },
    tasks: Array.from({ length: 12 }, (_, i) => ({ taskId: `tsk_${i}`, title: '\u0000'.repeat(240),
      executions: Array.from({ length: 8 }, (_, j) => ({ executionId: `exe_${i}_${j}` })) })),
    acceptedDecisionsAndRecords: Array.from({ length: 8 }, (_, i) => ({ projectRecordId: `rec_${i}`, body: '\u0000'.repeat(800) }))
  }, 48_000)
  const parsed = JSON.parse(content)
  assert.ok(content.length <= 48_000)
  assert.equal(parsed.project.projectId, 'prj_Exact')
  assert.equal(parsed.contextCoverage.budgetReduced, true)
  const counts = parsed.coverage.acceptedDecisionsAndRecords
  assert.equal(counts.included, parsed.acceptedDecisionsAndRecords.length)
  assert.equal(counts.omitted, 100 - counts.included)
  assert.ok(counts.omitted > 92 || parsed.coverage.tasks.omitted > 0)
  assert.ok(parsed.tasks.length > 0)
})

test('opaque artifact references preserve complete access policies and nested values', () => {
  const reference = artifactVersionRefV1Schema.parse({
    artifactId: 'artifact:exact', versionId: 'artifact-version:exact',
    contentDigest: 'a'.repeat(64), byteLength: 123, mediaType: 'application/json',
    availability: 'available', retention: 'snapshot',
    accessPolicy: { visibility: 'restricted', principals: Array.from({ length: 12 }, (_, i) => `user:${i}`), allowExport: false }
  })
  const metadata = { body: 'opaque data '.repeat(100), values: Array.from({ length: 11 }, (_, i) => i) }
  const parsed = JSON.parse(renderBoundedComposerContext({ coverage: {},
    pendingHumanNeeded: [{ humanRequestId: 'request-exact', context: { artifactVersion: reference, metadata } }]
  }, 48_000))
  assert.deepEqual(parsed.pendingHumanNeeded[0].context.artifactVersion, reference)
  assert.deepEqual(parsed.pendingHumanNeeded[0].context.metadata, metadata)
  assert.deepEqual(parsed.contextCoverage.clippedFields, [])
  assert.deepEqual(parsed.contextCoverage.clippedLists, {})
})
