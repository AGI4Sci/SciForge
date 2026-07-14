import {
  useState,
  type ReactElement
} from 'react'
import {
  AlertTriangle,
  Check,
  Clock3,
  GitCommitHorizontal,
  MessageSquarePlus,
  MousePointer2,
  RotateCcw,
  Send,
  ShieldCheck,
  Trash2
} from 'lucide-react'
import type {
  BiologyAnnotation,
  BiologyRoomActor,
  BiologyRoomManifest,
  BiologyRoomMutationOperation,
  BiologyRoomSelection
} from '@shared/biology-room'
import {
  buildBiologyRoomSelectionChatContext,
  describeBiologyAnnotation,
  describeBiologyRoomSelection,
  formatBiologyRoomTimestamp,
  type BiologyRoomInspectorTab,
  type BiologyRoomProvenanceEntry,
  type BiologyRoomRevisionSummary
} from './model'

const INSPECTOR_TABS: Array<{
  id: BiologyRoomInspectorTab
  label: string
}> = [
  { id: 'selection', label: 'Selection' },
  { id: 'annotations', label: 'Annotations' },
  { id: 'versions', label: 'Versions' },
  { id: 'provenance', label: 'Provenance' }
]

const ANNOTATION_COLORS = ['#10b981', '#3b82f6', '#8b5cf6', '#f59e0b', '#ef4444'] as const

export type BiologyRoomInspectorProps = {
  room: BiologyRoomManifest
  busy?: boolean
  activeTab?: BiologyRoomInspectorTab
  defaultTab?: BiologyRoomInspectorTab
  versions?: BiologyRoomRevisionSummary[]
  provenance?: BiologyRoomProvenanceEntry[]
  annotationActor?: BiologyRoomActor
  onTabChange?: (tab: BiologyRoomInspectorTab) => void
  onApply?: (operation: BiologyRoomMutationOperation) => Promise<boolean | void> | boolean | void
  onAddSelectionToChat?: (context: string, selection: BiologyRoomSelection) => Promise<void> | void
}

export function BiologyRoomInspector({
  room,
  busy = false,
  activeTab,
  defaultTab = 'selection',
  versions,
  provenance,
  annotationActor = { kind: 'user' },
  onTabChange,
  onApply,
  onAddSelectionToChat
}: BiologyRoomInspectorProps): ReactElement {
  const [localTab, setLocalTab] = useState<BiologyRoomInspectorTab>(defaultTab)
  const resolvedTab = activeTab ?? localTab
  const setTab = (tab: BiologyRoomInspectorTab): void => {
    if (activeTab === undefined) setLocalTab(tab)
    onTabChange?.(tab)
  }

  return (
    <aside
      className="biology-room-inspector flex min-h-0 flex-col border-l border-ds-border bg-ds-card"
      aria-label="Biology Room inspector"
      data-biology-room-inspector
    >
      <div
        className="grid shrink-0 grid-cols-4 border-b border-ds-border bg-ds-subtle px-1 pt-1"
        role="tablist"
        aria-label="Biology Room inspector tabs"
      >
        {INSPECTOR_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`biology-room-tab-${tab.id}`}
            aria-controls={`biology-room-panel-${tab.id}`}
            aria-selected={resolvedTab === tab.id}
            onClick={() => setTab(tab.id)}
            className={compactClassName(
              'min-w-0 border-b-2 px-1 py-2 text-[10.5px] font-medium transition',
              resolvedTab === tab.id
                ? 'border-emerald-500 text-ds-ink'
                : 'border-transparent text-ds-faint hover:text-ds-muted'
            )}
          >
            <span className="block truncate">{tab.label}</span>
          </button>
        ))}
      </div>

      <div
        className="min-h-0 flex-1 overflow-y-auto p-3"
        role="tabpanel"
        id={`biology-room-panel-${resolvedTab}`}
        aria-labelledby={`biology-room-tab-${resolvedTab}`}
      >
        {resolvedTab === 'selection' ? (
          <SelectionInspector
            room={room}
            busy={busy}
            onApply={onApply}
            onAddSelectionToChat={onAddSelectionToChat}
          />
        ) : null}
        {resolvedTab === 'annotations' ? (
          <AnnotationsInspector
            room={room}
            busy={busy}
            actor={annotationActor}
            onApply={onApply}
          />
        ) : null}
        {resolvedTab === 'versions' ? (
          <VersionsInspector room={room} versions={versions} busy={busy} onApply={onApply} />
        ) : null}
        {resolvedTab === 'provenance' ? (
          <ProvenanceInspector room={room} provenance={provenance} />
        ) : null}
      </div>
    </aside>
  )
}

