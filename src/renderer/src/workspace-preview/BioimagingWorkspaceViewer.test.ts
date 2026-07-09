import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  WORKSPACE_PREVIEW_CONTRACT_VERSION,
  type WorkspaceObservation,
  type WorkspacePreviewArtifactDescriptor,
  type WorkspacePreviewAssetTransportDescriptor
} from '@shared/workspace-preview'
import {
  BioimagingWorkspaceViewer,
  buildBioimagingTileArtifactRequest,
  buildBioimagingTileOverviewModel,
  buildBioimagingWorkspaceViewerModel,
  loadBioimagingArtifactDataUrl
} from './BioimagingWorkspaceViewer'
import type { WorkspacePreviewAssetTransportClient } from './host'

function createBioimagingObservation(
  overrides: Partial<WorkspaceObservation> = {}
): WorkspaceObservation {
  return {
    schemaVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
    file: {
      path: '/workspace/lab/cells.ome.tiff',
      workspaceRoot: '/workspace/lab',
      mimeType: 'image/tiff',
      size: 4096
    },
    view: {
      pluginId: 'bioimaging',
      modality: 'bioimaging',
      mode: 'preview',
      title: 'cells.ome.tiff'
    },
    bioimaging: {
      dimensions: {
        width: 2048,
        height: 1024,
        z: 3,
        t: 5
      },
      channels: ['DAPI', 'FITC', 'TRITC']
    },
    selection: {
      kind: 'bioimaging',
      roiIds: ['roi-1', 'roi-2'],
      channels: ['DAPI', 'FITC'],
      regions: [{ x: 10, y: 20, width: 100, height: 80, z: 1, t: 2 }]
    },
    annotations: [
      {
        id: 'ann-1',
        kind: 'roi-annotation',
        summary: 'Nucleus ROI'
      }
    ],
    actions: [
      'bioimaging.selectRegion',
      'bioimaging.selectChannels',
      'bioimaging.annotateRegion',
      'bioimaging.exportRoiSet',
      'bioimaging.inspectHeader'
    ],
    ...overrides
  }
}

function createBioimagingTileArtifact(
  overrides: Partial<WorkspacePreviewArtifactDescriptor> = {}
): WorkspacePreviewArtifactDescriptor {
  return {
    schemaVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
    sessionId: 'session-bioimaging-artifact',
    assetId: 'asset:session-bioimaging-artifact',
    artifactId: 'artifact:bioimaging-tile',
    kind: 'tile',
    pluginId: 'bioimaging',
    mimeType: 'image/png',
    byteLength: 8,
    range: {
      available: true,
      size: 8,
      maxChunkBytes: 4 * 1024 * 1024,
      recommendedChunkBytes: 8
    },
    source: {
      assetId: 'asset:session-bioimaging-artifact',
      size: 4096,
      mtimeMs: 42
    },
    cache: {
      scope: 'session',
      source: 'worker-decoder',
      createdAt: '2026-07-08T00:00:00.000Z',
      invalidation: 'source-size-mtime'
    },
    tile: {
      level: 0,
      x: 0,
      y: 0,
      width: 128,
      height: 64
    },
    ...overrides
  }
}

function createBioimagingAssetDescriptor(
  input: {
    sessionId: string
    artifacts?: WorkspacePreviewArtifactDescriptor[]
  }
): WorkspacePreviewAssetTransportDescriptor {
  return {
    schemaVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
    sessionId: input.sessionId,
    assetId: `asset:${input.sessionId}`,
    pluginId: 'bioimaging',
    modality: 'bioimaging',
    file: {
      name: 'cells.ome.tiff',
      relativePath: 'cells.ome.tiff',
      mimeType: 'image/tiff',
      size: 4096,
      mtimeMs: 42
    },
    primary: 'byte-range',
    eagerRead: {
      allowed: false,
      reason: 'large scientific asset'
    },
    range: {
      available: true,
      maxChunkBytes: 4 * 1024 * 1024,
      recommendedChunkBytes: 1024 * 1024,
      size: 4096
    },
    strategies: [
      {
        kind: 'byte-range',
        status: 'available',
        reason: 'bounded reads',
        maxChunkBytes: 4 * 1024 * 1024
      },
      {
        kind: 'tile',
        status: 'available',
        reason: 'worker artifact decoder'
      }
    ],
    artifacts: input.artifacts ?? []
  }
}

