import { describe, expect, it } from 'vitest'
import {
  ANCHORED_COMMENT_SCHEMA_VERSION,
  DEFAULT_FEEDBACK_DISCLOSURE_CHOICES,
  anchoredCommentThreadSchema,
  buildAnchoredCommentContextReferences,
  migrateAnchoredCommentStore,
  productFeedbackPacketSchema,
  renderAnchoredCommentContext,
  type AnchoredCommentThread
} from './contract'

function thread(overrides: Partial<AnchoredCommentThread> = {}): AnchoredCommentThread {
  return {
    schemaVersion: ANCHORED_COMMENT_SCHEMA_VERSION,
    id: 'comment-1',
    workspaceKey: '/workspace/example',
    purpose: 'research',
    anchor: {
      targetKey: 'paper:figure-2:series-control',
      targetLabel: 'Figure 2 control series',
      canonical: {
        kind: 'research',
        resourceKind: 'figure',
        resourceId: 'figure-2',
        selection: { series: 'control', point: 3 }
      },
      domFingerprint: {
        tagName: 'svg',
        accessibleName: 'Figure 2'
      },
      bounds: { x: 10, y: 20, width: 300, height: 180 }
    },
    capture: {
      capturedAt: '2026-07-11T00:00:00.000Z',
      appVersion: '0.1.0',
      platform: 'darwin',
      route: '/workspace',
      viewport: { width: 1440, height: 900, scaleFactor: 2 },
      targetLabel: 'Figure 2 control series',
      targetBounds: { x: 10, y: 20, width: 300, height: 180 },
      unavailableReason: 'Capture was disabled in this test.'
    },
    messages: [{
      id: 'message-1',
      authorKind: 'user',
      body: 'The baseline looks shifted.',
      createdAt: '2026-07-11T00:00:01.000Z',
      updatedAt: '2026-07-11T00:00:01.000Z'
    }],
    status: 'open',
    anchorResolution: 'resolved',
    feedback: { state: 'local' },
    createdAt: '2026-07-11T00:00:00.000Z',
    updatedAt: '2026-07-11T00:00:01.000Z',
    ...overrides
  }
}

describe('anchored comment contracts', () => {
  it('validates a semantic anchor with DOM and visual recovery hints', () => {
    expect(anchoredCommentThreadSchema.parse(thread())).toMatchObject({
      anchor: {
        canonical: { kind: 'research', resourceId: 'figure-2' },
        domFingerprint: { tagName: 'svg' },
        bounds: { width: 300 }
      }
    })
  })

  it('preserves text selections on UI and visual anchors', () => {
    const selection = {
      kind: 'text',
      text: 'selected UI copy',
      startOffset: 2,
      endOffset: 18
    }
    const uiThread = thread({
      anchor: {
        ...thread().anchor,
        canonical: {
          kind: 'ui',
          componentId: 'result-card',
          elementId: 'summary',
          route: 'chat',
          selection
        }
      }
    })
    const visualThread = thread({
      anchor: {
        ...thread().anchor,
        canonical: { kind: 'visual', route: 'chat', selection }
      }
    })

    expect(anchoredCommentThreadSchema.parse(uiThread).anchor.canonical).toMatchObject({ selection })
    expect(anchoredCommentThreadSchema.parse(visualThread).anchor.canonical).toMatchObject({ selection })
  })

  it('uses privacy-safe product feedback disclosure defaults', () => {
    expect(DEFAULT_FEEDBACK_DISCLOSURE_CHOICES).toEqual({
      annotatedScreenshots: true,
      applicationEnvironment: true,
      logs: false,
      conversationExcerpt: false,
      workspacePaths: false,
      fileMetadata: false
    })
  })

  it('rejects feedback fields that the user did not approve', () => {
    const result = productFeedbackPacketSchema.safeParse({
      schemaVersion: ANCHORED_COMMENT_SCHEMA_VERSION,
      idempotencyKey: 'feedback-key-0001',
      threadId: 'comment-1',
      repository: { owner: 'sciforge', name: 'sciforge' },
      title: 'Export button is unresponsive',
      body: 'The export button did not respond.',
      disclosure: DEFAULT_FEEDBACK_DISCLOSURE_CHOICES,
      logs: 'secret log text'
    })
    expect(result.success).toBe(false)
  })

  it('migrates a sparse version-zero store to the current schema', () => {
    const legacy = thread()
    const migrated = migrateAnchoredCommentStore({
      comments: [{
        ...legacy,
        schemaVersion: 0,
        purpose: undefined,
        status: undefined,
        anchorResolution: undefined,
        feedback: undefined
      }]
    })
    expect(migrated).toMatchObject({
      schemaVersion: ANCHORED_COMMENT_SCHEMA_VERSION,
      threads: [{
        purpose: 'research',
        status: 'open',
        anchorResolution: 'resolved',
        feedback: { state: 'local' }
      }]
    })
  })

  it('builds context only for explicitly selected comments and keeps it bounded', () => {
    const first = thread({
      messages: Array.from({ length: 10 }, (_, index) => ({
        id: `message-${index}`,
        authorKind: 'user' as const,
        body: `message ${index} ${'x'.repeat(100)}`,
        createdAt: `2026-07-11T00:00:${String(index).padStart(2, '0')}.000Z`,
        updatedAt: `2026-07-11T00:00:${String(index).padStart(2, '0')}.000Z`
      }))
    })
    const unrelated = thread({ id: 'comment-2' })
    const references = buildAnchoredCommentContextReferences(
      [first, unrelated],
      ['comment-1'],
      { maxMessagesPerThread: 2, maxBodyCharsPerMessage: 24, attachedAt: '2026-07-11T01:00:00.000Z' }
    )

    expect(references).toHaveLength(1)
    expect(references[0]?.threadId).toBe('comment-1')
    expect(references[0]?.comments.map((comment) => comment.messageId)).toEqual(['message-8', 'message-9'])
    expect(references[0]?.comments.every((comment) => comment.body.length <= 24)).toBe(true)

    const rendered = renderAnchoredCommentContext(references, { maxChars: 1_200 })
    expect(rendered).toContain('Explicitly attached SciForge comments')
    expect(rendered).toContain('comment-1')
    expect(rendered).not.toContain('comment-2')
    expect(rendered.length).toBeLessThanOrEqual(1_200)
  })
})
