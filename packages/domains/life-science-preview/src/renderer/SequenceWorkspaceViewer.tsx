import type { ReactNode } from 'react'
import {
  Activity,
  Crosshair,
  Download,
  MousePointer2,
  Search,
  Tags,
  type LucideIcon
} from 'lucide-react'
import type {
  LifeScienceStructuredSelection as WorkspaceStructuredSelection,
  LifeScienceWorkspaceObservation as WorkspaceObservation,
  LifeScienceWorkspacePreviewSetSelectionOperation
} from '../wire'

type SequenceStructuredSelection = Extract<WorkspaceStructuredSelection, { kind: 'sequence' }>
export type SequenceWorkspaceViewerSelectOperation = Extract<
  LifeScienceWorkspacePreviewSetSelectionOperation,
  { kind: 'workspace.setSelection' }
>
export type SequenceWorkspaceViewerSelectHandler = (
  operation: SequenceWorkspaceViewerSelectOperation
) => Promise<void> | void

export type SequenceWorkspaceViewerStatus =
  | {
      kind: 'ready'
      title: string
      message: string
    }
  | {
      kind: 'empty'
      title: string
      message: string
    }
  | {
      kind: 'unsupported'
      title: string
      message: string
    }

export type SequenceWorkspaceViewerRow = {
  id: string
  label: string
  value: string
  description?: string
}

export type SequenceWorkspaceViewerGroup = {
  id: string
  title: string
  summary: string
  items: string[]
}

export type SequenceWorkspaceViewerActionKind = 'select' | 'search' | 'export' | 'inspect' | 'other'

export type SequenceWorkspaceViewerAction = {
  id: string
  label: string
  kind: SequenceWorkspaceViewerActionKind
}

export type SequenceWorkspaceViewerSelectionModel = {
  kind: 'none' | 'sequence' | 'unsupported'
  summary: string
  groups: SequenceWorkspaceViewerGroup[]
}

export type SequenceWorkspaceViewerBrowserItem = {
  id: string
  sourceId?: string
  label: string
  start: number
  end: number
  x: number
  width: number
  kind?: string
  strand?: '+' | '-'
}

export type SequenceWorkspaceViewerBrowserModel =
  | {
      kind: 'map'
      reference: string
      start: number
      end: number
      summary: string
      indexedRanges: SequenceWorkspaceViewerBrowserItem[]
      selectedRanges: SequenceWorkspaceViewerBrowserItem[]
      features: SequenceWorkspaceViewerBrowserItem[]
      truncated: boolean
    }
  | {
      kind: 'empty'
      title: string
      message: string
    }

export type SequenceWorkspaceViewerModel = {
  status: SequenceWorkspaceViewerStatus
  title: string
  subtitle?: string
  viewport: {
    title: string
    message: string
  }
  agentSummary: string
  sequenceRows: SequenceWorkspaceViewerRow[]
  selection: SequenceWorkspaceViewerSelectionModel
  browser: SequenceWorkspaceViewerBrowserModel
  actions: SequenceWorkspaceViewerAction[]
}

export type SequenceWorkspaceViewerProps = {
  observation?: WorkspaceObservation | null
  model?: SequenceWorkspaceViewerModel
  onSetSelection?: SequenceWorkspaceViewerSelectHandler
  className?: string
}

const SEQUENCE_ACTION_LABELS: Record<string, string> = {
  'workspace.setSelection': 'Select',
  'sequence.selectRegion': 'Select Region',
  'sequence.search': 'Search Sequence',
  'sequence.inspectFeatures': 'Inspect Features',
  'sequence.exportSummary': 'Export Summary'
}

export function buildSequenceWorkspaceViewerModel(
  observation: WorkspaceObservation | null | undefined
): SequenceWorkspaceViewerModel {
  if (!observation) {
    return createInactiveModel({
      kind: 'empty',
      title: 'No sequence observation',
      message: 'Open a sequence or genomics workspace preview to populate this baseline viewer.'
    })
  }

  const hasSequenceContext = observation.view.modality === 'sequence' ||
    Boolean(observation.sequence) ||
    observation.selection?.kind === 'sequence'

  if (!hasSequenceContext) {
    return createInactiveModel({
      kind: 'unsupported',
      title: 'Unsupported observation',
      message: `${formatModality(observation.view.modality)} observations cannot be rendered by the sequence viewer.`
    }, observation)
  }

  const selection = buildSequenceSelectionModel(observation.selection)
  const sequenceRows = buildSequenceRows(observation, selection)
  const browser = buildSequenceBrowserModel(observation)
  const actions = buildSequenceActions(observation.actions)
  const agentSummary = buildAgentSummary({ observation, selection, actions })

  return {
    status: {
      kind: 'ready',
      title: 'Sequence baseline ready',
      message: 'A future genome browser or sequence canvas can mount into the placeholder viewport.'
    },
    title: observation.view.title || basename(observation.file.path) || 'Sequence workspace',
    subtitle: compactStrings([
      observation.view.pluginId,
      formatModality(observation.view.modality),
      titleCase(observation.view.mode)
    ]).join(' | '),
    viewport: {
      title: 'Genome browser mount point',
      message: observation.sequence
        ? 'Sequence summary metadata is ready; real genome browser rendering is intentionally not loaded in this baseline.'
        : 'Waiting for sequence summary metadata from the preview worker.'
    },
    agentSummary,
    sequenceRows,
    selection,
    browser,
    actions
  }
}

