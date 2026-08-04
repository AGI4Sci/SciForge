import type { z } from 'zod'
import type { DomainMainHost } from '@sciforge/domain-sdk/host'
import type { TrustedDomainProcessEntryInput } from '@sciforge/domain-sdk/main'
import type { DomainMainVisualCaptureHost } from '@sciforge/domain-sdk/visual-capture'
import {
  ANCHORED_COMMENT_CAPABILITY_IDS,
  anchoredCommentCaptureRequestSchema,
  anchoredCommentCaptureResultSchema,
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
import {
  ANCHORED_COMMENTS_CAPABILITY_FACTORY_CONTRIBUTION,
  ANCHORED_COMMENTS_DOMAIN_MODULE_ID,
  domainPackageDefinition
} from '../definition'
import { AnchoredCommentService } from './comment-service'
import { AnchoredCommentFeedbackService } from './feedback-service'
import {
  configuredFeedbackGatewayToken,
  configuredFeedbackGatewayUrl,
  FeedbackGatewayClient
} from './feedback-gateway-client'

type AnchoredCommentsCapabilityEffect = 'read' | 'workspace-write' | 'external-write'

type AnchoredCommentsCapabilityOptions = Readonly<{
  id: string
  version: string
  title: string
  description: string
  audiences: readonly ('ui' | 'agent' | 'system')[]
  scope: 'global'
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
  moduleId: typeof ANCHORED_COMMENTS_DOMAIN_MODULE_ID
  policy: Readonly<{
    id: 'anchored-comments'
    title: 'Anchored Comments'
    directTransportPrefixes: readonly ['anchoredComments:']
    allowedDirectTransports: readonly []
  }>
  createDefinitions: () => readonly CapabilityDefinition[]
}>

export function createDomainMainEntry(
  host: DomainMainHost
): TrustedDomainProcessEntryInput<AnchoredCommentsCapabilityFactory> {
  let comments: AnchoredCommentService | undefined
  let feedback: AnchoredCommentFeedbackService | undefined

  const getComments = (): AnchoredCommentService => {
    comments ??= new AnchoredCommentService(host.getUserDataDir())
    return comments
  }

  const getFeedback = (): AnchoredCommentFeedbackService => {
    if (feedback) return feedback
    const url = configuredFeedbackGatewayUrl(process.env)
    const gateway = url
      ? new FeedbackGatewayClient({
          baseUrl: url,
          authToken: configuredFeedbackGatewayToken(process.env) ?? undefined
        })
      : null
    feedback = new AnchoredCommentFeedbackService({
      comments: getComments(),
      gateway
    })
    return feedback
  }

  return {
    definition: domainPackageDefinition,
    contributions: [{
      ...ANCHORED_COMMENTS_CAPABILITY_FACTORY_CONTRIBUTION,
      value: createAnchoredCommentsCapabilityFactory({
        defineCapability: host.defineCapability as (
          options: AnchoredCommentsCapabilityOptions
        ) => unknown,
        getComments,
        getFeedback,
        visualCapture: host.visualCapture
      }),
      onDispose: () => {
        comments = undefined
        feedback = undefined
      }
    }]
  }
}

export function createAnchoredCommentsCapabilityFactory<CapabilityDefinition>(
  options: Readonly<{
    defineCapability: (
      options: AnchoredCommentsCapabilityOptions
    ) => CapabilityDefinition
    getComments: () => AnchoredCommentService
    getFeedback: () => AnchoredCommentFeedbackService
    visualCapture?: DomainMainVisualCaptureHost
  }>
): AnchoredCommentsCapabilityFactory<CapabilityDefinition> {
  const define = (
    input: Omit<
      AnchoredCommentsCapabilityOptions,
      'version' | 'audiences' | 'scope' | 'tags'
    >
  ): CapabilityDefinition => options.defineCapability({
    ...input,
    version: '1.0.0',
    audiences: ['ui', 'agent'],
    scope: 'global',
    tags: ['anchored-comments']
  })

  return Object.freeze({
    moduleId: ANCHORED_COMMENTS_DOMAIN_MODULE_ID,
    policy: Object.freeze({
      id: 'anchored-comments' as const,
      title: 'Anchored Comments' as const,
      directTransportPrefixes: Object.freeze(['anchoredComments:']) as readonly ['anchoredComments:'],
      allowedDirectTransports: Object.freeze([]) as readonly []
    }),
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
          output: anchoredCommentDeleteResultSchema.parse({
            deleted: await options.getComments().deleteThread(threadId)
          })
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
        handler: async ({ asset }) => ({
          output: anchoredCommentReadAssetResultSchema.parse({
            digest: asset.digest,
            mimeType: 'image/png',
            dataUrl: `data:image/png;base64,${Buffer.from(
              await options.getComments().readScreenshotAsset(asset)
            ).toString('base64')}`
          })
        })
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
          const captured = await capture.captureRegisteredTarget({
            targetRef: request.targetRef,
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
          const focusedScreenshot = await options.getComments().putScreenshotAsset(
            captured.png,
            { width: captured.width, height: captured.height }
          )
          if (focusedScreenshot.digest !== captured.sha256) {
            throw new Error('Host visual capture failed its content digest check.')
          }
          return {
            output: anchoredCommentCaptureResultSchema.parse({
              ok: true,
              capture: {
                capturedAt: new Date().toISOString(),
                appVersion: domainPackageDefinition.module.version,
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
              }
            })
          }
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
