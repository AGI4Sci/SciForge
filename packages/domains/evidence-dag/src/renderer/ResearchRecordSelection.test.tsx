import assert from 'node:assert/strict'
import test from 'node:test'
import { openRecordSelection } from './ResearchRecordSelection'
import type { DomainRendererSelectionSnapshot } from '@sciforge/domain-sdk/host'
const selection: DomainRendererSelectionSnapshot = { schemaVersion: 1, kind: 'resource-text-selection', resourceKind: 'research-record-node', resourceId: 'record-1', label: '失败', quote: '待复核', revision: 'record:1', capturedAt: '2026-11-04T00:00:00.000Z', scope: { workspaceRoot: '/science', runtimeId: 'codex', threadId: 'original' }, bounds: { x: 0, y: 0, width: 100, height: 20 }, viewport: { width: 800, height: 600, scaleFactor: 1 } }
test('one click uses public resource route with exact parent identity and non-authorizing context', async () => {
  let received: unknown
  await openRecordSelection(selection, { canOpenResource: kind => kind === selection.kind, openResource: input => { received = input; return true } })
  assert.deepEqual(received, { sessionId: 'original', resource: { resourceKind: selection.kind, resourceId: selection.resourceId, context: selection } })
})
test('missing, revoked and failed routes never report a saved annotation', async () => {
  await assert.rejects(openRecordSelection(selection), /尚未保存/)
  await assert.rejects(openRecordSelection(selection, { canOpenResource: () => false, openResource: () => { throw new Error('must not call') } }), /尚未保存/)
  await assert.rejects(openRecordSelection(selection, { canOpenResource: () => true, openResource: () => false }), /尚未保存/)
})
