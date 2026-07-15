import type {
  BiologyMolecularViewState,
  BiologyRoomSelection
} from '@shared/biology-room'
import type { WorkspaceStructuredSelection } from '@shared/workspace-preview'
import type { Viewer as MolstarViewer } from 'molstar/lib/apps/viewer/app'
import type { ViewerOptions as MolstarViewerOptions } from 'molstar/lib/apps/viewer/options'
import type { BuiltInCoordinatesFormat } from 'molstar/lib/mol-plugin-state/formats/coordinates'
import type { BuiltInTrajectoryFormat } from 'molstar/lib/mol-plugin-state/formats/trajectory'
import type { BuildInVolumeFormat } from 'molstar/lib/mol-plugin-state/formats/volume'
import type { StructureElement } from 'molstar/lib/mol-model/structure/structure/element'
import type { Unit } from 'molstar/lib/mol-model/structure/structure/unit'
import { Color } from 'molstar/lib/mol-util/color'

type BiologyMolecularSelection = Extract<BiologyRoomSelection, { kind: 'molecular' }>
type BiologyMolecularLocator = BiologyMolecularSelection['locators'][number]

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

export type MolecularWorkbenchRendererInput = {
  element: HTMLElement
  source: MolecularMolstarRenderableSource
  selection?: Extract<WorkspaceStructuredSelection, { kind: 'molecular' }>
}

export type MolecularWorkbenchRendererHandle = {
  setSelection: (
    selection?: Extract<WorkspaceStructuredSelection, { kind: 'molecular' }>
  ) => void
  resize: () => void
  dispose: () => void
}

export type MolecularWorkbenchRenderer = (
  input: MolecularWorkbenchRendererInput
) => Promise<MolecularWorkbenchRendererHandle>

export type BiologyMolecularWorkbenchRendererInput = {
  element: HTMLElement
  source: MolecularMolstarRenderableSource
  assetId: string
  selection?: BiologyMolecularSelection | null
  viewState: BiologyMolecularViewState
  onSelectionChange?: (selection: BiologyMolecularSelection | null) => void
  onViewStateChange?: (viewState: BiologyMolecularViewState) => void
}

export type BiologyMolecularWorkbenchRendererHandle = {
  setSelection: (selection?: BiologyMolecularSelection | null) => void
  setViewState: (viewState: BiologyMolecularViewState) => Promise<void>
  resize: () => void
  dispose: () => void
}

export type BiologyMolecularWorkbenchRenderer = (
  input: BiologyMolecularWorkbenchRendererInput
) => Promise<BiologyMolecularWorkbenchRendererHandle>

export type MolstarAtomicSelectionRecord = {
  modelId: number
  chainId?: string
  residueNumber?: number
  insertionCode?: string
  residueName?: string
  atomName?: string
  atomId?: number
}

export type MolstarSelectionUniverse = {
  modelAtomCounts: ReadonlyMap<string, number>
  chainAtomCounts: ReadonlyMap<string, number>
  residueAtomCounts: ReadonlyMap<string, number>
}

type MolstarViewerConstructor = {
  create: (
    elementOrId: string | HTMLElement,
    options?: Partial<MolstarViewerOptions>
  ) => Promise<MolstarViewer>
}

export type MolecularMolstarViewerModule = {
  Viewer: MolstarViewerConstructor
}

