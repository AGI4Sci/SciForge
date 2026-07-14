import {
  BIOLOGY_ROOM_MAX_UNINDEXED_ASSET_BYTES,
  type BiologyRoomAsset,
  type BiologyRoomManifest
} from '@shared/biology-room'
import {
  biologyRoomAssetBlockingIssue,
  biologyRoomAssetWarning,
  isBiologyRoomTrack,
  isBiologyRoomTrackVisible,
  resolveBiologyRoomReference
} from './model'
import {
  resolveBiologyAssetIndexUrl,
  validateBiologyAssetSource,
  type BiologyRoomAssetSources
} from './asset-sources'

export type JBrowseLocalViewConfig = {
  assembly: Record<string, unknown>
  tracks: Array<Record<string, unknown>>
  defaultSession: Record<string, unknown>
  location?: { refName: string; start?: number; end?: number; assemblyName: string }
  highlight?: string[]
  trackAssetIds: Record<string, string>
  warnings: string[]
}

export type JBrowseLocalViewConfigResult =
  | { ok: true; config: JBrowseLocalViewConfig }
  | { ok: false; reason: string }

export function buildJBrowseLocalViewConfig(input: {
  room: BiologyRoomManifest
  activeTrack: BiologyRoomAsset
  assetSources: BiologyRoomAssetSources
}): JBrowseLocalViewConfigResult {
  const { room, activeTrack, assetSources } = input
  if (!isBiologyRoomTrack(activeTrack)) return { ok: false, reason: 'The active asset is not a genome track.' }
  const reference = resolveBiologyRoomReference(room, activeTrack)
  if (!reference) return { ok: false, reason: 'Select a reference FASTA before opening genome tracks.' }
  const referenceIssue = biologyRoomAssetBlockingIssue(reference)
  if (referenceIssue) return { ok: false, reason: `Reference FASTA unavailable: ${referenceIssue}` }
  const referenceSource = assetSources[reference.id]
  const referenceValidation = validateBiologyAssetSource(referenceSource)
  if (!referenceSource || !referenceValidation.ok) {
    return { ok: false, reason: referenceValidation.ok ? 'Reference FASTA source is unavailable.' : referenceValidation.reason }
  }
  const referenceAdapter = buildReferenceAdapter(reference, referenceSource)
  if (!referenceAdapter.ok) return referenceAdapter

  const assemblyName = safeJBrowseId(`biology-${room.roomId}-${reference.id}`)
  const referenceTrackId = safeJBrowseId(`${reference.id}-reference`)
  const warnings: string[] = []
  const trackConfigs: Array<{
    asset: BiologyRoomAsset
    track: Record<string, unknown>
    displayType: 'LinearBasicDisplay' | 'LinearVariantDisplay'
  }> = []

  const tracks = room.assets.filter((asset) =>
    isBiologyRoomTrack(asset) &&
    (asset.id === activeTrack.id || isBiologyRoomTrackVisible(room, asset.id)) &&
    (
      asset.referenceAssetId === reference.id ||
      (!asset.referenceAssetId && reference.id === resolveBiologyRoomReference(room, asset)?.id)
    )
  )
  for (const asset of tracks) {
    const blockingIssue = biologyRoomAssetBlockingIssue(asset)
    if (blockingIssue) {
      if (asset.id === activeTrack.id) return { ok: false, reason: blockingIssue }
      warnings.push(`Skipped ${asset.path}: ${blockingIssue}`)
      continue
    }
    const compatibilityWarning = biologyRoomAssetWarning(asset)
    if (compatibilityWarning) warnings.push(`${asset.path}: ${compatibilityWarning}`)
    const source = assetSources[asset.id]
    const validation = validateBiologyAssetSource(source)
    if (!source || !validation.ok) {
      if (asset.id === activeTrack.id) {
        return { ok: false, reason: validation.ok ? `Source is unavailable for ${asset.path}.` : validation.reason }
      }
      warnings.push(`Skipped ${asset.path}: ${validation.ok ? 'source unavailable' : validation.reason}`)
      continue
    }
    const adapter = buildTrackAdapter(asset, source)
    if (!adapter.ok) {
      if (asset.id === activeTrack.id) return adapter
      warnings.push(`Skipped ${asset.path}: ${adapter.reason}`)
      continue
    }
    const trackId = safeJBrowseId(`${asset.id}-${asset.format}`)
    const adapterId = safeJBrowseId(`${trackId}-adapter`)
    const variant = asset.format === 'vcf'
    trackConfigs.push({
      asset,
      displayType: variant ? 'LinearVariantDisplay' : 'LinearBasicDisplay',
      track: {
        type: variant ? 'VariantTrack' : 'FeatureTrack',
        trackId,
        name: basename(asset.path),
        assemblyNames: [assemblyName],
        adapter: { adapterId, ...adapter.adapter }
      }
    })
  }

  const viewerState = room.viewerStates.genome?.referenceAssetId === reference.id
    ? room.viewerStates.genome
    : undefined
  const firstContig = reference.contigs?.[0]
  const refName = viewerState?.refName ?? firstContig?.name
  const defaultTracks = [
    sessionTrack(referenceTrackId, 'ReferenceSequenceTrack', 'LinearReferenceSequenceDisplay'),
    ...trackConfigs
      .filter(({ asset }) => asset.id === activeTrack.id || isBiologyRoomTrackVisible(room, asset.id))
      .map(({ track, displayType }) => sessionTrack(String(track.trackId), String(track.type), displayType))
  ]
  const trackAssetIds = Object.fromEntries(trackConfigs.flatMap(({ asset, track }) => {
    const adapter = track.adapter as Record<string, unknown>
    return [
      [String(track.trackId), asset.id],
      [String(adapter.adapterId), asset.id]
    ]
  }))
  const selection = room.selection?.kind === 'genomic' && room.selection.referenceAssetId === reference.id
    ? room.selection
    : undefined

  return {
    ok: true,
    config: {
      assembly: {
        name: assemblyName,
        aliases: [basename(reference.path)],
        sequence: {
          type: 'ReferenceSequenceTrack',
          trackId: referenceTrackId,
          adapter: referenceAdapter.adapter
        }
      },
      tracks: trackConfigs.map(({ track }) => track),
      defaultSession: {
        name: `Biology Room ${room.title}`,
        view: {
          id: safeJBrowseId(`biology-room-view-${room.roomId}`),
          type: 'LinearGenomeView',
          tracks: defaultTracks
        }
      },
      ...(refName
        ? {
            location: {
              refName,
              assemblyName,
              ...(viewerState?.start !== undefined ? { start: viewerState.start } : {}),
              ...(viewerState?.end !== undefined
                ? { end: viewerState.end }
                : firstContig?.length
                  ? { end: Math.min(firstContig.length, 10_000) }
                  : {})
            }
          }
        : {}),
      ...(selection
        ? { highlight: [`${selection.refName}:${selection.start + 1}..${selection.end}`] }
        : {}),
      trackAssetIds,
      warnings
    }
  }
}

