import {
  lazy,
  Suspense,
  type ComponentType,
  type ReactElement,
  type ReactNode
} from 'react'
import { AlertTriangle, Dna, FileQuestion, Loader2, Plus } from 'lucide-react'
import type {
  BiologyRoomAsset,
  BiologyRoomManifest,
  BiologyRoomMutationOperation,
  BiologyRoomSelection
} from '@shared/biology-room'
import type {
  WorkspaceObservation,
  WorkspacePreviewAssetTransportDescriptor,
  WorkspacePreviewByteRange,
  WorkspaceStructuredSelection
} from '@shared/workspace-preview'
import type { WorkspacePreviewReadRangeResult } from '@shared/sciforge-api'
import {
  MolecularWorkspaceViewer,
  type MolecularWorkspaceViewerProps
} from '../workspace-preview/MolecularWorkspaceViewer'
import {
  SequenceWorkspaceViewer
} from '../workspace-preview/SequenceWorkspaceViewer'
import {
  biologyRoomAssetBlockingIssue,
  biologyRoomAssetWarning,
  biologyRoomNeedsReference,
  resolveActiveBiologyRoomAsset,
  resolveBiologyRoomReference,
  resolveBiologyRoomViewerKind,
  type BiologyRoomViewerKind
} from './model'
import type {
  BiologyRoomAssetSource,
  BiologyRoomAssetSources
} from './asset-sources'

const LazySeqVizBiologyRoomAdapter = lazy(async () => {
  const module = await import('./SeqVizBiologyRoomAdapter')
  return { default: module.SeqVizBiologyRoomAdapter }
})

const LazyJBrowseBiologyRoomAdapter = lazy(async () => {
  const module = await import('./JBrowseBiologyRoomAdapter')
  return { default: module.JBrowseBiologyRoomAdapter }
})

const LazyMolstarBiologyRoomAdapter = lazy(async () => {
  const module = await import('./MolstarBiologyRoomAdapter')
  return { default: module.MolstarBiologyRoomAdapter }
})

export type BiologyRoomViewerPreviewFallback = {
  observation?: WorkspaceObservation | null
  asset?: WorkspacePreviewAssetTransportDescriptor | null
  assetStatus?: MolecularWorkspaceViewerProps['assetStatus']
  assetError?: string | null
  sourceUrl?: string | null
  readRange?: (range: WorkspacePreviewByteRange) => Promise<WorkspacePreviewReadRangeResult>
  molecularWorkbenchRenderer?: MolecularWorkspaceViewerProps['workbenchRenderer']
}

export type BiologyRoomViewerAdapterProps = {
  room: BiologyRoomManifest
  asset: BiologyRoomAsset
  selection: BiologyRoomSelection | null
  source?: BiologyRoomAssetSource
  assetSources?: BiologyRoomAssetSources
  onApply?: (operation: BiologyRoomMutationOperation) => Promise<boolean | void> | boolean | void
}

export type BiologyRoomViewerAdapter = ComponentType<BiologyRoomViewerAdapterProps>

export type BiologyRoomViewerAdapters = Partial<Record<Exclude<BiologyRoomViewerKind, 'unsupported'>, BiologyRoomViewerAdapter>>

export type BiologyRoomViewerOutletProps = {
  room: BiologyRoomManifest
  preview?: BiologyRoomViewerPreviewFallback
  adapters?: BiologyRoomViewerAdapters
  assetSources?: BiologyRoomAssetSources
  className?: string
  onApply?: (operation: BiologyRoomMutationOperation) => Promise<boolean | void> | boolean | void
  onSelectReference?: (track: BiologyRoomAsset) => void
  emptyState?: ReactNode
}

