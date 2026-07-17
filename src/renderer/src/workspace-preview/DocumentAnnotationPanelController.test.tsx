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

describe('DocumentAnnotationPanelController', () => {
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
    expect(context.host.observe).toHaveBeenCalledWith('session-pdf')
    expect(context.host.listAnnotations).toHaveBeenCalledWith('session-pdf')
  })
})
