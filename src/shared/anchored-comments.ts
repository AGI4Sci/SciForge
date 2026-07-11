import { z } from 'zod'

export const ANCHORED_COMMENT_SCHEMA_VERSION = 1
export const MAX_SELECTED_COMMENT_THREADS = 8
export const MAX_CONTEXT_MESSAGES_PER_THREAD = 6
export const MAX_CONTEXT_MESSAGE_CHARS = 2_000
export const MAX_RENDERED_COMMENT_CONTEXT_CHARS = 16_000

const requiredIdSchema = z.string().trim().min(1).max(256)
const optionalText = (max: number) => z.string().trim().max(max).optional()
const timestampSchema = z.string().trim().min(1).max(64)
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/)

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

export const commentAnchorSchema = z.object({
  targetKey: z.string().trim().min(1).max(2_048),
  targetLabel: z.string().trim().min(1).max(512),
  canonical: commentCanonicalTargetSchema,
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
  fullWindowScreenshot: commentScreenshotAssetRefSchema.optional(),
  focusedScreenshot: commentScreenshotAssetRefSchema.optional(),
  unavailableReason: optionalText(1_000)
}).strict().superRefine((value, context) => {
  if (Boolean(value.fullWindowScreenshot) !== Boolean(value.focusedScreenshot)) {
    context.addIssue({
      code: 'custom',
      message: 'Full-window and focused screenshots must be recorded together.'
    })
  }
  if (!value.fullWindowScreenshot && !value.unavailableReason) {
    context.addIssue({
      code: 'custom',
      message: 'A capture without screenshots must explain why visual evidence is unavailable.'
    })
  }
})

export type AnchoredCommentCaptureBundle = z.infer<typeof anchoredCommentCaptureBundleSchema>

export const anchoredCommentCaptureRequestSchema = z.object({
  targetBounds: commentRectSchema,
  redactionBounds: z.array(commentRectSchema).max(64).default([]),
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

export const anchoredCommentMessageSchema = z.object({
  id: requiredIdSchema,
  authorKind: z.enum(['user', 'ai', 'system']),
  authorId: optionalText(256),
  body: z.string().trim().min(1).max(20_000),
  createdAt: timestampSchema,
  updatedAt: timestampSchema
}).strict()

export type AnchoredCommentMessage = z.infer<typeof anchoredCommentMessageSchema>

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
  schemaVersion: z.literal(ANCHORED_COMMENT_SCHEMA_VERSION),
  id: requiredIdSchema,
  workspaceKey: z.string().trim().min(1).max(2_048),
  purpose: z.enum(['research', 'product_feedback']),
  anchor: commentAnchorSchema,
  capture: anchoredCommentCaptureBundleSchema,
  messages: z.array(anchoredCommentMessageSchema).min(1).max(500),
  status: z.enum(['open', 'attached', 'ai_responded', 'awaiting_verification', 'resolved']),
  anchorResolution: z.enum(['resolved', 'needs_retargeting']),
  feedback: anchoredCommentFeedbackStateSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema
}).strict()

export type AnchoredCommentThread = z.infer<typeof anchoredCommentThreadSchema>

export const anchoredCommentStoreSchema = z.object({
  schemaVersion: z.literal(ANCHORED_COMMENT_SCHEMA_VERSION),
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
  if (schemaVersion > ANCHORED_COMMENT_SCHEMA_VERSION) {
    throw new Error(`Unsupported anchored comment schema version: ${schemaVersion}.`)
  }
  const createdAt = stringOr(raw.createdAt, new Date(0).toISOString())
  const migrated = {
    ...raw,
    schemaVersion: ANCHORED_COMMENT_SCHEMA_VERSION,
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
  if (schemaVersion > ANCHORED_COMMENT_SCHEMA_VERSION) {
    throw new Error(`Unsupported anchored comment store schema version: ${schemaVersion}.`)
  }
  const threadValue = raw.threads ?? raw.comments ?? []
  if (!Array.isArray(threadValue)) throw new Error('Anchored comment store threads must be an array.')
  const threads = threadValue
  return anchoredCommentStoreSchema.parse({
    schemaVersion: ANCHORED_COMMENT_SCHEMA_VERSION,
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
