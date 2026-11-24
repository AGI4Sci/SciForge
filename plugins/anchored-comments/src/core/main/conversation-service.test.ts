import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { researchThread } from '../../../tests/fixtures'
import { AnchoredCommentService } from './comment-service'
import { AnchoredConversationService } from './conversation-service'
import type { DiscussionPort } from '../../ports/discussion'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
async function fixture(run: DiscussionPort['run']) {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'plugin-discussion-'))
  roots.push(root)
  const comments = new AnchoredCommentService(root)
  const thread = researchThread('code')
  thread.anchor.codeAnchor = { filePath: 'src/test.ts', side: 'new', line: 1, hunkHeader: '',
    code: 'value', baseRevision: 'abc', contentDigest: 'a'.repeat(64) }
  await comments.upsertThread(thread)
  return { comments, service: new AnchoredConversationService(comments, { run }) }
}

it('replays the same reply once and refuses reused identity with different text', async () => {
  const run = vi.fn(async () => ({ state: 'completed' as const, text: 'Answer', runtimeId: 'codex' }))
  const { service, comments } = await fixture(run)
  const input = { threadId: 'code', requestId: randomUUID(), body: 'Question' }
  expect((await service.reply(input)).state).toBe('completed')
  expect((await service.reply(input)).state).toBe('completed')
  expect((await service.reply({ ...input, body: 'Changed' })).state).toBe('failed')
  expect(run).toHaveBeenCalledTimes(1)
  expect((await comments.getThread('code'))?.messages).toHaveLength(3)
})

it('cancels only the matching request and discards a noncooperative late reply', async () => {
  let finish!: (value: Awaited<ReturnType<DiscussionPort['run']>>) => void
  let started!: () => void
  const ready = new Promise<void>((resolve) => { started = resolve })
  const { service, comments } = await fixture(async () => {
    started()
    return await new Promise((resolve) => { finish = resolve })
  })
  const requestId = randomUUID()
  const pending = service.reply({ threadId: 'code', requestId, body: 'Question' })
  await ready
  expect(service.cancel('code', randomUUID())).toBe(false)
  expect(service.cancel('code', requestId)).toBe(true)
  finish({ state: 'completed', text: 'Late answer', runtimeId: 'codex' })
  expect((await pending).state).toBe('cancelled')
  expect((await comments.getThread('code'))?.messages).toHaveLength(2)
})

it('unload aborts execution and permanently closes the service', async () => {
  let started!: () => void
  const ready = new Promise<void>((resolve) => { started = resolve })
  const { service } = await fixture(async (_prompt, signal) => {
    started()
    await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }))
    return { state: 'cancelled', text: '', runtimeId: 'codex' }
  })
  const input = { threadId: 'code', requestId: randomUUID(), body: 'Question' }
  const pending = service.reply(input)
  await ready
  service.dispose()
  expect((await pending).state).toBe('cancelled')
  await expect(service.reply(input)).rejects.toThrow(/lifecycle/)
})
