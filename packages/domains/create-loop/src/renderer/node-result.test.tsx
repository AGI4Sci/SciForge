import assert from 'node:assert/strict'
import test from 'node:test'
import type { WorkflowNodeRunResultV1 } from '../contract.js'
import { latestNodeResult } from './workflow/node-result.js'

function result(nodeId: string, finishedAt: string): WorkflowNodeRunResultV1 {
  return {
    nodeId,
    status: 'success',
    startedAt: finishedAt,
    finishedAt,
    message: '',
    outputJson: '{}',
    threadId: '',
    error: '',
    componentFingerprint: 'a'.repeat(64),
    inputFingerprint: 'b'.repeat(64),
    outputFingerprint: 'c'.repeat(64),
    attempts: [],
    artifactRefs: []
  }
}

test('single-node test output becomes the latest result for its node', () => {
  const persisted = result('node-a', '2026-08-10T08:00:00.000Z')
  const tested = result('node-a', '2026-08-10T08:01:00.000Z')

  assert.equal(latestNodeResult('node-a', persisted, tested), tested)
})

test('single-node test output is isolated by node and does not hide a newer run', () => {
  const persisted = result('node-a', '2026-08-10T08:02:00.000Z')
  const olderTest = result('node-a', '2026-08-10T08:01:00.000Z')
  const otherNodeTest = result('node-b', '2026-08-10T08:03:00.000Z')

  assert.equal(latestNodeResult('node-a', persisted, olderTest), persisted)
  assert.equal(latestNodeResult('node-a', null, otherNodeTest), null)
})
