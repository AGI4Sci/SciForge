// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  WORKSPACE_PREVIEW_CONTRACT_VERSION,
  WORKSPACE_PREVIEW_MAX_RANGE_BYTES,
  workspacePreviewModalitySchema,
  type WorkspacePreviewAssetTransportDescriptor
} from '@sciforge/domain-sdk/workspace-preview'
import type { LifeScienceWorkspaceObservation as WorkspaceObservation } from '../wire'
import {
  activateMolecularWorkbenchRendererHandle,
  buildMolecularWorkspaceViewerModel,
  createMolecularChainSelectionOperation,
  createMolecularResidueSelectionOperation,
  createMolecularClearSelectionOperation,
  createMolecularLigandSelectionOperation,
  decodeWorkspacePreviewBase64Text,
  MolecularWorkspaceViewer,
  MOLECULAR_SET_SELECTION_OPERATION_TYPE,
  molecularWorkbenchSourceIdentity,
  readMolecularRenderableAssetText,
  resolveMolecularRenderableAsset,
  type MolecularWorkspaceViewerProps,
  type MolecularWorkspaceViewerApplyEditHandler
} from './MolecularWorkspaceViewer'
import type { MolecularWorkbenchRenderer, MolecularWorkbenchRendererHandle, MolecularWorkbenchRendererInput } from './molecular-molstar'

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
    modality: workspacePreviewModalitySchema.parse('sciforge.life-science-preview.molecular'),
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
        kind: 'sequence',
        ranges: [{ start: 1, end: 2 }]
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
    expect(html).toContain('grid-rows-[minmax(18rem,1fr)_minmax(8rem,14rem)] overflow-auto')
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
      kind: 'domain.applyEdit',
      path: '/workspace/lab/protein.pdb',
      operationType: 'sciforge.life-science-preview.molecular.set-selection',
      data: { selection: { kind: 'molecular', chains: ['B'] } }
    })
    expect(createMolecularLigandSelectionOperation(observation, 'MG')).toEqual({
      kind: 'domain.applyEdit',
      path: '/workspace/lab/protein.pdb',
      operationType: 'sciforge.life-science-preview.molecular.set-selection',
      data: { selection: { kind: 'molecular', ligands: ['MG'] } }
    })
    expect(createMolecularClearSelectionOperation(observation)).toEqual({
      kind: 'domain.applyEdit',
      path: '/workspace/lab/protein.pdb',
      operationType: 'sciforge.life-science-preview.molecular.set-selection',
      data: { selection: { kind: 'molecular' } }
    })
    expect(createMolecularResidueSelectionOperation(observation, [
      { chain: 'A', index: 3, name: 'CYS' }
    ])).toEqual({
      kind: 'domain.applyEdit',
      path: '/workspace/lab/protein.pdb',
      operationType: 'sciforge.life-science-preview.molecular.set-selection',
      data: { selection: { kind: 'molecular', residues: [{ chain: 'A', index: 3, name: 'CYS' }] } }
    })
    expect(html).toContain('Click each residue to add it')
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