type BiologyMolecularMolstarModule = MolecularMolstarViewerModule & {
  StructureElement: typeof import('molstar/lib/mol-model/structure/structure/element').StructureElement
  StructureProperties: typeof import('molstar/lib/mol-model/structure/structure/properties').StructureProperties
  Unit: typeof import('molstar/lib/mol-model/structure/structure/unit').Unit
  createStructureRepresentationParams: typeof import('molstar/lib/mol-plugin-state/helpers/structure-representation-params').createStructureRepresentationParams
  Vec3: typeof import('molstar/lib/mol-math/linear-algebra').Vec3
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
  layoutShowSequence: false,
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
  selection
}) => {
  const { Viewer } = await molecularMolstarRuntime.load()
  const viewer = await Viewer.create(
    element,
    MOLECULAR_MOLSTAR_EMBEDDED_VIEWER_OPTIONS
  )

  await loadMolstarSource(viewer, source)
  await resetMolecularMolstarViewport(viewer)
  applyMolecularMolstarSelection(viewer, selection)

  let disposed = false
  const resizeController = createMolecularMolstarResizeController(viewer, {
    refocusOnInitialResize: true
  })

  return {
    setSelection: (nextSelection) => {
      applyMolecularMolstarSelection(viewer, nextSelection)
    },
    resize: resizeController.resize,
    dispose: () => {
      if (disposed) return
      disposed = true
      resizeController.dispose()
      viewer.dispose()
    }
  }
}

const BIOLOGY_MOLECULAR_CAMERA_DEBOUNCE_MS = 320
const BIOLOGY_MOLECULAR_CAMERA_SETTLE_MS = 750
const BIOLOGY_MOLECULAR_SELECTION_DEBOUNCE_MS = 80
const BIOLOGY_MOLECULAR_MAX_LOCATORS = 10_000
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

