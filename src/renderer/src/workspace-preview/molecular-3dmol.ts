import type { WorkspaceStructuredSelection } from '@shared/workspace-preview'
import threeDmolScriptUrl from '3dmol/build/3Dmol-min.js?url'

export type Molecular3DmolFormat = 'pdb' | 'cif' | 'sdf' | 'mol2' | 'xyz'
export type MolecularRepresentationMode = 'cartoon-stick' | 'cartoon' | 'stick' | 'ball-stick'

export const MOLECULAR_REPRESENTATION_MODES: readonly MolecularRepresentationMode[] = [
  'cartoon-stick',
  'cartoon',
  'stick',
  'ball-stick'
]

export type MolecularStructureRendererInput = {
  element: HTMLElement
  source: string
  format: Molecular3DmolFormat
  selection?: Extract<WorkspaceStructuredSelection, { kind: 'molecular' }>
  representation?: MolecularRepresentationMode
}

export type MolecularStructureRendererHandle = {
  setRepresentation: (
    representation: MolecularRepresentationMode,
    selection?: Extract<WorkspaceStructuredSelection, { kind: 'molecular' }>
  ) => void
  setSelection: (
    selection?: Extract<WorkspaceStructuredSelection, { kind: 'molecular' }>,
    representation?: MolecularRepresentationMode
  ) => void
  dispose: () => void
}

export type MolecularStructureRenderer = (
  input: MolecularStructureRendererInput
) => Promise<MolecularStructureRendererHandle>

type ThreeDmolModule = {
  createViewer?: (element: HTMLElement, options?: Record<string, unknown>) => Molecular3DmolViewer
  default?: ThreeDmolModule
  $3Dmol?: ThreeDmolModule
  '3Dmol'?: ThreeDmolModule
}

type ThreeDmolCandidate = Required<Pick<ThreeDmolModule, 'createViewer'>>
type ThreeDmolGlobal = typeof globalThis & {
  $3Dmol?: ThreeDmolModule
  '3Dmol'?: ThreeDmolModule
}

export type Molecular3DmolViewer = {
  addModel: (source: string, format: string, options?: Record<string, unknown>) => unknown
  removeAllModels?: () => unknown
  clear?: () => unknown
  setStyle: (selection: Record<string, unknown>, style: Record<string, unknown>) => unknown
  zoomTo: (selection?: Record<string, unknown>) => unknown
  render: () => unknown
}

export function molecular3DmolFormatForPath(path: string): Molecular3DmolFormat | null {
  const normalized = path.trim().toLowerCase()
  if (/\.(?:pdb|ent)$/i.test(normalized)) return 'pdb'
  if (/\.(?:cif|mmcif)$/i.test(normalized)) return 'cif'
  if (/\.(?:sdf|mol)$/i.test(normalized)) return 'sdf'
  if (/\.mol2$/i.test(normalized)) return 'mol2'
  if (/\.xyz$/i.test(normalized)) return 'xyz'
  return null
}

export const renderMolecularStructureWith3Dmol: MolecularStructureRenderer = async ({
  element,
  source,
  format,
  selection,
  representation = 'cartoon-stick'
}) => {
  const threeDmol = await load3Dmol()
  const viewer = threeDmol.createViewer(element, {
    backgroundColor: 'white'
  })
  let currentRepresentation = representation
  let currentSelection = selection

  viewer.addModel(source, format)
  applyMolecularRepresentationStyle(viewer, format, currentRepresentation)
  applyMolecularSelectionStyle(viewer, currentSelection)
  viewer.zoomTo()
  viewer.render()

  return {
    setRepresentation: (nextRepresentation, nextSelection = currentSelection) => {
      currentRepresentation = nextRepresentation
      currentSelection = nextSelection
      applyMolecularRepresentationStyle(viewer, format, currentRepresentation)
      applyMolecularSelectionStyle(viewer, currentSelection)
      viewer.render()
    },
    setSelection: (nextSelection, nextRepresentation = currentRepresentation) => {
      currentRepresentation = nextRepresentation
      currentSelection = nextSelection
      applyMolecularRepresentationStyle(viewer, format, currentRepresentation)
      applyMolecularSelectionStyle(viewer, currentSelection)
      const nextZoomTarget = currentSelection ? molecularSelectionSpecs(currentSelection)[0] : undefined
      if (nextZoomTarget) viewer.zoomTo(nextZoomTarget)
      viewer.render()
    },
    dispose: () => {
      viewer.removeAllModels?.()
      viewer.clear?.()
      element.replaceChildren()
    }
  }
}

const THREE_DMOL_IMPORT_TIMEOUT_MS = 2500
let threeDmolScriptLoadPromise: Promise<void> | null = null

async function load3Dmol(): Promise<ThreeDmolCandidate> {
  const globalCandidate = resolveBrowser3DmolGlobal()
  if (globalCandidate) return globalCandidate

  const imported = await promiseWithTimeout(
    import('3dmol') as Promise<ThreeDmolModule>,
    THREE_DMOL_IMPORT_TIMEOUT_MS,
    'Timed out loading the 3Dmol module bundle.'
  ).catch(() => null)
  const importedCandidate = resolve3DmolCandidate(imported)
  if (importedCandidate) return importedCandidate

  const globalAfterImport = resolveBrowser3DmolGlobal()
  if (globalAfterImport) return globalAfterImport

  await load3DmolBrowserScript()
  const globalAfterScript = resolveBrowser3DmolGlobal()
  if (globalAfterScript) return globalAfterScript

  throw new Error('3Dmol viewer API is unavailable.')
}

