import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  anchoredCommentThreadSchema,
  DEFAULT_FEEDBACK_DISCLOSURE_CHOICES,
  type FeedbackSubmissionRequest
} from '@shared/anchored-comments'
import { submitAnchoredCommentFeedback, threadViewFromPersisted } from './renderer-bridge'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('anchored comment feedback bridge', () => {
  it('builds and automatically submits a bounded GitHub feedback packet', async () => {
    const now = '2026-07-11T00:00:00.000Z'
    const asset = {
      digest: 'a'.repeat(64),
      mimeType: 'image/png' as const,
      byteLength: 128,
      width: 640,
      height: 480
    }
    const thread = anchoredCommentThreadSchema.parse({
      schemaVersion: 1,
      id: 'feedback-thread-1',
      workspaceKey: '/workspace',
      purpose: 'product_feedback',
      anchor: {
        targetKey: 'ui:right-sidebar:export-button:chat',
        targetLabel: 'Export result',
        canonical: {
          kind: 'ui',
          componentId: 'right-sidebar',
          elementId: 'export-button',
          route: 'chat',
          selection: {
            kind: 'text',
            text: 'Export result',
            startOffset: 0,
            endOffset: 13
          }
        },
        bounds: { x: 10, y: 20, width: 80, height: 30 }
      },
      capture: {
        capturedAt: now,
        appVersion: '0.1.0',
        platform: 'darwin',
        route: 'chat',
        viewport: { width: 1280, height: 800, scaleFactor: 2 },
        targetLabel: 'Export result',
        targetBounds: { x: 10, y: 20, width: 80, height: 30 },
        fullWindowScreenshot: asset,
        focusedScreenshot: asset
      },
      messages: [{
        id: 'message-1',
        authorKind: 'user',
        body: 'Clicking this does nothing.',
        createdAt: now,
        updatedAt: now
      }],
      status: 'open',
      anchorResolution: 'resolved',
      feedback: { state: 'local' },
      createdAt: now,
      updatedAt: now
    })
    const submitFeedback = vi.fn(async (_request: FeedbackSubmissionRequest) => ({
      ok: true as const,
      result: {
        schemaVersion: 1 as const,
        idempotencyKey: 'sciforge-feedback-feedback-thread-1',
        issueNumber: 42,
        issueUrl: 'https://github.com/XingYu-Zhong/SciForge/issues/42',
        assetUrls: ['https://assets.example/feedback.png'],
        createdAt: now
      }
    }))
    vi.stubGlobal('window', {
      sciforge: {
        anchoredComments: {
          get: async () => thread,
          submitFeedback
        }
      }
    })

    await expect(submitAnchoredCommentFeedback(
      thread.id,
      { ...DEFAULT_FEEDBACK_DISCLOSURE_CHOICES }
    )).resolves.toMatchObject({ ok: true })

    expect(submitFeedback).toHaveBeenCalledTimes(1)
    const packet = submitFeedback.mock.calls[0]?.[0].packet
    expect(packet.repository).toEqual({ owner: 'XingYu-Zhong', name: 'SciForge' })
    expect(packet.title).toContain('Export result')
    expect(packet.body).toContain('Clicking this does nothing.')
    expect(packet.screenshots?.map((screenshot) => screenshot.kind)).toEqual(['focused', 'full_window'])
    expect(packet.logs).toBeUndefined()
    expect(packet.conversationExcerpt).toBeUndefined()
    expect(JSON.parse(threadViewFromPersisted(thread).target.selection ?? '{}')).toEqual({
      kind: 'text',
      text: 'Export result',
      startOffset: 0,
      endOffset: 13
    })
  })
})
