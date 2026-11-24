import { z } from 'zod'
import { codeAnchorSchema } from '@sciforge/domain-sdk/renderer'
import { captureSourceSchema } from '../ports/visual-capture'
import { codeConversationCommandSchema, codeConversationSchema, projectIdSchema, projectCoordinationCursorSchema, restProjectPageResponseSchema } from '@sciforge/collaboration-contracts'

export const ANCHORED_COMMENT_SCHEMA_VERSION = 1
/**
 * Version of the persisted thread and store documents. Independent of the
 * feedback wire protocol (`ANCHORED_COMMENT_SCHEMA_VERSION`).
 *
 * - v1: flat list of independent threads.
 * - v2: threads may carry an optional `parentThreadId`, so a conversation can
 *   branch. The field is additive and optional: a v1 thread has no parent and
 *   migrates by simply gaining the current version number (see
 *   `migrateAnchoredCommentThread`).
 */
export const ANCHORED_COMMENT_THREAD_SCHEMA_VERSION = 2
export const ANCHORED_COMMENT_CAPABILITY_IDS = Object.freeze({
  translate: 'anchored-comments.prose.translate',
  reconcileAnchor: 'anchored-comments.anchor.reconcile',
  sharedProjects: 'anchored-comments.shared.projects',
  sharedPull: 'anchored-comments.shared.pull',
  sharedRetry: 'anchored-comments.shared.retry',
  sharedDiscard: 'anchored-comments.shared.discard',
  sharedSubmit: 'anchored-comments.shared.submit',
  sharedPublish: 'anchored-comments.shared.publish',
  fork: 'anchored-comments.conversation.fork',
  reply: 'anchored-comments.conversation.reply',
  cancel: 'anchored-comments.conversation.cancel',
  list: 'anchored-comments.list',
  get: 'anchored-comments.get',
  upsert: 'anchored-comments.upsert',
  delete: 'anchored-comments.delete',
  readAsset: 'anchored-comments.asset.read',
  capture: 'anchored-comments.capture',
  submitFeedback: 'anchored-comments.feedback.submit',
  feedbackStatus: 'anchored-comments.feedback.status'
} as const)
export const MAX_SELECTED_COMMENT_THREADS = 8
export const MAX_CONTEXT_MESSAGES_PER_THREAD = 6
export const MAX_CONTEXT_MESSAGE_CHARS = 2_000
export const MAX_RENDERED_COMMENT_CONTEXT_CHARS = 16_000

const requiredIdSchema = z.string().trim().min(1).max(256)
const optionalText = (max: number) => z.string().trim().max(max).optional()
const timestampSchema = z.string().trim().min(1).max(64)
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/)

export const proseTranslationInputSchema = z.object({
  text: z.string().min(1).max(8_000),
  targetLanguage: z.string().regex(/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8}){0,3}$/)
}).strict()
export const proseTranslationResultSchema = z.object({
  original: z.string().max(8_000), translation: z.string().max(24_000),
  targetLanguage: proseTranslationInputSchema.shape.targetLanguage,
  machineTranslated: z.literal(true), runtimeId: z.string()
}).strict()
export type ProseTranslationInput = z.infer<typeof proseTranslationInputSchema>
export type ProseTranslation = z.infer<typeof proseTranslationResultSchema>

export const reconcileCodeAnchorInputSchema = z.object({
  threadId: requiredIdSchema, current: codeAnchorSchema
}).strict()

export const sharedConversationProjectInputSchema = z.object({ projectId: projectIdSchema }).strict()
export const sharedConversationProjectsInputSchema = z.object({ cursor: projectCoordinationCursorSchema.optional() }).strict()
export const sharedConversationProjectsResultSchema = restProjectPageResponseSchema
export const sharedConversationDiscardInputSchema = z.object({ projectId: projectIdSchema,
  idempotencyKey: z.string().min(16).max(256) }).strict()
export const sharedConversationRejectionSchema = z.object({
  idempotencyKey: z.string().min(16).max(256), conversationId: requiredIdSchema,
  status: z.number().int().min(400).max(499), code: z.string().min(1).max(256), message: z.string().max(2_000)
}).strict()
export const sharedConversationOutcomeReceiptSchema = z.object({
  idempotencyKey: z.string().min(16).max(256), outcome: z.enum(['acknowledged', 'rejected'])
}).strict()
export const sharedConversationSubmitInputSchema = z.object({ projectId: projectIdSchema,
  command: codeConversationCommandSchema.refine(command => command.type !== 'project.code_conversation.pull' && command.type !== 'project.code_conversation.publish',
    'Use explicit local-message publication or a shared mutation.') }).strict()