export function BiologyRoomViewerOutlet({
  room,
  preview,
  adapters,
  assetSources,
  className,
  onApply,
  onSelectReference,
  emptyState
}: BiologyRoomViewerOutletProps): ReactElement {
  const activeAsset = resolveActiveBiologyRoomAsset(room)
  const viewerKind = resolveBiologyRoomViewerKind(activeAsset)

  if (!activeAsset) {
    return (
      <ViewerStateFrame className={className} dataState="empty">
        {emptyState ?? (
          <>
            <Dna className="h-7 w-7 text-emerald-500" strokeWidth={1.6} />
            <h3 className="mt-3 text-[14px] font-semibold text-ds-ink">Add a biology file</h3>
            <p className="mt-1 max-w-sm text-center text-[12px] leading-5 text-ds-muted">
              This room supports FASTA, GenBank, PDB/mmCIF, GFF3, BED, and VCF assets.
            </p>
          </>
        )}
      </ViewerStateFrame>
    )
  }

  const activeAssetIssue = biologyRoomAssetBlockingIssue(activeAsset)
  if (activeAssetIssue) {
    return (
      <UnavailableBiologyAssetState
        asset={activeAsset}
        message={activeAssetIssue}
        className={className}
      />
    )
  }

  if (biologyRoomNeedsReference(room, activeAsset)) {
    return (
      <MissingGenomeReferenceState
        asset={activeAsset}
        className={className}
        onSelectReference={onSelectReference}
      />
    )
  }

  const reference = resolveBiologyRoomReference(room, activeAsset)
  const referenceIssue = biologyRoomAssetBlockingIssue(reference)
  if (reference && referenceIssue) {
    return (
      <UnavailableBiologyAssetState
        asset={reference}
        message={referenceIssue}
        className={className}
        reference
      />
    )
  }

  const assetWarning = biologyRoomAssetWarning(activeAsset)

  const source = assetSources?.[activeAsset.id]
  if (!source && preview?.assetStatus === 'error') {
    return (
      <ViewerStateFrame className={className} dataState="transport-error">
        <AlertTriangle className="h-7 w-7 text-red-500" strokeWidth={1.6} />
        <h3 className="mt-3 text-[14px] font-semibold text-ds-ink">Biology viewer transport unavailable</h3>
        <p className="mt-1 max-w-md text-center text-[12px] leading-5 text-ds-muted">
          {preview.assetError || 'SciForge could not establish a read-only preview session for this asset.'}
        </p>
      </ViewerStateFrame>
    )
  }
  if (!source && preview?.assetStatus === 'loading' && !preview.observation) {
    return <BiologyRoomViewerLoadingState />
  }
  const builtInAdapter = source
    ? viewerKind === 'sequence'
      ? LazySeqVizBiologyRoomAdapter
      : viewerKind === 'genome'
        ? LazyJBrowseBiologyRoomAdapter
        : viewerKind === 'molecular'
          ? LazyMolstarBiologyRoomAdapter
          : undefined
    : undefined
  const Adapter = viewerKind === 'unsupported' ? undefined : adapters?.[viewerKind] ?? builtInAdapter
  if (Adapter) {
    return (
      <div
        className={compactClassName('biology-room-viewer-outlet flex h-full min-h-0 flex-col overflow-hidden', className)}
        data-biology-room-viewer-outlet
        data-viewer-kind={viewerKind}
        data-viewer-source="adapter"
      >
        {assetWarning ? <BiologyAssetWarningBanner message={assetWarning} /> : null}
        <div className="min-h-0 flex-1 overflow-hidden">
          <Suspense fallback={<BiologyRoomViewerLoadingState />}>
            <Adapter
              key={`${activeAsset.id}:${activeAsset.sha256}`}
              room={room}
              asset={activeAsset}
              selection={room.selection ?? null}
              source={source}
              assetSources={assetSources}
              onApply={onApply}
            />
          </Suspense>
        </div>
      </div>
    )
  }

  if (viewerKind === 'molecular') {
    return (
      <div
        className={compactClassName('biology-room-viewer-outlet h-full min-h-0 overflow-hidden p-3', className)}
        data-biology-room-viewer-outlet
        data-viewer-kind="molecular"
        data-viewer-source="workspace-preview-fallback"
      >
        <MolecularWorkspaceViewer
          observation={preview?.observation}
          asset={preview?.asset}
          assetStatus={preview?.assetStatus}
          assetError={preview?.assetError}
          sourceUrl={preview?.sourceUrl}
          readRange={preview?.readRange}
          workbenchRenderer={preview?.molecularWorkbenchRenderer}
          onApplyEdit={(operation) => {
            const selection = biologySelectionFromWorkspaceSelection(activeAsset.id, operation.selection)
            if (selection !== undefined) void onApply?.({ type: 'setSelection', selection })
          }}
        />
      </div>
    )
  }

  if (viewerKind === 'sequence' || viewerKind === 'genome') {
    const reference = viewerKind === 'genome' ? resolveBiologyRoomReference(room, activeAsset) : null
    return (
      <div
        className={compactClassName('biology-room-viewer-outlet flex h-full min-h-0 flex-col overflow-hidden', className)}
        data-biology-room-viewer-outlet
        data-viewer-kind={viewerKind}
        data-viewer-source="workspace-preview-fallback"
      >
        <div className="shrink-0 border-b border-ds-border bg-ds-subtle px-3 py-2 text-[11.5px] leading-4 text-ds-muted">
          {viewerKind === 'genome'
            ? `Using the bounded sequence-map fallback for ${activeAsset.format.toUpperCase()}${reference ? ` against ${basename(reference.path)}` : ''}. The JBrowse adapter can be loaded lazily by the host.`
            : 'Using SciForge’s bounded sequence-map fallback. The SeqViz adapter can be loaded lazily by the host.'}
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          <SequenceWorkspaceViewer
            observation={preview?.observation}
            onSetSelection={(operation) => {
              const selection = biologySelectionFromWorkspaceSelection(activeAsset.id, operation.selection)
              if (selection !== undefined) void onApply?.({ type: 'setSelection', selection })
            }}
          />
        </div>
      </div>
    )
  }

  return (
    <ViewerStateFrame className={className} dataState="unsupported">
      <FileQuestion className="h-7 w-7 text-ds-faint" strokeWidth={1.6} />
      <h3 className="mt-3 text-[14px] font-semibold text-ds-ink">Viewer unavailable</h3>
      <p className="mt-1 max-w-sm text-center text-[12px] leading-5 text-ds-muted">
        {activeAsset.path} is stored in the room, but this build has no viewer adapter for {activeAsset.format}.
      </p>
    </ViewerStateFrame>
  )
}

