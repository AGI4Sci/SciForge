import {
  feedbackSubmissionRequestSchema,
  feedbackSubmissionStatusRequestSchema,
  type AnchoredCommentFeedbackState,
  type AnchoredCommentThread,
  type FeedbackGatewayResult,
  type FeedbackSubmissionResult,
  type FeedbackSubmissionStatusResult,
  type ProductFeedbackPacket
} from '../contract'
import type { AnchoredCommentService } from './comment-service'

export type FeedbackGatewaySubmitter = {
  submit: (packet: ProductFeedbackPacket) => Promise<FeedbackSubmissionResult>
}

export type AnchoredCommentFeedbackServiceOptions = {
  comments: Pick<AnchoredCommentService, 'getThread' | 'upsertThread' | 'readScreenshotAsset'>
  gateway: FeedbackGatewaySubmitter | null
  now?: () => Date
}

function resultFromFeedback(feedback: AnchoredCommentFeedbackState): FeedbackGatewayResult | null {
  if (feedback.state !== 'submitted' || !feedback.issue || !feedback.idempotencyKey) return null
  return {
    schemaVersion: 1,
    idempotencyKey: feedback.idempotencyKey,
    issueNumber: feedback.issue.issueNumber,
    issueUrl: feedback.issue.issueUrl,
    ...(feedback.issue.author ? { author: feedback.issue.author } : {}),
    assetUrls: feedback.issue.assetUrls,
    createdAt: feedback.issue.submittedAt
  }
}

export class AnchoredCommentFeedbackService {
  private readonly options: AnchoredCommentFeedbackServiceOptions
  private readonly inFlight = new Map<string, Promise<FeedbackSubmissionResult>>()

  constructor(options: AnchoredCommentFeedbackServiceOptions) {
    this.options = options
  }

  async submit(input: unknown): Promise<FeedbackSubmissionResult> {
    const parsed = feedbackSubmissionRequestSchema.safeParse(input)
    if (!parsed.success) {
      return { ok: false, message: parsed.error.message, retryable: false }
    }
    const packet = parsed.data.packet
    const active = this.inFlight.get(packet.threadId)
    if (active) return active
    const task = this.submitOnce(packet).finally(() => {
      if (this.inFlight.get(packet.threadId) === task) this.inFlight.delete(packet.threadId)
    })
    this.inFlight.set(packet.threadId, task)
    return task
  }

  async status(input: unknown): Promise<FeedbackSubmissionStatusResult> {
    const parsed = feedbackSubmissionStatusRequestSchema.safeParse(input)
    if (!parsed.success) return { ok: false, message: parsed.error.message }
    const thread = await this.options.comments.getThread(parsed.data.threadId)
    if (!thread) return { ok: false, message: 'Anchored comment thread was not found.' }
    return { ok: true, feedback: thread.feedback }
  }

  private async submitOnce(packet: ProductFeedbackPacket): Promise<FeedbackSubmissionResult> {
    const thread = await this.options.comments.getThread(packet.threadId)
    if (!thread) {
      return { ok: false, message: 'Anchored comment thread was not found.', retryable: false }
    }
    if (thread.purpose !== 'product_feedback') {
      return { ok: false, message: 'Only product-feedback comments can create GitHub Issues.', retryable: false }
    }
    const existing = resultFromFeedback(thread.feedback)
    if (existing) {
      if (existing.idempotencyKey !== packet.idempotencyKey) {
        return {
          ok: false,
          message: 'This comment is already linked to a GitHub Issue.',
          retryable: false
        }
      }
      return { ok: true, result: existing }
    }
    if (!this.options.gateway) {
      await this.updateFeedback(thread, {
        state: 'failed',
        idempotencyKey: packet.idempotencyKey,
        disclosure: packet.disclosure,
        error: 'SciForge feedback gateway is not configured.',
        updatedAt: this.nowIso()
      })
      return {
        ok: false,
        message: 'SciForge feedback gateway is not configured.',
        retryable: false
      }
    }

    await this.updateFeedback(thread, {
      state: 'submitting',
      idempotencyKey: packet.idempotencyKey,
      disclosure: packet.disclosure,
      updatedAt: this.nowIso()
    })

    let hydrated: ProductFeedbackPacket
    try {
      hydrated = {
        ...packet,
        ...(packet.screenshots
          ? {
              screenshots: await Promise.all(packet.screenshots.map(async (screenshot) => ({
                kind: screenshot.kind,
                asset: screenshot.asset,
                // Never trust screenshot bytes supplied by the renderer. Load
                // the content-addressed, integrity-checked local asset instead.
                dataBase64: Buffer.from(
                  await this.options.comments.readScreenshotAsset(screenshot.asset)
                ).toString('base64')
              })))
            }
          : {})
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load screenshot evidence.'
      await this.updateCurrentFailure(packet.threadId, packet, message)
      return { ok: false, message, retryable: false }
    }

    const result = await this.options.gateway.submit(hydrated)
    if (result.ok) {
      const current = await this.options.comments.getThread(packet.threadId)
      if (current) {
        await this.updateFeedback(current, {
          state: 'submitted',
          idempotencyKey: packet.idempotencyKey,
          disclosure: packet.disclosure,
          issue: {
            issueNumber: result.result.issueNumber,
            issueUrl: result.result.issueUrl,
            ...(result.result.author ? { author: result.result.author } : {}),
            assetUrls: result.result.assetUrls,
            submittedAt: result.result.createdAt
          },
          updatedAt: this.nowIso()
        })
      }
      return result
    }

    await this.updateCurrentFailure(packet.threadId, packet, result.message)
    return result
  }

  private async updateCurrentFailure(
    threadId: string,
    packet: ProductFeedbackPacket,
    message: string
  ): Promise<void> {
    const current = await this.options.comments.getThread(threadId)
    if (!current) return
    await this.updateFeedback(current, {
      state: 'failed',
      idempotencyKey: packet.idempotencyKey,
      disclosure: packet.disclosure,
      error: message.slice(0, 2_000),
      updatedAt: this.nowIso()
    })
  }

  private async updateFeedback(
    thread: AnchoredCommentThread,
    feedback: AnchoredCommentFeedbackState
  ): Promise<void> {
    await this.options.comments.upsertThread({
      ...thread,
      feedback,
      updatedAt: this.nowIso()
    })
  }

  private nowIso(): string {
    return (this.options.now ?? (() => new Date()))().toISOString()
  }
}