export const sharedConversationPublishInputSchema = z.object({ projectId: projectIdSchema, threadId: requiredIdSchema,
  requestId: requiredIdSchema, idempotencyKey: z.string().min(16).max(256), messageIds: z.array(requiredIdSchema).min(1).max(32) }).strict()
export const sharedConversationResultSchema = z.object({ projectId: projectIdSchema,
  conversations: z.array(codeConversationSchema), rejectedCommands: z.array(sharedConversationRejectionSchema).max(100).default([]),
  outcomeReceipts: z.array(sharedConversationOutcomeReceiptSchema).max(100).default([]),
  pendingCount: z.number().int().nonnegative(), afterSequence: z.number().int().nonnegative() }).strict()

const commentSelectionScalarSchema = z.union([
  z.string().max(4_096),
  z.number().finite(),
  z.boolean(),
  z.null()
])

const commentSelectionValueSchema = z.union([
  commentSelectionScalarSchema,
  z.array(commentSelectionScalarSchema).max(64)
])

export const commentSelectionSchema = z.record(
  z.string().trim().min(1).max(128),
  commentSelectionValueSchema
).superRefine((value, context) => {
  if (Object.keys(value).length > 64) {
    context.addIssue({
      code: 'custom',
      message: 'A comment selection can contain at most 64 fields.'
    })
  }
})

export type CommentSelection = z.infer<typeof commentSelectionSchema>

export const commentRectSchema = z.object({
  x: z.number().finite().nonnegative(),
  y: z.number().finite().nonnegative(),
  width: z.number().finite().positive(),
  height: z.number().finite().positive()
}).strict()

export type CommentRect = z.infer<typeof commentRectSchema>

export const commentViewportSchema = z.object({
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
  scaleFactor: z.number().finite().positive().max(16)
}).strict()

export type CommentViewport = z.infer<typeof commentViewportSchema>

export const commentDomFingerprintSchema = z.object({
  tagName: z.string().trim().min(1).max(64),
  role: optionalText(128),
  accessibleName: optionalText(512),
  visibleText: optionalText(1_000),
  testId: optionalText(256),
  commentId: optionalText(256),
  path: z.array(z.object({
    tagName: z.string().trim().min(1).max(64),
    id: optionalText(256),
    classes: z.array(z.string().trim().min(1).max(128)).max(8).optional(),
    nthOfType: z.number().int().positive().max(10_000).optional()
  }).strict()).max(12).optional()
}).strict()

export type CommentDomFingerprint = z.infer<typeof commentDomFingerprintSchema>

export const researchCommentTargetSchema = z.object({
  kind: z.literal('research'),
  resourceKind: z.string().trim().min(1).max(128),
  resourceId: z.string().trim().min(1).max(2_048),
  selection: commentSelectionSchema.optional(),
  contentDigest: optionalText(256)
}).strict()

export const uiCommentTargetSchema = z.object({
  kind: z.literal('ui'),
  componentId: z.string().trim().min(1).max(256),
  elementId: optionalText(256),
  route: optionalText(512),
  selection: commentSelectionSchema.optional()
}).strict()

export const visualCommentTargetSchema = z.object({
  kind: z.literal('visual'),
  route: optionalText(512),
  selection: commentSelectionSchema.optional()
}).strict()

export const commentCanonicalTargetSchema = z.discriminatedUnion('kind', [
  researchCommentTargetSchema,
  uiCommentTargetSchema,
  visualCommentTargetSchema
])

export type CommentCanonicalTarget = z.infer<typeof commentCanonicalTargetSchema>

/** Frozen, portable code evidence. Never contains an absolute workspace path. */
export const commentCodeAnchorSchema = codeAnchorSchema

export const commentAnchorSchema = z.object({
  targetKey: z.string().trim().min(1).max(2_048),
  targetLabel: z.string().trim().min(1).max(512),
  canonical: commentCanonicalTargetSchema,
  codeAnchor: commentCodeAnchorSchema.optional(),
  domFingerprint: commentDomFingerprintSchema.optional(),
  bounds: commentRectSchema
}).strict()

export type CommentAnchor = z.infer<typeof commentAnchorSchema>

