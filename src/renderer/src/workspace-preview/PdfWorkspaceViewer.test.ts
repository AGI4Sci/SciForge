import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  WORKSPACE_PREVIEW_CONTRACT_VERSION,
  WORKSPACE_PREVIEW_MAX_RANGE_BYTES,
  WORKSPACE_PREVIEW_RECOMMENDED_RANGE_BYTES,
  type WorkspaceObservation,
  type WorkspacePreviewAssetTransportDescriptor
} from '@shared/workspace-preview'
import type { WorkspacePreviewAssetTransportClient } from './host'

vi.mock('../components/write/WritePdfViewer', () => ({
  WritePdfViewer: (props: {
    filePath: string
    documentContentKey?: string
    dataBase64?: string
    data?: Uint8Array | ArrayBuffer
    sourceUrl?: string
    mimeType?: string
    size?: number
    workspaceRoot?: string
    onAnnotationAction?: unknown
    annotationOverlays?: unknown[]
    activeAnnotationId?: string | null
    annotationsOpen?: boolean
    initialPage?: number
    jumpToRect?: unknown
    onAnnotationSelect?: unknown
    onOpenAnnotations?: unknown
    onToggleAnnotations?: unknown
    onPresentationStateChange?: unknown
  }) => createElement('div', {
    'data-write-pdf-viewer': 'true',
    'data-file-path': props.filePath,
    'data-document-content-key': props.documentContentKey,
    'data-pdf-data-base64': props.dataBase64,
    'data-pdf-data-length': props.data instanceof Uint8Array ? props.data.length : props.data?.byteLength,
    'data-pdf-mime-type': props.mimeType,
    'data-pdf-size': props.size,
    'data-workspace-root': props.workspaceRoot,
    'data-has-annotation-action': props.onAnnotationAction ? 'true' : 'false',
    'data-annotation-overlay-count': props.annotationOverlays?.length ?? 0,
    'data-active-annotation-id': props.activeAnnotationId ?? '',
    'data-annotations-open': props.annotationsOpen ? 'true' : 'false',
    'data-initial-page': props.initialPage,
    'data-has-jump-rect': props.jumpToRect ? 'true' : 'false',
    'data-has-annotation-select': props.onAnnotationSelect ? 'true' : 'false',
    'data-has-open-annotations': props.onOpenAnnotations ? 'true' : 'false',
    'data-has-toggle-annotations': props.onToggleAnnotations ? 'true' : 'false',
    'data-has-presentation-state-change': props.onPresentationStateChange ? 'true' : 'false',
    ...(props.sourceUrl ? { 'data-source-url': props.sourceUrl } : {})
  })
}))

import {
  PdfWorkspaceViewer,
  buildPdfWorkspaceViewerModel,
  loadPdfWorkspacePreviewData,
  pdfWorkspaceDocumentRevisionKey
} from './PdfWorkspaceViewer'

function createPdfObservation(
  overrides: Partial<WorkspaceObservation> = {}
): WorkspaceObservation {
  return {
    schemaVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
    file: {
      path: '/workspace/lab/paper.pdf',
      workspaceRoot: '/workspace/lab',
      mimeType: 'application/pdf',
      size: 4
    },
    view: {
      pluginId: 'pdf',
      modality: 'document',
      mode: 'preview',
      title: 'paper.pdf'
    },
    actions: ['observe', 'workspace.setSelection'],
    ...overrides
  }
}

function createPdfAssetDescriptor(
  overrides: Partial<WorkspacePreviewAssetTransportDescriptor> = {}
): WorkspacePreviewAssetTransportDescriptor {
  return {
    schemaVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
    sessionId: 'session-pdf',
    assetId: 'asset:session-pdf',
    pluginId: 'pdf',
    modality: 'document',
    file: {
      name: 'paper.pdf',
      relativePath: 'paper.pdf',
      mimeType: 'application/pdf',
      size: 4
    },
    primary: 'byte-range',
    eagerRead: {
      allowed: false,
      reason: 'Use bounded byte reads.'
    },
    range: {
      available: true,
      maxChunkBytes: WORKSPACE_PREVIEW_MAX_RANGE_BYTES,
      recommendedChunkBytes: WORKSPACE_PREVIEW_RECOMMENDED_RANGE_BYTES,
      size: 4
    },
    strategies: [{
      kind: 'byte-range',
      status: 'available',
      reason: 'Byte-range transport is available.',
      maxChunkBytes: WORKSPACE_PREVIEW_MAX_RANGE_BYTES
    }],
    ...overrides
  }
}

