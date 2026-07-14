import { describe, expect, it, vi } from 'vitest'
import {
  MOLECULAR_MOLSTAR_EMBEDDED_VIEWER_OPTIONS,
  applyMolecularMolstarSelection,
  biologyMolecularLocatorsToMolstarSchemaItems,
  biologyMolecularRepresentationForComponent,
  biologyMolecularSelectionSignature,
  biologyMolecularVisualStateSignature,
  buildMolstarSelectionUniverse,
  compactMolstarAtomicSelectionRecordsToBiologyLocators,
  createMolecularMolstarRuntimeLoader,
  molecularMolstarFormatForPath,
  molecularSelectionToMolstarSchemaItems,
  resolveMolecularMolstarSource
} from './molecular-molstar'

describe('molecular Mol* adapter', () => {
  it('creates Mol* as an embedded workspace preview instead of a fullscreen layout', () => {
    expect(MOLECULAR_MOLSTAR_EMBEDDED_VIEWER_OPTIONS).toMatchObject({
      extensions: [],
      volumeStreamingDisabled: true,
      layoutIsExpanded: false,
      layoutShowSequence: false,
      viewportShowExpand: false,
      viewportShowToggleFullscreen: false
    })
  })

  it('keeps ligands and water visible when the macromolecule uses cartoon representation', () => {
    expect(biologyMolecularRepresentationForComponent('cartoon', 'polymer')).toBe('cartoon')
    expect(biologyMolecularRepresentationForComponent('cartoon', 'ligand')).toBe('ball-and-stick')
    expect(biologyMolecularRepresentationForComponent('cartoon', 'water')).toBe('ball-and-stick')
    expect(biologyMolecularRepresentationForComponent('surface', 'ligand')).toBe('surface')
  })

  it('preloads the Mol* runtime through a reusable async loader', async () => {
    let loadCount = 0
    const loader = createMolecularMolstarRuntimeLoader(async () => {
      loadCount += 1
      return {
        Viewer: {
          create: async () => ({}) as never
        }
      }
    })

    await Promise.all([loader.preload(), loader.load(), loader.preload()])

    expect(loadCount).toBe(1)
  })

  it('retries Mol* runtime loading after a failed prewarm', async () => {
    let loadCount = 0
    const loader = createMolecularMolstarRuntimeLoader(async () => {
      loadCount += 1
      if (loadCount === 1) throw new Error('transient preload failure')
      return {
        Viewer: {
          create: async () => ({}) as never
        }
      }
    })

    await expect(loader.preload()).rejects.toThrow('transient preload failure')
    await expect(loader.preload()).resolves.toBeUndefined()

    expect(loadCount).toBe(2)
  })

  it('maps molecular file paths to Mol* loader formats', () => {
    expect(molecularMolstarFormatForPath('/lab/9vmr.pdb')).toEqual({
      kind: 'structure',
      format: 'pdb',
      isBinary: false
    })
    expect(molecularMolstarFormatForPath('/lab/model.mmcif')).toEqual({
      kind: 'structure',
      format: 'mmcif',
      isBinary: false
    })
    expect(molecularMolstarFormatForPath('/lab/ligand.sdf')).toEqual({
      kind: 'structure',
      format: 'sdf',
      isBinary: false
    })
    expect(molecularMolstarFormatForPath('/lab/density.ccp4')).toEqual({
      kind: 'volume',
      format: 'ccp4',
      isBinary: true
    })
    expect(molecularMolstarFormatForPath('/lab/traj.xtc')).toEqual({
      kind: 'trajectory-coordinates',
      format: 'xtc',
      isBinary: true
    })
    expect(molecularMolstarFormatForPath('/lab/reflections.mtz')).toBeNull()
  })

  it('resolves supported render sources and rejects sources that need more context', () => {
    expect(resolveMolecularMolstarSource({
      path: '/lab/9vmr.pdb',
      byteLength: 1024,
      rangeAvailable: true,
      maxStructureBytes: 4096
    })).toEqual({
      ok: true,
      byteLength: 1024,
      format: {
        kind: 'structure',
        format: 'pdb',
        isBinary: false
      }
    })
    expect(resolveMolecularMolstarSource({
      path: '/lab/large.pdb',
      byteLength: 8192,
      rangeAvailable: true,
      maxStructureBytes: 4096
    })).toMatchObject({
      ok: false,
      reason: expect.stringContaining('direct data loading is limited')
    })
    expect(resolveMolecularMolstarSource({
      path: '/lab/density.mrc',
      byteLength: 8192,
      rangeAvailable: true,
      maxStructureBytes: 4096
    })).toMatchObject({
      ok: true,
      format: {
        kind: 'volume',
        format: 'ccp4'
      }
    })
    expect(resolveMolecularMolstarSource({
      path: '/lab/traj.dcd',
      byteLength: 8192,
      rangeAvailable: true,
      maxStructureBytes: 4096
    })).toMatchObject({
      ok: false,
      reason: expect.stringContaining('paired topology')
    })
    expect(resolveMolecularMolstarSource({
      path: '/lab/unknown.txt',
      byteLength: 8192,
      rangeAvailable: true,
      maxStructureBytes: 4096
    })).toMatchObject({
      ok: false,
      reason: expect.stringContaining('unknown.txt')
    })
  })

  it('maps structured molecular selections into Mol* schema items without duplicates', () => {
    expect(molecularSelectionToMolstarSchemaItems({
      kind: 'molecular',
      chains: ['A'],
      residues: [
        { chain: 'A', index: 42, name: 'GLY' },
        { index: 7, insertionCode: 'B' }
      ],
      ligands: ['ATP'],
      atoms: [
        { index: 4 },
        { id: 'CA' },
        { element: 'Zn' },
        { id: 'CA' }
      ]
    })).toEqual([
      { auth_asym_id: 'A' },
      { label_asym_id: 'A' },
      { auth_seq_id: 42, label_comp_id: 'GLY', auth_asym_id: 'A' },
      { auth_seq_id: 42, label_comp_id: 'GLY', label_asym_id: 'A' },
      { auth_seq_id: 7, pdbx_PDB_ins_code: 'B' },
      { label_comp_id: 'ATP' },
      { auth_comp_id: 'ATP' },
      { atom_id: 4 },
      { atom_index: 4 },
      { label_atom_id: 'CA' },
      { auth_atom_id: 'CA' },
      { type_symbol: 'Zn' }
    ])
  })

  it('applies structured selection without moving the Mol* camera', () => {
    const structureInteractivity = vi.fn()

    applyMolecularMolstarSelection({ structureInteractivity } as never, {
      kind: 'molecular',
      chains: ['A']
    })

    expect(structureInteractivity).toHaveBeenCalledWith({
      elements: {
        items: [{ auth_asym_id: 'A' }, { label_asym_id: 'A' }]
      },
      action: 'select'
    })
    expect(structureInteractivity.mock.calls[0]?.[0].action).not.toBe('focus')
  })

  it('keeps model/chain/residue/atom locator context together for Biology Room selections', () => {
    const items = biologyMolecularLocatorsToMolstarSchemaItems([{
      modelId: 1,
      chainId: 'A',
      residueNumber: 42,
      residueName: 'GLY',
      atomName: 'CA',
      atomId: 17
    }])

    expect(items).toHaveLength(1)
    for (const item of items) {
      expect(item.atom_id).toBe(17)
      expect(item.pdbx_PDB_ins_code).toBe('')
      expect(item.auth_asym_id).toBe('A')
      expect(item.auth_seq_id).toBe(42)
      expect(item.auth_comp_id).toBe('GLY')
      expect(item.auth_atom_id).toBe('CA')
      expect(item).not.toHaveProperty('type_symbol')
    }
  })

  it('compacts complete residue and chain selections while preserving partial atom context', () => {
    const records = [
      { modelId: 1, chainId: 'A', residueNumber: 42, residueName: 'GLY', atomName: 'N', atomId: 1 },
      { modelId: 1, chainId: 'A', residueNumber: 42, residueName: 'GLY', atomName: 'CA', atomId: 2 },
      { modelId: 1, chainId: 'A', residueNumber: 43, residueName: 'SER', atomName: 'N', atomId: 3 },
      { modelId: 1, chainId: 'B', residueNumber: 7, residueName: 'ATP', atomName: 'P', atomId: 4 }
    ]
    const universe = buildMolstarSelectionUniverse(records)

    expect(compactMolstarAtomicSelectionRecordsToBiologyLocators(records.slice(0, 2), universe)).toEqual([{
      modelId: 1,
      chainId: 'A',
      residueNumber: 42,
      residueName: 'GLY'
    }])
    expect(compactMolstarAtomicSelectionRecordsToBiologyLocators(records.slice(0, 3), universe)).toEqual([{
      modelId: 1,
      chainId: 'A'
    }])
    expect(compactMolstarAtomicSelectionRecordsToBiologyLocators([records[1]!], universe)).toEqual([{
      modelId: 1,
      chainId: 'A',
      residueNumber: 42,
      residueName: 'GLY',
      atomName: 'CA',
      atomId: 2
    }])
  })

  it('uses order-insensitive selection signatures and excludes camera motion from visual updates', () => {
    const left = {
      kind: 'molecular' as const,
      assetId: 'protein',
      locators: [{ chainId: 'A' }, { chainId: 'B', residueNumber: 7 }]
    }
    const right = {
      ...left,
      locators: [...left.locators].reverse()
    }
    const baseView = {
      assetId: 'protein',
      representation: 'cartoon' as const,
      colorScheme: 'chain' as const
    }

    expect(biologyMolecularSelectionSignature(left)).toBe(biologyMolecularSelectionSignature(right))
    expect(biologyMolecularVisualStateSignature(baseView)).toBe(biologyMolecularVisualStateSignature({
      ...baseView,
      camera: {
        position: [1, 2, 3],
        target: [0, 0, 0],
        up: [0, 1, 0]
      }
    }))
  })
})