function resolve3DmolCandidate(module: ThreeDmolModule | null | undefined): ThreeDmolCandidate | null {
  const candidate = module?.createViewer
    ? module
    : module?.default?.createViewer
      ? module.default
      : module?.$3Dmol?.createViewer
        ? module.$3Dmol
        : module?.['3Dmol']?.createViewer
          ? module['3Dmol']
          : undefined

  return candidate?.createViewer ? candidate as ThreeDmolCandidate : null
}

function resolveBrowser3DmolGlobal(): ThreeDmolCandidate | null {
  const browserGlobal = globalThis as ThreeDmolGlobal
  return resolve3DmolCandidate(browserGlobal.$3Dmol) ?? resolve3DmolCandidate(browserGlobal['3Dmol'])
}

function load3DmolBrowserScript(): Promise<void> {
  if (typeof document === 'undefined') {
    return Promise.reject(new Error('3Dmol browser bundle cannot be loaded without a document.'))
  }

  const selector = 'script[data-sciforge-3dmol-loader="true"]'
  const existingScript = document.querySelector<HTMLScriptElement>(selector)
  if (existingScript?.getAttribute('data-loaded') === 'true') return Promise.resolve()
  if (threeDmolScriptLoadPromise) return threeDmolScriptLoadPromise

  threeDmolScriptLoadPromise = new Promise<void>((resolve, reject) => {
    const script = existingScript ?? document.createElement('script')
    const previousOnLoad = script.onload
    const previousOnError = script.onerror

    script.setAttribute('data-sciforge-3dmol-loader', 'true')
    script.async = true
    if (!script.src) script.src = threeDmolScriptUrl

    script.onload = (event) => {
      script.setAttribute('data-loaded', 'true')
      if (typeof previousOnLoad === 'function') previousOnLoad.call(script, event)
      resolve()
    }
    script.onerror = (event, source, lineno, colno, error) => {
      threeDmolScriptLoadPromise = null
      if (typeof previousOnError === 'function') previousOnError.call(script, event, source, lineno, colno, error)
      reject(new Error('Failed to load the 3Dmol browser bundle.'))
    }

    if (!existingScript) document.head.appendChild(script)
  })

  return threeDmolScriptLoadPromise
}

function promiseWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(message)), timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timeout)
        resolve(value)
      },
      (error) => {
        clearTimeout(timeout)
        reject(error)
      }
    )
  })
}

export function molecularRepresentationStyle(
  format: Molecular3DmolFormat,
  representation: MolecularRepresentationMode
): Record<string, unknown> {
  const supportsCartoon = format === 'pdb' || format === 'cif'
  if (representation === 'cartoon' && supportsCartoon) return { cartoon: { color: 'spectrum' } }
  if (representation === 'cartoon-stick' && supportsCartoon) {
    return {
      cartoon: { color: 'spectrum' },
      stick: { radius: 0.12, colorscheme: 'Jmol' }
    }
  }
  if (representation === 'stick') return { stick: { radius: 0.18, colorscheme: 'Jmol' } }
  return {
    stick: { radius: 0.18, colorscheme: 'Jmol' },
    sphere: { scale: 0.22 }
  }
}

export function molecularRepresentationModeForObservation(
  format: Molecular3DmolFormat | null | undefined,
  representations: readonly string[] | undefined
): MolecularRepresentationMode {
  const supportsCartoon = format === 'pdb' || format === 'cif'
  const normalized = (representations ?? [])
    .map((representationName) => representationName.trim().toLowerCase())
    .filter(Boolean)
  const hasRepresentation = (pattern: RegExp) =>
    normalized.some((representationName) => pattern.test(representationName))
  const hasCartoon = hasRepresentation(/cartoon/)
  const hasStick = hasRepresentation(/\bsticks?\b|stick/)
  const hasBallStick = hasRepresentation(/ball[-_\s]?stick|sphere|spheres/)

  if (supportsCartoon && hasCartoon && hasStick) return 'cartoon-stick'
  if (supportsCartoon && hasCartoon) return 'cartoon'
  if (hasBallStick) return 'ball-stick'
  if (hasStick) return 'stick'
  return supportsCartoon ? 'cartoon-stick' : 'ball-stick'
}

export function applyMolecularRepresentationStyle(
  viewer: Pick<Molecular3DmolViewer, 'setStyle'>,
  format: Molecular3DmolFormat,
  representation: MolecularRepresentationMode
): void {
  viewer.setStyle({}, molecularRepresentationStyle(format, representation))
}

export function applyMolecularSelectionStyle(
  viewer: Pick<Molecular3DmolViewer, 'setStyle'>,
  selection: Extract<WorkspaceStructuredSelection, { kind: 'molecular' }> | undefined
): void {
  if (!selection) return

  for (const selector of molecularSelectionSpecs(selection)) {
    viewer.setStyle(selector, {
      stick: { radius: 0.26, color: '#00A7A7' },
      sphere: { scale: 0.34, color: '#00A7A7' }
    })
  }
}

export function molecularSelectionSpecs(
  selection: Extract<WorkspaceStructuredSelection, { kind: 'molecular' }>
): Record<string, unknown>[] {
  return [
    ...(selection.chains ?? []).map((chain) => ({ chain })),
    ...(selection.residues ?? []).map((residue) => ({
      ...(residue.chain ? { chain: residue.chain } : {}),
      resi: residue.index,
      ...(residue.name ? { resn: residue.name } : {})
    })),
    ...(selection.ligands ?? []).map((ligand) => ({ resn: ligand })),
    ...(selection.atoms ?? []).map((atom) => ({
      ...(atom.index !== undefined ? { serial: atom.index } : {}),
      ...(atom.id ? { atom: atom.id } : {}),
      ...(atom.element ? { elem: atom.element } : {})
    }))
  ].filter((selector) => Object.keys(selector).length > 0)
}
