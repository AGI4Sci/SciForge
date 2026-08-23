import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  WORKSPACE_PREVIEW_CONTRACT_VERSION,
  type WorkspaceObservation
} from '@shared/workspace-preview'
import {
  MarkdownWorkspaceViewer,
  buildMarkdownWechatCopyFeedbackModel,
  buildMarkdownWorkspaceViewerModel,
  createMarkdownAnnotationSelection,
  createMarkdownReplaceAllOperation,
  proportionalScrollTop
} from './MarkdownWorkspaceViewer'
import { createDocumentTextAnchor } from './dom-text-annotations'

function createMarkdownObservation(
  overrides: Partial<WorkspaceObservation> = {}
): WorkspaceObservation {
  return {
    schemaVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
    file: {
      path: '/workspace/lab/notes.md',
      workspaceRoot: '/workspace/lab',
      mimeType: 'text/markdown',
      size: 20
    },
    view: {
      pluginId: 'markdown',
      modality: 'document',
      mode: 'preview',
      title: 'notes.md'
    },
    visibleText: '# Alpha\n\n- beta\n',
    text: {
      lineCount: 3,
      characterCount: 16,
      truncated: false
    },
    actions: ['observe', 'workspace.setSelection', 'text.replaceRange', 'applyEdit', 'save'],
    ...overrides
  }
}