function buildReferenceAdapter(
  asset: BiologyRoomAsset,
  source: NonNullable<BiologyRoomAssetSources[string]>
): { ok: true; adapter: Record<string, unknown> } | { ok: false; reason: string } {
  const faiUrl = resolveBiologyAssetIndexUrl(asset, source, '.fai')
  const gziUrl = resolveBiologyAssetIndexUrl(asset, source, '.gzi')
  const compressed = /\.(?:gz|bgz)$/i.test(asset.path)
  if (compressed) {
    if (!faiUrl || !gziUrl) {
      return { ok: false, reason: 'A bgzip FASTA requires host URLs for both .fai and .gzi indexes.' }
    }
    return {
      ok: true,
      adapter: {
        type: 'BgzipFastaAdapter',
        fastaLocation: uriLocation(source.sourceUrl),
        faiLocation: uriLocation(faiUrl),
        gziLocation: uriLocation(gziUrl)
      }
    }
  }
  if (faiUrl) {
    return {
      ok: true,
      adapter: {
        type: 'IndexedFastaAdapter',
        fastaLocation: uriLocation(source.sourceUrl),
        faiLocation: uriLocation(faiUrl)
      }
    }
  }
  if (asset.sizeBytes > BIOLOGY_ROOM_MAX_UNINDEXED_ASSET_BYTES) {
    return { ok: false, reason: 'Reference FASTA exceeds the 25 MiB unindexed limit; provide a .fai index.' }
  }
  return {
    ok: true,
    adapter: {
      type: 'UnindexedFastaAdapter',
      fastaLocation: uriLocation(source.sourceUrl)
    }
  }
}

