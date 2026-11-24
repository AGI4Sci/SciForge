import { z } from 'zod'
import {
  idempotencyKeySchema, projectIdSchema, protocolVersionSchema, requestIdSchema,
  revisionSchema, sequenceSchema, sha256Schema, timestampSchema, userIdSchema
} from './core.js'

/** Conservative admission budget for new complete JSON command bodies.
 * Count serialized UTF-8 bytes, including envelope, escaped text and anchors.
 * Larger schema-valid publications must be split before initial submission;
 * existing uncertain commands retain their original immutable retry payload.
 */
export const MAX_CODE_CONVERSATION_COMMAND_BYTES = 64 * 1024
export function codeConversationCommandByteLength(command: CodeConversationCommand): number {
  return new TextEncoder().encode(JSON.stringify(command)).byteLength
}

const id = z.string().trim().min(1).max(256)
const cursor = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const envelope = { protocolVersion: protocolVersionSchema, requestId: requestIdSchema, projectId: projectIdSchema }
const mutation = { ...envelope, idempotencyKey: idempotencyKeySchema, conversationId: id }

export const codeConversationAnchorSchema = z.object({
  filePath: z.string().min(1).max(2_048).refine((path) =>
    !/[\\:]/u.test(path) && !Array.from(path).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) && !path.startsWith('/') &&
    path.split('/').every((part) => part.length > 0 && part !== '.' && part !== '..'),
  'Code paths must be portable workspace-relative paths.'),
  side: z.enum(['old', 'new']), line: z.number().int().positive(),
  endLine: z.number().int().positive().optional(), hunkHeader: z.string().max(2_048),
  code: z.string().max(40_000), baseRevision: z.string().trim().min(1).max(256),
  contentDigest: sha256Schema
}).strict().refine((anchor) => anchor.endLine === undefined || anchor.endLine >= anchor.line,
  'Code range must be ordered.')

export const codeConversationMessageInputSchema = z.object({
  messageId: id, kind: z.enum(['user', 'ai']), body: z.string().trim().min(1).max(20_000)
}).strict()
export const codeConversationMessageSchema = codeConversationMessageInputSchema.extend({
  publishedByUserId: userIdSchema, publishedAt: timestampSchema
}).strict()

export const codeConversationPublishSchema = z.object({
  ...mutation, type: z.literal('project.code_conversation.publish'), anchor: codeConversationAnchorSchema,
  messages: z.array(codeConversationMessageInputSchema).min(1).max(32)
}).strict().refine(({ messages }) => new Set(messages.map((message) => message.messageId)).size === messages.length,
  'Message identities must be unique.')
export const codeConversationAppendSchema = z.object({
  ...mutation, type: z.literal('project.code_conversation.append'), message: codeConversationMessageInputSchema
}).strict()
export const codeConversationForkSchema = z.object({
  ...mutation, type: z.literal('project.code_conversation.fork'),
  parentConversationId: id, parentMessageId: id, message: codeConversationMessageInputSchema
}).strict().refine((input) => input.conversationId !== input.parentConversationId, 'A conversation cannot fork itself.')
export const codeConversationSetStatusSchema = z.object({
  ...mutation, type: z.literal('project.code_conversation.set_status'),
  status: z.enum(['open', 'resolved']), expectedRevision: revisionSchema, observedMessageId: id
}).strict()
export const codeConversationPullSchema = z.object({
  ...envelope, type: z.literal('project.code_conversation.pull'), afterSequence: cursor,
  limit: z.number().int().min(1).max(100)
}).strict()
export const codeConversationCommandSchemas = [codeConversationPublishSchema, codeConversationAppendSchema,
  codeConversationForkSchema, codeConversationSetStatusSchema, codeConversationPullSchema] as const
export const codeConversationCommandSchema = z.discriminatedUnion('type', codeConversationCommandSchemas)
export type CodeConversationCommand = z.infer<typeof codeConversationCommandSchema>

export const codeConversationSchema = z.object({
  projectId: projectIdSchema, conversationId: id, anchor: codeConversationAnchorSchema,
  createdByUserId: userIdSchema, createdAt: timestampSchema, revision: revisionSchema,
  status: z.enum(['open', 'resolved']),
  messages: z.array(codeConversationMessageSchema).min(1).max(500),
  fork: z.object({ parentConversationId: id, parentMessageId: id,
    messages: z.array(codeConversationMessageSchema).min(1).max(32), truncated: z.boolean() }).strict().optional()
}).strict()
export type CodeConversation = z.infer<typeof codeConversationSchema>

// Events carry only changed data, keeping synchronization pages bounded even
// when a conversation has a long history. Sequences serialize project commits.
export const codeConversationEventSchema = z.object({
  projectId: projectIdSchema, sequence: sequenceSchema, conversationId: id,
  revision: revisionSchema, actorUserId: userIdSchema, occurredAt: timestampSchema,
  change: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('created'), conversation: codeConversationSchema }).strict(),
    z.object({ kind: z.literal('message'), message: codeConversationMessageSchema }).strict(),
    z.object({ kind: z.literal('status'), status: z.enum(['open', 'resolved']), observedMessageId: id }).strict()
  ])
}).strict()
export type CodeConversationEvent = z.infer<typeof codeConversationEventSchema>
export const codeConversationMutationResponseSchema = z.object({
  protocolVersion: protocolVersionSchema, requestId: requestIdSchema,
  type: z.literal('rest.code_conversation.changed'), event: codeConversationEventSchema
}).strict()
export const codeConversationPageResponseSchema = z.object({
  ...envelope, type: z.literal('rest.code_conversation.page'),
  events: z.array(codeConversationEventSchema).max(100), nextSequence: cursor, hasMore: z.boolean()
}).strict()
