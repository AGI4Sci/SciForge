import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import type { CurrentUserProfile } from '@sciforge/domain-identity-access/current-user-profile'
import { SiYuanClient } from './client.js'
import { createCommentService } from './comments.js'
import { createDocumentWriter } from './documents.js'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))) })
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'siyuan-comments-'))
  directories.push(directory)
  const id = '20261109120000-documen'
  const attributes: Record<string, string> = { unrelated: 'keep' }
  let profile: CurrentUserProfile = { state: 'signed-in', userId: 'a', displayName: 'Same name' }
  const client = {
    documentMetadata: vi.fn(async () => ({ id, box: '20261109120000-noteboo', hpath: '/Note', updated: '1' })),
    blockAttributes: vi.fn(async () => ({ ...attributes })),
    hasLegacyComments: vi.fn(async () => false),
    assertDocumentBlock: vi.fn(async () => {}),
    setBlockAttributes: vi.fn(async (_id: string, attrs: Record<string, string>) => { Object.assign(attributes, attrs) })
  }
  let endpoint = 'https://notes.test'
  const resolveClient = vi.fn(async (_spaceId?: string) => ({ client: client as unknown as SiYuanClient, baseUrl: endpoint }))
  const options = { userDataDir: directory, client: resolveClient }
  const writer = createDocumentWriter(options)
  const binding = { identity: 'account-a/service', endpoint: 'https://notes.test', assertCurrent: vi.fn(), signal: undefined as AbortSignal | undefined }
  const make = () => createCommentService({ ...options, userDataDir: () => directory, profile: () => profile, serialize: writer.serialize })
  const service = make()
  const revision = async () => (await service.list(id, {}, binding)).commentsRevision
  return { directory, id, attributes, client, service, binding, revision, make, resolveClient, setEndpoint: (value: string) => { endpoint = value }, setProfile: (value: CurrentUserProfile) => { profile = value } }
}

it('creates comments, replies and nested replies, edits own text and preserves metadata and unrelated attributes', async () => {
  const f = await fixture()
  const first = await f.service.mutate(f.id, 'create', { text: 'Question', expectedCommentsRevision: await f.revision() }, f.binding)
  const reply = await f.service.mutate(f.id, 'reply', { commentId: first.commentId, text: 'Answer', expectedCommentsRevision: await f.revision() }, f.binding)
  await f.service.mutate(f.id, 'reply', { commentId: first.commentId, replyTo: reply.replyId, text: 'Follow up', expectedCommentsRevision: await f.revision() }, f.binding)
  const stored = JSON.parse(f.attributes['custom-comments'])
  stored.extra = 'preserved'
  stored.comments[first.commentId].resolution = { by: 'Other', at: 1, custom: true }
  stored.comments[first.commentId].extra = { value: 'preserved' }
  f.attributes['custom-comments'] = JSON.stringify(stored)
  await f.service.mutate(f.id, 'update', { commentId: first.commentId, replyId: reply.replyId, text: 'Revised answer', expectedCommentsRevision: await f.revision() }, f.binding)
  const listing = await f.service.list(f.id, { limit: 2 }, f.binding)
  expect(listing).toMatchObject({ total: 3, nextOffset: 2 })
  const tail = await f.service.list(f.id, { offset: 2, expectedCommentsRevision: listing.commentsRevision }, f.binding)
  expect(tail.nextOffset).toBeNull()
  expect([...listing.entries, ...tail.entries].find(item => item.replyId === reply.replyId)).toMatchObject({ text: 'Revised answer', authorId: 'sciforge:a', canEdit: true, resolved: true })
  expect(f.attributes.unrelated).toBe('keep')
  expect(JSON.parse(f.attributes['custom-comments'])).toMatchObject({ extra: 'preserved', comments: { [first.commentId]: { extra: { value: 'preserved' }, text: 'Question' } } })
})

it('does not allow same-name accounts or old manual signatures to edit; permits replying to another author', async () => {
  const f = await fixture()
  const first = await f.service.mutate(f.id, 'create', { text: 'By A', expectedCommentsRevision: await f.revision() }, f.binding)
  f.setProfile({ state: 'signed-in', userId: 'b', displayName: 'Same name' })
  expect((await f.service.list(f.id, {}, f.binding)).entries[0].canEdit).toBe(false)
  await expect(f.service.mutate(f.id, 'update', { commentId: first.commentId, text: 'Impersonation', expectedCommentsRevision: await f.revision() }, f.binding)).rejects.toMatchObject({ code: 'comment_edit_forbidden' })
  await f.service.mutate(f.id, 'reply', { commentId: first.commentId, text: 'By B', expectedCommentsRevision: await f.revision() }, f.binding)
  const store = JSON.parse(f.attributes['custom-comments'])
  delete store.comments[first.commentId].authorId
  f.attributes['custom-comments'] = JSON.stringify(store)
  await expect(f.service.mutate(f.id, 'update', { commentId: first.commentId, text: 'Claim old name', expectedCommentsRevision: await f.revision() }, f.binding)).rejects.toMatchObject({ code: 'comment_edit_forbidden' })
})

