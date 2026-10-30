import { describe, expect, it, vi } from 'vitest'
import type { AnchoredCommentThread, ProductFeedbackPacket } from '../contract'
import { AnchoredCommentFeedbackService } from './feedback-service'

const now = '2026-07-11T03:00:00.000Z'
const screenshotAsset = {
  digest: 'a'.repeat(64),
  mimeType: 'image/png' as const,
  byteLength: 8,
  width: 100,
  height: 60
}

function thread(): AnchoredCommentThread {
  return {
    schemaVersion: 1,
    id: 'thread-1',
    workspaceKey: 'workspace-1',
    purpose: 'product_feedback',
    anchor: {
      targetKey: 'ui:export',
      targetLabel: 'Export button',
      canonical: { kind: 'ui', componentId: 'toolbar', elementId: 'export' },
      bounds: { x: 1, y: 1, width: 20, height: 10 }
    },
    capture: {
      capturedAt: now,
      appVersion: '1.2.3',
      platform: 'test',
      viewport: { width: 100, height: 60, scaleFactor: 1 },
      targetLabel: 'Export button',
      targetBounds: { x: 1, y: 1, width: 20, height: 10 },
      fullWindowScreenshot: screenshotAsset,
      focusedScreenshot: screenshotAsset
    },
    messages: [{ id: 'message-1', authorKind: 'user', body: 'Broken', createdAt: now, updatedAt: now }],
    status: 'open',
    anchorResolution: 'resolved',
    feedback: { state: 'local' },
    createdAt: now,
    updatedAt: now
  }
}

function packet(): ProductFeedbackPacket {
  return {
    schemaVersion: 1,
    idempotencyKey: 'feedback:thread-1234567890',
    threadId: 'thread-1',
    repository: { owner: 'sciforge', name: 'sciforge' },
    title: 'Export is broken',
    body: 'The export button does not respond.',
    disclosure: {
      annotatedScreenshots: true,
      applicationEnvironment: false,
      logs: false,
      conversationExcerpt: false,
      workspacePaths: false,
      fileMetadata: false
    },
    screenshots: [{
      kind: 'full_window',
      asset: screenshotAsset,
      dataBase64: 'renderer-must-not-control-this'
    }]
  }
}

describe('AnchoredCommentFeedbackService', () => {
  it('hydrates approved screenshots from integrity-checked local assets and tracks submission', async () => {
    let current = thread()
    const upsertThread = vi.fn(async (next: AnchoredCommentThread) => {
      current = structuredClone(next)
      return next
    })
    const gateway = {
      submit: vi.fn(async (submitted: ProductFeedbackPacket) => ({
        ok: true as const,
        result: {
          schemaVersion: 1 as const,
          idempotencyKey: submitted.idempotencyKey,
          issueNumber: 42,
          issueUrl: 'https://github.com/sciforge/sciforge/issues/42',
          author: 'octocat',
          assetUrls: ['https://assets.sciforge.test/full.png'],
          createdAt: now
        }
      }))
    }
    const service = new AnchoredCommentFeedbackService({
      comments: {
        getThread: async () => structuredClone(current),
        upsertThread,
        readScreenshotAsset: async () => Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])
      },
      gateway,
      now: () => new Date(now)
    })

    await expect(service.submit({ packet: packet() })).resolves.toMatchObject({
      ok: true,
      result: { issueNumber: 42 }
    })
    expect(gateway.submit).toHaveBeenCalledWith(expect.objectContaining({
      screenshots: [{
        kind: 'full_window',
        asset: screenshotAsset,
        dataBase64: 'iVBORw0KGgo='
      }]
    }))
    expect(current.feedback).toMatchObject({
      state: 'submitted',
      idempotencyKey: packet().idempotencyKey,
      issue: { issueNumber: 42 }
    })
    expect(upsertThread).toHaveBeenCalledTimes(2)
  })

  it('returns an existing Issue for an idempotent local retry without calling the gateway', async () => {
    const current = thread()
    current.feedback = {
      state: 'submitted',
      idempotencyKey: packet().idempotencyKey,
      issue: {
        issueNumber: 7,
        issueUrl: 'https://github.com/sciforge/sciforge/issues/7',
        assetUrls: [],
        submittedAt: now
      }
    }
    const gateway = { submit: vi.fn() }
    const service = new AnchoredCommentFeedbackService({
      comments: {
        getThread: async () => current,
        upsertThread: vi.fn(),
        readScreenshotAsset: vi.fn()
      },
      gateway
    })

    await expect(service.submit({ packet: packet() })).resolves.toMatchObject({
      ok: true,
      result: { issueNumber: 7 }
    })
    expect(gateway.submit).not.toHaveBeenCalled()
  })
})
