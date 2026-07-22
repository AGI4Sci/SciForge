import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  WORKSPACE_PREVIEW_CONTRACT_VERSION
} from '@sciforge/domain-sdk/workspace-preview'
import type { LifeScienceWorkspaceObservation as WorkspaceObservation } from '../wire'
import {
  buildSpectraWorkspaceViewerModel,
  SpectraWorkspaceViewer
} from './SpectraWorkspaceViewer'

function createSpectraObservation(
  overrides: Partial<WorkspaceObservation> = {}
): WorkspaceObservation {
  return {
    schemaVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
    file: {
      path: '/workspace/lab/sample.mgf',
      workspaceRoot: '/workspace/lab',
      mimeType: 'application/octet-stream',
      size: 8192
    },
    view: {
      pluginId: 'proteomics-spectra',
      modality: 'spectra',
      mode: 'preview',
      title: 'sample.mgf'
    },
    spectra: {
      spectrumCount: 12,
      peakCount: 340,
      xAxis: 'm/z',
      mzRange: { min: 100, max: 450 },
      intensityRange: { min: 0, max: 900 },
      sampledPeaks: [
        { spectrumIndex: 0, peakIndex: 0, mz: 123.4567, intensity: 88, label: 'b2' },
        { spectrumIndex: 0, peakIndex: 1, mz: 234.5, intensity: 120 },
        { spectrumIndex: 1, peakIndex: 0, mz: 410, intensity: 760, label: 'y7' }
      ]
    },
    selection: {
      kind: 'spectra',
      ranges: [{ xStart: 100, xEnd: 450, yStart: 20, yEnd: 900 }],
      peaks: [
        { mz: 123.4567, intensity: 88, label: 'b2' },
        { mz: 234.5, intensity: 120 }
      ]
    },
    actions: [
      'spectra.inspectScans',
      'spectra.selectPeaksByRange',
      'spectra.annotateRange',
      'spectra.exportPeakList'
    ],
    ...overrides
  }
}

