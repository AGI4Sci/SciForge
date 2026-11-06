import { StructureElement } from 'molstar/lib/mol-model/structure/structure/element'
import { StructureProperties } from 'molstar/lib/mol-model/structure/structure/properties'
import { OrderedSet } from 'molstar/lib/mol-data/int'
import { describe, expect, it, vi } from 'vitest'
import {
  MOLECULAR_MOLSTAR_EMBEDDED_VIEWER_OPTIONS,
  applyMolecularMolstarSelection,
  createMolecularMolstarSelectionController,
  configureMolecularMolstarResiduePicking,
  createMolecularMolstarResizeController,
  createMolecularMolstarRuntimeLoader,
  molecularMolstarFramingRadius,
  molecularMolstarFormatForPath,
  molecularSelectionFromResidueLocations,
  molecularSelectionToMolstarSchemaItems,
  resetMolecularMolstarViewport,
  resolveMolecularMolstarSource,
  subscribeMolecularMolstarSelectionChanges
} from './molecular-molstar'

describe('molecular Mol* adapter', () => {
  it('creates Mol* as an embedded workspace preview instead of a fullscreen layout', () => {
    expect(MOLECULAR_MOLSTAR_EMBEDDED_VIEWER_OPTIONS).toMatchObject({
      extensions: [],
      volumeStreamingDisabled: true,
      layoutIsExpanded: false,
      layoutShowSequence: true,
      viewportShowExpand: false,
      viewportShowToggleFullscreen: false
    })
  })

  it('adds bounded camera margin for narrow sidebar viewports', () => {
    expect(molecularMolstarFramingRadius(40, 800, 600)).toBe(40)
    expect(molecularMolstarFramingRadius(40, 300, 750)).toBeCloseTo(40 * Math.sqrt(2.5))
    expect(molecularMolstarFramingRadius(40, 100, 1_000)).toBe(90)
  })

  it('refocuses once after an initial host resize and preserves persisted cameras', async () => {
    vi.useFakeTimers()
    const handleResize = vi.fn()
    const reset = vi.fn()
    const viewer = {
      handleResize,
      plugin: {
        canvas3d: undefined,
        managers: { camera: { reset } }
      }
    }
    try {
      const initializing = createMolecularMolstarResizeController(viewer as never, {
        refocusOnInitialResize: true,
        debounceMs: 20
      })
      initializing.resize()
      initializing.resize()
      await vi.advanceTimersByTimeAsync(20)

      expect(reset).toHaveBeenCalledOnce()
      expect(handleResize).toHaveBeenCalledTimes(3)

      initializing.resize()
      await vi.advanceTimersByTimeAsync(20)
      expect(reset).toHaveBeenCalledOnce()

      const persisted = createMolecularMolstarResizeController(viewer as never, {
        refocusOnInitialResize: false,
        debounceMs: 20
      })
      persisted.resize()
      await vi.advanceTimersByTimeAsync(20)
      expect(reset).toHaveBeenCalledOnce()
      persisted.dispose()
      initializing.dispose()
    } finally {
      vi.useRealTimers()
    }
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

  it('uses residue selection mode so a plain click adds a residue instead of replacing focus', () => {
    let selectionMode = false
    const setProps = vi.fn()
    const clear = vi.fn()
    const viewer = {
      get plugin() {
        return {
          get selectionMode() { return selectionMode },
          set selectionMode(value: boolean) { selectionMode = value },
          managers: {
            interactivity: { setProps },
            structure: { focus: { clear } }
          }
        }
      }
    }

    configureMolecularMolstarResiduePicking(viewer as never)

    expect(selectionMode).toBe(true)
    expect(setProps).toHaveBeenCalledWith({ granularity: 'residue' })
    expect(clear).toHaveBeenCalledOnce()
  })

  it('collapses Mol* residue clicks into a structured molecular selection', () => {
    expect(molecularSelectionFromResidueLocations([
      { chain: 'A', index: 3, name: 'CYS' },
      { chain: 'A', index: 3, name: 'CYS' },
      { chain: 'A', index: 40, name: 'CYS' }
    ])).toEqual({
      kind: 'molecular',
      residues: [
        { index: 3, chain: 'A', name: 'CYS' },
        { index: 40, chain: 'A', name: 'CYS' }
      ]
    })
    expect(molecularSelectionFromResidueLocations([])).toEqual({ kind: 'molecular' })
  })

  it('accepts 256 unique residues including duplicates, and stops at the 257th unique residue', () => {
    const locations = Array.from({ length: 256 }, (_, index) => ({ chain: 'A', index }))
    expect(molecularSelectionFromResidueLocations([...locations, ...locations]).residues).toHaveLength(256)
    let visited = 0
    function* oversized() {
      for (let index = 0; index < 1000; index += 1) { visited += 1; yield { chain: 'A', index } }
    }
    expect(() => molecularSelectionFromResidueLocations(oversized())).toThrow('exceeds 256')
    expect(visited).toBe(257)
    expect(molecularSelectionFromResidueLocations([
      { index: 1, chain: 'A', name: 'GLY' }, { index: 1, chain: 'B', name: 'GLY' },
      { index: 1, chain: 'A', name: 'GLY', insertionCode: 'A' }, { index: 1, chain: 'A', name: 'CYS' }
    ]).residues).toHaveLength(4)
  })

  it('routes overflow through the renderer error callback without publishing partial success', () => {
    let listener!: () => void
    const onSelectionChange = vi.fn()
    const onSelectionError = vi.fn()
    const loci = { kind: 'element-loci', structure: {}, elements: [{
      unit: { elements: Array.from({ length: 257 }, (_, index) => index) },
      indices: OrderedSet.ofBounds(0, 257) as OrderedSet<number>
    }] }
    const viewer = {
      subscribe: vi.fn((_event: unknown, callback: () => void) => { listener = callback; return { unsubscribe: vi.fn() } }),
      plugin: { managers: { structure: { selection: { events: { changed: {} }, entries: new Map([['model', { selection: loci }]]) } } } }
    }
    const authSeqId = vi.spyOn(StructureProperties.residue, 'auth_seq_id').mockImplementation((location) => {
      if (!StructureElement.Location.is(location)) throw new Error('Expected an element location')
      return location.element
    })
    const spies = [
      vi.spyOn(StructureElement.Loci, 'isEmpty').mockReturnValue(false),
      authSeqId,
      vi.spyOn(StructureProperties.chain, 'auth_asym_id').mockReturnValue('A'),
      vi.spyOn(StructureProperties.residue, 'label_comp_id').mockReturnValue('GLY'),
      vi.spyOn(StructureProperties.residue, 'pdbx_PDB_ins_code').mockReturnValue('')
    ]
    try {
      const subscription = subscribeMolecularMolstarSelectionChanges(viewer as never, { onSelectionChange, onSelectionError })
      expect(() => listener()).not.toThrow()
      expect(onSelectionError).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: expect.stringContaining('exceeds 256') }))
      expect(onSelectionChange).not.toHaveBeenCalled()
      loci.elements[0]!.indices = OrderedSet.ofBounds(0, 2)
      listener()
      expect(onSelectionChange.mock.calls[0]![0].residues).toHaveLength(2)
      authSeqId.mockImplementationOnce(() => { throw new Error('residue mapping failed') })
      expect(() => listener()).not.toThrow()
      expect(onSelectionError).toHaveBeenLastCalledWith(expect.objectContaining({ message: 'residue mapping failed' }))
      expect(onSelectionChange).toHaveBeenCalledTimes(1)
      subscription.unsubscribe()
      listener()
      expect(onSelectionChange).toHaveBeenCalledTimes(1)
    } finally { spies.forEach((spy) => spy.mockRestore()) }
  })

  it('suppresses synchronous external clear/select events but accepts an immediate user click', () => {
    let listener: (() => void) | undefined
    const onSelectionChange = vi.fn()
    const viewer = {
      subscribe: vi.fn((_event: unknown, action: () => void) => {
        listener = action
        return { unsubscribe: vi.fn() }
      }),
      plugin: { managers: { structure: { selection: {
        events: { changed: {} }, entries: new Map()
      } } } },
      structureInteractivity: vi.fn(() => { listener?.(); listener?.() })
    }
    const controller = createMolecularMolstarSelectionController(viewer as never, onSelectionChange)
    controller.setSelection({ kind: 'molecular', chains: ['A'] })
    expect(onSelectionChange).not.toHaveBeenCalled()
    listener?.()
    expect(onSelectionChange).toHaveBeenCalledExactlyOnceWith({ kind: 'molecular' })
    viewer.structureInteractivity.mockImplementationOnce(() => { throw new Error('Invalid selection') })
    expect(() => controller.setSelection()).toThrow('Invalid selection')
    listener?.()
    expect(onSelectionChange).toHaveBeenCalledTimes(2)
    controller.unsubscribe()
  })

  it('publishes Mol* selection changes except while applying an external selection', () => {
    const onSelectionChange = vi.fn()
    let listener: (() => void) | undefined
    const unsubscribe = vi.fn()
    const viewer = {
      subscribe: vi.fn((_observable: unknown, action: () => void) => {
        listener = action
        return { unsubscribe }
      }),
      plugin: {
        managers: {
          structure: {
            selection: {
              events: { changed: {} },
              entries: new Map()
            }
          }
        }
      }
    }
    let applying = false
    const subscription = subscribeMolecularMolstarSelectionChanges(viewer as never, {
      isApplyingExternalSelection: () => applying,
      onSelectionChange
    })

    listener?.()
    applying = true
    listener?.()
    applying = false
    listener?.()
    subscription.unsubscribe()

    expect(onSelectionChange).toHaveBeenCalledTimes(2)
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('waits for committed representations before framing an off-origin structure', async () => {
    let commitListener: (() => void) | undefined
    const unsubscribe = vi.fn()
    const visibleSphere = {
      center: [24.45, 0.53, 53.84],
      radius: 0
    }
    const representationCount = {
      value: 0,
      subscribe: vi.fn(() => ({ unsubscribe }))
    }
    const focusSphere = vi.fn()
    const reset = vi.fn()
    const requestCameraReset = vi.fn()
    const requestDraw = vi.fn()
    const handleResize = vi.fn()
    const viewer = {
      handleResize,
      plugin: {
        canvas3d: {
          reprCount: representationCount,
          boundingSphereVisible: visibleSphere,
          commited: {
            subscribe: vi.fn((listener: () => void) => {
              commitListener = listener
              return { unsubscribe }
            })
          },
          camera: {
            viewport: { width: 500, height: 500 }
          },
          requestCameraReset,
          requestDraw
        },
        managers: {
          camera: { focusSphere, reset }
        }
      }
    }
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })

    try {
      const resetPromise = resetMolecularMolstarViewport(viewer as never, 100)
      await Promise.resolve()

      expect(focusSphere).not.toHaveBeenCalled()
      representationCount.value = 1
      visibleSphere.radius = 37
      commitListener?.()
      await resetPromise

      expect(handleResize).toHaveBeenCalledTimes(2)
      expect(focusSphere).toHaveBeenCalledWith({
        center: visibleSphere.center,
        radius: visibleSphere.radius
      }, {
        durationMs: 0,
        extraRadius: 2
      })
      expect(requestDraw).toHaveBeenCalledOnce()
      expect(requestCameraReset).not.toHaveBeenCalled()
      expect(reset).not.toHaveBeenCalled()
      expect(unsubscribe).toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
