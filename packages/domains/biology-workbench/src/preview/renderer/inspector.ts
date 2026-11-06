import type {
  LifeScienceStructuredSelection as WorkspaceStructuredSelection,
  LifeScienceWorkspaceObservation as WorkspaceObservation
} from '../wire'
import type {
  WorkspacePreviewInspectorRow,
  WorkspacePreviewInspectorSection
} from './contribution-types'

export function buildMolecularSelectionSection(
  selection: Extract<WorkspaceStructuredSelection, { kind: 'molecular' }>
): WorkspacePreviewInspectorSection {
  return selectionSection(selection, compactStrings([
    'Molecular',
    selection.chains?.length ? formatCount(selection.chains.length, 'chain') : undefined,
    selection.residues?.length ? formatCount(selection.residues.length, 'residue') : undefined,
    selection.atoms?.length ? formatCount(selection.atoms.length, 'atom') : undefined,
    selection.ligands?.length ? formatCount(selection.ligands.length, 'ligand') : undefined
  ]).join(', '), [
    selection.chains?.length ? row('chains', 'Chains', joinList(selection.chains)) : null,
    selection.residues?.length ? row('residues', 'Residues', formatCount(selection.residues.length, 'residue')) : null,
    selection.atoms?.length ? row('atoms', 'Atoms', formatCount(selection.atoms.length, 'atom')) : null,
    selection.ligands?.length ? row('ligands', 'Ligands', joinList(selection.ligands)) : null
  ])
}

export function buildSequenceSelectionSection(
  selection: Extract<WorkspaceStructuredSelection, { kind: 'sequence' }>
): WorkspacePreviewInspectorSection {
  return selectionSection(selection, `Sequence ${formatCount(selection.ranges.length, 'range')}`, [
    selection.sequenceId ? row('sequence', 'Sequence', selection.sequenceId) : null,
    row('ranges', 'Ranges', formatCount(selection.ranges.length, 'range')),
    selection.features?.length ? row('features', 'Features', formatCount(selection.features.length, 'feature')) : null
  ])
}

export function buildOmicsSelectionSection(
  selection: Extract<WorkspaceStructuredSelection, { kind: 'omics' }>
): WorkspacePreviewInspectorSection {
  return selectionSection(selection, compactStrings([
    'Omics',
    selection.matrixIds?.length ? formatCount(selection.matrixIds.length, 'matrix', 'matrices') : undefined,
    selection.obsKeys?.length ? formatCount(selection.obsKeys.length, 'obs key') : undefined,
    selection.varKeys?.length ? formatCount(selection.varKeys.length, 'var key') : undefined,
    selection.embeddings?.length ? formatCount(selection.embeddings.length, 'embedding') : undefined,
    selection.ranges?.length ? formatCount(selection.ranges.length, 'range') : undefined
  ]).join(', '), [
    selection.matrixIds?.length ? row('matrices', 'Matrices', joinList(selection.matrixIds)) : null,
    selection.obsKeys?.length ? row('obs-keys', 'Observation keys', joinList(selection.obsKeys)) : null,
    selection.varKeys?.length ? row('var-keys', 'Variable keys', joinList(selection.varKeys)) : null,
    selection.embeddings?.length ? row('embeddings', 'Embeddings', joinList(selection.embeddings)) : null,
    selection.ranges?.length ? row('ranges', 'Ranges', formatCount(selection.ranges.length, 'range')) : null
  ])
}

export function buildBioimagingSelectionSection(
  selection: Extract<WorkspaceStructuredSelection, { kind: 'bioimaging' }>
): WorkspacePreviewInspectorSection {
  return selectionSection(selection, compactStrings([
    'Bioimaging',
    selection.roiIds?.length ? formatCount(selection.roiIds.length, 'ROI', 'ROIs') : undefined,
    selection.regions?.length ? formatCount(selection.regions.length, 'region') : undefined
  ]).join(', '), [
    selection.roiIds?.length ? row('rois', 'ROIs', formatCount(selection.roiIds.length, 'ROI', 'ROIs')) : null,
    selection.channels?.length ? row('channels', 'Channels', joinList(selection.channels)) : null,
    selection.regions?.length ? row('regions', 'Regions', formatCount(selection.regions.length, 'region')) : null
  ])
}

export function buildSpectraSelectionSection(
  selection: Extract<WorkspaceStructuredSelection, { kind: 'spectra' }>
): WorkspacePreviewInspectorSection {
  return selectionSection(selection, compactStrings([
    'Spectra',
    formatCount(selection.ranges.length, 'range'),
    selection.peaks?.length ? formatCount(selection.peaks.length, 'peak') : undefined
  ]).join(', '), [
    row('ranges', 'Ranges', formatCount(selection.ranges.length, 'range')),
    selection.peaks?.length ? row('peaks', 'Peaks', formatCount(selection.peaks.length, 'peak')) : null
  ])
}

