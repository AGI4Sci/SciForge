import {
  WORKSPACE_MOLECULAR_ACTIONS,
  WORKSPACE_MOLECULAR_CONTRACT_VERSION,
  WORKSPACE_MOLECULAR_MAX_ITEMS,
  WORKSPACE_MOLECULAR_MAX_WARNINGS,
  WORKSPACE_MOLECULAR_PLUGIN_ID,
  WORKSPACE_PREVIEW_CONTRACT_VERSION,
  workspaceMolecularDistanceMeasurementInputSchema,
  workspaceMolecularDistanceMeasurementResultSchema,
  workspaceMolecularPreviewResultSchema,
  workspaceMolecularSelectionInputSchema,
  workspaceMolecularSelectionResultSchema,
  type NormalizedWorkspaceMolecularAtomSelector,
  type NormalizedWorkspaceMolecularAtomReference,
  type NormalizedWorkspaceMolecularDistanceMeasurementInput,
  type NormalizedWorkspaceMolecularPreviewInput,
  type NormalizedWorkspaceMolecularResidueSelector,
  type NormalizedWorkspaceMolecularSelectionInput,
  type WorkspaceMolecularAtomSummary,
  type WorkspaceMolecularChainSummary,
  type WorkspaceMolecularCoordinate,
  type WorkspaceMolecularDistanceMeasurementInput,
  type WorkspaceMolecularDistanceMeasurementResult,
  type WorkspaceMolecularElementCount,
  type WorkspaceMolecularLigandSummary,
  type WorkspaceMolecularMoleculeSummary,
  type WorkspaceMolecularObservation,
  type WorkspaceMolecularPreviewResult,
  type WorkspaceMolecularResolvedFormat,
  type WorkspaceMolecularResidueSummary,
  type WorkspaceMolecularSelection,
  type WorkspaceMolecularSelectionInput,
  type WorkspaceMolecularSelectionResult
} from './contract.js'

type MutableResidueSummary = WorkspaceMolecularResidueSummary

type MutableChainSummary = WorkspaceMolecularChainSummary & {
  residueKeys: Set<string>
  ligandKeys: Set<string>
}

type MutableLigandSummary = WorkspaceMolecularLigandSummary & {
  residueKeys: Set<string>
}

type MolecularSummaryAccumulator = {
  format: WorkspaceMolecularResolvedFormat
  atomCount: number
  modelCount: number
  moleculeCount: number
  atoms: WorkspaceMolecularAtomSummary[]
  residues: Map<string, MutableResidueSummary>
  chains: Map<string, MutableChainSummary>
  ligands: Map<string, MutableLigandSummary>
  molecules: WorkspaceMolecularMoleculeSummary[]
  elementCounts: Map<string, number>
  warnings: string[]
}

type AddAtomInput = {
  id?: string
  index?: number
  name?: string
  element?: string
  chain?: string
  residueName?: string
  residueIndex?: number
  insertionCode?: string
  group?: 'ATOM' | 'HETATM'
  moleculeIndex?: number
  coordinates?: WorkspaceMolecularCoordinate
}

type ParsedMolRecord = {
  title?: string
  type?: string
  chargeType?: string
  atomCount: number
  bondCount?: number
  substructureCount?: number
  formula?: string
}

type CifLoop = {
  headers: string[]
  rows: string[][]
}

type Mol2Record = {
  moleculeLines: string[]
  atomLines: string[]
  bondLines: string[]
  substructureLines: string[]
}

type Mol2Substructure = {
  id: string
  name: string
  rootAtomId?: string
  type?: string
  chain?: string
}

const WATER_RESIDUE_NAMES = new Set(['DOD', 'H2O', 'HOH', 'WAT'])
const ONE_LETTER_ELEMENT_SYMBOLS = new Set([
  'B',
  'C',
  'F',
  'H',
  'I',
  'K',
  'N',
  'O',
  'P',
  'S',
  'U',
  'V',
  'W',
  'Y'
])
const TWO_LETTER_ELEMENT_SYMBOLS = new Set([
  'Ac',
  'Ag',
  'Al',
  'Am',
  'Ar',
  'As',
  'At',
  'Au',
  'Ba',
  'Be',
  'Bh',
  'Bi',
  'Bk',
  'Br',
  'Ca',
  'Cd',
  'Ce',
  'Cf',
  'Cl',
  'Cm',
  'Cn',
  'Co',
  'Cr',
  'Cs',
  'Cu',
  'Db',
  'Ds',
  'Dy',
  'Er',
  'Es',
  'Eu',
  'Fe',
  'Fl',
  'Fm',
  'Fr',
  'Ga',
  'Gd',
  'Ge',
  'He',
  'Hf',
  'Hg',
  'Ho',
  'Hs',
  'In',
  'Ir',
  'Kr',
  'La',
  'Li',
  'Lr',
  'Lu',
  'Lv',
  'Mc',
  'Md',
  'Mg',
  'Mn',
  'Mo',
  'Mt',
  'Na',
  'Nb',
  'Nd',
  'Ne',
  'Nh',
  'Ni',
  'No',
  'Np',
  'Og',
  'Os',
  'Pa',
  'Pb',
  'Pd',
  'Pm',
  'Po',
  'Pr',
  'Pt',
  'Pu',
  'Ra',
  'Rb',
  'Re',
  'Rf',
  'Rg',
  'Rh',
  'Rn',
  'Ru',
  'Sb',
  'Sc',
  'Se',
  'Sg',
  'Si',
  'Sm',
  'Sn',
  'Sr',
  'Ta',
  'Tb',
  'Tc',
  'Te',
  'Th',
  'Ti',
  'Tl',
  'Tm',
  'Ts',
  'Xe',
  'Yb',
  'Zn',
  'Zr'
])
const STANDARD_RESIDUE_NAMES = new Set([
  'ALA',
  'ARG',
  'ASN',
  'ASP',
  'CYS',
  'CYX',
  'GLN',
  'GLU',
  'GLY',
  'HIS',
  'HID',
  'HIE',
  'HIP',
  'ILE',
  'LEU',
  'LYS',
  'MET',
  'MSE',
  'PHE',
  'PRO',
  'SER',
  'THR',
  'TRP',
  'TYR',
  'VAL',
  'A',
  'C',
  'G',
  'I',
  'T',
  'U',
  'DA',
  'DC',
  'DG',
  'DI',
  'DT',
  'DU'
])
const NUMBER_PATTERN = /^[+-]?(?:(?:\d+\.?\d*)|(?:\.\d+))(?:[eE][+-]?\d+)?$/
const INTEGER_PATTERN = /^[+-]?\d+$/
const MOLECULAR_TRAJECTORY_FORMATS = new Set<WorkspaceMolecularResolvedFormat>(['xtc', 'dcd', 'trr'])
const MOLECULAR_DENSITY_FORMATS = new Set<WorkspaceMolecularResolvedFormat>(['mrc', 'ccp4'])

export function createWorkspaceMolecularPreview(
  input: NormalizedWorkspaceMolecularPreviewInput
): WorkspaceMolecularPreviewResult {
  const format = resolveFormat(input)
  const summary = parseMolecularText(input.text, format)
  const resultFields = finalizeSummary(summary)

  return workspaceMolecularPreviewResultSchema.parse({
    ok: true,
    contractVersion: WORKSPACE_MOLECULAR_CONTRACT_VERSION,
    ...resultFields,
    ...(input.includeObservation
      ? { observation: buildWorkspaceObservation(input, resultFields) }
      : {})
  })
}

export function selectWorkspaceMolecular(input: WorkspaceMolecularSelectionInput): WorkspaceMolecularSelectionResult {
  const normalized = workspaceMolecularSelectionInputSchema.parse(input)
  return workspaceMolecularSelectionResultSchema.parse(buildMolecularSelectionResult(normalized))
}

export function measureWorkspaceMolecularDistance(
  input: WorkspaceMolecularDistanceMeasurementInput
): WorkspaceMolecularDistanceMeasurementResult {
  const normalized = workspaceMolecularDistanceMeasurementInputSchema.parse(input)
  return workspaceMolecularDistanceMeasurementResultSchema.parse(buildDistanceMeasurementResult(normalized))
}

type MolecularSelectionEntities = {
  atoms: WorkspaceMolecularAtomSummary[]
  residues: WorkspaceMolecularResidueSummary[]
  chains: WorkspaceMolecularChainSummary[]
  ligands: WorkspaceMolecularLigandSummary[]
}

function buildMolecularSelectionResult(
  input: NormalizedWorkspaceMolecularSelectionInput
): WorkspaceMolecularSelectionResult {
  const selectedAtoms = selectAtomsFromPreview(input)
  const selectedResidues = selectResiduesFromPreview(input, selectedAtoms)
  const selectedChains = selectChainsFromPreview(input, selectedAtoms, selectedResidues)
  const selectedLigands = selectLigandsFromPreview(input, selectedAtoms, selectedResidues)
  const warnings = boundedWarnings([
    ...boundedPreviewSearchWarnings(input.preview),
    ...unmatchedSelectionWarnings(input),
    ...(selectedAtoms.length === 0 && selectedResidues.length === 0 && selectedChains.length === 0 && selectedLigands.length === 0
      ? ['No molecular entities matched the selection input.']
      : [])
  ])
  const selection = buildStructuredSelection({
    atoms: selectedAtoms,
    residues: selectedResidues,
    chains: selectedChains,
    ligands: selectedLigands
  })

  return {
    ok: true,
    contractVersion: WORKSPACE_MOLECULAR_CONTRACT_VERSION,
    atomCount: selectedAtoms.length,
    residueCount: selectedResidues.length,
    chainCount: selectedChains.length,
    ligandCount: selectedLigands.length,
    atoms: boundedItems(selectedAtoms),
    residues: boundedItems(selectedResidues),
    chains: boundedItems(selectedChains),
    ligands: boundedItems(selectedLigands),
    selection,
    visibleText: buildSelectionVisibleText(input.preview.format, {
      atoms: selectedAtoms,
      residues: selectedResidues,
      chains: selectedChains,
      ligands: selectedLigands
    }, warnings),
    warnings
  }
}

