import type { WorkspaceStructuredSelection } from '@shared/workspace-preview'

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

async function load3Dmol(): Promise<Required<Pick<ThreeDmolModule, 'createViewer'>>> {
  const imported = await import('3dmol') as ThreeDmolModule
  const candidate = imported.createViewer
    ? imported
    : imported.default?.createViewer
      ? imported.default
      : imported.$3Dmol?.createViewer
        ? imported.$3Dmol
        : undefined

  if (!candidate?.createViewer) {
    throw new Error('3Dmol viewer API is unavailable.')
  }
  return candidate as Required<Pick<ThreeDmolModule, 'createViewer'>>
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