export const commentScreenshotAssetRefSchema = z.object({
  digest: sha256Schema,
  mimeType: z.literal('image/png'),
  byteLength: z.number().int().positive().max(25 * 1024 * 1024),
  width: z.number().int().positive().max(100_000),
  height: z.number().int().positive().max(100_000)
}).strict()

export type CommentScreenshotAssetRef = z.infer<typeof commentScreenshotAssetRefSchema>

export const anchoredCommentCaptureBundleSchema = z.object({
  capturedAt: timestampSchema,
  appVersion: z.string().trim().min(1).max(128),
  appBuild: optionalText(128),
  platform: z.string().trim().min(1).max(64),
  osVersion: optionalText(128),
  route: optionalText(512),
  viewport: commentViewportSchema,
  theme: optionalText(64),
  locale: optionalText(64),
  targetLabel: z.string().trim().min(1).max(512),
  targetBounds: commentRectSchema,
  contentDigest: optionalText(256),
  redacted: z.boolean().optional(),
  source: captureSourceSchema.optional(),
  fullWindowScreenshot: commentScreenshotAssetRefSchema.optional(),
  focusedScreenshot: commentScreenshotAssetRefSchema.optional(),
  unavailableReason: optionalText(1_000)
}).strict().superRefine((value, context) => {
  if (!value.fullWindowScreenshot && !value.focusedScreenshot && !value.unavailableReason) {
    context.addIssue({
      code: 'custom',
      message: 'A capture without screenshots must explain why visual evidence is unavailable.'
    })
  }
})

export type AnchoredCommentCaptureBundle = z.infer<typeof anchoredCommentCaptureBundleSchema>

export const anchoredCommentCaptureRequestSchema = z.object({
  threadId: requiredIdSchema.optional(),
  targetRef: requiredIdSchema,
  targetBounds: commentRectSchema,
  targetLabel: z.string().trim().min(1).max(512),
  route: optionalText(512),
  viewport: commentViewportSchema,
  theme: optionalText(64),
  locale: optionalText(64)
}).strict()

export type AnchoredCommentCaptureRequest = z.infer<typeof anchoredCommentCaptureRequestSchema>

export const anchoredCommentCaptureResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), capture: anchoredCommentCaptureBundleSchema }).strict(),
  z.object({ ok: z.literal(false), message: z.string().trim().min(1).max(2_000) }).strict()
])

export type AnchoredCommentCaptureResult = z.infer<typeof anchoredCommentCaptureResultSchema>

export const anchoredCommentListInputSchema = z.object({
  workspaceKey: z.string().trim().min(1).max(2_048).optional(),
  targetKey: z.string().trim().min(1).max(2_048).optional(),
  purpose: z.enum(['research', 'product_feedback']).optional(),
  status: z.enum(['open', 'attached', 'ai_responded', 'awaiting_verification', 'resolved']).optional(),
  includeResolved: z.boolean().optional()
}).strict()

export type AnchoredCommentListInput = z.infer<typeof anchoredCommentListInputSchema>

export const anchoredCommentListResultSchema = z.object({
  threads: z.array(z.lazy(() => anchoredCommentThreadSchema)).max(100_000)
}).strict()

export type AnchoredCommentListResult = z.infer<typeof anchoredCommentListResultSchema>

export const anchoredCommentThreadIdInputSchema = z.object({
  threadId: requiredIdSchema
}).strict()

export const anchoredCommentGetResultSchema = z.object({
  thread: z.lazy(() => anchoredCommentThreadSchema).nullable()
}).strict()

export const anchoredCommentUpsertInputSchema = z.object({
  thread: z.lazy(() => anchoredCommentThreadSchema)
}).strict()

export const anchoredCommentDeleteResultSchema = z.object({
  deleted: z.boolean(),
  cleanupPending: z.boolean().optional(),
  warnings: z.array(z.string().trim().min(1).max(1_000)).max(2).optional()
}).strict()

export type AnchoredCommentDeleteResult = z.infer<typeof anchoredCommentDeleteResultSchema>

export const anchoredCommentReadAssetInputSchema = z.object({
  asset: commentScreenshotAssetRefSchema
}).strict()

export const anchoredCommentReadAssetResultSchema = z.object({
  digest: sha256Schema,
  mimeType: z.literal('image/png'),
  byteLength: commentScreenshotAssetRefSchema.shape.byteLength,
  width: commentScreenshotAssetRefSchema.shape.width,
  height: commentScreenshotAssetRefSchema.shape.height,
  integrityVerified: z.literal(true),
  dataUrl: z.string().startsWith('data:image/png;base64,').max(35 * 1024 * 1024)
}).strict()

