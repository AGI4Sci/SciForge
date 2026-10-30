import { describe, expect, it } from 'vitest'
import {
  workspacePreviewEditOperationSchema
} from '@shared/workspace-preview'
import type {
  PdfAnnotationSidecar
} from '@shared/pdf-annotations'
import type { DocumentAnnotationSelection } from './document-annotation-types'
import {
  createAnnotationBodyUpdateOperation,
  createAnnotationThreadDeleteOperation,
  createAnnotationThreadStatusOperation,
  createDocumentAnnotationNavigationRequest,
  createDocumentWorkspacePreviewAnnotationOperation,
  createPdfAnnotationOverlaysFromSidecar,
  createTextAnnotationOverlaysFromSidecar,
  workspacePreviewAnnotationKindForAction
} from './document-annotation-operations'

function createSelection(overrides: Partial<DocumentAnnotationSelection> = {}): DocumentAnnotationSelection {
  return {
    text: ' Kinase activity ',
    ranges: [{
      from: 0,
      to: 15,
      startLine: 2,
      startColumn: 4,
      endLine: 2,
      endColumn: 19,
      text: 'Kinase activity',
      charCount: 15,
      page: 3
    }],
    charCount: 15,
    sourceKind: 'pdf',
    pageStart: 3,
    pageEnd: 3,
    rects: [{
      page: 3,
      x: 0.12,
      y: 0.24,
      width: 0.3,
      height: 0.05
    }],
    metadata: {
      sourceKind: 'pdf',
      filePath: '/workspace/lab/paper.pdf',
      sourceTitle: 'paper.pdf',
      mimeType: 'application/pdf',
      pageStart: 3,
      pageEnd: 3,
      pageCount: 12,
      rects: [{
        page: 3,
        x: 0.12,
        y: 0.24,
        width: 0.3,
        height: 0.05
      }]
    },
    ...overrides
  }
}

function createSidecar(): PdfAnnotationSidecar {
  const fingerprint = {
    sha256: 'sha256',
    size: 128,
    fileName: 'paper.pdf'
  }
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
    pdfFingerprint: fingerprint,
    anchors: [{
      id: 'anchor-1',
      kind: 'text',
      pageStart: 2,
      pageEnd: 2,
      rects: [{ page: 2, x: 0.1, y: 0.2, width: 0.3, height: 0.04 }],
      quote: 'Kinase activity',
      textHash: 'hash',
      contextBefore: 'Alpha',
      contextAfter: 'Beta',
      textRange: {
        start: 6,
        end: 21,
        startLine: 1,
        startColumn: 7,
        endLine: 1,
        endColumn: 22
      },
      pdfFingerprint: fingerprint,
      createdAt: '2026-07-08T00:00:00.000Z',
      updatedAt: '2026-07-08T00:00:00.000Z'
    }],
    annotations: [{
      id: 'ann-1',
      threadId: 'thread-1',
      anchorId: 'anchor-1',
      kind: 'comment',
      body: 'Check this claim.',
      createdAt: '2026-07-08T00:00:00.000Z',
      updatedAt: '2026-07-08T00:00:00.000Z'
    }],
    threads: [{
      id: 'thread-1',
      kind: 'comment',
      anchorIds: ['anchor-1'],
      annotationIds: ['ann-1'],
      status: 'open',
      title: 'Claim check',
      createdAt: '2026-07-08T00:00:00.000Z',
      updatedAt: '2026-07-08T00:00:00.000Z'
    }],
    authors: [],
    updatedAt: '2026-07-08T00:00:00.000Z'
  }
}

