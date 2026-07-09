import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  WORKSPACE_PREVIEW_CONTRACT_VERSION,
  type WorkspaceObservation,
  type WorkspacePreviewAssetTransportDescriptor,
  type WorkspacePreviewFileState,
  type WorkspacePreviewSession
} from '@shared/workspace-preview'
import { createWorkspacePreviewHostState } from './host'
import {
  buildInspectorModel,
  buildWorkspacePreviewChromeModel,
  type WorkspacePreviewChromeModel
} from './chrome-model'
import { WorkspacePreviewChrome } from './WorkspacePreviewChrome'
import {
  createRendererWorkspacePreviewRegistry,
  type RendererWorkspacePreviewPluginDescriptor,
  type RendererWorkspacePreviewRegistry
} from './registry'

function requireDescriptor(
  registry: RendererWorkspacePreviewRegistry,
  path: string
): RendererWorkspacePreviewPluginDescriptor {
  const descriptor = registry.resolve({ path })
  if (!descriptor) throw new Error(`Expected descriptor for ${path}`)
  return descriptor
}

function createSession(
  descriptor: RendererWorkspacePreviewPluginDescriptor,
  overrides: Partial<WorkspacePreviewSession> = {}
): WorkspacePreviewSession {
  return {
    id: 'session-1',
    pluginId: descriptor.manifest.id,
    workspaceRoot: '/workspace/lab',
    path: 'data/samples.csv',
    modality: descriptor.manifest.modality,
    mode: 'preview',
    openedAt: '2026-07-08T00:00:00.000Z',
    updatedAt: '2026-07-08T00:00:00.000Z',
    ...overrides
  }
}

function createFileState(overrides: Partial<WorkspacePreviewFileState> = {}): WorkspacePreviewFileState {
  return {
    workspaceRoot: '/workspace/lab',
    path: '/workspace/lab/data/samples.csv',
    relativePath: 'data/samples.csv',
    mimeType: 'text/csv',
    size: 4096,
    mtimeMs: 1783468800000,
    ...overrides
  }
}

function createAssetTransportDescriptor(
  overrides: Partial<WorkspacePreviewAssetTransportDescriptor> = {}
): WorkspacePreviewAssetTransportDescriptor {
  return {
    schemaVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
    sessionId: 'session-1',
    assetId: 'asset:session-1',
    pluginId: 'molecular',
    modality: 'molecular',
    file: {
      name: 'protein.pdb',
      relativePath: 'data/protein.pdb',
      mimeType: 'chemical/x-pdb',
      size: 8192
    },
    primary: 'byte-range',
    eagerRead: {
      allowed: false,
      reason: 'Workspace preview assets are transported lazily.'
    },
    range: {
      available: true,
      maxChunkBytes: 4 * 1024 * 1024,
      recommendedChunkBytes: 1024 * 1024,
      size: 8192
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
        status: 'requires-plugin',
        reason: 'format-specific decoder'
      },
      {
        kind: 'cache-artifact',
        status: 'deferred',
        reason: 'worker cache invalidation rules pending'
      }
    ],
    ...overrides
  }
}

function findSection(model: WorkspacePreviewChromeModel, id: string) {
  const section = model.inspector.sections.find((candidate) => candidate.id === id)
  if (!section) throw new Error(`Expected inspector section ${id}`)
  return section
}