export const anchoredCommentMessageSchema = z.object({
  id: requiredIdSchema,
  authorKind: z.enum(['user', 'ai', 'system']),
  authorId: optionalText(256),
  body: z.string().trim().min(1).max(20_000),
  createdAt: timestampSchema,
  updatedAt: timestampSchema
}).strict()

export type AnchoredCommentMessage = z.infer<typeof anchoredCommentMessageSchema>

export const anchoredCommentForkSchema = z.object({
  parentThreadId: requiredIdSchema,
  parentMessageId: requiredIdSchema,
  messages: z.array(anchoredCommentMessageSchema).max(32),
  truncated: z.boolean()
}).strict()

export const anchoredCommentForkInputSchema = z.object({
  threadId: requiredIdSchema,
  messageId: requiredIdSchema,
  childId: requiredIdSchema,
  body: z.string().trim().min(1).max(20_000)
}).strict()

export const anchoredCommentReplyInputSchema = z.object({
  threadId: requiredIdSchema,
  requestId: z.string().uuid(),
  body: z.string().trim().min(1).max(20_000).optional()
}).strict()
export const anchoredCommentCancelInputSchema = z.object({
  threadId: requiredIdSchema,
  requestId: z.string().uuid()
}).strict()
export const anchoredCommentReplyResultSchema = z.object({
  thread: z.lazy(() => anchoredCommentThreadSchema),
  state: z.enum(['completed', 'failed', 'cancelled']),
  truncated: z.boolean(),
  error: z.string().max(2_000).optional()
}).strict()
export const anchoredCommentCancelResultSchema = z.object({ cancelled: z.boolean() }).strict()

export const feedbackDisclosureChoicesSchema = z.object({
  annotatedScreenshots: z.boolean(),
  applicationEnvironment: z.boolean(),
  logs: z.boolean(),
  conversationExcerpt: z.boolean(),
  workspacePaths: z.boolean(),
  fileMetadata: z.boolean()
}).strict()

export type FeedbackDisclosureChoices = z.infer<typeof feedbackDisclosureChoicesSchema>

export const DEFAULT_FEEDBACK_DISCLOSURE_CHOICES: Readonly<FeedbackDisclosureChoices> = Object.freeze({
  annotatedScreenshots: true,
  applicationEnvironment: true,
  logs: false,
  conversationExcerpt: false,
  workspacePaths: false,
  fileMetadata: false
})

export const feedbackIssueLinkSchema = z.object({
  issueNumber: z.number().int().positive(),
  issueUrl: z.string().url().max(2_048),
  author: optionalText(256),
  assetUrls: z.array(z.string().url().max(2_048)).max(16),
  submittedAt: timestampSchema
}).strict()

export type FeedbackIssueLink = z.infer<typeof feedbackIssueLinkSchema>

export const anchoredCommentFeedbackStateSchema = z.object({
  state: z.enum(['local', 'submitting', 'submitted', 'failed']),
  idempotencyKey: optionalText(256),
  disclosure: feedbackDisclosureChoicesSchema.optional(),
  issue: feedbackIssueLinkSchema.optional(),
  error: optionalText(2_000),
  updatedAt: timestampSchema.optional()
}).strict().superRefine((value, context) => {
  if (value.state === 'submitted' && !value.issue) {
    context.addIssue({ code: 'custom', message: 'Submitted feedback must include its GitHub Issue.' })
  }
})

export type AnchoredCommentFeedbackState = z.infer<typeof anchoredCommentFeedbackStateSchema>

export const anchoredCommentThreadSchema = z.object({
  schemaVersion: z.literal(ANCHORED_COMMENT_THREAD_SCHEMA_VERSION),
  id: requiredIdSchema,
  /**
   * The thread this one branches from, when the thread continues a conversation
   * rather than starting a fresh one. Absent for a root thread. The parent must
   * already exist and must not form a cycle; the service enforces both.
   */
  parentThreadId: requiredIdSchema.optional(),
  workspaceKey: z.string().trim().min(1).max(2_048),
  purpose: z.enum(['research', 'product_feedback']),
  anchor: commentAnchorSchema,
  capture: anchoredCommentCaptureBundleSchema,
  messages: z.array(anchoredCommentMessageSchema).min(1).max(500),
  fork: anchoredCommentForkSchema.optional(),
  status: z.enum(['open', 'attached', 'ai_responded', 'awaiting_verification', 'resolved']),
  anchorResolution: z.enum(['resolved', 'needs_retargeting']),
  feedback: anchoredCommentFeedbackStateSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema
}).strict()

