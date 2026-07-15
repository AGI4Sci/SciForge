import type {
  BiologyAnnotation,
  BiologyRoomAsset,
  BiologyRoomManifest,
  BiologyRoomSelection
} from '@shared/biology-room'
import type { WorkspaceStructuredSelection } from '@shared/workspace-preview'

export type BiologyRoomInspectorTab = 'selection' | 'annotations' | 'versions' | 'provenance'
export type BiologyRoomViewerKind = 'sequence' | 'genome' | 'molecular' | 'unsupported'

export type BiologyRoomRevisionSummary = {
  revision: number
  createdAt: string
  summary?: string
  actor?: 'user' | 'agent' | 'system'
  active?: boolean
}

export type BiologyRoomProvenanceEntry = {
  id: string
  createdAt: string
  actor: 'user' | 'agent' | 'system'
  summary: string
  detail?: string
  revision?: number
}

export type BiologyRoomRevisionConflict = {
  expectedRevision: number
  actualRevision: number
  message?: string
}

export function biologySelectionFromWorkspaceSelection(
  assetId: string,
  selection: WorkspaceStructuredSelection
): BiologyRoomSelection | null | undefined {
  if (selection.kind === 'sequence') {
    if (selection.ranges.length === 0) return null
    return {
      kind: 'sequence',
      assetId,
      ...(selection.sequenceId ? { sequenceId: selection.sequenceId } : {}),
      ranges: selection.ranges.map((range) => ({
        start: range.start,
        end: range.end,
        ...(range.strand ? { strand: range.strand } : {})
      })),
      ...(selection.features?.length
        ? { featureIds: selection.features.map((feature) => feature.id).filter((id): id is string => Boolean(id)) }
        : {})
    }
  }

  if (selection.kind === 'molecular') {
    const locators: Extract<BiologyRoomSelection, { kind: 'molecular' }>['locators'] = []
    for (const chainId of selection.chains ?? []) locators.push({ chainId })
    for (const residue of selection.residues ?? []) {
      locators.push({
        ...(residue.chain ? { chainId: residue.chain } : {}),
        residueNumber: residue.index,
        ...(residue.insertionCode ? { insertionCode: residue.insertionCode } : {}),
        ...(residue.name ? { residueName: residue.name } : {})
      })
    }
    for (const ligand of selection.ligands ?? []) locators.push({ residueName: ligand })
    for (const atom of selection.atoms ?? []) {
      if (atom.id !== undefined) locators.push({ atomId: atom.id })
      else if (atom.index !== undefined) locators.push({ atomId: atom.index })
      else if (atom.element !== undefined) locators.push({ elementSymbol: atom.element })
    }
    return locators.length ? { kind: 'molecular', assetId, locators } : null
  }

  return undefined
}

const SEQUENCE_FORMATS = new Set(['fa', 'fasta', 'fna', 'faa', 'gb', 'gbk', 'genbank'])
const TRACK_FORMATS = new Set(['gff', 'gff3', 'bed', 'vcf'])
const MOLECULAR_FORMATS = new Set(['pdb', 'cif', 'mmcif'])
const REFERENCE_FORMATS = new Set(['fa', 'fasta', 'fna'])

export function clampBiologyRoomWidth(
  value: number,
  minWidth = 640,
  maxWidth = 1_600
): number {
  const safeMin = Math.max(320, Math.round(minWidth))
  const safeMax = Math.max(safeMin, Math.round(maxWidth))
  if (!Number.isFinite(value)) return safeMin
  return Math.min(safeMax, Math.max(safeMin, Math.round(value)))
}

export function resolveActiveBiologyRoomAsset(
  room: BiologyRoomManifest
): BiologyRoomAsset | null {
  if (room.activeAssetId) {
    const active = room.assets.find((asset) => asset.id === room.activeAssetId)
    if (active) return active
  }
  return room.assets[0] ?? null
}