describe('MarkdownWorkspaceViewer', () => {
  it('builds an editable Markdown model from bounded source text', () => {
    const observation = createMarkdownObservation()
    const model = buildMarkdownWorkspaceViewerModel(observation, true)

    expect(model.status).toBe('ready')
    expect(model.title).toBe('/workspace/lab/notes.md')
    expect(model.subtitle).toBeUndefined()
    expect(model.markdown).toBe('# Alpha\n\n- beta\n')
    expect(model.editable).toBe(true)
    expect(model.summary).toContain('3 lines')
    expect(createMarkdownReplaceAllOperation({
      observation,
      beforeText: model.markdown,
      text: '# Alpha\n\n- gamma\n'
    })).toEqual({
      kind: 'text.replaceRange',
      path: '/workspace/lab/notes.md',
      range: {
        start: { line: 1, column: 1 },
        end: { line: 4, column: 1 }
      },
      text: '# Alpha\n\n- gamma\n'
    })
  })

  it('renders preview mode with a copyable absolute file path by default', () => {
    const html = renderToStaticMarkup(createElement(MarkdownWorkspaceViewer, {
      observation: createMarkdownObservation(),
      onApplyEdit: () => undefined
    }))

    expect(html).toContain('data-workspace-preview-markdown-viewer')
    expect(html).toContain('overflow-hidden')
    expect(html).toContain('data-editable="true"')
    expect(html).toContain('data-markdown-agent-summary')
    expect(html).toContain('data-markdown-view-mode="preview"')
    expect(html).toContain('data-markdown-mode-control')
    expect(html).toContain('data-markdown-mode-button="edit"')
    expect(html).toContain('data-markdown-mode-button="preview"')
    expect(html).toContain('data-markdown-mode-button="split"')
    expect(html).toContain('/workspace/lab/notes.md')
    expect(html).not.toContain('Markdown | Preview')
    expect(html).not.toContain('data-text-preview-editor')
    expect(html).toContain('data-markdown-preview-pane')
    expect(html).toContain('<h1>Alpha</h1>')
    expect(html).toContain('<li>beta</li>')
  })

  it('renders the WeChat copy action only when its callback is available', () => {
    const withoutAction = renderToStaticMarkup(createElement(MarkdownWorkspaceViewer, {
      observation: createMarkdownObservation()
    }))
    const withAction = renderToStaticMarkup(createElement(MarkdownWorkspaceViewer, {
      observation: createMarkdownObservation(),
      onCopyForWechat: async () => markdownWechatCopyResult()
    }))

    expect(withoutAction).not.toContain('data-markdown-copy-for-wechat')
    expect(withAction).toContain('data-markdown-copy-for-wechat')
    expect(withAction).toContain('data-state="idle"')
    expect(withAction).toContain('markdownWechatCopy')
  })

  it('disables WeChat copy for truncated Markdown observations', () => {
    const html = renderToStaticMarkup(createElement(MarkdownWorkspaceViewer, {
      observation: createMarkdownObservation({
        text: {
          lineCount: 3,
          characterCount: 200_001,
          truncated: true
        }
      }),
      onCopyForWechat: async () => markdownWechatCopyResult()
    }))

    expect(html).toContain('data-markdown-copy-for-wechat')
    expect(html).toContain('disabled=""')
    expect(html).toContain('markdownWechatCopyTruncated')
  })

  it('models idle, progress, success, warning, and error copy feedback', () => {
    expect(buildMarkdownWechatCopyFeedbackModel({ kind: 'idle' })).toEqual({
      phase: 'idle',
      warningCount: 0
    })
    expect(buildMarkdownWechatCopyFeedbackModel({ kind: 'copying' })).toEqual({
      phase: 'copying',
      warningCount: 0
    })
    expect(buildMarkdownWechatCopyFeedbackModel({
      kind: 'success',
      result: markdownWechatCopyResult()
    })).toEqual({
      phase: 'success',
      warningCount: 0
    })
    expect(buildMarkdownWechatCopyFeedbackModel({
      kind: 'success',
      result: markdownWechatCopyResult([{
        code: 'remote-image-preserved',
        message: 'A remote image URL was preserved.',
        index: 2
      }])
    })).toEqual({
      phase: 'warning',
      warningCount: 1
    })
    expect(buildMarkdownWechatCopyFeedbackModel({
      kind: 'error',
      message: 'Clipboard unavailable.'
    })).toEqual({
      phase: 'error',
      warningCount: 0
    })
  })

  it('can render edit-only mode', () => {
    const html = renderToStaticMarkup(createElement(MarkdownWorkspaceViewer, {
      observation: createMarkdownObservation(),
      onApplyEdit: () => undefined,
      initialMode: 'edit'
    }))

    expect(html).toContain('data-markdown-view-mode="edit"')
    expect(html).toContain('overflow-hidden')
    expect(html).toContain('data-text-preview-editor')
    expect(html).not.toContain('data-markdown-preview-pane')
  })

  it('opens the source editor when an initial one-based text anchor is present', () => {
    const html = renderToStaticMarkup(createElement(MarkdownWorkspaceViewer, {
      observation: createMarkdownObservation({
        selection: {
          kind: 'text',
          ranges: [{ startLine: 3, startColumn: 1, endLine: 3, endColumn: 7 }]
        }
      })
    }))

    expect(html).toContain('data-markdown-view-mode="edit"')
    expect(html).toContain('data-text-preview-editor')
    expect(html).toContain('data-initial-selection="true"')
  })

  it('can render preview-only mode', () => {
    const html = renderToStaticMarkup(createElement(MarkdownWorkspaceViewer, {
      observation: createMarkdownObservation(),
      initialMode: 'preview'
    }))

    expect(html).toContain('data-markdown-view-mode="preview"')
    expect(html).not.toContain('data-text-preview-editor')
    expect(html).toContain('data-markdown-preview-pane')
    expect(html).toContain('<h1>Alpha</h1>')
  })

  it('keeps document search available in edit, preview, and split modes', () => {
    for (const initialMode of ['edit', 'preview', 'split'] as const) {
      const html = renderToStaticMarkup(createElement(MarkdownWorkspaceViewer, {
        observation: createMarkdownObservation(),
        onApplyEdit: () => undefined,
        initialMode
      }))

      expect(html).toContain(`data-markdown-view-mode="${initialMode}"`)
      expect(html).toContain('data-markdown-search-toolbar')
      expect(html).toContain('data-markdown-search-input')
      expect(html).toContain('data-markdown-search-previous')
      expect(html).toContain('data-markdown-search-next')
    }
  })

  it('maps split-pane scrolling by bounded document progress', () => {
    expect(proportionalScrollTop({
      sourceScrollTop: 400,
      sourceScrollHeight: 1_000,
      sourceClientHeight: 200,
      targetScrollHeight: 2_000,
      targetClientHeight: 400
    })).toBe(800)
    expect(proportionalScrollTop({
      sourceScrollTop: 900,
      sourceScrollHeight: 1_000,
      sourceClientHeight: 200,
      targetScrollHeight: 2_000,
      targetClientHeight: 400
    })).toBe(1_600)
    expect(proportionalScrollTop({
      sourceScrollTop: 10,
      sourceScrollHeight: 100,
      sourceClientHeight: 100,
      targetScrollHeight: 1_000,
      targetClientHeight: 200
    })).toBe(0)
  })

  it('exposes the shared annotation surface in preview and split modes', () => {
    const annotationProps = {
      annotationOverlays: [{
        id: 'thread-1',
        kind: 'comment' as const,
        quote: 'beta',
        contextBefore: 'Alpha',
        status: 'open' as const
      }],
      activeAnnotationId: 'thread-1',
      onAnnotationAction: () => undefined,
      onAnnotationSelect: () => undefined,
      annotationsOpen: true,
      onToggleAnnotations: () => undefined,
      navigationRequest: {
        requestId: 'locate-1',
        threadId: 'thread-1',
        quote: 'beta',
        contextBefore: 'Alpha'
      }
    }
    const previewHtml = renderToStaticMarkup(createElement(MarkdownWorkspaceViewer, {
      observation: createMarkdownObservation(),
      initialMode: 'preview',
      ...annotationProps
    }))
    const splitHtml = renderToStaticMarkup(createElement(MarkdownWorkspaceViewer, {
      observation: createMarkdownObservation(),
      initialMode: 'split',
      ...annotationProps
    }))

    for (const html of [previewHtml, splitHtml]) {
      expect(html).toContain('data-markdown-annotation-actions="true"')
      expect(html).toContain('data-markdown-annotation-overlay-count="1"')
      expect(html).toContain('data-active-annotation-id="thread-1"')
      expect(html).toContain('data-markdown-annotation-text-root')
      expect(html).toContain('data-markdown-annotation-overlay-layer')
      expect(html).toContain('data-markdown-open-annotations')
      expect(html).toContain('aria-pressed="true"')
    }
  })

  it('builds Markdown-native selections with rendered offsets and quote context', () => {
    const text = 'Alpha beta cells gamma'
    const anchor = createDocumentTextAnchor(
      text,
      text.indexOf('beta'),
      text.indexOf('beta') + 'beta cells'.length
    )
    if (!anchor) throw new Error('Expected a Markdown text anchor.')

    expect(createMarkdownAnnotationSelection({
      anchor,
      filePath: '/workspace/lab/notes.md',
      mimeType: 'text/markdown',
      size: 24,
      mtimeMs: 42
    })).toEqual({
      text: 'beta cells',
      ranges: [{
        from: 6,
        to: 16,
        startLine: 1,
        startColumn: 7,
        endLine: 1,
        endColumn: 17,
        text: 'beta cells',
        charCount: 10
      }],
      charCount: 10,
      sourceKind: 'markdown',
      contextBefore: 'Alpha',
      contextAfter: 'gamma',
      rects: [],
      metadata: {
        sourceKind: 'markdown',
        filePath: '/workspace/lab/notes.md',
        sourceTitle: 'notes.md',
        mimeType: 'text/markdown',
        size: 24,
        mtimeMs: 42,
        rects: []
      }
    })
  })

  it('rejects non-Markdown observations without falling back to hardcoded rendering', () => {
    const html = renderToStaticMarkup(createElement(MarkdownWorkspaceViewer, {
      observation: createMarkdownObservation({
        file: {
          path: '/workspace/lab/table.csv',
          workspaceRoot: '/workspace/lab',
          mimeType: 'text/csv'
        },
        view: {
          pluginId: 'tabular',
          modality: 'tabular',
          mode: 'preview',
          title: 'table.csv'
        }
      })
    }))

    expect(html).toContain('data-status="unsupported"')
    expect(html).toContain('Unsupported observation')
    expect(html).not.toContain('data-markdown-preview-pane')
  })
})

function markdownWechatCopyResult(warnings: Array<{
  code: 'remote-image-preserved'
  message: string
  index?: number
}> = []) {
  return {
    copiedAt: '2026-07-30T09:00:00.000Z',
    outputBytes: 512,
    counts: {
      formulas: 2,
      inlineFormulas: 1,
      displayFormulas: 1,
      codeBlocks: 1,
      embeddedImages: 1,
      remoteImages: warnings.length
    },
    warnings,
    effect: 'clipboard-write' as const
  }
}
