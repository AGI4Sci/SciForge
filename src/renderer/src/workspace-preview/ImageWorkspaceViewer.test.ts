import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  WORKSPACE_PREVIEW_CONTRACT_VERSION,
  type WorkspaceObservation,
  type WorkspacePreviewAssetTransportDescriptor
} from '@shared/workspace-preview'
import type { WorkspacePreviewAssetTransportClient } from './host'
import {
  IMAGE_WORKSPACE_VIEWER_MAX_BYTES,
  ImageWorkspaceViewer,
  buildImageWorkspaceViewerModel,
  createImageWorkspaceViewerDataUrl,
  loadImageWorkspacePreviewDataUrl,
  resolveImageMimeType
} from './ImageWorkspaceViewer'

function createImageObservation(
  overrides: Partial<WorkspaceObservation> = {}
): WorkspaceObservation {
  return {
    schemaVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
    file: {
      path: '/workspace/lab/cell.png',
      workspaceRoot: '/workspace/lab',
      mimeType: 'image/png',
      size: 8
    },
    view: {
      pluginId: 'image',
      modality: 'image',
      mode: 'preview',
      title: 'cell.png'
    },
    actions: ['observe', 'workspace.setSelection'],
    ...overrides
  }
}

function createImageAssetDescriptor(
  overrides: Partial<WorkspacePreviewAssetTransportDescriptor> = {}
): WorkspacePreviewAssetTransportDescriptor {
  return {
    schemaVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
    sessionId: 'session-image',
    assetId: 'asset:session-image',
    pluginId: 'image',
    modality: 'image',
    file: {
      name: 'cell.png',
      relativePath: 'cell.png',
      mimeType: 'image/png',
      size: 8
    },
    primary: 'byte-range',
    eagerRead: {
      allowed: false,
      reason: 'Use bounded byte reads.'
    },
    range: {
      available: true,
      maxChunkBytes: IMAGE_WORKSPACE_VIEWER_MAX_BYTES,
      recommendedChunkBytes: 1024 * 1024,
      size: 8
    },
    strategies: [{
      kind: 'byte-range',
      status: 'available',
      reason: 'Byte-range transport is available.',
      maxChunkBytes: IMAGE_WORKSPACE_VIEWER_MAX_BYTES
    }],
    ...overrides
  }
}

function createImageTransportClient(input: {
  asset: WorkspacePreviewAssetTransportDescriptor
  bytes?: Uint8Array
  readResult?: Awaited<ReturnType<WorkspacePreviewAssetTransportClient['readBytesIfWithin']>>
}): WorkspacePreviewAssetTransportClient {
  const readBytesIfWithin = vi.fn<WorkspacePreviewAssetTransportClient['readBytesIfWithin']>(async () => {
    if (input.readResult) return input.readResult
    const bytes = input.bytes ?? Uint8Array.from([0x89, 0x50, 0x4e, 0x47])
    return {
      ok: true,
      bytes,
      bytesRead: bytes.length,
      truncated: false
    }
  })

  return {
    descriptor: input.asset,
    strategyStatus(kind) {
      return input.asset.strategies.find((strategy) => strategy.kind === kind) ?? null
    },
    async readRange() {
      return {
        ok: false,
        message: 'readRange should not be used by the image viewer.'
      }
    },
    async prepareArtifact() {
      return {
        ok: false,
        message: 'prepareArtifact should not be used by the image viewer.'
      }
    },
    async readArtifactRange() {
      return {
        ok: false,
        message: 'readArtifactRange should not be used by the image viewer.'
      }
    },
    artifact() {
      return null
    },
    readBytesIfWithin,
    async readTextIfWithin() {
      return {
        ok: false,
        message: 'readTextIfWithin should not be used by the image viewer.'
      }
    }
  }
}

