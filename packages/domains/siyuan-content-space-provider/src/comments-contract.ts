import { z } from 'zod'

export const commentKeySchema = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/u)
  .refine(value => !['__proto__', 'constructor', 'prototype'].includes(value))
const revision = z.string().regex(/^[a-f0-9]{64}$/u)
const blockId = z.string().regex(/^\d{14}-[a-z0-9]{7}$/u)
const text = z.string().trim().min(1).max(20_000)
const write = z.object({ text, expectedCommentsRevision: revision })
const result = z.object({
  documentId: blockId, commentId: commentKeySchema, replyId: commentKeySchema.nullable(), commentsRevision: revision,
  updated: z.string().max(64)
}).strict()
export const siyuanCommentListContract = Object.freeze({
  actionId: 'siyuan.comment.list', effect: 'read' as const,
  inputSchema: z.object({
    offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(100).default(20),
    expectedCommentsRevision: revision.optional()
  }).strict(),
  outputSchema: z.object({
    documentId: blockId, commentsRevision: revision, total: z.number().int().min(0), nextOffset: z.number().int().nullable(),
    entries: z.array(z.object({
      kind: z.enum(['comment', 'reply']), commentId: commentKeySchema, replyId: commentKeySchema.nullable(),
      replyTo: z.string().nullable(), blockId, quote: z.string(), text: z.string(), author: z.string(),
      authorId: z.string().nullable(), createdAt: z.number(), updatedAt: z.number().nullable(),
      resolved: z.boolean(), canEdit: z.boolean()
    }).strict()).max(100)
  }).strict()
})
export const siyuanCommentCreateContract = Object.freeze({
  actionId: 'siyuan.comment.create', effect: 'external-write' as const,
  inputSchema: write.extend({ blockId: blockId.optional(), quote: z.string().max(20_000).default('') }).strict(),
  outputSchema: result
})
export const siyuanCommentReplyContract = Object.freeze({
  actionId: 'siyuan.comment.reply', effect: 'external-write' as const,
  inputSchema: write.extend({ commentId: commentKeySchema, replyTo: commentKeySchema.optional() }).strict(),
  outputSchema: result
})
export const siyuanCommentUpdateContract = Object.freeze({
  actionId: 'siyuan.comment.update', effect: 'external-write' as const,
  inputSchema: write.extend({ commentId: commentKeySchema, replyId: commentKeySchema.optional() }).strict(),
  outputSchema: result
})
