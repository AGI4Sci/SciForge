import { expect, it, vi } from 'vitest'
import { createCommentService } from './comments.js'
import type { SiYuanClient } from './client.js'

it('uses Cloud revision commands for managed comments and never falls back to attribute writes', async () => {
  const spaceId = 'spc_' + '1'.repeat(32), documentId = '20261109120000-documen'
  const revision = 'a'.repeat(64), next = 'b'.repeat(64)
  const store = { v: 1 as const, comments: {} }
  const readDocumentComments = vi.fn(async () => ({ revision, store }))
  const mutateDocumentComments = vi.fn(async () => ({ revision: next, store, result: { commentId: 'c-cloud', replyId: null } }))
  const client = { documentMetadata: vi.fn(async () => ({ updated: '2' })), blockAttributes: vi.fn(), setBlockAttributes: vi.fn() }
  const service = createCommentService({ profile: () => ({ state: 'signed-in', userId: 'a', displayName: 'A' }),
    client: async () => ({ baseUrl: 'https://space.test/', client: client as unknown as SiYuanClient }),
    userDataDir: () => { throw new Error('Managed writes must use Cloud receipts.') },
    serialize: async () => { throw new Error('Managed writes must use Cloud CAS.') },
    cloud: () => ({ readDocumentComments, mutateDocumentComments }) })
  const binding = { identity: 'user:a', spaceId, endpoint: 'https://space.test/', assertCurrent: vi.fn(), invocationId: 'invocation-cloud-comment' }
  await expect(service.list(documentId, {}, binding)).resolves.toMatchObject({ commentsRevision: revision, entries: [] })
  await expect(service.mutate(documentId, 'create', { text: 'Question', expectedCommentsRevision: revision }, binding))
    .resolves.toEqual({ documentId, commentId: 'c-cloud', replyId: null, commentsRevision: next, updated: '2' })
  expect(mutateDocumentComments).toHaveBeenCalledWith({ source: { spaceId, documentId }, expectedRevision: revision,
    mutation: { kind: 'create', blockId: documentId, quote: '', text: 'Question' }, idempotencyKey: binding.invocationId }, { signal: undefined })
  expect(readDocumentComments).toHaveBeenCalledOnce()
  mutateDocumentComments.mockRejectedValueOnce(new Error('Cloud CAS conflict'))
  await expect(service.mutate(documentId, 'create', { text: 'Question', expectedCommentsRevision: revision }, binding)).rejects.toThrow('Cloud CAS conflict')
  expect(client.blockAttributes).not.toHaveBeenCalled()
  expect(client.setBlockAttributes).not.toHaveBeenCalled()
})

it('rejects managed comments when the Cloud route is unavailable instead of using custom-service writes', async () => {
  const client = { blockAttributes: vi.fn(), setBlockAttributes: vi.fn() }
  const service = createCommentService({ profile: () => ({ state: 'signed-in', userId: 'a', displayName: 'A' }),
    client: async () => ({ baseUrl: 'https://space.test/', client: client as unknown as SiYuanClient }),
    userDataDir: () => '', serialize: async operation => operation() })
  const binding = { identity: 'user:a', spaceId: 'spc_' + '1'.repeat(32), endpoint: 'https://space.test/', assertCurrent: () => {}, invocationId: 'invocation-comment' }
  await expect(service.list('20261109120000-documen', {}, binding)).rejects.toMatchObject({ code: 'invalid_configuration' })
  expect(() => service.mutate('20261109120000-documen', 'create', { text: 'Question', expectedCommentsRevision: 'a'.repeat(64) }, binding)).toThrow()
  expect(client.blockAttributes).not.toHaveBeenCalled()
  expect(client.setBlockAttributes).not.toHaveBeenCalled()
})
