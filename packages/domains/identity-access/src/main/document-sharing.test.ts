import { describe, expect, it, vi } from 'vitest'
import { createDocumentShare, lookupDocumentShare, revokeDocumentShare, readDocumentComments, mutateDocumentComments } from './document-sharing.js'
import type { WithCloudTransportLease } from './cloud-authority.js'
const source = { spaceId: `spc_${'a'.repeat(32)}`, documentId: '20261109120000-abcdefg' }
const shareId = `dsh_${'b'.repeat(32)}`
const share = { shareId, source, permission: 'comment' as const, status: 'active' as const, revision: 1,
  createdAt: '2026-01-01T00:00:00.000Z', revokedAt: null }
const result = { share, shareUrl: `https://cloud.example/share/${shareId}#key=${'x'.repeat(43)}` }
function fixture(body: unknown, status = 200, assertCurrent = vi.fn()) {
  const fetch = vi.fn(async (_path: string, _init: RequestInit) => Response.json(body, { status }))
  let signal: AbortSignal | undefined
  const lease: WithCloudTransportLease = async (operation, options) => {
    signal = options?.signal
    signal?.throwIfAborted()
    return operation({ fetch, assertCurrent, userId: 'usr_one' })
  }
  return { lease, fetch, signal: () => signal }
}
describe('document sharing authenticated transport', () => {
  it('uses exact closed routes and preserves idempotent requests', async () => {
    const lookup = fixture(result)
    expect(await lookupDocumentShare({ source }, lookup.lease)).toEqual(result)
    expect(lookup.fetch).toHaveBeenCalledWith('/v1/document-shares/lookup', expect.objectContaining({ method: 'POST', body: JSON.stringify({ source }) }))
    const create = fixture(result), input = { source, permission: 'comment' as const, idempotencyKey: 'create-0001' }
    expect(await createDocumentShare(input, create.lease)).toEqual(result)
    expect(create.fetch).toHaveBeenCalledWith('/v1/document-shares', expect.objectContaining({ body: JSON.stringify(input) }))
    const revoked = fixture({ ...result, share: { ...share, status: 'revoked', revision: 2, revokedAt: '2026-01-02T00:00:00.000Z' } })
    await revokeDocumentShare({ source, shareId, expectedRevision: 1, idempotencyKey: 'revoke-0001' }, revoked.lease)
    expect(revoked.fetch).toHaveBeenCalledWith('/v1/document-shares/revoke', expect.objectContaining({ method: 'POST' }))
    await expect(lookupDocumentShare({ source }, fixture({ share: null, shareUrl: null }).lease)).resolves.toEqual({ share: null, shareUrl: null })
  })
  it('rejects mismatched source, share link identity, requested permission and revoked identity', async () => {
    for (const altered of [
      { ...result, share: { ...share, source: { ...source, spaceId: `spc_${'c'.repeat(32)}` } } },
      { ...result, share: { ...share, source: { ...source, documentId: '20261109120000-hijklmn' } } },
      { ...result, shareUrl: `https://cloud.example/share/dsh_${'c'.repeat(32)}#key=${'x'.repeat(43)}` }
    ]) await expect(lookupDocumentShare({ source }, fixture(altered).lease)).rejects.toMatchObject({ code: 'cloud_response_invalid' })
    await expect(createDocumentShare({ source, permission: 'edit', idempotencyKey: 'create-0001' }, fixture(result).lease)).rejects.toMatchObject({ code: 'cloud_response_invalid' })
    await expect(revokeDocumentShare({ source, shareId, expectedRevision: 1, idempotencyKey: 'revoke-0001' }, fixture(result).lease)).rejects.toMatchObject({ code: 'cloud_response_invalid' })
  })
  it('reads and mutates comments through the same lease without preflight reads or retrying writes', async () => {
    const comments = { revision: 'd'.repeat(64), store: { v: 1 as const, comments: {} } }
    const read = fixture(comments)
    expect(await readDocumentComments({ source }, read.lease)).toEqual(comments)
    expect(read.fetch).toHaveBeenCalledWith('/v1/document-comments/read', expect.objectContaining({ body: JSON.stringify({ source }) }))
    const mutation = { source, expectedRevision: 'e'.repeat(64), idempotencyKey: 'comment-0001',
      mutation: { kind: 'create' as const, blockId: source.documentId, text: 'Review this', quote: '' } }
    const response = { ...comments, result: { commentId: 'comment_one', replyId: null } }, write = fixture(response)
    expect(await mutateDocumentComments(mutation, write.lease)).toEqual(response)
    expect(write.fetch).toHaveBeenCalledExactlyOnceWith('/v1/document-comments/mutate', expect.objectContaining({ method: 'POST' }))
    expect(JSON.parse(String(write.fetch.mock.calls[0][1].body))).toEqual(mutation)
  })
  it('bounds bodies, rejects extra fields, sanitizes conflict messages and preserves cancellation', async () => {
    await expect(lookupDocumentShare({ source }, fixture({ ...result, extra: 'SECRET' }).lease)).rejects.toMatchObject({ code: 'cloud_response_invalid' })
    await expect(lookupDocumentShare({ source }, fixture({ extra: 'x'.repeat(16_385) }).lease)).rejects.toMatchObject({ code: 'cloud_response_invalid' })
    await expect(readDocumentComments({ source }, fixture({ error: { code: 'revision_conflict', message: 'SECRET' } }, 409).lease))
      .rejects.toMatchObject({ code: 'cloud_rejected', message: expect.not.stringContaining('SECRET') })
    const controller = new AbortController(), canceled = fixture(result)
    controller.abort()
    await expect(lookupDocumentShare({ source }, canceled.lease, { signal: controller.signal })).rejects.toBeDefined()
    expect(canceled.fetch).not.toHaveBeenCalled()
    const current = fixture(result)
    await lookupDocumentShare({ source }, current.lease, { signal: new AbortController().signal })
    expect(current.signal()).toBeInstanceOf(AbortSignal)
    let count = 0
    await expect(lookupDocumentShare({ source }, fixture(result, 200, vi.fn(() => { if (++count === 7) throw new Error('Lease changed') })).lease)).rejects.toThrow('Lease changed')
  })
})