export type AnchoredCommentThread = z.infer<typeof anchoredCommentThreadSchema>

export const anchoredCommentStoreSchema = z.object({
  schemaVersion: z.literal(ANCHORED_COMMENT_THREAD_SCHEMA_VERSION),
  threads: z.array(anchoredCommentThreadSchema).max(100_000),
  updatedAt: timestampSchema
}).strict()

export type AnchoredCommentStore = z.infer<typeof anchoredCommentStoreSchema>

const contextCommentSchema = z.object({
  messageId: requiredIdSchema,
  authorKind: z.enum(['user', 'ai', 'system']),
  body: z.string().trim().min(1).max(MAX_CONTEXT_MESSAGE_CHARS),
  createdAt: timestampSchema
}).strict()

export const anchoredCommentContextReferenceSchema = z.object({
  schemaVersion: z.literal(ANCHORED_COMMENT_SCHEMA_VERSION),
  threadId: requiredIdSchema,
  purpose: z.enum(['research', 'product_feedback']),
  targetKey: z.string().trim().min(1).max(2_048),
  targetLabel: z.string().trim().min(1).max(512),
  status: z.enum(['open', 'attached', 'ai_responded', 'awaiting_verification', 'resolved']),
  anchorResolution: z.enum(['resolved', 'needs_retargeting']),
  anchor: commentAnchorSchema,
  capture: anchoredCommentCaptureBundleSchema,
  comments: z.array(contextCommentSchema).min(1).max(MAX_CONTEXT_MESSAGES_PER_THREAD),
  attachedAt: timestampSchema
}).strict()

export type AnchoredCommentContextReference = z.infer<typeof anchoredCommentContextReferenceSchema>
export type CommentContextReference = AnchoredCommentContextReference

export const productFeedbackScreenshotSchema = z.object({
  kind: z.enum(['full_window', 'focused']),
  asset: commentScreenshotAssetRefSchema,
  dataBase64: z.string().max(35 * 1024 * 1024).optional()
}).strict()

export type ProductFeedbackScreenshot = z.infer<typeof productFeedbackScreenshotSchema>

export const productFeedbackPacketSchema = z.object({
  schemaVersion: z.literal(ANCHORED_COMMENT_SCHEMA_VERSION),
  idempotencyKey: z.string().trim().min(16).max(256),
  threadId: requiredIdSchema,
  repository: z.object({
    owner: z.string().trim().min(1).max(128),
    name: z.string().trim().min(1).max(128)
  }).strict(),
  title: z.string().trim().min(1).max(256),
  body: z.string().trim().min(1).max(100_000),
  disclosure: feedbackDisclosureChoicesSchema,
  screenshots: z.array(productFeedbackScreenshotSchema).max(2).optional(),
  environment: z.record(z.string().max(128), z.string().max(4_096)).optional(),
  logs: z.string().max(200_000).optional(),
  conversationExcerpt: z.string().max(100_000).optional(),
  workspacePaths: z.array(z.string().max(4_096)).max(64).optional(),
  fileMetadata: z.array(z.record(z.string().max(128), z.string().max(4_096))).max(128).optional()
}).strict().superRefine((value, context) => {
  const disclosedFields: Array<[keyof FeedbackDisclosureChoices, unknown]> = [
    ['annotatedScreenshots', value.screenshots],
    ['applicationEnvironment', value.environment],
    ['logs', value.logs],
    ['conversationExcerpt', value.conversationExcerpt],
    ['workspacePaths', value.workspacePaths],
    ['fileMetadata', value.fileMetadata]
  ]
  for (const [choice, field] of disclosedFields) {
    if (!value.disclosure[choice] && field !== undefined) {
      context.addIssue({
        code: 'custom',
        message: `${choice} data was supplied without disclosure approval.`
      })
    }
  }
})

export type ProductFeedbackPacket = z.infer<typeof productFeedbackPacketSchema>