function SelectionInspector({
  room,
  busy,
  onApply,
  onAddSelectionToChat
}: {
  room: BiologyRoomManifest
  busy: boolean
  onApply?: BiologyRoomInspectorProps['onApply']
  onAddSelectionToChat?: BiologyRoomInspectorProps['onAddSelectionToChat']
}): ReactElement {
  const selection = room.selection
  const chatContext = buildBiologyRoomSelectionChatContext(room)

  if (!selection) {
    return (
      <InspectorEmptyState
        icon={<MousePointer2 className="h-5 w-5" strokeWidth={1.6} />}
        title="Nothing selected"
        message="Select a sequence range, genome feature, variant, residue, or atom in the viewer."
      />
    )
  }

  return (
    <div data-biology-room-selection>
      <InspectorHeading icon={<MousePointer2 className="h-3.5 w-3.5" />} title="Active selection" />
      <div className="mt-3 rounded-lg border border-emerald-500/25 bg-emerald-500/10 p-3">
        <p className="break-words text-[12px] font-medium leading-5 text-ds-ink">
          {describeBiologyRoomSelection(selection, room)}
        </p>
        <SelectionDetails selection={selection} />
      </div>

      <button
        type="button"
        onClick={() => {
          if (chatContext) void onAddSelectionToChat?.(chatContext, selection)
        }}
        disabled={!chatContext || !onAddSelectionToChat || busy}
        className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-[11.5px] font-medium text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-45"
      >
        <Send className="h-3.5 w-3.5" strokeWidth={1.8} />
        Add selection to chat
      </button>
      <button
        type="button"
        onClick={() => onApply?.({ type: 'setSelection', selection: null })}
        disabled={!onApply || busy}
        className="mt-2 inline-flex w-full items-center justify-center rounded-lg border border-ds-border px-3 py-1.5 text-[11.5px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-45"
      >
        Clear selection
      </button>
    </div>
  )
}

function SelectionDetails({ selection }: { selection: BiologyRoomSelection }): ReactElement {
  if (selection.kind === 'sequence') {
    return (
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-[10.5px] leading-4 text-ds-muted">
        <dt>Coordinates</dt>
        <dd className="font-mono">0-based, half-open</dd>
        <dt>Ranges</dt>
        <dd>{selection.ranges.length}</dd>
        {selection.sequenceId ? <><dt>Sequence</dt><dd className="truncate">{selection.sequenceId}</dd></> : null}
      </dl>
    )
  }
  if (selection.kind === 'genomic') {
    return (
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-[10.5px] leading-4 text-ds-muted">
        <dt>Reference</dt><dd className="truncate">{selection.refName}</dd>
        <dt>Internal</dt><dd className="font-mono">[{selection.start}, {selection.end})</dd>
        {selection.strand ? <><dt>Strand</dt><dd>{selection.strand}</dd></> : null}
      </dl>
    )
  }
  return (
    <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-[10.5px] leading-4 text-ds-muted">
      <dt>Locators</dt><dd>{selection.locators.length}</dd>
      <dt>Identity</dt><dd>model / chain / residue / atom</dd>
    </dl>
  )
}