it.each([
  [400, 'invalid_request', 'cloud_rejected', 'Cloud rejection: invalid_request.'],
  [502, 'kernel_response_invalid', 'cloud_unavailable', 'Cloud rejection: kernel_response_invalid.'],
  [409, 'revision_conflict', 'cloud_rejected', 'Cloud rejection: revision_conflict.'],
  [400, 'kernel_response_invalid', 'cloud_rejected', 'Cloud access returned HTTP 400.'],
  [502, 'unrecognized_secret', 'cloud_unavailable', 'Cloud access returned HTTP 502.'],
  [400, 'invalid_request.SECRET', 'cloud_rejected', 'Cloud access returned HTTP 400.']
])('exposes only fixed safe messages for HTTP %s / %s', async (status, reason, code, message) => {
  const server = fixture({ error: { code: reason, message: '<html>SECRET bearer and path</html>' }, details: 'SECRET' }, status)
  await expect(lookupDocumentShare({ source }, server.lease)).rejects.toMatchObject({ code, message })
})
it('does not reflect non-JSON error bodies or lose existing space readiness classification', async () => {
  const lease: WithCloudTransportLease = async operation => operation({ userId: 'usr_one', assertCurrent: () => undefined,
    fetch: async () => new Response('<html>SECRET invalid_request</html>', { status: 400 }) })
  await expect(lookupDocumentShare({ source }, lease)).rejects.toMatchObject({ message: 'Cloud access returned HTTP 400.' })
  await expect(lookupDocumentShare({ source }, fixture({ error: { code: 'space_not_ready', message: 'SECRET' } }, 409).lease)).rejects.toMatchObject({ code: 'space_not_ready' })
})
