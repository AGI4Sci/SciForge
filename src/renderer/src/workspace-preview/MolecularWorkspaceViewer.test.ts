import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  WORKSPACE_PREVIEW_CONTRACT_VERSION,
  type WorkspaceObservation,
  type WorkspacePreviewAssetTransportDescriptor
} from '@shared/workspace-preview'
import {
  buildMolecularWorkspaceViewerModel,
  createMolecularChainSelectionOperation,
  createMolecularClearSelectionOperation,
  createMolecularLigandSelectionOperation,
  decodeWorkspacePreviewBase64Text,
  defaultMolecularRepresentationMode,
  MolecularWorkspaceViewer,
  readMolecularRenderableAssetText,
  resolveMolecularRenderableAsset
} from './MolecularWorkspaceViewer'

function createMolecularObservation(
  overrides: Partial<WorkspaceObservation> = {}
): WorkspaceObservation {
  return {
    schemaVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
    file: {
      path: '/workspace/lab/protein.pdb',
      workspaceRoot: '/workspace/lab',
      mimeType: 'chemical/x-pdb',
      size: 8192
    },
    view: {
      pluginId: 'molecular',
      modality: 'molecular',
      mode: 'inspect',
      title: 'Protein structure'
    },
    molecular: {
      modelCount: 1,
      chains: ['A', 'B'],
      ligands: ['ATP', 'MG'],
      representations: ['cartoon', 'sticks']
    },
    selection: {
      kind: 'molecular',
      chains: ['A'],
      residues: [
        { chain: 'A', index: 42, name: 'GLY' },
        { chain: 'B', index: 7, insertionCode: 'A' }
      ],
      atoms: [
        { index: 4, element: 'C' },
        { id: 'zn-1', element: 'Zn' }
      ],
      ligands: ['ATP']
    },
    actions: [
      'molecular.select',
      'molecular.measureDistance',
      'workspace.setSelection',
      'sequence.search'
    ],
    ...overrides
  }
}

function createMolecularAssetDescriptor(
  overrides: Partial<WorkspacePreviewAssetTransportDescriptor> = {}
): WorkspacePreviewAssetTransportDescriptor {
  return {
    schemaVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
    sessionId: 'session-molecular',
    assetId: 'asset:session-molecular',
    pluginId: 'molecular',
    modality: 'molecular',
    file: {
      name: 'protein.pdb',
      relativePath: 'protein.pdb',
      mimeType: 'chemical/x-pdb',
      size: 67
    },
    primary: 'byte-range',
    eagerRead: {
      allowed: false,
      reason: 'Use bounded byte ranges.'
    },
    range: {
      available: true,
      maxChunkBytes: 4 * 1024 * 1024,
      recommendedChunkBytes: 1024 * 1024,
      size: 67
    },
    strategies: [{
      kind: 'byte-range',
      status: 'available',
      reason: 'Byte-range transport is available.',
      maxChunkBytes: 4 * 1024 * 1024
    }],
    ...overrides
  }
}