describe('workspace preview shared chrome', () => {
  it('derives toolbar actions from manifest capabilities and observation actions', () => {
    const registry = createRendererWorkspacePreviewRegistry()
    const descriptor = requireDescriptor(registry, 'data/samples.csv')
    const observation: WorkspaceObservation = {
      schemaVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
      file: {
        path: '/workspace/lab/data/samples.csv',
        workspaceRoot: '/workspace/lab',
        mimeType: 'text/csv',
        size: 4096
      },
      view: {
        pluginId: descriptor.manifest.id,
        modality: descriptor.manifest.modality,
        mode: 'preview',
        title: 'samples.csv'
      },
      actions: [
        'workspace.setSelection',
        'tabular.updateCell',
        'tabular.insertColumns',
        'tabular.deleteRows',
        'tabular.deleteColumns',
        'annotation.upsert',
        'molecular.workbench',
        'sequence.selectRegion',
        'omics.selectDataset',
        'bioimaging.selectChannels',
        'bioimaging.annotateRegion',
        'bioimaging.exportRoiSet',
        'spectra.selectPeaksByRange',
        'spectra.annotateRange',
        'spectra.exportPeakList'
      ]
    }
    const model = buildWorkspacePreviewChromeModel({
      registry,
      state: createWorkspacePreviewHostState({
        session: createSession(descriptor),
        descriptor,
        observation,
        file: createFileState()
      })
    })
    const actionsById = new Map(model.toolbar.actions.map((action) => [action.id, action]))

    expect(actionsById.get('workspace.preview')).toMatchObject({ source: 'manifest', enabled: true })
    expect(actionsById.get('workspace.edit')).toMatchObject({
      source: 'manifest',
      enabled: false,
      reason: 'This action needs a dedicated editor control before it can run.'
    })
    expect(actionsById.get('workspace.inspect')).toMatchObject({ source: 'manifest', enabled: true })
    expect(actionsById.get('workspace.setSelection')).toMatchObject({
      source: 'manifest+observation',
      enabled: true
    })
    expect(actionsById.get('workspace.export:csv')).toMatchObject({
      label: 'Export CSV',
      source: 'manifest',
      format: 'csv',
      enabled: true
    })
    expect(actionsById.get('workspace.export:tsv')).toMatchObject({
      label: 'Export TSV',
      source: 'manifest',
      format: 'tsv',
      enabled: false
    })
    expect(actionsById.get('tabular.updateCell')).toMatchObject({
      label: 'Tabular Update Cell',
      source: 'observation',
      enabled: false,
      reason: 'This action needs a dedicated editor control before it can run.'
    })
    expect(actionsById.get('tabular.insertColumns')).toMatchObject({
      label: 'Tabular Insert Columns',
      source: 'observation',
      enabled: false,
      reason: 'This action needs a dedicated editor control before it can run.'
    })
    expect(actionsById.get('tabular.deleteRows')).toMatchObject({
      label: 'Tabular Delete Rows',
      source: 'observation',
      enabled: false,
      reason: 'This action needs a dedicated editor control before it can run.'
    })
    expect(actionsById.get('tabular.deleteColumns')).toMatchObject({
      label: 'Tabular Delete Columns',
      source: 'observation',
      enabled: false,
      reason: 'This action needs a dedicated editor control before it can run.'
    })
    expect(actionsById.get('annotation.upsert')).toMatchObject({
      label: 'Annotate',
      source: 'observation'
    })
    expect(actionsById.get('molecular.workbench')).toMatchObject({
      label: 'Molecular Workbench',
      source: 'observation'
    })
    expect(actionsById.get('sequence.selectRegion')).toMatchObject({
      label: 'Select Region',
      source: 'observation'
    })
    expect(actionsById.get('omics.selectDataset')).toMatchObject({
      label: 'Select Dataset',
      source: 'observation'
    })
    expect(actionsById.get('bioimaging.selectChannels')).toMatchObject({
      label: 'Select Channels',
      source: 'observation'
    })
    expect(actionsById.get('bioimaging.annotateRegion')).toMatchObject({
      label: 'Annotate ROI',
      source: 'observation'
    })
    expect(actionsById.get('bioimaging.exportRoiSet')).toMatchObject({
      label: 'Export ROI Set',
      source: 'observation'
    })
    expect(actionsById.get('spectra.selectPeaksByRange')).toMatchObject({
      label: 'Select Peaks',
      source: 'observation'
    })
    expect(actionsById.get('spectra.annotateRange')).toMatchObject({
      label: 'Annotate Range',
      source: 'observation'
    })
    expect(actionsById.get('spectra.exportPeakList')).toMatchObject({
      label: 'Export Peaks',
      source: 'observation'
    })
  })

  it('keeps read-only tabular observations from re-enabling write toolbar actions', () => {
    const registry = createRendererWorkspacePreviewRegistry()
    const descriptor = requireDescriptor(registry, 'data/records.jsonl')
    const observation: WorkspaceObservation = {
      schemaVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
      file: {
        path: '/workspace/lab/data/records.jsonl',
        workspaceRoot: '/workspace/lab',
        mimeType: 'application/x-ndjson',
        size: 4096
      },
      view: {
        pluginId: descriptor.manifest.id,
        modality: descriptor.manifest.modality,
        mode: 'preview',
        title: 'records.jsonl'
      },
      actions: [
        'tabular.preview',
        'tabular.inspectColumns',
        'tabular.filterRows',
        'tabular.sortRows',
        'tabular.selectCells'
      ]
    }
    const model = buildWorkspacePreviewChromeModel({
      registry,
      state: createWorkspacePreviewHostState({
        session: createSession(descriptor, { path: 'data/records.jsonl' }),
        descriptor,
        observation,
        file: createFileState({
          path: '/workspace/lab/data/records.jsonl',
          relativePath: 'data/records.jsonl',
          mimeType: 'application/x-ndjson'
        })
      })
    })
    const actionsById = new Map(model.toolbar.actions.map((action) => [action.id, action]))

    expect(actionsById.get('workspace.edit')).toMatchObject({
      source: 'manifest',
      enabled: false,
      reason: 'This action needs a dedicated editor control before it can run.'
    })
    expect(actionsById.get('tabular.filterRows')).toMatchObject({ source: 'observation', enabled: true })
    expect(actionsById.get('workspace.export:csv')).toMatchObject({ enabled: false })
    expect(actionsById.get('workspace.export:tsv')).toMatchObject({ enabled: false })
    expect(actionsById.has('tabular.updateCell')).toBe(false)
    expect(actionsById.has('tabular.insertRows')).toBe(false)
    expect(actionsById.has('tabular.insertColumns')).toBe(false)
    expect(actionsById.has('tabular.deleteRows')).toBe(false)
    expect(actionsById.has('tabular.deleteColumns')).toBe(false)
  })

  it('enables source-copy export only for the open deck file format', () => {
    const registry = createRendererWorkspacePreviewRegistry()
    const descriptor = requireDescriptor(registry, 'slides.pptx')
    const observation: WorkspaceObservation = {
      schemaVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
      file: {
        path: '/workspace/lab/slides.pptx',
        workspaceRoot: '/workspace/lab',
        mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      },
      view: {
        pluginId: descriptor.manifest.id,
        modality: descriptor.manifest.modality,
        mode: 'preview',
        title: 'slides.pptx'
      },
      actions: ['deck.selectSlide', 'deck.updateTextElement']
    }
    const model = buildWorkspacePreviewChromeModel({
      registry,
      state: createWorkspacePreviewHostState({
        session: createSession(descriptor, {
          path: 'slides.pptx',
          modality: 'deck'
        }),
        descriptor,
        observation,
        file: createFileState({
          path: '/workspace/lab/slides.pptx',
          relativePath: 'slides.pptx',
          mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
        })
      })
    })
    const actionsById = new Map(model.toolbar.actions.map((action) => [action.id, action]))

    expect(actionsById.get('workspace.export:pptx')).toMatchObject({
      label: 'Export PPTX',
      enabled: true
    })
    expect(actionsById.has('workspace.export:pdf')).toBe(false)
    expect(actionsById.has('workspace.export:png')).toBe(false)
  })

  it('enables sidecar export for PDF and DOCX document previews', () => {
    const registry = createRendererWorkspacePreviewRegistry()
    const pdfDescriptor = requireDescriptor(registry, 'paper.pdf')
    const docxDescriptor = requireDescriptor(registry, 'report.docx')
    const pdfModel = buildWorkspacePreviewChromeModel({
      registry,
      state: createWorkspacePreviewHostState({
        session: createSession(pdfDescriptor, {
          path: '/workspace/lab/paper.pdf',
          modality: 'document'
        }),
        descriptor: pdfDescriptor,
        observation: {
          schemaVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
          file: {
            path: '/workspace/lab/paper.pdf',
            workspaceRoot: '/workspace/lab',
            mimeType: 'application/pdf'
          },
          view: {
            pluginId: 'pdf',
            modality: 'document',
            mode: 'preview',
            title: 'paper.pdf'
          },
          actions: ['annotation.upsert']
        },
        file: createFileState({
          path: '/workspace/lab/paper.pdf',
          relativePath: 'paper.pdf',
          mimeType: 'application/pdf'
        })
      })
    })
    const docxModel = buildWorkspacePreviewChromeModel({
      registry,
      state: createWorkspacePreviewHostState({
        session: createSession(docxDescriptor, {
          path: '/workspace/lab/report.docx',
          modality: 'document'
        }),
        descriptor: docxDescriptor,
        observation: {
          schemaVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
          file: {
            path: '/workspace/lab/report.docx',
            workspaceRoot: '/workspace/lab',
            mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          },
          view: {
            pluginId: 'docx',
            modality: 'document',
            mode: 'preview',
            title: 'report.docx'
          },
          actions: ['annotation.upsert']
        },
        file: createFileState({
          path: '/workspace/lab/report.docx',
          relativePath: 'report.docx',
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        })
      })
    })
    const pdfActions = new Map(pdfModel.toolbar.actions.map((action) => [action.id, action]))
    const docxActions = new Map(docxModel.toolbar.actions.map((action) => [action.id, action]))

    expect(pdfActions.get('workspace.export:sidecar')).toMatchObject({
      label: 'Export SIDECAR',
      enabled: true,
      format: 'sidecar'
    })
    expect(docxActions.get('workspace.export:sidecar')).toMatchObject({
      label: 'Export SIDECAR',
      enabled: true,
      format: 'sidecar'
    })
  })

  it('reports deferred and unsupported paths without falling through to legacy chrome', () => {
    const registry = createRendererWorkspacePreviewRegistry()

    const empty = buildWorkspacePreviewChromeModel({
      registry,
      requestedPath: 'notes.md',
      state: createWorkspacePreviewHostState()
    })
    const deferred = buildWorkspacePreviewChromeModel({
      registry,
      requestedPath: 'mesh.vtk',
      state: createWorkspacePreviewHostState()
    })
    const unsupported = buildWorkspacePreviewChromeModel({
      registry,
      requestedPath: 'archive.custombin',
      state: createWorkspacePreviewHostState()
    })

    expect(empty.status).toMatchObject({
      kind: 'empty',
      title: 'Preview not opened'
    })
    expect(empty.title.text).toBe('notes.md')
    expect(empty.toolbar.actions.every((action) => !action.enabled)).toBe(true)
    expect(deferred.status).toMatchObject({
      kind: 'error',
      variant: 'deferred',
      title: 'Preview deferred'
    })
    expect(deferred.status.kind === 'error' ? deferred.status.message : '').toContain('mesh.vtk')
    expect(unsupported.status).toMatchObject({
      kind: 'error',
      variant: 'unsupported',
      title: 'Unsupported preview'
    })
    expect(unsupported.status.kind === 'error' ? unsupported.status.message : '').toContain('archive.custombin')
  })

  it('builds selection, annotation, table, slide, and life-science inspector summaries', () => {
    const registry = createRendererWorkspacePreviewRegistry()
    const descriptor = requireDescriptor(registry, 'protein.pdb')
    const observation: WorkspaceObservation = {
      schemaVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
      file: {
        path: '/workspace/lab/data/protein.pdb',
        workspaceRoot: '/workspace/lab',
        mimeType: 'chemical/x-pdb',
        size: 8192
      },
      view: {
        pluginId: descriptor.manifest.id,
        modality: descriptor.manifest.modality,
        mode: 'inspect',
        title: 'Protein structure'
      },
      selection: {
        kind: 'tabular',
        sheet: 'Assay',
        ranges: [{ rowStart: 0, rowEnd: 4, columnStart: 1, columnEnd: 2 }],
        cells: [
          { row: 0, column: 1, value: 'A' },
          { row: 1, column: 1, value: 'B' }
        ]
      },
      tables: [{ id: 'table-1', name: 'Assay', rowCount: 120, columnCount: 8 }],
      slides: [{ id: 'slide-3', index: 2, title: 'Results', notes: 'QC review' }],
      molecular: {
        modelCount: 1,
        chains: ['A', 'B'],
        ligands: ['ATP'],
        representations: ['cartoon']
      },
      sequence: {
        sequenceCount: 2,
        totalLength: 1200,
        alphabet: 'dna'
      },
      omics: {
        format: 'h5ad',
        matrixShape: [2700, 32738],
        matrixIds: ['matrix-1'],
        observationCount: 2700,
        variableCount: 32738,
        obsKeys: ['cell_type', 'batch'],
        varKeys: ['gene_symbol'],
        embeddings: ['umap', 'pca'],
        metadataKeys: ['n_obs', 'n_vars']
      },
      bioimaging: {
        format: 'ome-tiff',
        detectedBy: 'metadata',
        byteLength: 4096,
        dimensions: { width: 512, height: 256, z: 3, t: 5 },
        channels: ['DAPI', 'FITC'],
        tilePlan: {
          status: 'metadata-only',
          source: 'ome-tiff-metadata',
          levelCount: 2,
          tileSize: { width: 512, height: 512 },
          pixelDecoding: false,
          tileRendererImplemented: false
        }
      },
      spectra: {
        format: 'mgf',
        spectrumCount: 5,
        peakCount: 240,
        scanCount: 2,
        xAxis: 'm/z',
        mzRange: { min: 100.1, max: 900.2 },
        intensityRange: { min: 10, max: 2000 },
        sampledPeaks: [{ mz: 100.1, intensity: 10 }],
        scanMarkers: [{ index: 0, scanNumber: '27', peakCount: 120 }]
      },
      annotations: [{ id: 'annotation-1', kind: 'note', summary: 'Check chain A' }],
      actions: []
    }
    const model = buildWorkspacePreviewChromeModel({
      registry,
      state: createWorkspacePreviewHostState({
        session: createSession(descriptor, {
          path: 'data/protein.pdb',
          modality: descriptor.manifest.modality,
          mode: 'inspect'
        }),
        descriptor,
        observation,
        asset: createAssetTransportDescriptor(),
        file: createFileState({
          path: '/workspace/lab/data/protein.pdb',
          relativePath: 'data/protein.pdb',
          mimeType: 'chemical/x-pdb',
          size: 8192
        })
      })
    })

    expect(model.title).toMatchObject({
      text: 'Protein structure',
      subtitle: expect.stringContaining(descriptor.manifest.displayName)
    })
    expect(model.breadcrumb.map((item) => item.label)).toEqual(['data', 'protein.pdb'])
    expect(findSection(model, 'asset-transport')).toMatchObject({
      summary: 'primary byte-range, eager read disabled, byte range available'
    })
    expect(findSection(model, 'asset-transport').rows.map((row) => [row.id, row.value])).toEqual(
      expect.arrayContaining([
        ['strategy-byte-range', 'Available'],
        ['strategy-tile', 'Requires Plugin'],
        ['strategy-cache-artifact', 'Deferred']
      ])
    )
    expect(findSection(model, 'selection')).toMatchObject({
      summary: 'Tabular, 1 range, 2 cells'
    })
    expect(findSection(model, 'tables').rows[0]).toMatchObject({
      label: 'Assay',
      value: '120 rows x 8 columns'
    })
    expect(findSection(model, 'slides').rows[0]).toMatchObject({
      label: 'Slide 3',
      value: 'Results',
      description: 'QC review'
    })
    expect(findSection(model, 'molecular')).toMatchObject({
      summary: '1 model, 2 chains, 1 ligand'
    })
    expect(findSection(model, 'sequence')).toMatchObject({
      summary: '2 sequences, 1200 bp/aa, DNA'
    })
    expect(findSection(model, 'omics')).toMatchObject({
      summary: 'h5ad, 2700 x 32738, 1 matrix, 2700 observations, 32738 variables'
    })
    expect(findSection(model, 'omics').rows.map((row) => row.label)).toEqual(expect.arrayContaining([
      'Matrices',
      'Observation keys',
      'Variable keys',
      'Metadata keys'
    ]))
    expect(findSection(model, 'bioimaging')).toMatchObject({
      summary: 'ome-tiff, 512 x 256, Z 3, T 5, 2 channels, 2 tile levels'
    })
    expect(findSection(model, 'bioimaging').rows.find((row) => row.id === 'tile-plan')).toMatchObject({
      value: expect.stringContaining('metadata-only')
    })
    expect(findSection(model, 'spectra')).toMatchObject({
      summary: 'mgf, 5 spectra, 240 peaks, 2 scans, x: m/z'
    })
    expect(findSection(model, 'spectra').rows.map((row) => row.label)).toEqual(expect.arrayContaining([
      'm/z range',
      'Intensity range',
      'Sampled peaks',
      'Scan markers'
    ]))
    expect(findSection(model, 'annotations')).toMatchObject({
      summary: '1 annotation'
    })
    expect(findSection(model, 'annotations').rows[0]).toMatchObject({
      label: 'Note',
      value: 'Check chain A'
    })
  })

  it('renders the TSX chrome shell with body while hiding top metadata and inspector by default', () => {
    const registry = createRendererWorkspacePreviewRegistry()
    const descriptor = requireDescriptor(registry, 'data/samples.csv')
    const model = buildWorkspacePreviewChromeModel({
      registry,
      state: createWorkspacePreviewHostState({
        session: createSession(descriptor),
        descriptor,
        file: createFileState()
      })
    })
    const onAction = vi.fn()
    const html = renderToStaticMarkup(
      createElement(
        WorkspacePreviewChrome,
        { model, onAction },
        createElement('div', { 'data-preview-slot': 'content' }, 'Preview body')
      )
    )

    expect(html).toContain('data-workspace-preview-chrome')
    expect(html).not.toContain('workspace-preview-chrome__header')
    expect(html).not.toContain('Workspace preview breadcrumb')
    expect(html).not.toContain('role="toolbar"')
    expect(html).not.toContain('data-workspace-preview-action-menu')
    expect(html).not.toContain('data-action-id="workspace.export:csv"')
    expect(html).toContain('data-preview-slot="content"')
    expect(html).not.toContain('Workspace preview inspector')
  })

  it('renders the inspector only when explicitly requested', () => {
    const registry = createRendererWorkspacePreviewRegistry()
    const descriptor = requireDescriptor(registry, 'data/samples.csv')
    const model = buildWorkspacePreviewChromeModel({
      registry,
      state: createWorkspacePreviewHostState({
        session: createSession(descriptor),
        descriptor,
        file: createFileState()
      })
    })
    const html = renderToStaticMarkup(
      createElement(
        WorkspacePreviewChrome,
        { model, showInspector: true },
        createElement('div', { 'data-preview-slot': 'content' }, 'Preview body')
      )
    )

    expect(html).toContain('Workspace preview inspector')
  })

  it('keeps inspector model useful with only host state selection and no observation', () => {
    const registry = createRendererWorkspacePreviewRegistry()
    const descriptor = requireDescriptor(registry, 'protein.pdb')
    const inspector = buildInspectorModel(
      createWorkspacePreviewHostState({
        session: createSession(descriptor, {
          path: 'protein.pdb',
          selection: {
            kind: 'molecular',
            chains: ['A'],
            residues: [{ chain: 'A', index: 42, name: 'GLY' }],
            atoms: [{ index: 4, element: 'C' }]
          }
        }),
        descriptor
      }),
      descriptor
    )

    expect(inspector.sections.find((section) => section.id === 'selection')).toMatchObject({
      summary: 'Molecular, 1 chain, 1 residue, 1 atom'
    })
  })

  it('summarizes omics selections from host state without requiring a rendered matrix', () => {
    const registry = createRendererWorkspacePreviewRegistry()
    const descriptor = requireDescriptor(registry, 'atlas.h5ad')
    const inspector = buildInspectorModel(
      createWorkspacePreviewHostState({
        session: createSession(descriptor, {
          path: 'atlas.h5ad',
          selection: {
            kind: 'omics',
            matrixIds: ['matrix-1'],
            obsKeys: ['cell_type'],
            varKeys: ['gene_symbol'],
            embeddings: ['X_umap'],
            ranges: [{
              matrixId: 'matrix-1',
              axis: 'obs',
              start: 0,
              end: 128,
              axisLength: 2700
            }]
          }
        }),
        descriptor
      }),
      descriptor
    )
    const selection = inspector.sections.find((section) => section.id === 'selection')

    expect(selection).toMatchObject({
      summary: 'Omics, 1 matrix, 1 obs key, 1 var key, 1 embedding, 1 range'
    })
    expect(selection?.rows.map((row) => row.label)).toEqual([
      'Kind',
      'Matrices',
      'Observation keys',
      'Variable keys',
      'Embeddings',
      'Ranges'
    ])
  })
})
