import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { CurrentUserProfile } from '@sciforge/domain-identity-access/current-user-profile'
import type { AuthenticatedCloudTransport } from '@sciforge/domain-identity-access/authenticated-cloud-transport'
import type { DocumentCommentMutation } from '@sciforge/document-sharing-contracts'
import {
  commentKeySchema, siyuanCommentListContract, siyuanCommentCreateContract,
  siyuanCommentReplyContract, siyuanCommentUpdateContract
} from '../comments-contract.js'
import { SiYuanClient, SiYuanError } from './client.js'
import { withWriteReceipt } from './write-receipt.js'

// Extended Comments v1 is a single document-root attribute. Preserve unknown
// fields when changing one entry; never rewrite the document Markdown.
const ATTRIBUTE = 'custom-comments'
const blockId = z.string().regex(/^\d{14}-[a-z0-9]{7}$/u)
const authored = z.object({
  author: z.string(), authorId: z.string().optional(), text: z.string(),
  createdAt: z.number().finite(), updatedAt: z.number().finite().optional()
}).passthrough()
const reply = authored.extend({ parent: commentKeySchema, replyTo: z.string().optional() })
const comment = authored.extend({
  blockId, quote: z.string().default(''),
  replies: z.record(commentKeySchema, reply).default({}),
  resolution: z.object({ by: z.string(), byId: z.string().optional(), at: z.number().finite() }).passthrough().nullable().optional()
})
const storeSchema = z.object({ v: z.literal(1), comments: z.record(commentKeySchema, comment) }).passthrough()
type Actor = { author: string; authorId: string }
export type CommentBinding = Readonly<{ identity: string; spaceId?: string; endpoint: string; assertCurrent: () => void; signal?: AbortSignal; invocationId?: string }>
export type CommentMutation = 'create' | 'reply' | 'update'

