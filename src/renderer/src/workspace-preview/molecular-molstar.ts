import type { WorkspaceStructuredSelection } from '@shared/workspace-preview'
import type { Viewer as MolstarViewer } from 'molstar/lib/apps/viewer/app'
import type { ViewerOptions as MolstarViewerOptions } from 'molstar/lib/apps/viewer/options'
import type { BuiltInCoordinatesFormat } from 'molstar/lib/mol-plugin-state/formats/coordinates'
import type { BuiltInTrajectoryFormat } from 'molstar/lib/mol-plugin-state/formats/trajectory'
import type { BuildInVolumeFormat } from 'molstar/lib/mol-plugin-state/formats/volume'
import type { StructureElement } from 'molstar/lib/mol-model/structure'
import { Color } from 'molstar/lib/mol-util/color'

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
  () => import('molstar/lib/apps/viewer/app') as Promise<MolecularMolstarViewerModule>
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

  return {
    setSelection: (nextSelection) => {
      applyMolecularMolstarSelection(viewer, nextSelection)
    },
    resize: () => viewer.handleResize(),
    dispose: () => viewer.dispose()
  }
}

async function resetMolecularMolstarViewport(viewer: MolstarViewer): Promise<void> {
  viewer.handleResize()
  viewer.plugin.canvas3d?.requestCameraReset({ durationMs: 0 })
  viewer.plugin.managers.camera.reset(undefined, 0)
  await waitForNextFrame()
  viewer.handleResize()
  viewer.plugin.canvas3d?.requestCameraReset({ durationMs: 0 })
  viewer.plugin.managers.camera.reset(undefined, 0)
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
    action: ['select', 'focus'],
    focusOptions: { extraRadius: 3 }
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