export function biologyRoomWatchPaths(room: BiologyRoomManifest): string[] {
  return [...new Set([
    `.sciforge/biology/rooms/${room.roomId}/room.json`,
    ...room.assets.flatMap((asset) => [asset.path, ...asset.indexPaths])
  ])].sort()
}

export function resolveBiologyRoomViewerKind(
  asset: BiologyRoomAsset | null | undefined
): BiologyRoomViewerKind {
  if (!asset) return 'unsupported'
  const format = normalizeFormat(asset.format || asset.path)
  if (MOLECULAR_FORMATS.has(format) || asset.modality === 'structure') return 'molecular'
  if (TRACK_FORMATS.has(format) || asset.modality === 'genome-feature' || asset.modality === 'genome-variant') return 'genome'
  if (SEQUENCE_FORMATS.has(format) || asset.modality === 'sequence' || asset.modality === 'genome-reference') return 'sequence'
  return 'unsupported'
}

export function isBiologyRoomTrack(asset: BiologyRoomAsset): boolean {
  return resolveBiologyRoomViewerKind(asset) === 'genome'
}

export function isBiologyRoomReference(asset: BiologyRoomAsset): boolean {
  return asset.modality === 'genome-reference' || REFERENCE_FORMATS.has(normalizeFormat(asset.format || asset.path))
}

export function resolveBiologyRoomReference(
  room: BiologyRoomManifest,
  track: BiologyRoomAsset | null | undefined
): BiologyRoomAsset | null {
  if (!track || !isBiologyRoomTrack(track)) return null
  if (!track.referenceAssetId) return null
  const linked = room.assets.find((asset) => asset.id === track.referenceAssetId)
  return linked && isBiologyRoomReference(linked) ? linked : null
}

export function biologyRoomNeedsReference(
  room: BiologyRoomManifest,
  asset: BiologyRoomAsset | null | undefined
): boolean {
  return Boolean(asset && isBiologyRoomTrack(asset) && !resolveBiologyRoomReference(room, asset))
}

export function isBiologyRoomTrackVisible(
  room: BiologyRoomManifest,
  assetId: string
): boolean {
  return room.viewerStates.genome?.trackVisibility[assetId] !== false
}

export function biologyRoomAssetBlockingIssue(
  asset: BiologyRoomAsset | null | undefined
): string | null {
  if (!asset) return null
  if (asset.readiness === 'missing') {
    return asset.readinessError || `The source file ${asset.path} is missing.`
  }
  if (asset.readiness === 'error') {
    return asset.readinessError || `The source file or one of its indexes could not be read.`
  }
  if (asset.referenceCompatibility?.status === 'incompatible') {
    return asset.referenceCompatibility.reason || 'This track has no contigs in common with its reference FASTA.'
  }
  return null
}

export function biologyRoomAssetWarning(
  asset: BiologyRoomAsset | null | undefined
): string | null {
  if (!asset || biologyRoomAssetBlockingIssue(asset)) return null
  const compatibility = asset.referenceCompatibility
  if (!compatibility || compatibility.status === 'compatible') return null
  if (compatibility.status === 'partial') {
    const unmatched = compatibility.unmatchedContigCount
    const examples = compatibility.unmatchedExamples.length
      ? ` Examples: ${compatibility.unmatchedExamples.join(', ')}.`
      : ''
    return compatibility.reason || `Only part of this track matches the reference FASTA${unmatched === undefined ? '' : `; ${unmatched} contig${unmatched === 1 ? '' : 's'} did not match`}.${examples}`
  }
  return compatibility.reason || 'SciForge could not verify this track against its reference FASTA.'
}

export function describeBiologyRoomAsset(asset: BiologyRoomAsset): string {
  const format = normalizeFormat(asset.format || asset.path).toUpperCase() || 'FILE'
  const size = formatByteCount(asset.sizeBytes)
  return [format, size].filter(Boolean).join(' · ')
}

