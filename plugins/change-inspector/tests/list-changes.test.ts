import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ChangeInspectorService } from '../src/core/service.js'
import { changeInspectorTools } from '../src/dsh-adapter/tools.js'
import { projectSessionChangeSnapshot, projectSessionChangeSummaries } from '../../../packages/domains/change-inspector/src/change-observation.js'
import { changeInspectorListChangesInputSchema } from '../../../packages/domains/change-inspector/src/contract.js'

const workspaceRoot = '/workspace'
const detail = { workspaceRoot, watermark: 'revision-1', artifacts: Array.from({ length: 3 }, (_, i) => ({ kind: 'tool', toolKind: 'file_change', id: `change-${i}`, status: 'success', detail: '--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+' + 'é'.repeat(12000) })) }

test('list_changes resolves runtime through the read-only port and matches bounded static pages', async () => {
  const reads: unknown[] = []
  const service = new ChangeInspectorService({ agentThreads: {
    list: async input => { assert.deepEqual(input, { includeArchived: false }); return [{ id: 'session', runtimeId: 'actual-runtime' }] },
    read: async input => { reads.push(input); return detail }
  } })
  const tool = changeInspectorTools(() => service).find(t => t.name === 'list_changes')
  assert.ok(tool, 'list_changes must be registered, not just declared')
  for (const input of [{ sessionId: 'session', limit: 2 }, { sessionId: 'session', limit: 2, cursor: 'change-1' }]) {
    const snapshot = projectSessionChangeSnapshot(input.sessionId, detail)
    const page = projectSessionChangeSummaries(snapshot, changeInspectorListChangesInputSchema.parse(input))
    assert.deepEqual(await tool.execute({ ...input, workspaceRoot }), { ...page, revision: snapshot.revision, truncated: snapshot.truncated })
  }
  assert.deepEqual(reads, Array(2).fill({ runtimeId: 'actual-runtime', threadId: 'session' }))
  await assert.rejects(tool.execute({ sessionId: 'missing', workspaceRoot }), /not available/)
  await assert.rejects(tool.execute({ sessionId: 'session', workspaceRoot: '/foreign' }), /another workspace/)
  await assert.rejects(tool.execute({ sessionId: 'session', workspaceRoot, cursor: 'unknown' }), /cursor/)
  await assert.rejects(tool.execute({ sessionId: 'session', workspaceRoot, limit: 100000 }), /Too big/)
  await assert.rejects(tool.execute({ sessionId: 'session', workspaceRoot, runtimeId: 'forged' }), /Unrecognized/)
})
