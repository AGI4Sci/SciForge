import {
  LIFE_SCIENCE_WORKSPACE_PREVIEW_MAX_WIRE_ITEMS,
  type LifeScienceStructuredSelection as WorkspaceStructuredSelection
} from '../wire'
import type { Viewer as MolstarViewer } from 'molstar/lib/apps/viewer/app'
import type { ViewerOptions as MolstarViewerOptions } from 'molstar/lib/apps/viewer/options'
import type { BuiltInCoordinatesFormat } from 'molstar/lib/mol-plugin-state/formats/coordinates'
import type { BuiltInTrajectoryFormat } from 'molstar/lib/mol-plugin-state/formats/trajectory'
import type { BuildInVolumeFormat } from 'molstar/lib/mol-plugin-state/formats/volume'
import { StructureElement } from 'molstar/lib/mol-model/structure/structure/element'
import { StructureProperties } from 'molstar/lib/mol-model/structure/structure/properties'
import { OrderedSet } from 'molstar/lib/mol-data/int'
import { Color } from 'molstar/lib/mol-util/color'

type MolecularStructuredSelection = Extract<WorkspaceStructuredSelection, { kind: 'molecular' }>

export type MolecularMolstarFormat =
  | {
      kind: 'structure'
      format: BuiltInTrajectoryFormat
      isBinary: false
    }
  | {
      kind: 'volume'
      format: BuildInVolumeFormat
      isBinary: true
    }
  | {
      kind: 'trajectory-coordinates'
      format: BuiltInCoordinatesFormat
      isBinary: true
    }

export type MolecularMolstarSource =
  | {
      ok: true
      format: MolecularMolstarFormat
      byteLength: number
    }
  | {
      ok: false
      reason: string
    }

export type MolecularMolstarRenderableSource =
  | {
      kind: 'url'
      url: string
      label: string
      format: MolecularMolstarFormat
    }
  | {
      kind: 'data'
      text: string
      label: string
      format: Extract<MolecularMolstarFormat, { kind: 'structure' }>
    }

export type MolecularMolstarResidueLocation = {
  chain?: string
  index: number
  insertionCode?: string
  name?: string
}

export type MolecularWorkbenchRendererInput = {
  element: HTMLElement
  source: MolecularMolstarRenderableSource
  selection?: MolecularStructuredSelection
  onSelectionChange?: (selection: MolecularStructuredSelection) => void
  onSelectionError?: (error: unknown) => void
}

export type MolecularWorkbenchRendererHandle = {
  setSelection: (
    selection?: MolecularStructuredSelection
  ) => void
  resize: () => void
  dispose: () => void
}

export type MolecularWorkbenchRenderer = (
  input: MolecularWorkbenchRendererInput
) => Promise<MolecularWorkbenchRendererHandle>

type MolstarViewerConstructor = {
  create: (
    elementOrId: string | HTMLElement,
    options?: Partial<MolstarViewerOptions>
  ) => Promise<MolstarViewer>
}

export type MolecularMolstarViewerModule = {
  Viewer: MolstarViewerConstructor
}

export type MolecularMolstarViewerModuleLoader = () => Promise<MolecularMolstarViewerModule>

export type MolecularMolstarRuntimeLoader = {
  load: () => Promise<MolecularMolstarViewerModule>
  preload: () => Promise<void>
}

export const MOLECULAR_MOLSTAR_EMBEDDED_VIEWER_OPTIONS: Partial<MolstarViewerOptions> = {
  extensions: [],
  volumeStreamingDisabled: true,
  layoutIsExpanded: false,
  layoutShowControls: true,
  layoutShowRemoteState: false,
  layoutShowSequence: true,
  layoutShowLog: false,
  layoutShowLeftPanel: false,
  collapseLeftPanel: true,
  collapseRightPanel: true,
  viewportShowControls: true,
  viewportShowExpand: false,
  viewportShowToggleFullscreen: false,
  viewportShowScreenshotControls: true,
  viewportShowSelectionMode: true,
  viewportShowAnimation: true,
  viewportShowTrajectoryControls: true,
  viewportShowSettings: true,
  viewportBackgroundColor: 'white'
}

export function createMolecularMolstarRuntimeLoader(
  loadModule: MolecularMolstarViewerModuleLoader
): MolecularMolstarRuntimeLoader {
  let modulePromise: Promise<MolecularMolstarViewerModule> | null = null

  const load = () => {
    if (!modulePromise) {
      modulePromise = loadModule().catch((error) => {
        modulePromise = null
        throw error
      })
    }
    return modulePromise
  }

  return {
    load,
    preload: () => load().then(() => undefined)
  }
}

