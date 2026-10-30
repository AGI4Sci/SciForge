// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { capabilityResourceContentSourceUrl } from '../../../shared/workspace-preview-asset-url'
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
  resolveImageMimeType,
  type ImageWorkspaceViewerPreviewState
} from './ImageWorkspaceViewer'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

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

type ReadBytesResult = Awaited<ReturnType<WorkspacePreviewAssetTransportClient['readBytesIfWithin']>>

function createImageTransportClient(input: {
  asset: WorkspacePreviewAssetTransportDescriptor
  bytes?: Uint8Array
  readResult?: ReadBytesResult
  readBytes?: WorkspacePreviewAssetTransportClient['readBytesIfWithin']
}): WorkspacePreviewAssetTransportClient {
  const readBytesIfWithin = vi.fn<WorkspacePreviewAssetTransportClient['readBytesIfWithin']>(
    input.readBytes ?? (async () => {
      if (input.readResult) return input.readResult
      const bytes = input.bytes ?? Uint8Array.from([0x89, 0x50, 0x4e, 0x47])
      return {
        ok: true,
        bytes,
        bytesRead: bytes.length,
        truncated: false
      }
    })
  )

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
  it('preserves the canonical Broker image URL in the native image source without a Session', () => {
    const sourceUrl = capabilityResourceContentSourceUrl({ resource: {
      token: `cap_${'a'.repeat(24)}`, semanticRevision: 'sealed-image-sha256', expiresAt: '2099-10-22T00:00:00.000Z'
    } })
    const html = renderToStaticMarkup(createElement(ImageWorkspaceViewer, {
      model: { status: { kind: 'ready', title: 'figure.png', message: '' }, title: 'figure.png', fileSummary: '12 B', agentSummary: '' },
      previewState: { kind: 'ready', title: 'figure.png', message: '', dataUrl: sourceUrl, mimeType: 'image/png', bytesRead: 12 }
    }))
    expect(html).toContain(`src="${sourceUrl}"`)
    expect(html).not.toContain('src="file:')
    expect(html).not.toContain('src="http:')
    expect(html).not.toContain('src="https:')
    expect(html).toContain('alt="figure.png"')
  })

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

type ImageViewerRenderProps = {
  observation?: WorkspaceObservation | null
  asset?: WorkspacePreviewAssetTransportDescriptor | null
  transport?: WorkspacePreviewAssetTransportClient | null
  maxBytes?: number
  previewState?: ImageWorkspaceViewerPreviewState
  opening?: boolean
}

function createDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolveDeferred: (value: T) => void = () => {}
  const promise = new Promise<T>((resolve) => {
    resolveDeferred = resolve
  })
  return { promise, resolve: resolveDeferred }
}

function mountImageWorkspaceViewer(): {
  container: HTMLDivElement
  renderImageWorkspaceViewer: (props: ImageViewerRenderProps) => Promise<void>
  unmount: () => Promise<void>
} {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  return {
    container,
    async renderImageWorkspaceViewer(props) {
      await act(async () => {
        root.render(createElement(ImageWorkspaceViewer, props))
      })
    },
    async unmount() {
      await act(async () => root.unmount())
      container.remove()
    }
  }
}

function readImagePreviewState(container: HTMLElement): string | null {
  return container
    .querySelector('[data-workspace-preview-image-viewer]')
    ?.getAttribute('data-image-preview-state') ?? null
}