export function SequenceWorkspaceViewer({
  observation,
  model,
  onSetSelection,
  className
}: SequenceWorkspaceViewerProps): ReactNode {
  const resolvedModel = model ?? buildSequenceWorkspaceViewerModel(observation)
  const statusRole = resolvedModel.status.kind === 'unsupported' ? 'alert' : 'status'

  return (
    <section
      className={compactClassName(
        'workspace-preview-sequence-viewer flex h-full min-h-0 flex-col overflow-hidden bg-ds-canvas text-ds-ink',
        className
      )}
      data-workspace-preview-sequence-viewer
      data-status={resolvedModel.status.kind}
    >
      <header className="workspace-preview-sequence-viewer__header shrink-0 border-b border-ds-border bg-ds-card/95 px-4 py-3 backdrop-blur">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.14)]" aria-hidden="true" />
              <h3 className="min-w-0 truncate text-sm font-semibold leading-5 text-ds-ink">{resolvedModel.title}</h3>
            </div>
            {resolvedModel.subtitle ? (
              <p className="mt-1 truncate text-xs leading-4 text-ds-muted">{resolvedModel.subtitle}</p>
            ) : null}
          </div>
          <span className="shrink-0 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-medium leading-4 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-200">
            {resolvedModel.status.kind === 'ready' ? 'Ready' : titleCase(resolvedModel.status.kind)}
          </span>
        </div>
      </header>

      {resolvedModel.status.kind !== 'ready' ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div
            className="workspace-preview-sequence-viewer__state rounded-lg border border-ds-border bg-ds-card p-4 shadow-sm"
            role={statusRole}
            data-state-kind={resolvedModel.status.kind}
          >
            <strong className="block text-sm font-semibold text-ds-ink">{resolvedModel.status.title}</strong>
            <p className="mt-2 text-sm leading-6 text-ds-muted">{resolvedModel.status.message}</p>
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-5 pt-3 sm:px-4">
          <p className="workspace-preview-sequence-viewer__agent-summary sr-only">
            {resolvedModel.agentSummary}
          </p>

          <div className="grid min-h-full gap-4 min-[1600px]:grid-cols-[minmax(0,1fr)_320px]">
            <div className="min-w-0 space-y-4">
              <div
                className="workspace-preview-sequence-viewer__viewport"
                data-sequence-browser-viewport
                role="img"
                aria-label="Bounded sequence map"
              >
                <SequenceBrowserViewport
                  browser={resolvedModel.browser}
                  fallback={resolvedModel.viewport}
                />
              </div>

              <SequenceSummaryPanel rows={resolvedModel.sequenceRows} />
            </div>

            <aside className="min-w-0 space-y-4" aria-label="Sequence inspection panels">
              <SequenceAnnotationPanel
                browser={resolvedModel.browser}
                observation={observation}
                onSetSelection={onSetSelection}
              />
              <SequenceSelectionPanel selection={resolvedModel.selection} />
              <SequenceActionPanel actions={resolvedModel.actions} />
            </aside>
          </div>
        </div>
      )}
    </section>
  )
}

