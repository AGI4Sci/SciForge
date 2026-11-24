import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createAnchoredCommentsOperations } from '../src/core/operations.js'
import { ANCHORED_COMMENT_CAPABILITY_IDS as ids, anchoredCommentThreadSchema, proseTranslationResultSchema } from '../src/core/contract.js'
import { AnchoredCommentService } from '../src/core/main/comment-service.js'
import { researchThread } from './fixtures.js'

test('canonical reconciliation persists stale evidence, preserves messages, and refuses unrelated snapshots', async () => {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'line-reconcile-'))
  const operations = createAnchoredCommentsOperations({ env: {} })
  try {
    const thread = researchThread('code')
    const anchor = { filePath: 'src/a.ts', side: 'new' as const, line: 1, code: 'value()', hunkHeader: '', baseRevision: 'abc', contentDigest: 'a'.repeat(64) }
    thread.anchor.codeAnchor = anchor
    await operations.invoke(ids.upsert, { thread }, root)
    assert.deepEqual(await operations.invoke(ids.reconcileAnchor, { threadId: thread.id, current: anchor }, root), thread)
    for (const current of [{ ...anchor, filePath: 'src/b.ts' }, { ...anchor, side: 'old' }, { ...anchor, filePath: '../bad.ts' }]) {
      await assert.rejects(operations.invoke(ids.reconcileAnchor, { threadId: thread.id, current }, root))
    }
    const stale = anchoredCommentThreadSchema.parse(await operations.invoke(ids.reconcileAnchor, { threadId: thread.id, current: { ...anchor, baseRevision: 'def' } }, root))
    assert.equal(stale.anchorResolution, 'needs_retargeting')
    assert.deepEqual(stale.anchor, thread.anchor)
    assert.deepEqual(stale.messages, thread.messages)
    assert.deepEqual(await new AnchoredCommentService(join(root, '.sciforge')).getThread(thread.id), stale)
    assert.deepEqual(await operations.invoke(ids.reconcileAnchor, { threadId: thread.id, current: anchor }, root), stale)
    await operations.invoke(ids.upsert, { thread }, root)
    const digestChanged = anchoredCommentThreadSchema.parse(await operations.invoke(ids.reconcileAnchor, { threadId: thread.id, current: { ...anchor, contentDigest: 'b'.repeat(64) } }, root))
    assert.equal(digestChanged.anchorResolution, 'needs_retargeting')
  } finally { operations.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('canonical translation uses selected runtime, strict schema and lifecycle cancellation', async () => {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'line-translation-'))
  let signal!: AbortSignal, finish!: (value: { state: 'completed'; runtimeId: string; text: string }) => void
  const operations = createAnchoredCommentsOperations({ env: {}, discussion: { async run(_prompt, current) {
    signal = current
    return await new Promise(resolve => { finish = resolve })
  } } })
  try {
    await assert.rejects(operations.invoke(ids.translate, { text: 'hello', targetLanguage: 'en', workspaceRoot: '/forged' }, root))
    const pending = operations.invoke(ids.translate, { text: 'Explain `x`', targetLanguage: 'zh-CN' }, root)
    finish({ state: 'completed', runtimeId: 'selected', text: '{"translations":["说明 "]}' })
    const result = proseTranslationResultSchema.parse(await pending)
    assert.equal(result.translation, '说明 `x`'); assert.equal(result.runtimeId, 'selected')
    const late = operations.invoke(ids.translate, { text: 'Explain', targetLanguage: 'en' }, root)
    operations.dispose(); assert.equal(signal.aborted, true)
    finish({ state: 'completed', runtimeId: 'selected', text: '{"translations":["late"]}' })
    await assert.rejects(late)
  } finally { operations.dispose(); await rm(root, { recursive: true, force: true }) }
})
