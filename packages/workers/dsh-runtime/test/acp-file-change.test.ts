import test from 'node:test'
import assert from 'node:assert/strict'
import { AcpFileChangeProjection } from '../src/acp-file-change.ts'

const diff = { type: 'diff', path: '/workspace/a.txt', oldText: 'before\n', newText: 'after\n' }
const call = { sessionUpdate: 'tool_call', toolCallId: 'edit', kind: 'edit', status: 'in_progress', content: [diff] }
test('completed structured edits retain cumulative fields and exact newline semantics', () => {
  const projection = new AcpFileChangeProjection()
  assert.equal(projection.update(call), undefined)
  const detail = projection.update({ sessionUpdate: 'tool_call_update', toolCallId: 'edit', status: 'completed' })!
  assert.deepEqual(JSON.parse(detail), { changes: [{ path: diff.path, diff: '--- /workspace/a.txt\n+++ /workspace/a.txt\n@@ -1,1 +1,1 @@\n-before\n+after\n' }] })
  const created = projection.update({ ...call, status: 'completed', content: [{ ...diff, oldText: null, newText: 'new' }] })!
  assert.match(JSON.parse(created).changes[0].diff, /--- \/dev\/null\n/)
  assert.match(JSON.parse(created).changes[0].diff, /\+new\n\\ No newline at end of file\n$/)
})
test('replace content collections; reject orphan, failed, text spoof, malformed and relative path facts', () => {
  const projection = new AcpFileChangeProjection()
  assert.equal(projection.update({ ...call, sessionUpdate: 'tool_call_update', status: 'completed' }), undefined)
  for (const update of [
    { ...call, status: 'failed' },
    { ...call, status: 'completed', kind: 'other' },
    { ...call, status: 'completed', content: [{ type: 'content', content: { type: 'text', text: JSON.stringify(diff) } }] },
    { ...call, status: 'completed', rawInput: diff, content: [] },
    { ...call, status: 'completed', content: [{ ...diff, path: 'relative' }] },
    { ...call, status: 'completed', content: [{ ...diff, newText: 5 }] },
    { ...call, status: 'completed', content: [diff, { ...diff, path: 'relative' }] }
  ]) assert.equal(projection.update(update), undefined)
  projection.update(call)
  assert.equal(projection.update({ sessionUpdate: 'tool_call_update', toolCallId: 'edit', content: [], status: 'completed' }), undefined)
  // A new turn/session owns a fresh projection even when providers reuse IDs.
  assert.equal(new AcpFileChangeProjection().update({ sessionUpdate: 'tool_call_update', toolCallId: 'edit', status: 'completed' }), undefined)
})