function createPdfTransportClient(input: {
  asset: WorkspacePreviewAssetTransportDescriptor
  sourceUrl?: string | null
  bytes?: Uint8Array
  readResult?: Awaited<ReturnType<WorkspacePreviewAssetTransportClient['readBytesIfWithin']>>
}): WorkspacePreviewAssetTransportClient {
  const readBytesIfWithin = vi.fn<WorkspacePreviewAssetTransportClient['readBytesIfWithin']>(async () => {
    if (input.readResult) return input.readResult
    const bytes = input.bytes ?? Uint8Array.from([0x25, 0x50, 0x44, 0x46])
    return {
      ok: true,
      bytes,
      bytesRead: bytes.length,
      truncated: false
    }
  })

  return {
    descriptor: input.asset,
    sourceUrl: input.sourceUrl ?? null,
    strategyStatus(kind) {
      return input.asset.strategies.find((strategy) => strategy.kind === kind) ?? null
    },
    async readRange() {
      return {
        ok: false,
        message: 'readRange should not be used by the PDF viewer.'
      }
    },
    async prepareArtifact() {
      return {
        ok: false,
        message: 'prepareArtifact should not be used by the PDF viewer.'
      }
    },
    async readArtifactRange() {
      return {
        ok: false,
        message: 'readArtifactRange should not be used by the PDF viewer.'
      }
    },
    artifact() {
      return null
    },
    readBytesIfWithin,
    async readTextIfWithin() {
      return {
        ok: false,
        message: 'readTextIfWithin should not be used by the PDF viewer.'
      }
    }
  }
}

