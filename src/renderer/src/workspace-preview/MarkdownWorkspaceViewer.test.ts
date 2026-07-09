import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  WORKSPACE_PREVIEW_CONTRACT_VERSION,
  type WorkspaceObservation
} from '@shared/workspace-preview'
import {
  MarkdownWorkspaceViewer,
  buildMarkdownWorkspaceViewerModel,
  createMarkdownReplaceAllOperation
} from './MarkdownWorkspaceViewer'

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
    expect(model.title).toBe('notes.md')
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

  it('renders source editor and hardened Markdown preview panes', () => {
    const html = renderToStaticMarkup(createElement(MarkdownWorkspaceViewer, {
      observation: createMarkdownObservation(),
      onApplyEdit: () => undefined
    }))

    expect(html).toContain('data-workspace-preview-markdown-viewer')
    expect(html).toContain('overflow-hidden')
    expect(html).toContain('data-editable="true"')
    expect(html).toContain('data-text-preview-editor')
    expect(html).not.toContain('data-text-agent-summary')
    expect(html).toContain('data-markdown-preview-pane')
    expect(html).toContain('overflow-auto')
    expect(html.split('notes.md').length - 1).toBe(1)
    expect(html).toContain('<h1>Alpha</h1>')
    expect(html).toContain('<li>beta</li>')
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
