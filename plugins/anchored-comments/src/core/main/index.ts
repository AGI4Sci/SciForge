import type { z } from 'zod'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import type { VisualCapturePort } from '../../ports/visual-capture'
import {
  ANCHORED_COMMENT_CAPABILITY_IDS,
  anchoredCommentCaptureRequestSchema,
  anchoredCommentCaptureResultSchema,
  anchoredCommentCaptureBundleSchema,
  type CommentScreenshotAssetRef,
  anchoredCommentDeleteResultSchema,
  anchoredCommentGetResultSchema,
  anchoredCommentListInputSchema,
  anchoredCommentListResultSchema,
  anchoredCommentReadAssetInputSchema,
  anchoredCommentReadAssetResultSchema,
  anchoredCommentThreadIdInputSchema,
  anchoredCommentThreadSchema,
  anchoredCommentUpsertInputSchema,
  feedbackSubmissionRequestSchema,
  feedbackSubmissionResultSchema,
  feedbackSubmissionStatusRequestSchema,
  feedbackSubmissionStatusResultSchema,
} from '../contract'
import { ANCHORED_COMMENTS_PLUGIN_VERSION } from '../definition'
import type { AnchoredCommentService } from './comment-service'
import type { AnchoredCommentFeedbackService } from './feedback-service'

type AnchoredCommentsCapabilityEffect = 'read' | 'workspace-write' | 'external-write'

type AnchoredCommentsCapabilityOptions = Readonly<{
  id: string
  version: string
  title: string
  description: string
  audiences: readonly ('ui' | 'agent' | 'system')[]
  scope: 'workspace'
  effect: AnchoredCommentsCapabilityEffect
  approval: 'none' | 'confirmation'
  concurrency: Readonly<{
    revision: 'none'
    idempotency: 'none' | 'required'
  }>
  tags: readonly string[]
  inputSchema: z.ZodType
  outputSchema: z.ZodType
  handler: (input: any) => { output: unknown } | Promise<{ output: unknown }>
}>

export type AnchoredCommentsCapabilityFactory<CapabilityDefinition = unknown> = Readonly<{
  createDefinitions: () => readonly CapabilityDefinition[]
}>