export function createCommentService(options: {
  client: (spaceId?: string) => Promise<{ client: SiYuanClient; baseUrl: string }>
  profile: () => CurrentUserProfile
  userDataDir: () => string
  serialize: <T>(operation: () => Promise<T>) => Promise<T>
  cloud?: () => Pick<AuthenticatedCloudTransport, 'readDocumentComments' | 'mutateDocumentComments'>
}) {
  const actor = (): Actor | null => {
    const profile = options.profile()
    return profile.state === 'signed-in' ? { author: profile.displayName, authorId: `sciforge:${profile.userId}` } : null
  }
  // Capture the resource's destination before queueing, then resolve fresh authority
  // without allowing a newly selected project or custom service to retarget it.
  const capture = (binding: CommentBinding): CommentBinding => Object.freeze({ ...binding })
  const assertBinding = (binding: CommentBinding): void => {
    binding.assertCurrent()
    if (binding.signal?.aborted) throw new SiYuanError('cancelled')
  }
  const destination = async (binding: CommentBinding) => {
    assertBinding(binding)
    const value = await options.client(binding.spaceId)
    assertBinding(binding)
    if (new URL(value.baseUrl).href !== new URL(binding.endpoint).href) throw new SiYuanError('invalid_configuration')
    return value
  }
  const snapshot = async (client: SiYuanClient, id: string, binding: CommentBinding) => {
    const metadata = await client.documentMetadata(id, binding.signal)
    assertBinding(binding)
    const raw = (await client.blockAttributes(id, binding.signal))[ATTRIBUTE]
    assertBinding(binding)
    if (raw === undefined && await client.hasLegacyComments(id, binding.signal)) throw new SiYuanError('comments_format_unsupported')
    assertBinding(binding)
    let store: z.infer<typeof storeSchema>
    try {
      if (raw !== undefined && raw.length > 8_000_000) throw new Error('too large')
      store = storeSchema.parse(raw === undefined ? { v: 1, comments: {} } : JSON.parse(raw))
      for (const [key, entry] of Object.entries(store.comments)) {
        for (const item of Object.values(entry.replies)) {
          if (item.parent !== key || (item.replyTo && !Object.hasOwn(entry.replies, item.replyTo))) throw new Error('invalid reply target')
        }
      }
    } catch { throw new SiYuanError('comments_format_unsupported') }
    const commentsRevision = createHash('sha256').update(raw ?? '').digest('hex')
    return { store, commentsRevision, updated: metadata.updated }
  }
  const list = async (id: string, raw: unknown, resourceBinding: CommentBinding) => {
    const binding = capture(resourceBinding)
    const request = siyuanCommentListContract.inputSchema.parse(raw)
    if (request.offset > 0 && !request.expectedCommentsRevision) throw new SiYuanError('invalid_input')
    binding.assertCurrent()
    const { client } = await destination(binding)
    binding.assertCurrent()
    const value = binding.spaceId
      ? await (() => {
        if (!options.cloud) throw new SiYuanError('invalid_configuration')
        return options.cloud().readDocumentComments({ source: { spaceId: binding.spaceId!, documentId: id } }, { signal: binding.signal })
      })().then(result => ({ store: storeSchema.parse(result.store), commentsRevision: result.revision }))
      : await snapshot(client, id, binding)
    const { store, commentsRevision } = value
    binding.assertCurrent()
    if (request.expectedCommentsRevision && request.expectedCommentsRevision !== commentsRevision) throw new SiYuanError('comments_changed')
    const current = actor()
    const entries = Object.entries(store.comments).sort(([a], [b]) => a.localeCompare(b)).flatMap(([commentId, entry]) => {
      const base = { commentId, blockId: entry.blockId, quote: entry.quote, resolved: Boolean(entry.resolution) }
      const values = (value: z.infer<typeof authored>) => ({
        text: value.text, author: value.author, authorId: value.authorId ?? null,
        createdAt: value.createdAt, updatedAt: value.updatedAt ?? null,
        canEdit: Boolean(current && value.authorId === current.authorId)
      })
      return [
        { ...base, ...values(entry), kind: 'comment' as const, replyId: null, replyTo: null },
        ...Object.entries(entry.replies).sort(([a], [b]) => a.localeCompare(b)).map(([replyId, item]) => ({
          ...base, ...values(item), kind: 'reply' as const, replyId, replyTo: item.replyTo || null
        }))
      ]
    })
    const end = Math.min(entries.length, request.offset + request.limit)
    return siyuanCommentListContract.outputSchema.parse({
      documentId: id, commentsRevision, entries: entries.slice(request.offset, end),
      total: entries.length, nextOffset: end < entries.length ? end : null
    })
  }
  const mutate = (id: string, mode: CommentMutation, raw: unknown, resourceBinding: CommentBinding) => {
    const binding = capture(resourceBinding)
    const contract = mode === 'create' ? siyuanCommentCreateContract : mode === 'reply' ? siyuanCommentReplyContract : siyuanCommentUpdateContract
    const request = contract.inputSchema.parse(raw)
    const current = actor()
    if (!current) throw new SiYuanError('identity_required')
    const assertActor = () => {
      assertBinding(binding)
      const now = actor()
      if (now?.authorId !== current.authorId || now.author !== current.author) throw new SiYuanError('unauthorized')
    }
    if (binding.spaceId) {
      if (!options.cloud || !binding.invocationId) throw new SiYuanError('invalid_configuration')
      const spaceId = binding.spaceId
      const idempotencyKey = binding.invocationId
      let mutation: DocumentCommentMutation
      if (mode === 'create') {
        const value = siyuanCommentCreateContract.inputSchema.parse(request)
        mutation = { kind: 'create', blockId: value.blockId ?? id, text: value.text, quote: value.quote }
      } else if (mode === 'reply') {
        const value = siyuanCommentReplyContract.inputSchema.parse(request)
        mutation = { kind: 'reply.create', commentId: value.commentId, text: value.text,
          ...(value.replyTo ? { replyTo: value.replyTo } : {}) }
      } else {
        const value = siyuanCommentUpdateContract.inputSchema.parse(request)
        mutation = value.replyId
          ? { kind: 'reply.update', commentId: value.commentId, replyId: value.replyId, text: value.text }
          : { kind: 'update', commentId: value.commentId, text: value.text }
      }
      // Managed spaces use only the Cloud CAS command and its durable receipt.
      // A failed request never falls through to custom-service attribute writes.
      return (async () => {
        assertActor()
        const { client } = await destination(binding)
        assertActor()
        const result = await options.cloud!().mutateDocumentComments({ source: { spaceId, documentId: id },
          expectedRevision: request.expectedCommentsRevision, mutation, idempotencyKey }, { signal: binding.signal })
        assertActor()
        const metadata = await client.documentMetadata(id, binding.signal)
        assertActor()
        return contract.outputSchema.parse({ documentId: id, commentId: result.result.commentId,
          replyId: result.result.replyId, commentsRevision: result.revision, updated: metadata.updated })
      })()
    }
    return options.serialize(async () => {
      assertActor()
      const { client, baseUrl } = await destination(binding)
      assertActor()
      const before = await snapshot(client, id, binding)
      assertActor()
      if (request.expectedCommentsRevision !== before.commentsRevision) throw new SiYuanError('comments_changed')
      let commentId: string, replyId: string | null = null
      if (mode === 'create') {
        const create = siyuanCommentCreateContract.inputSchema.parse(request)
        const anchor = create.blockId ?? id
        if (anchor !== id) await client.assertDocumentBlock(anchor, id, binding.signal)
        commentId = `c-${randomUUID()}`
        before.store.comments[commentId] = { ...current, blockId: anchor, quote: create.quote,
          text: request.text, createdAt: Date.now(), replies: {} }
      } else {
        const target = request as z.infer<typeof siyuanCommentReplyContract.inputSchema> | z.infer<typeof siyuanCommentUpdateContract.inputSchema>
        commentId = target.commentId
        const entry = Object.hasOwn(before.store.comments, commentId) ? before.store.comments[commentId] : undefined
        if (!entry) throw new SiYuanError('comment_not_found')
        if (mode === 'reply') {
          const replyTo = siyuanCommentReplyContract.inputSchema.parse(request).replyTo ?? ''
          if (replyTo && !Object.hasOwn(entry.replies, replyTo)) throw new SiYuanError('comment_not_found')
          replyId = `r-${randomUUID()}`
          entry.replies[replyId] = { ...current, parent: commentId, replyTo, text: request.text, createdAt: Date.now() }
        } else {
          replyId = siyuanCommentUpdateContract.inputSchema.parse(request).replyId ?? null
          const target = replyId ? (Object.hasOwn(entry.replies, replyId) ? entry.replies[replyId] : undefined) : entry
          if (!target) throw new SiYuanError('comment_not_found')
          if (target.authorId !== current.authorId) throw new SiYuanError('comment_edit_forbidden')
          target.text = request.text
          target.updatedAt = Date.now()
        }
      }
      const serialized = JSON.stringify(before.store)
      if (serialized.length > 8_000_000) throw new SiYuanError('invalid_input')
      // Re-check immediately before replacing the one plugin-owned attribute.
      if ((await snapshot(client, id, binding)).commentsRevision !== before.commentsRevision) throw new SiYuanError('comments_changed')
      assertActor()
      if (binding.signal?.aborted) throw new SiYuanError('cancelled')
      return withWriteReceipt(options.userDataDir(), [binding.identity, binding.spaceId ?? null, baseUrl, id, `comment.${mode}`, request], async () => {
        assertActor()
        await client.setBlockAttributes(id, { [ATTRIBUTE]: serialized }, binding.signal)
        try {
          assertActor()
          const after = await snapshot(client, id, binding)
          assertActor()
          const written = after.store.comments[commentId]
          const value = replyId ? written?.replies[replyId] : written
          if (!value || value.text !== request.text || value.authorId !== current.authorId) throw new Error('not verified')
          return contract.outputSchema.parse({ documentId: id, commentId, replyId, commentsRevision: after.commentsRevision, updated: after.updated })
        } catch { throw new SiYuanError('outcome_unknown') }
      })
    })
  }
  return { list, mutate }
}