it('rejects stale pages/edits, malformed stores, missing targets and anchors in another document', async () => {
  const f = await fixture()
  const revision = await f.revision()
  await f.service.mutate(f.id, 'create', { text: 'First', expectedCommentsRevision: revision }, f.binding)
  await expect(f.service.list(f.id, { offset: 1 }, f.binding)).rejects.toMatchObject({ code: 'invalid_input' })
  await expect(f.service.list(f.id, { offset: 1, expectedCommentsRevision: revision }, f.binding)).rejects.toMatchObject({ code: 'comments_changed' })
  await expect(f.service.mutate(f.id, 'create', { text: 'Stale', expectedCommentsRevision: revision }, f.binding)).rejects.toMatchObject({ code: 'comments_changed' })
  await expect(f.service.mutate(f.id, 'reply', { text: 'Missing', commentId: 'missing', expectedCommentsRevision: await f.revision() }, f.binding)).rejects.toMatchObject({ code: 'comment_not_found' })
  f.client.assertDocumentBlock.mockRejectedValue(new Error('foreign block'))
  await expect(f.service.mutate(f.id, 'create', { text: 'Bad anchor', blockId: '20261109120000-foreign', expectedCommentsRevision: await f.revision() }, f.binding)).rejects.toThrow('foreign block')
  f.attributes['custom-comments'] = 'broken'
  await expect(f.service.list(f.id, {}, f.binding)).rejects.toMatchObject({ code: 'comments_format_unsupported' })
  delete f.attributes['custom-comments']
  f.client.hasLegacyComments.mockResolvedValue(true)
  await expect(f.service.list(f.id, {}, f.binding)).rejects.toMatchObject({ code: 'comments_format_unsupported' })
  expect(f.client.setBlockAttributes).toHaveBeenCalledTimes(1)
})

it('fences sign-out and identity changes, and never repeats a lost comment write after restart', async () => {
  const f = await fixture()
  const request = { text: 'Once', expectedCommentsRevision: await f.revision() }
  f.setProfile({ state: 'signed-out' })
  expect(() => f.service.mutate(f.id, 'create', request, f.binding)).toThrow()
  f.setProfile({ state: 'signed-in', userId: 'a', displayName: 'A' })
  f.client.setBlockAttributes.mockRejectedValue(new Error('lost response'))
  await expect(f.service.mutate(f.id, 'create', request, f.binding)).rejects.toMatchObject({ code: 'outcome_unknown' })
  await expect(f.make().mutate(f.id, 'create', request, f.binding)).rejects.toMatchObject({ code: 'outcome_unknown' })
  expect(f.client.setBlockAttributes).toHaveBeenCalledTimes(1)
  f.binding.assertCurrent.mockImplementation(() => { throw new Error('service changed') })
  await expect(f.service.list(f.id, {}, f.binding)).rejects.toThrow('service changed')
})


it('pins a custom service endpoint and rejects a changed destination before touching comments', async () => {
  const f = await fixture()
  await f.revision()
  expect(f.resolveClient).toHaveBeenLastCalledWith(undefined)
  f.setEndpoint('https://other-project.test')
  f.client.documentMetadata.mockClear()
  await expect(f.service.list(f.id, {}, f.binding)).rejects.toMatchObject({ code: 'invalid_configuration' })
  expect(f.client.documentMetadata).not.toHaveBeenCalled()
  expect(f.client.setBlockAttributes).not.toHaveBeenCalled()
})

it('propagates cancellation to reads and rejects cancellation before dispatch', async () => {
  const f = await fixture()
  const controller = new AbortController()
  f.binding.signal = controller.signal
  await f.revision()
  expect(f.client.blockAttributes).toHaveBeenLastCalledWith(f.id, controller.signal)
  controller.abort()
  await expect(f.service.list(f.id, {}, f.binding)).rejects.toMatchObject({ code: 'cancelled' })
  expect(f.client.setBlockAttributes).not.toHaveBeenCalled()
})

it('preserves an unknown-outcome receipt when identity changes after dispatch', async () => {
  const f = await fixture()
  const request = { text: 'Commit then sign out', expectedCommentsRevision: await f.revision() }
  f.client.setBlockAttributes.mockImplementation(async (_id, attrs) => {
    Object.assign(f.attributes, attrs)
    f.setProfile({ state: 'signed-out' })
  })
  await expect(f.service.mutate(f.id, 'create', request, f.binding)).rejects.toMatchObject({ code: 'outcome_unknown' })
  f.setProfile({ state: 'signed-in', userId: 'a', displayName: 'Same name' })
  const receipts = await readdir(join(f.directory, 'siyuan-document-edits'))
  expect(receipts).toHaveLength(1)
  expect(JSON.parse(await readFile(join(f.directory, 'siyuan-document-edits', receipts[0]), 'utf8'))).toEqual({ status: 'pending' })
  expect(f.client.setBlockAttributes).toHaveBeenCalledOnce()
})


it('captures a queued custom service endpoint rather than a later mutated resource object', async () => {
  const f = await fixture()
  const revision = await f.revision()
  const pending = f.service.mutate(f.id, 'create', { text: 'Pinned', expectedCommentsRevision: revision }, f.binding)
  f.binding.endpoint = 'https://changed.test'
  await pending
  expect(f.resolveClient).toHaveBeenLastCalledWith(undefined)
  expect(f.client.setBlockAttributes).toHaveBeenCalledOnce()
})
