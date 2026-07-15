import {
  useEffect,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactElement
} from 'react'
import {
  AlertTriangle,
  Dna,
  Loader2,
  PanelRightClose,
  RefreshCw,
  ShieldCheck
} from 'lucide-react'
import type { BioGymRunSnapshot } from '@shared/biogym'
import type {
  BiologyRoomActor,
  BiologyRoomAsset,
  BiologyRoomManifest,
  BiologyRoomMutationOperation,
  BiologyRoomSelection
} from '@shared/biology-room'
import { BiologyRoomAssetRail } from './BiologyRoomAssetRail'
import { BiologyRoomInspector } from './BiologyRoomInspector'
import {
  BiologyRoomViewerOutlet,
  type BiologyRoomViewerAdapters
} from './BiologyRoomViewerOutlet'
import {
  clampBiologyRoomWidth,
  formatBiologyRoomTimestamp,
  resolveActiveBiologyRoomAsset,
  type BiologyRoomInspectorTab,
  type BiologyRoomProvenanceEntry,
  type BiologyRoomRevisionConflict,
  type BiologyRoomRevisionSummary
} from './model'
import type { BiologyRoomAssetSources } from './asset-sources'
import { stageLabel, workflowLabel } from './biogym-run-ui'

export const BIOLOGY_ROOM_DEFAULT_WIDTH = 900
export const BIOLOGY_ROOM_MIN_WIDTH = 640
export const BIOLOGY_ROOM_MAX_WIDTH = 1_600

export type BiologyRoomShellProps = {
  room: BiologyRoomManifest
  transportStatus?: 'loading' | 'ready' | 'error'
  transportError?: string | null
  viewerAdapters?: BiologyRoomViewerAdapters
  assetSources?: BiologyRoomAssetSources
  busy?: boolean
  error?: string | null
  warning?: string | null
  conflict?: BiologyRoomRevisionConflict | null
  versions?: BiologyRoomRevisionSummary[]
  provenance?: BiologyRoomProvenanceEntry[]
  annotationActor?: BiologyRoomActor
  inspectorTab?: BiologyRoomInspectorTab
  className?: string
  width?: number
  defaultWidth?: number
  minWidth?: number
  maxWidth?: number
  resizable?: boolean
  onWidthChange?: (width: number) => void
  onInspectorTabChange?: (tab: BiologyRoomInspectorTab) => void
  onApply?: (operation: BiologyRoomMutationOperation) => Promise<boolean | void> | boolean | void
  onAddSelectionToChat?: (context: string, selection: BiologyRoomSelection) => Promise<void> | void
  onRequestAddAsset?: () => void
  onSelectReference?: (track: BiologyRoomAsset) => void
  onReloadConflict?: () => void
  onDismissError?: () => void
  onDismissWarning?: () => void
  onClose?: () => void
  runSnapshot?: BioGymRunSnapshot | null
  followRun?: boolean
  onFollowRunChange?: (follow: boolean) => void
}