export function MissingGenomeReferenceState({
  asset,
  className,
  onSelectReference
}: {
  asset: BiologyRoomAsset
  className?: string
  onSelectReference?: (track: BiologyRoomAsset) => void
}): ReactElement {
  return (
    <ViewerStateFrame className={className} dataState="missing-reference">
      <AlertTriangle className="h-7 w-7 text-amber-500" strokeWidth={1.6} />
      <h3 className="mt-3 text-[14px] font-semibold text-ds-ink">Reference FASTA required</h3>
      <p className="mt-1 max-w-md text-center text-[12px] leading-5 text-ds-muted">
        {basename(asset.path)} is a genome track. Select a FASTA reference assembly before opening this track; SciForge will not invent an assembly.
      </p>
      <button
        type="button"
        onClick={() => onSelectReference?.(asset)}
        disabled={!onSelectReference}
        className="mt-4 inline-flex items-center gap-2 rounded-lg border border-ds-border bg-ds-card px-3 py-2 text-[12px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={1.8} />
        Select reference FASTA
      </button>
    </ViewerStateFrame>
  )
}

export function UnavailableBiologyAssetState({
  asset,
  message,
  className,
  reference = false
}: {
  asset: BiologyRoomAsset
  message: string
  className?: string
  reference?: boolean
}): ReactElement {
  return (
    <ViewerStateFrame className={className} dataState={reference ? 'reference-unavailable' : 'asset-unavailable'}>
      <AlertTriangle className="h-7 w-7 text-red-500" strokeWidth={1.6} />
      <h3 className="mt-3 text-[14px] font-semibold text-ds-ink">
        {reference ? 'Reference FASTA unavailable' : 'Biology asset unavailable'}
      </h3>
      <p className="mt-1 max-w-md text-center text-[12px] leading-5 text-ds-muted">
        {basename(asset.path)} cannot be opened safely. {message}
      </p>
      <p className="mt-2 max-w-md text-center text-[10.5px] leading-4 text-ds-faint">
        Restore the source and required index files inside the workspace. SciForge will revalidate and refresh the room automatically.
      </p>
    </ViewerStateFrame>
  )
}

function BiologyAssetWarningBanner({ message }: { message: string }): ReactElement {
  return (
    <div
      className="flex shrink-0 items-start gap-2 border-b border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] leading-4 text-amber-900 dark:text-amber-100"
      role="status"
      data-biology-room-asset-warning
    >
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-300" strokeWidth={1.8} />
      <span>{message}</span>
    </div>
  )
}

export function BiologyRoomViewerLoadingState(): ReactElement {
  return (
    <ViewerStateFrame dataState="loading">
      <Loader2 className="h-6 w-6 animate-spin text-emerald-500" strokeWidth={1.8} />
      <p className="mt-3 text-[12px] text-ds-muted">Loading biology viewer…</p>
    </ViewerStateFrame>
  )
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
    for (const atom of selection.atoms ?? []) {
      if (atom.id !== undefined) locators.push({ atomId: atom.id })
      else if (atom.index !== undefined) locators.push({ atomId: atom.index })
    }
    return locators.length ? { kind: 'molecular', assetId, locators } : null
  }

  return undefined
}

function ViewerStateFrame({
  children,
  className,
  dataState
}: {
  children: ReactNode
  className?: string
  dataState: string
}): ReactElement {
  return (
    <div
      className={compactClassName('biology-room-viewer-state flex h-full min-h-[18rem] flex-col items-center justify-center bg-ds-canvas px-8', className)}
      data-biology-room-viewer-state={dataState}
      role={dataState === 'loading' || dataState === 'empty' || dataState === 'missing-reference' ? 'status' : 'alert'}
    >
      {children}
    </div>
  )
}

function basename(value: string): string {
  return value.replaceAll('\\', '/').split('/').filter(Boolean).at(-1) ?? value
}

function compactClassName(...parts: Array<string | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}
