import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  WORKSPACE_PREVIEW_CONTRACT_VERSION,
  workspacePreviewExtensionIdSchema,
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
  createRendererWorkspacePreviewRegistry as createRegistry,
  type RendererWorkspacePreviewPluginDescriptor,
  type RendererWorkspacePreviewRegistry
} from './registry'
import {
  createBuiltInWorkspacePreviewPluginRegistrations
} from './built-in-plugin-contributions'

function createRendererWorkspacePreviewRegistry(): RendererWorkspacePreviewRegistry {
  return createRegistry({ registrations: createBuiltInWorkspacePreviewPluginRegistrations() })
}

vi.mock('./PdfWorkspaceViewer', () => ({ PdfWorkspaceViewer: () => null }))

const DOMAIN_MODALITY = workspacePreviewExtensionIdSchema.parse('fixture.preview.modality')

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
    pluginId: 'fixture-preview',
    modality: DOMAIN_MODALITY,
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
      enabled: true
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
    expect(actionsById.has('molecular.workbench')).toBe(false)
    expect(actionsById.has('sequence.selectRegion')).toBe(false)
    expect(actionsById.has('omics.selectDataset')).toBe(false)
    expect(actionsById.has('bioimaging.selectChannels')).toBe(false)
    expect(actionsById.has('spectra.exportPeakList')).toBe(false)
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
    expect(actionsById.get('workspace.export:csv')).toMatchObject({ enabled: true })
    expect(actionsById.get('workspace.export:tsv')).toMatchObject({ enabled: true })
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

  it('reports unsupported paths without falling through to legacy chrome', () => {
    const registry = createRendererWorkspacePreviewRegistry()

    const empty = buildWorkspacePreviewChromeModel({
      registry,
      requestedPath: 'notes.md',
      state: createWorkspacePreviewHostState()
    })
    const scientificUnsupported = buildWorkspacePreviewChromeModel({
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
    expect(scientificUnsupported.status).toMatchObject({
      kind: 'error',
      variant: 'unsupported',
      title: 'Unsupported preview'
    })
    expect(scientificUnsupported.status.kind === 'error' ? scientificUnsupported.status.message : '').toContain('mesh.vtk')
    expect(unsupported.status).toMatchObject({
      kind: 'error',
      variant: 'unsupported',
      title: 'Unsupported preview'
    })
    expect(unsupported.status.kind === 'error' ? unsupported.status.message : '').toContain('archive.custombin')
  })

  it('uses only the active plugin contribution for inspector sections', () => {
    const registry = createRendererWorkspacePreviewRegistry()
    const descriptor = requireDescriptor(registry, 'data/samples.csv')
    const observation: WorkspaceObservation = {
      schemaVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
      file: {
        path: '/workspace/lab/data/samples.csv',
        workspaceRoot: '/workspace/lab',
        mimeType: 'text/csv',
        size: 8192
      },
      view: {
        pluginId: descriptor.manifest.id,
        modality: descriptor.manifest.modality,
        mode: 'inspect',
        title: 'Assay samples'
      },
      selection: {
        kind: 'tabular',
        ranges: [{ rowStart: 0, rowEnd: 0, columnStart: 0, columnEnd: 0 }],
        cells: [{ row: 0, column: 0, value: 'sample-1' }]
      },
      tables: [{ id: 'table-1', name: 'Assay', rowCount: 120, columnCount: 8 }],
      slides: [{ id: 'slide-3', index: 2, title: 'Results', notes: 'QC review' }],
      annotations: [{ id: 'annotation-1', kind: 'note', summary: 'Check sample 1' }],
      actions: []
    }
    const model = buildWorkspacePreviewChromeModel({
      registry,
      state: createWorkspacePreviewHostState({
        session: createSession(descriptor, {
          path: 'data/samples.csv',
          modality: descriptor.manifest.modality,
          mode: 'inspect'
        }),
        descriptor,
        observation,
        asset: createAssetTransportDescriptor(),
        file: createFileState({
          path: '/workspace/lab/data/samples.csv',
          relativePath: 'data/samples.csv',
          mimeType: 'text/csv',
          size: 8192
        })
      })
    })

    expect(model.title).toMatchObject({
      text: 'Assay samples',
      subtitle: expect.stringContaining(descriptor.manifest.displayName)
    })
    expect(model.breadcrumb.map((item) => item.label)).toEqual(['data', 'samples.csv'])
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
      summary: 'Tabular, 1 range, 1 cell'
    })
    expect(findSection(model, 'tables')).toMatchObject({
      summary: '1 table'
    })
    expect(model.inspector.sections.map((section) => section.id)).not.toEqual(expect.arrayContaining([
      'slides'
    ]))
    expect(findSection(model, 'annotations')).toMatchObject({
      summary: '1 annotation'
    })
    expect(findSection(model, 'annotations').rows[0]).toMatchObject({
      label: 'Note',
      value: 'Check sample 1'
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
    const descriptor = requireDescriptor(registry, 'data/samples.csv')
    const inspector = buildInspectorModel(
      createWorkspacePreviewHostState({
        session: createSession(descriptor, {
          path: 'data/samples.csv',
          selection: {
            kind: 'tabular',
            ranges: [{ rowStart: 0, rowEnd: 1, columnStart: 0, columnEnd: 1 }],
            cells: [{ row: 0, column: 0 }]
          }
        }),
        descriptor
      }),
      descriptor
    )

    expect(inspector.sections.find((section) => section.id === 'selection')).toMatchObject({
      summary: 'Tabular, 1 range, 1 cell'
    })
  })
})