function SequenceSummaryPanel({
  rows
}: {
  rows: SequenceWorkspaceViewerRow[]
}): ReactNode {
  return (
    <section
      className="workspace-preview-sequence-viewer__section rounded-lg border border-ds-border bg-ds-card p-4 shadow-sm"
      aria-label="Sequence summary"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h4 className="text-xs font-semibold uppercase leading-4 text-ds-muted">Sequence</h4>
        <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-medium leading-4 text-slate-600 dark:bg-white/10 dark:text-slate-200">
          {formatCount(rows.length, 'metric')}
        </span>
      </div>
      <dl className="grid gap-2 sm:grid-cols-3">
        {rows.map((row) => (
          <div
            key={row.id}
            className="min-w-0 rounded-md border border-ds-border-muted bg-ds-subtle px-3 py-2"
          >
            <dt className="truncate text-xs font-medium leading-4 text-ds-muted">{row.label}</dt>
            <dd className="mt-1 min-w-0 text-sm font-semibold leading-5 text-ds-ink">
              <span className="block truncate">{row.value}</span>
              {row.description ? (
                <small className="mt-1 block overflow-hidden text-ellipsis whitespace-nowrap text-xs font-normal leading-4 text-ds-muted">
                  {row.description}
                </small>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function SequenceSelectionPanel({
  selection
}: {
  selection: SequenceWorkspaceViewerSelectionModel
}): ReactNode {
  return (
    <section
      className="workspace-preview-sequence-viewer__section rounded-lg border border-ds-border bg-ds-card p-4 shadow-sm"
      aria-label="Sequence selection"
      data-selection-kind={selection.kind}
    >
      <div className="mb-3 flex items-center gap-2">
        <Crosshair aria-hidden="true" className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-300" strokeWidth={1.9} />
        <h4 className="text-xs font-semibold uppercase leading-4 text-ds-muted">Selection</h4>
      </div>
      <p className="text-sm leading-6 text-ds-ink">{selection.summary}</p>
      {selection.groups.length ? (
        <dl className="mt-3 space-y-2">
          {selection.groups.map((group) => (
            <div
              key={group.id}
              className="min-w-0 rounded-md border border-ds-border-muted bg-ds-subtle px-3 py-2"
            >
              <dt className="flex items-center justify-between gap-3 text-xs font-medium leading-4 text-ds-muted">
                <span>{group.title}</span>
                <span>{group.summary}</span>
              </dt>
              <dd className="mt-1 truncate text-sm font-medium leading-5 text-ds-ink">
                {group.items.join(', ')}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  )
}

function SequenceActionPanel({
  actions
}: {
  actions: SequenceWorkspaceViewerAction[]
}): ReactNode {
  return (
    <section
      className="workspace-preview-sequence-viewer__section rounded-lg border border-ds-border bg-ds-card p-4 shadow-sm"
      aria-label="Sequence actions"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h4 className="text-xs font-semibold uppercase leading-4 text-ds-muted">Actions</h4>
        <span className="text-xs leading-4 text-ds-faint">{formatCount(actions.length, 'tool')}</span>
      </div>
      {actions.length ? (
        <ul className="grid gap-2">
          {actions.map((action) => {
            const Icon = sequenceActionIcon(action.kind)
            return (
              <li
                key={action.id}
                className={compactClassName(
                  'flex min-h-9 min-w-0 items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium leading-5',
                  sequenceActionTone(action.kind)
                )}
                data-action-id={action.id}
                data-action-kind={action.kind}
                title={action.id}
              >
                <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
                <span className="min-w-0 truncate">{action.label}</span>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="text-sm leading-6 text-ds-muted">No select, search, export, or inspect actions are available.</p>
      )}
    </section>
  )
}

function SequenceAnnotationPanel({
  browser,
  observation,
  onSetSelection
}: {
  browser: SequenceWorkspaceViewerBrowserModel
  observation?: WorkspaceObservation | null
  onSetSelection?: SequenceWorkspaceViewerSelectHandler
}): ReactNode {
  const markers = browser.kind === 'map'
    ? [...browser.selectedRanges, ...browser.features, ...browser.indexedRanges]
    : []

  return (
    <section
      className="workspace-preview-sequence-viewer__section rounded-lg border border-ds-border bg-ds-card p-4 shadow-sm"
      aria-label="Sequence annotations"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Tags aria-hidden="true" className="h-3.5 w-3.5 text-sky-600 dark:text-sky-300" strokeWidth={1.9} />
          <h4 className="text-xs font-semibold uppercase leading-4 text-ds-muted">Annotations</h4>
        </div>
        <span className="rounded-md bg-sky-50 px-2 py-1 text-xs font-medium leading-4 text-sky-700 dark:bg-sky-400/10 dark:text-sky-200">
          {formatCount(markers.length, 'marker')}
        </span>
      </div>
      {browser.kind === 'map' && markers.length ? (
        <ol className="workspace-preview-sequence-viewer__markers space-y-2" data-sequence-marker-list>
          {markers.map((marker) => {
            const selected = isMarkerSelected(marker, browser.selectedRanges)
            return (
              <li key={`${marker.id}:${marker.start}:${marker.end}`}>
                <button
                  type="button"
                  disabled={!observation || !onSetSelection}
                  className={compactClassName(
                    'group grid min-h-12 w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-md border px-3 py-2 text-left transition focus:outline-none focus:ring-2 focus:ring-emerald-500/40 disabled:cursor-default disabled:opacity-90',
                    selected
                      ? 'border-emerald-300 bg-emerald-50 text-emerald-950 dark:border-emerald-400/40 dark:bg-emerald-400/10 dark:text-emerald-100'
                      : 'border-ds-border-muted bg-ds-subtle text-ds-ink hover:border-emerald-300 hover:bg-emerald-50/60 dark:hover:bg-emerald-400/10'
                  )}
                  data-sequence-marker
                  data-sequence-marker-kind={marker.kind ?? ''}
                  data-sequence-marker-reference={browser.reference}
                  data-sequence-marker-start={marker.start}
                  data-sequence-marker-end={marker.end}
                  data-sequence-marker-id={marker.id}
                  data-sequence-marker-type={marker.kind ?? ''}
                  data-sequence-marker-strand={marker.strand ?? ''}
                  data-selected={selected ? 'true' : 'false'}
                  onClick={() => {
                    if (!observation) return
                    void onSetSelection?.(createSequenceMarkerSelectionOperation(observation, browser.reference, marker))
                  }}
                >
                  <span className={compactClassName('h-2.5 w-2.5 rounded-full', sequenceMarkerSwatch(marker))} aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold leading-5">{marker.label}</span>
                    <span className="mt-0.5 block truncate text-xs leading-4 text-ds-muted">
                      {markerCoordinateLabel(marker)}
                    </span>
                  </span>
                  <span className="flex items-center gap-1 rounded bg-white/70 px-1.5 py-1 text-xs font-medium leading-4 text-ds-muted shadow-sm dark:bg-white/10">
                    {selected ? <MousePointer2 aria-hidden="true" className="h-3 w-3" strokeWidth={2} /> : null}
                    {markerKindLabel(marker)}
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
      ) : (
        <p className="text-sm leading-6 text-ds-muted">
          {browser.kind === 'map' ? 'No coordinate annotations are reported.' : browser.message}
        </p>
      )}
    </section>
  )
}

function createInactiveModel(
  status: Extract<SequenceWorkspaceViewerStatus, { kind: 'empty' | 'unsupported' }>,
  observation?: WorkspaceObservation
): SequenceWorkspaceViewerModel {
  return {
    status,
    title: observation?.view.title || 'Sequence viewer',
    subtitle: observation ? compactStrings([
      observation.view.pluginId,
      formatModality(observation.view.modality),
      titleCase(observation.view.mode)
    ]).join(' | ') : undefined,
    viewport: {
      title: 'Genome browser mount point',
      message: 'No sequence viewport is active.'
    },
    agentSummary: status.message,
    sequenceRows: [],
    selection: {
      kind: 'none',
      summary: 'No sequence selection.',
      groups: []
    },
    browser: {
      kind: 'empty',
      title: 'No sequence map',
      message: 'No sequence viewport is active.'
    },
    actions: []
  }
}

function buildSequenceRows(
  observation: WorkspaceObservation,
  selection: SequenceWorkspaceViewerSelectionModel
): SequenceWorkspaceViewerRow[] {
  const sequence = observation.sequence
  const sequenceSelection = observation.selection?.kind === 'sequence' ? observation.selection : undefined
  const selectedRanges = sequenceSelection?.ranges?.map(formatRange) ?? []
  const selectedFeatures = sequenceSelection?.features?.map(formatFeature) ?? []
  const rows: SequenceWorkspaceViewerRow[] = [
    row(
      'sequence-count',
      'Sequences',
      typeof sequence?.sequenceCount === 'number' ? String(sequence.sequenceCount) : 'Not reported'
    ),
    row(
      'total-length',
      'Total length',
      typeof sequence?.totalLength === 'number' ? `${formatInteger(sequence.totalLength)} bp/aa` : 'Not reported'
    ),
    row(
      'alphabet',
      'Alphabet',
      sequence?.alphabet ? formatSequenceAlphabet(sequence.alphabet) : 'Not reported'
    )
  ]

  if (selectedRanges.length) {
    rows.push(row('selected-ranges', 'Selected ranges', formatCount(selectedRanges.length, 'range'), selectedRanges.join(', ')))
  }
  if (selectedFeatures.length) {
    rows.push(row('selected-features', 'Selected features', formatCount(selectedFeatures.length, 'feature'), selectedFeatures.join(', ')))
  }
  if (sequence?.references?.length) {
    rows.push(row('references', 'References', formatCount(sequence.references.length, 'reference'), sequence.references.map(formatReferenceSummary).join(', ')))
  }
  if (sequence?.features?.length) {
    rows.push(row('features', 'Features', formatCount(sequence.features.length, 'feature'), sequence.features.map(formatObservationFeature).join(', ')))
  }
  if (sequence?.indexedRanges?.length) {
    rows.push(row('indexed-ranges', 'Indexed ranges', formatCount(sequence.indexedRanges.length, 'range')))
  }
  if (sequence?.truncatedRecords || sequence?.truncatedReferences) {
    rows.push(row('bounded', 'Bounded preview', 'Truncated', compactStrings([
      sequence.truncatedRecords ? 'records omitted' : undefined,
      sequence.truncatedReferences ? 'references omitted' : undefined
    ]).join(', ')))
  }

  if (!sequence && selection.kind === 'none') {
    rows.push(row('summary', 'Summary', 'No sequence summary reported yet.'))
  }

  return rows
}

function buildSequenceSelectionModel(
  selection: WorkspaceStructuredSelection | undefined
): SequenceWorkspaceViewerSelectionModel {
  if (!selection) {
    return {
      kind: 'none',
      summary: 'No sequence selection.',
      groups: []
    }
  }

  if (selection.kind !== 'sequence') {
    return {
      kind: 'unsupported',
      summary: `${titleCase(selection.kind)} selection is active outside the sequence viewer.`,
      groups: []
    }
  }

  const ranges = selection.ranges.map(formatRange)
  const features = selection.features?.map(formatFeature) ?? []
  const groups = compactGroups([
    selection.sequenceId ? createSelectionGroup('sequence-id', 'Sequence ID', [selection.sequenceId]) : null,
    createSelectionGroup('ranges', 'Selected ranges', ranges),
    createSelectionGroup('features', 'Selected features', features)
  ])
  const summaryParts = compactStrings([
    selection.sequenceId ? `sequence ${selection.sequenceId}` : undefined,
    ranges.length ? formatCount(ranges.length, 'range') : undefined,
    features.length ? formatCount(features.length, 'feature') : undefined
  ])

  return {
    kind: 'sequence',
    summary: summaryParts.length ? `Selected ${summaryParts.join(', ')}.` : 'Sequence selection is empty.',
    groups
  }
}

function buildSequenceActions(actions: readonly string[]): SequenceWorkspaceViewerAction[] {
  const resolved = new Map<string, SequenceWorkspaceViewerAction>()

  for (const actionId of actions) {
    const kind = classifySequenceAction(actionId)
    if (!kind) continue

    resolved.set(actionId, {
      id: actionId,
      label: SEQUENCE_ACTION_LABELS[actionId] ?? formatActionLabel(actionId),
      kind
    })
  }

  return [...resolved.values()]
}

export function buildSequenceBrowserModel(
  observation: WorkspaceObservation | null | undefined
): SequenceWorkspaceViewerBrowserModel {
  const sequence = observation?.sequence
  if (!sequence) {
    return {
      kind: 'empty',
      title: 'Sequence map unavailable',
      message: 'Waiting for sequence summary metadata from the preview worker.'
    }
  }

  const selection = observation?.selection?.kind === 'sequence' ? observation.selection : undefined
  const activeReference = selection?.sequenceId ||
    sequence.references?.[0]?.id ||
    sequence.features?.[0]?.reference ||
    sequence.indexedRanges?.[0]?.reference
  if (!activeReference) {
    return {
      kind: 'empty',
      title: 'Sequence map unavailable',
      message: 'The bounded observation does not include reference coordinates yet.'
    }
  }

  const referenceSummary = sequence.references?.find((reference) => reference.id === activeReference)
  const indexedRanges = (sequence.indexedRanges ?? [])
    .filter((range) => range.reference === activeReference)
  const features = (sequence.features ?? [])
    .filter((feature) => feature.reference === activeReference)
  const selectedRanges = selection && (!selection.sequenceId || selection.sequenceId === activeReference)
    ? selection.ranges
    : []
  const end = Math.max(
    1,
    referenceSummary?.sequenceLength ?? 0,
    ...(indexedRanges.map((range) => range.end)),
    ...(features.map((feature) => feature.end)),
    ...(selectedRanges.map((range) => range.end)),
    sequence.sequenceCount === 1 ? sequence.totalLength ?? 0 : 0
  )

  return {
    kind: 'map',
    reference: activeReference,
    start: 0,
    end,
    summary: `${activeReference}: ${formatInteger(end)} bp/aa bounded map`,
    indexedRanges: indexedRanges.slice(0, 64).map((range, index) => browserItem({
      id: range.id ?? `indexed-range-${index + 1}`,
      label: compactStrings([range.type, range.id, range.kind]).join(' ') || range.kind,
      start: range.start,
      end: range.end,
      kind: range.kind,
      strand: range.strand
    }, end)),
    selectedRanges: selectedRanges.slice(0, 64).map((range, index) => browserItem({
      id: `selected-range-${index + 1}`,
      label: formatRange(range),
      start: range.start,
      end: range.end,
      kind: 'selection',
      strand: range.strand
    }, end)),
    features: features.slice(0, 64).map((feature, index) => browserItem({
      id: feature.id ?? `feature-${index + 1}`,
      sourceId: feature.id,
      label: formatObservationFeature(feature),
      start: feature.start,
      end: feature.end,
      kind: feature.type,
      strand: feature.strand
    }, end)),
    truncated: Boolean(sequence.truncatedRecords || sequence.truncatedReferences)
  }
}

function SequenceBrowserViewport({
  browser,
  fallback
}: {
  browser: SequenceWorkspaceViewerBrowserModel
  fallback: SequenceWorkspaceViewerModel['viewport']
}): ReactNode {
  if (browser.kind !== 'map') {
    return (
      <div
        className="workspace-preview-sequence-viewer__browser-empty rounded-lg border border-dashed border-ds-border bg-ds-card p-6 text-center shadow-sm"
        data-sequence-browser-empty
      >
        <strong className="block text-sm font-semibold text-ds-ink">{browser.title || fallback.title}</strong>
        <p className="mt-2 text-sm leading-6 text-ds-muted">{browser.message || fallback.message}</p>
      </div>
    )
  }

  const ticks = buildSequenceTicks(browser.end)

  return (
    <figure
      className="workspace-preview-sequence-viewer__browser overflow-hidden rounded-lg border border-ds-border bg-ds-card shadow-sm"
      data-sequence-browser-map
      data-sequence-reference={browser.reference}
      data-sequence-start={browser.start}
      data-sequence-end={browser.end}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-ds-border px-4 py-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase leading-4 text-ds-muted">Reference map</p>
          <h4 className="mt-1 truncate text-sm font-semibold leading-5 text-ds-ink">{browser.reference}</h4>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="rounded-md bg-emerald-50 px-2 py-1 text-xs font-medium leading-4 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-200">
            {formatCount(browser.selectedRanges.length, 'selection')}
          </span>
          <span className="rounded-md bg-sky-50 px-2 py-1 text-xs font-medium leading-4 text-sky-700 dark:bg-sky-400/10 dark:text-sky-200">
            {formatCount(browser.features.length, 'feature')}
          </span>
          <span className="rounded-md bg-amber-50 px-2 py-1 text-xs font-medium leading-4 text-amber-700 dark:bg-amber-400/10 dark:text-amber-200">
            {formatCount(browser.indexedRanges.length, 'range')}
          </span>
        </div>
      </div>
      <div className="overflow-x-auto px-4 py-4">
        <svg
          className="block h-auto min-w-[560px] text-ds-muted"
          viewBox="0 0 1000 304"
          role="presentation"
          aria-hidden="true"
        >
        <rect x="24" y="24" width="952" height="250" rx="8" fill="currentColor" opacity="0.055" />
        {ticks.map((tick) => (
          <g key={tick.ratio}>
            <line x1={tick.x} y1="32" x2={tick.x} y2="274" stroke="currentColor" strokeWidth="1" opacity="0.16" />
            <text x={tick.x} y="294" textAnchor={tick.anchor} fill="currentColor" fontSize="22">
              {formatInteger(tick.value)}
            </text>
          </g>
        ))}
        <text x="24" y="18" fill="currentColor" fontSize="22" fontWeight="600">{browser.reference}</text>
        <text x="976" y="18" textAnchor="end" fill="currentColor" fontSize="22">{formatInteger(browser.end)} bp/aa</text>
        <text x="24" y="55" fill="currentColor" fontSize="20">Reference</text>
        <rect x="24" y="66" width="952" height="14" rx="7" fill="#1f2937" opacity="0.86" />
        <text x="24" y="110" fill="currentColor" fontSize="20">Indexed ranges</text>
        {browser.indexedRanges.map((range) => (
          <rect
            key={range.id}
            x={range.x}
            y="122"
            width={range.width}
            height="18"
            rx="4"
            fill={sequenceIndexedRangeFill(range)}
            stroke={sequenceIndexedRangeStroke(range)}
            strokeWidth="1.4"
            data-sequence-indexed-range={range.id}
            data-range-kind={range.kind ?? ''}
          >
            <title>{`${range.label}: ${formatInteger(range.start)}-${formatInteger(range.end)}`}</title>
          </rect>
        ))}
        <text x="24" y="168" fill="currentColor" fontSize="20">Selection</text>
        {browser.selectedRanges.map((range) => (
          <rect
            key={range.id}
            x={range.x}
            y="180"
            width={range.width}
            height="28"
            rx="4"
            fill="#0f766e"
            fillOpacity="0.92"
            stroke="#134e4a"
            strokeWidth="1.5"
            data-sequence-selected-range={range.id}
            data-strand={range.strand ?? ''}
          >
            <title>{range.label}</title>
          </rect>
        ))}
        <text x="24" y="236" fill="currentColor" fontSize="20">Features</text>
        {browser.features.map((feature) => (
          <rect
            key={feature.id}
            x={feature.x}
            y="248"
            width={feature.width}
            height="18"
            rx="4"
            fill={sequenceFeatureFill(feature)}
            stroke={sequenceFeatureStroke(feature)}
            strokeWidth="1.4"
            data-sequence-feature={feature.id}
            data-feature-type={feature.kind ?? ''}
            data-strand={feature.strand ?? ''}
          >
            <title>{feature.label}</title>
          </rect>
        ))}
      </svg>
      </div>
      <figcaption className="flex flex-wrap items-center justify-between gap-2 border-t border-ds-border px-4 py-3 text-xs leading-5 text-ds-muted">
        <span>{browser.summary}</span>
        {browser.truncated ? (
          <small className="font-medium text-amber-700 dark:text-amber-200">Bounded preview; omitted sequence records may not be shown.</small>
        ) : null}
      </figcaption>
    </figure>
  )
}

function sequenceActionIcon(kind: SequenceWorkspaceViewerActionKind): LucideIcon {
  switch (kind) {
    case 'select':
      return Crosshair
    case 'search':
      return Search
    case 'export':
      return Download
    case 'inspect':
      return Tags
    case 'other':
      return Activity
  }
}

function sequenceActionTone(kind: SequenceWorkspaceViewerActionKind): string {
  switch (kind) {
    case 'select':
      return 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-200'
    case 'search':
      return 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-400/30 dark:bg-sky-400/10 dark:text-sky-200'
    case 'export':
      return 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200'
    case 'inspect':
      return 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-400/30 dark:bg-rose-400/10 dark:text-rose-200'
    case 'other':
      return 'border-ds-border-muted bg-ds-subtle text-ds-muted'
  }
}

function sequenceMarkerSwatch(marker: Pick<SequenceWorkspaceViewerBrowserItem, 'kind'>): string {
  const kind = marker.kind?.toLowerCase() ?? ''
  if (kind === 'selection') return 'bg-emerald-500'
  if (kind === 'gene' || kind.includes('gene')) return 'bg-sky-500'
  if (kind === 'exon' || kind.includes('exon')) return 'bg-amber-500'
  if (kind === 'variant' || kind.includes('variant')) return 'bg-rose-500'
  if (kind === 'reference' || kind === 'sequence') return 'bg-slate-500'
  return 'bg-teal-500'
}

function markerCoordinateLabel(marker: Pick<SequenceWorkspaceViewerBrowserItem, 'start' | 'end' | 'strand'>): string {
  const strand = marker.strand ? ` (${marker.strand})` : ''
  return `${formatInteger(marker.start)}-${formatInteger(marker.end)}${strand}`
}

function markerKindLabel(marker: Pick<SequenceWorkspaceViewerBrowserItem, 'kind'>): string {
  const kind = marker.kind?.toLowerCase() ?? ''
  if (kind === 'selection') return 'Selected'
  if (kind === 'reference') return 'Reference'
  if (kind === 'sequence') return 'Sequence'
  if (kind === 'read') return 'Read'
  if (kind) return titleCase(kind)
  return 'Range'
}

function buildSequenceTicks(end: number): Array<{
  ratio: number
  value: number
  x: number
  anchor: 'start' | 'middle' | 'end'
}> {
  return [0, 0.25, 0.5, 0.75, 1].map((ratio) => ({
    ratio,
    value: Math.round(end * ratio),
    x: 24 + ratio * 952,
    anchor: ratio === 0 ? 'start' : ratio === 1 ? 'end' : 'middle'
  }))
}

function sequenceIndexedRangeFill(range: Pick<SequenceWorkspaceViewerBrowserItem, 'kind'>): string {
  const kind = range.kind?.toLowerCase() ?? ''
  if (kind === 'reference' || kind === 'sequence') return '#64748b'
  if (kind === 'feature') return '#38bdf8'
  if (kind === 'read') return '#14b8a6'
  if (kind.includes('variant')) return '#fb7185'
  return '#f59e0b'
}

function sequenceIndexedRangeStroke(range: Pick<SequenceWorkspaceViewerBrowserItem, 'kind'>): string {
  const kind = range.kind?.toLowerCase() ?? ''
  if (kind === 'reference' || kind === 'sequence') return '#334155'
  if (kind === 'feature') return '#0369a1'
  if (kind === 'read') return '#0f766e'
  if (kind.includes('variant')) return '#be123c'
  return '#b45309'
}

function sequenceFeatureFill(feature: Pick<SequenceWorkspaceViewerBrowserItem, 'kind'>): string {
  const kind = feature.kind?.toLowerCase() ?? ''
  if (kind === 'gene' || kind.includes('gene')) return '#0ea5e9'
  if (kind === 'exon' || kind.includes('exon')) return '#f59e0b'
  if (kind === 'cds') return '#14b8a6'
  if (kind.includes('variant')) return '#f43f5e'
  return '#84cc16'
}

function sequenceFeatureStroke(feature: Pick<SequenceWorkspaceViewerBrowserItem, 'kind'>): string {
  const kind = feature.kind?.toLowerCase() ?? ''
  if (kind === 'gene' || kind.includes('gene')) return '#0369a1'
  if (kind === 'exon' || kind.includes('exon')) return '#b45309'
  if (kind === 'cds') return '#0f766e'
  if (kind.includes('variant')) return '#be123c'
  return '#4d7c0f'
}

export function createSequenceMarkerSelectionOperation(
  observation: WorkspaceObservation,
  reference: string,
  marker: Pick<SequenceWorkspaceViewerBrowserItem, 'id' | 'sourceId' | 'start' | 'end' | 'kind' | 'strand'>
): SequenceWorkspaceViewerSelectOperation {
  return {
    kind: 'workspace.setSelection',
    path: observation.file.path,
    selection: {
      kind: 'sequence',
      sequenceId: reference,
      ranges: [{
        start: marker.start,
        end: marker.end,
        ...(marker.strand ? { strand: marker.strand } : {})
      }],
      ...(marker.kind && marker.kind !== 'selection' && marker.kind !== 'reference' && marker.kind !== 'sequence' && marker.kind !== 'read'
        ? {
            features: [{
              ...(marker.sourceId ? { id: marker.sourceId } : {}),
              type: marker.kind,
              start: marker.start,
              end: marker.end
            }]
          }
        : {})
    }
  }
}

function isMarkerSelected(
  marker: Pick<SequenceWorkspaceViewerBrowserItem, 'start' | 'end'>,
  selectedRanges: readonly Pick<SequenceWorkspaceViewerBrowserItem, 'start' | 'end'>[]
): boolean {
  return selectedRanges.some((range) => range.start === marker.start && range.end === marker.end)
}

function browserItem(input: {
  id: string
  sourceId?: string
  label: string
  start: number
  end: number
  kind?: string
  strand?: '+' | '-'
}, coordinateEnd: number): SequenceWorkspaceViewerBrowserItem {
  const start = clampCoordinate(input.start, coordinateEnd)
  const end = Math.max(start, clampCoordinate(input.end, coordinateEnd))
  const width = Math.max(2, ((end - start) / coordinateEnd) * 952)
  const x = 24 + (start / coordinateEnd) * 952
  return {
    id: input.id,
    sourceId: input.sourceId,
    label: input.label,
    start,
    end,
    x,
    width,
    kind: input.kind,
    strand: input.strand
  }
}

function clampCoordinate(value: number, coordinateEnd: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(value, coordinateEnd))
}

function classifySequenceAction(actionId: string): SequenceWorkspaceViewerActionKind | null {
  if (actionId === 'workspace.setSelection') {
    return 'select'
  }

  const isSequenceAction = actionId.startsWith('sequence.')
  if (isExportAction(actionId) && (isSequenceAction || isGenericExportAction(actionId))) return 'export'
  if (!isSequenceAction) return null

  if (/(^|[.:])select/i.test(actionId) || /selection/i.test(actionId)) return 'select'
  if (/search|find|query/i.test(actionId)) return 'search'
  if (/inspect|feature|annotation/i.test(actionId)) return 'inspect'
  return 'other'
}

function isGenericExportAction(actionId: string): boolean {
  return actionId.startsWith('workspace.export:') || /^export[:.]/i.test(actionId)
}

function isExportAction(actionId: string): boolean {
  return isGenericExportAction(actionId) || /(^|[.:])export/i.test(actionId)
}

function buildAgentSummary(input: {
  observation: WorkspaceObservation
  selection: SequenceWorkspaceViewerSelectionModel
  actions: SequenceWorkspaceViewerAction[]
}): string {
  const { observation, selection, actions } = input
  const sequence = observation.sequence
  const parts = compactStrings([
    typeof sequence?.sequenceCount === 'number' ? formatCount(sequence.sequenceCount, 'sequence') : undefined,
    typeof sequence?.totalLength === 'number' ? `${formatInteger(sequence.totalLength)} bp/aa` : undefined,
    sequence?.alphabet ? `${formatSequenceAlphabet(sequence.alphabet)} alphabet` : undefined,
    selection.kind === 'sequence' ? `selection: ${selection.summary}` : undefined,
    actions.length ? `actions: ${actions.map((action) => action.label).join(', ')}` : undefined
  ])

  return parts.length ? parts.join('; ') : 'Sequence observation ready without reported sequence details.'
}

function createSelectionGroup(
  id: string,
  title: string,
  items: readonly string[] | undefined
): SequenceWorkspaceViewerGroup | null {
  const normalized = compactStrings(items)
  if (!normalized.length) return null

  return {
    id,
    title,
    summary: formatCount(normalized.length, title.replace(/^Selected /, '').replace(/s$/, '')),
    items: normalized
  }
}

function formatRange(range: SequenceStructuredSelection['ranges'][number]): string {
  const strand = range.strand ? ` (${range.strand})` : ''
  return `${formatInteger(range.start)}-${formatInteger(range.end)}${strand}`
}

function formatFeature(feature: NonNullable<SequenceStructuredSelection['features']>[number]): string {
  const id = feature.id ? ` ${feature.id}` : ''
  return `${feature.type}${id}: ${formatInteger(feature.start)}-${formatInteger(feature.end)}`
}

function formatReferenceSummary(
  reference: NonNullable<NonNullable<WorkspaceObservation['sequence']>['references']>[number]
): string {
  const details = compactStrings([
    reference.sequenceLength !== undefined ? `${formatInteger(reference.sequenceLength)} bp/aa` : undefined,
    reference.featureCount !== undefined ? `${formatCount(reference.featureCount, 'feature')}` : undefined,
    reference.intervalCount !== undefined ? `${formatCount(reference.intervalCount, 'interval')}` : undefined,
    reference.variantCount !== undefined ? `${formatCount(reference.variantCount, 'variant')}` : undefined
  ])
  return details.length ? `${reference.id} (${details.join(', ')})` : reference.id
}

function formatObservationFeature(
  feature: NonNullable<NonNullable<WorkspaceObservation['sequence']>['features']>[number]
): string {
  const id = feature.id ? ` ${feature.id}` : ''
  const strand = feature.strand ? ` (${feature.strand})` : ''
  return `${feature.reference}:${feature.type}${id} ${formatInteger(feature.start)}-${formatInteger(feature.end)}${strand}`
}

function formatActionLabel(actionId: string): string {
  if (isExportAction(actionId)) {
    const format = actionId.split(':').at(-1) ?? actionId.split('.').at(-1) ?? actionId
    return `Export ${format.toUpperCase()}`
  }

  const actionName = actionId.split(/[.:]/).filter(Boolean).at(-1) ?? actionId
  return titleCase(actionName.replace(/([a-z])([A-Z])/g, '$1 $2'))
}

function formatSequenceAlphabet(
  alphabet: NonNullable<NonNullable<WorkspaceObservation['sequence']>['alphabet']>
): string {
  if (alphabet === 'dna' || alphabet === 'rna') return alphabet.toUpperCase()
  return titleCase(alphabet)
}

function row(
  id: string,
  label: string,
  value: string,
  description?: string
): SequenceWorkspaceViewerRow {
  return { id, label, value, description }
}

function compactGroups(
  groups: Array<SequenceWorkspaceViewerGroup | null | undefined>
): SequenceWorkspaceViewerGroup[] {
  return groups.filter((group): group is SequenceWorkspaceViewerGroup => Boolean(group))
}

function compactStrings(values: readonly (string | null | undefined | false)[] | undefined): string[] {
  return (values ?? [])
    .map((value) => typeof value === 'string' ? value.trim() : '')
    .filter(Boolean)
}

function formatCount(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value)
}

function formatModality(modality: string): string {
  return titleCase(modality.replace(/[-_]/g, ' '))
}

function titleCase(value: string): string {
  return value
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

function compactClassName(...parts: Array<string | undefined>): string {
  return parts.filter(Boolean).join(' ')
}