const molecularMolstarRuntime = createMolecularMolstarRuntimeLoader(
  () => import('./molecular-molstar-runtime') as Promise<MolecularMolstarViewerModule>
)

export function preloadMolecularMolstarRuntime(): Promise<void> {
  return molecularMolstarRuntime.preload()
}

export function molecularMolstarFormatForPath(path: string): MolecularMolstarFormat | null {
  const normalized = path.trim().toLowerCase()
  if (/\.(?:cif|mmcif)$/i.test(normalized)) {
    return { kind: 'structure', format: 'mmcif', isBinary: false }
  }
  if (/\.(?:pdb|ent)$/i.test(normalized)) {
    return { kind: 'structure', format: 'pdb', isBinary: false }
  }
  if (/\.(?:sdf)$/i.test(normalized)) {
    return { kind: 'structure', format: 'sdf', isBinary: false }
  }
  if (/\.(?:mol)$/i.test(normalized)) {
    return { kind: 'structure', format: 'mol', isBinary: false }
  }
  if (/\.mol2$/i.test(normalized)) {
    return { kind: 'structure', format: 'mol2', isBinary: false }
  }
  if (/\.xyz$/i.test(normalized)) {
    return { kind: 'structure', format: 'xyz', isBinary: false }
  }
  if (/\.(?:mrc|ccp4)$/i.test(normalized)) {
    return { kind: 'volume', format: 'ccp4', isBinary: true }
  }
  if (/\.xtc$/i.test(normalized)) {
    return { kind: 'trajectory-coordinates', format: 'xtc', isBinary: true }
  }
  if (/\.dcd$/i.test(normalized)) {
    return { kind: 'trajectory-coordinates', format: 'dcd', isBinary: true }
  }
  if (/\.trr$/i.test(normalized)) {
    return { kind: 'trajectory-coordinates', format: 'trr', isBinary: true }
  }
  return null
}

export function resolveMolecularMolstarSource(input: {
  path: string
  byteLength: number
  rangeAvailable: boolean
  maxStructureBytes: number
}): MolecularMolstarSource {
  if (!input.rangeAvailable) {
    return {
      ok: false,
      reason: 'This molecular asset does not expose workspace byte-range transport.'
    }
  }

  if (input.byteLength <= 0) {
    return {
      ok: false,
      reason: 'The molecular asset is empty.'
    }
  }

  const format = molecularMolstarFormatForPath(input.path)
  if (!format) {
    return {
      ok: false,
      reason: `Mol* workbench rendering is not available for ${basename(input.path)}.`
    }
  }

  if (format.kind === 'trajectory-coordinates') {
    return {
      ok: false,
      reason: 'Molecular dynamics coordinate files require a paired topology or structure model in the same workspace preview session.'
    }
  }

  if (format.kind === 'structure' && input.byteLength > input.maxStructureBytes) {
    return {
      ok: false,
      reason: `The molecular structure is ${input.byteLength} bytes; direct data loading is limited to ${input.maxStructureBytes} bytes unless a workspace asset URL is available.`
    }
  }

  return {
    ok: true,
    format,
    byteLength: input.byteLength
  }
}

export const renderMolecularWorkbenchWithMolstar: MolecularWorkbenchRenderer = async ({
  element,
  source,
  selection,
  onSelectionChange,
  onSelectionError
}) => {
  const { Viewer } = await molecularMolstarRuntime.load()
  const viewer = await Viewer.create(
    element,
    MOLECULAR_MOLSTAR_EMBEDDED_VIEWER_OPTIONS
  )

  await loadMolstarSource(viewer, source)
  await resetMolecularMolstarViewport(viewer)
  configureMolecularMolstarResiduePicking(viewer)
  applyMolecularMolstarSelection(viewer, selection)

  let disposed = false
  const resizeController = createMolecularMolstarResizeController(viewer, {
    refocusOnInitialResize: true
  })
  const selectionController = createMolecularMolstarSelectionController(viewer, onSelectionChange, onSelectionError)

  return {
    setSelection: selectionController.setSelection,
    resize: resizeController.resize,
    dispose: () => {
      if (disposed) return
      disposed = true
      selectionController.unsubscribe()
      resizeController.dispose()
      viewer.dispose()
    }
  }
}

const MOLECULAR_MOLSTAR_INITIAL_RESIZE_WINDOW_MS = 2_000
const MOLECULAR_MOLSTAR_RESIZE_DEBOUNCE_MS = 120

