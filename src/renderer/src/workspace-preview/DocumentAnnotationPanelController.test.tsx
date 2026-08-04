import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  WORKSPACE_PREVIEW_CONTRACT_VERSION,
  type WorkspaceObservation,
  type WorkspacePreviewEditOperation
} from '@shared/workspace-preview'
import type {
  PdfAnnotationSidecar
} from '@shared/pdf-annotations'
import {
  createWorkspacePreviewAssetTransportClient,
  createWorkspacePreviewHostState,
  type WorkspacePreviewHost
} from './host'
import type {
  WorkspacePreviewPanelShellContext
} from './WorkspacePreviewPanelShell'
import {
  DocumentAnnotationPanelController,
  documentAnnotationSideBlockText,
  fitDocumentAnnotationPanelWidth,
  type DocumentAnnotationPanelRenderInput
} from './DocumentAnnotationPanelController'

function createObservation(): WorkspaceObservation {
  return {
    schemaVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
    file: {
      path: '/workspace/lab/paper.pdf',
      workspaceRoot: '/workspace/lab',
      mimeType: 'application/pdf',
      size: 1024
    },
    view: {
      pluginId: 'pdf',
      modality: 'document',
      mode: 'preview',
      title: 'paper.pdf'
    },
    documentAnnotations: {
      threadCount: 0,
      annotationCount: 0,
      openThreadCount: 0,
      truncated: false,
      threads: []
    },
    actions: []
  }
}

function createSidecar(): PdfAnnotationSidecar {
  return {
    schemaVersion: 1,
    version: 1,
    manifest: {
      app: 'sciforge.pdf-annotations',
      schemaVersion: 1,
      sourcePdfName: 'paper.pdf',
      privacy: {
        explicitOnly: true,
        chatTranscriptEmbedded: false
      },
      contribution: {
        reviewableJson: true,
        mergeKey: 'threadId',
        conflictResolution: 'updatedAt'
      },
      createdAt: '2026-07-08T00:00:00.000Z',
      updatedAt: '2026-07-08T00:00:00.000Z'
    },
    pdfFingerprint: {
      sha256: 'sha256',
      size: 1024,
      fileName: 'paper.pdf'
    },
    anchors: [],
    annotations: [],
    threads: [],
    authors: [],
    updatedAt: '2026-07-08T00:00:00.000Z'
  }
}

function createContext(observation: WorkspaceObservation): WorkspacePreviewPanelShellContext {
  const host = {
    applyEdit: vi.fn(async (_operation: WorkspacePreviewEditOperation) => ({
      ok: true as const,
      session: {
        id: 'session-pdf',
        pluginId: 'pdf',
        workspaceRoot: '/workspace/lab',
        path: '/workspace/lab/paper.pdf',
        modality: 'document' as const,
        mode: 'preview' as const,
        openedAt: '2026-07-08T00:00:00.000Z',
        updatedAt: '2026-07-08T00:01:00.000Z'
      },
      operationKind: 'annotation.upsert',
      appliedAt: '2026-07-08T00:01:00.000Z',
      audit: {
        pluginId: 'pdf',
        path: '/workspace/lab/paper.pdf',
        operationKind: 'annotation.upsert',
        effect: 'sidecar-write' as const
      }
    })),
    observe: vi.fn(async () => ({
      ok: true as const,
      observation
    })),
    updateAnnotation: vi.fn(async () => ({
      ok: true as const,
      session: {
        id: 'session-pdf',
        pluginId: 'pdf',
        workspaceRoot: '/workspace/lab',
        path: '/workspace/lab/paper.pdf',
        modality: 'document' as const,
        mode: 'preview' as const,
        openedAt: '2026-07-08T00:00:00.000Z',
        updatedAt: '2026-07-08T00:01:00.000Z'
      },
      operationKind: 'annotation.upsert' as const,
      appliedAt: '2026-07-08T00:01:00.000Z',
      audit: {
        pluginId: 'pdf',
        path: '/workspace/lab/paper.pdf',
        operationKind: 'annotation.upsert' as const,
        effect: 'sidecar-write' as const
      }
    })),
    listAnnotations: vi.fn(async () => ({
      ok: true as const,
      sidecar: createSidecar()
    })),
    readRange: vi.fn()
  } as unknown as WorkspacePreviewHost

  return {
    state: createWorkspacePreviewHostState({
      observation,
      session: {
        id: 'session-pdf',
        pluginId: 'pdf',
        workspaceRoot: '/workspace/lab',
        path: '/workspace/lab/paper.pdf',
        modality: 'document',
        mode: 'preview',
        openedAt: '2026-07-08T00:00:00.000Z',
        updatedAt: '2026-07-08T00:00:00.000Z'
      },
      capability: {
        resource: {
          token: `cap_${'a'.repeat(26)}`,
          semanticRevision: 'revision-1',
          expiresAt: '2026-07-08T01:00:00.000Z'
        },
        resourceRef: `res_${'b'.repeat(26)}`,
        operations: [{ id: 'workspace-preview.annotations.list' }]
      } as never
    }),
    asset: null,
    assetStatus: 'idle',
    assetError: null,
    transport: createWorkspacePreviewAssetTransportClient({
      descriptor: null,
      readRange: (range) => host.readRange(range)
    }),
    host,
    refresh: vi.fn(),
    refreshing: false
  }
}