export function BiologyRoomShell({
  room,
  transportStatus,
  transportError,
  viewerAdapters,
  assetSources,
  busy = false,
  error,
  warning,
  conflict,
  versions,
  provenance,
  annotationActor,
  inspectorTab,
  className,
  width,
  defaultWidth = BIOLOGY_ROOM_DEFAULT_WIDTH,
  minWidth = BIOLOGY_ROOM_MIN_WIDTH,
  maxWidth = BIOLOGY_ROOM_MAX_WIDTH,
  resizable = true,
  onWidthChange,
  onInspectorTabChange,
  onApply,
  onAddSelectionToChat,
  onRequestAddAsset,
  onSelectReference,
  onReloadConflict,
  onDismissError,
  onDismissWarning,
  onClose,
  runSnapshot,
  followRun = true,
  onFollowRunChange
}: BiologyRoomShellProps): ReactElement {
  const [localWidth, setLocalWidth] = useState(() => clampBiologyRoomWidth(defaultWidth, minWidth, maxWidth))
  const controlledWidth = width === undefined ? null : clampBiologyRoomWidth(width, minWidth, maxWidth)
  const resolvedWidth = controlledWidth ?? localWidth
  const activeAsset = resolveActiveBiologyRoomAsset(room)
  const controlsBusy = busy || Boolean(conflict)
  const mutationHandler = conflict ? undefined : onApply
  useEffect(() => {
    if (width === undefined) {
      setLocalWidth((current) => clampBiologyRoomWidth(current, minWidth, maxWidth))
    }
  }, [maxWidth, minWidth, width])

  const updateWidth = (nextWidth: number): void => {
    const clamped = clampBiologyRoomWidth(nextWidth, minWidth, maxWidth)
    if (width === undefined) setLocalWidth(clamped)
    onWidthChange?.(clamped)
  }

  const beginResize = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!resizable || event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const startX = event.clientX
    const startWidth = resolvedWidth
    const target = event.currentTarget
    const pointerId = event.pointerId
    try {
      target.setPointerCapture(pointerId)
    } catch {
      // Pointer capture may be unavailable in tests or released by the browser.
    }
    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const finish = (): void => {
      try {
        if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId)
      } catch {
        // The browser can release capture before cleanup.
      }
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
    }
    const move = (moveEvent: PointerEvent): void => {
      updateWidth(startWidth + startX - moveEvent.clientX)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }

  const shellStyle: CSSProperties | undefined = resizable
    ? { width: resolvedWidth, flexBasis: resolvedWidth, minWidth: Math.min(minWidth, resolvedWidth) }
    : undefined

  return (
    <aside
      className={compactClassName(
        'biology-room-shell ds-no-drag relative flex h-full min-h-0 min-w-0 shrink-0 flex-col overflow-hidden border-l border-ds-border bg-ds-main shadow-panel',
        className
      )}
      style={shellStyle}
      aria-label={`Biology Room: ${room.title}`}
      aria-busy={busy}
      data-biology-room
      data-room-id={room.roomId}
      data-room-revision={room.revision}
      data-conflicted={conflict ? 'true' : 'false'}
    >
      {resizable ? (
        <div
          className="group absolute inset-y-0 left-0 z-30 w-[7px] -translate-x-1/2 cursor-col-resize touch-none"
          role="separator"
          aria-label="Resize Biology Room"
          aria-orientation="vertical"
          aria-valuemin={minWidth}
          aria-valuemax={maxWidth}
          aria-valuenow={resolvedWidth}
          tabIndex={0}
          onPointerDown={beginResize}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft') {
              event.preventDefault()
              updateWidth(resolvedWidth + 24)
            } else if (event.key === 'ArrowRight') {
              event.preventDefault()
              updateWidth(resolvedWidth - 24)
            } else if (event.key === 'Home') {
              event.preventDefault()
              updateWidth(minWidth)
            } else if (event.key === 'End') {
              event.preventDefault()
              updateWidth(maxWidth)
            }
          }}
        >
          <span className="absolute inset-y-0 left-1/2 w-px bg-transparent transition group-hover:bg-emerald-500" />
        </div>
      ) : null}

      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-ds-border bg-ds-card px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-300">
            <Dna className="h-4 w-4" strokeWidth={1.8} />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-[13px] font-semibold text-ds-ink">{room.title}</h1>
              <span className="shrink-0 rounded-full border border-ds-border bg-ds-subtle px-1.5 py-0.5 text-[9.5px] font-medium text-ds-muted">
                r{room.revision}
              </span>
            </div>
            <p className="mt-0.5 truncate text-[10.5px] text-ds-faint">
              {activeAsset ? activeAsset.path : 'No active asset'} · {busy ? 'Saving…' : `Updated ${formatBiologyRoomTimestamp(room.updatedAt)}`}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span
            className={compactClassName(
              'biology-room-header-status inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-medium',
              busy
                ? 'bg-blue-500/10 text-blue-600 dark:text-blue-300'
                : conflict
                  ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
                  : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
            )}
            role="status"
          >
            {busy
              ? <Loader2 className="h-3 w-3 animate-spin" />
              : conflict
                ? <AlertTriangle className="h-3 w-3" />
                : <ShieldCheck className="h-3 w-3" />}
            {busy ? 'Saving' : conflict ? 'Conflict' : 'Saved'}
          </span>
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
              title="Close Biology Room"
              aria-label="Close Biology Room"
            >
              <PanelRightClose className="h-4 w-4" strokeWidth={1.7} />
            </button>
          ) : null}
        </div>
      </header>

      {conflict ? (
        <RevisionConflictBanner conflict={conflict} busy={busy} onReload={onReloadConflict} />
      ) : null}
      {error ? (
        <ErrorBanner message={error} onDismiss={onDismissError} />
      ) : null}
      {warning ? (
        <WarningBanner message={warning} onDismiss={onDismissWarning} />
      ) : null}
      {runSnapshot ? (
        <BioGymRunStrip
          snapshot={runSnapshot}
          followRun={followRun}
          onFollowRunChange={onFollowRunChange}
        />
      ) : null}

      <div className="biology-room-layout grid min-h-0 flex-1 grid-cols-[184px_minmax(0,1fr)_288px] overflow-hidden">
        <BiologyRoomAssetRail
          room={room}
          busy={controlsBusy}
          onApply={mutationHandler}
          onRequestAddAsset={conflict ? undefined : onRequestAddAsset}
          runSnapshot={runSnapshot}
        />
        <main className="biology-room-viewer min-h-0 min-w-0 overflow-hidden bg-ds-canvas" aria-label="Biology viewer">
          <BiologyRoomViewerOutlet
            room={room}
            transportStatus={transportStatus}
            transportError={transportError}
            adapters={viewerAdapters}
            assetSources={assetSources}
            onApply={mutationHandler}
            onSelectReference={conflict ? undefined : onSelectReference}
          />
        </main>
        <BiologyRoomInspector
          room={room}
          busy={controlsBusy}
          activeTab={inspectorTab}
          versions={versions}
          provenance={provenance}
          annotationActor={annotationActor}
          onTabChange={onInspectorTabChange}
          onApply={mutationHandler}
          onAddSelectionToChat={onAddSelectionToChat}
        />
      </div>
    </aside>
  )
}