export function buildMolecularSection(
  molecular: NonNullable<WorkspaceObservation['molecular']>
): WorkspacePreviewInspectorSection {
  const summary = compactStrings([
    typeof molecular.modelCount === 'number' ? formatCount(molecular.modelCount, 'model') : undefined,
    molecular.chains?.length ? formatCount(molecular.chains.length, 'chain') : undefined,
    molecular.ligands?.length ? formatCount(molecular.ligands.length, 'ligand') : undefined
  ])
  return {
    id: 'molecular',
    title: 'Molecular',
    summary: summary.length ? summary.join(', ') : 'Molecular details',
    rows: compactRows([
      typeof molecular.modelCount === 'number' ? row('models', 'Models', String(molecular.modelCount)) : null,
      molecular.chains?.length ? row('chains', 'Chains', joinList(molecular.chains)) : null,
      molecular.ligands?.length ? row('ligands', 'Ligands', joinList(molecular.ligands)) : null,
      molecular.representations?.length ? row('representations', 'Representations', joinList(molecular.representations)) : null
    ])
  }
}

export function buildSequenceSection(
  sequence: NonNullable<WorkspaceObservation['sequence']>
): WorkspacePreviewInspectorSection {
  const summary = compactStrings([
    typeof sequence.sequenceCount === 'number' ? formatCount(sequence.sequenceCount, 'sequence') : undefined,
    typeof sequence.totalLength === 'number' ? `${sequence.totalLength} bp/aa` : undefined,
    sequence.alphabet ? formatSequenceAlphabet(sequence.alphabet) : undefined
  ])
  return {
    id: 'sequence',
    title: 'Sequence',
    summary: summary.length ? summary.join(', ') : 'Sequence details',
    rows: compactRows([
      typeof sequence.sequenceCount === 'number' ? row('sequences', 'Sequences', String(sequence.sequenceCount)) : null,
      typeof sequence.totalLength === 'number' ? row('total-length', 'Total length', String(sequence.totalLength)) : null,
      sequence.alphabet ? row('alphabet', 'Alphabet', formatSequenceAlphabet(sequence.alphabet)) : null
    ])
  }
}

export function buildOmicsSection(
  omics: NonNullable<WorkspaceObservation['omics']>
): WorkspacePreviewInspectorSection {
  const summary = compactStrings([
    omics.format,
    omics.matrixShape ? `${omics.matrixShape[0]} x ${omics.matrixShape[1]}` : undefined,
    omics.matrixIds?.length ? formatCount(omics.matrixIds.length, 'matrix', 'matrices') : undefined,
    typeof omics.observationCount === 'number' ? formatCount(omics.observationCount, 'observation') : undefined,
    typeof omics.variableCount === 'number' ? formatCount(omics.variableCount, 'variable') : undefined
  ])
  return {
    id: 'omics',
    title: 'Omics',
    summary: summary.length ? summary.join(', ') : 'Omics matrix details',
    rows: compactRows([
      omics.format ? row('format', 'Format', omics.format) : null,
      omics.matrixShape ? row('shape', 'Shape', `${omics.matrixShape[0]} x ${omics.matrixShape[1]}`) : null,
      omics.matrixIds?.length ? row('matrices', 'Matrices', joinList(omics.matrixIds)) : null,
      typeof omics.observationCount === 'number' ? row('observations', 'Observations', String(omics.observationCount)) : null,
      typeof omics.variableCount === 'number' ? row('variables', 'Variables', String(omics.variableCount)) : null,
      omics.obsKeys?.length ? row('obs-keys', 'Observation keys', joinList(omics.obsKeys)) : null,
      omics.varKeys?.length ? row('var-keys', 'Variable keys', joinList(omics.varKeys)) : null,
      omics.embeddings?.length ? row('embeddings', 'Embeddings', joinList(omics.embeddings)) : null,
      omics.metadataKeys?.length ? row('metadata-keys', 'Metadata keys', joinList(omics.metadataKeys)) : null
    ])
  }
}

export function buildBioimagingSection(
  bioimaging: NonNullable<WorkspaceObservation['bioimaging']>
): WorkspacePreviewInspectorSection {
  const dimensions = bioimaging.dimensions
  const shape = dimensions
    ? compactStrings([
        `${dimensions.width} x ${dimensions.height}`,
        dimensions.z ? `Z ${dimensions.z}` : undefined,
        dimensions.t ? `T ${dimensions.t}` : undefined
      ]).join(', ')
    : undefined
  const summary = compactStrings([
    bioimaging.format,
    shape,
    bioimaging.channels?.length ? formatCount(bioimaging.channels.length, 'channel') : undefined,
    bioimaging.tilePlan?.levelCount !== undefined ? formatCount(bioimaging.tilePlan.levelCount, 'tile level') : undefined
  ])
  return {
    id: 'bioimaging',
    title: 'Bioimaging',
    summary: summary.length ? summary.join(', ') : 'Bioimaging details',
    rows: compactRows([
      bioimaging.format ? row('format', 'Format', bioimaging.format) : null,
      bioimaging.detectedBy ? row('detected-by', 'Detected by', bioimaging.detectedBy) : null,
      typeof bioimaging.byteLength === 'number' ? row('byte-length', 'Bytes', formatBytes(bioimaging.byteLength)) : null,
      shape ? row('dimensions', 'Dimensions', shape) : null,
      bioimaging.channels?.length ? row('channels', 'Channels', joinList(bioimaging.channels)) : null,
      bioimaging.tilePlan ? row('tile-plan', 'Tile plan', formatBioimagingTilePlan(bioimaging.tilePlan)) : null
    ])
  }
}