function buildDistanceMeasurementResult(
  input: NormalizedWorkspaceMolecularDistanceMeasurementInput
): WorkspaceMolecularDistanceMeasurementResult {
  const [leftReference, rightReference] = input.atoms
  const left = resolveAtomReference(input.preview.atoms, leftReference)
  const right = resolveAtomReference(input.preview.atoms, rightReference)
  const referencedAtoms = [left.atom, right.atom].filter((atom): atom is WorkspaceMolecularAtomSummary => Boolean(atom))
  const uniqueReferencedAtoms = uniqueAtoms(referencedAtoms)
  const residues = residuesForAtoms(input.preview.residues, uniqueReferencedAtoms)
  const chains = chainsForSelection(input.preview.chains, uniqueReferencedAtoms, residues)
  const ligands = ligandsForSelection(input.preview.ligandSummaries, uniqueReferencedAtoms, residues)
  const coordinateAvailable = Boolean(left.atom?.coordinates && right.atom?.coordinates)
  const distance = coordinateAvailable && left.atom?.coordinates && right.atom?.coordinates
    ? distanceBetweenCoordinates(left.atom.coordinates, right.atom.coordinates)
    : undefined
  const warnings = boundedWarnings([
    ...boundedPreviewSearchWarnings(input.preview),
    ...atomReferenceWarnings('first atom', left),
    ...atomReferenceWarnings('second atom', right),
    ...(left.atom && right.atom && !coordinateAvailable
      ? ['Distance measurement is unsupported because one or both selected atom summaries do not include coordinates.']
      : [])
  ])
  const selection = buildStructuredSelection({
    atoms: uniqueReferencedAtoms,
    residues,
    chains,
    ligands
  })

  return {
    ok: true,
    contractVersion: WORKSPACE_MOLECULAR_CONTRACT_VERSION,
    coordinateAvailable,
    atoms: referencedAtoms.slice(0, 2),
    selection,
    ...(distance !== undefined ? { distance } : {}),
    unit: 'angstrom',
    visibleText: buildDistanceVisibleText(left.atom, right.atom, distance, coordinateAvailable, warnings),
    warnings
  }
}

function selectAtomsFromPreview(input: NormalizedWorkspaceMolecularSelectionInput): WorkspaceMolecularAtomSummary[] {
  const residueMatches = input.preview.residues
    .filter((residue) => input.residues.some((selector) => residueMatchesSelector(residue, selector)))

  return input.preview.atoms.filter((atom) => {
    if (input.chains.some((chain) => atom.chain === chain)) return true
    if (input.ligands.some((ligand) => atomMatchesLigandName(atom, ligand))) return true
    if (input.atoms.some((selector) => atomMatchesAtomSelector(atom, selector))) return true
    return residueMatches.some((residue) => atomMatchesResidueSummary(atom, residue))
  })
}

function selectResiduesFromPreview(
  input: NormalizedWorkspaceMolecularSelectionInput,
  selectedAtoms: WorkspaceMolecularAtomSummary[]
): WorkspaceMolecularResidueSummary[] {
  return input.preview.residues.filter((residue) => {
    if (input.chains.some((chain) => residue.chain === chain)) return true
    if (input.ligands.some((ligand) => residueMatchesLigandName(residue, ligand))) return true
    if (input.residues.some((selector) => residueMatchesSelector(residue, selector))) return true
    return selectedAtoms.some((atom) => atomMatchesResidueSummary(atom, residue))
  })
}

function selectChainsFromPreview(
  input: NormalizedWorkspaceMolecularSelectionInput,
  selectedAtoms: WorkspaceMolecularAtomSummary[],
  selectedResidues: WorkspaceMolecularResidueSummary[]
): WorkspaceMolecularChainSummary[] {
  return input.preview.chains.filter((chain) => {
    if (input.chains.includes(chain.id)) return true
    if (selectedAtoms.some((atom) => atom.chain === chain.id)) return true
    return selectedResidues.some((residue) => residue.chain === chain.id)
  })
}

function selectLigandsFromPreview(
  input: NormalizedWorkspaceMolecularSelectionInput,
  selectedAtoms: WorkspaceMolecularAtomSummary[],
  selectedResidues: WorkspaceMolecularResidueSummary[]
): WorkspaceMolecularLigandSummary[] {
  return input.preview.ligandSummaries.filter((ligand) => {
    if (input.ligands.some((name) => ligandNameMatches(ligand.name, name))) return true
    if (selectedAtoms.some((atom) => atomMatchesLigandSummary(atom, ligand))) return true
    return selectedResidues.some((residue) => residueMatchesLigandSummary(residue, ligand))
  })
}

function unmatchedSelectionWarnings(input: NormalizedWorkspaceMolecularSelectionInput): string[] {
  const warnings: string[] = []
  const unmatchedChains = input.chains.filter((chain) => !input.preview.chains.some((summary) => summary.id === chain))
  const unmatchedLigands = input.ligands.filter((ligand) => !input.preview.ligandSummaries.some((summary) => ligandNameMatches(summary.name, ligand)))
  const unmatchedResidues = input.residues
    .filter((selector) => !input.preview.residues.some((residue) => residueMatchesSelector(residue, selector)))
  const unmatchedAtoms = input.atoms
    .filter((selector) => !input.preview.atoms.some((atom) => atomMatchesAtomSelector(atom, selector)))

  if (unmatchedChains.length > 0) warnings.push(`${unmatchedChains.length} requested chain selector(s) were not present in the bounded preview.`)
  if (unmatchedLigands.length > 0) warnings.push(`${unmatchedLigands.length} requested ligand selector(s) were not present in the bounded preview.`)
  if (unmatchedResidues.length > 0) warnings.push(`${unmatchedResidues.length} requested residue selector(s) did not match bounded residue summaries.`)
  if (unmatchedAtoms.length > 0) warnings.push(`${unmatchedAtoms.length} requested atom selector(s) did not match bounded atom summaries.`)

  return warnings
}

function buildStructuredSelection(entities: MolecularSelectionEntities): WorkspaceMolecularSelection {
  const chains = uniqueSorted(entities.chains.map((chain) => chain.id))
  const residues = entities.residues.map((residue) => ({
    chain: residue.chain,
    index: residue.index,
    ...(residue.insertionCode ? { insertionCode: residue.insertionCode } : {}),
    name: residue.name
  }))
  const atoms = entities.atoms.map((atom) => ({
    ...(atom.id ? { id: atom.id } : {}),
    index: atom.index,
    ...(atom.element ? { element: atom.element } : {})
  }))
  const ligands = uniqueSorted(entities.ligands.map((ligand) => ligand.name))

  return {
    kind: 'molecular',
    ...(chains.length > 0 ? { chains } : {}),
    ...(residues.length > 0 ? { residues: boundedItems(residues) } : {}),
    ...(atoms.length > 0 ? { atoms: boundedItems(atoms) } : {}),
    ...(ligands.length > 0 ? { ligands } : {})
  }
}

function atomMatchesAtomSelector(
  atom: WorkspaceMolecularAtomSummary,
  selector: NormalizedWorkspaceMolecularAtomSelector
): boolean {
  if (selector.id && atom.id !== selector.id) return false
  if (selector.index !== undefined && atom.index !== selector.index) return false
  if (selector.element && !elementMatches(atom.element, selector.element)) return false
  return true
}

function residueMatchesSelector(
  residue: WorkspaceMolecularResidueSummary,
  selector: NormalizedWorkspaceMolecularResidueSelector
): boolean {
  if (selector.chain && residue.chain !== selector.chain) return false
  if (selector.index !== undefined && residue.index !== selector.index) return false
  if (selector.insertionCode && residue.insertionCode !== selector.insertionCode) return false
  if (selector.name && !ligandNameMatches(residue.name, selector.name)) return false
  if (selector.moleculeIndex !== undefined && residue.moleculeIndex !== selector.moleculeIndex) return false
  return true
}

function atomMatchesResidueSummary(
  atom: WorkspaceMolecularAtomSummary,
  residue: WorkspaceMolecularResidueSummary
): boolean {
  return atom.chain === residue.chain &&
    atom.residueIndex === residue.index &&
    ligandNameMatches(atom.residueName, residue.name) &&
    (residue.moleculeIndex === undefined || atom.moleculeIndex === residue.moleculeIndex)
}

function atomMatchesLigandName(atom: WorkspaceMolecularAtomSummary, ligandName: string): boolean {
  return ligandNameMatches(atom.residueName, ligandName)
}

function residueMatchesLigandName(residue: WorkspaceMolecularResidueSummary, ligandName: string): boolean {
  return Boolean(residue.ligand) && ligandNameMatches(residue.name, ligandName)
}

function atomMatchesLigandSummary(atom: WorkspaceMolecularAtomSummary, ligand: WorkspaceMolecularLigandSummary): boolean {
  return ligandNameMatches(atom.residueName, ligand.name) &&
    (ligand.chain === undefined || atom.chain === ligand.chain) &&
    (ligand.moleculeIndex === undefined || atom.moleculeIndex === ligand.moleculeIndex)
}