export type MolecularMolstarResizeController = {
  resize: () => void
  disableInitialRefocus: () => void
  dispose: () => void
}

export function createMolecularMolstarResizeController(
  viewer: MolstarViewer,
  options: {
    refocusOnInitialResize: boolean
    initialWindowMs?: number
    debounceMs?: number
    now?: () => number
    onBeforeRefocus?: () => void
    onAfterRefocus?: () => void
  }
): MolecularMolstarResizeController {
  const now = options.now ?? Date.now
  const deadline = now() + (options.initialWindowMs ?? MOLECULAR_MOLSTAR_INITIAL_RESIZE_WINDOW_MS)
  const debounceMs = options.debounceMs ?? MOLECULAR_MOLSTAR_RESIZE_DEBOUNCE_MS
  let refocusActive = options.refocusOnInitialResize
  let disposed = false
  let timer: ReturnType<typeof setTimeout> | null = null

  const disableInitialRefocus = (): void => {
    refocusActive = false
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  return {
    resize: () => {
      if (disposed) return
      viewer.handleResize()
      // Host panels can animate or restore their width immediately after Mol*
      // mounts. Reframe once after that layout settles, then preserve the
      // user's camera for the rest of the viewer lifetime.
      if (!refocusActive || now() > deadline) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        if (disposed || !refocusActive) return
        refocusActive = false
        options.onBeforeRefocus?.()
        void resetMolecularMolstarViewport(viewer, 0)
          .catch(() => undefined)
          .finally(() => options.onAfterRefocus?.())
      }, debounceMs)
    },
    disableInitialRefocus,
    dispose: () => {
      if (disposed) return
      disposed = true
      disableInitialRefocus()
    }
  }
}

const MOLECULAR_MOLSTAR_SCENE_READY_TIMEOUT_MS = 2_500

export async function resetMolecularMolstarViewport(
  viewer: MolstarViewer,
  sceneReadyTimeoutMs = MOLECULAR_MOLSTAR_SCENE_READY_TIMEOUT_MS
): Promise<void> {
  viewer.handleResize()

  const canvas = viewer.plugin.canvas3d
  if (!canvas) {
    viewer.plugin.managers.camera.reset(undefined, 0)
    return
  }

  // Loading a structure resolves before Mol* necessarily commits its render
  // representations. Resetting the camera during that gap frames an empty
  // scene at the origin and leaves off-origin structures outside the viewport.
  // Wait for a real, visible scene sphere and focus that sphere explicitly.
  await waitForMolecularMolstarScene(canvas, sceneReadyTimeoutMs)
  viewer.handleResize()
  await waitForNextFrame()

  const visibleSphere = canvas.boundingSphereVisible
  if (isVisibleMolecularMolstarScene(canvas.reprCount.value, visibleSphere.radius)) {
    viewer.plugin.managers.camera.focusSphere({
      center: visibleSphere.center,
      radius: molecularMolstarFramingRadius(
        visibleSphere.radius,
        canvas.camera.viewport.width,
        canvas.camera.viewport.height
      )
    }, {
      durationMs: 0,
      extraRadius: 2
    })
    canvas.requestDraw()
    return
  }

  // Preserve a bounded fallback for unusual formats that do not expose a
  // representation-backed visible sphere.
  canvas.requestCameraReset({ durationMs: 0 })
  viewer.plugin.managers.camera.reset(undefined, 0)
}

export function molecularMolstarFramingRadius(
  radius: number,
  viewportWidth: number,
  viewportHeight: number
): number {
  if (!Number.isFinite(radius) || radius <= 0) return radius
  if (!Number.isFinite(viewportWidth) || !Number.isFinite(viewportHeight) ||
    viewportWidth <= 0 || viewportHeight <= 0 || viewportWidth >= viewportHeight) return radius

  // Mol* camera focus is sphere-based and can fill a portrait sidebar beyond
  // its horizontal field of view. Add bounded portrait compensation while
  // keeping the structure large enough to remain visually useful.
  const portraitScale = Math.min(2.25, Math.sqrt(viewportHeight / viewportWidth))
  return radius * portraitScale
}

type MolecularMolstarSceneCanvas = NonNullable<MolstarViewer['plugin']['canvas3d']>