describe('PdfWorkspaceViewer', () => {
  it('keeps a stable document revision across observation and transport object refreshes', () => {
    const observation = createPdfObservation()
    const asset = createPdfAssetDescriptor()
    const first = pdfWorkspaceDocumentRevisionKey({
      observation,
      asset,
      transport: createPdfTransportClient({
        asset,
        sourceUrl: 'sciforge-resource://content?access=revision-1'
      })
    })
    const refreshedObservation = createPdfObservation({
      file: { ...observation.file },
      view: { ...observation.view },
      visibleText: 'A refreshed observation must not reload unchanged PDF bytes.'
    })
    const refreshedAsset = createPdfAssetDescriptor({
      file: { ...asset.file },
      range: { ...asset.range },
      strategies: asset.strategies.map((strategy) => ({ ...strategy }))
    })

    expect(pdfWorkspaceDocumentRevisionKey({
      observation: refreshedObservation,
      asset: refreshedAsset,
      transport: createPdfTransportClient({
        asset: refreshedAsset,
        sourceUrl: 'sciforge-resource://content?access=revision-2'
      })
    })).toBe(first)
    expect(pdfWorkspaceDocumentRevisionKey({
      observation: createPdfObservation({
        file: { ...observation.file, mtimeMs: 42 }
      }),
      asset,
      transport: createPdfTransportClient({ asset })
    })).not.toBe(first)
  })

  it('maps an initial document selection to the initial PDF page without a replayable jump request', () => {
    const observation = createPdfObservation({
      selection: {
        kind: 'document',
        anchors: [{
          id: 'evidence-anchor',
          page: 6,
          rects: [{ page: 6, x: 0.1, y: 0.2, width: 0.3, height: 0.1 }]
        }]
      }
    })
    const html = renderToStaticMarkup(createElement(PdfWorkspaceViewer, {
      observation,
      asset: createPdfAssetDescriptor(),
      previewState: {
        kind: 'ready',
        title: 'PDF ready',
        message: 'ready',
        data: Uint8Array.from([0x25, 0x50, 0x44, 0x46]),
        mimeType: 'application/pdf'
      }
    }))

    expect(html).toContain('data-initial-page="6"')
    expect(html).toContain('data-has-jump-rect="false"')
  })

  it('prefers workspace preview URL transport for browser-native PDF loading', async () => {
    const observation = createPdfObservation()
    const asset = createPdfAssetDescriptor({
      range: {
        available: true,
        maxChunkBytes: WORKSPACE_PREVIEW_MAX_RANGE_BYTES,
        recommendedChunkBytes: WORKSPACE_PREVIEW_RECOMMENDED_RANGE_BYTES,
        size: 29 * 1024 * 1024
      }
    })
    const transport = createPdfTransportClient({
      asset,
      sourceUrl: 'http://localhost:5173/__sciforge-dev-bridge/workspace-preview/assets/session-pdf?clientId=client-1'
    })
    const result = await loadPdfWorkspacePreviewData({
      observation,
      asset,
      transport
    })

    expect(result).toMatchObject({
      kind: 'ready',
      sourceUrl: 'http://localhost:5173/__sciforge-dev-bridge/workspace-preview/assets/session-pdf?clientId=client-1',
      mimeType: 'application/pdf'
    })
    expect(transport.readBytesIfWithin).not.toHaveBeenCalled()

    if (result.kind !== 'ready') throw new Error('Expected PDF URL transport to be ready.')
    const html = renderToStaticMarkup(createElement(PdfWorkspaceViewer, {
      observation,
      asset,
      transport,
      previewState: result
    }))

    expect(html).toContain('data-workspace-preview-pdf-viewer')
    expect(html).toContain('data-write-pdf-viewer="true"')
    expect(html).not.toContain('data-pdf-agent-summary')
    expect(html).not.toContain('data-pdf-load-summary')
    expect(html).toContain('data-source-url="http://localhost:5173/__sciforge-dev-bridge/workspace-preview/assets/session-pdf?clientId=client-1"')
    expect(html).not.toContain('data-pdf-data-length')
    expect(html).not.toContain('file://')
  })

  it('enables PDF annotation actions when the shell provides applyEdit', async () => {
    const observation = createPdfObservation()
    const asset = createPdfAssetDescriptor()
    const transport = createPdfTransportClient({
      asset,
      sourceUrl: 'sciforge-resource://content?access=annotation-test'
    })
    const result = await loadPdfWorkspacePreviewData({
      observation,
      asset,
      transport
    })

    if (result.kind !== 'ready') throw new Error('Expected PDF data to be ready.')
    const html = renderToStaticMarkup(createElement(PdfWorkspaceViewer, {
      observation,
      asset,
      transport,
      previewState: result,
      onApplyEdit: vi.fn(),
      annotationOverlays: [{
        id: 'thread-1',
        kind: 'comment',
        rects: [{ page: 1, x: 0.1, y: 0.2, width: 0.3, height: 0.04 }],
        status: 'open'
      }],
      activeAnnotationId: 'thread-1',
      annotationsOpen: true,
      jumpToRect: { page: 1, x: 0.1, y: 0.2, width: 0.3, height: 0.04 },
      onAnnotationSelect: vi.fn(),
      onOpenAnnotations: vi.fn(),
      onToggleAnnotations: vi.fn()
    }))

    expect(html).toContain('data-write-pdf-viewer="true"')
    expect(html).toContain('data-has-annotation-action="true"')
    expect(html).toContain('data-annotation-overlay-count="1"')
    expect(html).toContain('data-active-annotation-id="thread-1"')
    expect(html).toContain('data-annotations-open="true"')
    expect(html).toContain('data-has-jump-rect="true"')
    expect(html).toContain('data-has-annotation-select="true"')
    expect(html).toContain('data-has-open-annotations="true"')
    expect(html).toContain('data-has-toggle-annotations="true"')
  })

  it('requires streaming URL transport instead of imposing a whole-file PDF size limit', async () => {
    const observation = createPdfObservation()
    const asset = createPdfAssetDescriptor({
      range: {
        available: true,
        maxChunkBytes: WORKSPACE_PREVIEW_MAX_RANGE_BYTES,
        recommendedChunkBytes: WORKSPACE_PREVIEW_RECOMMENDED_RANGE_BYTES,
        size: 16
      }
    })
    const transport = createPdfTransportClient({ asset })
    const result = await loadPdfWorkspacePreviewData({
      observation,
      asset,
      transport
    })
    const html = renderToStaticMarkup(createElement(PdfWorkspaceViewer, {
      observation,
      asset,
      transport,
      previewState: result
    }))

    expect(result).toMatchObject({
      kind: 'fallback',
      title: 'PDF stream unavailable',
      message: 'The workspace preview URL transport is unavailable for this PDF.'
    })
    expect(transport.readBytesIfWithin).not.toHaveBeenCalled()
    expect(html).toContain('data-pdf-fallback-summary')
    expect(html).toContain('workspace preview URL transport is unavailable')
    expect(html).not.toContain('data-write-pdf-viewer')
    expect(html).not.toContain('file://')
  })

  it('rejects non-document or non-PDF observations before attempting to read PDF bytes', async () => {
    const imageObservation = createPdfObservation({
      file: {
        path: '/workspace/lab/cell.png',
        workspaceRoot: '/workspace/lab',
        mimeType: 'image/png',
        size: 12
      },
      view: {
        pluginId: 'image',
        modality: 'image',
        mode: 'preview',
        title: 'cell.png'
      }
    })
    const htmlObservation = createPdfObservation({
      file: {
        path: '/workspace/lab/report.html',
        workspaceRoot: '/workspace/lab',
        mimeType: 'text/html',
        size: 12
      },
      view: {
        pluginId: 'html',
        modality: 'document',
        mode: 'preview',
        title: 'report.html'
      }
    })
    const asset = createPdfAssetDescriptor()
    const transport = createPdfTransportClient({ asset })

    const imageModel = buildPdfWorkspaceViewerModel({ observation: imageObservation, asset })
    const imageResult = await loadPdfWorkspacePreviewData({
      observation: imageObservation,
      asset,
      transport
    })
    const htmlResult = await loadPdfWorkspacePreviewData({
      observation: htmlObservation,
      asset: null,
      transport
    })
    const rendered = renderToStaticMarkup(createElement(PdfWorkspaceViewer, {
      observation: imageObservation,
      asset,
      transport
    }))

    expect(imageModel.status.kind).toBe('unsupported')
    expect(imageResult).toMatchObject({
      kind: 'fallback',
      title: 'Unsupported observation',
      message: 'Image observations cannot be rendered by the PDF viewer.'
    })
    expect(htmlResult).toMatchObject({
      kind: 'fallback',
      title: 'Unsupported observation',
      message: 'Document observations cannot be rendered by the PDF viewer.'
    })
    expect(transport.readBytesIfWithin).not.toHaveBeenCalled()
    expect(rendered).toContain('data-status="unsupported"')
    expect(rendered).toContain('Image observations cannot be rendered')
    expect(rendered).not.toContain('data-write-pdf-viewer')
    expect(rendered).not.toContain('file://')
  })
})
