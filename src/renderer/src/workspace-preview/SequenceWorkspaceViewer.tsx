import type { ReactNode } from 'react'
import type {
  WorkspacePreviewEditOperation,
  WorkspaceObservation,
  WorkspaceStructuredSelection
} from '@shared/workspace-preview'

type SequenceStructuredSelection = Extract<WorkspaceStructuredSelection, { kind: 'sequence' }>
export type SequenceWorkspaceViewerSelectOperation = Extract<
  WorkspacePreviewEditOperation,
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
      className={compactClassName('workspace-preview-sequence-viewer', className)}
      data-workspace-preview-sequence-viewer
      data-status={resolvedModel.status.kind}
    >
      <header className="workspace-preview-sequence-viewer__header">
        <div>
          <h3>{resolvedModel.title}</h3>
          {resolvedModel.subtitle ? <p>{resolvedModel.subtitle}</p> : null}
        </div>
      </header>

      {resolvedModel.status.kind !== 'ready' ? (
        <div
          className="workspace-preview-sequence-viewer__state"
          role={statusRole}
          data-state-kind={resolvedModel.status.kind}
        >
          <strong>{resolvedModel.status.title}</strong>
          <p>{resolvedModel.status.message}</p>
        </div>
      ) : (
        <>
          <div
            className="workspace-preview-sequence-viewer__viewport"
            data-sequence-browser-viewport
            role="img"
            aria-label="Bounded sequence map"
          >
            <SequenceBrowserViewport
              browser={resolvedModel.browser}
              fallback={resolvedModel.viewport}
              observation={observation}
              onSetSelection={onSetSelection}
            />
          </div>

          <p className="workspace-preview-sequence-viewer__agent-summary">
            {resolvedModel.agentSummary}
          </p>

          <section
            className="workspace-preview-sequence-viewer__section"
            aria-label="Sequence summary"
          >
            <h4>Sequence</h4>
            <dl>
              {resolvedModel.sequenceRows.map((row) => (
                <div key={row.id}>
                  <dt>{row.label}</dt>
                  <dd>
                    {row.value}
                    {row.description ? <small>{row.description}</small> : null}
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          <section
            className="workspace-preview-sequence-viewer__section"
            aria-label="Sequence selection"
            data-selection-kind={resolvedModel.selection.kind}
          >
            <h4>Selection</h4>
            <p>{resolvedModel.selection.summary}</p>
            {resolvedModel.selection.groups.length ? (
              <dl>
                {resolvedModel.selection.groups.map((group) => (
                  <div key={group.id}>
                    <dt>{group.title}</dt>
                    <dd>
                      {group.items.join(', ')}
                      <small>{group.summary}</small>
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </section>

          <section
            className="workspace-preview-sequence-viewer__section"
            aria-label="Sequence actions"
          >
            <h4>Actions</h4>
            {resolvedModel.actions.length ? (
              <ul>
                {resolvedModel.actions.map((action) => (
                  <li
                    key={action.id}
                    data-action-id={action.id}
                    data-action-kind={action.kind}
                  >
                    {action.label}
                  </li>
                ))}
              </ul>
            ) : (
              <p>No select, search, export, or inspect actions are available.</p>
            )}
          </section>
        </>
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
  fallback,
  observation,
  onSetSelection
}: {
  browser: SequenceWorkspaceViewerBrowserModel
  fallback: SequenceWorkspaceViewerModel['viewport']
  observation?: WorkspaceObservation | null
  onSetSelection?: SequenceWorkspaceViewerSelectHandler
}): ReactNode {
  if (browser.kind !== 'map') {
    return (
      <div
        className="workspace-preview-sequence-viewer__browser-empty"
        data-sequence-browser-empty
      >
        <strong>{browser.title || fallback.title}</strong>
        <p>{browser.message || fallback.message}</p>
      </div>
    )
  }

  return (
    <figure
      className="workspace-preview-sequence-viewer__browser"
      data-sequence-browser-map
      data-sequence-reference={browser.reference}
      data-sequence-start={browser.start}
      data-sequence-end={browser.end}
    >
      <svg viewBox="0 0 1000 150" role="presentation" aria-hidden="true">
        <line x1="24" y1="38" x2="976" y2="38" stroke="currentColor" strokeWidth="3" opacity="0.35" />
        <text x="24" y="20">{browser.reference}</text>
        <text x="976" y="20" textAnchor="end">{formatInteger(browser.end)}</text>
        {browser.indexedRanges.map((range) => (
          <rect
            key={range.id}
            x={range.x}
            y="30"
            width={range.width}
            height="16"
            rx="3"
            data-sequence-indexed-range={range.id}
            data-range-kind={range.kind ?? ''}
          >
            <title>{range.label}: {formatInteger(range.start)}-{formatInteger(range.end)}</title>
          </rect>
        ))}
        {browser.selectedRanges.map((range) => (
          <rect
            key={range.id}
            x={range.x}
            y="62"
            width={range.width}
            height="22"
            rx="4"
            data-sequence-selected-range={range.id}
            data-strand={range.strand ?? ''}
          >
            <title>{range.label}</title>
          </rect>
        ))}
        {browser.features.map((feature) => (
          <rect
            key={feature.id}
            x={feature.x}
            y="100"
            width={feature.width}
            height="18"
            rx="3"
            data-sequence-feature={feature.id}
            data-feature-type={feature.kind ?? ''}
            data-strand={feature.strand ?? ''}
          >
            <title>{feature.label}</title>
          </rect>
        ))}
      </svg>
      <figcaption>
        {browser.summary}
        {browser.truncated ? <small>Bounded preview; omitted sequence records may not be shown.</small> : null}
      </figcaption>
      {browser.indexedRanges.length || browser.features.length || browser.selectedRanges.length ? (
        <ol className="workspace-preview-sequence-viewer__markers" data-sequence-marker-list>
          {[...browser.selectedRanges, ...browser.features, ...browser.indexedRanges].map((marker) => (
            <li key={`${marker.id}:${marker.start}:${marker.end}`}>
              <button
                type="button"
                disabled={!observation || !onSetSelection}
                data-sequence-marker
                data-sequence-marker-kind={marker.kind ?? ''}
                data-sequence-marker-reference={browser.reference}
                data-sequence-marker-start={marker.start}
                data-sequence-marker-end={marker.end}
                data-sequence-marker-id={marker.id}
                data-sequence-marker-type={marker.kind ?? ''}
                data-sequence-marker-strand={marker.strand ?? ''}
                data-selected={isMarkerSelected(marker, browser.selectedRanges) ? 'true' : 'false'}
                onClick={() => {
                  if (!observation) return
                  void onSetSelection?.(createSequenceMarkerSelectionOperation(observation, browser.reference, marker))
                }}
              >
                {marker.label}
              </button>
            </li>
          ))}
        </ol>
      ) : null}
    </figure>
  )
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
