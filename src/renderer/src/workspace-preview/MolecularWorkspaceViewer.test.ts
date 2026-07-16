import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  WORKSPACE_PREVIEW_CONTRACT_VERSION,
  WORKSPACE_PREVIEW_MAX_RANGE_BYTES,
  type WorkspaceObservation,
  type WorkspacePreviewAssetTransportDescriptor
} from '@shared/workspace-preview'
import {
  activateMolecularWorkbenchRendererHandle,
  buildMolecularWorkspaceViewerModel,
  createMolecularChainSelectionOperation,
  createMolecularClearSelectionOperation,
  createMolecularLigandSelectionOperation,
  decodeWorkspacePreviewBase64Text,
  MolecularWorkspaceViewer,
  molecularWorkbenchSourceIdentity,
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
      'molecular.workbench',
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

const pdbFormat = {
  kind: 'structure',
  format: 'pdb',
  isBinary: false
} as const

describe('MolecularWorkspaceViewer', () => {
  it('builds an agent-readable Mol* workbench model from observation summary and selection', () => {
    const model = buildMolecularWorkspaceViewerModel(createMolecularObservation())
    const rowsById = new Map(model.structureRows.map((row) => [row.id, row]))

    expect(model.status.kind).toBe('ready')
    expect(model.status.title).toBe('Mol* workbench ready')
    expect(model.title).toBe('Protein structure')
    expect(model.capabilities).toEqual({
      structure: true,
      density: false,
      trajectory: false,
      selection: true,
      measurements: true,
      screenshot: true
    })
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
    expect(model.agentSummary).toContain('1 model')
    expect(model.agentSummary).toContain('Mol* capabilities: structure, selection, measurements, screenshot')
  })

  it('opens safely at whole-structure scope when no molecular selector can be mapped', () => {
    const withoutSelector = buildMolecularWorkspaceViewerModel(createMolecularObservation({
      selection: undefined
    }))
    const incompatibleAnchor = buildMolecularWorkspaceViewerModel(createMolecularObservation({
      selection: {
        kind: 'document',
        anchors: [{ id: 'source-anchor', page: 2 }]
      }
    }))

    expect(withoutSelector.selection.summary).toContain('whole-structure scope')
    expect(incompatibleAnchor.selection.summary).toContain('cannot be mapped to chains')
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
    expect(emptyHtml).not.toContain('data-webgl-viewport')
    expect(unsupportedHtml).toContain('data-status="unsupported"')
    expect(unsupportedHtml).toContain('Tabular observations cannot be rendered')
  })

  it('renders the Mol* mount point and selected atom, residue, and ligand details', () => {
    const html = renderToStaticMarkup(createElement(MolecularWorkspaceViewer, {
      observation: createMolecularObservation()
    }))

    expect(html).toContain('data-workspace-preview-molecular-viewer')
    expect(html).toContain('data-molecular-workbench')
    expect(html).not.toContain('workspace-preview-molecular-viewer__header')
    expect(html).toContain('data-webgl-viewport')
    expect(html).toContain('data-molecular-render-container')
    expect(html).toContain('data-molecular-render-state="idle"')
    expect(html).toContain('data-molecular-capability-structure="true"')
    expect(html).toContain('data-molecular-capability-summary')
    expect(html).toContain('data-molecular-capability="measurements"')
    expect(html).toContain('Waiting for a molecular workspace asset.')
    expect(html).toContain('Selected residues')
    expect(html).toContain('GLY A:42')
    expect(html).toContain('Selected atoms')
    expect(html).toContain('C #4')
    expect(html).toContain('Selected ligands')
    expect(html).toContain('ATP')
  })

  it('renders unified session selection controls backed by molecular edit operations', () => {
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

    expect(html).toContain('data-molecular-selection-controls')
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

  it('resolves bounded Mol* renderable assets', () => {
    const observation = createMolecularObservation()
    const asset = createMolecularAssetDescriptor()

    expect(resolveMolecularRenderableAsset({ asset, observation })).toEqual({
      ok: true,
      byteLength: 67,
      source: {
        kind: 'data',
        text: '',
        format: pdbFormat,
        label: 'protein.pdb'
      }
    })
  })

  it('keeps direct data loading bounded while allowing Mol* URL loading for large and binary assets', () => {
    const observation = createMolecularObservation()
    const largeAsset = createMolecularAssetDescriptor({
      range: {
        available: true,
        maxChunkBytes: 4 * 1024 * 1024,
        recommendedChunkBytes: 1024 * 1024,
        size: WORKSPACE_PREVIEW_MAX_RANGE_BYTES + 1
      }
    })
    const densityAsset = createMolecularAssetDescriptor({
      file: {
        name: 'density.mrc',
        relativePath: 'density.mrc',
        mimeType: 'application/octet-stream',
        size: 256
      },
      range: {
        available: true,
        maxChunkBytes: 4 * 1024 * 1024,
        recommendedChunkBytes: 1024 * 1024,
        size: 256
      }
    })
    const trajectoryAsset = createMolecularAssetDescriptor({
      file: {
        name: 'trajectory.dcd',
        relativePath: 'trajectory.dcd',
        mimeType: 'application/octet-stream',
        size: 67
      }
    })

    expect(resolveMolecularRenderableAsset({ asset: largeAsset, observation })).toMatchObject({
      ok: false,
      reason: expect.stringContaining('direct data loading is limited')
    })
    expect(resolveMolecularRenderableAsset({
      asset: largeAsset,
      observation,
      sourceUrl: 'http://localhost:5173/assets/large-protein'
    })).toMatchObject({
      ok: true,
      source: {
        kind: 'url',
        format: {
          kind: 'structure',
          format: 'pdb'
        }
      }
    })
    expect(resolveMolecularRenderableAsset({ asset: densityAsset, observation })).toMatchObject({
      ok: false,
      kind: 'fallback',
      reason: expect.stringContaining('requires a workspace asset URL')
    })
    expect(resolveMolecularRenderableAsset({
      asset: densityAsset,
      observation,
      sourceUrl: 'http://localhost:5173/assets/density'
    })).toMatchObject({
      ok: true,
      source: {
        kind: 'url',
        format: {
          kind: 'volume',
          format: 'ccp4'
        }
      }
    })
    expect(resolveMolecularRenderableAsset({ asset: trajectoryAsset, observation })).toMatchObject({
      ok: false,
      kind: 'fallback',
      reason: expect.stringContaining('paired topology')
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
      byteLength: source.length,
      readRange
    })).resolves.toEqual({
      ok: true,
      text: source
    })
    expect(decodeWorkspacePreviewBase64Text(dataBase64)).toBe(source)
    await expect(readMolecularRenderableAssetText({
      byteLength: source.length + 1,
      readRange
    })).resolves.toMatchObject({
      ok: false,
      reason: expect.stringContaining('refusing to load a truncated molecular model')
    })
  })

  it('keys Mol* source loading by source identity rather than observation selection or callback identity', () => {
    const asset = createMolecularAssetDescriptor()
    const identity = molecularWorkbenchSourceIdentity({
      observationPath: '/workspace/lab/protein.pdb',
      asset,
      sourceUrl: 'sciforge-resource://asset/session-molecular',
      rangeReaderAvailable: true
    })
    const sameSource = molecularWorkbenchSourceIdentity({
      observationPath: '/workspace/lab/protein.pdb',
      asset: { ...asset },
      sourceUrl: 'sciforge-resource://asset/session-molecular',
      rangeReaderAvailable: true
    })
    const nextSession = molecularWorkbenchSourceIdentity({
      observationPath: '/workspace/lab/protein.pdb',
      asset: { ...asset, sessionId: 'session-next' },
      sourceUrl: 'sciforge-resource://asset/session-next',
      rangeReaderAvailable: true
    })

    expect(sameSource).toBe(identity)
    expect(nextSession).not.toBe(identity)
  })

  it('replays the latest selection when an asynchronous renderer handle becomes active', () => {
    const handleRef = { current: null }
    const setSelection = vi.fn()
    const handle = {
      setSelection,
      resize: vi.fn(),
      dispose: vi.fn()
    }
    const latestSelection = {
      kind: 'molecular' as const,
      chains: ['B']
    }

    activateMolecularWorkbenchRendererHandle(handleRef, handle, latestSelection)

    expect(handleRef.current).toBe(handle)
    expect(setSelection).toHaveBeenCalledWith(latestSelection)
  })
})