describe('ImageWorkspaceViewer content-keyed loading', () => {
  it('keeps the decoded frame and skips the transport read when a re-render carries identical content', async () => {
    const observation = createImageObservation()
    const asset = createImageAssetDescriptor()
    const transport = createImageTransportClient({ asset, bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47]) })
    const viewer = mountImageWorkspaceViewer()

    try {
      await viewer.renderImageWorkspaceViewer({ observation, asset, transport })
      expect(transport.readBytesIfWithin).toHaveBeenCalledTimes(1)

      const image = viewer.container.querySelector('[data-image-preview-img]')
      expect(image).not.toBeNull()
      expect(image?.getAttribute('src')).toBe('data:image/png;base64,iVBORw==')
      expect(image?.isConnected).toBe(true)

      const nextAsset = createImageAssetDescriptor()
      const nextTransport = createImageTransportClient({
        asset: nextAsset,
        bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47])
      })
      await viewer.renderImageWorkspaceViewer({
        observation: createImageObservation(),
        asset: nextAsset,
        transport: nextTransport
      })

      expect(transport.readBytesIfWithin).toHaveBeenCalledTimes(1)
      expect(nextTransport.readBytesIfWithin).not.toHaveBeenCalled()
      expect(viewer.container.querySelector('[data-image-preview-img]')).toBe(image)
      expect(viewer.container.querySelector('[data-image-preview-img]')?.getAttribute('src'))
        .toBe('data:image/png;base64,iVBORw==')
      expect(viewer.container.querySelector('[data-image-fallback-summary]')).toBeNull()
      expect(readImagePreviewState(viewer.container)).toBe('ready')
    } finally {
      await viewer.unmount()
    }
  })

  it('reloads on a changed content identity and keeps the previous frame while the new bytes are pending', async () => {
    const observation = createImageObservation()
    const asset = createImageAssetDescriptor()
    const transport = createImageTransportClient({ asset })
    const reloadObservation = createImageObservation({
      file: {
        path: '/workspace/lab/cell.png',
        workspaceRoot: '/workspace/lab',
        mimeType: 'image/png',
        size: 8,
        mtimeMs: 2000
      }
    })
    const reloadAsset = createImageAssetDescriptor({
      sessionId: 'session-image-refresh',
      assetId: 'asset:session-image-refresh',
      file: {
        name: 'cell.png',
        relativePath: 'cell.png',
        mimeType: 'image/png',
        size: 8
      }
    })
    const pendingRead = createDeferred<ReadBytesResult>()
    const reloadTransport = createImageTransportClient({
      asset: reloadAsset,
      readBytes: () => pendingRead.promise
    })
    const viewer = mountImageWorkspaceViewer()

    try {
      await viewer.renderImageWorkspaceViewer({ observation, asset, transport })
      const image = viewer.container.querySelector('[data-image-preview-img]')
      const firstSrc = image?.getAttribute('src')
      expect(firstSrc).toBe('data:image/png;base64,iVBORw==')

      await viewer.renderImageWorkspaceViewer({
        observation: reloadObservation,
        asset: reloadAsset,
        transport: reloadTransport
      })

      expect(reloadTransport.readBytesIfWithin).toHaveBeenCalledTimes(1)
      expect(viewer.container.querySelector('[data-image-preview-img]')).toBe(image)
      expect(viewer.container.querySelector('[data-image-preview-img]')?.getAttribute('src')).toBe(firstSrc)
      expect(readImagePreviewState(viewer.container)).toBe('refreshing')
      expect(viewer.container.querySelector('[data-image-fallback-summary]')).toBeNull()

      const nextBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a])
      pendingRead.resolve({
        ok: true,
        bytes: nextBytes,
        bytesRead: nextBytes.length,
        truncated: false
      })
      await act(async () => {
        await pendingRead.promise
      })

      expect(viewer.container.querySelector('[data-image-preview-img]')).toBe(image)
      expect(viewer.container.querySelector('[data-image-preview-img]')?.getAttribute('src'))
        .toBe(createImageWorkspaceViewerDataUrl(nextBytes, 'image/png'))
      expect(readImagePreviewState(viewer.container)).toBe('ready')
      expect(viewer.container.querySelector('[data-image-fallback-summary]')).toBeNull()
    } finally {
      await viewer.unmount()
    }
  })

  it('keeps the previous frame while a same-path reload is in flight, then shows the failure message', async () => {
    const observation = createImageObservation()
    const asset = createImageAssetDescriptor()
    const transport = createImageTransportClient({ asset })
    const reloadObservation = createImageObservation({
      file: {
        path: '/workspace/lab/cell.png',
        workspaceRoot: '/workspace/lab',
        mimeType: 'image/png',
        size: 8,
        mtimeMs: 3000
      }
    })
    const reloadAsset = createImageAssetDescriptor({
      sessionId: 'session-image-broken',
      assetId: 'asset:session-image-broken'
    })
    const pendingRead = createDeferred<ReadBytesResult>()
    const reloadTransport = createImageTransportClient({
      asset: reloadAsset,
      readBytes: () => pendingRead.promise
    })
    const viewer = mountImageWorkspaceViewer()

    try {
      await viewer.renderImageWorkspaceViewer({ observation, asset, transport })
      const image = viewer.container.querySelector('[data-image-preview-img]')
      const firstSrc = image?.getAttribute('src')

      await viewer.renderImageWorkspaceViewer({
        observation: reloadObservation,
        asset: reloadAsset,
        transport: reloadTransport
      })

      expect(reloadTransport.readBytesIfWithin).toHaveBeenCalledTimes(1)
      expect(viewer.container.querySelector('[data-image-preview-img]')).toBe(image)
      expect(viewer.container.querySelector('[data-image-preview-img]')?.getAttribute('src')).toBe(firstSrc)
      expect(readImagePreviewState(viewer.container)).toBe('refreshing')
      expect(viewer.container.querySelector('[data-image-fallback-summary]')).toBeNull()

      pendingRead.resolve({ ok: false, message: 'Asset read failed.' })
      await act(async () => {
        await pendingRead.promise
      })

      expect(viewer.container.querySelector('[data-image-preview-img]')).toBeNull()
      expect(readImagePreviewState(viewer.container)).toBe('fallback')
      const summary = viewer.container.querySelector('[data-image-fallback-summary]')
      expect(summary).not.toBeNull()
      expect(summary?.textContent).toContain('Asset read failed.')
    } finally {
      await viewer.unmount()
    }
  })

  it('clears the previous frame when a same-path reload rejects', async () => {
    const observation = createImageObservation()
    const asset = createImageAssetDescriptor()
    const transport = createImageTransportClient({ asset })
    const reloadObservation = createImageObservation({
      file: {
        path: '/workspace/lab/cell.png',
        workspaceRoot: '/workspace/lab',
        mimeType: 'image/png',
        size: 8,
        mtimeMs: 4000
      }
    })
    const reloadAsset = createImageAssetDescriptor({
      sessionId: 'session-image-rejected',
      assetId: 'asset:session-image-rejected'
    })
    const reloadTransport = createImageTransportClient({
      asset: reloadAsset,
      readBytes: async () => {
        throw new Error('Transport is offline.')
      }
    })
    const viewer = mountImageWorkspaceViewer()

    try {
      await viewer.renderImageWorkspaceViewer({ observation, asset, transport })
      expect(viewer.container.querySelector('[data-image-preview-img]')).not.toBeNull()

      await viewer.renderImageWorkspaceViewer({
        observation: reloadObservation,
        asset: reloadAsset,
        transport: reloadTransport
      })

      expect(viewer.container.querySelector('[data-image-preview-img]')).toBeNull()
      expect(readImagePreviewState(viewer.container)).toBe('error')
      expect(viewer.container.querySelector('[data-image-fallback-summary]')?.textContent)
        .toContain('Transport is offline.')
    } finally {
      await viewer.unmount()
    }
  })

  it('drops a stale result for a superseded content key', async () => {
    const observation = createImageObservation()
    const asset = createImageAssetDescriptor()
    const transport = createImageTransportClient({ asset })
    const viewer = mountImageWorkspaceViewer()

    const supersededAsset = createImageAssetDescriptor({
      sessionId: 'session-image-slow',
      assetId: 'asset:session-image-slow'
    })
    const slowRead = createDeferred<ReadBytesResult>()
    const supersededTransport = createImageTransportClient({
      asset: supersededAsset,
      readBytes: () => slowRead.promise
    })
    const newestBytes = Uint8Array.from([0x11, 0x22, 0x33, 0x44, 0x55])
    const newestAsset = createImageAssetDescriptor({
      sessionId: 'session-image-new',
      assetId: 'asset:session-image-new'
    })
    const newestTransport = createImageTransportClient({ asset: newestAsset, bytes: newestBytes })

    try {
      await viewer.renderImageWorkspaceViewer({ observation, asset, transport })
      const image = viewer.container.querySelector('[data-image-preview-img]')

      await viewer.renderImageWorkspaceViewer({
        observation,
        asset: supersededAsset,
        transport: supersededTransport
      })
      await viewer.renderImageWorkspaceViewer({
        observation,
        asset: newestAsset,
        transport: newestTransport
      })

      expect(viewer.container.querySelector('[data-image-preview-img]')?.getAttribute('src'))
        .toBe(createImageWorkspaceViewerDataUrl(newestBytes, 'image/png'))

      slowRead.resolve({
        ok: true,
        bytes: Uint8Array.from([0xaa, 0xbb, 0xcc, 0xdd]),
        bytesRead: 4,
        truncated: false
      })
      await act(async () => {
        await slowRead.promise
      })

      expect(viewer.container.querySelector('[data-image-preview-img]')).toBe(image)
      expect(viewer.container.querySelector('[data-image-preview-img]')?.getAttribute('src'))
        .toBe(createImageWorkspaceViewerDataUrl(newestBytes, 'image/png'))
      expect(readImagePreviewState(viewer.container)).toBe('ready')
    } finally {
      await viewer.unmount()
    }
  })

  it('shows the loading summary instead of reusing the frame for a different file', async () => {
    const observation = createImageObservation()
    const asset = createImageAssetDescriptor()
    const transport = createImageTransportClient({ asset })
    const otherObservation = createImageObservation({
      file: {
        path: '/workspace/lab/other.png',
        workspaceRoot: '/workspace/lab',
        mimeType: 'image/png',
        size: 4
      }
    })
    const otherAsset = createImageAssetDescriptor({
      sessionId: 'session-image-other',
      assetId: 'asset:session-image-other',
      file: {
        name: 'other.png',
        relativePath: 'other.png',
        mimeType: 'image/png',
        size: 4
      }
    })
    const otherRead = createDeferred<ReadBytesResult>()
    const otherTransport = createImageTransportClient({
      asset: otherAsset,
      readBytes: () => otherRead.promise
    })
    const viewer = mountImageWorkspaceViewer()

    try {
      await viewer.renderImageWorkspaceViewer({ observation, asset, transport })
      expect(viewer.container.querySelector('[data-image-preview-img]')).not.toBeNull()

      await viewer.renderImageWorkspaceViewer({
        observation: otherObservation,
        asset: otherAsset,
        transport: otherTransport
      })

      expect(otherTransport.readBytesIfWithin).toHaveBeenCalledTimes(1)
      expect(viewer.container.querySelector('[data-image-preview-img]')).toBeNull()
      expect(viewer.container.querySelector('[data-image-fallback-summary]')).not.toBeNull()
      expect(readImagePreviewState(viewer.container)).toBe('loading')
    } finally {
      await viewer.unmount()
    }
  })

  it('does not repeat the transport read when a settled fallback re-renders with identical content', async () => {
    const observation = createImageObservation()
    const asset = createImageAssetDescriptor()
    const transport = createImageTransportClient({
      asset,
      readResult: { ok: false, message: 'Asset read failed.' }
    })
    const viewer = mountImageWorkspaceViewer()

    try {
      await viewer.renderImageWorkspaceViewer({ observation, asset, transport })
      expect(transport.readBytesIfWithin).toHaveBeenCalledTimes(1)
      expect(viewer.container.querySelector('[data-image-fallback-summary]')).not.toBeNull()
      expect(readImagePreviewState(viewer.container)).toBe('fallback')

      const nextTransport = createImageTransportClient({ asset: createImageAssetDescriptor() })
      await viewer.renderImageWorkspaceViewer({
        observation: createImageObservation(),
        asset: createImageAssetDescriptor(),
        transport: nextTransport
      })

      expect(transport.readBytesIfWithin).toHaveBeenCalledTimes(1)
      expect(nextTransport.readBytesIfWithin).not.toHaveBeenCalled()
      expect(readImagePreviewState(viewer.container)).toBe('fallback')
    } finally {
      await viewer.unmount()
    }
  })

  it('keeps the zoom selection across a same-path reload and resets it for a different file', async () => {
    const observation = createImageObservation()
    const asset = createImageAssetDescriptor()
    const transport = createImageTransportClient({ asset })
    const reloadAsset = createImageAssetDescriptor({
      sessionId: 'session-image-zoom',
      assetId: 'asset:session-image-zoom'
    })
    const reloadRead = createDeferred<ReadBytesResult>()
    const reloadTransport = createImageTransportClient({
      asset: reloadAsset,
      readBytes: () => reloadRead.promise
    })
    const viewer = mountImageWorkspaceViewer()

    try {
      await viewer.renderImageWorkspaceViewer({ observation, asset, transport })
      const zoomIn = viewer.container.querySelector<HTMLButtonElement>('[data-image-zoom-in]')
      await act(async () => zoomIn?.click())

      const viewerSection = viewer.container.querySelector('[data-workspace-preview-image-viewer]')
      expect(viewerSection?.getAttribute('data-zoom-factor')).toBe('1.25')

      await viewer.renderImageWorkspaceViewer({ observation, asset: reloadAsset, transport: reloadTransport })
      expect(viewerSection?.getAttribute('data-zoom-factor')).toBe('1.25')
      expect(viewerSection?.getAttribute('data-fit-mode')).toBe('manual')

      const otherObservation = createImageObservation({
        file: {
          path: '/workspace/lab/other.png',
          workspaceRoot: '/workspace/lab',
          mimeType: 'image/png',
          size: 4
        }
      })
      const otherAsset = createImageAssetDescriptor({
        sessionId: 'session-image-zoom-other',
        assetId: 'asset:session-image-zoom-other',
        file: {
          name: 'other.png',
          relativePath: 'other.png',
          mimeType: 'image/png',
          size: 4
        }
      })
      await viewer.renderImageWorkspaceViewer({
        observation: otherObservation,
        asset: otherAsset,
        transport: createImageTransportClient({ asset: otherAsset, readBytes: () => reloadRead.promise })
      })
      expect(viewerSection?.getAttribute('data-zoom-factor')).toBe('1.00')
      expect(viewerSection?.getAttribute('data-fit-mode')).toBe('fit')
    } finally {
      await viewer.unmount()
    }
  })
})

