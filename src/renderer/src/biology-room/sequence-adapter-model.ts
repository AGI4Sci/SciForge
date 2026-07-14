import { parseFile, type Seq } from 'seqparse'
import type { SeqVizProps } from 'seqviz'
import type {
  BiologyRoomAsset,
  BiologyRoomManifest,
  BiologyRoomSelection
} from '@shared/biology-room'

export type BiologySequenceRecord = Seq

export function parseBiologySequenceText(
  source: string,
  asset: Pick<BiologyRoomAsset, 'path'>
): BiologySequenceRecord[] {
  const records = parseFile(source, { fileName: asset.path })
  if (!records.length) throw new Error(`No sequence records were found in ${asset.path}.`)
  return records
}

export function initialBiologySequenceRecordIndex(
  records: readonly BiologySequenceRecord[],
  selection: BiologyRoomSelection | null | undefined,
  assetId: string,
  preferredSequenceId?: string
): number {
  const sequenceId = selection?.kind === 'sequence' && selection.assetId === assetId
    ? selection.sequenceId ?? preferredSequenceId
    : preferredSequenceId
  if (!sequenceId) return 0
  const index = records.findIndex((record) => record.name === sequenceId)
  return index >= 0 ? index : 0
}

export function buildSeqVizProps(input: {
  room: BiologyRoomManifest
  asset: BiologyRoomAsset
  record: BiologySequenceRecord
  viewer?: 'linear' | 'circular'
  onSelection?: SeqVizProps['onSelection']
}): SeqVizProps {
  const { room, asset, record } = input
  const sequenceState = room.viewerStates.sequence?.assetId === asset.id
    ? room.viewerStates.sequence
    : undefined
  const roomAnnotations = room.annotations
    .flatMap((annotation) => annotation.anchor.kind === 'sequence' &&
      annotation.anchor.assetId === asset.id &&
      (!annotation.anchor.sequenceId || annotation.anchor.sequenceId === record.name)
      ? annotation.anchor.ranges.map((range) => ({
          name: annotation.body.slice(0, 120),
          start: range.start,
          end: range.end,
          direction: range.strand === '-' ? -1 : range.strand === '+' ? 1 : 0,
          color: annotation.color
        }))
      : [])
  const selectedRanges = room.selection?.kind === 'sequence' && room.selection.assetId === asset.id &&
    (!room.selection.sequenceId || room.selection.sequenceId === record.name)
    ? room.selection.ranges
    : undefined
  const selection = seqVizSelectionFromBiologyRanges(selectedRanges, record.seq.length)
  const supplementalHighlights = selectedRanges && selectedRanges.length > 1 && !isCircularWrapRange(selectedRanges, record.seq.length)
    ? selectedRanges.slice(1).map((range) => ({ start: range.start, end: range.end, color: '#10b981' }))
    : []
  const showTranslations = sequenceState?.showTranslations === true

  return {
    name: record.name,
    seq: record.seq,
    ...(record.type !== 'unknown' ? { seqType: record.type } : {}),
    annotations: [
      ...record.annotations.map((annotation) => ({
        name: annotation.name,
        start: annotation.start,
        end: annotation.end,
        direction: annotation.direction,
        color: annotation.color
      })),
      ...roomAnnotations
    ],
    primers: [],
    viewer: input.viewer ?? sequenceState?.mode ?? 'linear',
    disableExternalFonts: true,
    showIndex: true,
    showComplement: record.type !== 'aa',
    rotateOnScroll: false,
    zoom: { linear: Math.max(1, Math.min(100, Math.round(sequenceState?.zoom ?? 50))) },
    ...(selection ? { selection } : {}),
    ...(supplementalHighlights.length ? { highlights: supplementalHighlights } : {}),
    ...(showTranslations
      ? {
          translations: record.annotations
            .filter((annotation) => annotation.type?.toLowerCase() === 'cds')
            .map((annotation) => ({
              name: annotation.name,
              start: annotation.start,
              end: annotation.end,
              direction: annotation.direction === -1 ? -1 : 1
            }))
        }
      : {}),
    onSelection: input.onSelection,
    style: { height: '100%', width: '100%' }
  }
}

export function seqVizSelectionFromBiologyRanges(
  ranges: readonly { start: number; end: number }[] | null | undefined,
  sequenceLength: number
): NonNullable<SeqVizProps['selection']> | undefined {
  if (!ranges?.length || sequenceLength <= 0) return undefined
  const wrap = isCircularWrapRange(ranges, sequenceLength)
  if (wrap) return { start: wrap.tail.start, end: wrap.head.end, clockwise: true }
  const first = ranges[0]
  return first ? { start: first.start, end: first.end } : undefined
}

function isCircularWrapRange(
  ranges: readonly { start: number; end: number }[],
  sequenceLength: number
): { tail: { start: number; end: number }; head: { start: number; end: number } } | null {
  if (ranges.length !== 2) return null
  const tail = ranges.find((range) => range.start > 0 && range.end === sequenceLength)
  const head = ranges.find((range) => range.start === 0 && range.end > 0 && range.end < sequenceLength)
  return tail && head ? { tail, head } : null
}

export function biologySequenceSelectionFromSeqViz(input: {
  assetId: string
  sequenceId?: string
  sequenceLength: number
  start?: number
  end?: number
  clockwise?: boolean
}): Extract<BiologyRoomSelection, { kind: 'sequence' }> | null {
  if (input.start === undefined || input.end === undefined || input.sequenceLength <= 0) return null
  const start = clampCoordinate(input.start, input.sequenceLength)
  const end = clampCoordinate(input.end, input.sequenceLength)
  if (start === end) return null

  const ranges = start < end || input.clockwise === false
    ? [{ start: Math.min(start, end), end: Math.max(start, end) }]
    : [
        { start, end: input.sequenceLength },
        ...(end > 0 ? [{ start: 0, end }] : [])
      ]
  return {
    kind: 'sequence',
    assetId: input.assetId,
    ...(input.sequenceId ? { sequenceId: input.sequenceId } : {}),
    ranges
  }
}

function clampCoordinate(value: number, sequenceLength: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(sequenceLength, Math.round(value)))
}
