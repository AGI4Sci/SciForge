import { describe, expect, it, vi } from 'vitest'
import type { DomainRendererCapabilityInvoker } from '@sciforge/domain-sdk/host'
import {
  anchoredCommentThreadSchema,
  DEFAULT_FEEDBACK_DISCLOSURE_CHOICES,
  type AnchoredCommentThread
} from '../contract'
import {
  createAnchoredCommentsCapabilityClient,
  submitAnchoredCommentFeedback,
  threadViewFromPersisted
} from './renderer-bridge'

const now = '2026-07-28T00:00:00.000Z'

function thread(): AnchoredCommentThread {
  return anchoredCommentThreadSchema.parse({
    schemaVersion: 1,
    id: 'thread-1',
    workspaceKey: '/workspace',
    purpose: 'product_feedback',
    anchor: {
      targetKey: 'workbench.toolbar:export',
      targetLabel: 'Export button',
      canonical: {
        kind: 'ui',
        componentId: 'workbench.toolbar',
        elementId: 'export'
      },
      bounds: { x: 1, y: 2, width: 30, height: 20 }
    },
    capture: {
      capturedAt: now,
      appVersion: '1.0.0',
      platform: 'test',
      viewport: { width: 100, height: 100, scaleFactor: 1 },
      targetLabel: 'Export button',
      targetBounds: { x: 1, y: 2, width: 30, height: 20 },
      unavailableReason: 'test'
    },
    messages: [{
      id: 'message-1',
      authorKind: 'user',
      body: 'Export failed.',
      createdAt: now,
      updatedAt: now
    }],
    status: 'open',
    anchorResolution: 'resolved',
    feedback: { state: 'local' },
    createdAt: now,
    updatedAt: now
  })
}

describe('Anchored Comments capability bridge', () => {
  it('reconstructs a registered target reference from persisted canonical data', () => {
    expect(threadViewFromPersisted(thread()).target).toMatchObject({
      targetRef: 'workbench.toolbar:export',
      componentId: 'workbench.toolbar',
      elementId: 'export'
    })
  })

  it('submits product feedback only through the capability invoker', async () => {
    const invoke = vi.fn(async (contract: { actionId: string }) => {
      if (contract.actionId === 'anchored-comments.get') {
        return { thread: thread() }
      }
      if (contract.actionId === 'anchored-comments.feedback.submit') {
        return {
          ok: false,
          message: 'gateway unavailable',
          retryable: false
        }
      }
      throw new Error(`Unexpected action ${contract.actionId}`)
    })
    const client = createAnchoredCommentsCapabilityClient({
      invoke
    } as unknown as DomainRendererCapabilityInvoker)

    await expect(submitAnchoredCommentFeedback(
      client,
      'thread-1',
      DEFAULT_FEEDBACK_DISCLOSURE_CHOICES
    )).resolves.toMatchObject({ ok: false, message: 'gateway unavailable' })
    expect(invoke.mock.calls.map(([contract]) => contract.actionId)).toEqual([
      'anchored-comments.get',
      'anchored-comments.feedback.submit'
    ])
  })
})