describe('MolecularWorkspaceViewer', () => {
  it('builds an agent-readable molecular view model from observation summary, selection, and actions', () => {
    const model = buildMolecularWorkspaceViewerModel(createMolecularObservation())
    const rowsById = new Map(model.structureRows.map((row) => [row.id, row]))

    expect(model.status.kind).toBe('ready')
    expect(model.title).toBe('Protein structure')
    expect(rowsById.get('chains')).toMatchObject({
      label: 'Chains',
      value: 'A, B',
      description: 'Selected: A'
    })
    expect(rowsById.get('residues')).toMatchObject({
      label: 'Residues',
      value: '2 selected residues',
      description: 'GLY A:42, B:7A'
    })
    expect(rowsById.get('ligands')).toMatchObject({
      label: 'Ligands',
      value: 'ATP, MG',
      description: 'Selected: ATP'
    })
    expect(rowsById.get('elements')).toMatchObject({
      label: 'Elements',
      value: 'C, Zn'
    })
    expect(model.selection.summary).toBe('Selected 1 chain, 2 residues, 2 atoms, 1 ligand, 2 elements.')
    expect(model.actions.map((action) => [action.id, action.kind])).toEqual([
      ['molecular.select', 'select'],
      ['molecular.measureDistance', 'measure'],
      ['workspace.setSelection', 'select']
    ])
    expect(model.agentSummary).toContain('1 model')
    expect(model.agentSummary).toContain('actions: Select Structure, Measure Distance, Select')
  })

  it('reports empty and unsupported states without trying to render a molecular viewport', () => {
    const empty = buildMolecularWorkspaceViewerModel(null)
    const unsupported = buildMolecularWorkspaceViewerModel({
      schemaVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
      file: {
        path: '/workspace/lab/samples.csv',
        workspaceRoot: '/workspace/lab',
        mimeType: 'text/csv'
      },
      view: {
        pluginId: 'tabular',
        modality: 'tabular',
        mode: 'preview',
        title: 'samples.csv'
      },
      actions: ['workspace.setSelection']
    })
    const emptyHtml = renderToStaticMarkup(createElement(MolecularWorkspaceViewer, { model: empty }))
    const unsupportedHtml = renderToStaticMarkup(createElement(MolecularWorkspaceViewer, { model: unsupported }))

    expect(empty.status).toMatchObject({
      kind: 'empty',
      title: 'No molecular observation'
    })
    expect(unsupported.status).toMatchObject({
      kind: 'unsupported',
      title: 'Unsupported observation'
    })
    expect(emptyHtml).toContain('data-status="empty"')
    expect(emptyHtml).not.toContain('data-webgl-placeholder')
    expect(unsupportedHtml).toContain('data-status="unsupported"')
    expect(unsupportedHtml).toContain('Tabular observations cannot be rendered')
  })

  it('renders the WebGL mount placeholder and selected atom, residue, and ligand details', () => {
    const html = renderToStaticMarkup(createElement(MolecularWorkspaceViewer, {
      observation: createMolecularObservation()
    }))

    expect(html).toContain('data-workspace-preview-molecular-viewer')
    expect(html).toContain('data-webgl-viewport')
    expect(html).toContain('data-molecular-render-state="idle"')
    expect(html).toContain('Waiting for a molecular structure asset.')
    expect(html).toContain('Selected residues')
    expect(html).toContain('GLY A:42')
    expect(html).toContain('Selected atoms')
    expect(html).toContain('C #4')
    expect(html).toContain('Selected ligands')
    expect(html).toContain('ATP')
    expect(html).toContain('data-action-kind="measure"')
  })

  it('renders representation and selection controls backed by molecular edit operations', () => {
    const observation = createMolecularObservation({
      molecular: {
        modelCount: 1,
        chains: ['A', 'B'],
        ligands: ['ATP', 'MG'],
        representations: ['cartoon', 'surface', 'stick']
      }
    })
    const html = renderToStaticMarkup(createElement(MolecularWorkspaceViewer, {
      observation,
      onApplyEdit: async () => undefined
    }))

    expect(defaultMolecularRepresentationMode(observation)).toBe('cartoon-stick')
    expect(html).toContain('data-molecular-representation-controls')
    expect(html).toContain('data-molecular-representation-option="cartoon-stick"')
    expect(html).toContain('data-selected="true"')
    expect(html).toContain('data-molecular-select-chain="A"')
    expect(html).toContain('data-molecular-select-ligand="ATP"')
    expect(html).toContain('data-molecular-clear-selection')
    expect(createMolecularChainSelectionOperation(observation, 'B')).toEqual({
      kind: 'molecular.setSelection',
      path: '/workspace/lab/protein.pdb',
      selection: {
        kind: 'molecular',
        chains: ['B']
      }
    })
    expect(createMolecularLigandSelectionOperation(observation, 'MG')).toEqual({
      kind: 'molecular.setSelection',
      path: '/workspace/lab/protein.pdb',
      selection: {
        kind: 'molecular',
        ligands: ['MG']
      }
    })
    expect(createMolecularClearSelectionOperation(observation)).toEqual({
      kind: 'molecular.setSelection',
      path: '/workspace/lab/protein.pdb',
      selection: {
        kind: 'molecular'
      }
    })
  })

  it('resolves bounded renderable assets and rejects unsafe full-asset reads', () => {
    const observation = createMolecularObservation()
    const asset = createMolecularAssetDescriptor()

    expect(resolveMolecularRenderableAsset({ asset, observation })).toEqual({
      ok: true,
      format: 'pdb',
      byteLength: 67
    })
    expect(resolveMolecularRenderableAsset({
      asset: createMolecularAssetDescriptor({
        range: {
          available: true,
          maxChunkBytes: 4 * 1024 * 1024,
          recommendedChunkBytes: 1024 * 1024,
          size: 3_000_000
        }
      }),
      observation
    })).toMatchObject({
      ok: false,
      reason: expect.stringContaining('interactive rendering is limited')
    })
    expect(resolveMolecularRenderableAsset({
      asset: createMolecularAssetDescriptor({
        file: {
          name: 'trajectory.dcd',
          relativePath: 'trajectory.dcd',
          mimeType: 'application/octet-stream',
          size: 67
        }
      }),
      observation
    })).toMatchObject({
      ok: false,
      reason: expect.stringContaining('not available')
    })
  })

  it('reads molecular render text through byte-range results without accepting truncation', async () => {
    const source = 'ATOM      1  N   MET A   1      11.104  13.207   9.447\nEND\n'
    const dataBase64 = btoa(source)
    const readRange = async () => ({
      ok: true as const,
      sessionId: 'session-molecular',
      assetId: 'asset:session-molecular',
      offset: 0,
      length: source.length,
      size: source.length,
      dataBase64
    })

    await expect(readMolecularRenderableAssetText({
      renderable: {
        ok: true,
        format: 'pdb',
        byteLength: source.length
      },
      readRange
    })).resolves.toEqual({
      ok: true,
      text: source
    })
    expect(decodeWorkspacePreviewBase64Text(dataBase64)).toBe(source)
    await expect(readMolecularRenderableAssetText({
      renderable: {
        ok: true,
        format: 'pdb',
        byteLength: source.length + 1
      },
      readRange
    })).resolves.toMatchObject({
      ok: false,
      reason: expect.stringContaining('refusing to render a truncated molecular model')
    })
  })
})