function AnnotationsInspector({
  room,
  busy,
  actor,
  onApply
}: {
  room: BiologyRoomManifest
  busy: boolean
  actor: BiologyRoomActor
  onApply?: BiologyRoomInspectorProps['onApply']
}): ReactElement {
  const [body, setBody] = useState('')
  const [color, setColor] = useState<string>(ANNOTATION_COLORS[0])
  const canCreate = Boolean(room.selection && body.trim() && onApply && !busy)

  const saveAnnotation = (): void => {
    if (!room.selection || !canCreate) return
    const annotation = createBiologyRoomAnnotation({
      selection: room.selection,
      body,
      color,
      actor
    })
    void Promise.resolve(onApply?.({ type: 'upsertAnnotation', annotation })).then((success) => {
      if (success !== false) setBody('')
    })
  }

  return (
    <div data-biology-room-annotations>
      <InspectorHeading icon={<MessageSquarePlus className="h-3.5 w-3.5" />} title="New annotation" />
      <div className="mt-3 rounded-lg border border-ds-border bg-ds-canvas p-2.5">
        {room.selection ? (
          <p className="truncate text-[10.5px] text-ds-muted">{describeBiologyRoomSelection(room.selection, room)}</p>
        ) : (
          <p className="flex items-center gap-1.5 text-[10.5px] text-amber-600 dark:text-amber-300">
            <AlertTriangle className="h-3 w-3" /> Select something before annotating.
          </p>
        )}
        <textarea
          value={body}
          onChange={(event) => setBody(event.currentTarget.value)}
          rows={4}
          maxLength={20_000}
          placeholder="Add a scientific note or question…"
          className="mt-2 w-full resize-none rounded-md border border-ds-border bg-ds-card px-2.5 py-2 text-[11.5px] leading-5 text-ds-ink outline-none placeholder:text-ds-faint focus:border-emerald-500"
          aria-label="Annotation text"
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1" aria-label="Annotation color">
            {ANNOTATION_COLORS.map((candidate) => (
              <button
                key={candidate}
                type="button"
                onClick={() => setColor(candidate)}
                className="flex h-5 w-5 items-center justify-center rounded-full border border-black/10 shadow-sm"
                style={{ backgroundColor: candidate }}
                aria-label={`Use annotation color ${candidate}`}
                aria-pressed={color === candidate}
              >
                {color === candidate ? <Check className="h-3 w-3 text-white" strokeWidth={2.4} /> : null}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={saveAnnotation}
            disabled={!canCreate}
            className="rounded-md bg-emerald-600 px-2.5 py-1.5 text-[10.5px] font-medium text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Save
          </button>
        </div>
      </div>

      <div className="mt-5 flex items-center justify-between">
        <InspectorHeading icon={<MessageSquarePlus className="h-3.5 w-3.5" />} title="Room annotations" />
        <span className="text-[10.5px] text-ds-faint">{room.annotations.length}</span>
      </div>
      {room.annotations.length ? (
        <ul className="mt-2 space-y-2">
          {room.annotations.map((annotation) => (
            <AnnotationCard key={annotation.id} annotation={annotation} room={room} busy={busy} onApply={onApply} />
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-[11.5px] leading-5 text-ds-muted">No annotations have been saved in this room.</p>
      )}
    </div>
  )
}

function AnnotationCard({
  annotation,
  room,
  busy,
  onApply
}: {
  annotation: BiologyAnnotation
  room: BiologyRoomManifest
  busy: boolean
  onApply?: BiologyRoomInspectorProps['onApply']
}): ReactElement {
  return (
    <li
      className={compactClassName(
        'rounded-lg border bg-ds-canvas p-2.5',
        annotation.orphaned ? 'border-amber-500/35' : 'border-ds-border'
      )}
      data-annotation-id={annotation.id}
      data-orphaned={annotation.orphaned ? 'true' : 'false'}
    >
      <div className="flex items-start gap-2">
        <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: annotation.color ?? '#10b981' }} />
        <div className="min-w-0 flex-1">
          <p className="whitespace-pre-wrap break-words text-[11.5px] leading-5 text-ds-ink">{annotation.body}</p>
          <button
            type="button"
            onClick={() => {
              const reveal = async (): Promise<void> => {
                if (room.activeAssetId !== annotation.anchor.assetId) {
                  const activated = await onApply?.({
                    type: 'setActiveAsset',
                    assetId: annotation.anchor.assetId
                  })
                  if (activated === false) return
                }
                await onApply?.({ type: 'setSelection', selection: annotation.anchor })
              }
              void reveal()
            }}
            disabled={!onApply || busy}
            className="mt-1.5 block max-w-full truncate text-left text-[10.5px] text-emerald-600 hover:underline disabled:cursor-not-allowed dark:text-emerald-300"
            title={describeBiologyAnnotation(annotation, room)}
          >
            {describeBiologyAnnotation(annotation, room)}
          </button>
        </div>
        <button
          type="button"
          onClick={() => onApply?.({ type: 'deleteAnnotation', annotationId: annotation.id })}
          disabled={!onApply || busy}
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-ds-faint transition hover:bg-red-500/10 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:text-red-300"
          title="Delete annotation"
          aria-label="Delete annotation"
        >
          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.7} />
        </button>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-ds-faint">
        <span>{annotation.actor.kind}</span>
        <span>{annotation.orphaned ? 'Orphaned anchor' : formatBiologyRoomTimestamp(annotation.updatedAt)}</span>
      </div>
    </li>
  )
}

function VersionsInspector({
  room,
  versions,
  busy,
  onApply
}: {
  room: BiologyRoomManifest
  versions?: BiologyRoomRevisionSummary[]
  busy: boolean
  onApply?: BiologyRoomInspectorProps['onApply']
}): ReactElement {
  const items = versions?.length
    ? versions
    : [{ revision: room.revision, createdAt: room.updatedAt, summary: 'Current room state', active: true }]
  return (
    <div data-biology-room-versions>
      <InspectorHeading icon={<GitCommitHorizontal className="h-3.5 w-3.5" />} title="Room versions" />
      <p className="mt-2 text-[11px] leading-5 text-ds-muted">Each persisted room mutation creates an auditable revision. Source files are not included in restore operations.</p>
      <ol className="mt-3 space-y-2">
        {items.map((version) => {
          const current = version.active || version.revision === room.revision
          return (
            <li key={version.revision} className="rounded-lg border border-ds-border bg-ds-canvas p-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[11.5px] font-medium text-ds-ink">Revision {version.revision}</p>
                  <p className="mt-0.5 text-[10.5px] text-ds-faint">{formatBiologyRoomTimestamp(version.createdAt)}</p>
                </div>
                {current ? (
                  <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">Current</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => onApply?.({ type: 'restoreRevision', revision: version.revision })}
                    disabled={!onApply || busy}
                    className="inline-flex items-center gap-1 rounded-md border border-ds-border px-2 py-1 text-[10px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <RotateCcw className="h-3 w-3" /> Restore
                  </button>
                )}
              </div>
              {version.summary ? <p className="mt-2 text-[10.5px] leading-4 text-ds-muted">{version.summary}</p> : null}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function ProvenanceInspector({
  room,
  provenance
}: {
  room: BiologyRoomManifest
  provenance?: BiologyRoomProvenanceEntry[]
}): ReactElement {
  const items = provenance ?? []
  return (
    <div data-biology-room-provenance>
      <InspectorHeading icon={<ShieldCheck className="h-3.5 w-3.5" />} title="Provenance" />
      <div className="mt-3 rounded-lg border border-ds-border bg-ds-canvas p-2.5 text-[10.5px] leading-4 text-ds-muted">
        <div className="flex items-center justify-between gap-2"><span>Room ID</span><code className="truncate text-ds-ink">{room.roomId}</code></div>
        <div className="mt-1.5 flex items-center justify-between gap-2"><span>Revision</span><span className="text-ds-ink">{room.revision}</span></div>
        <div className="mt-1.5 flex items-center justify-between gap-2"><span>Updated</span><span className="text-ds-ink">{formatBiologyRoomTimestamp(room.updatedAt)}</span></div>
      </div>
      <div className="mt-3" data-biology-room-source-fingerprints>
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-ds-faint">Source fingerprints</p>
        <ul className="mt-2 space-y-2">
          {room.assets.slice(0, 20).map((asset) => (
            <li key={asset.id} className="rounded-md border border-ds-border bg-ds-canvas p-2 text-[10px] leading-4 text-ds-muted">
              <p className="truncate text-ds-ink" title={asset.path}>{asset.path}</p>
              <code className="mt-0.5 block truncate font-mono" title={asset.sha256}>sha256 {asset.sha256}</code>
              {(asset.indexFingerprints ?? []).map((index) => (
                <code key={index.path} className="mt-0.5 block truncate font-mono" title={`${index.path}: ${index.sha256}`}>
                  {index.path} {index.sha256}
                </code>
              ))}
            </li>
          ))}
        </ul>
        {room.assets.length > 20 ? <p className="mt-2 text-[10px] text-ds-faint">Showing 20 of {room.assets.length} assets.</p> : null}
      </div>
      {items.length ? (
        <ol className="mt-4 space-y-3 border-l border-ds-border pl-3">
          {items.map((entry) => (
            <li key={entry.id} className="relative">
              <span className="absolute -left-[16.5px] top-1 h-2 w-2 rounded-full border border-ds-card bg-emerald-500" />
              <div className="flex items-center gap-1.5 text-[10px] text-ds-faint">
                <Clock3 className="h-3 w-3" />
                <span>{formatBiologyRoomTimestamp(entry.createdAt)}</span>
                <span>·</span>
                <span>{entry.actor}</span>
              </div>
              <p className="mt-1 text-[11.5px] leading-5 text-ds-ink">{entry.summary}</p>
              {entry.detail ? <p className="mt-1 whitespace-pre-wrap break-words font-mono text-[10px] leading-4 text-ds-muted">{entry.detail}</p> : null}
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-4 text-[11.5px] leading-5 text-ds-muted">Detailed events will appear after the room store supplies its audit log.</p>
      )}
    </div>
  )
}

export function createBiologyRoomAnnotation(input: {
  selection: BiologyRoomSelection
  body: string
  color?: string
  actor: BiologyRoomActor
  id?: string
  now?: string
}): BiologyAnnotation {
  const now = input.now ?? new Date().toISOString()
  return {
    id: input.id ?? createEntityId('annotation'),
    anchor: input.selection,
    body: input.body.trim(),
    ...(input.color ? { color: input.color } : {}),
    actor: input.actor,
    createdAt: now,
    updatedAt: now
  }
}

function InspectorHeading({ icon, title }: { icon: ReactElement; title: string }): ReactElement {
  return (
    <div className="flex items-center gap-1.5 text-[11.5px] font-semibold text-ds-ink">
      <span className="text-ds-muted">{icon}</span>
      <h3>{title}</h3>
    </div>
  )
}

function InspectorEmptyState({
  icon,
  title,
  message
}: {
  icon: ReactElement
  title: string
  message: string
}): ReactElement {
  return (
    <div className="flex min-h-48 flex-col items-center justify-center rounded-lg border border-dashed border-ds-border px-4 text-center">
      <span className="text-ds-faint">{icon}</span>
      <h3 className="mt-3 text-[12px] font-medium text-ds-ink">{title}</h3>
      <p className="mt-1 text-[11px] leading-5 text-ds-muted">{message}</p>
    </div>
  )
}

function createEntityId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.()
  if (uuid) return `${prefix}-${uuid}`
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function compactClassName(...parts: Array<string | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}