describe('document annotation workspace operations', () => {
  it('creates strict annotation.upsert operations from PDF selections', () => {
    const operation = createDocumentWorkspacePreviewAnnotationOperation({
      documentKind: 'pdf',
      path: '/workspace/lab/paper.pdf',
      action: 'highlight',
      selection: createSelection(),
      createId: (prefix) => `${prefix}-id`
    })

    expect(workspacePreviewEditOperationSchema.parse(operation)).toEqual(operation)
    expect(operation).toMatchObject({
      kind: 'annotation.upsert',
      path: '/workspace/lab/paper.pdf',
      annotationId: 'pdf-ann-id',
      annotationKind: 'highlight',
      body: '',
      target: {
        documentKind: 'pdf',
        threadId: 'pdf-thread-id',
        anchor: {
          id: 'pdf-anchor-id',
          kind: 'text',
          quote: 'Kinase activity',
          pageStart: 3,
          pageEnd: 3,
          rects: [{
            page: 3,
            x: 0.12,
            y: 0.24,
            width: 0.3,
            height: 0.05
          }]
        },
        thread: {
          status: 'open'
        },
        annotation: {
          sourceText: 'Kinase activity'
        }
      }
    })
  })

  it('creates DOCX question annotations with quote context and translation body', () => {
    const operation = createDocumentWorkspacePreviewAnnotationOperation({
      documentKind: 'docx',
      path: '/workspace/lab/report.docx',
      action: 'translation',
      selection: createSelection({
        text: 'beta cells',
        sourceKind: 'docx',
        contextBefore: 'Alpha ',
        contextAfter: ' gamma',
        pageStart: 1,
        pageEnd: 1,
        rects: [],
        metadata: {
          sourceKind: 'docx',
          filePath: '/workspace/lab/report.docx',
          sourceTitle: 'report.docx',
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          pageStart: 1,
          pageEnd: 1,
          pageCount: 1,
          rects: []
        }
      }),
      translationBody: 'Translate this document selection.',
      createId: (prefix) => `${prefix}-id`
    })

    expect(workspacePreviewEditOperationSchema.parse(operation)).toEqual(operation)
    expect(operation).toMatchObject({
      kind: 'annotation.upsert',
      path: '/workspace/lab/report.docx',
      annotationId: 'docx-ann-id',
      annotationKind: 'question',
      body: 'Translate this document selection.',
      target: {
        documentKind: 'docx',
        threadId: 'docx-thread-id',
        anchor: {
          id: 'docx-anchor-id',
          kind: 'text',
          quote: 'beta cells',
          contextBefore: 'Alpha',
          contextAfter: 'gamma',
          pageStart: 1,
          pageEnd: 1
        },
        thread: {
          status: 'open',
          title: 'beta cells'
        },
        annotation: {
          sourceText: 'beta cells'
        }
      }
    })
  })

  it('creates Markdown annotations through the same text-document operation path', () => {
    const operation = createDocumentWorkspacePreviewAnnotationOperation({
      documentKind: 'markdown',
      path: '/workspace/lab/notes.md',
      action: 'comment',
      selection: createSelection({
        text: 'beta cells',
        sourceKind: 'markdown',
        contextBefore: 'Alpha ',
        contextAfter: ' gamma',
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
        metadata: {
          sourceKind: 'markdown',
          filePath: '/workspace/lab/notes.md',
          sourceTitle: 'notes.md',
          mimeType: 'text/markdown',
          rects: []
        }
      }),
      createId: (prefix) => `${prefix}-id`
    })

    expect(workspacePreviewEditOperationSchema.parse(operation)).toEqual(operation)
    expect(operation).toMatchObject({
      kind: 'annotation.upsert',
      annotationId: 'markdown-ann-id',
      target: {
        documentKind: 'markdown',
        threadId: 'markdown-thread-id',
        anchor: {
          id: 'markdown-anchor-id',
          quote: 'beta cells',
          contextBefore: 'Alpha',
          contextAfter: 'gamma',
          textRange: {
            start: 6,
            end: 16,
            startLine: 1,
            startColumn: 7,
            endLine: 1,
            endColumn: 17
          }
        }
      }
    })
  })

  it('does not create write operations for copy actions or empty DOCX selections', () => {
    expect(workspacePreviewAnnotationKindForAction('copy')).toBeNull()
    expect(createDocumentWorkspacePreviewAnnotationOperation({
      documentKind: 'pdf',
      path: '/workspace/lab/paper.pdf',
      action: 'copy',
      selection: createSelection()
    })).toBeNull()
    expect(createDocumentWorkspacePreviewAnnotationOperation({
      documentKind: 'docx',
      path: '/workspace/lab/report.docx',
      action: 'highlight',
      selection: createSelection({
        text: '',
        sourceKind: 'docx',
        metadata: {
          sourceKind: 'docx',
          filePath: '/workspace/lab/report.docx',
          sourceTitle: 'report.docx',
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          rects: []
        }
      })
    })).toBeNull()
  })

  it('converts sidecar threads to viewer overlays and panel edit operations', () => {
    const sidecar = createSidecar()

    expect(createPdfAnnotationOverlaysFromSidecar(sidecar)).toEqual([{
      id: 'thread-1',
      kind: 'comment',
      rects: [{ page: 2, x: 0.1, y: 0.2, width: 0.3, height: 0.04 }],
      status: 'open',
      label: 'Claim check'
    }])
    expect(createTextAnnotationOverlaysFromSidecar(sidecar)).toEqual([{
      id: 'thread-1',
      kind: 'comment',
      quote: 'Kinase activity',
      contextBefore: 'Alpha',
      contextAfter: 'Beta',
      textRange: {
        start: 6,
        end: 21,
        startLine: 1,
        startColumn: 7,
        endLine: 1,
        endColumn: 22
      },
      status: 'open',
      label: 'Claim check'
    }])
    expect(createPdfAnnotationOverlaysFromSidecar(sidecar, {
      displayMode: 'current',
      activeThreadId: 'missing'
    })).toEqual([])
    expect(createPdfAnnotationOverlaysFromSidecar(sidecar, {
      displayMode: 'current',
      activeThreadId: null
    })).toEqual([])
    expect(createTextAnnotationOverlaysFromSidecar(sidecar, {
      displayMode: 'current',
      activeThreadId: null
    })).toEqual([])
    const navigationRequest = createDocumentAnnotationNavigationRequest(sidecar, 'thread-1', 'locate-1')
    expect(navigationRequest).toEqual({
      requestId: 'locate-1',
      threadId: 'thread-1',
      quote: 'Kinase activity',
      contextBefore: 'Alpha',
      contextAfter: 'Beta',
      textRange: {
        start: 6,
        end: 21,
        startLine: 1,
        startColumn: 7,
        endLine: 1,
        endColumn: 22
      },
      pageRect: { page: 2, x: 0.1, y: 0.2, width: 0.3, height: 0.04 }
    })
    expect(createDocumentAnnotationNavigationRequest(sidecar, 'thread-1', 'locate-2')?.pageRect)
      .not.toBe(navigationRequest?.pageRect)

    expect(workspacePreviewEditOperationSchema.parse(createAnnotationThreadStatusOperation({
      path: '/workspace/lab/paper.pdf',
      threadId: 'thread-1',
      status: 'resolved'
    })).kind).toBe('annotation.thread.update')
    expect(workspacePreviewEditOperationSchema.parse(createAnnotationThreadDeleteOperation({
      path: '/workspace/lab/paper.pdf',
      threadId: 'thread-1'
    }))).toMatchObject({
      kind: 'annotation.thread.delete',
      pruneOrphanAnchors: true
    })
    expect(workspacePreviewEditOperationSchema.parse(createAnnotationBodyUpdateOperation({
      path: '/workspace/lab/paper.pdf',
      sidecar,
      annotationId: 'ann-1',
      body: 'Updated body'
    }))).toMatchObject({
      kind: 'annotation.upsert',
      annotationId: 'ann-1',
      annotationKind: 'comment',
      body: 'Updated body'
    })
  })
})
