import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ChangeInspectorService } from '../src/core/service.js'
import { changeInspectorTools } from '../src/dsh-adapter/tools.js'
import { projectSessionChangeSnapshot, projectSessionChangeSummaries } from '../src/core/change-observation.js'
import { CHANGE_INSPECTOR_MAX_SUMMARY_PATCH_BYTES, changeInspectorListChangesInputSchema } from '../src/contract.js'

const workspaceRoot = '/workspace'
const detail = { sessionId: 'session', runtimeId: 'actual-runtime', workspaceRoot, watermark: 'revision-1', artifacts: Array.from({ length: 3 }, (_, i) => ({ kind: 'tool', toolKind: 'file_change', id: `change-${i}`, status: 'success', detail: '--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+' + 'é'.repeat(12000) })) }

test('list_changes pages the authenticated port snapshot with bounded canonical summaries', async () => {
  const reads: unknown[] = []
  const service = new ChangeInspectorService({ agentThreads: {
    read: async input => {
      reads.push(input)
      if (input.threadId && input.threadId !== detail.sessionId) throw new Error('Host session is not available')
      return detail
    }
  } })
  const tool = changeInspectorTools(() => service).find(t => t.name === 'list_changes')
  assert.ok(tool, 'list_changes must be registered, not just declared')
  const snapshot = projectSessionChangeSnapshot(detail.sessionId, detail)
  const firstInput = { sessionId: 'session', limit: 2 }
  const firstPage = projectSessionChangeSummaries(snapshot, changeInspectorListChangesInputSchema.parse(firstInput))
  assert.match(firstPage.nextCursor!, /^ci1:[a-f0-9]{64}:2$/u)
  const secondInput = { ...firstInput, cursor: firstPage.nextCursor! }
  for (const input of [firstInput, secondInput]) {
    const page = projectSessionChangeSummaries(snapshot, changeInspectorListChangesInputSchema.parse(input))
    assert.deepEqual(await tool.execute(input), {
      ...page, revision: snapshot.revision, truncated: snapshot.truncated,
      truncationReasons: snapshot.truncationReasons
    })
    for (const change of page.changes) {
      assert.ok(Buffer.byteLength(change.patch, 'utf8') <= CHANGE_INSPECTOR_MAX_SUMMARY_PATCH_BYTES)
      assert.equal(change.patchBytes, Buffer.byteLength(detail.artifacts[0]!.detail, 'utf8'))
      assert.equal(change.patchTruncated, true)
      assert.equal(change.patch.includes('\ufffd'), false)
    }
  }
  assert.deepEqual(reads, Array(2).fill({ threadId: 'session' }))
  const defaultPage = await tool.execute({ limit: 2 })
  assert.deepEqual(defaultPage, await tool.execute(firstInput))
  assert.deepEqual(reads[2], {})
  await assert.rejects(tool.execute({ sessionId: 'missing' }), /not available/u)
  await assert.rejects(tool.execute({ sessionId: 'session', cursor: 'unknown' }), /cursor/u)

  const beforeInvalidInput = reads.length
  await assert.rejects(tool.execute({ sessionId: 'session', limit: 100000 }), /Too big/u)
  for (const authority of [{ workspaceRoot: '/foreign' }, { runtimeId: 'forged' }, { sessionDetail: detail }]) {
    await assert.rejects(tool.execute({ sessionId: 'session', ...authority }), /unrecognized/iu)
  }
  assert.equal(reads.length, beforeInvalidInput, 'invalid authority must fail before a Host read')
})

test('list_changes rejects a valid cursor after the authenticated port snapshot changes', async () => {
  let current = detail
  const service = new ChangeInspectorService({ agentThreads: { read: async () => current } })
  const tool = changeInspectorTools(() => service).find(t => t.name === 'list_changes')!
  const input = { sessionId: 'session', limit: 1 }
  const first = await tool.execute(input) as { nextCursor: string; revision: string }
  current = { ...detail, watermark: 'revision-2' }
  const unchanged = await tool.execute({ ...input, cursor: first.nextCursor }) as { revision: string }
  assert.equal(unchanged.revision, first.revision, 'non-change Host events do not invalidate pagination')
  current = { ...detail, artifacts: detail.artifacts.map((artifact, index) => index === 0 ? { ...artifact, detail: artifact.detail + '\n+new' } : artifact) }
  await assert.rejects(tool.execute({ ...input, cursor: first.nextCursor }), /cursor does not match/u)
})