describe('SpectraWorkspaceViewer', () => {
  it('builds an agent-readable spectra view model from counts, ranges, peaks, and actions', () => {
    const model = buildSpectraWorkspaceViewerModel(createSpectraObservation())
    const rowsById = new Map(model.spectrumRows.map((row) => [row.id, row]))

    expect(model.status.kind).toBe('ready')
    expect(rowsById.get('spectrum-count')).toMatchObject({
      label: 'Spectra',
      value: '12',
      description: '12 spectra'
    })
    expect(rowsById.get('peak-count')).toMatchObject({
      label: 'Peaks',
      value: '340',
      description: '340 peaks'
    })
    expect(rowsById.get('x-axis')).toMatchObject({
      label: 'X Axis',
      value: 'm/z'
    })
    expect(rowsById.get('sampled-peaks')).toMatchObject({
      label: 'Sampled Peaks',
      value: '3',
      description: '3 sampled peaks'
    })
    expect(model.viewport).toMatchObject({
      kind: 'plot',
      xAxis: 'm/z',
      xRange: { min: 100, max: 450 },
      intensityRange: { min: 0, max: 900 }
    })
    if (model.viewport.kind === 'plot') {
      expect(model.viewport.peaks).toHaveLength(3)
      expect(model.viewport.peaks[0]).toMatchObject({
        label: expect.stringContaining('b2'),
        selected: true
      })
      expect(model.viewport.ranges).toHaveLength(1)
    }
    expect(model.selection.summary).toBe('Selected 1 range, 2 peaks.')
    expect(model.selection.groups.map((group) => [group.id, group.summary])).toEqual([
      ['ranges', '1 range'],
      ['peaks', '2 peaks']
    ])
    expect(model.actions.map((action) => [action.id, action.kind])).toEqual([
      ['spectra.inspectScans', 'inspect'],
      ['spectra.selectPeaksByRange', 'select'],
      ['spectra.annotateRange', 'annotate'],
      ['spectra.exportPeakList', 'export']
    ])
    expect(model.agentSummary).toContain('sampled plot: 3 peaks')
    expect(model.agentSummary).toContain('preview: bounded peak plot')
  })

  it('builds a bounded scan marker preview when peak arrays are unavailable', () => {
    const model = buildSpectraWorkspaceViewerModel(createSpectraObservation({
      spectra: {
        format: 'mzml',
        spectrumCount: 2,
        peakCount: 300,
        scanCount: 2,
        xAxis: 'm/z',
        mzRange: { min: 90, max: 1200 },
        sampledPeaks: [],
        scanMarkers: [
          {
            index: 0,
            id: 'scan=1',
            msLevel: '1',
            peakCount: 100,
            mzRange: { min: 90, max: 600 }
          },
          {
            index: 1,
            id: 'scan=2',
            msLevel: '2',
            peakCount: 200,
            mzRange: { min: 450, max: 1200 }
          }
        ]
      },
      selection: undefined
    }))
    const html = renderToStaticMarkup(createElement(SpectraWorkspaceViewer, { model }))

    expect(model.viewport).toMatchObject({
      kind: 'scan-markers',
      xAxis: 'm/z',
      xRange: { min: 90, max: 1200 }
    })
    if (model.viewport.kind === 'scan-markers') {
      expect(model.viewport.markers).toHaveLength(2)
      expect(model.viewport.markers[0]).toMatchObject({
        id: 'scan-1-i0',
        label: expect.stringContaining('scan=1')
      })
    }
    expect(model.agentSummary).toContain('scan preview: 2 markers')
    expect(model.agentSummary).toContain('preview: bounded scan marker strip')
    expect(html).toContain('data-spectra-scan-marker-preview')
    expect(html).toContain('data-scan-marker-count="2"')
    expect(html).toContain('data-spectra-scan-marker-svg')
    expect(html).toContain('data-spectra-scan-marker="scan-1-i0"')
    expect(html).not.toContain('data-spectra-peak-plot')
  })

  it('reports empty and unsupported states without rendering the sampled preview placeholder', () => {
    const empty = buildSpectraWorkspaceViewerModel(null)
    const unsupported = buildSpectraWorkspaceViewerModel({
      schemaVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
      file: {
        path: '/workspace/lab/cells.ome.tiff'
      },
      view: {
        pluginId: 'bioimaging',
        modality: 'bioimaging',
        mode: 'preview',
        title: 'cells.ome.tiff'
      },
      actions: []
    })
    const emptyHtml = renderToStaticMarkup(createElement(SpectraWorkspaceViewer, { model: empty }))
    const unsupportedHtml = renderToStaticMarkup(createElement(SpectraWorkspaceViewer, { model: unsupported }))

    expect(empty.status).toMatchObject({
      kind: 'empty',
      title: 'No spectra observation'
    })
    expect(unsupported.status).toMatchObject({
      kind: 'unsupported',
      title: 'Unsupported observation'
    })
    expect(emptyHtml).toContain('data-status="empty"')
    expect(emptyHtml).not.toContain('data-spectra-peak-plot')
    expect(unsupportedHtml).toContain('Bioimaging observations cannot be rendered')
  })

  it('renders a bounded peak plot, selected ranges, peaks, and actions', () => {
    const html = renderToStaticMarkup(createElement(SpectraWorkspaceViewer, {
      observation: createSpectraObservation()
    }))

    expect(html).toContain('data-workspace-preview-spectra-viewer')
    expect(html).toContain('data-spectra-peak-plot')
    expect(html).toContain('data-peak-count="3"')
    expect(html).toContain('data-spectra-peak-plot-svg')
    expect(html).toContain('data-spectra-selected-range="range-0"')
    expect(html).toContain('data-spectra-peak="s0-p0-i0"')
    expect(html).toContain('data-selected="true"')
    expect(html).toContain('Bounded peak plot')
    expect(html).toContain('3 sampled peaks rendered from the workspace observation.')
    expect(html).toContain('Selected ranges')
    expect(html).toContain('m/z 100-450, intensity 20-900')
    expect(html).toContain('b2, m/z 123.4567, intensity 88')
    expect(html).toContain('data-action-kind="export"')
  })

  it('keeps the viewport explicit when spectra metadata has no sampled peaks', () => {
    const model = buildSpectraWorkspaceViewerModel(createSpectraObservation({
      spectra: {
        spectrumCount: 1,
        peakCount: 0,
        scanCount: 0,
        xAxis: 'm/z',
        sampledPeaks: []
      },
      selection: undefined
    }))
    const html = renderToStaticMarkup(createElement(SpectraWorkspaceViewer, { model }))

    expect(model.viewport).toMatchObject({
      kind: 'empty',
      title: 'Bounded peak plot'
    })
    expect(model.agentSummary).toContain('preview: no sampled peaks')
    expect(html).toContain('data-spectra-peak-plot-empty')
    expect(html).toContain('No sampled peaks were reported')
  })
})