function createBioimagingTransport(input: {
  sessionId: string
  artifacts?: WorkspacePreviewArtifactDescriptor[]
  prepareArtifact?: WorkspacePreviewAssetTransportClient['prepareArtifact']
  readArtifactRange?: WorkspacePreviewAssetTransportClient['readArtifactRange']
}): WorkspacePreviewAssetTransportClient {
  const descriptor = createBioimagingAssetDescriptor({
    sessionId: input.sessionId,
    artifacts: input.artifacts
  })
  const prepareArtifact = input.prepareArtifact ?? vi.fn<WorkspacePreviewAssetTransportClient['prepareArtifact']>(async () => ({
    ok: false,
    message: 'prepareArtifact not mocked'
  }))
  const readArtifactRange = input.readArtifactRange ?? vi.fn<WorkspacePreviewAssetTransportClient['readArtifactRange']>(async () => ({
    ok: false,
    message: 'readArtifactRange not mocked'
  }))

  return {
    descriptor,
    strategyStatus: (kind) => descriptor.strategies.find((strategy) => strategy.kind === kind) ?? null,
    readRange: vi.fn<WorkspacePreviewAssetTransportClient['readRange']>(async () => ({
      ok: false,
      message: 'readRange not mocked'
    })),
    prepareArtifact,
    readArtifactRange,
    artifact: (artifactId) => descriptor.artifacts?.find((artifact) => artifact.artifactId === artifactId) ?? null,
    readBytesIfWithin: vi.fn<WorkspacePreviewAssetTransportClient['readBytesIfWithin']>(async () => ({
      ok: false,
      message: 'readBytesIfWithin not mocked'
    })),
    readTextIfWithin: vi.fn<WorkspacePreviewAssetTransportClient['readTextIfWithin']>(async () => ({
      ok: false,
      message: 'readTextIfWithin not mocked'
    }))
  }
}