function residueMatchesLigandSummary(
  residue: WorkspaceMolecularResidueSummary,
  ligand: WorkspaceMolecularLigandSummary
): boolean {
  return Boolean(residue.ligand) &&
    ligandNameMatches(residue.name, ligand.name) &&
    (ligand.chain === undefined || residue.chain === ligand.chain) &&
    (ligand.moleculeIndex === undefined || residue.moleculeIndex === ligand.moleculeIndex)
}

function resolveAtomReference(
  atoms: WorkspaceMolecularAtomSummary[],
  reference: NormalizedWorkspaceMolecularAtomReference
): { atom?: WorkspaceMolecularAtomSummary, matchCount: number } {
  const matches = atoms.filter((atom) => {
    if (reference.id && atom.id !== reference.id) return false
    if (reference.index !== undefined && atom.index !== reference.index) return false
    return true
  })

  return {
    ...(matches[0] ? { atom: matches[0] } : {}),
    matchCount: matches.length
  }
}

function atomReferenceWarnings(
  label: string,
  resolution: { atom?: WorkspaceMolecularAtomSummary, matchCount: number }
): string[] {
  if (!resolution.atom) return [`The ${label} reference did not match any bounded atom summary.`]
  if (resolution.matchCount > 1) return [`The ${label} reference matched ${resolution.matchCount} atom summaries; the first bounded match was used.`]
  return []
}

function residuesForAtoms(
  residues: WorkspaceMolecularResidueSummary[],
  atoms: WorkspaceMolecularAtomSummary[]
): WorkspaceMolecularResidueSummary[] {
  return residues.filter((residue) => atoms.some((atom) => atomMatchesResidueSummary(atom, residue)))
}

function chainsForSelection(
  chains: WorkspaceMolecularChainSummary[],
  atoms: WorkspaceMolecularAtomSummary[],
  residues: WorkspaceMolecularResidueSummary[]
): WorkspaceMolecularChainSummary[] {
  return chains.filter((chain) => (
    atoms.some((atom) => atom.chain === chain.id) ||
    residues.some((residue) => residue.chain === chain.id)
  ))
}

function ligandsForSelection(
  ligands: WorkspaceMolecularLigandSummary[],
  atoms: WorkspaceMolecularAtomSummary[],
  residues: WorkspaceMolecularResidueSummary[]
): WorkspaceMolecularLigandSummary[] {
  return ligands.filter((ligand) => (
    atoms.some((atom) => atomMatchesLigandSummary(atom, ligand)) ||
    residues.some((residue) => residueMatchesLigandSummary(residue, ligand))
  ))
}

function uniqueAtoms(atoms: WorkspaceMolecularAtomSummary[]): WorkspaceMolecularAtomSummary[] {
  const seen = new Set<string>()
  const unique: WorkspaceMolecularAtomSummary[] = []
  for (const atom of atoms) {
    const key = atomKey(atom)
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(atom)
  }
  return unique
}

function atomKey(atom: WorkspaceMolecularAtomSummary): string {
  return [atom.moleculeIndex ?? '', atom.chain ?? '', atom.residueIndex ?? '', atom.id ?? '', atom.index, atom.name ?? ''].join(':')
}

function boundedPreviewSearchWarnings(preview: WorkspaceMolecularPreviewResult): string[] {
  return [
    ...(preview.atomCount > preview.atoms.length
      ? [`Selection searched ${preview.atoms.length} bounded atom summaries from ${preview.atomCount} parsed atoms.`]
      : []),
    ...(preview.residueCount > preview.residues.length
      ? [`Selection searched ${preview.residues.length} bounded residue summaries from ${preview.residueCount} parsed residues.`]
      : []),
    ...(preview.chainCount > preview.chains.length
      ? [`Selection searched ${preview.chains.length} bounded chain summaries from ${preview.chainCount} parsed chains.`]
      : [])
  ]
}

function buildSelectionVisibleText(
  format: WorkspaceMolecularResolvedFormat,
  entities: MolecularSelectionEntities,
  warnings: string[]
): string {
  const elements = elementCountsForAtoms(entities.atoms)
    .map((entry) => `${entry.element}:${entry.count}`)
    .join(', ')
  const chains = uniqueSorted(entities.chains.map((chain) => chain.id)).join(', ')
  const ligands = uniqueSorted(entities.ligands.map((ligand) => ligand.name)).join(', ')
  return [
    `${format.toUpperCase()} molecular selection: ${entities.atoms.length} atoms, ${entities.residues.length} residues, ${entities.chains.length} chains, ${entities.ligands.length} ligands.`,
    ...(chains ? [`Chains: ${chains}`] : []),
    ...(ligands ? [`Ligands: ${ligands}`] : []),
    ...(elements ? [`Elements: ${elements}`] : []),
    ...(warnings.length > 0 ? [`Warnings: ${warnings.join(' ')}`] : [])
  ].join('\n')
}

function buildDistanceVisibleText(
  left: WorkspaceMolecularAtomSummary | undefined,
  right: WorkspaceMolecularAtomSummary | undefined,
  distance: number | undefined,
  coordinateAvailable: boolean,
  warnings: string[]
): string {
  if (distance !== undefined && left && right) {
    return `Molecular distance: ${distance.toFixed(4)} angstrom between ${formatAtomLabel(left)} and ${formatAtomLabel(right)}.`
  }

  const labels = [left, right].filter((atom): atom is WorkspaceMolecularAtomSummary => Boolean(atom)).map(formatAtomLabel)
  return [
    `Molecular distance: unavailable${labels.length > 0 ? ` for ${labels.join(' and ')}` : ''}.`,
    ...(!coordinateAvailable && left && right
      ? ['Selected atom summaries do not include coordinates.']
      : []),
    ...(warnings.length > 0 ? [`Warnings: ${warnings.join(' ')}`] : [])
  ].join('\n')
}

function formatAtomLabel(atom: WorkspaceMolecularAtomSummary): string {
  const residue = atom.residueName && atom.residueIndex !== undefined
    ? `${atom.residueName} ${atom.chain ?? '_'} ${atom.residueIndex}`
    : undefined
  return [
    atom.name ?? atom.element ?? 'atom',
    atom.id ? `#${atom.id}` : `index ${atom.index}`,
    ...(residue ? [`(${residue})`] : [])
  ].join(' ')
}

