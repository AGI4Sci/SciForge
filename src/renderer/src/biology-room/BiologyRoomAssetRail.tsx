import type { ReactElement } from 'react'
import {
  AlertTriangle,
  Atom,
  Dna,
  Eye,
  EyeOff,
  FileJson2,
  Layers3,
  Plus,
  Trash2
} from 'lucide-react'
import type {
  BiologyRoomAsset,
  BiologyRoomManifest,
  BiologyRoomMutationOperation
} from '@shared/biology-room'
import type { BioGymRunSnapshot } from '@shared/biogym'
import {
  biologyRoomAssetBlockingIssue,
  biologyRoomAssetWarning,
  describeBiologyRoomAsset,
  isBiologyRoomTrack,
  isBiologyRoomTrackVisible,
  resolveActiveBiologyRoomAsset
} from './model'
import { groupBioGymAssets } from './biogym-run-ui'

export type BiologyRoomAssetRailProps = {
  room: BiologyRoomManifest
  busy?: boolean
  onApply?: (operation: BiologyRoomMutationOperation) => Promise<boolean | void> | boolean | void
  onRequestAddAsset?: () => void
  runSnapshot?: BioGymRunSnapshot | null
}

export function BiologyRoomAssetRail({
  room,
  busy = false,
  onApply,
  onRequestAddAsset,
  runSnapshot
}: BiologyRoomAssetRailProps): ReactElement {
  const activeAsset = resolveActiveBiologyRoomAsset(room)
  const assetGroups = groupBioGymAssets(room, runSnapshot)

  return (
    <aside
      className="biology-room-assets flex min-h-0 flex-col border-r border-ds-border bg-ds-sidebar"
      aria-label="Biology Room assets and tracks"
      data-biology-room-assets
    >
      <div className="flex shrink-0 items-center justify-between border-b border-ds-border px-3 py-2.5">
        <div>
          <h2 className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-ds-muted">Assets</h2>
          <p className="mt-0.5 text-[10.5px] text-ds-faint">{room.assets.length} in room</p>
        </div>
        <button
          type="button"
          onClick={onRequestAddAsset}
          disabled={!onRequestAddAsset || busy}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-40"
          title="Add biology asset"
          aria-label="Add biology asset"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.8} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {room.assets.length ? (
          <div className="space-y-3" aria-label="Biology assets">
            {assetGroups.map((group) => (
              <section key={group.id} data-biogym-stage-group={group.stage?.id}>
                {assetGroups.length > 1 || group.stage ? (
                  <div className="mb-1 flex items-center justify-between gap-2 px-1.5">
                    <h3 className="truncate text-[9.5px] font-semibold uppercase tracking-[0.08em] text-ds-faint">
                      {group.label}
                    </h3>
                    {group.stage ? (
                      <span className="shrink-0 text-[9px] capitalize text-ds-faint">{group.stage.status}</span>
                    ) : null}
                  </div>
                ) : null}
                <ul className="space-y-1">
                  {group.assets.map((asset) => (
                    <li key={asset.id}>
                      <BiologyRoomAssetRow
                        asset={asset}
                        room={room}
                        active={asset.id === activeAsset?.id}
                        busy={busy}
                        onApply={onApply}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-ds-border px-3 py-5 text-center">
            <Dna className="mx-auto h-5 w-5 text-ds-faint" strokeWidth={1.6} />
            <p className="mt-2 text-[11.5px] leading-4 text-ds-muted">No biology assets yet.</p>
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-ds-border px-3 py-2 text-[10.5px] leading-4 text-ds-faint">
        Source files stay read-only. Room state and annotations are versioned separately.
      </div>
    </aside>
  )
}

function BiologyRoomAssetRow({
  asset,
  room,
  active,
  busy,
  onApply
}: {
  asset: BiologyRoomAsset
  room: BiologyRoomManifest
  active: boolean
  busy: boolean
  onApply?: (operation: BiologyRoomMutationOperation) => Promise<boolean | void> | boolean | void
}): ReactElement {
  const track = isBiologyRoomTrack(asset)
  const visible = isBiologyRoomTrackVisible(room, asset.id)
  const reference = asset.referenceAssetId
    ? room.assets.find((candidate) => candidate.id === asset.referenceAssetId)
    : null
  const blockingIssue = biologyRoomAssetBlockingIssue(asset)
  const warning = biologyRoomAssetWarning(asset)
  const statusLabel = blockingIssue
    ? asset.readiness === 'missing'
      ? 'Missing source'
      : asset.referenceCompatibility?.status === 'incompatible'
        ? 'Contigs incompatible'
        : 'Unavailable'
    : asset.referenceCompatibility?.status === 'partial'
      ? 'Partial contig match'
      : asset.referenceCompatibility?.status === 'unverified'
        ? 'Compatibility unverified'
        : null

  return (
    <div
      className={compactClassName(
        'group rounded-lg border transition',
        active
          ? 'border-emerald-500/35 bg-emerald-500/10 shadow-[inset_3px_0_0_rgba(16,185,129,0.75)]'
          : 'border-transparent hover:border-ds-border hover:bg-ds-hover'
      )}
      data-biology-room-asset-id={asset.id}
      data-active={active ? 'true' : 'false'}
      data-readiness={asset.readiness ?? 'ready'}
      data-reference-compatibility={asset.referenceCompatibility?.status ?? 'none'}
    >
      <button
        type="button"
        onClick={() => onApply?.({ type: 'setActiveAsset', assetId: asset.id })}
        disabled={!onApply || busy}
        className="flex w-full min-w-0 items-start gap-2 px-2.5 pb-1.5 pt-2 text-left disabled:cursor-not-allowed"
        aria-pressed={active}
        title={asset.path}
      >
        <span className={compactClassName(
          'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md',
          active ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300' : 'bg-ds-subtle text-ds-muted'
        )}>
          <AssetIcon asset={asset} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[11.5px] font-medium text-ds-ink">{basename(asset.path)}</span>
          <span className="mt-0.5 block truncate text-[10.5px] text-ds-faint">{describeBiologyRoomAsset(asset)}</span>
          {reference ? (
            <span className="mt-1 block truncate text-[10px] text-ds-muted">ref: {basename(reference.path)}</span>
          ) : null}
          {statusLabel ? (
            <span
              className={compactClassName(
                'mt-1 flex items-center gap-1 text-[10px]',
                blockingIssue ? 'text-red-600 dark:text-red-300' : 'text-amber-700 dark:text-amber-300'
              )}
              title={blockingIssue ?? warning ?? undefined}
            >
              <AlertTriangle className="h-3 w-3 shrink-0" strokeWidth={1.8} />
              <span className="truncate">{statusLabel}</span>
            </span>
          ) : null}
        </span>
      </button>

      <div className="flex items-center justify-end gap-0.5 px-1.5 pb-1.5">
        {track ? (
          <button
            type="button"
            onClick={() => onApply?.({ type: 'setTrackVisibility', trackAssetId: asset.id, visible: !visible })}
            disabled={!onApply || busy}
            className="inline-flex h-6 w-6 items-center justify-center rounded text-ds-faint transition hover:bg-ds-card hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-40"
            title={visible ? 'Hide track' : 'Show track'}
            aria-label={visible ? `Hide ${basename(asset.path)}` : `Show ${basename(asset.path)}`}
            aria-pressed={visible}
          >
            {visible
              ? <Eye className="h-3.5 w-3.5" strokeWidth={1.7} />
              : <EyeOff className="h-3.5 w-3.5" strokeWidth={1.7} />}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => onApply?.({ type: 'removeAsset', assetId: asset.id, cascade: false })}
          disabled={!onApply || busy}
          className="inline-flex h-6 w-6 items-center justify-center rounded text-ds-faint opacity-0 transition hover:bg-red-500/10 hover:text-red-600 group-focus-within:opacity-100 group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:text-red-300"
          title="Remove asset from room"
          aria-label={`Remove ${basename(asset.path)} from room`}
        >
          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.7} />
        </button>
      </div>
    </div>
  )
}

function AssetIcon({ asset }: { asset: BiologyRoomAsset }): ReactElement {
  if (asset.modality === 'structure') return <Atom className="h-3.5 w-3.5" strokeWidth={1.7} />
  if (asset.modality === 'genome-feature' || asset.modality === 'genome-variant') {
    return <Layers3 className="h-3.5 w-3.5" strokeWidth={1.7} />
  }
  if (asset.format === 'genbank') return <FileJson2 className="h-3.5 w-3.5" strokeWidth={1.7} />
  return <Dna className="h-3.5 w-3.5" strokeWidth={1.7} />
}

function basename(value: string): string {
  return value.replaceAll('\\', '/').split('/').filter(Boolean).at(-1) ?? value
}

function compactClassName(...parts: Array<string | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}