function buildTrackAdapter(
  asset: BiologyRoomAsset,
  source: NonNullable<BiologyRoomAssetSources[string]>
): { ok: true; adapter: Record<string, unknown> } | { ok: false; reason: string } {
  const tbiUrl = resolveBiologyAssetIndexUrl(asset, source, '.tbi')
  const csiUrl = resolveBiologyAssetIndexUrl(asset, source, '.csi')
  const index = tbiUrl
    ? { url: tbiUrl, type: 'TBI' as const }
    : csiUrl
      ? { url: csiUrl, type: 'CSI' as const }
      : null
  const indexUrl = index?.url
  const indexType = index?.type
  const compressed = /\.(?:gz|bgz)$/i.test(asset.path)
  if (compressed && !indexUrl) {
    return { ok: false, reason: `Compressed ${asset.format.toUpperCase()} requires a .tbi or .csi index.` }
  }
  if (!indexUrl && asset.sizeBytes > BIOLOGY_ROOM_MAX_UNINDEXED_ASSET_BYTES) {
    return { ok: false, reason: `${asset.format.toUpperCase()} exceeds the 25 MiB unindexed limit.` }
  }

  if (asset.format === 'gff3') {
    return indexUrl
      ? {
          ok: true,
          adapter: {
            type: 'Gff3TabixAdapter',
            gffGzLocation: uriLocation(source.sourceUrl),
            index: { indexType, location: uriLocation(indexUrl) }
          }
        }
      : { ok: true, adapter: { type: 'Gff3Adapter', gffLocation: uriLocation(source.sourceUrl) } }
  }
  if (asset.format === 'bed') {
    return indexUrl
      ? {
          ok: true,
          adapter: {
            type: 'BedTabixAdapter',
            bedGzLocation: uriLocation(source.sourceUrl),
            index: { indexType, location: uriLocation(indexUrl) }
          }
        }
      : { ok: true, adapter: { type: 'BedAdapter', bedLocation: uriLocation(source.sourceUrl) } }
  }
  if (asset.format === 'vcf') {
    return indexUrl
      ? {
          ok: true,
          adapter: {
            type: 'VcfTabixAdapter',
            vcfGzLocation: uriLocation(source.sourceUrl),
            index: { indexType, location: uriLocation(indexUrl) }
          }
        }
      : { ok: true, adapter: { type: 'VcfAdapter', vcfLocation: uriLocation(source.sourceUrl) } }
  }
  return { ok: false, reason: `No JBrowse adapter is defined for ${asset.format}.` }
}

function sessionTrack(trackId: string, type: string, displayType: string): Record<string, unknown> {
  return {
    type,
    configuration: trackId,
    displays: [{
      type: displayType,
      configuration: `${trackId}-${displayType}`
    }]
  }
}

function uriLocation(uri: string): Record<string, string> {
  return { uri, locationType: 'UriLocation' }
}

function safeJBrowseId(value: string): string {
  const normalized = value.replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '')
  return normalized || 'biology-room-track'
}

function basename(value: string): string {
  return value.replaceAll('\\', '/').split('/').filter(Boolean).at(-1) ?? value
}