describe('ImageWorkspaceViewer', () => {
  it('loads image bytes through transport and renders a data URL without using file URLs', async () => {
    const observation = createImageObservation()
    const asset = createImageAssetDescriptor({
      file: {
        name: 'cell.png',
        relativePath: 'cell.png',
        size: 4
      }
    })
    const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47])
    const transport = createImageTransportClient({ asset, bytes })
    const result = await loadImageWorkspacePreviewDataUrl({
      observation,
      asset,
      transport
    })

    expect(result).toMatchObject({
      kind: 'ready',
      dataUrl: 'data:image/png;base64,iVBORw==',
      mimeType: 'image/png',
      bytesRead: 4
    })
    expect(transport.readBytesIfWithin).toHaveBeenCalledWith(IMAGE_WORKSPACE_VIEWER_MAX_BYTES)
    expect(resolveImageMimeType({ observation, asset })).toBe('image/png')
    expect(createImageWorkspaceViewerDataUrl(bytes, 'image/png')).toBe('data:image/png;base64,iVBORw==')

    if (result.kind !== 'ready') throw new Error('Expected image data URL to be ready.')
    const html = renderToStaticMarkup(createElement(ImageWorkspaceViewer, {
      observation,
      asset,
      transport,
      previewState: result
    }))

    expect(html).toContain('data-workspace-preview-image-viewer')
    expect(html).toContain('data-image-preview-img')
    expect(html).not.toContain('data-image-agent-summary')
    expect(html).not.toContain('data-image-load-summary')
    expect(html).toContain('src="data:image/png;base64,iVBORw=="')
    expect(html).toContain('data-fit-mode="fit"')
    expect(html).toContain('object-fit:contain')
    expect(html).not.toContain('file://')
  })

  it('shows a clear fallback when the image exceeds the bounded transport read limit', async () => {
    const observation = createImageObservation()
    const asset = createImageAssetDescriptor({
      range: {
        available: true,
        maxChunkBytes: IMAGE_WORKSPACE_VIEWER_MAX_BYTES,
        recommendedChunkBytes: 1024 * 1024,
        size: 16
      }
    })
    const transport = createImageTransportClient({
      asset,
      readResult: {
        ok: false,
        message: 'Asset exceeds the requested read limit.'
      }
    })
    const result = await loadImageWorkspacePreviewDataUrl({
      observation,
      asset,
      transport,
      maxBytes: 4
    })
    const html = renderToStaticMarkup(createElement(ImageWorkspaceViewer, {
      observation,
      asset,
      transport,
      maxBytes: 4,
      previewState: result
    }))

    expect(result).toMatchObject({
      kind: 'fallback',
      title: 'Image bytes unavailable',
      message: 'This image is 16 B; inline image preview is limited to 4 B.'
    })
    expect(transport.readBytesIfWithin).toHaveBeenCalledWith(4)
    expect(html).toContain('data-image-fallback-summary')
    expect(html).toContain('inline image preview is limited to 4 B')
    expect(html).not.toContain('data-image-preview-img')
    expect(html).not.toContain('file://')
  })

  it('shows a clear fallback when image asset or transport is missing', async () => {
    const observation = createImageObservation()
    const noAssetResult = await loadImageWorkspacePreviewDataUrl({
      observation,
      transport: null
    })
    const noTransportResult = await loadImageWorkspacePreviewDataUrl({
      observation,
      asset: createImageAssetDescriptor(),
      transport: null
    })
    const html = renderToStaticMarkup(createElement(ImageWorkspaceViewer, {
      observation
    }))

    expect(noAssetResult).toMatchObject({
      kind: 'fallback',
      message: 'No workspace preview asset descriptor is available for this image.'
    })
    expect(noTransportResult).toMatchObject({
      kind: 'fallback',
      message: 'No workspace preview asset transport client is available for this image.'
    })
    expect(html).toContain('data-image-fallback-summary')
    expect(html).toContain('No workspace preview asset descriptor is available')
    expect(html).not.toContain('data-image-preview-img')
  })

  it('rejects non-image modalities before attempting to read image bytes', async () => {
    const observation = createImageObservation({
      file: {
        path: '/workspace/lab/table.csv',
        workspaceRoot: '/workspace/lab',
        mimeType: 'text/csv',
        size: 12
      },
      view: {
        pluginId: 'tabular',
        modality: 'tabular',
        mode: 'preview',
        title: 'table.csv'
      }
    })
    const asset = createImageAssetDescriptor()
    const transport = createImageTransportClient({ asset })
    const model = buildImageWorkspaceViewerModel({ observation, asset })
    const result = await loadImageWorkspacePreviewDataUrl({
      observation,
      asset,
      transport
    })
    const html = renderToStaticMarkup(createElement(ImageWorkspaceViewer, {
      observation,
      asset,
      transport
    }))

    expect(model.status.kind).toBe('unsupported')
    expect(result).toMatchObject({
      kind: 'fallback',
      title: 'Unsupported observation',
      message: 'Tabular observations cannot be rendered by the image viewer.'
    })
    expect(transport.readBytesIfWithin).not.toHaveBeenCalled()
    expect(html).toContain('data-status="unsupported"')
    expect(html).toContain('Tabular observations cannot be rendered')
    expect(html).not.toContain('data-image-preview-img')
  })
})