function distanceBetweenCoordinates(left: WorkspaceMolecularCoordinate, right: WorkspaceMolecularCoordinate): number {
  const dx = left.x - right.x
  const dy = left.y - right.y
  const dz = left.z - right.z
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

function elementCountsForAtoms(atoms: WorkspaceMolecularAtomSummary[]): WorkspaceMolecularElementCount[] {
  const counts = new Map<string, number>()
  for (const atom of atoms) {
    if (atom.element) incrementMap(counts, atom.element)
  }
  return [...counts.entries()]
    .map(([element, count]) => ({ element, count }))
    .sort((left, right) => left.element.localeCompare(right.element))
}

function elementMatches(value: string | undefined, requested: string): boolean {
  const normalizedValue = normalizeElementSymbol(value ?? '')
  const normalizedRequested = normalizeElementSymbol(requested)
  return Boolean(normalizedValue && normalizedRequested && normalizedValue === normalizedRequested)
}

function ligandNameMatches(value: string | undefined, requested: string): boolean {
  return normalizeResidueName(value) === normalizeResidueName(requested)
}

function parseMolecularText(text: string, format: WorkspaceMolecularResolvedFormat): MolecularSummaryAccumulator {
  if (format === 'pdb') return parsePdbText(text)
  if (format === 'cif' || format === 'mmcif') return parseCifText(text, format)
  if (format === 'sdf' || format === 'mol') return parseMolText(text, format)
  if (format === 'mol2') return parseMol2Text(text)
  if (format === 'xyz') return parseXyzText(text)
  if (MOLECULAR_TRAJECTORY_FORMATS.has(format) || MOLECULAR_DENSITY_FORMATS.has(format)) {
    return createBinaryMolecularPlaceholder(format)
  }

  const summary = createAccumulator('unknown')
  summary.warnings.push('Could not detect a supported molecular text format.')
  return summary
}

function createBinaryMolecularPlaceholder(format: WorkspaceMolecularResolvedFormat): MolecularSummaryAccumulator {
  const summary = createAccumulator(format)
  const category = MOLECULAR_TRAJECTORY_FORMATS.has(format)
    ? 'trajectory'
    : MOLECULAR_DENSITY_FORMATS.has(format)
      ? 'density map'
      : 'binary molecular'
  summary.warnings.push(`${format.toUpperCase()} ${category} files are recognized but not decoded in the lightweight molecular worker yet; use byte-range asset transport or a dedicated decoder plugin for coordinates, frames, or density voxels.`)
  return summary
}

function parsePdbText(text: string): MolecularSummaryAccumulator {
  const summary = createAccumulator('pdb')
  const modelIds = new Set<string>()
  let unnamedModelCount = 0

  for (const line of text.split(/\r?\n/)) {
    const kind = line.slice(0, 6).trim()

    if (kind === 'MODEL') {
      const modelId = line.slice(10, 14).trim()
      if (modelId) {
        modelIds.add(modelId)
      } else {
        unnamedModelCount += 1
        modelIds.add(String(unnamedModelCount))
      }
      continue
    }

    if (kind !== 'ATOM' && kind !== 'HETATM') continue

    const serial = parseInteger(line.slice(6, 11).trim())
    const atomName = line.slice(12, 16).trim()
    const residueName = line.slice(17, 20).trim()
    const residueIndex = parseInteger(line.slice(22, 26).trim())
    const insertionCode = normalizeOptionalText(line.slice(26, 27).trim())
    const element = normalizeElementSymbol(line.slice(76, 78).trim()) ?? inferElementFromAtomName(atomName)

    addAtom(summary, {
      id: serial !== undefined ? String(serial) : undefined,
      index: serial,
      name: atomName,
      element,
      chain: line.slice(21, 22).trim() || '_',
      residueName,
      residueIndex,
      insertionCode,
      group: kind as 'ATOM' | 'HETATM',
      coordinates: parseCoordinates(line.slice(30, 38), line.slice(38, 46), line.slice(46, 54))
    })
  }

  summary.modelCount = modelIds.size > 0 ? modelIds.size : (summary.atomCount > 0 ? 1 : 0)
  if (summary.atomCount === 0) {
    summary.warnings.push('No PDB ATOM or HETATM records were found.')
  }
  return summary
}

function parseCifText(text: string, format: 'cif' | 'mmcif'): MolecularSummaryAccumulator {
  const summary = createAccumulator(format)
  const modelIds = new Set<string>()
  const loops = parseCifLoops(text)
  let foundAtomSiteLoop = false

  for (const loop of loops) {
    if (!loop.headers.some((header) => header.toLowerCase().startsWith('_atom_site.'))) continue
    foundAtomSiteLoop = true
    parseAtomSiteLoop(summary, loop, modelIds)
  }

  summary.modelCount = modelIds.size > 0 ? modelIds.size : (summary.atomCount > 0 ? 1 : 0)
  if (!foundAtomSiteLoop) {
    summary.warnings.push('No mmCIF/CIF _atom_site loop was found.')
  } else if (summary.atomCount === 0) {
    summary.warnings.push('The _atom_site loop did not contain parseable atoms.')
  }
  return summary
}

function parseAtomSiteLoop(
  summary: MolecularSummaryAccumulator,
  loop: CifLoop,
  modelIds: Set<string>
): void {
  const groupIndex = findCifColumn(loop.headers, ['_atom_site.group_pdb'])
  const idIndex = findCifColumn(loop.headers, ['_atom_site.id'])
  const elementIndex = findCifColumn(loop.headers, ['_atom_site.type_symbol'])
  const atomNameIndex = findCifColumn(loop.headers, ['_atom_site.label_atom_id', '_atom_site.auth_atom_id'])
  const componentIndex = findCifColumn(loop.headers, ['_atom_site.auth_comp_id', '_atom_site.label_comp_id'])
  const chainIndex = findCifColumn(loop.headers, ['_atom_site.auth_asym_id', '_atom_site.label_asym_id'])
  const residueIndex = findCifColumn(loop.headers, ['_atom_site.auth_seq_id', '_atom_site.label_seq_id'])
  const insertionIndex = findCifColumn(loop.headers, ['_atom_site.pdbx_pdb_ins_code'])
  const modelIndex = findCifColumn(loop.headers, ['_atom_site.pdbx_pdb_model_num'])
  const xIndex = findCifColumn(loop.headers, ['_atom_site.cartn_x'])
  const yIndex = findCifColumn(loop.headers, ['_atom_site.cartn_y'])
  const zIndex = findCifColumn(loop.headers, ['_atom_site.cartn_z'])

  for (const row of loop.rows) {
    const group = normalizeCifValue(row[groupIndex])?.toUpperCase() === 'HETATM' ? 'HETATM' : 'ATOM'
    const id = normalizeCifValue(row[idIndex])
    const atomName = normalizeCifValue(row[atomNameIndex])
    const residueName = normalizeCifValue(row[componentIndex])
    const rawModel = normalizeCifValue(row[modelIndex])

    if (rawModel) {
      modelIds.add(rawModel)
    }

    addAtom(summary, {
      id,
      index: parseInteger(id),
      name: atomName,
      element: normalizeElementSymbol(normalizeCifValue(row[elementIndex]) ?? '') ?? inferElementFromAtomName(atomName),
      chain: normalizeCifValue(row[chainIndex]) ?? '_',
      residueName,
      residueIndex: parseInteger(normalizeCifValue(row[residueIndex]) ?? ''),
      insertionCode: normalizeOptionalText(normalizeCifValue(row[insertionIndex]) ?? ''),
      group,
      coordinates: parseCoordinates(
        normalizeCifValue(row[xIndex]),
        normalizeCifValue(row[yIndex]),
        normalizeCifValue(row[zIndex])
      )
    })
  }
}

function parseMolText(text: string, format: 'sdf' | 'mol'): MolecularSummaryAccumulator {
  const summary = createAccumulator(format)
  const records = format === 'sdf' ? splitSdfRecords(text) : [text]

  records.forEach((record, index) => {
    const moleculeIndex = index + 1
    const parsed = parseMolRecord(record, moleculeIndex, summary)
    if (!parsed) return

    summary.moleculeCount += 1
    summary.molecules.push({
      index: moleculeIndex,
      ...(parsed.title ? { title: parsed.title } : {}),
      ...(parsed.type ? { type: parsed.type } : {}),
      ...(parsed.chargeType ? { chargeType: parsed.chargeType } : {}),
      atomCount: parsed.atomCount,
      ...(parsed.bondCount !== undefined ? { bondCount: parsed.bondCount } : {}),
      ...(parsed.substructureCount !== undefined ? { substructureCount: parsed.substructureCount } : {}),
      ...(parsed.formula ? { formula: parsed.formula } : {})
    })
  })

  summary.modelCount = summary.moleculeCount
  if (summary.moleculeCount === 0) {
    summary.warnings.push(`No parseable ${format.toUpperCase()} molecule records were found.`)
  }
  return summary
}

function parseMolRecord(
  record: string,
  moleculeIndex: number,
  summary: MolecularSummaryAccumulator
): ParsedMolRecord | undefined {
  const lines = record.replace(/^\ufeff/, '').split(/\r?\n/)
  if (!lines.some((line) => line.trim().length > 0)) return undefined

  const title = normalizeOptionalText(lines[0]?.trim() ?? '') ?? `Molecule ${moleculeIndex}`
  if (lines.some((line) => line.includes('V3000') || line.includes('M  V30'))) {
    return parseV3000MolRecord(lines, moleculeIndex, title, summary)
  }
  return parseV2000MolRecord(lines, moleculeIndex, title, summary)
}

function parseV2000MolRecord(
  lines: string[],
  moleculeIndex: number,
  title: string,
  summary: MolecularSummaryAccumulator
): ParsedMolRecord | undefined {
  const countsLineIndex = findV2000CountsLine(lines)
  if (countsLineIndex === undefined) {
    summary.warnings.push(`Molecule ${moleculeIndex} has no V2000 counts line.`)
    return undefined
  }

  const counts = parseMolCountsLine(lines[countsLineIndex] ?? '')
  if (!counts || counts.atomCount < 0 || counts.bondCount < 0) {
    summary.warnings.push(`Molecule ${moleculeIndex} has an invalid V2000 counts line.`)
    return undefined
  }

  const elementCounts = new Map<string, number>()
  let parsedAtomCount = 0
  const atomBlockStart = countsLineIndex + 1

  for (let offset = 0; offset < counts.atomCount; offset += 1) {
    const line = lines[atomBlockStart + offset]
    if (!line) break
    const atomRecord = parseMolAtomRecord(line)
    if (!atomRecord?.element) continue

    parsedAtomCount += 1
    incrementMap(elementCounts, atomRecord.element)
    addAtom(summary, {
      index: parsedAtomCount,
      id: `${moleculeIndex}:${parsedAtomCount}`,
      element: atomRecord.element,
      moleculeIndex,
      coordinates: atomRecord.coordinates
    })
  }

  if (parsedAtomCount !== counts.atomCount) {
    summary.warnings.push(`Molecule ${moleculeIndex} parsed ${parsedAtomCount} of ${counts.atomCount} declared atoms.`)
  }

  return {
    title,
    atomCount: parsedAtomCount,
    bondCount: counts.bondCount,
    formula: formatFormula(elementCounts)
  }
}

function parseV3000MolRecord(
  lines: string[],
  moleculeIndex: number,
  title: string,
  summary: MolecularSummaryAccumulator
): ParsedMolRecord | undefined {
  const countsLine = lines.find((line) => /^\s*M\s+V30\s+COUNTS\s+/i.test(line))
  if (!countsLine) {
    summary.warnings.push(`Molecule ${moleculeIndex} has no V3000 COUNTS line.`)
    return undefined
  }

  const countParts = countsLine.replace(/^\s*M\s+V30\s+/i, '').trim().split(/\s+/)
  const atomCount = parseInteger(countParts[1] ?? '')
  const bondCount = parseInteger(countParts[2] ?? '')
  if (atomCount === undefined || bondCount === undefined) {
    summary.warnings.push(`Molecule ${moleculeIndex} has an invalid V3000 COUNTS line.`)
    return undefined
  }

  const elementCounts = new Map<string, number>()
  let parsedAtomCount = 0
  let inAtomBlock = false

  for (const line of lines) {
    if (/^\s*M\s+V30\s+BEGIN\s+ATOM\s*$/i.test(line)) {
      inAtomBlock = true
      continue
    }
    if (/^\s*M\s+V30\s+END\s+ATOM\s*$/i.test(line)) {
      inAtomBlock = false
      continue
    }
    if (!inAtomBlock) continue

    const parts = line.replace(/^\s*M\s+V30\s+/i, '').trim().split(/\s+/)
    const atomId = parts[0]
    const element = normalizeElementSymbol(parts[1] ?? '')
    if (!atomId || !element) continue

    parsedAtomCount += 1
    incrementMap(elementCounts, element)
    addAtom(summary, {
      index: parseInteger(atomId) ?? parsedAtomCount,
      id: `${moleculeIndex}:${atomId}`,
      element,
      moleculeIndex,
      coordinates: parseCoordinates(parts[2], parts[3], parts[4])
    })
  }

  if (parsedAtomCount !== atomCount) {
    summary.warnings.push(`Molecule ${moleculeIndex} parsed ${parsedAtomCount} of ${atomCount} declared V3000 atoms.`)
  }

  return {
    title,
    atomCount: parsedAtomCount,
    bondCount,
    formula: formatFormula(elementCounts)
  }
}

function parseMol2Text(text: string): MolecularSummaryAccumulator {
  const summary = createAccumulator('mol2')
  const records = splitMol2Records(text)

  records.forEach((record, index) => {
    const moleculeIndex = index + 1
    const parsed = parseMol2Record(record, moleculeIndex, summary)
    if (!parsed) return

    summary.moleculeCount += 1
    summary.molecules.push({
      index: moleculeIndex,
      ...(parsed.title ? { title: parsed.title } : {}),
      ...(parsed.type ? { type: parsed.type } : {}),
      ...(parsed.chargeType ? { chargeType: parsed.chargeType } : {}),
      atomCount: parsed.atomCount,
      ...(parsed.bondCount !== undefined ? { bondCount: parsed.bondCount } : {}),
      ...(parsed.substructureCount !== undefined ? { substructureCount: parsed.substructureCount } : {}),
      ...(parsed.formula ? { formula: parsed.formula } : {})
    })
  })

  summary.modelCount = summary.moleculeCount
  if (summary.moleculeCount === 0) {
    summary.warnings.push('No parseable MOL2 molecule records were found.')
  }
  return summary
}

function parseMol2Record(
  record: Mol2Record,
  moleculeIndex: number,
  summary: MolecularSummaryAccumulator
): ParsedMolRecord | undefined {
  const molecule = parseMol2MoleculeSection(record.moleculeLines, moleculeIndex)
  const substructures = parseMol2Substructures(record.substructureLines)
  const { atomCount, elementCounts } = parseMol2Atoms(record, molecule, substructures, moleculeIndex, summary)
  const bondCount = countMol2Bonds(record.bondLines)
  const substructureCount = substructures.size

  if (record.moleculeLines.length === 0 && atomCount === 0 && bondCount === 0 && substructureCount === 0) {
    return undefined
  }

  if (molecule.declaredAtomCount !== undefined && atomCount !== molecule.declaredAtomCount) {
    summary.warnings.push(`MOL2 molecule ${moleculeIndex} parsed ${atomCount} of ${molecule.declaredAtomCount} declared atoms.`)
  }
  if (molecule.declaredBondCount !== undefined && bondCount !== molecule.declaredBondCount) {
    summary.warnings.push(`MOL2 molecule ${moleculeIndex} parsed ${bondCount} of ${molecule.declaredBondCount} declared bonds.`)
  }
  if (molecule.declaredSubstructureCount !== undefined && substructureCount !== molecule.declaredSubstructureCount) {
    summary.warnings.push(`MOL2 molecule ${moleculeIndex} parsed ${substructureCount} of ${molecule.declaredSubstructureCount} declared substructures.`)
  }
  if (record.atomLines.length === 0 && (molecule.declaredAtomCount ?? 0) > 0) {
    summary.warnings.push(`MOL2 molecule ${moleculeIndex} has no ATOM section.`)
  }

  return {
    title: molecule.title,
    type: molecule.type,
    chargeType: molecule.chargeType,
    atomCount,
    bondCount,
    substructureCount,
    formula: formatFormula(elementCounts)
  }
}

function splitMol2Records(text: string): Mol2Record[] {
  const records: Mol2Record[] = []
  let current = createEmptyMol2Record()
  let currentSection: keyof Mol2Record | undefined

  for (const rawLine of text.replace(/^\ufeff/, '').split(/\r?\n/)) {
    const section = parseMol2SectionHeader(rawLine)
    if (section) {
      if (section === 'MOLECULE') {
        if (hasMol2RecordContent(current)) records.push(current)
        current = createEmptyMol2Record()
        currentSection = 'moleculeLines'
        continue
      }

      if (section === 'ATOM') {
        currentSection = 'atomLines'
        continue
      }
      if (section === 'BOND') {
        currentSection = 'bondLines'
        continue
      }
      if (section === 'SUBSTRUCTURE') {
        currentSection = 'substructureLines'
        continue
      }

      currentSection = undefined
      continue
    }

    if (currentSection) {
      current[currentSection].push(rawLine)
    }
  }

  if (hasMol2RecordContent(current)) records.push(current)
  return records
}

function createEmptyMol2Record(): Mol2Record {
  return {
    moleculeLines: [],
    atomLines: [],
    bondLines: [],
    substructureLines: []
  }
}

function hasMol2RecordContent(record: Mol2Record): boolean {
  return Object.values(record).some((lines) => lines.some((line) => line.trim().length > 0))
}

function parseMol2SectionHeader(line: string): string | undefined {
  return line.trim().match(/^@<TRIPOS>([A-Za-z0-9_]+)\s*$/i)?.[1]?.toUpperCase()
}

function parseMol2MoleculeSection(lines: string[], moleculeIndex: number): {
  title: string
  type?: string
  chargeType?: string
  declaredAtomCount?: number
  declaredBondCount?: number
  declaredSubstructureCount?: number
} {
  const entries = lines.map((line) => line.trim()).filter(Boolean)
  const title = normalizeOptionalText(entries[0] ?? '') ?? `MOL2 molecule ${moleculeIndex}`
  const countParts = (entries[1] ?? '').split(/\s+/)

  return {
    title,
    declaredAtomCount: parseInteger(countParts[0] ?? ''),
    declaredBondCount: parseInteger(countParts[1] ?? ''),
    declaredSubstructureCount: parseInteger(countParts[2] ?? ''),
    ...(normalizeOptionalText(entries[2] ?? '') ? { type: normalizeOptionalText(entries[2] ?? '') } : {}),
    ...(normalizeOptionalText(entries[3] ?? '') ? { chargeType: normalizeOptionalText(entries[3] ?? '') } : {})
  }
}

function parseMol2Substructures(lines: string[]): Map<string, Mol2Substructure> {
  const substructures = new Map<string, Mol2Substructure>()

  for (const line of lines) {
    const parts = tokenizeMol2DataLine(line)
    const id = normalizeMol2Token(parts[0])
    const name = normalizeMol2Token(parts[1])
    if (!id || !name) continue

    substructures.set(id, {
      id,
      name,
      ...(normalizeMol2Token(parts[2]) ? { rootAtomId: normalizeMol2Token(parts[2]) } : {}),
      ...(normalizeMol2Token(parts[3]) ? { type: normalizeMol2Token(parts[3]) } : {}),
      ...(normalizeMol2Token(parts[5]) ? { chain: normalizeMol2Token(parts[5]) } : {})
    })
  }

  return substructures
}

function parseMol2Atoms(
  record: Mol2Record,
  molecule: { title: string, type?: string },
  substructures: Map<string, Mol2Substructure>,
  moleculeIndex: number,
  summary: MolecularSummaryAccumulator
): { atomCount: number, elementCounts: Map<string, number> } {
  const elementCounts = new Map<string, number>()
  let atomCount = 0

  for (const line of record.atomLines) {
    const parts = tokenizeMol2DataLine(line)
    if (parts.length < 6) continue
    if (!parts.slice(2, 5).every((value) => NUMBER_PATTERN.test(value))) continue

    const rawAtomId = normalizeMol2Token(parts[0])
    const atomName = normalizeMol2Token(parts[1])
    const atomType = normalizeMol2Token(parts[5])
    if (!rawAtomId || !atomName || !atomType) continue

    const substructureId = normalizeMol2Token(parts[6])
    const atomSubstructureName = normalizeMol2Token(parts[7])
    const substructure = substructureId ? substructures.get(substructureId) : undefined
    const residueName = substructure?.name ?? atomSubstructureName ?? ligandNameForMol2Molecule(molecule)
    const residueIndex = parseInteger(substructure?.id ?? substructureId ?? '')
    const element = inferMol2Element(atomType, atomName)
    const ligand = isMol2Ligand(molecule.type, substructure, residueName)

    atomCount += 1
    if (element) incrementMap(elementCounts, element)
    addAtom(summary, {
      index: parseInteger(rawAtomId) ?? atomCount,
      id: `${moleculeIndex}:${rawAtomId}`,
      name: atomName,
      element,
      chain: substructure?.chain,
      residueName,
      residueIndex,
      group: ligand ? 'HETATM' : 'ATOM',
      moleculeIndex,
      coordinates: parseCoordinates(parts[2], parts[3], parts[4])
    })
  }

  return { atomCount, elementCounts }
}

function countMol2Bonds(lines: string[]): number {
  let bondCount = 0
  for (const line of lines) {
    const parts = tokenizeMol2DataLine(line)
    if (parts.length < 4) continue
    if (parseInteger(parts[0]) === undefined || !normalizeMol2Token(parts[1]) || !normalizeMol2Token(parts[2])) continue
    bondCount += 1
  }
  return bondCount
}

function tokenizeMol2DataLine(line: string): string[] {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) return []
  return trimmed.split(/\s+/)
}