function waitForMolecularMolstarScene(
  canvas: MolecularMolstarSceneCanvas,
  timeoutMs: number
): Promise<boolean> {
  if (isVisibleMolecularMolstarScene(
    canvas.reprCount.value,
    canvas.boundingSphereVisible.radius
  )) return Promise.resolve(true)

  return new Promise<boolean>((resolve) => {
    let settled = false
    let commitSubscription: { unsubscribe: () => void } | undefined
    let representationSubscription: { unsubscribe: () => void } | undefined
    let timer: ReturnType<typeof setTimeout> | undefined

    const finish = (ready: boolean) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      commitSubscription?.unsubscribe()
      representationSubscription?.unsubscribe()
      resolve(ready)
    }
    const check = () => {
      if (isVisibleMolecularMolstarScene(
        canvas.reprCount.value,
        canvas.boundingSphereVisible.radius
      )) finish(true)
    }

    timer = setTimeout(() => finish(false), Math.max(0, timeoutMs))
    commitSubscription = canvas.commited.subscribe(check)
    if (settled) commitSubscription.unsubscribe()
    if (!settled) {
      representationSubscription = canvas.reprCount.subscribe(check)
      if (settled) representationSubscription.unsubscribe()
    }
    check()
  })
}

function isVisibleMolecularMolstarScene(
  representationCount: number,
  radius: number
): boolean {
  return representationCount > 0 && Number.isFinite(radius) && radius > 0
}

async function waitForNextFrame(): Promise<void> {
  await new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve())
      return
    }
    setTimeout(resolve, 0)
  })
}

async function loadMolstarSource(
  viewer: MolstarViewer,
  source: MolecularMolstarRenderableSource
): Promise<void> {
  if (source.kind === 'data') {
    await viewer.loadStructureFromData(source.text, source.format.format, {
      dataLabel: source.label
    })
    return
  }

  if (source.format.kind === 'structure') {
    await viewer.loadStructureFromUrl(source.url, source.format.format, false, {
      label: source.label
    })
    return
  }

  if (source.format.kind === 'volume') {
    await viewer.loadVolumeFromUrl({
      url: source.url,
      format: source.format.format,
      isBinary: true
    }, [{
      type: 'relative',
      value: 1,
      color: Color(0x3377aa),
      alpha: 0.35
    }], {
      entryId: source.label,
      isLazy: true
    })
  }
}

export function configureMolecularMolstarResiduePicking(viewer: MolstarViewer): void {
  viewer.plugin.selectionMode = true
  viewer.plugin.managers.interactivity.setProps({ granularity: 'residue' })
  viewer.plugin.managers.structure.focus.clear()
}

// Mol* applies selection changes synchronously, including the intermediate clear
// before selecting schema items. Suppress only those notifications; a timed
// guard would also discard the user's next click.
export function createMolecularMolstarSelectionController(
  viewer: MolstarViewer,
  onSelectionChange?: (selection: MolecularStructuredSelection) => void,
  onSelectionError?: (error: unknown) => void
): { setSelection: MolecularWorkbenchRendererHandle['setSelection']; unsubscribe: () => void } {
  let applyingExternalSelection = false
  const subscription = subscribeMolecularMolstarSelectionChanges(viewer, {
    isApplyingExternalSelection: () => applyingExternalSelection,
    onSelectionChange,
    onSelectionError
  })
  return {
    setSelection: (selection) => {
      applyingExternalSelection = true
      try {
        applyMolecularMolstarSelection(viewer, selection)
      } finally {
        applyingExternalSelection = false
      }
    },
    unsubscribe: () => subscription.unsubscribe()
  }
}

export function subscribeMolecularMolstarSelectionChanges(
  viewer: MolstarViewer,
  options: {
    onSelectionChange?: (selection: MolecularStructuredSelection) => void
    onSelectionError?: (error: unknown) => void
    isApplyingExternalSelection?: () => boolean
  }
): { unsubscribe: () => void } {
  if (!options.onSelectionChange) {
    return { unsubscribe: () => undefined }
  }

  const changed = viewer.plugin.managers.structure.selection.events.changed
  let active = true
  const subscription = viewer.subscribe(changed, () => {
    if (!active || options.isApplyingExternalSelection?.()) return
    try {
      options.onSelectionChange?.(molecularSelectionFromMolstarViewer(viewer))
    } catch (error) {
      options.onSelectionError?.(error)
    }
  })
  return { unsubscribe: () => { active = false; subscription.unsubscribe() } }
}

export function molecularSelectionFromMolstarViewer(viewer: MolstarViewer): MolecularStructuredSelection {
  function* locations(): Iterable<MolecularMolstarResidueLocation> {
    const selectionManager = viewer.plugin.managers.structure.selection
    for (const entry of selectionManager.entries.values()) {
      const loci = entry.selection
      if (!loci || !StructureElement.Loci.is(loci) || StructureElement.Loci.isEmpty(loci)) continue
      for (const { unit, indices } of loci.elements) {
        for (let index = 0; index < OrderedSet.size(indices); index += 1) {
          const location = StructureElement.Location.create(
            loci.structure, unit, unit.elements[OrderedSet.getAt(indices, index)]
          )
          const residue = molecularResidueLocationFromMolstarLocation(location)
          if (residue) yield residue
        }
      }
    }
  }
  return molecularSelectionFromResidueLocations(locations())
}

