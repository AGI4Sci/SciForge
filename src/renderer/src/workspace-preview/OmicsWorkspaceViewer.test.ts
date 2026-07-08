import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  WORKSPACE_PREVIEW_CONTRACT_VERSION,
  type WorkspaceObservation
} from '@shared/workspace-preview'
import {
  buildOmicsWorkspaceViewerModel,
  OmicsWorkspaceViewer
} from './OmicsWorkspaceViewer'

function createOmicsObservation(
  overrides: Partial<WorkspaceObservation> = {}
): WorkspaceObservation {
  return {
    schemaVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
    file: {
      path: '/workspace/lab/counts.h5ad',
      workspaceRoot: '/workspace/lab',
      mimeType: 'application/x-hdf5',
      size: 16384
    },
    view: {
      pluginId: 'omics-matrix',
      modality: 'omics',
      mode: 'inspect',
      title: 'Single-cell counts'
    },
    omics: {
      format: 'h5ad',
      matrixShape: [1200, 340],
      matrixIds: ['X', 'layers/counts', 'raw/X'],
      observationCount: 1200,
      variableCount: 340,
      obsKeys: ['cell_type', 'batch', 'donor'],
      varKeys: ['gene_symbol', 'highly_variable'],
      embeddings: ['X_umap', 'X_pca'],
      metadataKeys: ['n_obs', 'n_vars', 'organism']
    },
    selection: {
      kind: 'omics',
      matrixIds: ['X', 'layers/counts'],
      obsKeys: ['cell_type', 'batch'],
      varKeys: ['gene_symbol'],
      embeddings: ['X_umap'],
      ranges: [
        {
          matrixId: 'X',
          matrixName: 'Expression',
          axis: 'obs',
          start: 10,
          end: 40,
          axisLength: 1200,
          clipped: true
        },
        {
          matrixId: 'layers/counts',
          axis: 'var',
          start: 20,
          end: 80,
          axisLength: 340
        }
      ]
    },
    actions: [
      'omics.preview',
      'omics.selectDataset',
      'omics.inspectMetadata',
      'omics.declareCapabilities',
      'workspace.export:csv',
      'workspace.setSelection',
      'sequence.search'
    ],
    ...overrides
  }
}