export const feedbackGatewayResultSchema = z.object({
  schemaVersion: z.literal(ANCHORED_COMMENT_SCHEMA_VERSION),
  idempotencyKey: z.string().trim().min(16).max(256),
  issueNumber: z.number().int().positive(),
  issueUrl: z.string().url().max(2_048),
  author: optionalText(256),
  assetUrls: z.array(z.string().url().max(2_048)).max(16),
  createdAt: timestampSchema
}).strict()

export type FeedbackGatewayResult = z.infer<typeof feedbackGatewayResultSchema>

export const feedbackSubmissionRequestSchema = z.object({
  packet: productFeedbackPacketSchema
}).strict()

export type FeedbackSubmissionRequest = z.infer<typeof feedbackSubmissionRequestSchema>

export const feedbackSubmissionResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), result: feedbackGatewayResultSchema }).strict(),
  z.object({
    ok: z.literal(false),
    message: z.string().trim().min(1).max(2_000),
    retryable: z.boolean()
  }).strict()
])

export type FeedbackSubmissionResult = z.infer<typeof feedbackSubmissionResultSchema>

export const feedbackSubmissionStatusRequestSchema = z.object({
  threadId: requiredIdSchema
}).strict()

export type FeedbackSubmissionStatusRequest = z.infer<typeof feedbackSubmissionStatusRequestSchema>

export const feedbackSubmissionStatusResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), feedback: anchoredCommentFeedbackStateSchema }).strict(),
  z.object({ ok: z.literal(false), message: z.string().trim().min(1).max(2_000) }).strict()
])

export type FeedbackSubmissionStatusResult = z.infer<typeof feedbackSubmissionStatusResultSchema>

export function parseAnchoredCommentThread(value: unknown): AnchoredCommentThread {
  return anchoredCommentThreadSchema.parse(value)
}

export function parseAnchoredCommentStore(value: unknown): AnchoredCommentStore {
  return anchoredCommentStoreSchema.parse(value)
}

export function parseAnchoredCommentContextReference(value: unknown): AnchoredCommentContextReference {
  return anchoredCommentContextReferenceSchema.parse(value)
}

export function parseProductFeedbackPacket(value: unknown): ProductFeedbackPacket {
  return productFeedbackPacketSchema.parse(value)
}

export function parseFeedbackGatewayResult(value: unknown): FeedbackGatewayResult {
  return feedbackGatewayResultSchema.parse(value)
}

export function migrateAnchoredCommentThread(value: unknown): AnchoredCommentThread {
  const raw = objectRecord(value, 'Anchored comment thread must be an object.')
  const schemaVersion = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 0
  if (schemaVersion > ANCHORED_COMMENT_THREAD_SCHEMA_VERSION) {
    throw new Error(`Unsupported anchored comment schema version: ${schemaVersion}.`)
  }
  const createdAt = stringOr(raw.createdAt, new Date(0).toISOString())
  // v1 → v2 is additive: `parentThreadId` is optional and absent on legacy
  // threads, so no field is rewritten beyond the version number. Older sparse
  // documents still receive their defaults below.
  const migrated = {
    ...raw,
    schemaVersion: ANCHORED_COMMENT_THREAD_SCHEMA_VERSION,
    purpose: raw.purpose ?? 'research',
    status: raw.status ?? 'open',
    anchorResolution: raw.anchorResolution ?? 'resolved',
    feedback: raw.feedback ?? { state: 'local' },
    createdAt,
    updatedAt: stringOr(raw.updatedAt, createdAt)
  }
  return anchoredCommentThreadSchema.parse(migrated)
}

export function migrateAnchoredCommentStore(value: unknown): AnchoredCommentStore {
  const raw = objectRecord(value, 'Anchored comment store must be an object.')
  const schemaVersion = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 0
  if (schemaVersion > ANCHORED_COMMENT_THREAD_SCHEMA_VERSION) {
    throw new Error(`Unsupported anchored comment store schema version: ${schemaVersion}.`)
  }
  const threadValue = raw.threads ?? raw.comments ?? []
  if (!Array.isArray(threadValue)) throw new Error('Anchored comment store threads must be an array.')
  const threads = threadValue
  return anchoredCommentStoreSchema.parse({
    schemaVersion: ANCHORED_COMMENT_THREAD_SCHEMA_VERSION,
    threads: threads.map(migrateAnchoredCommentThread),
    updatedAt: stringOr(raw.updatedAt, new Date(0).toISOString())
  })
}