export function molecularResidueLocationFromMolstarLocation(
  location: Parameters<typeof StructureProperties.residue.auth_seq_id>[0]
): MolecularMolstarResidueLocation | null {
  const index = StructureProperties.residue.auth_seq_id(location)
  if (!Number.isFinite(index)) return null
  const chain = StructureProperties.chain.auth_asym_id(location)?.trim()
  const name = StructureProperties.residue.label_comp_id(location)?.trim()
  const insertionCode = StructureProperties.residue.pdbx_PDB_ins_code(location)?.trim()
  return {
    index,
    ...(chain ? { chain } : {}),
    ...(name ? { name } : {}),
    ...(insertionCode && insertionCode !== '?' ? { insertionCode } : {})
  }
}

export function molecularSelectionFromResidueLocations(
  locations: Iterable<MolecularMolstarResidueLocation>,
  maxItems = LIFE_SCIENCE_WORKSPACE_PREVIEW_MAX_WIRE_ITEMS
): MolecularStructuredSelection {
  const residues: NonNullable<MolecularStructuredSelection['residues']> = []
  const seen = new Set<string>()
  for (const location of locations) {
    if (!Number.isFinite(location.index)) continue
    const residue = {
      index: location.index,
      ...(location.chain ? { chain: location.chain } : {}),
      ...(location.name ? { name: location.name } : {}),
      ...(location.insertionCode ? { insertionCode: location.insertionCode } : {})
    }
    const key = JSON.stringify(residue)
    if (seen.has(key)) continue
    if (residues.length >= maxItems) {
      throw new Error(`Molecular selection exceeds ${maxItems} unique residues. Select a smaller region.`)
    }
    seen.add(key)
    residues.push(residue)
  }

  return residues.length
    ? { kind: 'molecular', residues }
    : { kind: 'molecular' }
}

export function applyMolecularMolstarSelection(
  viewer: MolstarViewer,
  selection?: MolecularStructuredSelection
): void {
  const elements = molecularSelectionToMolstarSchemaItems(selection)
  if (!elements.length) {
    viewer.structureInteractivity({ action: ['select', 'highlight'] })
    return
  }

  viewer.structureInteractivity({
    elements: { items: elements },
    // Keep structured selection visual state independent from the user's
    // camera. Mol*'s `focus` action calls camera.focusLoci and would move the
    // viewport every time persisted selection state changes.
    action: 'select'
  })
}

export function molecularSelectionToMolstarSchemaItems(
  selection?: MolecularStructuredSelection
): StructureElement.SchemaItem[] {
  if (!selection) return []

  const items: StructureElement.SchemaItem[] = []
  for (const chain of selection.chains ?? []) {
    items.push({ auth_asym_id: chain }, { label_asym_id: chain })
  }
  for (const residue of selection.residues ?? []) {
    const base: StructureElement.SchemaItem = {
      auth_seq_id: residue.index,
      ...(residue.insertionCode ? { pdbx_PDB_ins_code: residue.insertionCode } : {}),
      ...(residue.name ? { label_comp_id: residue.name } : {})
    }
    if (residue.chain) {
      items.push(
        { ...base, auth_asym_id: residue.chain },
        { ...base, label_asym_id: residue.chain }
      )
    } else {
      items.push(base)
    }
  }
  for (const ligand of selection.ligands ?? []) {
    items.push({ label_comp_id: ligand }, { auth_comp_id: ligand })
  }
  for (const atom of selection.atoms ?? []) {
    if (atom.index !== undefined) {
      items.push({ atom_id: atom.index }, { atom_index: atom.index })
      continue
    }
    if (atom.id) {
      items.push({ label_atom_id: atom.id }, { auth_atom_id: atom.id })
      continue
    }
    if (atom.element) {
      items.push({ type_symbol: atom.element })
    }
  }

  return dedupeSchemaItems(items)
}

function dedupeSchemaItems(items: StructureElement.SchemaItem[]): StructureElement.SchemaItem[] {
  const seen = new Set<string>()
  const unique: StructureElement.SchemaItem[] = []
  for (const item of items) {
    const key = JSON.stringify(item)
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(item)
  }
  return unique
}

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || path
}