describe('OmicsWorkspaceViewer', () => {
  it('builds an agent-readable omics view model from matrix summary, selection, and actions', () => {
    const model = buildOmicsWorkspaceViewerModel(createOmicsObservation())
    const rowsById = new Map(model.matrixRows.map((row) => [row.id, row]))

    expect(model.status.kind).toBe('ready')
    expect(model.status.message).toContain('Metadata-only matrix overview')
    expect(model.title).toBe('Single-cell counts')
    expect(model.overview).toMatchObject({
      title: 'Metadata-only matrix overview',
      shapeLabel: '1,200 x 340',
      dataShape: '1200x340'
    })
    expect(model.overview.matrixOptions.map((chip) => [chip.id, chip.selected])).toEqual([
      ['X', true],
      ['layers/counts', true],
      ['raw/X', false]
    ])
    expect(model.overview.axes).toEqual([
      {
        axis: 'obs',
        label: 'Observations',
        count: 1200,
        countLabel: '1,200',
        selectedKeyCount: 2
      },
      {
        axis: 'var',
        label: 'Variables',
        count: 340,
        countLabel: '340',
        selectedKeyCount: 1
      }
    ])
    expect(model.overview.obsKeys.map((chip) => [chip.id, chip.selected])).toEqual([
      ['cell_type', true],
      ['batch', true],
      ['donor', false]
    ])
    expect(model.overview.varKeys.map((chip) => [chip.id, chip.selected])).toEqual([
      ['gene_symbol', true],
      ['highly_variable', false]
    ])
    expect(model.overview.embeddings.map((chip) => [chip.id, chip.selected])).toEqual([
      ['X_umap', true],
      ['X_pca', false]
    ])
    expect(model.overview.metadataKeys.map((chip) => chip.id)).toEqual(['n_obs', 'n_vars', 'organism'])
    expect(model.overview.selectedRanges).toEqual([
      {
        id: 'selected-range-1',
        label: 'Expression obs 10-40 of 1,200 (clipped)',
        matrixId: 'X',
        axis: 'obs',
        start: 10,
        end: 40,
        axisLength: 1200,
        clipped: true
      },
      {
        id: 'selected-range-2',
        label: 'layers/counts var 20-80 of 340',
        matrixId: 'layers/counts',
        axis: 'var',
        start: 20,
        end: 80,
        axisLength: 340,
        clipped: false
      }
    ])
    expect(rowsById.get('matrix-shape')).toMatchObject({
      label: 'Matrix shape',
      value: '1,200 x 340',
      description: 'Selected matrices: X, layers/counts'
    })
    expect(rowsById.get('observations')).toMatchObject({
      label: 'Observations',
      value: '1,200',
      description: 'Selected obs keys: cell_type, batch'
    })
    expect(rowsById.get('variables')).toMatchObject({
      label: 'Variables',
      value: '340',
      description: 'Selected var keys: gene_symbol'
    })
    expect(rowsById.get('embeddings')).toMatchObject({
      label: 'Embeddings',
      value: 'X_umap, X_pca',
      description: 'Selected embeddings: X_umap'
    })
    expect(rowsById.get('selected-ranges')).toMatchObject({
      label: 'Selected ranges',
      value: '2 ranges',
      description: 'Expression obs 10-40 of 1,200 (clipped), layers/counts var 20-80 of 340'
    })
    expect(model.selection.summary).toBe('Selected 2 matrices, 2 obs keys, 1 var key, 1 embedding, 2 ranges.')
    expect(model.actions.map((action) => [action.id, action.kind])).toEqual([
      ['omics.preview', 'preview'],
      ['omics.selectDataset', 'select'],
      ['omics.inspectMetadata', 'inspect'],
      ['omics.declareCapabilities', 'inspect'],
      ['workspace.export:csv', 'export'],
      ['workspace.setSelection', 'select']
    ])
    expect(model.agentSummary).toContain('shape 1,200 x 340')
    expect(model.agentSummary).toContain('metadata keys: n_obs, n_vars, organism')
    expect(model.agentSummary).toContain('preview: metadata-only matrix overview')
    expect(model.agentSummary).toContain('actions: Preview Matrix, Select Dataset, Inspect Metadata, Show Capabilities, Export CSV, Select')
  })

  it('reports empty and unsupported states without trying to render an omics viewport', () => {
    const empty = buildOmicsWorkspaceViewerModel(null)
    const unsupported = buildOmicsWorkspaceViewerModel({
      schemaVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
      file: {
        path: '/workspace/lab/genome.fa',
        workspaceRoot: '/workspace/lab',
        mimeType: 'text/x-fasta'
      },
      view: {
        pluginId: 'sequence-genomics',
        modality: 'sequence',
        mode: 'preview',
        title: 'genome.fa'
      },
      actions: ['workspace.setSelection']
    })
    const emptyHtml = renderToStaticMarkup(createElement(OmicsWorkspaceViewer, { model: empty }))
    const unsupportedHtml = renderToStaticMarkup(createElement(OmicsWorkspaceViewer, { model: unsupported }))

    expect(empty.status).toMatchObject({
      kind: 'empty',
      title: 'No omics observation'
    })
    expect(unsupported.status).toMatchObject({
      kind: 'unsupported',
      title: 'Unsupported observation'
    })
    expect(emptyHtml).toContain('data-status="empty"')
    expect(emptyHtml).not.toContain('data-omics-matrix-overview')
    expect(unsupportedHtml).toContain('data-status="unsupported"')
    expect(unsupportedHtml).toContain('Sequence observations cannot be rendered')
  })

  it('renders the metadata matrix overview plus selection chips, ranges, embeddings, and actions', () => {
    const html = renderToStaticMarkup(createElement(OmicsWorkspaceViewer, {
      observation: createOmicsObservation()
    }))

    expect(html).toContain('data-workspace-preview-omics-viewer')
    expect(html).toContain('data-omics-matrix-overview="true"')
    expect(html).toContain('data-matrix-shape="1200x340"')
    expect(html).not.toContain('data-omics-placeholder')
    expect(html).toContain('Omics metadata matrix overview')
    expect(html).toContain('Metadata-only matrix overview')
    expect(html).toContain('data-omics-axis="obs"')
    expect(html).toContain('data-axis-count="1200"')
    expect(html).toContain('data-omics-axis="var"')
    expect(html).toContain('data-axis-count="340"')
    expect(html).toContain('data-omics-matrix-option="X"')
    expect(html).toContain('data-matrix-id="X"')
    expect(html).toContain('data-omics-matrix-option="raw/X"')
    expect(html).toContain('data-omics-obs-key="cell_type"')
    expect(html).toContain('data-omics-var-key="gene_symbol"')
    expect(html).toContain('data-omics-embedding="X_umap"')
    expect(html).toContain('data-omics-metadata-key="n_obs"')
    expect(html).toContain('data-omics-selected-range="selected-range-1"')
    expect(html).toContain('data-range-start="10"')
    expect(html).toContain('data-range-end="40"')
    expect(html).toContain('data-clipped="true"')
    expect(html).toContain('data-selected="true"')
    expect(html).toContain('No heatmap, scatter, embedding coordinates, or binary matrix payload is loaded.')
    expect(html).toContain('Selected matrices')
    expect(html).toContain('layers/counts')
    expect(html).toContain('Selected obs keys')
    expect(html).toContain('cell_type')
    expect(html).toContain('Selected embeddings')
    expect(html).toContain('Expression obs 10-40 of 1,200 (clipped)')
    expect(html).toContain('data-action-kind="preview"')
    expect(html).toContain('data-action-kind="export"')
    expect(html).toContain('data-action-kind="inspect"')
  })

  it('keeps the overview metadata-only when omics context comes from selection ranges', () => {
    const html = renderToStaticMarkup(createElement(OmicsWorkspaceViewer, {
      observation: createOmicsObservation({
        omics: undefined,
        selection: {
          kind: 'omics',
          matrixIds: ['X'],
          ranges: [
            {
              matrixId: 'X',
              axis: 'row',
              start: 0,
              end: 10
            }
          ]
        },
        actions: ['workspace.setSelection']
      })
    }))

    expect(html).toContain('data-omics-matrix-overview="true"')
    expect(html).toContain('data-matrix-shape="unknown"')
    expect(html).toContain('data-omics-matrix-option="X"')
    expect(html).toContain('data-omics-selected-range="selected-range-1"')
    expect(html).toContain('data-omics-axis="row"')
    expect(html).toContain('Waiting for omics matrix summary metadata from the preview worker.')
    expect(html).not.toContain('heatmap renderer')
    expect(html).not.toContain('data-omics-placeholder')
  })
})