function normalizeMol2Token(value: string | undefined): string | undefined {
  const normalized = normalizeOptionalText(value ?? '')
  if (!normalized || normalized === '****') return undefined
  return normalized
}

function ligandNameForMol2Molecule(molecule: { title: string, type?: string }): string | undefined {
  const type = molecule.type?.toUpperCase()
  if (type && type !== 'SMALL' && type !== 'MOLECULE') return undefined
  return molecule.title
}

function inferMol2Element(atomType: string, atomName: string): string | undefined {
  return inferMol2ElementFromToken(atomType.split('.')[0] ?? '') ?? inferMol2ElementFromToken(atomName)
}

function inferMol2ElementFromToken(value: string): string | undefined {
  const letters = value.trim().replace(/^[^A-Za-z]+/, '').replace(/[^A-Za-z].*$/, '')
  if (!letters) return undefined

  const twoLetter = normalizeElementSymbol(letters.slice(0, 2))
  if (twoLetter && TWO_LETTER_ELEMENT_SYMBOLS.has(twoLetter)) return twoLetter

  const oneLetter = normalizeElementSymbol(letters.slice(0, 1))
  return oneLetter && ONE_LETTER_ELEMENT_SYMBOLS.has(oneLetter) ? oneLetter : undefined
}

function isMol2Ligand(
  moleculeType: string | undefined,
  substructure: Mol2Substructure | undefined,
  residueName: string | undefined
): boolean {
  const normalizedResidueName = normalizeResidueName(residueName)
  if (normalizedResidueName && WATER_RESIDUE_NAMES.has(normalizedResidueName)) return false

  const normalizedMoleculeType = moleculeType?.toUpperCase()
  if (normalizedMoleculeType === 'SMALL' || normalizedMoleculeType === 'MOLECULE') return true

  if (normalizedMoleculeType?.includes('PROTEIN') || normalizedMoleculeType?.includes('BIOPOLYMER')) {
    return normalizedResidueName ? !STANDARD_RESIDUE_NAMES.has(normalizedResidueName) : false
  }

  const substructureType = substructure?.type?.toUpperCase()
  if (substructureType && substructureType !== 'RESIDUE') return true
  return normalizedResidueName ? !STANDARD_RESIDUE_NAMES.has(normalizedResidueName) : true
}