function textEditOperation(): WorkspacePreviewEditOperation {
  return {
    kind: 'text.replaceRange',
    path: '/workspace/lab/notes.md',
    range: {
      start: { line: 1, column: 1 },
      end: { line: 1, column: 5 }
    },
    text: 'updated'
  }
}

describe('DocumentAnnotationPanelController', () => {
  it('keeps the resizable annotations panel readable without crowding a normal document viewport', () => {
    expect(fitDocumentAnnotationPanelWidth(1_200, 360)).toBe(360)
    expect(fitDocumentAnnotationPanelWidth(1_200, 900)).toBe(720)
    expect(fitDocumentAnnotationPanelWidth(800, 720)).toBe(473)
    expect(fitDocumentAnnotationPanelWidth(600, 100)).toBe(273)
    expect(fitDocumentAnnotationPanelWidth(200, 360)).toBe(193)
  })

  it('uses the user-visible side message instead of the internal runtime prompt', () => {
    expect(documentAnnotationSideBlockText({
      id: 'user-1',
      kind: 'user',
      text: 'Canonical visible state bound atomically for this turn: {"revision":87}\n\n用户问题',
      meta: { displayText: '用户问题' }
    })).toBe('用户问题')

    expect(documentAnnotationSideBlockText({
      id: 'assistant-1',
      kind: 'assistant',
      text: '  助手回答  ',
      meta: { displayText: '不应覆盖助手文本' }
    })).toBe('助手回答')
  })

  it('routes document annotation edits through the controller-owned sidecar flow', async () => {
    const observation = createObservation()
    const context = createContext(observation)
    let renderInput: DocumentAnnotationPanelRenderInput | null = null
    const operation: WorkspacePreviewEditOperation = {
      kind: 'annotation.upsert',
      path: '/workspace/lab/paper.pdf',
      annotationId: 'pdf-ann-1',
      annotationKind: 'comment',
      body: '',
      target: {
        documentKind: 'pdf',
        threadId: 'pdf-thread-1',
        anchor: {
          id: 'pdf-anchor-1',
          kind: 'text',
          quote: 'Kinase activity',
          pageStart: 1,
          pageEnd: 1,
          rects: [{ page: 1, x: 0.1, y: 0.2, width: 0.3, height: 0.04 }]
        },
        thread: {
          status: 'open'
        },
        annotation: {
          sourceText: 'Kinase activity'
        }
      }
    }

    renderToStaticMarkup(createElement(DocumentAnnotationPanelController, {
      context,
      observation,
      documentKind: 'pdf',
      renderDocument: (input) => {
        renderInput = input
        return createElement('div', { 'data-test-document': 'true' })
      }
    }))

    const capturedInput = renderInput as DocumentAnnotationPanelRenderInput | null
    if (!capturedInput) throw new Error('Document render input was not captured.')
    await capturedInput.pdf.onApplyEdit(operation)

    expect(context.host.updateAnnotation).toHaveBeenCalledWith({
      annotationId: 'pdf-ann-1',
      annotationKind: 'comment',
      body: '',
      target: operation.target
    })
    expect(context.host.observe).not.toHaveBeenCalled()
    expect(context.host.listAnnotations).toHaveBeenCalledTimes(1)
    expect(context.host.listAnnotations).toHaveBeenCalledWith('session-pdf')
  })

  it('uses the same controller-owned text binding for Markdown annotations', async () => {
    const observation = createObservation()
    observation.file.path = '/workspace/lab/notes.md'
    observation.file.mimeType = 'text/markdown'
    observation.view.pluginId = 'markdown'
    observation.view.title = 'notes.md'
    const context = createContext(observation)
    let renderInput: DocumentAnnotationPanelRenderInput | null = null
    const operation: WorkspacePreviewEditOperation = {
      kind: 'annotation.upsert',
      path: observation.file.path,
      annotationId: 'markdown-ann-1',
      annotationKind: 'comment',
      body: '',
      target: {
        documentKind: 'markdown',
        threadId: 'markdown-thread-1',
        anchor: {
          id: 'markdown-anchor-1',
          kind: 'text',
          quote: 'Kinase activity',
          textRange: { start: 0, end: 15 }
        }
      }
    }

    renderToStaticMarkup(createElement(DocumentAnnotationPanelController, {
      context,
      observation,
      documentKind: 'markdown',
      renderDocument: (input) => {
        renderInput = input
        return createElement('div')
      }
    }))

    const capturedInput = renderInput as DocumentAnnotationPanelRenderInput | null
    if (!capturedInput) throw new Error('Document render input was not captured.')
    await capturedInput.text.onApplyEdit(operation)

    expect(context.host.updateAnnotation).toHaveBeenCalledWith({
      annotationId: 'markdown-ann-1',
      annotationKind: 'comment',
      body: '',
      target: operation.target
    })
  })

  it('propagates host edit failures so document editors can keep the failed save visible', async () => {
    const observation = createObservation()
    const context = createContext(observation)
    vi.mocked(context.host.applyEdit).mockResolvedValue({ ok: false, message: 'Document write failed.' })
    let renderInput: DocumentAnnotationPanelRenderInput | null = null

    renderToStaticMarkup(createElement(DocumentAnnotationPanelController, {
      context,
      observation,
      documentKind: 'markdown',
      renderDocument: (input) => {
        renderInput = input
        return createElement('div')
      }
    }))

    const capturedInput = renderInput as DocumentAnnotationPanelRenderInput | null
    if (!capturedInput) throw new Error('Document render input was not captured.')
    await expect(capturedInput.text.onApplyEdit(textEditOperation())).rejects.toThrow('Document write failed.')
    expect(context.host.observe).not.toHaveBeenCalled()
  })

  it('observes the updated session after a successful document save', async () => {
    const observation = createObservation()
    const context = createContext(observation)
    let renderInput: DocumentAnnotationPanelRenderInput | null = null

    renderToStaticMarkup(createElement(DocumentAnnotationPanelController, {
      context,
      observation,
      documentKind: 'markdown',
      renderDocument: (input) => {
        renderInput = input
        return createElement('div')
      }
    }))

    const capturedInput = renderInput as DocumentAnnotationPanelRenderInput | null
    if (!capturedInput) throw new Error('Document render input was not captured.')
    await capturedInput.text.onApplyEdit(textEditOperation())
    expect(context.host.observe).toHaveBeenCalledWith('session-pdf')
  })

  it('propagates thrown host edit errors without observing a failed save', async () => {
    const observation = createObservation()
    const context = createContext(observation)
    vi.mocked(context.host.applyEdit).mockRejectedValue(new Error('Storage unavailable.'))
    let renderInput: DocumentAnnotationPanelRenderInput | null = null

    renderToStaticMarkup(createElement(DocumentAnnotationPanelController, {
      context,
      observation,
      documentKind: 'docx',
      renderDocument: (input) => {
        renderInput = input
        return createElement('div')
      }
    }))

    const capturedInput = renderInput as DocumentAnnotationPanelRenderInput | null
    if (!capturedInput) throw new Error('Document render input was not captured.')
    await expect(capturedInput.text.onApplyEdit(textEditOperation())).rejects.toThrow('Storage unavailable.')
    expect(context.host.observe).not.toHaveBeenCalled()
  })
})