describe('ImageWorkspaceViewer opening state', () => {
  it('shows an explicit loading state while the shell opens a document', async () => {
    const transport = createImageTransportClient({ asset: createImageAssetDescriptor() })
    const viewer = mountImageWorkspaceViewer()

    try {
      await viewer.renderImageWorkspaceViewer({ observation: null, asset: null, transport, opening: true })

      expect(readImagePreviewState(viewer.container)).toBe('loading')
      expect(viewer.container.querySelector('[data-image-loading-summary]')).not.toBeNull()
      expect(viewer.container.querySelector('[data-image-fallback-summary]')).toBeNull()
      expect(viewer.container.querySelector('[data-image-preview-img]')).toBeNull()
      expect(viewer.container.textContent).not.toContain('Open an image workspace preview')
      expect(transport.readBytesIfWithin).not.toHaveBeenCalled()
    } finally {
      await viewer.unmount()
    }
  })

  it('keeps the empty-model summary when opening is omitted or false', async () => {
    const transport = createImageTransportClient({ asset: createImageAssetDescriptor() })
    const viewer = mountImageWorkspaceViewer()

    try {
      await viewer.renderImageWorkspaceViewer({ observation: null, asset: null, transport })
      expect(readImagePreviewState(viewer.container)).toBe('fallback')
      expect(viewer.container.querySelector('[data-image-loading-summary]')).toBeNull()
      expect(viewer.container.querySelector('[data-image-fallback-summary]')?.textContent)
        .toContain('No image observation')

      await viewer.renderImageWorkspaceViewer({ observation: null, asset: null, transport, opening: false })
      expect(readImagePreviewState(viewer.container)).toBe('fallback')
      expect(viewer.container.querySelector('[data-image-loading-summary]')).toBeNull()
      expect(viewer.container.querySelector('[data-image-fallback-summary]')?.textContent)
        .toContain('Open an image workspace preview')
    } finally {
      await viewer.unmount()
    }
  })

  it('lets a genuine ready-model failure win over opening', async () => {
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
    const viewer = mountImageWorkspaceViewer()

    try {
      await viewer.renderImageWorkspaceViewer({ observation, asset, transport, maxBytes: 4, opening: true })

      expect(readImagePreviewState(viewer.container)).toBe('fallback')
      expect(viewer.container.querySelector('[data-image-loading-summary]')).toBeNull()
      expect(viewer.container.querySelector('[data-image-fallback-summary]')?.textContent)
        .toContain('inline image preview is limited to 4 B')
      expect(viewer.container.querySelector('[data-image-preview-img]')).toBeNull()
    } finally {
      await viewer.unmount()
    }
  })

  it('does not render previous bytes for a different document while opening', async () => {
    const observation = createImageObservation()
    const asset = createImageAssetDescriptor()
    const transport = createImageTransportClient({ asset })
    const viewer = mountImageWorkspaceViewer()

    try {
      await viewer.renderImageWorkspaceViewer({ observation, asset, transport })
      expect(viewer.container.querySelector('[data-image-preview-img]')).not.toBeNull()
      expect(transport.readBytesIfWithin).toHaveBeenCalledTimes(1)

      await viewer.renderImageWorkspaceViewer({ observation: null, asset: null, transport, opening: true })

      expect(readImagePreviewState(viewer.container)).toBe('loading')
      expect(viewer.container.querySelector('[data-image-loading-summary]')).not.toBeNull()
      expect(viewer.container.querySelector('[data-image-preview-img]')).toBeNull()
      expect(viewer.container.querySelector('[data-image-fallback-summary]')).toBeNull()
      expect(transport.readBytesIfWithin).toHaveBeenCalledTimes(1)
    } finally {
      await viewer.unmount()
    }
  })

  it('treats a non-ready model as still opening while opening is set', async () => {
    const unsupportedObservation = createImageObservation({
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
    const viewer = mountImageWorkspaceViewer()

    try {
      await viewer.renderImageWorkspaceViewer({ observation: unsupportedObservation, opening: true })
      expect(readImagePreviewState(viewer.container)).toBe('loading')
      expect(viewer.container.querySelector('[data-image-loading-summary]')).not.toBeNull()
      expect(viewer.container.querySelector('[data-image-fallback-summary]')).toBeNull()

      await viewer.renderImageWorkspaceViewer({ observation: unsupportedObservation })
      expect(readImagePreviewState(viewer.container)).toBe('fallback')
      expect(viewer.container.querySelector('[data-image-fallback-summary]')?.textContent)
        .toContain('Tabular observations cannot be rendered')
    } finally {
      await viewer.unmount()
    }
  })

  it('keeps the previewState override ahead of opening', async () => {
    const override: ImageWorkspaceViewerPreviewState = {
      kind: 'fallback',
      title: 'Image bytes unavailable',
      message: 'No workspace preview asset descriptor is available for this image.'
    }
    const viewer = mountImageWorkspaceViewer()

    try {
      await viewer.renderImageWorkspaceViewer({ observation: null, previewState: override, opening: true })
      expect(readImagePreviewState(viewer.container)).toBe('fallback')
      expect(viewer.container.querySelector('[data-image-loading-summary]')).toBeNull()
      expect(viewer.container.querySelector('[data-image-fallback-summary]')?.textContent)
        .toContain('No image observation')
    } finally {
      await viewer.unmount()
    }
  })

  it('keeps the decoded frame and reports refreshing while the shell re-opens the same document', async () => {
    const observation = createImageObservation()
    const asset = createImageAssetDescriptor()
    const transport = createImageTransportClient({ asset })
    const viewer = mountImageWorkspaceViewer()

    try {
      await viewer.renderImageWorkspaceViewer({ observation, asset, transport })
      const image = viewer.container.querySelector('[data-image-preview-img]')
      expect(readImagePreviewState(viewer.container)).toBe('ready')

      await viewer.renderImageWorkspaceViewer({ observation, asset, transport, opening: true })
      expect(readImagePreviewState(viewer.container)).toBe('refreshing')
      expect(viewer.container.querySelector('[data-image-preview-img]')).toBe(image)
      expect(transport.readBytesIfWithin).toHaveBeenCalledTimes(1)
      expect(viewer.container.querySelector('[data-image-loading-summary]')).toBeNull()
      expect(viewer.container.querySelector('[data-image-fallback-summary]')).toBeNull()

      await viewer.renderImageWorkspaceViewer({ observation, asset, transport })
      expect(readImagePreviewState(viewer.container)).toBe('ready')
      expect(viewer.container.querySelector('[data-image-preview-img]')).toBe(image)
    } finally {
      await viewer.unmount()
    }
  })

  it('shows the opening state while a ready observation has no asset yet', async () => {
    const observation = createImageObservation()
    const viewer = mountImageWorkspaceViewer()

    try {
      await viewer.renderImageWorkspaceViewer({ observation, asset: null, transport: null, opening: true })
      expect(readImagePreviewState(viewer.container)).toBe('loading')
      expect(viewer.container.querySelector('[data-image-loading-summary]')).not.toBeNull()
      expect(viewer.container.querySelector('[data-image-fallback-summary]')).toBeNull()
      expect(viewer.container.querySelector('[data-image-preview-img]')).toBeNull()

      await viewer.renderImageWorkspaceViewer({ observation, asset: null, transport: null })
      expect(readImagePreviewState(viewer.container)).toBe('fallback')
      expect(viewer.container.querySelector('[data-image-loading-summary]')).toBeNull()
      expect(viewer.container.querySelector('[data-image-fallback-summary]')?.textContent)
        .toContain('No workspace preview asset descriptor is available')
    } finally {
      await viewer.unmount()
    }
  })

  it('restores the concluded result when the same content identity comes back', async () => {
    const observation = createImageObservation()
    const asset = createImageAssetDescriptor()
    const transport = createImageTransportClient({ asset })
    const viewer = mountImageWorkspaceViewer()

    try {
      await viewer.renderImageWorkspaceViewer({ observation, asset, transport })
      const image = viewer.container.querySelector('[data-image-preview-img]')
      expect(readImagePreviewState(viewer.container)).toBe('ready')

      await viewer.renderImageWorkspaceViewer({ observation, asset: null, transport: null, opening: true })
      expect(readImagePreviewState(viewer.container)).toBe('refreshing')
      expect(viewer.container.querySelector('[data-image-preview-img]')).toBe(image)

      await viewer.renderImageWorkspaceViewer({ observation, asset, transport })
      expect(readImagePreviewState(viewer.container)).toBe('ready')
      expect(viewer.container.querySelector('[data-image-preview-img]')).toBe(image)
      expect(transport.readBytesIfWithin).toHaveBeenCalledTimes(1)
      expect(viewer.container.querySelector('[data-image-fallback-summary]')).toBeNull()
    } finally {
      await viewer.unmount()
    }
  })
})
