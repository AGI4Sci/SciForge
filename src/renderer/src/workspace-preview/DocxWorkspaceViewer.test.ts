import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  WORKSPACE_PREVIEW_CONTRACT_VERSION,
  type WorkspaceObservation
} from '@shared/workspace-preview'

vi.mock('../components/write/WriteDocxViewer', () => ({
  WriteDocxViewer: (props: {
    filePath: string
    documentContentKey?: string
    paragraphs: Array<{ index: number; text: string }>
    content: string
    workspaceRoot: string
    onAnnotationAction?: unknown
    annotationOverlays?: unknown[]
    activeAnnotationId?: string | null
    onAnnotationSelect?: unknown
    annotationsOpen?: boolean
    onToggleAnnotations?: unknown
  }) => createElement('div', {
    'data-write-docx-viewer': 'true',
    'data-file-path': props.filePath,
    'data-document-content-key': props.documentContentKey,
    'data-workspace-root': props.workspaceRoot,
    'data-paragraph-count': props.paragraphs.length,
    'data-content': props.content,
    'data-has-annotation-action': props.onAnnotationAction ? 'true' : 'false',
    'data-annotation-overlay-count': props.annotationOverlays?.length ?? 0,
    'data-active-annotation-id': props.activeAnnotationId ?? '',
    'data-has-annotation-select': props.onAnnotationSelect ? 'true' : 'false',
    'data-annotations-open': props.annotationsOpen ? 'true' : 'false',
    'data-has-toggle-annotations': props.onToggleAnnotations ? 'true' : 'false'
  })
}))

import {
  DocxWorkspaceViewer,
  buildDocxWorkspaceViewerModel,
  saveDocxWorkspaceParagraphs
} from './DocxWorkspaceViewer'

function createDocxObservation(
  overrides: Partial<WorkspaceObservation> = {}
): WorkspaceObservation {
  return {
    schemaVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
    file: {
      path: '/workspace/lab/report.docx',
      workspaceRoot: '/workspace/lab',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      size: 1024,
      mtimeMs: 42
    },
    view: {
      pluginId: 'docx',
      modality: 'document',
      mode: 'preview',
      title: 'report.docx'
    },
    visibleText: 'Title\n\nBody paragraph',
    document: {
      paragraphs: [
        { id: 'docx-p-1', index: 1, text: 'Title', style: 'Heading1' },
        { id: 'docx-p-2', index: 2, text: 'Body paragraph' }
      ],
      truncatedParagraphs: false
    },
    actions: ['observe', 'document.updateParagraph'],
    ...overrides
  }
}

describe('DocxWorkspaceViewer', () => {
  it('renders bounded DOCX paragraphs from workspace observations', () => {
    const observation = createDocxObservation()
    const model = buildDocxWorkspaceViewerModel(observation)
    const html = renderToStaticMarkup(createElement(DocxWorkspaceViewer, {
      observation,
      documentContentKey: 'docx-content-revision'
    }))

    expect(model).toMatchObject({
      status: 'ready',
      paragraphs: [
        { id: 'docx-p-1', index: 1, text: 'Title', style: 'Heading1' },
        { id: 'docx-p-2', index: 2, text: 'Body paragraph' }
      ],
      content: 'Title\n\nBody paragraph'
    })
    expect(html).toContain('data-workspace-preview-docx-viewer')
    expect(html).toContain('data-write-docx-viewer="true"')
    expect(html).toContain('data-paragraph-count="2"')
    expect(html).toContain('data-document-content-key="docx-content-revision"')
  })

  it('enables DOCX annotation actions when the shell provides applyEdit', () => {
    const html = renderToStaticMarkup(createElement(DocxWorkspaceViewer, {
      observation: createDocxObservation(),
      onApplyEdit: vi.fn(async () => undefined),
      annotationOverlays: [{
        id: 'thread-1',
        kind: 'comment',
        quote: 'Body paragraph',
        status: 'open'
      }],
      activeAnnotationId: 'thread-1',
      onAnnotationSelect: vi.fn(),
      annotationsOpen: true,
      onToggleAnnotations: vi.fn()
    }))

    expect(html).toContain('data-write-docx-viewer="true"')
    expect(html).toContain('data-has-annotation-action="true"')
    expect(html).toContain('data-annotation-overlay-count="1"')
    expect(html).toContain('data-active-annotation-id="thread-1"')
    expect(html).toContain('data-has-annotation-select="true"')
    expect(html).toContain('data-annotations-open="true"')
    expect(html).toContain('data-has-toggle-annotations="true"')
  })

  it('saves paragraph changes through document.updateParagraph operations', async () => {
    const observation = createDocxObservation()
    const onApplyEdit = vi.fn(async () => undefined)

    const result = await saveDocxWorkspaceParagraphs({
      observation,
      paragraphs: [
        { index: 2, text: 'Updated body' },
        { index: 1, text: 'Updated title' }
      ],
      onApplyEdit
    })

    expect(result).toMatchObject({
      ok: true,
      path: '/workspace/lab/report.docx',
      paragraphCount: 2
    })
    expect(onApplyEdit).toHaveBeenNthCalledWith(1, {
      kind: 'document.updateParagraph',
      path: '/workspace/lab/report.docx',
      paragraphIndex: 2,
      text: 'Updated body'
    })
    expect(onApplyEdit).toHaveBeenNthCalledWith(2, {
      kind: 'document.updateParagraph',
      path: '/workspace/lab/report.docx',
      paragraphIndex: 1,
      text: 'Updated title'
    })
  })
})