export const renderBiologyMolecularWorkbenchWithMolstar: BiologyMolecularWorkbenchRenderer = async ({
  element,
  source,
  assetId,
  selection,
  viewState,
  onSelectionChange,
  onViewStateChange
}) => {
  const runtime = await molecularMolstarRuntime.load() as BiologyMolecularMolstarModule
  const { Viewer } = runtime
  const viewer = await Viewer.create(
    element,
    MOLECULAR_MOLSTAR_EMBEDDED_VIEWER_OPTIONS
  )
  let disposed = false
  let applyingSelection = false
  let applyingCamera = false
  let suppressingInitialCameraEvents = !viewState.camera
  let cameraTimer: ReturnType<typeof setTimeout> | null = null
  let cameraSettleTimer: ReturnType<typeof setTimeout> | null = null
  let selectionTimer: ReturnType<typeof setTimeout> | null = null
  let currentViewState = viewState
  let requestedVisualSignature = biologyMolecularVisualStateSignature(viewState)
  let currentSelectionSignature = biologyMolecularSelectionSignature(selection)
  let viewUpdateQueue = Promise.resolve()

  await loadMolstarSource(viewer, source)
  viewer.plugin.selectionMode = true
  await applyBiologyMolecularVisualState(viewer, viewState, runtime)
  await resetMolecularMolstarViewport(viewer)

  const selectionUniverse = buildMolstarSelectionUniverse(
    collectMolstarAtomicRecordsFromViewer(viewer, runtime)
  )
  applyingSelection = true
  applyBiologyMolecularSelection(viewer, selection, runtime)
  applyingSelection = false
  if (viewState.camera) {
    applyingCamera = true
    applyBiologyMolecularCamera(viewer, viewState.camera, runtime)
    applyingCamera = false
  }
  const resizeController = createMolecularMolstarResizeController(viewer, {
    refocusOnInitialResize: !viewState.camera,
    onBeforeRefocus: () => {
      applyingCamera = true
    },
    onAfterRefocus: () => {
      applyingCamera = false
      suppressingInitialCameraEvents = false
      if (cameraSettleTimer) {
        clearTimeout(cameraSettleTimer)
        cameraSettleTimer = null
      }
    }
  })
  if (suppressingInitialCameraEvents) {
    cameraSettleTimer = setTimeout(() => {
      cameraSettleTimer = null
      suppressingInitialCameraEvents = false
    }, BIOLOGY_MOLECULAR_CAMERA_SETTLE_MS)
  }

  const selectionSubscription = viewer.subscribe(
    viewer.plugin.managers.structure.selection.events.changed,
    () => {
      if (disposed || applyingSelection) return
      if (selectionTimer) clearTimeout(selectionTimer)
      selectionTimer = setTimeout(() => {
        selectionTimer = null
        if (disposed || applyingSelection) return
        const locators = compactMolstarAtomicSelectionRecordsToBiologyLocators(
          collectSelectedMolstarAtomicRecords(viewer, runtime),
          selectionUniverse
        )
        const nextSelection: BiologyMolecularSelection | null = locators.length
          ? { kind: 'molecular', assetId, locators }
          : null
        const signature = biologyMolecularSelectionSignature(nextSelection)
        if (signature === currentSelectionSignature) return
        currentSelectionSignature = signature
        onSelectionChange?.(nextSelection)
      }, BIOLOGY_MOLECULAR_SELECTION_DEBOUNCE_MS)
    }
  )
  const cameraSubscription = viewer.subscribe(
    viewer.plugin.canvas3d?.camera.changed,
    () => {
      if (disposed || applyingCamera || suppressingInitialCameraEvents) return
      if (cameraTimer) clearTimeout(cameraTimer)
      cameraTimer = setTimeout(() => {
        cameraTimer = null
        if (disposed || applyingCamera) return
        const camera = biologyMolecularCameraFromViewer(viewer)
        if (!camera) return
        const nextViewState: BiologyMolecularViewState = {
          ...currentViewState,
          camera
        }
        if (biologyMolecularCameraSignature(nextViewState.camera) ===
          biologyMolecularCameraSignature(currentViewState.camera)) return
        currentViewState = nextViewState
        onViewStateChange?.(nextViewState)
      }, BIOLOGY_MOLECULAR_CAMERA_DEBOUNCE_MS)
    }
  )

  return {
    setSelection: (nextSelection) => {
      const signature = biologyMolecularSelectionSignature(nextSelection)
      if (signature === currentSelectionSignature) return
      currentSelectionSignature = signature
      applyingSelection = true
      applyBiologyMolecularSelection(viewer, nextSelection, runtime)
      applyingSelection = false
    },
    setViewState: async (nextViewState) => {
      const previousCameraSignature = biologyMolecularCameraSignature(currentViewState.camera)
      const nextCameraSignature = biologyMolecularCameraSignature(nextViewState.camera)
      const nextVisualSignature = biologyMolecularVisualStateSignature(nextViewState)
      currentViewState = nextViewState

      if (nextVisualSignature !== requestedVisualSignature) {
        requestedVisualSignature = nextVisualSignature
        viewUpdateQueue = viewUpdateQueue.catch(() => undefined).then(async () => {
          if (!disposed) await applyBiologyMolecularVisualState(viewer, nextViewState, runtime)
        })
      }
      if (nextViewState.camera && nextCameraSignature !== previousCameraSignature) {
        suppressingInitialCameraEvents = false
        if (cameraSettleTimer) {
          clearTimeout(cameraSettleTimer)
          cameraSettleTimer = null
        }
        resizeController.disableInitialRefocus()
        applyingCamera = true
        applyBiologyMolecularCamera(viewer, nextViewState.camera, runtime)
        applyingCamera = false
      }
      await viewUpdateQueue
    },
    resize: resizeController.resize,
    dispose: () => {
      if (disposed) return
      disposed = true
      if (cameraTimer) clearTimeout(cameraTimer)
      if (cameraSettleTimer) clearTimeout(cameraSettleTimer)
      if (selectionTimer) clearTimeout(selectionTimer)
      resizeController.dispose()
      selectionSubscription.unsubscribe()
      cameraSubscription.unsubscribe()
      viewer.dispose()
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

export function applyMolecularMolstarSelection(
  viewer: MolstarViewer,
  selection?: Extract<WorkspaceStructuredSelection, { kind: 'molecular' }>
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
  selection?: Extract<WorkspaceStructuredSelection, { kind: 'molecular' }>
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

export function biologyMolecularLocatorsToMolstarSchemaItems(
  locators: readonly BiologyMolecularLocator[]
): StructureElement.SchemaItem[] {
  // Biology Room locators use author-space identifiers. Keeping all fields in
  // one item is essential: Schema items are unioned, while fields are ANDed.
  return dedupeSchemaItems(locators.map((locator): StructureElement.SchemaItem => ({
    ...(locator.chainId ? { auth_asym_id: locator.chainId } : {}),
    ...(locator.residueNumber !== undefined
      ? {
          auth_seq_id: locator.residueNumber,
          pdbx_PDB_ins_code: locator.insertionCode ?? ''
        }
      : {}),
    ...(locator.residueName ? { auth_comp_id: locator.residueName } : {}),
    ...(locator.atomName ? { auth_atom_id: locator.atomName } : {}),
    ...(locator.elementSymbol ? { type_symbol: locator.elementSymbol } : {}),
    ...(typeof locator.atomId === 'number'
      ? { atom_id: locator.atomId }
      : typeof locator.atomId === 'string' && !locator.atomName
        ? { auth_atom_id: locator.atomId }
        : {})
  })))
}

export function buildMolstarSelectionUniverse(
  records: readonly MolstarAtomicSelectionRecord[]
): MolstarSelectionUniverse {
  const unique = uniqueMolstarAtomicRecords(records)
  return {
    modelAtomCounts: countRecordsBy(unique, modelRecordKey),
    chainAtomCounts: countRecordsBy(unique, chainRecordKey),
    residueAtomCounts: countRecordsBy(unique, residueRecordKey)
  }
}

export function compactMolstarAtomicSelectionRecordsToBiologyLocators(
  records: readonly MolstarAtomicSelectionRecord[],
  universe: MolstarSelectionUniverse
): BiologyMolecularLocator[] {
  const selected = uniqueMolstarAtomicRecords(records)
  if (!selected.length) return []
  const selectedByModel = groupRecordsBy(selected, modelRecordKey)
  const selectedByChain = groupRecordsBy(selected.filter((record) => record.chainId), chainRecordKey)
  const selectedByResidue = groupRecordsBy(
    selected.filter((record) => record.residueNumber !== undefined),
    residueRecordKey
  )
  const coveredAtoms = new Set<string>()
  const locators: BiologyMolecularLocator[] = []

  for (const [key, group] of sortedRecordGroups(selectedByModel)) {
    const chainCount = new Set(group.map(chainRecordKey)).size
    if (chainCount < 2 || group.length !== universe.modelAtomCounts.get(key)) continue
    locators.push({ modelId: group[0]!.modelId })
    for (const record of group) coveredAtoms.add(atomRecordKey(record))
  }

  for (const [key, group] of sortedRecordGroups(selectedByChain)) {
    const uncovered = group.filter((record) => !coveredAtoms.has(atomRecordKey(record)))
    if (!uncovered.length || group.length !== universe.chainAtomCounts.get(key)) continue
    const first = uncovered[0]!
    locators.push({ modelId: first.modelId, chainId: first.chainId })
    for (const record of group) coveredAtoms.add(atomRecordKey(record))
  }

  for (const [key, group] of sortedRecordGroups(selectedByResidue)) {
    const uncovered = group.filter((record) => !coveredAtoms.has(atomRecordKey(record)))
    if (!uncovered.length || group.length !== universe.residueAtomCounts.get(key)) continue
    locators.push(residueLocatorFromRecord(uncovered[0]!))
    for (const record of group) coveredAtoms.add(atomRecordKey(record))
  }

  for (const record of selected.sort((left, right) => atomRecordKey(left).localeCompare(atomRecordKey(right)))) {
    if (coveredAtoms.has(atomRecordKey(record))) continue
    locators.push(atomLocatorFromRecord(record))
  }

  return dedupeBiologyMolecularLocators(locators).slice(0, BIOLOGY_MOLECULAR_MAX_LOCATORS)
}

export function biologyMolecularSelectionSignature(
  selection?: BiologyMolecularSelection | null
): string {
  if (!selection) return 'none'
  return selection.locators
    .map((locator) => JSON.stringify(locator))
    .sort()
    .join('|')
}

export function biologyMolecularVisualStateSignature(state: BiologyMolecularViewState): string {
  return JSON.stringify([
    state.assetId,
    state.representation,
    state.colorScheme,
    state.uniformColor ?? null
  ])
}

function applyBiologyMolecularSelection(
  viewer: MolstarViewer,
  selection: BiologyMolecularSelection | null | undefined,
  runtime: BiologyMolecularMolstarModule
): void {
  const { StructureElement } = runtime
  const manager = viewer.plugin.managers.structure.selection
  manager.clear()
  if (!selection?.locators.length) return

  for (const structureRef of viewer.plugin.managers.structure.hierarchy.current.structures) {
    const structure = structureRef.cell.obj?.data
    if (!structure) continue
    const matchingLocators = selection.locators.filter((locator) =>
      biologyMolecularLocatorMatchesStructure(locator, structure.models)
    )
    const items = biologyMolecularLocatorsToMolstarSchemaItems(matchingLocators)
    if (!items.length) continue
    const next = StructureElement.Loci.fromSchema(structure, { items })
    if (StructureElement.Loci.isEmpty(next)) continue
    manager.fromLoci('add', next, false)
  }
}

async function applyBiologyMolecularVisualState(
  viewer: MolstarViewer,
  state: BiologyMolecularViewState,
  runtime: BiologyMolecularMolstarModule
): Promise<void> {
  const { createStructureRepresentationParams } = runtime
  const color = biologyMolecularColorThemeName(state.colorScheme)
  const colorParams = state.colorScheme === 'uniform'
    ? { value: Color.fromHexStyle(state.uniformColor ?? '#4f86c6') }
    : state.colorScheme === 'chain'
      ? { asymId: 'auth' as const }
      : undefined
  const componentManager = viewer.plugin.managers.structure.component

  for (const structureRef of viewer.plugin.managers.structure.hierarchy.current.structures) {
    for (const component of structureRef.components) {
      const structure = component.cell.obj?.data
      if (!structure) continue
      const componentRepresentation = biologyMolecularRepresentationForComponent(
        state.representation,
        component.key ?? component.cell.obj?.label
      )
      for (const representationRef of component.representations) {
        const params = createStructureRepresentationParams(viewer.plugin, structure, {
          type: biologyMolecularRepresentationName(componentRepresentation),
          color,
          ...(colorParams ? { colorParams } : {})
        })
        await componentManager.updateRepresentations([component], representationRef, params)
      }
    }
  }
}

export function biologyMolecularRepresentationForComponent(
  requested: BiologyMolecularViewState['representation'],
  componentKeyOrLabel: string | undefined
): BiologyMolecularViewState['representation'] {
  if (requested !== 'cartoon') return requested
  const component = componentKeyOrLabel?.toLowerCase() ?? ''
  return /ligand|non[-_ ]?standard|branched|water|ion|lipid/.test(component)
    ? 'ball-and-stick'
    : requested
}

function applyBiologyMolecularCamera(
  viewer: MolstarViewer,
  camera: BiologyMolecularViewState['camera'],
  runtime: BiologyMolecularMolstarModule
): void {
  if (!camera) return
  const { Vec3 } = runtime
  viewer.plugin.managers.camera.setSnapshot({
    mode: camera.mode,
    fov: camera.fov,
    position: Vec3.create(...camera.position),
    target: Vec3.create(...camera.target),
    up: Vec3.create(...camera.up),
    radius: camera.radius,
    radiusMax: camera.radiusMax,
    fog: camera.fog,
    clipFar: camera.clipFar,
    minNear: camera.minNear,
    minFar: camera.minFar
  }, 0)
}

function biologyMolecularCameraFromViewer(
  viewer: MolstarViewer
): NonNullable<BiologyMolecularViewState['camera']> | null {
  const camera = viewer.plugin.canvas3d?.camera
  if (!camera) return null
  const snapshot = camera.getSnapshot()
  return {
    mode: snapshot.mode,
    fov: snapshot.fov,
    position: vectorTuple(snapshot.position),
    target: vectorTuple(snapshot.target),
    up: vectorTuple(snapshot.up),
    radius: snapshot.radius,
    radiusMax: snapshot.radiusMax,
    fog: snapshot.fog,
    clipFar: snapshot.clipFar,
    minNear: snapshot.minNear,
    minFar: snapshot.minFar
  }
}

function biologyMolecularCameraSignature(
  camera: BiologyMolecularViewState['camera']
): string {
  if (!camera) return 'none'
  return JSON.stringify([
    camera.mode,
    roundCoordinate(camera.fov),
    ...camera.position.map(roundCoordinate),
    ...camera.target.map(roundCoordinate),
    ...camera.up.map(roundCoordinate),
    roundCoordinate(camera.radius),
    roundCoordinate(camera.radiusMax),
    roundCoordinate(camera.fog),
    camera.clipFar,
    roundCoordinate(camera.minNear),
    roundCoordinate(camera.minFar)
  ])
}

function collectMolstarAtomicRecordsFromViewer(
  viewer: MolstarViewer,
  runtime: BiologyMolecularMolstarModule
): MolstarAtomicSelectionRecord[] {
  const { StructureElement, Unit } = runtime
  const records: MolstarAtomicSelectionRecord[] = []
  for (const structureRef of viewer.plugin.managers.structure.hierarchy.current.structures) {
    const structure = structureRef.cell.obj?.data
    if (!structure) continue
    for (const unit of structure.units) {
      if (!Unit.isAtomic(unit)) continue
      const location = StructureElement.Location.create(structure, unit)
      for (let index = 0; index < unit.elements.length; index += 1) {
        location.element = unit.elements[index]!
        records.push(molstarAtomicRecordFromLocation(location, runtime))
      }
    }
  }
  return uniqueMolstarAtomicRecords(records)
}

function collectSelectedMolstarAtomicRecords(
  viewer: MolstarViewer,
  runtime: BiologyMolecularMolstarModule
): MolstarAtomicSelectionRecord[] {
  const { StructureElement, Unit } = runtime
  const records: MolstarAtomicSelectionRecord[] = []
  for (const entry of viewer.plugin.managers.structure.selection.entries.values()) {
    StructureElement.Loci.forEachLocation(entry.selection, (location) => {
      if (Unit.isAtomic(location.unit)) {
        records.push(molstarAtomicRecordFromLocation(
          location as StructureElement.Location<Unit.Atomic>,
          runtime
        ))
      }
    })
  }
  return uniqueMolstarAtomicRecords(records)
}

function molstarAtomicRecordFromLocation(
  location: StructureElement.Location<Unit.Atomic>,
  runtime: BiologyMolecularMolstarModule
): MolstarAtomicSelectionRecord {
  const { StructureProperties } = runtime
  const chainId = firstNonEmpty(
    StructureProperties.chain.auth_asym_id(location),
    StructureProperties.chain.label_asym_id(location)
  )
  const insertionCode = firstNonEmpty(
    StructureProperties.residue.pdbx_PDB_ins_code(location)
  )
  const residueName = firstNonEmpty(
    StructureProperties.residue.auth_comp_id(location),
    StructureProperties.residue.label_comp_id(location)
  )
  const atomName = firstNonEmpty(
    StructureProperties.atom.auth_atom_id(location),
    StructureProperties.atom.label_atom_id(location)
  )
  const residueNumber = StructureProperties.residue.auth_seq_id(location)
  const atomId = StructureProperties.atom.id(location)
  return {
    modelId: StructureProperties.unit.model_num(location),
    ...(chainId ? { chainId } : {}),
    ...(Number.isFinite(residueNumber) ? { residueNumber } : {}),
    ...(insertionCode ? { insertionCode } : {}),
    ...(residueName ? { residueName } : {}),
    ...(atomName ? { atomName } : {}),
    ...(Number.isFinite(atomId) ? { atomId } : {})
  }
}

function biologyMolecularLocatorMatchesStructure(
  locator: BiologyMolecularLocator,
  models: readonly { modelNum: number; entryId: string }[]
): boolean {
  if (locator.modelId === undefined) return true
  return typeof locator.modelId === 'number'
    ? models.some((model) => model.modelNum === locator.modelId)
    : models.some((model) => model.entryId === locator.modelId || String(model.modelNum) === locator.modelId)
}

function biologyMolecularRepresentationName(
  value: BiologyMolecularViewState['representation']
): 'cartoon' | 'ball-and-stick' | 'molecular-surface' | 'spacefill' | 'line' {
  if (value === 'surface') return 'molecular-surface'
  return value
}

function biologyMolecularColorThemeName(
  value: BiologyMolecularViewState['colorScheme']
): 'chain-id' | 'element-symbol' | 'residue-name' | 'uniform' {
  if (value === 'chain') return 'chain-id'
  if (value === 'element') return 'element-symbol'
  if (value === 'residue') return 'residue-name'
  return 'uniform'
}

function residueLocatorFromRecord(record: MolstarAtomicSelectionRecord): BiologyMolecularLocator {
  return {
    modelId: record.modelId,
    ...(record.chainId ? { chainId: record.chainId } : {}),
    ...(record.residueNumber !== undefined ? { residueNumber: record.residueNumber } : {}),
    ...(record.insertionCode ? { insertionCode: record.insertionCode } : {}),
    ...(record.residueName ? { residueName: record.residueName } : {})
  }
}

function atomLocatorFromRecord(record: MolstarAtomicSelectionRecord): BiologyMolecularLocator {
  return {
    ...residueLocatorFromRecord(record),
    ...(record.atomName ? { atomName: record.atomName } : {}),
    ...(record.atomId !== undefined ? { atomId: record.atomId } : {})
  }
}

function dedupeBiologyMolecularLocators(
  locators: readonly BiologyMolecularLocator[]
): BiologyMolecularLocator[] {
  const seen = new Set<string>()
  return locators.filter((locator) => {
    const key = JSON.stringify(locator)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function uniqueMolstarAtomicRecords(
  records: readonly MolstarAtomicSelectionRecord[]
): MolstarAtomicSelectionRecord[] {
  const byKey = new Map<string, MolstarAtomicSelectionRecord>()
  for (const record of records) byKey.set(atomRecordKey(record), record)
  return [...byKey.values()]
}

function countRecordsBy(
  records: readonly MolstarAtomicSelectionRecord[],
  keyFor: (record: MolstarAtomicSelectionRecord) => string
): Map<string, number> {
  const counts = new Map<string, number>()
  for (const record of records) {
    const key = keyFor(record)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

function groupRecordsBy(
  records: readonly MolstarAtomicSelectionRecord[],
  keyFor: (record: MolstarAtomicSelectionRecord) => string
): Map<string, MolstarAtomicSelectionRecord[]> {
  const groups = new Map<string, MolstarAtomicSelectionRecord[]>()
  for (const record of records) {
    const key = keyFor(record)
    const group = groups.get(key)
    if (group) group.push(record)
    else groups.set(key, [record])
  }
  return groups
}

function sortedRecordGroups(
  groups: ReadonlyMap<string, MolstarAtomicSelectionRecord[]>
): Array<[string, MolstarAtomicSelectionRecord[]]> {
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right))
}

function modelRecordKey(record: MolstarAtomicSelectionRecord): string {
  return `model:${record.modelId}`
}

function chainRecordKey(record: MolstarAtomicSelectionRecord): string {
  return `${modelRecordKey(record)}|chain:${record.chainId ?? ''}`
}

function residueRecordKey(record: MolstarAtomicSelectionRecord): string {
  return `${chainRecordKey(record)}|residue:${record.residueNumber ?? ''}:${record.insertionCode ?? ''}:${record.residueName ?? ''}`
}

function atomRecordKey(record: MolstarAtomicSelectionRecord): string {
  return `${residueRecordKey(record)}|atom:${record.atomId ?? ''}:${record.atomName ?? ''}`
}

function firstNonEmpty(...values: string[]): string | undefined {
  return values.map((value) => value.trim()).find(Boolean)
}

function vectorTuple(value: ArrayLike<number>): [number, number, number] {
  return [
    roundCoordinate(value[0] ?? 0),
    roundCoordinate(value[1] ?? 0),
    roundCoordinate(value[2] ?? 0)
  ]
}

function roundCoordinate(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
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
