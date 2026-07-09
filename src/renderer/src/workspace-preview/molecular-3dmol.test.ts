import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyMolecularRepresentationStyle,
  applyMolecularSelectionStyle,
  molecularRepresentationModeForObservation,
  molecularRepresentationStyle,
  molecularSelectionSpecs,
  renderMolecularStructureWith3Dmol,
  type Molecular3DmolViewer
} from './molecular-3dmol'

const threeDmolMock = vi.hoisted(() => ({
  createViewer: vi.fn()
}))

vi.mock('3dmol', () => ({
  createViewer: threeDmolMock.createViewer
}))

vi.mock('3dmol/build/3Dmol-min.js?url', () => ({
  default: '/assets/3Dmol-min.js'
}))

type MockMolecular3DmolViewer = {
  [Key in keyof Required<Molecular3DmolViewer>]: ReturnType<typeof vi.fn>
}

function createMockViewer(): MockMolecular3DmolViewer {
  return {
    addModel: vi.fn(),
    removeAllModels: vi.fn(),
    clear: vi.fn(),
    setStyle: vi.fn(),
    zoomTo: vi.fn(),
    render: vi.fn()
  }
}

describe('molecular 3Dmol adapter', () => {
  beforeEach(() => {
    threeDmolMock.createViewer.mockReset()
  })

  afterEach(() => {
    delete (globalThis as typeof globalThis & { '3Dmol'?: unknown })['3Dmol']
    delete (globalThis as typeof globalThis & { $3Dmol?: unknown }).$3Dmol
  })

  it('normalizes representation modes and computes base styles', () => {
    expect(molecularRepresentationModeForObservation('pdb', ['cartoon', 'surface', 'stick']))
      .toBe('cartoon-stick')
    expect(molecularRepresentationModeForObservation('sdf', ['cartoon', 'surface']))
      .toBe('ball-stick')
    expect(molecularRepresentationModeForObservation('xyz', ['sticks']))
      .toBe('stick')
    expect(molecularRepresentationStyle('pdb', 'cartoon-stick')).toEqual({
      cartoon: { color: 'spectrum' },
      stick: { radius: 0.12, colorscheme: 'Jmol' }
    })
    expect(molecularRepresentationStyle('sdf', 'cartoon')).toEqual({
      stick: { radius: 0.18, colorscheme: 'Jmol' },
      sphere: { scale: 0.22 }
    })
  })

  it('builds 3Dmol selectors for molecular structured selections', () => {
    expect(molecularSelectionSpecs({
      kind: 'molecular',
      chains: ['A'],
      residues: [{ chain: 'B', index: 42, name: 'GLY' }],
      ligands: ['ATP'],
      atoms: [{ index: 7 }, { id: 'CA' }, { element: 'Zn' }]
    })).toEqual([
      { chain: 'A' },
      { chain: 'B', resi: 42, resn: 'GLY' },
      { resn: 'ATP' },
      { serial: 7 },
      { atom: 'CA' },
      { elem: 'Zn' }
    ])
  })

  it('applies representation and selection styles to a viewer', () => {
    const viewer = {
      setStyle: vi.fn()
    }
    const selection = {
      kind: 'molecular' as const,
      chains: ['A'],
      ligands: ['ATP']
    }

    applyMolecularRepresentationStyle(viewer, 'pdb', 'stick')
    applyMolecularSelectionStyle(viewer, selection)

    expect(viewer.setStyle).toHaveBeenNthCalledWith(1, {}, {
      stick: { radius: 0.18, colorscheme: 'Jmol' }
    })
    expect(viewer.setStyle).toHaveBeenNthCalledWith(2, { chain: 'A' }, {
      stick: { radius: 0.26, color: '#00A7A7' },
      sphere: { scale: 0.34, color: '#00A7A7' }
    })
    expect(viewer.setStyle).toHaveBeenNthCalledWith(3, { resn: 'ATP' }, {
      stick: { radius: 0.26, color: '#00A7A7' },
      sphere: { scale: 0.34, color: '#00A7A7' }
    })
  })

  it('renders once and updates representation or selection through the handle', async () => {
    const viewer = createMockViewer()
    const element = {
      replaceChildren: vi.fn()
    } as unknown as HTMLElement
    threeDmolMock.createViewer.mockReturnValue(viewer)

    const handle = await renderMolecularStructureWith3Dmol({
      element,
      source: 'ATOM 1\nEND\n',
      format: 'pdb',
      representation: 'cartoon-stick',
      selection: {
        kind: 'molecular',
        chains: ['A']
      }
    })

    expect(threeDmolMock.createViewer).toHaveBeenCalledWith(element, {
      backgroundColor: 'white'
    })
    expect(viewer.addModel).toHaveBeenCalledWith('ATOM 1\nEND\n', 'pdb')
    expect(viewer.setStyle).toHaveBeenNthCalledWith(1, {}, {
      cartoon: { color: 'spectrum' },
      stick: { radius: 0.12, colorscheme: 'Jmol' }
    })
    expect(viewer.setStyle).toHaveBeenNthCalledWith(2, { chain: 'A' }, {
      stick: { radius: 0.26, color: '#00A7A7' },
      sphere: { scale: 0.34, color: '#00A7A7' }
    })
    expect(viewer.addModel.mock.invocationCallOrder[0]).toBeLessThan(viewer.setStyle.mock.invocationCallOrder[0])
    expect(viewer.setStyle.mock.invocationCallOrder[1]).toBeLessThan(viewer.zoomTo.mock.invocationCallOrder[0])
    expect(viewer.zoomTo.mock.invocationCallOrder[0]).toBeLessThan(viewer.render.mock.invocationCallOrder[0])

    viewer.addModel.mockClear()
    viewer.setStyle.mockClear()
    viewer.zoomTo.mockClear()
    viewer.render.mockClear()
    handle.setSelection({
      kind: 'molecular',
      chains: ['B']
    })

    expect(viewer.addModel).not.toHaveBeenCalled()
    expect(viewer.setStyle).toHaveBeenNthCalledWith(1, {}, {
      cartoon: { color: 'spectrum' },
      stick: { radius: 0.12, colorscheme: 'Jmol' }
    })
    expect(viewer.setStyle).toHaveBeenNthCalledWith(2, { chain: 'B' }, {
      stick: { radius: 0.26, color: '#00A7A7' },
      sphere: { scale: 0.34, color: '#00A7A7' }
    })
    expect(viewer.zoomTo).toHaveBeenCalledWith({ chain: 'B' })

    viewer.addModel.mockClear()
    viewer.setStyle.mockClear()
    viewer.zoomTo.mockClear()
    viewer.render.mockClear()
    handle.setRepresentation('ball-stick')

    expect(viewer.addModel).not.toHaveBeenCalled()
    expect(viewer.setStyle).toHaveBeenNthCalledWith(1, {}, {
      stick: { radius: 0.18, colorscheme: 'Jmol' },
      sphere: { scale: 0.22 }
    })
    expect(viewer.setStyle).toHaveBeenNthCalledWith(2, { chain: 'B' }, {
      stick: { radius: 0.26, color: '#00A7A7' },
      sphere: { scale: 0.34, color: '#00A7A7' }
    })
    expect(viewer.zoomTo).not.toHaveBeenCalled()
    expect(viewer.render).toHaveBeenCalledTimes(1)

    handle.dispose()
    expect(viewer.removeAllModels).toHaveBeenCalled()
    expect(viewer.clear).toHaveBeenCalled()
    expect(element.replaceChildren).toHaveBeenCalled()
  })

  it('uses the browser global 3Dmol bundle when it is already available', async () => {
    const viewer = createMockViewer()
    const element = {
      replaceChildren: vi.fn()
    } as unknown as HTMLElement
    const browserGlobalCreateViewer = vi.fn().mockReturnValue(viewer)
    ;(globalThis as typeof globalThis & {
      '3Dmol'?: { createViewer: typeof browserGlobalCreateViewer }
    })['3Dmol'] = {
      createViewer: browserGlobalCreateViewer
    }

    await renderMolecularStructureWith3Dmol({
      element,
      source: 'ATOM 1\nEND\n',
      format: 'pdb',
      representation: 'stick'
    })

    expect(browserGlobalCreateViewer).toHaveBeenCalledWith(element, {
      backgroundColor: 'white'
    })
    expect(threeDmolMock.createViewer).not.toHaveBeenCalled()
    expect(viewer.addModel).toHaveBeenCalledWith('ATOM 1\nEND\n', 'pdb')
    expect(viewer.render).toHaveBeenCalledTimes(1)
  })
})
