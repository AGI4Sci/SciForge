import { describe, expect, it, vi } from 'vitest'
import {
  MOLECULAR_MOLSTAR_EMBEDDED_VIEWER_OPTIONS,
  applyMolecularMolstarSelection,
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
})