describe('MolecularWorkspaceViewer selection lifecycle', () => {
  beforeEach(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true))
  let root: Root | undefined
  let container: HTMLDivElement | undefined
  afterEach(async () => {
    await act(async () => root?.unmount())
    container?.remove()
    root = undefined
    container = undefined
    vi.unstubAllGlobals()
  })

  function setup() {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    const handles: MolecularWorkbenchRendererHandle[] = []
    const inputs: MolecularWorkbenchRendererInput[] = []
    const renderer = vi.fn(async (input: MolecularWorkbenchRendererInput) => {
      inputs.push(input)
      const handle = { setSelection: vi.fn(), resize: vi.fn(), dispose: vi.fn() }
      handles.push(handle)
      return handle
    })
    const onApplyEdit = vi.fn<MolecularWorkspaceViewerApplyEditHandler>(async () => undefined)
    const render = async (observation: WorkspaceObservation, workbenchRenderer: MolecularWorkbenchRenderer = renderer, props: Partial<MolecularWorkspaceViewerProps> = {}) => {
      await act(async () => {
        root!.render(createElement(MolecularWorkspaceViewer, {
          observation,
          asset: createMolecularAssetDescriptor(),
          assetStatus: 'ready',
          sourceUrl: 'https://example.test/protein.pdb',
          workbenchRenderer,
          onApplyEdit,
          ...props
        }))
      })
    }
    return { inputs, handles, renderer, onApplyEdit, render }
  }

  const first = { kind: 'molecular' as const, residues: [{ chain: 'A', index: 3 }] }
  const both = { kind: 'molecular' as const, residues: [...first.residues, { chain: 'A', index: 40 }] }

  it('honors an authoritative host narrowing and clear without reinitializing Mol*', async () => {
    const { render, renderer, inputs, handles, onApplyEdit } = setup()
    await render(createMolecularObservation({ selection: { kind: 'molecular' } }))
    await act(async () => inputs[0]!.onSelectionChange?.(both))
    // The host can explicitly narrow a viewport selection, including to a subset.
    await render(createMolecularObservation({ selection: first }))
    expect(onApplyEdit).toHaveBeenCalledTimes(1)
    expect(handles[0]!.setSelection).toHaveBeenLastCalledWith(first)
    await render(createMolecularObservation({ selection: { kind: 'molecular' } }))
    expect(handles[0]!.setSelection).toHaveBeenLastCalledWith({ kind: 'molecular' })
    expect(renderer).toHaveBeenCalledTimes(1)
  })

  it('coalesces rapid add, multi-select, deselect and clear into ordered owner saves', async () => {
    const { render, inputs, onApplyEdit } = setup()
    await render(createMolecularObservation({ selection: { kind: 'molecular' } }))
    await act(async () => {
      inputs[0]!.onSelectionChange?.(first)
      inputs[0]!.onSelectionChange?.(both)
      inputs[0]!.onSelectionChange?.(first)
      inputs[0]!.onSelectionChange?.({ kind: 'molecular' })
    })
    expect(onApplyEdit.mock.calls.map(([operation]) => operation)).toEqual(
      [first, { kind: 'molecular' }].map((selection) => ({
        kind: 'domain.applyEdit',
        path: '/workspace/lab/protein.pdb',
        operationType: MOLECULAR_SET_SELECTION_OPERATION_TYPE,
        data: { selection }
      }))
    )
  })

  function deferred() {
    let resolve!: () => void
    let reject!: (error: Error) => void
    const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no })
    return { promise, resolve, reject }
  }

  async function click(selector: string) {
    const button = container!.querySelector<HTMLButtonElement>(selector)
    expect(button).not.toBeNull()
    await act(async () => button!.click())
  }

  function trackedOwner() {
    const viewer = setup()
    let observation = createMolecularObservation()
    let active = 0
    let maxActive = 0
    const saves: Array<{ operation: Parameters<MolecularWorkspaceViewerApplyEditHandler>[0]; gate: ReturnType<typeof deferred> }> = []
    viewer.onApplyEdit.mockImplementation((operation) => {
      active += 1
      maxActive = Math.max(maxActive, active)
      const gate = deferred()
      saves.push({ operation, gate })
      return gate.promise.finally(() => { active -= 1 })
    })
    const settle = async (index: number, failure?: Error) => {
      const save = saves[index]!
      if (!failure) {
        observation = { ...observation, selection: (save.operation.data as { selection: WorkspaceObservation['selection'] }).selection }
        await viewer.render(observation)
      }
      await act(async () => {
        if (failure) save.gate.reject(failure)
        else save.gate.resolve()
      })
    }
    return { ...viewer, saves, settle, start: async () => {
      await viewer.render(observation)
      // Even an adapter echo of a programmatic selection must not resave it.
      vi.mocked(viewer.handles[0]!.setSelection).mockImplementation((selection) => {
        viewer.inputs[0]!.onSelectionChange?.(selection ?? { kind: 'molecular' })
      })
    },
      get owner() { return observation.selection }, get active() { return active }, get maxActive() { return maxActive } }
  }

  it.each([
    ['[data-molecular-clear-selection]', { kind: 'molecular' }],
    ['[data-molecular-select-chain="B"]', { kind: 'molecular', chains: ['B'] }],
    ['[data-molecular-select-ligand="MG"]', { kind: 'molecular', ligands: ['MG'] }]
  ] as const)('serializes viewport A then actual Inspector %s and converges to owner', async (selector, latest) => {
    const owner = trackedOwner()
    await owner.start()
    await act(async () => owner.inputs[0]!.onSelectionChange?.(first))
    await click(selector)
    expect(owner.active).toBe(1)
    expect(owner.saves).toHaveLength(1)
    await owner.settle(0)
    expect(owner.saves[1]!.operation).toEqual({ kind: 'domain.applyEdit', path: '/workspace/lab/protein.pdb',
      operationType: MOLECULAR_SET_SELECTION_OPERATION_TYPE, data: { selection: latest } })
    await owner.settle(1)
    expect(owner.maxActive).toBe(1)
    expect(owner.active).toBe(0)
    expect(owner.owner).toEqual(latest)
    expect(owner.handles[0]!.setSelection).toHaveBeenLastCalledWith(latest)
  })

  it.each(['[data-molecular-select-chain="B"]', '[data-molecular-select-ligand="MG"]'])(
    'coalesces rapid Inspector and viewport intents behind actual %s', async (selector) => {
      const owner = trackedOwner()
      await owner.start()
      await click(selector)
      await click('[data-molecular-select-chain="A"]')
      await act(async () => owner.inputs[0]!.onSelectionChange?.(both))
      await click('[data-molecular-select-ligand="ATP"]')
      await act(async () => owner.inputs[0]!.onSelectionChange?.({ kind: 'molecular' }))
      expect(owner.active).toBe(1)
      expect(owner.saves).toHaveLength(1)
      await owner.settle(0)
      expect(owner.saves[1]!.operation.data).toEqual({ selection: { kind: 'molecular' } })
      await owner.settle(1)
      expect(owner.saves).toHaveLength(2)
      expect(owner.maxActive).toBe(1)
      expect(owner.owner).toEqual({ kind: 'molecular' })
      expect(owner.handles[0]!.setSelection).toHaveBeenLastCalledWith(owner.owner)
    }
  )

  it('keeps newer viewport intent after Inspector failure and supports same-button retry', async () => {
    const owner = trackedOwner()
    await owner.start()
    await click('[data-molecular-select-chain="B"]')
    await act(async () => owner.inputs[0]!.onSelectionChange?.(both))
    expect(owner.saves).toHaveLength(1)
    await owner.settle(0, new Error('Inspector rejected'))
    expect(container!.querySelector('[role="alert"]')!.textContent).toContain('Inspector rejected')
    expect(owner.saves[1]!.operation.data).toEqual({ selection: both })
    await owner.settle(1)
    expect(owner.owner).toEqual(both)
    expect(owner.handles[0]!.setSelection).toHaveBeenLastCalledWith(both)
    await click('[data-molecular-select-chain="B"]')
    await owner.settle(2, new Error('retry me'))
    await click('[data-molecular-select-chain="B"]')
    await owner.settle(3)
    expect(owner.maxActive).toBe(1)
    expect(owner.owner).toEqual({ kind: 'molecular', chains: ['B'] })
    expect(container!.querySelector('[role="alert"]')).toBeNull()
  })

  it('catches synchronous Inspector throws and permits identical explicit retry', async () => {
    const viewer = setup()
    viewer.onApplyEdit.mockImplementationOnce(() => { throw new Error('synchronous Inspector failure') })
    await viewer.render(createMolecularObservation())
    await click('[data-molecular-select-ligand="MG"]')
    expect(container!.querySelector('[role="alert"]')!.textContent).toContain('synchronous Inspector failure')
    await click('[data-molecular-select-ligand="MG"]')
    expect(viewer.onApplyEdit).toHaveBeenCalledTimes(2)
    expect(container!.querySelector('[role="alert"]')).toBeNull()
  })

  it.each([
    ['source', 'success'], ['source', 'failure'],
    ['session', 'success'], ['session', 'failure'],
    ['workspace', 'success'], ['workspace', 'failure'],
    ['unmount', 'success'], ['unmount', 'failure']
  ] as const)(
    'drops pending Inspector/viewport work on %s replacement with late %s', async (change, outcome) => {
      const viewer = setup()
      const old = deferred()
      viewer.onApplyEdit.mockImplementationOnce(() => old.promise)
      await viewer.render(createMolecularObservation())
      await click('[data-molecular-select-chain="B"]')
      await click('[data-molecular-select-ligand="MG"]')
      await act(async () => viewer.inputs[0]!.onSelectionChange?.(both))
      if (change === 'unmount') {
        await act(async () => root!.unmount())
        root = undefined
      } else {
        const file = { path: change === 'source' ? '/workspace/lab/new.pdb' : '/workspace/lab/protein.pdb',
          workspaceRoot: change === 'workspace' ? '/workspace/new' : '/workspace/lab' }
        await viewer.render(createMolecularObservation({ file }), viewer.renderer,
          change === 'session' ? { asset: createMolecularAssetDescriptor({ sessionId: 'next-session' }) } : {})
        await click('[data-molecular-select-ligand="ATP"]')
        expect(viewer.onApplyEdit).toHaveBeenCalledTimes(2)
      }
      const currentSelectionCalls = vi.mocked(viewer.handles.at(-1)!.setSelection).mock.calls.length
      await act(async () => {
        if (outcome === 'success') old.resolve()
        else old.reject(new Error('late Inspector error'))
        viewer.inputs[0]!.onSelectionChange?.(first)
      })
      expect(vi.mocked(viewer.handles.at(-1)!.setSelection).mock.calls).toHaveLength(currentSelectionCalls)
      expect(viewer.onApplyEdit).toHaveBeenCalledTimes(change === 'unmount' ? 1 : 2)
      expect(container!.textContent).not.toContain('late Inspector error')
    }
  )

  it('keeps one Inspector queue as transport changes from loading to ready', async () => {
    const viewer = setup()
    const saving = deferred()
    viewer.onApplyEdit.mockImplementationOnce(() => saving.promise)
    const observation = createMolecularObservation()
    await viewer.render(observation, viewer.renderer, { assetStatus: 'loading' })
    await click('[data-molecular-select-chain="B"]')
    await viewer.render(observation)
    await click('[data-molecular-select-ligand="MG"]')
    expect(viewer.onApplyEdit).toHaveBeenCalledTimes(1)
    await act(async () => saving.resolve())
    expect(viewer.onApplyEdit.mock.calls.map(([operation]) => operation.data)).toEqual([
      { selection: { kind: 'molecular', chains: ['B'] } },
      { selection: { kind: 'molecular', ligands: ['MG'] } }
    ])
  })

  it.each([
    { assetStatus: 'loading' as const },
    { asset: null, sourceUrl: null },
    { sourceUrl: null },
    { assetStatus: 'error' as const, assetError: 'unavailable' }
  ])('saves Inspector buttons without live source transport: %j', async (props) => {
    const viewer = setup()
    await viewer.render(createMolecularObservation(), viewer.renderer, props)
    await click('[data-molecular-select-chain="B"]')
    await click('[data-molecular-select-ligand="MG"]')
    await click('[data-molecular-clear-selection]')
    expect(viewer.renderer).not.toHaveBeenCalled()
    expect(viewer.onApplyEdit.mock.calls.map(([operation]) => operation)).toEqual([
      createMolecularChainSelectionOperation(createMolecularObservation(), 'B'),
      createMolecularLigandSelectionOperation(createMolecularObservation(), 'MG'),
      createMolecularClearSelectionOperation(createMolecularObservation())
    ])
  })

  it('keeps AB across an old A echo and sends AB only after A settles', async () => {
    const { render, inputs, handles, onApplyEdit } = setup()
    const a = deferred()
    const ab = deferred()
    onApplyEdit.mockImplementationOnce(() => a.promise).mockImplementationOnce(() => ab.promise)
    await render(createMolecularObservation({ selection: { kind: 'molecular' } }))
    await act(async () => inputs[0]!.onSelectionChange?.(first))
    await act(async () => inputs[0]!.onSelectionChange?.(both))
    await render(createMolecularObservation({ selection: first }))
    expect(onApplyEdit).toHaveBeenCalledTimes(1)
    expect(handles[0]!.setSelection).not.toHaveBeenLastCalledWith(first)
    await act(async () => a.resolve())
    expect(onApplyEdit).toHaveBeenCalledTimes(2)
    expect(onApplyEdit.mock.calls[1]![0].data).toEqual({ selection: both })
    await render(createMolecularObservation({ selection: both }))
    await act(async () => ab.resolve())
    await render(createMolecularObservation({ selection: first }))
    expect(handles[0]!.setSelection).toHaveBeenLastCalledWith(first)
  })

  it('coalesces while deferred and continues latest after a visible first failure', async () => {
    const { render, inputs, onApplyEdit } = setup()
    const a = deferred()
    onApplyEdit.mockImplementationOnce(() => a.promise)
    await render(createMolecularObservation({ selection: { kind: 'molecular' } }))
    await act(async () => {
      for (const selection of [first, both, first, { kind: 'molecular' as const }]) {
        inputs[0]!.onSelectionChange?.(selection)
      }
    })
    expect(onApplyEdit).toHaveBeenCalledTimes(1)
    await act(async () => a.reject(new Error('first save failed')))
    expect(onApplyEdit.mock.calls.map(([operation]) => operation.data)).toEqual([
      { selection: first }, { selection: { kind: 'molecular' } }
    ])
    expect(container!.textContent).toContain('first save failed')
    await act(async () => inputs[0]!.onSelectionChange?.(first))
    expect(container!.textContent).not.toContain('first save failed')
  })

  it('converges to an owner replacement received during the last pending save without another render', async () => {
    const { render, inputs, handles, onApplyEdit } = setup()
    const saving = deferred()
    const authoritative = { kind: 'molecular' as const, chains: ['Z'] }
    onApplyEdit.mockImplementationOnce(() => saving.promise)
    await render(createMolecularObservation({ selection: { kind: 'molecular' } }))
    await act(async () => inputs[0]!.onSelectionChange?.(first))
    await render(createMolecularObservation({ selection: authoritative }))
    expect(handles[0]!.setSelection).not.toHaveBeenLastCalledWith(authoritative)
    await act(async () => saving.resolve())
    expect(handles[0]!.setSelection).toHaveBeenLastCalledWith(authoritative)
    await act(async () => inputs[0]!.onSelectionChange?.(first))
    expect(onApplyEdit).toHaveBeenCalledTimes(2)
  })

  it('restores owner after a failed latest queued save and allows the same pick again', async () => {
    const { render, inputs, handles, onApplyEdit } = setup()
    const a = deferred()
    onApplyEdit.mockImplementationOnce(() => a.promise).mockRejectedValueOnce(new Error('latest failed'))
    await render(createMolecularObservation({ selection: { kind: 'molecular' } }))
    await act(async () => { inputs[0]!.onSelectionChange?.(first); inputs[0]!.onSelectionChange?.(both) })
    await render(createMolecularObservation({ selection: first }))
    await act(async () => a.resolve())
    expect(handles[0]!.setSelection).toHaveBeenLastCalledWith(first)
    expect(container!.textContent).toContain('latest failed')
    await act(async () => inputs[0]!.onSelectionChange?.(both))
    expect(onApplyEdit).toHaveBeenCalledTimes(3)
    expect(container!.textContent).not.toContain('latest failed')
  })

  it.each([
    ['source', 'success'], ['source', 'failure'],
    ['session', 'success'], ['session', 'failure'],
    ['unmount', 'success'], ['unmount', 'failure']
  ] as const)('cancels unsent snapshots on %s change with late %s completion', async (change, outcome) => {
    const { render, inputs, onApplyEdit, renderer } = setup()
    const old = deferred()
    onApplyEdit.mockImplementationOnce(() => old.promise)
    await render(createMolecularObservation({ selection: { kind: 'molecular' } }))
    await act(async () => { inputs[0]!.onSelectionChange?.(first); inputs[0]!.onSelectionChange?.(both) })
    if (change === 'unmount') {
      await act(async () => root!.unmount())
      root = undefined
    } else if (change === 'source') {
      await render(createMolecularObservation({ file: { path: '/workspace/lab/new.pdb', workspaceRoot: '/workspace/lab' } }))
    } else {
      await act(async () => root!.render(createElement(MolecularWorkspaceViewer, {
        observation: createMolecularObservation({ selection: { kind: 'molecular' } }),
        asset: createMolecularAssetDescriptor({ sessionId: 'new-session' }), assetStatus: 'ready',
        sourceUrl: 'https://example.test/protein.pdb', workbenchRenderer: renderer, onApplyEdit
      })))
    }
    if (change !== 'unmount') {
      await act(async () => inputs[1]!.onSelectionChange?.(first))
      expect(onApplyEdit).toHaveBeenCalledTimes(2)
    }
    await act(async () => {
      if (outcome === 'success') old.resolve()
      else old.reject(new Error('old source error'))
      inputs[0]!.onSelectionError?.(new Error('cancelled mapping error'))
    })
    expect(onApplyEdit).toHaveBeenCalledTimes(change === 'unmount' ? 1 : 2)
    expect(container!.textContent).not.toContain('old source error')
    expect(container!.textContent).not.toContain('cancelled mapping error')
  })

  it('reports adapter overflow, restores owner and accepts a smaller pick', async () => {
    const { render, inputs, handles, onApplyEdit } = setup()
    await render(createMolecularObservation({ selection: first }))
    await act(async () => inputs[0]!.onSelectionError?.(new Error('Molecular selection exceeds 256 unique residues.')))
    expect(handles[0]!.setSelection).toHaveBeenLastCalledWith(first)
    expect(container!.textContent).toContain('exceeds 256')
    expect(onApplyEdit).not.toHaveBeenCalled()
    await act(async () => inputs[0]!.onSelectionChange?.(both))
    expect(onApplyEdit).toHaveBeenCalledTimes(1)
    expect(container!.textContent).not.toContain('exceeds 256')
  })

  it('restores owner in order after overflow during an active save and discards the invalidated pending pick', async () => {
    const { render, inputs, handles, onApplyEdit } = setup()
    const a = deferred()
    onApplyEdit.mockImplementationOnce(() => a.promise)
    const clear = { kind: 'molecular' as const }
    await render(createMolecularObservation({ selection: clear }))
    await act(async () => { inputs[0]!.onSelectionChange?.(first); inputs[0]!.onSelectionChange?.(both) })
    await act(async () => inputs[0]!.onSelectionError?.(new Error('exceeds 256 unique residues')))
    expect(handles[0]!.setSelection).toHaveBeenLastCalledWith(clear)
    await render(createMolecularObservation({ selection: first }))
    await act(async () => a.resolve())
    expect(onApplyEdit.mock.calls.map(([operation]) => operation.data)).toEqual([
      { selection: first }, { selection: clear }
    ])
    expect(container!.textContent).toContain('exceeds 256')
    await act(async () => inputs[0]!.onSelectionChange?.(both))
    expect(onApplyEdit).toHaveBeenCalledTimes(3)
    expect(container!.textContent).not.toContain('exceeds 256')
  })

  it('ignores callbacks from a pending renderer after changing files or unmounting', async () => {
    const { render, inputs, renderer, onApplyEdit } = setup()
    let resolveOld!: (handle: MolecularWorkbenchRendererHandle) => void
    let oldInput!: MolecularWorkbenchRendererInput
    const pendingRenderer = vi.fn((input: MolecularWorkbenchRendererInput) => {
      oldInput = input
      return new Promise<MolecularWorkbenchRendererHandle>((resolve) => { resolveOld = resolve })
    })
    await render(createMolecularObservation(), pendingRenderer)
    await render(createMolecularObservation({
      file: { path: '/workspace/lab/other.pdb', workspaceRoot: '/workspace/lab' }
    }), renderer)
    const oldHandle = { setSelection: vi.fn(), resize: vi.fn(), dispose: vi.fn() }
    await act(async () => {
      oldInput.onSelectionChange?.(first)
      resolveOld(oldHandle)
    })
    expect(oldHandle.dispose).toHaveBeenCalledOnce()
    expect(onApplyEdit).not.toHaveBeenCalled()
    await act(async () => root!.unmount())
    root = undefined
    await act(async () => inputs[0]!.onSelectionChange?.(first))
    expect(onApplyEdit).not.toHaveBeenCalled()
  })

  it('reports a rejected save, restores host selection and allows the same selection to be retried', async () => {
    const { render, inputs, onApplyEdit } = setup()
    onApplyEdit.mockRejectedValueOnce(new Error('Session is no longer available.'))
    await render(createMolecularObservation({ selection: { kind: 'molecular' } }))
    await act(async () => inputs[0]!.onSelectionChange?.(first))
    expect(container!.textContent).toContain('Molecular selection could not be saved')
    expect(container!.textContent).toContain('Session is no longer available.')
    await act(async () => inputs[0]!.onSelectionChange?.(first))
    expect(onApplyEdit).toHaveBeenCalledTimes(2)
    expect(container!.textContent).not.toContain('Molecular selection could not be saved')
  })
})