export type BuildAnchoredCommentContextOptions = {
  maxThreads?: number
  maxMessagesPerThread?: number
  maxBodyCharsPerMessage?: number
  attachedAt?: string
}

export function buildAnchoredCommentContextReferences(
  threads: readonly AnchoredCommentThread[],
  selectedThreadIds: readonly string[],
  options: BuildAnchoredCommentContextOptions = {}
): AnchoredCommentContextReference[] {
  const maxThreads = boundedInteger(options.maxThreads, 1, MAX_SELECTED_COMMENT_THREADS, MAX_SELECTED_COMMENT_THREADS)
  const maxMessages = boundedInteger(
    options.maxMessagesPerThread,
    1,
    MAX_CONTEXT_MESSAGES_PER_THREAD,
    MAX_CONTEXT_MESSAGES_PER_THREAD
  )
  const maxBodyChars = boundedInteger(
    options.maxBodyCharsPerMessage,
    1,
    MAX_CONTEXT_MESSAGE_CHARS,
    MAX_CONTEXT_MESSAGE_CHARS
  )
  const attachedAt = options.attachedAt ?? new Date().toISOString()
  const byId = new Map(threads.map((thread) => [thread.id, thread]))
  const uniqueIds = [...new Set(selectedThreadIds)].slice(0, maxThreads)
  return uniqueIds.flatMap((threadId) => {
    const thread = byId.get(threadId)
    if (!thread) return []
    const comments = thread.messages.slice(-maxMessages).map((message) => ({
      messageId: message.id,
      authorKind: message.authorKind,
      body: truncate(message.body, maxBodyChars),
      createdAt: message.createdAt
    }))
    if (comments.length === 0) return []
    return [anchoredCommentContextReferenceSchema.parse({
      schemaVersion: ANCHORED_COMMENT_SCHEMA_VERSION,
      threadId: thread.id,
      purpose: thread.purpose,
      targetKey: thread.anchor.targetKey,
      targetLabel: thread.anchor.targetLabel,
      status: thread.status,
      anchorResolution: thread.anchorResolution,
      anchor: thread.anchor,
      capture: thread.capture,
      comments,
      attachedAt
    })]
  })
}

export type RenderAnchoredCommentContextOptions = {
  maxChars?: number
}

export function renderAnchoredCommentContext(
  references: readonly AnchoredCommentContextReference[],
  options: RenderAnchoredCommentContextOptions = {}
): string {
  const maxChars = boundedInteger(
    options.maxChars,
    256,
    MAX_RENDERED_COMMENT_CONTEXT_CHARS,
    MAX_RENDERED_COMMENT_CONTEXT_CHARS
  )
  const header = 'Explicitly attached SciForge comments (only the user-selected comments are included):\n'
  let output = header
  for (const [index, unparsed] of references.slice(0, MAX_SELECTED_COMMENT_THREADS).entries()) {
    const reference = anchoredCommentContextReferenceSchema.parse(unparsed)
    const provenance = {
      threadId: reference.threadId,
      purpose: reference.purpose,
      targetKey: reference.targetKey,
      targetLabel: reference.targetLabel,
      status: reference.status,
      anchorResolution: reference.anchorResolution,
      canonicalTarget: reference.anchor.canonical,
      capturedAt: reference.capture.capturedAt,
      appVersion: reference.capture.appVersion,
      route: reference.capture.route,
      contentDigest: reference.capture.contentDigest,
      visualEvidenceAvailable: Boolean(reference.capture.fullWindowScreenshot)
    }
    const blockHeader = `\n[Attached comment ${index + 1}]\nprovenance: ${JSON.stringify(provenance)}\n`
    if (output.length + blockHeader.length >= maxChars) break
    output += blockHeader
    for (const comment of reference.comments) {
      const prefix = `${comment.authorKind} (${comment.createdAt}): `
      const remaining = maxChars - output.length - prefix.length - 2
      if (remaining <= 0) return output.trimEnd()
      const body = JSON.stringify(truncate(comment.body, Math.max(1, remaining - 2)))
      const line = `${prefix}${body}\n`
      if (output.length + line.length > maxChars) return output.trimEnd()
      output += line
    }
  }
  return output === header ? '' : output.trimEnd()
}

function objectRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message)
  return value as Record<string, unknown>
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback
}

function boundedInteger(value: number | undefined, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.floor(value!)))
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value
  if (maxChars <= 1) return value.slice(0, maxChars)
  return `${value.slice(0, maxChars - 1)}…`
}