function parseXyzText(text: string): MolecularSummaryAccumulator {
  const summary = createAccumulator('xyz')
  const lines = text.replace(/^\ufeff/, '').split(/\r?\n/)
  let cursor = 0
  let moleculeIndex = 1

  while (cursor < lines.length) {
    while (cursor < lines.length && !lines[cursor]?.trim()) {
      cursor += 1
    }
    if (cursor >= lines.length) break

    const declaredAtomCount = parseInteger(lines[cursor]?.trim() ?? '')
    if (declaredAtomCount === undefined || declaredAtomCount < 0) {
      summary.warnings.push(`XYZ record ${moleculeIndex} does not start with an atom count.`)
      break
    }

    const title = normalizeOptionalText(lines[cursor + 1]?.trim() ?? '') ?? `XYZ frame ${moleculeIndex}`
    const elementCounts = new Map<string, number>()
    let parsedAtomCount = 0
    const atomStart = cursor + 2

    for (let offset = 0; offset < declaredAtomCount; offset += 1) {
      const line = lines[atomStart + offset]
      if (!line) break
      const parts = line.trim().split(/\s+/)
      const element = normalizeElementSymbol(parts[0] ?? '')
      const coordinates = parts.slice(1, 4)
      if (!element || coordinates.length < 3 || !coordinates.every((value) => NUMBER_PATTERN.test(value))) continue

      parsedAtomCount += 1
      incrementMap(elementCounts, element)
      addAtom(summary, {
        index: parsedAtomCount,
        id: `${moleculeIndex}:${parsedAtomCount}`,
        element,
        moleculeIndex,
        coordinates: parseCoordinates(coordinates[0], coordinates[1], coordinates[2])
      })
    }

    if (parsedAtomCount !== declaredAtomCount) {
      summary.warnings.push(`XYZ record ${moleculeIndex} parsed ${parsedAtomCount} of ${declaredAtomCount} declared atoms.`)
    }

    summary.moleculeCount += 1
    summary.molecules.push({
      index: moleculeIndex,
      title,
      atomCount: parsedAtomCount,
      formula: formatFormula(elementCounts)
    })

    cursor = atomStart + declaredAtomCount
    moleculeIndex += 1
  }

  summary.modelCount = summary.moleculeCount
  if (summary.moleculeCount === 0) {
    summary.warnings.push('No parseable XYZ records were found.')
  }
  return summary
}

function createAccumulator(format: WorkspaceMolecularResolvedFormat): MolecularSummaryAccumulator {
  return {
    format,
    atomCount: 0,
    modelCount: 0,
    moleculeCount: 0,
    atoms: [],
    residues: new Map(),
    chains: new Map(),
    ligands: new Map(),
    molecules: [],
    elementCounts: new Map(),
    warnings: []
  }
}

function addAtom(summary: MolecularSummaryAccumulator, atom: AddAtomInput): void {
  summary.atomCount += 1
  const atomIndex = Math.max(0, atom.index ?? summary.atomCount)
  const element = normalizeElementSymbol(atom.element ?? '') ?? inferElementFromAtomName(atom.name)
  if (element) {
    incrementMap(summary.elementCounts, element)
  }

  const chain = normalizeChain(atom.chain)
  const residueName = normalizeResidueName(atom.residueName)
  const residueIndex = normalizeResidueIndex(atom.residueIndex)
  const insertionCode = normalizeOptionalText(atom.insertionCode ?? '')
  const moleculeIndex = atom.moleculeIndex
  const coordinates = normalizeCoordinates(atom.coordinates)

  if (summary.atoms.length < WORKSPACE_MOLECULAR_MAX_ITEMS) {
    summary.atoms.push({
      index: atomIndex,
      ...(atom.id ? { id: atom.id } : {}),
      ...(atom.name ? { name: atom.name } : {}),
      ...(element ? { element } : {}),
      ...(chain ? { chain } : {}),
      ...(residueName ? { residueName } : {}),
      ...(residueIndex !== undefined ? { residueIndex } : {}),
      ...(moleculeIndex !== undefined ? { moleculeIndex } : {}),
      ...(coordinates ? { coordinates } : {})
    })
  }

  if (!chain && !residueName && residueIndex === undefined) return

  const safeChain = chain ?? '_'
  const safeResidueName = residueName ?? (atom.group === 'HETATM' ? 'LIG' : 'UNK')
  const safeResidueIndex = residueIndex ?? 0
  const isLigand = atom.group === 'HETATM' && !WATER_RESIDUE_NAMES.has(safeResidueName)
  const residueKey = [
    moleculeIndex ?? '',
    safeChain,
    safeResidueIndex,
    insertionCode ?? '',
    safeResidueName
  ].join(':')

  const residue = summary.residues.get(residueKey) ?? {
    chain: safeChain,
    index: safeResidueIndex,
    ...(insertionCode ? { insertionCode } : {}),
    name: safeResidueName,
    atomCount: 0,
    ...(moleculeIndex !== undefined ? { moleculeIndex } : {}),
    ...(isLigand ? { ligand: true } : {})
  }
  residue.atomCount += 1
  summary.residues.set(residueKey, residue)

  const chainSummary = summary.chains.get(safeChain) ?? {
    id: safeChain,
    atomCount: 0,
    residueCount: 0,
    ligandCount: 0,
    residueKeys: new Set<string>(),
    ligandKeys: new Set<string>()
  }
  chainSummary.atomCount += 1
  chainSummary.residueKeys.add(residueKey)
  if (isLigand) {
    chainSummary.ligandKeys.add(residueKey)
  }
  chainSummary.residueCount = chainSummary.residueKeys.size
  chainSummary.ligandCount = chainSummary.ligandKeys.size
  summary.chains.set(safeChain, chainSummary)

  if (isLigand) {
    const ligandKey = `${safeResidueName}:${safeChain}:${moleculeIndex ?? ''}`
    const ligand = summary.ligands.get(ligandKey) ?? {
      name: safeResidueName,
      atomCount: 0,
      residueCount: 0,
      chain: safeChain,
      ...(moleculeIndex !== undefined ? { moleculeIndex } : {}),
      residueKeys: new Set<string>()
    }
    ligand.atomCount += 1
    ligand.residueKeys.add(residueKey)
    ligand.residueCount = ligand.residueKeys.size
    summary.ligands.set(ligandKey, ligand)
  }
}

function finalizeSummary(summary: MolecularSummaryAccumulator): Omit<WorkspaceMolecularPreviewResult, 'ok' | 'contractVersion' | 'observation'> {
  const residues = [...summary.residues.values()]
    .sort((left, right) => left.chain.localeCompare(right.chain) || left.index - right.index || left.name.localeCompare(right.name))
  const chains = [...summary.chains.values()]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map(({ residueKeys: _residueKeys, ligandKeys: _ligandKeys, ...chain }) => chain)
  const ligandSummaries = [...summary.ligands.values()]
    .sort((left, right) => left.name.localeCompare(right.name) || (left.chain ?? '').localeCompare(right.chain ?? ''))
    .map(({ residueKeys: _residueKeys, ...ligand }) => ligand)
  const ligands = uniqueSorted(ligandSummaries.map((ligand) => ligand.name))
  const elementCounts = [...summary.elementCounts.entries()]
    .map(([element, count]) => ({ element, count }))
    .sort((left, right) => left.element.localeCompare(right.element))
  const warnings = boundedWarnings([
    ...summary.warnings,
    ...truncationWarnings('atoms', summary.atomCount, summary.atoms.length),
    ...truncationWarnings('residues', residues.length, Math.min(residues.length, WORKSPACE_MOLECULAR_MAX_ITEMS)),
    ...truncationWarnings('chains', chains.length, Math.min(chains.length, WORKSPACE_MOLECULAR_MAX_ITEMS)),
    ...truncationWarnings('ligands', ligandSummaries.length, Math.min(ligandSummaries.length, WORKSPACE_MOLECULAR_MAX_ITEMS)),
    ...truncationWarnings('molecules', summary.molecules.length, Math.min(summary.molecules.length, WORKSPACE_MOLECULAR_MAX_ITEMS)),
    ...truncationWarnings('elements', elementCounts.length, Math.min(elementCounts.length, WORKSPACE_MOLECULAR_MAX_ITEMS))
  ])

  return {
    format: summary.format,
    atomCount: summary.atomCount,
    residueCount: residues.length,
    chainCount: chains.length,
    ligandCount: ligands.length,
    moleculeCount: summary.moleculeCount,
    modelCount: summary.modelCount,
    chainIds: boundedItems(chains.map((chain) => chain.id)),
    ligands: boundedItems(ligands),
    atoms: boundedItems(summary.atoms),
    residues: boundedItems(residues),
    chains: boundedItems(chains),
    ligandSummaries: boundedItems(ligandSummaries),
    molecules: boundedItems(summary.molecules),
    elementCounts: boundedItems(elementCounts),
    warnings
  }
}