export function BioGymRunStrip({
  snapshot,
  followRun,
  onFollowRunChange
}: {
  snapshot: BioGymRunSnapshot
  followRun: boolean
  onFollowRunChange?: (follow: boolean) => void
}): ReactElement {
  const currentStage = snapshot.stages.find((stage) => stage.id === snapshot.currentStageAttemptId)
    ?? snapshot.stages.at(-1)
  const budget = snapshot.budget
  const statusTone = snapshot.status === 'failed' || snapshot.status === 'indeterminate'
    ? 'bg-red-500'
    : snapshot.status === 'completed'
      ? 'bg-emerald-500'
      : snapshot.status === 'cancelled'
        ? 'bg-ds-faint'
        : 'bg-blue-500'
  return (
    <div
      className="flex shrink-0 items-center justify-between gap-3 border-b border-ds-border bg-ds-subtle/70 px-3 py-1.5"
      data-biogym-run-strip
      data-biogym-run-id={snapshot.designRunId}
    >
      <div className="flex min-w-0 items-center gap-2 text-[10.5px]">
        <span className={`h-2 w-2 shrink-0 rounded-full ${statusTone}`} aria-hidden="true" />
        <span className="shrink-0 font-semibold text-ds-ink">BioGym</span>
        <span className="truncate text-ds-muted">{workflowLabel(snapshot.workflow)}</span>
        {currentStage ? (
          <span className="shrink-0 rounded bg-ds-card px-1.5 py-0.5 text-ds-muted">
            {stageLabel(currentStage.kind)} · {currentStage.status}
          </span>
        ) : null}
        <span className="shrink-0 text-ds-faint">
          GPU {budget.usedGpuJobs}/{budget.maxGpuJobs}
        </span>
      </div>
      <button
        type="button"
        className={`shrink-0 rounded-md border px-2 py-1 text-[10px] font-medium transition ${
          followRun
            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
            : 'border-ds-border bg-ds-card text-ds-muted hover:text-ds-ink'
        }`}
        aria-pressed={followRun}
        onClick={() => onFollowRunChange?.(!followRun)}
        disabled={!onFollowRunChange}
        title={followRun ? 'New design results will become active' : 'Resume following new design results'}
      >
        {followRun ? 'Following run' : 'Follow run'}
      </button>
    </div>
  )
}

export function RevisionConflictBanner({
  conflict,
  busy = false,
  onReload
}: {
  conflict: BiologyRoomRevisionConflict
  busy?: boolean
  onReload?: () => void
}): ReactElement {
  return (
    <div
      className="flex shrink-0 items-center justify-between gap-4 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2"
      role="alert"
      data-biology-room-conflict
    >
      <div className="flex min-w-0 items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-300" strokeWidth={1.8} />
        <p className="min-w-0 text-[11.5px] leading-5 text-amber-900 dark:text-amber-100">
          {conflict.message || `Room changed from revision ${conflict.expectedRevision} to ${conflict.actualRevision}. Reload before applying more edits.`}
        </p>
      </div>
      <button
        type="button"
        onClick={onReload}
        disabled={!onReload || busy}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-amber-500/35 bg-ds-card px-2.5 py-1.5 text-[10.5px] font-medium text-amber-800 transition hover:bg-amber-500/10 disabled:cursor-not-allowed disabled:opacity-45 dark:text-amber-200"
      >
        <RefreshCw className="h-3 w-3" /> Reload room
      </button>
    </div>
  )
}

function ErrorBanner({ message, onDismiss }: { message: string; onDismiss?: () => void }): ReactElement {
  return (
    <div className="flex shrink-0 items-center justify-between gap-4 border-b border-red-500/25 bg-red-500/10 px-4 py-2" role="alert">
      <p className="min-w-0 truncate text-[11.5px] text-red-700 dark:text-red-300">{message}</p>
      {onDismiss ? (
        <button type="button" onClick={onDismiss} className="shrink-0 text-[10.5px] font-medium text-red-700 hover:underline dark:text-red-300">Dismiss</button>
      ) : null}
    </div>
  )
}

function WarningBanner({ message, onDismiss }: { message: string; onDismiss?: () => void }): ReactElement {
  return (
    <div
      className="flex shrink-0 items-center justify-between gap-4 border-b border-amber-500/25 bg-amber-500/10 px-4 py-2"
      role="status"
      data-biology-room-warning
    >
      <p className="min-w-0 truncate text-[11.5px] text-amber-800 dark:text-amber-200">{message}</p>
      {onDismiss ? (
        <button type="button" onClick={onDismiss} className="shrink-0 text-[10.5px] font-medium text-amber-800 hover:underline dark:text-amber-200">Dismiss</button>
      ) : null}
    </div>
  )
}

function compactClassName(...parts: Array<string | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}