describe('BioimagingWorkspaceViewer', () => {
  it('builds an agent-readable bioimaging view model from metadata, ROI selection, annotations, and actions', () => {
    const model = buildBioimagingWorkspaceViewerModel(createBioimagingObservation())
    const rowsById = new Map(model.imageRows.map((row) => [row.id, row]))

    expect(model.status.kind).toBe('ready')
    expect(rowsById.get('dimensions')).toMatchObject({
      label: 'Dimensions',
      value: '2048 x 1024, Z 3, T 5'
    })
    expect(rowsById.get('channels')).toMatchObject({
      label: 'Channels',
      value: 'DAPI, FITC, TRITC',
      description: 'Selected: DAPI, FITC'
    })
    expect(rowsById.get('roi-selection')).toMatchObject({
      label: 'ROI Selection',
      value: '2 ROIs, 1 region'
    })
    expect(model.selection.summary).toBe('Selected 2 ROIs, 2 channels, 1 region.')
    expect(model.annotations).toEqual([
      {
        id: 'ann-1',
        kind: 'roi-annotation',
        label: 'Roi Annotation',
        summary: 'Nucleus ROI'
      }
    ])
    expect(model.actions.map((action) => [action.id, action.kind])).toEqual([
      ['bioimaging.selectRegion', 'select-region'],
      ['bioimaging.selectChannels', 'select-channels'],
      ['bioimaging.annotateRegion', 'annotate'],
      ['bioimaging.exportRoiSet', 'export'],
      ['bioimaging.inspectHeader', 'inspect']
    ])
    expect(model.agentSummary).toContain('viewport: metadata-only placeholder')
  })

  it('reports empty and unsupported states without rendering the metadata viewport', () => {
    const empty = buildBioimagingWorkspaceViewerModel(null)
    const unsupported = buildBioimagingWorkspaceViewerModel({
      schemaVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
      file: {
        path: '/workspace/lab/protein.pdb'
      },
      view: {
        pluginId: 'molecular',
        modality: 'molecular',
        mode: 'preview',
        title: 'protein.pdb'
      },
      actions: []
    })
    const emptyHtml = renderToStaticMarkup(createElement(BioimagingWorkspaceViewer, { model: empty }))
    const unsupportedHtml = renderToStaticMarkup(createElement(BioimagingWorkspaceViewer, { model: unsupported }))

    expect(empty.status).toMatchObject({
      kind: 'empty',
      title: 'No bioimaging observation'
    })
    expect(unsupported.status).toMatchObject({
      kind: 'unsupported',
      title: 'Unsupported observation'
    })
    expect(emptyHtml).toContain('data-status="empty"')
    expect(emptyHtml).not.toContain('data-metadata-only-viewport-placeholder')
    expect(unsupportedHtml).toContain('Molecular observations cannot be rendered')
  })

  it('renders metadata-only viewport, ROI details, annotations, and actions', () => {
    const html = renderToStaticMarkup(createElement(BioimagingWorkspaceViewer, {
      observation: createBioimagingObservation()
    }))

    expect(html).toContain('data-workspace-preview-bioimaging-viewer')
    expect(html).toContain('data-metadata-only-viewport-placeholder')
    expect(html).toContain('Bioimaging metadata-only viewport placeholder')
    expect(html).toContain('Selected ROIs')
    expect(html).toContain('roi-1, roi-2')
    expect(html).toContain('Nucleus ROI')
    expect(html).toContain('data-action-kind="annotate"')
  })

  it('renders a metadata-only virtual tile overview with bounded ROI overlays when tile plan metadata is available', () => {
    const observation = createBioimagingObservation({
      bioimaging: {
        dimensions: {
          width: 2048,
          height: 1024,
          z: 3,
          t: 5
        },
        channels: ['DAPI', 'FITC', 'TRITC'],
        tilePlan: {
          status: 'metadata-only',
          source: 'ome-tiff-metadata',
          levelCount: 4,
          tileSize: {
            width: 512,
            height: 256
          },
          pixelDecoding: false,
          tileRendererImplemented: false
        }
      }
    })
    const model = buildBioimagingWorkspaceViewerModel(observation)
    const overview = buildBioimagingTileOverviewModel(observation)
    const rowsById = new Map(model.imageRows.map((row) => [row.id, row]))
    const html = renderToStaticMarkup(createElement(BioimagingWorkspaceViewer, { model }))

    expect(model.status).toMatchObject({
      kind: 'ready',
      title: 'Bioimaging tile overview ready'
    })
    expect(overview).toMatchObject({
      kind: 'overview',
      imageWidth: 2048,
      imageHeight: 1024,
      tileWidth: 512,
      tileHeight: 256,
      columns: 4,
      rows: 4,
      levelCount: 4,
      source: 'ome-tiff-metadata',
      pixelDecoding: false,
      tileRendererImplemented: false,
      channelCount: 3,
      selectedChannelCount: 2
    })
    expect(model.agentSummary).toContain('tile overview: 4 x 4 metadata tiles')
    expect(rowsById.get('tile-plan')).toMatchObject({
      label: 'Tile Plan',
      value: 'metadata-only, 4 x 4 virtual tiles, 512 x 256, 4 levels, ome-tiff-metadata'
    })
    expect(html).toContain('data-bioimaging-metadata-tile-overview="true"')
    expect(html).toContain('data-pixel-decoding="false"')
    expect(html).toContain('data-tile-renderer-implemented="false"')
    expect(html).toContain('data-tile-source="ome-tiff-metadata"')
    expect(html).toContain('data-tile-level-count="4"')
    expect(html).toContain('data-tile-columns="4"')
    expect(html).toContain('data-tile-rows="4"')
    expect(html).toContain('data-image-width="2048"')
    expect(html).toContain('data-image-height="1024"')
    expect(html).toContain('data-channel-count="3"')
    expect(html).toContain('data-selected-channel-count="2"')
    expect(html).toContain('data-bioimaging-virtual-tile-grid="true"')
    expect(html).toContain('data-bioimaging-roi-overlay="true"')
    expect(html).toContain('data-roi-id="roi-1"')
    expect(html).not.toContain('data-metadata-only-viewport-placeholder')
  })

  it('derives a bounded tile artifact request from the metadata tile overview', () => {
    const observation = createBioimagingObservation({
      bioimaging: {
        dimensions: {
          width: 300,
          height: 180
        },
        tilePlan: {
          status: 'metadata-only',
          source: 'tiff-metadata',
          levelCount: 1,
          tileSize: {
            width: 512,
            height: 512
          },
          pixelDecoding: false,
          tileRendererImplemented: false
        }
      }
    })

    expect(buildBioimagingTileArtifactRequest(buildBioimagingTileOverviewModel(observation))).toEqual({
      kind: 'tile',
      level: 0,
      x: 0,
      y: 0,
      width: 300,
      height: 180
    })
    expect(buildBioimagingTileArtifactRequest({ kind: 'placeholder', title: 'No tile', message: 'No tile' })).toBeNull()
  })

  it('renders prepared tile artifact data URLs and fallback states without file URLs', () => {
    const observation = createBioimagingObservation({
      bioimaging: {
        dimensions: {
          width: 512,
          height: 512
        },
        channels: ['DAPI'],
        tilePlan: {
          status: 'metadata-only',
          source: 'tiff-metadata',
          levelCount: 1,
          tileSize: {
            width: 256,
            height: 256
          },
          pixelDecoding: false,
          tileRendererImplemented: false
        }
      }
    })
    const model = buildBioimagingWorkspaceViewerModel(observation)
    const readyHtml = renderToStaticMarkup(createElement(BioimagingWorkspaceViewer, {
      model,
      renderedTile: {
        kind: 'ready',
        dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
        artifactId: 'artifact:tile-1',
        width: 256,
        height: 256,
        mimeType: 'image/png'
      }
    }))
    const fallbackHtml = renderToStaticMarkup(createElement(BioimagingWorkspaceViewer, {
      model,
      renderedTile: {
        kind: 'fallback',
        message: 'Only uncompressed TIFF tiles are currently decoded.'
      }
    }))

    expect(readyHtml).toContain('data-bioimaging-rendered-tile-state="ready"')
    expect(readyHtml).toContain('data-bioimaging-rendered-tile="true"')
    expect(readyHtml).toContain('data:image/png;base64,iVBORw0KGgo=')
    expect(readyHtml).toContain('data-artifact-id="artifact:tile-1"')
    expect(readyHtml).not.toContain('file://')
    expect(fallbackHtml).toContain('data-bioimaging-rendered-tile-state="fallback"')
    expect(fallbackHtml).toContain('Tile artifact fallback')
    expect(fallbackHtml).toContain('Only uncompressed TIFF tiles are currently decoded.')
  })

  it('loads tile artifact data through the transport once per asset request', async () => {
    const artifact = createBioimagingTileArtifact({
      sessionId: 'session-bioimaging-loader-cache',
      assetId: 'asset:session-bioimaging-loader-cache',
      artifactId: 'artifact:bioimaging-tile-cache',
      source: {
        assetId: 'asset:session-bioimaging-loader-cache',
        size: 4096,
        mtimeMs: 42
      }
    })
    const prepareArtifact = vi.fn<WorkspacePreviewAssetTransportClient['prepareArtifact']>(async () => ({
      ok: true as const,
      sessionId: 'session-bioimaging-loader-cache',
      artifact
    }))
    const readArtifactRange = vi.fn<WorkspacePreviewAssetTransportClient['readArtifactRange']>(async () => ({
      ok: true as const,
      sessionId: 'session-bioimaging-loader-cache',
      assetId: 'asset:session-bioimaging-loader-cache',
      artifactId: 'artifact:bioimaging-tile-cache',
      offset: 0,
      length: 8,
      size: 8,
      mimeType: 'image/png',
      dataBase64: 'iVBORw0KGgo='
    }))
    const transport = createBioimagingTransport({
      sessionId: 'session-bioimaging-loader-cache',
      prepareArtifact,
      readArtifactRange
    })
    const request = {
      kind: 'tile' as const,
      level: 0,
      x: 0,
      y: 0,
      width: 128,
      height: 64
    }

    const first = await loadBioimagingArtifactDataUrl(transport, request)
    const second = await loadBioimagingArtifactDataUrl(transport, request)

    expect(first).toEqual(second)
    expect(first).toMatchObject({
      kind: 'ready',
      dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
      artifactId: 'artifact:bioimaging-tile-cache',
      width: 128,
      height: 64,
      mimeType: 'image/png'
    })
    expect(prepareArtifact).toHaveBeenCalledTimes(1)
    expect(readArtifactRange).toHaveBeenCalledTimes(1)
    expect(readArtifactRange).toHaveBeenCalledWith({
      artifactId: 'artifact:bioimaging-tile-cache',
      range: { offset: 0, length: 8 }
    })
    expect(JSON.stringify(first)).not.toContain('file://')
  })

  it('reuses matching descriptor tile artifacts without preparing duplicates', async () => {
    const artifact = createBioimagingTileArtifact({
      sessionId: 'session-bioimaging-loader-descriptor',
      assetId: 'asset:session-bioimaging-loader-descriptor',
      artifactId: 'artifact:bioimaging-tile-descriptor',
      source: {
        assetId: 'asset:session-bioimaging-loader-descriptor',
        size: 4096,
        mtimeMs: 42
      }
    })
    const prepareArtifact = vi.fn<WorkspacePreviewAssetTransportClient['prepareArtifact']>(async () => ({
      ok: false,
      message: 'prepareArtifact should not be called'
    }))
    const readArtifactRange = vi.fn<WorkspacePreviewAssetTransportClient['readArtifactRange']>(async () => ({
      ok: true as const,
      sessionId: 'session-bioimaging-loader-descriptor',
      assetId: 'asset:session-bioimaging-loader-descriptor',
      artifactId: 'artifact:bioimaging-tile-descriptor',
      offset: 0,
      length: 8,
      size: 8,
      mimeType: 'image/png',
      dataBase64: 'iVBORw0KGgo='
    }))
    const transport = createBioimagingTransport({
      sessionId: 'session-bioimaging-loader-descriptor',
      artifacts: [artifact],
      prepareArtifact,
      readArtifactRange
    })

    await expect(loadBioimagingArtifactDataUrl(transport, {
      kind: 'tile',
      level: 0,
      x: 0,
      y: 0,
      width: 128,
      height: 64
    })).resolves.toMatchObject({
      kind: 'ready',
      artifactId: 'artifact:bioimaging-tile-descriptor'
    })
    expect(prepareArtifact).not.toHaveBeenCalled()
    expect(readArtifactRange).toHaveBeenCalledTimes(1)
  })
})