export function createAnchoredCommentsCapabilityFactory<CapabilityDefinition>(
  options: Readonly<{
    defineCapability: (
      options: AnchoredCommentsCapabilityOptions
    ) => CapabilityDefinition
    getComments: () => AnchoredCommentService
    getFeedback: () => AnchoredCommentFeedbackService
    visualCapture?: VisualCapturePort
  }>
): AnchoredCommentsCapabilityFactory<CapabilityDefinition> {
  const define = (
    input: Omit<
      AnchoredCommentsCapabilityOptions,
      'version' | 'audiences' | 'scope' | 'tags'
    >
  ): CapabilityDefinition => options.defineCapability({
    ...input,
    // The adapter binds workspaceRoot separately from the strict business input.
    // No preview resource or host-private state participates in execution.
    description: `${input.description} Workspace scope: the caller workspace is bound separately; operation-specific values belong in input.`,
    version: '1.0.0',
    audiences: ['ui', 'agent'],
    scope: 'workspace',
    tags: ['anchored-comments']
  })

  return Object.freeze({
    createDefinitions: () => [
      define({
        id: ANCHORED_COMMENT_CAPABILITY_IDS.list,
        title: 'List anchored comments',
        description: 'Lists package-owned comment threads through a bounded filter.',
        effect: 'read',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'none' },
        inputSchema: anchoredCommentListInputSchema,
        outputSchema: anchoredCommentListResultSchema,
        handler: async (input) => ({
          output: anchoredCommentListResultSchema.parse({
            threads: await options.getComments().listThreads(input)
          })
        })
      }),
      define({
        id: ANCHORED_COMMENT_CAPABILITY_IDS.get,
        title: 'Read anchored comment',
        description: 'Reads one anchored comment thread.',
        effect: 'read',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'none' },
        inputSchema: anchoredCommentThreadIdInputSchema,
        outputSchema: anchoredCommentGetResultSchema,
        handler: async ({ threadId }) => ({
          output: anchoredCommentGetResultSchema.parse({
            thread: await options.getComments().getThread(threadId)
          })
        })
      }),
      define({
        id: ANCHORED_COMMENT_CAPABILITY_IDS.upsert,
        title: 'Save anchored comment',
        description: 'Persists one validated comment thread and immutable evidence references.',
        effect: 'workspace-write',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'required' },
        inputSchema: anchoredCommentUpsertInputSchema,
        outputSchema: anchoredCommentThreadSchema,
        handler: async ({ thread }) => ({
          output: anchoredCommentThreadSchema.parse(
            await options.getComments().upsertThread(thread)
          )
        })
      }),
      define({
        id: ANCHORED_COMMENT_CAPABILITY_IDS.delete,
        title: 'Delete anchored comment',
        description: 'Deletes one comment thread and unreferenced package evidence.',
        effect: 'workspace-write',
        approval: 'confirmation',
        concurrency: { revision: 'none', idempotency: 'required' },
        inputSchema: anchoredCommentThreadIdInputSchema,
        outputSchema: anchoredCommentDeleteResultSchema,
        handler: async ({ threadId }) => ({
          output: anchoredCommentDeleteResultSchema.parse(
            await options.getComments().deleteThread(threadId)
          )
        })
      }),
      define({
        id: ANCHORED_COMMENT_CAPABILITY_IDS.readAsset,
        title: 'Read anchored comment evidence',
        description: 'Reads one integrity-checked package screenshot as a renderer-safe data URL.',
        effect: 'read',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'none' },
        inputSchema: anchoredCommentReadAssetInputSchema,
        outputSchema: anchoredCommentReadAssetResultSchema,
        handler: async ({ asset }) => {
          const bytes = await options.getComments().readScreenshotAsset(asset)
          return {
            output: anchoredCommentReadAssetResultSchema.parse({
              digest: asset.digest,
              mimeType: 'image/png',
              byteLength: bytes.byteLength,
              width: asset.width,
              height: asset.height,
              integrityVerified: true,
              dataUrl: `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`
            })
          }
        }
      }),
      define({
        id: ANCHORED_COMMENT_CAPABILITY_IDS.capture,
        title: 'Capture anchored comment evidence',
        description: 'Captures an explicitly registered visual target through Host redaction policy.',
        effect: 'workspace-write',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'required' },
        inputSchema: anchoredCommentCaptureRequestSchema,
        outputSchema: anchoredCommentCaptureResultSchema,
        handler: async (request) => {
          const capture = options.visualCapture
          if (!capture) {
            return {
              output: anchoredCommentCaptureResultSchema.parse({
                ok: false,
                message: 'Safe registered-target capture is unavailable in this build.'
              })
            }
          }
          const comments = options.getComments()
          const snapshot = request.threadId ? await comments.snapshotThread(request.threadId) : null
          const thread = snapshot?.thread
          if (request.threadId && !thread) throw new Error('Comment thread was not found.')
          if (thread?.capture.focusedScreenshot || thread?.capture.fullWindowScreenshot) throw new Error('Comment visual evidence is already established.')
          const resourceId = thread?.anchor.canonical.kind === 'research' ? thread.anchor.canonical.resourceId : undefined
          if (thread && !resourceId) throw new Error('Capture requires a canonical research document anchor.')
          const captured = await capture.captureRegisteredTarget({
            targetRef: request.targetRef,
            ...(resourceId ? { expectedResourcePath: resourceId } : {}),
            annotation: 'callout',
            label: request.targetLabel
          })
          if (!captured.ok) {
            return {
              output: anchoredCommentCaptureResultSchema.parse({
                ok: false,
                message: captured.error.message
              })
            }
          }
          if (thread && !captured.source) throw new Error('Host screenshot source provenance is required.')
          if (createHash('sha256').update(captured.png).digest('hex') !== captured.sha256) {
            throw new Error('Host visual capture failed its content digest check.')
          }
          if (captured.source && resourceId) {
            const canonical = (path: string) => process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path)
            if (captured.source.targetRef !== request.targetRef || canonical(resolve(captured.source.workspaceRoot, resourceId)) !== canonical(captured.source.resourcePath)) {
              throw new Error('Host screenshot source does not match the comment canonical resource.')
            }
          }
          const makeCapture = (focusedScreenshot: CommentScreenshotAssetRef) => anchoredCommentCaptureBundleSchema.parse({
            capturedAt: captured.source?.capturedAt ?? new Date().toISOString(),
            ...(captured.source ? { source: captured.source } : {}),
            appVersion: ANCHORED_COMMENTS_PLUGIN_VERSION,
            platform: process.platform,
            ...(request.route ? { route: request.route } : {}),
            viewport: request.viewport,
            ...(request.theme ? { theme: request.theme } : {}),
            ...(request.locale ? { locale: request.locale } : {}),
            targetLabel: request.targetLabel,
            targetBounds: request.targetBounds,
            contentDigest: captured.sha256,
            redacted: captured.redacted,
            focusedScreenshot
          })
          const dimensions = { width: captured.width, height: captured.height }
          const attached = request.threadId
            ? await comments.attachCapturedScreenshot(request.threadId, captured.png, dimensions, makeCapture, snapshot!)
            : null
          const captureBundle = attached?.capture ?? makeCapture(await comments.putScreenshotAsset(captured.png, dimensions))
          return { output: anchoredCommentCaptureResultSchema.parse({ ok: true, capture: captureBundle }) }
        }
      }),
      define({
        id: ANCHORED_COMMENT_CAPABILITY_IDS.submitFeedback,
        title: 'Submit anchored comment feedback',
        description: 'Publishes explicitly disclosed product feedback through the configured gateway.',
        effect: 'external-write',
        approval: 'confirmation',
        concurrency: { revision: 'none', idempotency: 'required' },
        inputSchema: feedbackSubmissionRequestSchema,
        outputSchema: feedbackSubmissionResultSchema,
        handler: async (input) => ({
          output: feedbackSubmissionResultSchema.parse(
            await options.getFeedback().submit(input)
          )
        })
      }),
      define({
        id: ANCHORED_COMMENT_CAPABILITY_IDS.feedbackStatus,
        title: 'Read anchored comment feedback status',
        description: 'Reads feedback submission state for one comment thread.',
        effect: 'read',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'none' },
        inputSchema: feedbackSubmissionStatusRequestSchema,
        outputSchema: feedbackSubmissionStatusResultSchema,
        handler: async (input) => ({
          output: feedbackSubmissionStatusResultSchema.parse(
            await options.getFeedback().status(input)
          )
        })
      })
    ]
  })
}