function buildWorkspaceObservation(
  input: NormalizedWorkspaceMolecularPreviewInput,
  summary: Omit<WorkspaceMolecularPreviewResult, 'ok' | 'contractVersion' | 'observation'>
): WorkspaceMolecularObservation {
  const title = titleForPath(input.path)
  const selection = buildMolecularSelection(summary)
  const annotations = summary.warnings.map((warning, index) => ({
    id: `warning-${index + 1}`,
    kind: 'warning',
    summary: warning
  }))

  return {
    schemaVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
    file: {
      path: input.path?.trim() || `inline-molecular.${extensionForFormat(summary.format)}`,
      ...(input.workspaceRoot ? { workspaceRoot: input.workspaceRoot } : {}),
      mimeType: input.mimeType ?? defaultMimeType(summary.format),
      ...(input.size !== undefined ? { size: input.size } : {}),
      ...(input.mtimeMs !== undefined ? { mtimeMs: input.mtimeMs } : {})
    },
    view: {
      pluginId: WORKSPACE_MOLECULAR_PLUGIN_ID,
      modality: 'molecular',
      mode: 'preview',
      title
    },
    ...(selection ? { selection } : {}),
    visibleText: buildVisibleText(summary),
    molecular: {
      modelCount: summary.modelCount,
      chains: summary.chainIds,
      ligands: summary.ligands,
      representations: representationsForSummary(summary)
    },
    ...(annotations.length > 0 ? { annotations } : {}),
    actions: actionsForSummary(summary)
  }
}

function buildMolecularSelection(
  summary: Omit<WorkspaceMolecularPreviewResult, 'ok' | 'contractVersion' | 'observation'>
): WorkspaceMolecularObservation['selection'] | undefined {
  if (summary.chainIds.length === 0 && summary.residues.length === 0 && summary.atoms.length === 0 && summary.ligands.length === 0) {
    return undefined
  }

  return {
    kind: 'molecular',
    ...(summary.chainIds.length > 0 ? { chains: summary.chainIds } : {}),
    ...(summary.residues.length > 0
      ? {
          residues: summary.residues.map((residue) => ({
            chain: residue.chain,
            index: residue.index,
            ...(residue.insertionCode ? { insertionCode: residue.insertionCode } : {}),
            name: residue.name
          }))
        }
      : {}),
    ...(summary.atoms.length > 0
      ? {
          atoms: summary.atoms.map((atom) => ({
            ...(atom.id ? { id: atom.id } : {}),
            index: atom.index,
            ...(atom.element ? { element: atom.element } : {})
          }))
        }
      : {}),
    ...(summary.ligands.length > 0 ? { ligands: summary.ligands } : {})
  }
}

function buildVisibleText(summary: Omit<WorkspaceMolecularPreviewResult, 'ok' | 'contractVersion' | 'observation'>): string {
  const parts = [
    `${summary.format.toUpperCase()} molecular preview`,
    `${summary.atomCount} atoms`,
    `${summary.residueCount} residues`,
    `${summary.chainCount} chains`,
    `${summary.ligandCount} ligands`,
    `${summary.moleculeCount} molecules`,
    `${summary.modelCount} models`
  ]
  const elements = summary.elementCounts.slice(0, 12).map((entry) => `${entry.element}:${entry.count}`).join(', ')
  const molecules = summary.molecules.slice(0, 5)
    .map((molecule) => `${molecule.title ?? `Molecule ${molecule.index}`} (${molecule.atomCount} atoms${molecule.formula ? `, ${molecule.formula}` : ''})`)
    .join('; ')

  return [
    parts.join(', '),
    ...(elements ? [`Elements: ${elements}`] : []),
    ...(molecules ? [`Molecules: ${molecules}`] : []),
    ...(summary.warnings.length > 0 ? [`Warnings: ${summary.warnings.join(' ')}`] : [])
  ].join('\n')
}

function resolveFormat(input: NormalizedWorkspaceMolecularPreviewInput): WorkspaceMolecularResolvedFormat {
  if (input.format !== 'auto') return input.format

  const extension = input.path?.split(/[\\/]/).at(-1)?.toLowerCase().match(/\.([^.]+)$/)?.[1]
  if (extension === 'pdb' || extension === 'ent') return 'pdb'
  if (extension === 'cif') return 'cif'
  if (extension === 'mmcif') return 'mmcif'
  if (extension === 'sdf') return 'sdf'
  if (extension === 'mol') return 'mol'
  if (extension === 'mol2') return 'mol2'
  if (extension === 'xyz') return 'xyz'
  if (extension === 'xtc') return 'xtc'
  if (extension === 'dcd') return 'dcd'
  if (extension === 'trr') return 'trr'
  if (extension === 'mrc') return 'mrc'
  if (extension === 'ccp4') return 'ccp4'

  const mimeType = input.mimeType?.toLowerCase()
  if (mimeType?.includes('pdb')) return 'pdb'
  if (mimeType?.includes('mmcif')) return 'mmcif'
  if (mimeType?.includes('cif')) return 'cif'
  if (mimeType?.includes('mol2') || mimeType?.includes('tripos')) return 'mol2'
  if (mimeType?.includes('sdf')) return 'sdf'
  if (mimeType?.includes('mol')) return 'mol'
  if (mimeType?.includes('xyz')) return 'xyz'
  if (mimeType?.includes('xtc')) return 'xtc'
  if (mimeType?.includes('dcd')) return 'dcd'
  if (mimeType?.includes('trr')) return 'trr'
  if (mimeType?.includes('mrc')) return 'mrc'
  if (mimeType?.includes('ccp4')) return 'ccp4'

  return detectFormatFromText(input.text)
}

function detectFormatFromText(text: string): WorkspaceMolecularResolvedFormat {
  const sample = text.replace(/^\ufeff/, '').slice(0, 16_384)
  const lines = sample.split(/\r?\n/)
  const firstNonEmptyLine = lines.find((line) => line.trim().length > 0)?.trim() ?? ''

  if (lines.some((line) => /^(?:ATOM {2}|HETATM|MODEL |HEADER|TITLE )/.test(line))) return 'pdb'
  if (/^data_/i.test(firstNonEmptyLine) || /_atom_site\./i.test(sample)) return 'cif'
  if (/@<TRIPOS>MOLECULE/i.test(sample) || /@<TRIPOS>ATOM/i.test(sample)) return 'mol2'
  if (lines.some((line) => line.trim() === '$$$$')) return 'sdf'
  if (lines.some((line) => /\bV(?:2000|3000)\b/.test(line))) return 'mol'
  if (INTEGER_PATTERN.test(firstNonEmptyLine)) return 'xyz'
  return 'unknown'
}

function parseCifLoops(text: string): CifLoop[] {
  const lines = text.replace(/^\ufeff/, '').split(/\r?\n/)
  const loops: CifLoop[] = []
  let cursor = 0

  while (cursor < lines.length) {
    if (lines[cursor]?.trim().toLowerCase() !== 'loop_') {
      cursor += 1
      continue
    }

    cursor += 1
    const headers: string[] = []
    while (cursor < lines.length) {
      const trimmed = lines[cursor]?.trim() ?? ''
      if (!trimmed || trimmed.startsWith('#')) {
        cursor += 1
        continue
      }
      if (!trimmed.startsWith('_')) break
      headers.push(trimmed.split(/\s+/)[0]?.toLowerCase() ?? '')
      cursor += 1
    }

    const tokens: string[] = []
    while (cursor < lines.length) {
      const rawLine = lines[cursor] ?? ''
      const trimmed = rawLine.trim()
      const lower = trimmed.toLowerCase()
      if (!trimmed || trimmed.startsWith('#')) {
        cursor += 1
        continue
      }
      if (lower === 'loop_' || lower.startsWith('data_') || lower.startsWith('save_') || trimmed.startsWith('_')) {
        break
      }
      if (rawLine.startsWith(';')) {
        const multiline = [rawLine.slice(1)]
        cursor += 1
        while (cursor < lines.length && !(lines[cursor] ?? '').startsWith(';')) {
          multiline.push(lines[cursor] ?? '')
          cursor += 1
        }
        if (cursor < lines.length) cursor += 1
        tokens.push(multiline.join('\n').trim())
        continue
      }
      tokens.push(...tokenizeCifLine(rawLine))
      cursor += 1
    }

    if (headers.length > 0) {
      const rows: string[][] = []
      for (let index = 0; index + headers.length <= tokens.length; index += headers.length) {
        rows.push(tokens.slice(index, index + headers.length))
      }
      loops.push({ headers, rows })
    }
  }

  return loops
}

