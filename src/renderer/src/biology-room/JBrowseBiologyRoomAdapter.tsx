import {
  useEffect,
  useMemo,
  useRef,
  type ReactElement
} from 'react'
import { AlertTriangle, Info } from 'lucide-react'
import { reaction } from 'mobx'
import {
  createViewState,
  JBrowseLinearGenomeView
} from '@jbrowse/react-linear-genome-view2'
import type {
  BiologyGenomeViewState,
  BiologyRoomManifest,
  BiologyRoomSelection
} from '@shared/biology-room'
import type { BiologyRoomViewerAdapterProps } from './BiologyRoomViewerOutlet'
import type { BiologyRoomAssetSources } from './asset-sources'
import { buildJBrowseLocalViewConfig } from './jbrowse-config'
import { resolveBiologyRoomReference } from './model'

export function JBrowseBiologyRoomAdapter({
  room,
  asset,
  assetSources,
  onApply
}: BiologyRoomViewerAdapterProps): ReactElement {
  const onApplyRef = useRef(onApply)
  const genomeStateRef = useRef(room.viewerStates.genome)
  const viewportTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const locallySubmittedViewportSignaturesRef = useRef(new Set<string>())
  const suppressSelectionReactionRef = useRef(false)
  onApplyRef.current = onApply
  genomeStateRef.current = room.viewerStates.genome

  useEffect(() => () => {
    if (viewportTimerRef.current) clearTimeout(viewportTimerRef.current)
  }, [])

  const configSnapshotJson = JSON.stringify({
    room: jBrowseConfigRoomSnapshot(room),
    activeTrackId: asset.id,
    assetSources: assetSources ?? {}
  })
  const configSnapshot = useMemo(
    () => JSON.parse(configSnapshotJson) as JBrowseConfigSnapshot,
    [configSnapshotJson]
  )
  const snapshotTrack = configSnapshot.room.assets.find((candidate) =>
    candidate.id === configSnapshot.activeTrackId
  )
  const built = useMemo(() => snapshotTrack
    ? buildJBrowseLocalViewConfig({
        room: configSnapshot.room,
        activeTrack: snapshotTrack,
        assetSources: configSnapshot.assetSources
      })
    : { ok: false as const, reason: 'The active genome track is unavailable.' }, [configSnapshot, snapshotTrack])
  const reference = snapshotTrack
    ? resolveBiologyRoomReference(configSnapshot.room, snapshotTrack)
    : null
  const viewState = useMemo(() => {
    if (!built.ok || !reference) return null
    let createdState: ReturnType<typeof createViewState> | null = null
    const scheduleViewport = (): void => {
      if (viewportTimerRef.current) clearTimeout(viewportTimerRef.current)
      viewportTimerRef.current = setTimeout(() => {
        viewportTimerRef.current = null
        if (!createdState) return
        const viewport = biologyGenomeViewportFromJBrowseState({
          view: createdState.session.view,
          referenceAssetId: reference.id,
          trackVisibility: genomeStateRef.current?.referenceAssetId === reference.id
            ? genomeStateRef.current.trackVisibility
            : {},
          trackAssetIds: built.config.trackAssetIds
        })
        if (!viewport || sameGenomeViewport(viewport, genomeStateRef.current)) return
        const signature = JSON.stringify(viewport)
        const localSignatures = locallySubmittedViewportSignaturesRef.current
        localSignatures.add(signature)
        while (localSignatures.size > 32) {
          const oldest = localSignatures.values().next().value
          if (typeof oldest !== 'string') break
          localSignatures.delete(oldest)
        }
        const result = onApplyRef.current?.({
          type: 'setViewport',
          viewport: { kind: 'genome', state: viewport }
        })
        void Promise.resolve(result).then((success) => {
          if (success === false) localSignatures.delete(signature)
        })
      }, 350)
    }
    createdState = createViewState({
      assembly: built.config.assembly,
      tracks: built.config.tracks,
      defaultSession: built.config.defaultSession,
      location: built.config.location,
      highlight: built.config.highlight,
      plugins: [],
      internetAccounts: [],
      aggregateTextSearchAdapters: [],
      disableAddTracks: true,
      onChange: (patch) => {
        if (isJBrowseViewportPatch(patch)) scheduleViewport()
      }
    })
    return createdState
  }, [built, reference])

  useEffect(() => {
    if (!viewState || !built.ok || !reference) return
    const desired = room.viewerStates.genome
    if (!desired || desired.referenceAssetId !== reference.id || !desired.refName) return
    const signature = JSON.stringify(desired)
    if (locallySubmittedViewportSignaturesRef.current.delete(signature)) return
    const current = biologyGenomeViewportFromJBrowseState({
      view: viewState.session.view,
      referenceAssetId: reference.id,
      trackVisibility: desired.trackVisibility,
      trackAssetIds: built.config.trackAssetIds
    })
    if (sameGenomeLocation(desired, current)) return
    const assemblyName = String(built.config.assembly.name ?? '')
    const location = desired.start !== undefined && desired.end !== undefined
      ? `${desired.refName}:${desired.start + 1}..${desired.end}`
      : desired.refName
    void viewState.session.view.navToLocString(location, assemblyName || undefined)
  }, [built, reference, room.viewerStates.genome, viewState])

  useEffect(() => {
    if (!viewState || !reference) return
    const selection = room.selection?.kind === 'genomic' && room.selection.referenceAssetId === reference.id
      ? room.selection
      : null
    const nextHighlight = selection
      ? [{
          refName: selection.refName,
          start: selection.start,
          end: selection.end,
          assemblyName: String(built.ok ? built.config.assembly.name ?? '' : '') || undefined
        }]
      : []
    const currentHighlight = Array.from(viewState.session.view.highlight as unknown as Array<{
      refName: string
      start: number
      end: number
      assemblyName?: string
    }>).map((highlight) => ({
      refName: highlight.refName,
      start: highlight.start,
      end: highlight.end,
      ...(highlight.assemblyName ? { assemblyName: highlight.assemblyName } : {})
    }))
    if (JSON.stringify(currentHighlight) !== JSON.stringify(nextHighlight)) {
      viewState.session.view.setHighlight(nextHighlight)
    }
    const volatileSelection = biologySelectionFromJBrowseSessionSelection({
      selectedFeature: viewState.session.selection,
      fallbackAssetId: asset.id,
      referenceAssetId: reference.id,
      trackAssetIds: built.ok ? built.config.trackAssetIds : {},
      variantAssetIds: configSnapshot.room.assets
        .filter((candidate) => candidate.format === 'vcf')
        .map((candidate) => candidate.id)
    })
    if (viewState.session.selection != null && JSON.stringify(volatileSelection) !== JSON.stringify(selection)) {
      suppressSelectionReactionRef.current = true
      viewState.session.clearSelection()
      queueMicrotask(() => {
        suppressSelectionReactionRef.current = false
      })
    }
  }, [asset.id, built, configSnapshot.room.assets, reference, room.selection, viewState])

  useEffect(() => {
    if (!viewState || !built.ok || !reference) return undefined
    return reaction(
      () => viewState.session.selection,
      (selectedFeature) => {
        if (suppressSelectionReactionRef.current) return
        const selection = biologySelectionFromJBrowseSessionSelection({
          selectedFeature,
          fallbackAssetId: asset.id,
          referenceAssetId: reference.id,
          trackAssetIds: built.config.trackAssetIds,
          variantAssetIds: configSnapshot.room.assets
            .filter((candidate) => candidate.format === 'vcf')
            .map((candidate) => candidate.id)
        })
        if (selection) {
          void onApplyRef.current?.({ type: 'setSelection', selection })
        } else if (selectedFeature == null) {
          void onApplyRef.current?.({ type: 'setSelection', selection: null })
        }
      }
    )
  }, [asset.id, built, configSnapshot.room.assets, reference, viewState])

  if (!built.ok || !viewState) {
    return (
      <div
        className="flex h-full min-h-[18rem] flex-col items-center justify-center bg-ds-canvas px-8 text-center"
        role="alert"
        data-jbrowse-adapter-state="error"
      >
        <AlertTriangle className="h-6 w-6 text-amber-500" strokeWidth={1.8} />
        <h3 className="mt-3 text-[13px] font-semibold text-ds-ink">Genome viewer unavailable</h3>
        <p className="mt-1 max-w-md text-[12px] leading-5 text-ds-muted">
          {built.ok ? 'Reference assembly is unavailable.' : built.reason}
        </p>
      </div>
    )
  }

  return (
    <section
      className="flex h-full min-h-0 flex-col overflow-hidden bg-white text-black"
      data-jbrowse-biology-room-adapter
      data-local-only="true"
    >
      {built.config.warnings.length ? (
        <div className="flex shrink-0 items-start gap-2 border-b border-amber-300 bg-amber-50 px-3 py-2 text-[11px] leading-4 text-amber-900">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{built.config.warnings.join(' ')}</span>
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto" data-jbrowse-linear-genome-view>
        <JBrowseLinearGenomeView viewState={viewState} />
      </div>
    </section>
  )
}

export function biologySelectionFromJBrowsePatch(input: {
  patch: unknown
  assetId: string
  referenceAssetId: string
  trackAssetIds?: Readonly<Record<string, string>>
}): Extract<BiologyRoomSelection, { kind: 'genomic' }> | null {
  const patch = asRecord(input.patch)
  const path = typeof patch.path === 'string'
    ? patch.path
    : Array.isArray(patch.path)
      ? patch.path.join('/')
      : ''
  if (!/featureSelection|selectedFeature/i.test(path)) return null
  const feature = findFeatureLocation(patch.value)
  if (!feature) return null
  const selectedAssetId = findTrackAssetId(patch.value, path, input.trackAssetIds) ?? input.assetId
  return {
    kind: 'genomic',
    assetId: selectedAssetId,
    referenceAssetId: input.referenceAssetId,
    refName: feature.refName,
    start: feature.start,
    end: feature.end,
    ...(feature.id ? { featureId: feature.id } : {})
  }
}

export function biologySelectionFromJBrowseSessionSelection(input: {
  selectedFeature: unknown
  fallbackAssetId: string
  referenceAssetId: string
  trackAssetIds?: Readonly<Record<string, string>>
  variantAssetIds?: readonly string[]
}): Extract<BiologyRoomSelection, { kind: 'genomic' }> | null {
  const feature = input.selectedFeature
  if (!feature || typeof feature !== 'object') return null
  const refName = featureString(feature, 'refName') ?? featureString(feature, 'seq_id')
  const start = featureInteger(feature, 'start')
  const end = featureInteger(feature, 'end')
  if (!refName || start === null || end === null || start < 0 || end <= start) return null
  const featureIdentity = featureId(feature)
  const domainIdentity = featureDomainId(feature) ?? featureIdentity
  const serialized = featureRecord(feature)
  const assetId = findTrackAssetId(
    serialized,
    featureIdentity ?? '',
    input.trackAssetIds
  ) ?? input.fallbackAssetId
  const strandValue = featureInteger(feature, 'strand')
  const isVariant = input.variantAssetIds?.includes(assetId) === true
  return {
    kind: 'genomic',
    assetId,
    referenceAssetId: input.referenceAssetId,
    refName,
    start,
    end,
    ...(strandValue === 1 ? { strand: '+' as const } : strandValue === -1 ? { strand: '-' as const } : {}),
    ...(domainIdentity
      ? isVariant ? { variantId: domainIdentity } : { featureId: domainIdentity }
      : {})
  }
}

export function biologyGenomeViewportFromJBrowseState(input: {
  view: unknown
  referenceAssetId: string
  trackVisibility: Record<string, boolean>
  trackAssetIds?: Readonly<Record<string, string>>
}): BiologyGenomeViewState | null {
  const view = asRecord(input.view)
  const visibleRegions = Array.isArray(view.visibleRegions)
    ? view.visibleRegions.map(asRecord).filter((region) =>
        stringValue(region.refName) && finiteInteger(region.start) !== null && finiteInteger(region.end) !== null
      )
    : []
  const first = visibleRegions[0]
  if (!first) return null
  const refName = stringValue(first.refName)
  if (!refName) return null
  const sameReference = visibleRegions.filter((region) => stringValue(region.refName) === refName)
  const start = Math.max(0, Math.min(...sameReference.map((region) => finiteInteger(region.start) as number)))
  const end = Math.max(...sameReference.map((region) => finiteInteger(region.end) as number))
  if (end <= start) return null
  const bpPerPx = finitePositiveNumber(view.bpPerPx) ?? finitePositiveNumber(view.effectiveBpPerPx)
  const trackVisibility = { ...input.trackVisibility }
  if (input.trackAssetIds) {
    const controlledAssetIds = new Set(Object.values(input.trackAssetIds))
    for (const assetId of controlledAssetIds) trackVisibility[assetId] = false
    const visibleTracks = Array.isArray(view.tracks) ? view.tracks.map(asRecord) : []
    for (const track of visibleTracks) {
      const configuration = track.configuration
      const trackId = typeof configuration === 'string'
        ? configuration
        : stringValue(asRecord(configuration).trackId)
      const assetId = trackId ? input.trackAssetIds[trackId] : undefined
      if (assetId) trackVisibility[assetId] = true
    }
  }
  return {
    referenceAssetId: input.referenceAssetId,
    refName,
    start,
    end,
    ...(bpPerPx ? { bpPerPx } : {}),
    trackVisibility
  }
}

type JBrowseConfigSnapshot = {
  room: BiologyRoomManifest
  activeTrackId: string
  assetSources: BiologyRoomAssetSources
}

function jBrowseConfigRoomSnapshot(room: BiologyRoomManifest): BiologyRoomManifest {
  const genome = room.viewerStates.genome
  return {
    ...room,
    revision: 1,
    selection: undefined,
    viewerStates: genome ? {
      genome: {
        referenceAssetId: genome.referenceAssetId,
        trackVisibility: genome.trackVisibility
      }
    } : {},
    annotations: [],
    updatedAt: room.createdAt
  }
}

function sameGenomeViewport(
  next: BiologyGenomeViewState,
  current: BiologyGenomeViewState | undefined
): boolean {
  return Boolean(current && JSON.stringify(next) === JSON.stringify(current))
}

function sameGenomeLocation(
  desired: BiologyGenomeViewState,
  current: BiologyGenomeViewState | null
): boolean {
  if (!current || desired.referenceAssetId !== current.referenceAssetId) return false
  if (desired.refName && desired.refName !== current.refName) return false
  if (desired.start !== undefined && desired.start !== current.start) return false
  if (desired.end !== undefined && desired.end !== current.end) return false
  if (desired.bpPerPx !== undefined) {
    if (current.bpPerPx === undefined) return false
    const scale = Math.max(1, desired.bpPerPx, current.bpPerPx)
    if (Math.abs(desired.bpPerPx - current.bpPerPx) / scale > 0.001) return false
  }
  return true
}

function isJBrowseViewportPatch(value: unknown): boolean {
  const patch = asRecord(value)
  const path = typeof patch.path === 'string'
    ? patch.path
    : Array.isArray(patch.path)
      ? patch.path.join('/')
      : ''
  return /(?:^|\/)(?:offsetPx|bpPerPx|displayedRegions|tracks)(?:\/|$)/.test(path)
}

function findTrackAssetId(
  value: unknown,
  patchPath: string,
  trackAssetIds: Readonly<Record<string, string>> | undefined
): string | null {
  if (!trackAssetIds || !Object.keys(trackAssetIds).length) return null
  for (const [trackId, assetId] of Object.entries(trackAssetIds)) {
    if (patchPath.includes(trackId)) return assetId
  }
  const queue: unknown[] = [value]
  const visited = new Set<object>()
  while (queue.length) {
    const current = queue.shift()
    if (typeof current === 'string') {
      if (trackAssetIds[current]) return trackAssetIds[current]
      const matched = Object.entries(trackAssetIds).find(([trackId]) => current.includes(trackId))
      if (matched) return matched[1]
    }
    if (!current || typeof current !== 'object' || visited.has(current)) continue
    visited.add(current)
    for (const nested of Object.values(asRecord(current))) queue.push(nested)
  }
  return null
}

function featureRecord(feature: unknown): Record<string, unknown> {
  const record = asRecord(feature)
  if (typeof record.toJSON === 'function') {
    try {
      return asRecord(record.toJSON())
    } catch {
      return record
    }
  }
  return record
}

function featureValue(feature: unknown, key: string): unknown {
  const record = asRecord(feature)
  if (typeof record.get === 'function') {
    try {
      return record.get(key)
    } catch {
      return undefined
    }
  }
  return record[key]
}

function featureString(feature: unknown, key: string): string | null {
  return stringValue(featureValue(feature, key))
}

function featureInteger(feature: unknown, key: string): number | null {
  return finiteInteger(featureValue(feature, key))
}

function featureId(feature: unknown): string | null {
  const record = asRecord(feature)
  if (typeof record.id === 'function') {
    try {
      return stringValue(record.id())
    } catch {
      return null
    }
  }
  return stringValue(record.uniqueId) ?? stringValue(record.id)
}

function featureDomainId(feature: unknown): string | null {
  for (const key of ['ID', 'id', 'Name', 'name']) {
    const value = featureValue(feature, key)
    if (Array.isArray(value)) {
      const first = value.map(stringValue).find(Boolean)
      if (first) return first
    }
    const scalar = stringValue(value)
    if (scalar) return scalar
  }
  return null
}

function findFeatureLocation(value: unknown): {
  refName: string
  start: number
  end: number
  id?: string
} | null {
  const queue: unknown[] = [value]
  const visited = new Set<object>()
  while (queue.length) {
    const current = queue.shift()
    if (!current || typeof current !== 'object') continue
    if (visited.has(current)) continue
    visited.add(current)
    const record = asRecord(current)
    const refName = stringValue(record.refName) ?? stringValue(record.seq_id)
    const start = finiteInteger(record.start)
    const end = finiteInteger(record.end)
    if (refName && start !== null && end !== null && start >= 0 && end > start) {
      return {
        refName,
        start,
        end,
        ...(stringValue(record.id) ? { id: stringValue(record.id) as string } : {})
      }
    }
    for (const nested of Object.values(record)) {
      if (nested && typeof nested === 'object') queue.push(nested)
    }
  }
  return null
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function finiteInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null
}

function finitePositiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}
