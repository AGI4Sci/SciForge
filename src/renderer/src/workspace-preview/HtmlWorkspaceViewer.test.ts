import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  WORKSPACE_PREVIEW_CONTRACT_VERSION,
  type WorkspaceObservation
} from '@shared/workspace-preview'
import {
  HtmlWorkspaceViewer,
  buildHtmlWorkspaceViewerModel,
  htmlPreviewUrlStateFromActionResult
} from './HtmlWorkspaceViewer'

function createHtmlObservation(
  overrides: Partial<WorkspaceObservation> = {}
): WorkspaceObservation {
  return {
    schemaVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
    file: {
      path: '/workspace/lab/report.html',
      workspaceRoot: '/workspace/lab',
      mimeType: 'text/html',
      size: 48
    },
    view: {
      pluginId: 'html',
      modality: 'document',
      mode: 'preview',
      title: 'report.html'
    },
    visibleText: '<main><h1>Alpha</h1><p>beta</p></main>',
    text: {
      lineCount: 1,
      characterCount: 39,
      truncated: false
    },
    actions: ['observe', 'workspace.setSelection', 'text.replaceRange', 'applyEdit', 'save'],
    ...overrides
  }
}

describe('HtmlWorkspaceViewer', () => {
  it('builds an editable HTML model from bounded source text', () => {
    const model = buildHtmlWorkspaceViewerModel(createHtmlObservation(), true)

    expect(model.status).toBe('ready')
    expect(model.title).toBe('report.html')
    expect(model.html).toContain('<h1>Alpha</h1>')
    expect(model.editable).toBe(true)
    expect(model.summary).toContain('1 line')
  })

  it('renders preview-only mode by default with sandboxed URL iframe controls', () => {
    const html = renderToStaticMarkup(createElement(HtmlWorkspaceViewer, {
      observation: createHtmlObservation(),
      onApplyEdit: () => undefined,
      initialZoom: 1.2,
      onOpenPreviewExternal: () => undefined,
      previewUrlState: {
        ok: true,
        url: 'http://127.0.0.1:5179/token/report.html?sciforge_preview=1',
        size: 39,
        mtimeMs: 1
      }
    }))

    expect(html).toContain('data-workspace-preview-html-viewer')
    expect(html).toContain('data-editable="true"')
    expect(html).toContain('data-html-view-mode="preview"')
    expect(html).not.toContain('data-text-preview-editor')
    expect(html).toContain('data-html-preview-pane')
    expect(html).toContain('data-html-preview-mode="url"')
    expect(html).toContain('data-html-preview-toolbar')
    expect(html).toContain('data-html-open-external')
    expect(html).toContain('data-html-preview-zoom')
    expect(html).toContain('120%')
    expect(html).toContain('sandbox=""')
    expect(html).toContain('src="http://127.0.0.1:5179/token/report.html?sciforge_preview=1"')
    expect(html).not.toContain('srcDoc=')
  })

  it('keeps source editing available through split mode without adding a route branch', () => {
    const html = renderToStaticMarkup(createElement(HtmlWorkspaceViewer, {
      observation: createHtmlObservation(),
      onApplyEdit: () => undefined,
      initialMode: 'split',
      previewUrlState: {
        ok: true,
        url: 'http://127.0.0.1:5179/token/report.html?sciforge_preview=1'
      }
    }))

    expect(html).toContain('data-html-view-mode="split"')
    expect(html).toContain('data-html-mode-control')
    expect(html).toContain('data-html-mode-button="source"')
    expect(html).toContain('data-text-preview-editor')
    expect(html).toContain('data-html-preview-pane')
  })

  it('parses host action results into sanitized preview URL state', () => {
    expect(htmlPreviewUrlStateFromActionResult({
      ok: true,
      result: {
        url: 'http://127.0.0.1:5179/token/report.html?sciforge_preview=1',
        size: 39,
        mtimeMs: 1
      }
    })).toEqual({
      ok: true,
      url: 'http://127.0.0.1:5179/token/report.html?sciforge_preview=1',
      size: 39,
      mtimeMs: 1
    })

    expect(htmlPreviewUrlStateFromActionResult({
      ok: true,
      result: {
        path: '/workspace/lab/report.html'
      }
    })).toEqual({
      ok: false,
      message: 'HTML preview action did not return a preview URL.'
    })
  })

  it('rejects non-HTML observations without opening a side route', () => {
    const html = renderToStaticMarkup(createElement(HtmlWorkspaceViewer, {
      observation: createHtmlObservation({
        file: {
          path: '/workspace/lab/notes.md',
          workspaceRoot: '/workspace/lab',
          mimeType: 'text/markdown'
        },
        view: {
          pluginId: 'markdown',
          modality: 'document',
          mode: 'preview',
          title: 'notes.md'
        }
      })
    }))

    expect(html).toContain('data-status="unsupported"')
    expect(html).toContain('Unsupported observation')
    expect(html).not.toContain('data-html-preview-pane')
  })
})
