import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  WORKSPACE_PREVIEW_CONTRACT_VERSION,
  type WorkspaceObservation
} from '@shared/workspace-preview'
import {
  BioimagingWorkspaceViewer,
  buildBioimagingTileOverviewModel,
  buildBioimagingWorkspaceViewerModel
} from './BioimagingWorkspaceViewer'

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
})
