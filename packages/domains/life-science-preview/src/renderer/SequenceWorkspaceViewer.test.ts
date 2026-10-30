import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  WORKSPACE_PREVIEW_CONTRACT_VERSION
} from '@sciforge/domain-sdk/workspace-preview'
import type { LifeScienceWorkspaceObservation as WorkspaceObservation } from '../wire'
import {
  buildSequenceWorkspaceViewerModel,
  buildSequenceBrowserModel,
  createSequenceMarkerSelectionOperation,
  SequenceWorkspaceViewer
} from './SequenceWorkspaceViewer'

function createSequenceObservation(
  overrides: Partial<WorkspaceObservation> = {}
): WorkspaceObservation {
  return {
    schemaVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
    file: {
      path: '/workspace/lab/genome.fa',
      workspaceRoot: '/workspace/lab',
      mimeType: 'text/x-fasta',
      size: 4096
    },
    view: {
      pluginId: 'sequence-genomics',
      modality: 'sequence',
      mode: 'inspect',
      title: 'Genome FASTA'
    },
    sequence: {
      sequenceCount: 2,
      totalLength: 3072,
      alphabet: 'dna',
      references: [
        { id: 'chr1', sequenceLength: 1024, featureCount: 2 },
        { id: 'chr2', sequenceLength: 2048, featureCount: 1 }
      ],
      indexedRanges: [
        { kind: 'reference', reference: 'chr1', start: 0, end: 1024, id: 'chr1' },
        { kind: 'feature', reference: 'chr1', start: 120, end: 200, id: 'geneA', type: 'gene', strand: '+' },
        { kind: 'feature', reference: 'chr1', start: 140, end: 180, type: 'exon' }
      ],
      features: [
        { id: 'geneA', reference: 'chr1', type: 'gene', start: 120, end: 200, strand: '+' },
        { reference: 'chr1', type: 'exon', start: 140, end: 180 }
      ],
      truncatedRecords: true
    },
    selection: {
      kind: 'sequence',
      sequenceId: 'chr1',
      ranges: [
        { start: 100, end: 240, strand: '+' },
        { start: 400, end: 512, strand: '-' }
      ],
      features: [
        { id: 'geneA', type: 'gene', start: 120, end: 200 },
        { type: 'exon', start: 140, end: 180 }
      ]
    },
    actions: [
      'sequence.selectRegion',
      'sequence.search',
      'sequence.exportSummary',
      'sequence.inspectFeatures',
      'workspace.setSelection',
      'omics.selectDataset'
    ],
    ...overrides
  }
}