export function buildSpectraSection(
  spectra: NonNullable<WorkspaceObservation['spectra']>
): WorkspacePreviewInspectorSection {
  const summary = compactStrings([
    spectra.format,
    typeof spectra.spectrumCount === 'number' ? formatCount(spectra.spectrumCount, 'spectrum', 'spectra') : undefined,
    typeof spectra.peakCount === 'number' ? formatCount(spectra.peakCount, 'peak') : undefined,
    typeof spectra.scanCount === 'number' && spectra.scanCount > 0 ? formatCount(spectra.scanCount, 'scan') : undefined,
    spectra.xAxis ? `x: ${spectra.xAxis}` : undefined
  ])
  return {
    id: 'spectra',
    title: 'Spectra',
    summary: summary.length ? summary.join(', ') : 'Spectra details',
    rows: compactRows([
      spectra.format ? row('format', 'Format', spectra.format) : null,
      typeof spectra.spectrumCount === 'number' ? row('spectra', 'Spectra', String(spectra.spectrumCount)) : null,
      typeof spectra.peakCount === 'number' ? row('peaks', 'Peaks', String(spectra.peakCount)) : null,
      typeof spectra.scanCount === 'number' ? row('scans', 'Scans', String(spectra.scanCount)) : null,
      spectra.xAxis ? row('x-axis', 'X axis', spectra.xAxis) : null,
      spectra.mzRange ? row('mz-range', 'm/z range', formatNumericRange(spectra.mzRange)) : null,
      spectra.intensityRange ? row('intensity-range', 'Intensity range', formatNumericRange(spectra.intensityRange)) : null,
      spectra.sampledPeaks?.length ? row('sampled-peaks', 'Sampled peaks', formatCount(spectra.sampledPeaks.length, 'peak')) : null,
      spectra.scanMarkers?.length ? row('scan-markers', 'Scan markers', formatCount(spectra.scanMarkers.length, 'marker')) : null
    ])
  }
}

function selectionSection(
  selection: WorkspaceStructuredSelection,
  summary: string,
  rows: Array<WorkspacePreviewInspectorRow | null>
): WorkspacePreviewInspectorSection {
  return {
    id: 'selection',
    title: 'Selection',
    summary,
    rows: compactRows([row('kind', 'Kind', titleCase(selection.kind)), ...rows])
  }
}

function row(id: string, label: string, value: string, description?: string): WorkspacePreviewInspectorRow {
  return { id, label, value, description }
}

function compactRows(
  rows: Array<WorkspacePreviewInspectorRow | null | undefined>
): WorkspacePreviewInspectorRow[] {
  return rows.filter((item): item is WorkspacePreviewInspectorRow => Boolean(item))
}

function compactStrings(values: Array<string | null | undefined>): string[] {
  return values.filter((value): value is string => Boolean(value))
}

function joinList(values: readonly string[], limit = 6): string {
  const shown = values.slice(0, limit)
  const suffix = values.length > limit ? `, +${values.length - limit} more` : ''
  return `${shown.join(', ')}${suffix}`
}

function formatNumericRange(range: { min: number; max: number }): string {
  return `${formatDecimal(range.min)} - ${formatDecimal(range.max)}`
}

function formatBioimagingTilePlan(
  tilePlan: NonNullable<NonNullable<WorkspaceObservation['bioimaging']>['tilePlan']>
): string {
  const parts = compactStrings([
    tilePlan.status,
    tilePlan.source,
    tilePlan.levelCount !== undefined ? formatCount(tilePlan.levelCount, 'level') : undefined,
    tilePlan.tileSize ? `${tilePlan.tileSize.width} x ${tilePlan.tileSize.height}` : undefined,
    tilePlan.pixelDecoding === false ? 'no pixel decoding' : undefined,
    tilePlan.tileRendererImplemented === false ? 'renderer pending' : undefined
  ])
  return parts.length ? parts.join(', ') : 'Tile plan'
}

function formatCount(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = size / 1024
  for (const unit of units) {
    if (value < 1024) return `${formatDecimal(value)} ${unit}`
    value /= 1024
  }
  return `${formatDecimal(value)} PB`
}

function formatDecimal(value: number): string {
  return value.toFixed(value >= 10 ? 0 : 1).replace(/\.0$/, '')
}

function formatSequenceAlphabet(
  alphabet: NonNullable<NonNullable<WorkspaceObservation['sequence']>['alphabet']>
): string {
  if (alphabet === 'dna' || alphabet === 'rna') return alphabet.toUpperCase()
  return titleCase(alphabet)
}

function titleCase(value: string): string {
  return value
    .replace(/[-_]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)
    .join(' ')
}