export function describeBiologyRoomSelection(
  selection: BiologyRoomSelection | null | undefined,
  room?: BiologyRoomManifest
): string {
  if (!selection) return 'Nothing selected'
  const asset = room ? room.assets.find((item) => item.id === selection.assetId) ?? null : null
  const assetLabel = asset ? basename(asset.path) : null

  if (selection.kind === 'sequence') {
    const firstRange = selection.ranges[0]
    const coordinate = firstRange
      ? `${selection.sequenceId ? `${selection.sequenceId}:` : ''}${firstRange.start + 1}–${firstRange.end}`
      : null
    const suffix = selection.ranges.length > 1 ? `+${selection.ranges.length - 1} ranges` : null
    return compactStrings([assetLabel, 'Sequence', coordinate, suffix]).join(' · ')
  }

  if (selection.kind === 'genomic') {
    const feature = selection.featureId || selection.variantId
    return compactStrings([
      assetLabel,
      'Genomic',
      `${selection.refName}:${selection.start + 1}–${selection.end}`,
      feature
    ]).join(' · ')
  }

  if (selection.kind === 'molecular') {
    const first = selection.locators[0]
    return compactStrings([
      assetLabel,
      'Molecular',
      first?.chainId ? `chain ${first.chainId}` : null,
      first?.residueNumber !== undefined ? `residue ${first.residueNumber}${first.insertionCode ?? ''}` : null,
      first?.atomName ? `atom ${first.atomName}` : null,
      selection.locators.length > 1 ? `+${selection.locators.length - 1} locators` : null
    ]).join(' · ')
  }

  return compactStrings([assetLabel, 'Selection']).join(' · ')
}

export function describeBiologyAnnotation(
  annotation: BiologyAnnotation,
  room?: BiologyRoomManifest
): string {
  return describeBiologyRoomSelection(annotation.anchor, room)
}

export function buildBiologyRoomSelectionChatContext(room: BiologyRoomManifest): string | null {
  if (!room.selection) return null
  const asset = room.assets.find((candidate) => candidate.id === room.selection?.assetId) ?? null
  const selection = describeBiologyRoomSelection(room.selection, room)
  const anchoredAnnotations = room.annotations
    .filter((annotation) => !annotation.orphaned && sameBiologySelection(annotation.anchor, room.selection!))
    .slice(0, 5)
  const lines = [
    `Biology Room: ${room.title}`,
    `Room ID: ${room.roomId}`,
    asset ? `File: ${asset.path}` : null,
    asset ? `Source SHA-256: ${asset.sha256}` : null,
    `Selection: ${selection}`,
    `Selection data (zero-based, half-open JSON): ${JSON.stringify(room.selection)}`,
    ...anchoredAnnotations.map((annotation, index) =>
      `Annotation ${index + 1} (${annotation.actor.kind}): ${annotation.body.slice(0, 1_000)}`
    ),
    `Room revision: ${room.revision}`
  ]
  return compactStrings(lines).join('\n')
}

function sameBiologySelection(a: BiologyRoomSelection, b: BiologyRoomSelection): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export function formatBiologyRoomTimestamp(value: string): string {
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) return value
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(parsed)
}

function normalizeFormat(value: string): string {
  const lower = value.trim().toLowerCase()
  const base = lower.split(/[\\/]/).pop() ?? lower
  const parts = base.split('.')
  if (parts.length > 2 && (parts.at(-1) === 'gz' || parts.at(-1) === 'bgz')) {
    return parts.at(-2) ?? ''
  }
  return parts.length > 1 ? parts.at(-1) ?? '' : lower.replace(/^\./, '')
}

function formatByteCount(value: number): string {
  if (!Number.isFinite(value) || value < 0) return ''
  if (value < 1024) return `${Math.round(value)} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KiB`
  return `${(value / (1024 * 1024)).toFixed(value < 10 * 1024 * 1024 ? 1 : 0)} MiB`
}

function basename(value: string): string {
  return value.replaceAll('\\', '/').split('/').filter(Boolean).at(-1) ?? value
}

function compactStrings(values: Array<string | null | undefined>): string[] {
  return values.filter((value): value is string => Boolean(value))
}