describe('SequenceWorkspaceViewer', () => {
  it('builds an agent-readable sequence view model from observation summary, selection, and actions', () => {
    const model = buildSequenceWorkspaceViewerModel(createSequenceObservation())
    const rowsById = new Map(model.sequenceRows.map((row) => [row.id, row]))

    expect(model.status.kind).toBe('ready')
    expect(model.title).toBe('Genome FASTA')
    expect(rowsById.get('sequence-count')).toMatchObject({
      label: 'Sequences',
      value: '2'
    })
    expect(rowsById.get('total-length')).toMatchObject({
      label: 'Total length',
      value: '3,072 bp/aa'
    })
    expect(rowsById.get('alphabet')).toMatchObject({
      label: 'Alphabet',
      value: 'DNA'
    })
    expect(rowsById.get('selected-ranges')).toMatchObject({
      label: 'Selected ranges',
      value: '2 ranges',
      description: '100-240 (+), 400-512 (-)'
    })
    expect(rowsById.get('selected-features')).toMatchObject({
      label: 'Selected features',
      value: '2 features',
      description: 'gene geneA: 120-200, exon: 140-180'
    })
    expect(rowsById.get('references')).toMatchObject({
      label: 'References',
      value: '2 references',
      description: expect.stringContaining('chr1 (1,024 bp/aa, 2 features)')
    })
    expect(rowsById.get('features')).toMatchObject({
      label: 'Features',
      value: '2 features',
      description: expect.stringContaining('chr1:gene geneA 120-200 (+)')
    })
    expect(rowsById.get('indexed-ranges')).toMatchObject({
      label: 'Indexed ranges',
      value: '3 ranges'
    })
    expect(model.browser).toMatchObject({
      kind: 'map',
      reference: 'chr1',
      end: 1024,
      truncated: true
    })
    expect(model.selection.summary).toBe('Selected sequence chr1, 2 ranges, 2 features.')
    expect(model.actions.map((action) => [action.id, action.kind])).toEqual([
      ['sequence.selectRegion', 'select'],
      ['sequence.search', 'search'],
      ['sequence.exportSummary', 'export'],
      ['sequence.inspectFeatures', 'inspect'],
      ['workspace.setSelection', 'select']
    ])
    expect(model.agentSummary).toContain('2 sequences')
    expect(model.agentSummary).toContain('actions: Select Region, Search Sequence, Export Summary, Inspect Features, Select')
  })

  it('reports empty and unsupported states without trying to render a sequence viewport', () => {
    const empty = buildSequenceWorkspaceViewerModel(null)
    const unsupported = buildSequenceWorkspaceViewerModel({
      schemaVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
      file: {
        path: '/workspace/lab/counts.h5ad',
        workspaceRoot: '/workspace/lab',
        mimeType: 'application/x-hdf5'
      },
      view: {
        pluginId: 'omics-matrix',
        modality: 'omics',
        mode: 'preview',
        title: 'counts.h5ad'
      },
      actions: ['workspace.setSelection']
    })
    const emptyHtml = renderToStaticMarkup(createElement(SequenceWorkspaceViewer, { model: empty }))
    const unsupportedHtml = renderToStaticMarkup(createElement(SequenceWorkspaceViewer, { model: unsupported }))

    expect(empty.status).toMatchObject({
      kind: 'empty',
      title: 'No sequence observation'
    })
    expect(unsupported.status).toMatchObject({
      kind: 'unsupported',
      title: 'Unsupported observation'
    })
    expect(emptyHtml).toContain('data-status="empty"')
    expect(emptyHtml).not.toContain('data-sequence-placeholder')
    expect(unsupportedHtml).toContain('data-status="unsupported"')
    expect(unsupportedHtml).toContain('Omics observations cannot be rendered')
  })

  it('builds a bounded browser map from observation references, features, and selection ranges', () => {
    const browser = buildSequenceBrowserModel(createSequenceObservation())

    expect(browser).toMatchObject({
      kind: 'map',
      reference: 'chr1',
      end: 1024,
      indexedRanges: expect.arrayContaining([
        expect.objectContaining({ id: 'chr1', start: 0, end: 1024, width: expect.any(Number) }),
        expect.objectContaining({ id: 'geneA', kind: 'feature', strand: '+' })
      ]),
      selectedRanges: expect.arrayContaining([
        expect.objectContaining({ id: 'selected-range-1', start: 100, end: 240, strand: '+' }),
        expect.objectContaining({ id: 'selected-range-2', start: 400, end: 512, strand: '-' })
      ]),
      features: expect.arrayContaining([
        expect.objectContaining({ id: 'geneA', kind: 'gene', strand: '+' }),
        expect.objectContaining({ id: 'feature-2', kind: 'exon' })
      ])
    })
  })

  it('renders the bounded browser map plus selected ranges, features, and sequence actions', () => {
    const html = renderToStaticMarkup(createElement(SequenceWorkspaceViewer, {
      observation: createSequenceObservation()
    }))

    expect(html).toContain('data-workspace-preview-sequence-viewer')
    expect(html).toContain('data-sequence-browser-viewport')
    expect(html).toContain('data-sequence-browser-map')
    expect(html).toContain('data-sequence-reference="chr1"')
    expect(html).toContain('data-sequence-end="1024"')
    expect(html).toContain('data-sequence-indexed-range="geneA"')
    expect(html).toContain('data-sequence-selected-range="selected-range-1"')
    expect(html).toContain('data-sequence-feature="geneA"')
    expect(html).toContain('data-sequence-marker-list')
    expect(html).toContain('data-sequence-marker-id="geneA"')
    expect(html).toContain('data-selected="true"')
    expect(html).toContain('Bounded preview; omitted sequence records may not be shown.')
    expect(html).toContain('Selected ranges')
    expect(html).toContain('100-240 (+)')
    expect(html).toContain('Selected features')
    expect(html).toContain('gene geneA: 120-200')
    expect(html).toContain('data-action-kind="search"')
    expect(html).toContain('data-action-kind="export"')
    expect(html).toContain('data-action-kind="inspect"')
  })

  it('creates workspace selection operations for bounded sequence markers', () => {
    const observation = createSequenceObservation()
    const browser = buildSequenceBrowserModel(observation)
    if (browser.kind !== 'map') throw new Error('expected browser map')

    expect(createSequenceMarkerSelectionOperation(observation, browser.reference, browser.features[0])).toEqual({
      kind: 'workspace.setSelection',
      path: '/workspace/lab/genome.fa',
      selection: {
        kind: 'sequence',
        sequenceId: 'chr1',
        ranges: [{ start: 120, end: 200, strand: '+' }],
        features: [{ id: 'geneA', type: 'gene', start: 120, end: 200 }]
      }
    })
  })

  it('keeps an explicit empty browser state when bounded coordinates are unavailable', () => {
    const html = renderToStaticMarkup(createElement(SequenceWorkspaceViewer, {
      observation: createSequenceObservation({
        sequence: {
          sequenceCount: 1,
          totalLength: 100,
          alphabet: 'dna'
        },
        selection: undefined
      })
    }))

    expect(html).toContain('data-sequence-browser-empty')
    expect(html).toContain('The bounded observation does not include reference coordinates yet.')
  })
})
