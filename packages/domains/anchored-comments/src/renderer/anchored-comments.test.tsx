import { afterEach, describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { useAnchoredCommentStore } from './anchored-comment-store'
import { ProductFeedbackDialog } from './ProductFeedbackDialog'
import {
  commentTargetFromInspection,
  commentTargetFromTextSelection
} from './registered-target'

afterEach(() => {
  useAnchoredCommentStore.setState({
    commentMode: false,
    threads: [],
    selectedForConversation: [],
    productFeedbackThreadId: null,
    panelOpen: false
  })
})

describe('Anchored Comments renderer state', () => {
  it('keeps explicitly attached threads selected for the send-time context provider', () => {
    const thread = useAnchoredCommentStore.getState().addThread({
      kind: 'research',
      target: {
        targetRef: 'workbench.figure-2',
        label: 'Figure 2',
        route: '/session/1',
        bounds: { x: 10, y: 20, width: 300, height: 180 },
        componentId: 'workbench.preview',
        elementId: 'figure-2'
      },
      comment: 'Check the axis label.'
    })
    useAnchoredCommentStore.getState().toggleConversationSelection(thread.id)

    expect(useAnchoredCommentStore.getState().addSelectedToConversation())
      .toEqual([thread.id])
    expect(useAnchoredCommentStore.getState().selectedForConversation)
      .toEqual([thread.id])
    expect(useAnchoredCommentStore.getState().threads[0]?.status).toBe('attached')
  })

  it('renders the explicit disclosure review before public feedback submission', () => {
    const markup = renderToStaticMarkup(createElement(ProductFeedbackDialog, {
      thread: {
        id: 'comment-1',
        kind: 'product_feedback',
        target: {
          targetRef: 'workbench.export',
          label: 'Export button',
          route: '/session/1',
          bounds: { x: 1, y: 2, width: 30, height: 20 },
          componentId: 'workbench.toolbar',
          elementId: 'export'
        },
        comment: 'Export did not start.',
        createdAt: '2026-07-28T00:00:00.000Z',
        status: 'open',
        feedbackStatus: 'local'
      },
      onClose: () => undefined,
      onConfirm: () => undefined
    }))
    expect(markup).toContain('This feedback will be uploaded publicly.')
    expect(markup).toContain('Annotated screenshots')
  })
})

describe('registered visual target conversion', () => {
  it('accepts only Host-inspected selectable targets with measured bounds', () => {
    expect(commentTargetFromInspection({
      selectable: true,
      targetRef: 'vctx_target.host-signed-figure-reference',
      componentId: 'preview.figure',
      target: {
        id: 'figure-2',
        kind: 'region',
        contentType: 'image/png',
        metadata: {
          label: 'Figure 2',
          resourceKind: 'figure',
          resourceId: 'figure-2'
        }
      },
      bounds: { x: 12.2, y: 18.7, width: 200.4, height: 99.6 }
    }, '/session/1')).toMatchObject({
      targetRef: 'vctx_target.host-signed-figure-reference',
      label: 'Figure 2',
      bounds: { x: 12, y: 19, width: 200, height: 100 },
      resourceType: 'figure',
      resourceId: 'figure-2'
    })
  })

  it('does not expose a redacted Host target', () => {
    expect(commentTargetFromInspection({
      selectable: false,
      reason: 'redacted'
    }, '/session/1')).toBeNull()
  })

  it('uses only Host-vetted text selections', () => {
    expect(commentTargetFromTextSelection({
      targetRef: 'vctx_target.host-signed-selection-reference',
      componentId: 'preview.document',
      target: { id: 'page-1', kind: 'document-page' },
      bounds: { x: 40, y: 80, width: 160, height: 20 },
      text: '  statistically significant  '
    }, '/session/1')).toMatchObject({
      targetRef: 'vctx_target.host-signed-selection-reference',
      label: 'Selected text: statistically significant',
      selection: JSON.stringify({
        kind: 'text',
        text: 'statistically significant'
      })
    })
  })
})
