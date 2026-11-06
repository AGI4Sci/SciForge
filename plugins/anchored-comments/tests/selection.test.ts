import assert from 'node:assert/strict'
import test from 'node:test'
import { selectionCommentInput, selectionFromResource } from '../src/selection.js'
const host = { workspaceRoot: '/research', sessionId: 'parent', runtimeId: 'codex' }
const selection = { schemaVersion: 1, kind: 'resource-text-selection', resourceKind: 'research-record-node', resourceId: 'event-a', label: '失败的检查', quote: 'exit=7\n仍待复核', revision: 'record:53', capturedAt: '2026-11-04T00:00:00.000Z', scope: { runtimeId: 'codex', threadId: 'parent', workspaceRoot: '/research' }, source: { runtimeId: 'claude', threadId: 'source', turnId: 'turn-1', itemId: 'item-2' }, bounds: { x: 2, y: 3, width: 100, height: 20 }, viewport: { width: 800, height: 600, scaleFactor: 1 } }
test('selection receiver retains exact quote, foreign source and unresolved capture without asserting approval', () => {
  const input = selectionCommentInput(selection, '请复核负例', host, 'comment-a', selection.capturedAt)
  assert.deepEqual(input.thread.anchor.canonical, { kind: 'research', resourceKind: selection.resourceKind, resourceId: selection.resourceId, contentDigest: 'record:53', selection: { quote: selection.quote, runtimeId: 'codex', threadId: 'parent', sourceRuntimeId: 'claude', sourceThreadId: 'source', turnId: 'turn-1', itemId: 'item-2' } })
  assert.equal(input.thread.status, 'open'); assert.equal(input.thread.anchorResolution, 'needs_retargeting')
  assert.equal(input.thread.capture.fullWindowScreenshot, undefined)
  assert.match(input.thread.capture.unavailableReason!, /未请求截图/)
})
test('selection receiver rejects forged workspace, oversize or malformed selections and empty comments', () => {
  assert.throws(() => selectionCommentInput(selection, 'note', { ...host, workspaceRoot: '/other' }, 'a', selection.capturedAt), /工作区/)
  for (const value of [{ ...selection, quote: 'a'.repeat(4001) }, { ...selection, kind: 'approval' }, { ...selection, approval: true }]) assert.throws(() => selectionCommentInput(value, 'note', host, 'a', selection.capturedAt))
  assert.throws(() => selectionCommentInput(selection, '', host, 'a', selection.capturedAt))
})

test('activation receiver validates exact resource and all Host identity facts, never context authority', () => {
  const resource = { resourceKind: 'resource-text-selection', resourceId: selection.resourceId, context: selection }
  assert.deepEqual(selectionFromResource(resource, host), selection)
  for (const forged of [{ ...host, sessionId: 'another' }, { ...host, runtimeId: 'other' }, { ...host, runtimeId: '' }, { ...host, workspaceRoot: '/other' }]) assert.throws(() => selectionFromResource(resource, forged))
  for (const forged of [{ ...resource, resourceId: 'other' }, { ...resource, resourceKind: 'other' }, { ...resource, context: { ...selection, capabilityIds: ['anchored-comments.upsert'] } }, { ...resource, context: null }]) assert.throws(() => selectionFromResource(forged, host))
})