function tokenizeCifLine(line: string): string[] {
  const tokens: string[] = []
  let cursor = 0

  while (cursor < line.length) {
    while (cursor < line.length && /\s/.test(line[cursor] ?? '')) {
      cursor += 1
    }
    if (cursor >= line.length) break
    if (line[cursor] === '#') break

    const quote = line[cursor]
    if (quote === '\'' || quote === '"') {
      cursor += 1
      let value = ''
      while (cursor < line.length && line[cursor] !== quote) {
        value += line[cursor]
        cursor += 1
      }
      if (cursor < line.length) cursor += 1
      tokens.push(value)
      continue
    }

    let value = ''
    while (cursor < line.length && !/\s/.test(line[cursor] ?? '') && line[cursor] !== '#') {
      value += line[cursor]
      cursor += 1
    }
    if (value) tokens.push(value)
    if (line[cursor] === '#') break
  }

  return tokens
}

function findCifColumn(headers: string[], candidates: string[]): number {
  const normalizedCandidates = candidates.map((candidate) => candidate.toLowerCase())
  for (const candidate of normalizedCandidates) {
    const index = headers.indexOf(candidate)
    if (index >= 0) return index
  }
  return -1
}

function normalizeCifValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed || trimmed === '.' || trimmed === '?') return undefined
  return trimmed
}

function splitSdfRecords(text: string): string[] {
  const records: string[] = []
  const current: string[] = []

  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '$$$$') {
      if (current.some((entry) => entry.trim().length > 0)) {
        records.push(current.join('\n'))
      }
      current.length = 0
      continue
    }
    current.push(line)
  }

  if (current.some((entry) => entry.trim().length > 0)) {
    records.push(current.join('\n'))
  }
  return records
}

function findV2000CountsLine(lines: string[]): number | undefined {
  const upperBound = Math.min(lines.length, 12)
  for (let index = 0; index < upperBound; index += 1) {
    const line = lines[index] ?? ''
    if (!/\bV2000\b/.test(line) && index !== 3) continue
    if (parseMolCountsLine(line)) return index
  }
  return undefined
}

function parseMolCountsLine(line: string): { atomCount: number, bondCount: number } | undefined {
  const fixedAtomCount = parseInteger(line.slice(0, 3).trim())
  const fixedBondCount = parseInteger(line.slice(3, 6).trim())
  if (fixedAtomCount !== undefined && fixedBondCount !== undefined) {
    return { atomCount: fixedAtomCount, bondCount: fixedBondCount }
  }

  const parts = line.trim().split(/\s+/)
  const atomCount = parseInteger(parts[0] ?? '')
  const bondCount = parseInteger(parts[1] ?? '')
  if (atomCount === undefined || bondCount === undefined) return undefined
  return { atomCount, bondCount }
}

function parseMolAtomRecord(line: string): { element?: string, coordinates?: WorkspaceMolecularCoordinate } | undefined {
  const fixedSymbol = normalizeElementSymbol(line.slice(31, 34).trim())
  const parts = line.trim().split(/\s+/)
  const element = fixedSymbol ?? normalizeElementSymbol(parts[3] ?? '')
  if (!element) return undefined
  const coordinates = parseCoordinates(line.slice(0, 10), line.slice(10, 20), line.slice(20, 30)) ??
    parseCoordinates(parts[0], parts[1], parts[2])
  return {
    element,
    ...(coordinates ? { coordinates } : {})
  }
}

function parseInteger(value: string | undefined): number | undefined {
  const trimmed = value?.trim()
  if (!trimmed || !INTEGER_PATTERN.test(trimmed)) return undefined
  const parsed = Number.parseInt(trimmed, 10)
  return Number.isFinite(parsed) ? parsed : undefined
}

function parseNumber(value: string | undefined): number | undefined {
  const trimmed = value?.trim()
  if (!trimmed || !NUMBER_PATTERN.test(trimmed)) return undefined
  const parsed = Number.parseFloat(trimmed)
  return Number.isFinite(parsed) ? parsed : undefined
}

function parseCoordinates(
  xValue: string | undefined,
  yValue: string | undefined,
  zValue: string | undefined
): WorkspaceMolecularCoordinate | undefined {
  const x = parseNumber(xValue)
  const y = parseNumber(yValue)
  const z = parseNumber(zValue)
  if (x === undefined || y === undefined || z === undefined) return undefined
  return { x, y, z }
}

function normalizeCoordinates(coordinates: WorkspaceMolecularCoordinate | undefined): WorkspaceMolecularCoordinate | undefined {
  if (!coordinates) return undefined
  if (!Number.isFinite(coordinates.x) || !Number.isFinite(coordinates.y) || !Number.isFinite(coordinates.z)) return undefined
  return coordinates
}

function normalizeResidueIndex(index: number | undefined): number | undefined {
  if (index === undefined || !Number.isFinite(index)) return undefined
  return Math.max(0, Math.trunc(index))
}

function normalizeResidueName(name: string | undefined): string | undefined {
  const normalized = normalizeOptionalText(name ?? '')
  return normalized ? normalized.toUpperCase().slice(0, 32) : undefined
}

function normalizeChain(chain: string | undefined): string | undefined {
  const normalized = normalizeOptionalText(chain ?? '')
  return normalized?.slice(0, 64)
}

function normalizeOptionalText(value: string): string | undefined {
  const trimmed = value.trim()
  if (!trimmed || trimmed === '.' || trimmed === '?') return undefined
  return trimmed
}

function normalizeElementSymbol(value: string): string | undefined {
  const letters = value.trim().replace(/[^A-Za-z]/g, '')
  if (!letters) return undefined
  return `${letters[0]?.toUpperCase() ?? ''}${letters[1]?.toLowerCase() ?? ''}`.slice(0, 8)
}

function inferElementFromAtomName(name: string | undefined): string | undefined {
  const firstLetter = name?.replace(/^[^A-Za-z]+/, '').match(/[A-Za-z]/)?.[0]
  return firstLetter ? firstLetter.toUpperCase() : undefined
}

function incrementMap(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1)
}

function formatFormula(elementCounts: Map<string, number>): string | undefined {
  if (elementCounts.size === 0) return undefined
  const orderedElements = [
    ...(['C', 'H'].filter((element) => elementCounts.has(element))),
    ...[...elementCounts.keys()].filter((element) => element !== 'C' && element !== 'H').sort()
  ]
  return orderedElements
    .map((element) => `${element}${elementCounts.get(element) === 1 ? '' : elementCounts.get(element)}`)
    .join('')
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right))
}

function boundedItems<T>(items: T[]): T[] {
  return items.slice(0, WORKSPACE_MOLECULAR_MAX_ITEMS)
}

function boundedWarnings(warnings: string[]): string[] {
  const uniqueWarnings = [...new Set(warnings.filter((warning) => warning.trim().length > 0))]
  return uniqueWarnings.slice(0, WORKSPACE_MOLECULAR_MAX_WARNINGS)
}

function truncationWarnings(label: string, total: number, included: number): string[] {
  return total > included ? [`Summary includes ${included} of ${total} ${label}.`] : []
}

function titleForPath(path: string | undefined): string {
  return path?.split(/[\\/]/).filter(Boolean).at(-1) || 'Molecular structure'
}

function extensionForFormat(format: WorkspaceMolecularResolvedFormat): string {
  if (format === 'mmcif') return 'mmcif'
  if (format === 'cif') return 'cif'
  if (format === 'sdf') return 'sdf'
  if (format === 'mol') return 'mol'
  if (format === 'mol2') return 'mol2'
  if (format === 'xyz') return 'xyz'
  if (format === 'xtc') return 'xtc'
  if (format === 'dcd') return 'dcd'
  if (format === 'trr') return 'trr'
  if (format === 'mrc') return 'mrc'
  if (format === 'ccp4') return 'ccp4'
  return 'pdb'
}

function defaultMimeType(format: WorkspaceMolecularResolvedFormat): string {
  if (format === 'pdb') return 'chemical/x-pdb'
  if (format === 'cif' || format === 'mmcif') return 'chemical/x-mmcif'
  if (format === 'sdf') return 'chemical/x-mdl-sdfile'
  if (format === 'mol') return 'chemical/x-mdl-molfile'
  if (format === 'mol2') return 'chemical/x-mol2'
  if (format === 'xyz') return 'chemical/x-xyz'
  if (format === 'xtc') return 'application/x-gromacs-xtc'
  if (format === 'trr') return 'application/x-gromacs-trr'
  if (format === 'dcd') return 'application/x-dcd'
  if (format === 'mrc') return 'application/x-mrc'
  if (format === 'ccp4') return 'application/x-ccp4'
  return 'text/plain'
}

function representationsForSummary(
  summary: Omit<WorkspaceMolecularPreviewResult, 'ok' | 'contractVersion' | 'observation'>
): string[] {
  if (MOLECULAR_TRAJECTORY_FORMATS.has(summary.format)) {
    return ['trajectory-placeholder']
  }
  if (MOLECULAR_DENSITY_FORMATS.has(summary.format)) {
    return ['density-placeholder']
  }
  if (summary.residueCount > 0 || summary.chainCount > 0) {
    return ['cartoon', 'surface', 'stick']
  }
  if (summary.atomCount > 0) {
    return ['ball-stick', 'stick']
  }
  return ['stick']
}

function actionsForSummary(
  summary: Omit<WorkspaceMolecularPreviewResult, 'ok' | 'contractVersion' | 'observation'>
): string[] {
  const actions = ['molecular.preview']
  if (summary.atomCount > 0 || summary.residueCount > 0 || summary.chainCount > 0 || summary.ligandCount > 0) {
    actions.push('molecular.select')
  }
  if (summary.atoms.filter((atom) => atom.coordinates).length >= 2) {
    actions.push('molecular.measureDistance')
  }
  return actions
}
