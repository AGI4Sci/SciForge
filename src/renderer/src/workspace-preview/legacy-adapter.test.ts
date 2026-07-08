import { describe, expect, it } from 'vitest'
import type {
  WorkspaceFileReadDocxResult,
  WorkspaceFileReadPdfResult,
  WorkspaceFileReadTextResult,
  WorkspaceHtmlPreviewResult,
  WorkspaceImageReadResult
} from '@shared/workspace-file'
import { workspaceObservationSchema } from '@shared/workspace-preview'
import { createLegacyWorkspaceObservation } from './legacy-adapter'

const WORKSPACE_ROOT = '/workspace/lab'

describe('legacy workspace preview adapter', () => {
  it('maps editable text previews to text observations with cursor selection', () => {
    const result: WorkspaceFileReadTextResult = {
      ok: true,
      kind: 'text',
      path: '/workspace/lab/notes/todo.txt',
      content: 'hello\nworld\n',
      mimeType: 'text/plain',
      size: 12,
      truncated: false,
      line: 2,
      column: 3
    }

    const observation = workspaceObservationSchema.parse(createLegacyWorkspaceObservation({
      result,
      workspaceRoot: WORKSPACE_ROOT
    }))

    expect(observation).toMatchObject({
      file: {
        path: '/workspace/lab/notes/todo.txt',
        workspaceRoot: WORKSPACE_ROOT,
        mimeType: 'text/plain',
        size: 12
      },
      view: {
        pluginId: 'text',
        modality: 'text',
        title: 'todo.txt'
      },
      visibleText: 'hello\nworld\n',
      selection: {
        kind: 'text',
        ranges: [{ startLine: 2, startColumn: 3, endLine: 2, endColumn: 3 }]
      },
      actions: expect.arrayContaining(['observe', 'select', 'applyEdit', 'save'])
    })
  })

  it('routes markdown text previews through the markdown plugin identity', () => {
    const result: WorkspaceFileReadTextResult = {
      ok: true,
      kind: 'text',
      path: '/workspace/lab/docs/readme.md',
      content: '# Readme',
      mimeType: 'text/markdown',
      size: 8,
      truncated: false
    }

    expect(createLegacyWorkspaceObservation({ result, workspaceRoot: WORKSPACE_ROOT })).toMatchObject({
      view: {
        pluginId: 'markdown',
        modality: 'document',
        title: 'readme.md'
      },
      actions: expect.arrayContaining(['export:html'])
    })
  })

  it('maps DOCX previews to document observations with paragraph outline and annotation action', () => {
    const result: WorkspaceFileReadDocxResult = {
      ok: true,
      kind: 'docx',
      path: '/workspace/lab/reports/paper.docx',
      content: 'Title\nBody',
      paragraphs: [
        { id: 'p1', index: 0, text: 'Title', style: 'Heading 1' },
        { id: 'p2', index: 1, text: 'Body paragraph' }
      ],
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      size: 128,
      truncated: false,
      mtimeMs: 1783468800000
    }

    const observation = createLegacyWorkspaceObservation({ result, workspaceRoot: WORKSPACE_ROOT })

    expect(observation).toMatchObject({
      view: {
        pluginId: 'docx',
        modality: 'document'
      },
      outline: [
        { id: 'p1', title: 'Title', level: 1 },
        { id: 'p2', title: 'Body paragraph' }
      ],
      actions: expect.arrayContaining(['observe', 'select', 'annotation.upsert'])
    })
  })

  it('keeps bounded annotation summaries and document selection overrides', () => {
    const result: WorkspaceFileReadPdfResult = {
      ok: true,
      kind: 'pdf',
      path: '/workspace/lab/papers/study.pdf',
      content: '',
      dataBase64: 'JVBERi0xLjQ=',
      mimeType: 'application/pdf',
      size: 4096,
      truncated: false,
      mtimeMs: 1783468800000
    }

    const observation = createLegacyWorkspaceObservation({
      result,
      workspaceRoot: WORKSPACE_ROOT,
      annotations: [{
        id: 'thread-1',
        kind: 'comment',
        summary: 'open | page 2 | Check the methods paragraph.'
      }],
      selectionOverride: {
        kind: 'document',
        anchors: [{
          id: 'anchor-1',
          page: 2,
          quote: 'Methods paragraph'
        }]
      }
    })

    expect(observation).toMatchObject({
      view: {
        pluginId: 'pdf',
        modality: 'document'
      },
      selection: {
        kind: 'document',
        anchors: [{ id: 'anchor-1', page: 2, quote: 'Methods paragraph' }]
      },
      annotations: [{
        id: 'thread-1',
        kind: 'comment',
        summary: 'open | page 2 | Check the methods paragraph.'
      }]
    })
    expect(observation).not.toHaveProperty('dataBase64')
  })

  it('maps image and served HTML previews without embedding large payloads in visible text', () => {
    const image: Extract<WorkspaceImageReadResult, { ok: true }> = {
      ok: true,
      path: '/workspace/lab/figures/cells.png',
      dataUrl: 'data:image/png;base64,aW1n',
      mimeType: 'image/png',
      size: 3
    }
    const html: Extract<WorkspaceHtmlPreviewResult, { ok: true }> = {
      ok: true,
      path: '/workspace/lab/site/index.html',
      workspaceRoot: WORKSPACE_ROOT,
      url: 'http://localhost:5173/__workspace-html/index.html',
      size: 256,
      mtimeMs: 1783468800000
    }

    const imageObservation = createLegacyWorkspaceObservation({ result: image, workspaceRoot: WORKSPACE_ROOT })
    expect(imageObservation).toMatchObject({
      view: { pluginId: 'image', modality: 'image' },
      actions: ['observe']
    })
    expect(imageObservation).not.toHaveProperty('visibleText')
    expect(createLegacyWorkspaceObservation({ result: html, workspaceRoot: WORKSPACE_ROOT })).toMatchObject({
      view: { pluginId: 'html', modality: 'document' },
      visibleText: 'HTML preview URL: http://localhost:5173/__workspace-html/index.html'
    })
  })

  it('ignores failed legacy preview results', () => {
    expect(createLegacyWorkspaceObservation({
      result: { ok: false, message: 'nope' },
      workspaceRoot: WORKSPACE_ROOT
    })).toBeNull()
  })
})
