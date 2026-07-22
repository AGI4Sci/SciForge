import type { ReactNode } from 'react'
import type {
  LifeScienceStructuredSelection as WorkspaceStructuredSelection,
  LifeScienceWorkspaceObservation as WorkspaceObservation
} from '../wire'

type OmicsStructuredSelection = Extract<WorkspaceStructuredSelection, { kind: 'omics' }>
type OmicsSelectionRange = NonNullable<OmicsStructuredSelection['ranges']>[number]
type OmicsAxis = OmicsSelectionRange['axis']

export type OmicsWorkspaceViewerStatus =
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

export type OmicsWorkspaceViewerRow = {
  id: string
  label: string
  value: string
  description?: string
}

export type OmicsWorkspaceViewerGroup = {
  id: string
  title: string
  summary: string
  items: string[]
}

export type OmicsWorkspaceViewerActionKind = 'select' | 'preview' | 'inspect' | 'export' | 'other'

export type OmicsWorkspaceViewerAction = {
  id: string
  label: string
  kind: OmicsWorkspaceViewerActionKind
}

export type OmicsWorkspaceViewerSelectionModel = {
  kind: 'none' | 'omics' | 'unsupported'
  summary: string
  groups: OmicsWorkspaceViewerGroup[]
}

export type OmicsWorkspaceViewerChip = {
  id: string
  label: string
  selected: boolean
}

export type OmicsWorkspaceViewerAxis = {
  axis: 'obs' | 'var'
  label: string
  count?: number
  countLabel: string
  selectedKeyCount: number
}

export type OmicsWorkspaceViewerRange = {
  id: string
  label: string
  matrixId: string
  axis: OmicsAxis
  start: number
  end: number
  axisLength?: number
  clipped: boolean
}

export type OmicsWorkspaceViewerOverview = {
  title: string
  summary: string
  shape?: [number, number]
  shapeLabel: string
  dataShape: string
  matrixOptions: OmicsWorkspaceViewerChip[]
  axes: OmicsWorkspaceViewerAxis[]
  obsKeys: OmicsWorkspaceViewerChip[]
  varKeys: OmicsWorkspaceViewerChip[]
  embeddings: OmicsWorkspaceViewerChip[]
  metadataKeys: OmicsWorkspaceViewerChip[]
  selectedRanges: OmicsWorkspaceViewerRange[]
}

export type OmicsWorkspaceViewerModel = {
  status: OmicsWorkspaceViewerStatus
  title: string
  subtitle?: string
  viewport: {
    title: string
    message: string
  }
  overview: OmicsWorkspaceViewerOverview
  agentSummary: string
  matrixRows: OmicsWorkspaceViewerRow[]
  selection: OmicsWorkspaceViewerSelectionModel
  actions: OmicsWorkspaceViewerAction[]
}

export type OmicsWorkspaceViewerProps = {
  observation?: WorkspaceObservation | null
  model?: OmicsWorkspaceViewerModel
  className?: string
}

const OMICS_ACTION_LABELS: Record<string, string> = {
  'workspace.setSelection': 'Select',
  'omics.preview': 'Preview Matrix',
  'omics.inspectMetadata': 'Inspect Metadata',
  'omics.declareCapabilities': 'Show Capabilities',
  'omics.selectDataset': 'Select Dataset'
}

export function buildOmicsWorkspaceViewerModel(
  observation: WorkspaceObservation | null | undefined
): OmicsWorkspaceViewerModel {
  if (!observation) {
    return createInactiveModel({
      kind: 'empty',
      title: 'No omics observation',
      message: 'Open an omics matrix workspace preview to populate this baseline viewer.'
    })
  }

  const hasOmicsContext = observation.view.modality === 'omics' ||
    Boolean(observation.omics) ||
    observation.selection?.kind === 'omics'

  if (!hasOmicsContext) {
    return createInactiveModel({
      kind: 'unsupported',
      title: 'Unsupported observation',
      message: `${formatModality(observation.view.modality)} observations cannot be rendered by the omics viewer.`
    }, observation)
  }

  const selection = buildOmicsSelectionModel(observation.selection)
  const overview = buildOmicsMatrixOverview(observation)
  const matrixRows = buildMatrixRows(observation, selection)
  const actions = buildOmicsActions(observation.actions)
  const agentSummary = buildAgentSummary({ observation, overview, selection, actions })

  return {
    status: {
      kind: 'ready',
      title: 'Omics metadata ready',
      message: 'Metadata-only matrix overview is available without loading matrix payloads.'
    },
    title: observation.view.title || basename(observation.file.path) || 'Omics matrix',
    subtitle: compactStrings([
      observation.view.pluginId,
      formatModality(observation.view.modality),
      titleCase(observation.view.mode)
    ]).join(' | '),
    viewport: {
      title: 'Matrix overview',
      message: observation.omics
        ? 'Omics summary metadata is rendered without heatmap, scatter, embedding coordinates, or binary payload access.'
        : 'Waiting for omics matrix summary metadata from the preview worker.'
    },
    overview,
    agentSummary,
    matrixRows,
    selection,
    actions
  }
}

export function OmicsWorkspaceViewer({
  observation,
  model,
  className
}: OmicsWorkspaceViewerProps): ReactNode {
  const resolvedModel = model ?? buildOmicsWorkspaceViewerModel(observation)
  const statusRole = resolvedModel.status.kind === 'unsupported' ? 'alert' : 'status'

  return (
    <section
      className={compactClassName('workspace-preview-omics-viewer', className)}
      data-workspace-preview-omics-viewer
      data-status={resolvedModel.status.kind}
    >
      <header className="workspace-preview-omics-viewer__header">
        <div>
          <h3>{resolvedModel.title}</h3>
          {resolvedModel.subtitle ? <p>{resolvedModel.subtitle}</p> : null}
        </div>
      </header>

      {resolvedModel.status.kind !== 'ready' ? (
        <div
          className="workspace-preview-omics-viewer__state"
          role={statusRole}
          data-state-kind={resolvedModel.status.kind}
        >
          <strong>{resolvedModel.status.title}</strong>
          <p>{resolvedModel.status.message}</p>
        </div>
      ) : (
        <>
          <OmicsMatrixOverview
            overview={resolvedModel.overview}
            fallback={resolvedModel.viewport}
          />

          <p className="workspace-preview-omics-viewer__agent-summary">
            {resolvedModel.agentSummary}
          </p>

          <section
            className="workspace-preview-omics-viewer__section"
            aria-label="Omics matrix summary"
          >
            <h4>Matrix</h4>
            <dl>
              {resolvedModel.matrixRows.map((row) => (
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
            className="workspace-preview-omics-viewer__section"
            aria-label="Omics selection"
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
            className="workspace-preview-omics-viewer__section"
            aria-label="Omics actions"
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
              <p>No select, preview, inspect, or export actions are available.</p>
            )}
          </section>
        </>
      )}
    </section>
  )
}

function createInactiveModel(
  status: Extract<OmicsWorkspaceViewerStatus, { kind: 'empty' | 'unsupported' }>,
  observation?: WorkspaceObservation
): OmicsWorkspaceViewerModel {
  return {
    status,
    title: observation?.view.title || 'Omics viewer',
    subtitle: observation ? compactStrings([
      observation.view.pluginId,
      formatModality(observation.view.modality),
      titleCase(observation.view.mode)
    ]).join(' | ') : undefined,
    viewport: {
      title: 'Matrix overview',
      message: 'No omics viewport is active.'
    },
    overview: createEmptyOverview(),
    agentSummary: status.message,
    matrixRows: [],
    selection: {
      kind: 'none',
      summary: 'No omics selection.',
      groups: []
    },
    actions: []
  }
}

export function buildOmicsMatrixOverview(
  observation: WorkspaceObservation
): OmicsWorkspaceViewerOverview {
  const omics = observation.omics
  const selection = observation.selection?.kind === 'omics' ? observation.selection : undefined
  const ranges = selection?.ranges ?? []
  const selectedMatrixIds = mergeUnique([
    ...(selection?.matrixIds ?? []),
    ...ranges.map((range) => range.matrixId)
  ])

  const shape = omics?.matrixShape
  const obsCount = typeof omics?.observationCount === 'number' ? omics.observationCount : shape?.[0]
  const varCount = typeof omics?.variableCount === 'number' ? omics.variableCount : shape?.[1]
  const matrixOptions = createChips(
    mergeUnique([...(omics?.matrixIds ?? []), ...selectedMatrixIds]),
    selectedMatrixIds
  )
  const obsKeys = createChips(mergeUnique([...(omics?.obsKeys ?? []), ...(selection?.obsKeys ?? [])]), selection?.obsKeys)
  const varKeys = createChips(mergeUnique([...(omics?.varKeys ?? []), ...(selection?.varKeys ?? [])]), selection?.varKeys)
  const embeddings = createChips(
    mergeUnique([...(omics?.embeddings ?? []), ...(selection?.embeddings ?? [])]),
    selection?.embeddings
  )
  const metadataKeys = createChips(omics?.metadataKeys, [])
  const selectedRanges = ranges.map((range, index) => ({
    id: `selected-range-${index + 1}`,
    label: formatRange(range),
    matrixId: range.matrixId,
    axis: range.axis,
    start: range.start,
    end: range.end,
    axisLength: range.axisLength,
    clipped: Boolean(range.clipped)
  }))
  const axes: OmicsWorkspaceViewerAxis[] = [
    {
      axis: 'obs',
      label: 'Observations',
      count: obsCount,
      countLabel: typeof obsCount === 'number' ? formatInteger(obsCount) : 'Not reported',
      selectedKeyCount: obsKeys.filter((key) => key.selected).length
    },
    {
      axis: 'var',
      label: 'Variables',
      count: varCount,
      countLabel: typeof varCount === 'number' ? formatInteger(varCount) : 'Not reported',
      selectedKeyCount: varKeys.filter((key) => key.selected).length
    }
  ]
  const summaryParts = compactStrings([
    omics?.format,
    shape ? formatShape(shape) : undefined,
    matrixOptions.length ? formatCount(matrixOptions.length, 'matrix option') : undefined,
    typeof obsCount === 'number' ? formatCount(obsCount, 'observation') : undefined,
    typeof varCount === 'number' ? formatCount(varCount, 'variable') : undefined,
    embeddings.length ? formatCount(embeddings.length, 'embedding') : undefined,
    metadataKeys.length ? formatCount(metadataKeys.length, 'metadata key') : undefined,
    selectedRanges.length ? formatCount(selectedRanges.length, 'selected range') : undefined
  ])

  return {
    title: 'Metadata-only matrix overview',
    summary: summaryParts.length
      ? `${summaryParts.join(', ')}. No heatmap, scatter, embedding coordinates, or binary matrix payload is loaded.`
      : 'No omics matrix metadata has been reported yet.',
    shape,
    shapeLabel: shape ? formatShape(shape) : 'Not reported',
    dataShape: shape ? `${shape[0]}x${shape[1]}` : 'unknown',
    matrixOptions,
    axes,
    obsKeys,
    varKeys,
    embeddings,
    metadataKeys,
    selectedRanges
  }
}

function OmicsMatrixOverview({
  overview,
  fallback
}: {
  overview: OmicsWorkspaceViewerOverview
  fallback: OmicsWorkspaceViewerModel['viewport']
}): ReactNode {
  return (
    <section
      className="workspace-preview-omics-viewer__viewport"
      data-omics-matrix-overview="true"
      data-matrix-shape={overview.dataShape}
      role="group"
      aria-label="Omics metadata matrix overview"
    >
      <header>
        <strong>{overview.title || fallback.title}</strong>
        <p>{fallback.message}</p>
      </header>

      <dl className="workspace-preview-omics-viewer__overview-facts">
        <div>
          <dt>Shape</dt>
          <dd data-matrix-shape={overview.dataShape}>{overview.shapeLabel}</dd>
        </div>
        {overview.axes.map((axis) => (
          <div
            key={axis.axis}
            data-omics-axis={axis.axis}
            data-axis-count={axis.count ?? 'unknown'}
          >
            <dt>{axis.label}</dt>
            <dd>
              {axis.countLabel}
              {axis.selectedKeyCount ? <small>{formatCount(axis.selectedKeyCount, 'selected key')}</small> : null}
            </dd>
          </div>
        ))}
      </dl>

      <div className="workspace-preview-omics-viewer__overview-grid">
        <OmicsChipList
          title="Matrix options"
          empty="No matrix IDs reported."
          chips={overview.matrixOptions}
          dataAttribute="data-omics-matrix-option"
          extraData={(chip) => ({ 'data-matrix-id': chip.id })}
        />
        <OmicsChipList
          title="Observation keys"
          empty="No obs keys reported."
          chips={overview.obsKeys}
          dataAttribute="data-omics-obs-key"
        />
        <OmicsChipList
          title="Variable keys"
          empty="No var keys reported."
          chips={overview.varKeys}
          dataAttribute="data-omics-var-key"
        />
        <OmicsChipList
          title="Embeddings"
          empty="No embeddings reported."
          chips={overview.embeddings}
          dataAttribute="data-omics-embedding"
        />
        <OmicsChipList
          title="Metadata keys"
          empty="No metadata keys reported."
          chips={overview.metadataKeys}
          dataAttribute="data-omics-metadata-key"
        />
      </div>

      <section
        className="workspace-preview-omics-viewer__overview-ranges"
        aria-label="Selected omics ranges"
      >
        <h4>Selected ranges</h4>
        {overview.selectedRanges.length ? (
          <ol>
            {overview.selectedRanges.map((range) => (
              <li
                key={range.id}
                data-omics-selected-range={range.id}
                data-matrix-id={range.matrixId}
                data-omics-axis={range.axis}
                data-axis-count={range.axisLength ?? 'unknown'}
                data-range-start={range.start}
                data-range-end={range.end}
                data-clipped={range.clipped ? 'true' : 'false'}
              >
                {range.label}
              </li>
            ))}
          </ol>
        ) : (
          <p>No selected omics ranges.</p>
        )}
      </section>

      <p>{overview.summary}</p>
    </section>
  )
}

function OmicsChipList({
  title,
  empty,
  chips,
  dataAttribute,
  extraData
}: {
  title: string
  empty: string
  chips: OmicsWorkspaceViewerChip[]
  dataAttribute: string
  extraData?: (chip: OmicsWorkspaceViewerChip) => Record<string, string>
}): ReactNode {
  return (
    <section
      className="workspace-preview-omics-viewer__overview-chip-section"
      aria-label={title}
    >
      <h4>{title}</h4>
      {chips.length ? (
        <ul>
          {chips.map((chip) => (
            <li
              key={chip.id}
              {...{ [dataAttribute]: chip.id }}
              {...(extraData?.(chip) ?? {})}
              data-selected={chip.selected ? 'true' : 'false'}
            >
              {chip.label}
            </li>
          ))}
        </ul>
      ) : (
        <p>{empty}</p>
      )}
    </section>
  )
}

function buildMatrixRows(
  observation: WorkspaceObservation,
  selection: OmicsWorkspaceViewerSelectionModel
): OmicsWorkspaceViewerRow[] {
  const omics = observation.omics
  const omicsSelection = observation.selection?.kind === 'omics' ? observation.selection : undefined
  const selectedMatrices = compactStrings(omicsSelection?.matrixIds)
  const selectedEmbeddings = compactStrings(omicsSelection?.embeddings)
  const rows: OmicsWorkspaceViewerRow[] = [
    row(
      'matrix-shape',
      'Matrix shape',
      omics?.matrixShape ? formatShape(omics.matrixShape) : 'Not reported',
      selectedMatrices.length ? `Selected matrices: ${selectedMatrices.join(', ')}` : undefined
    ),
    row(
      'observations',
      'Observations',
      typeof omics?.observationCount === 'number' ? formatInteger(omics.observationCount) : 'Not reported',
      omicsSelection?.obsKeys?.length ? `Selected obs keys: ${omicsSelection.obsKeys.join(', ')}` : undefined
    ),
    row(
      'variables',
      'Variables',
      typeof omics?.variableCount === 'number' ? formatInteger(omics.variableCount) : 'Not reported',
      omicsSelection?.varKeys?.length ? `Selected var keys: ${omicsSelection.varKeys.join(', ')}` : undefined
    ),
    row(
      'embeddings',
      'Embeddings',
      joinList(omics?.embeddings),
      selectedEmbeddings.length ? `Selected embeddings: ${selectedEmbeddings.join(', ')}` : undefined
    )
  ]

  if (omicsSelection?.ranges?.length) {
    rows.push(row(
      'selected-ranges',
      'Selected ranges',
      formatCount(omicsSelection.ranges.length, 'range'),
      omicsSelection.ranges.map(formatRange).join(', ')
    ))
  }

  if (!omics && selection.kind === 'none') {
    rows.push(row('summary', 'Summary', 'No omics matrix summary reported yet.'))
  }

  return rows
}

function buildOmicsSelectionModel(
  selection: WorkspaceStructuredSelection | undefined
): OmicsWorkspaceViewerSelectionModel {
  if (!selection) {
    return {
      kind: 'none',
      summary: 'No omics selection.',
      groups: []
    }
  }

  if (selection.kind !== 'omics') {
    return {
      kind: 'unsupported',
      summary: `${titleCase(selection.kind)} selection is active outside the omics viewer.`,
      groups: []
    }
  }

  const ranges = selection.ranges?.map(formatRange) ?? []
  const groups = compactGroups([
    createSelectionGroup('matrix-ids', 'Selected matrices', selection.matrixIds),
    createSelectionGroup('obs-keys', 'Selected obs keys', selection.obsKeys),
    createSelectionGroup('var-keys', 'Selected var keys', selection.varKeys),
    createSelectionGroup('embeddings', 'Selected embeddings', selection.embeddings),
    createSelectionGroup('ranges', 'Selected ranges', ranges)
  ])
  const summaryParts = compactStrings([
    selection.matrixIds?.length ? formatCount(selection.matrixIds.length, 'matrix', 'matrices') : undefined,
    selection.obsKeys?.length ? formatCount(selection.obsKeys.length, 'obs key') : undefined,
    selection.varKeys?.length ? formatCount(selection.varKeys.length, 'var key') : undefined,
    selection.embeddings?.length ? formatCount(selection.embeddings.length, 'embedding') : undefined,
    ranges.length ? formatCount(ranges.length, 'range') : undefined
  ])

  return {
    kind: 'omics',
    summary: summaryParts.length ? `Selected ${summaryParts.join(', ')}.` : 'Omics selection is empty.',
    groups
  }
}

function buildOmicsActions(actions: readonly string[]): OmicsWorkspaceViewerAction[] {
  const resolved = new Map<string, OmicsWorkspaceViewerAction>()

  for (const actionId of actions) {
    const kind = classifyOmicsAction(actionId)
    if (!kind) continue

    resolved.set(actionId, {
      id: actionId,
      label: OMICS_ACTION_LABELS[actionId] ?? formatActionLabel(actionId),
      kind
    })
  }

  return [...resolved.values()]
}

function classifyOmicsAction(actionId: string): OmicsWorkspaceViewerActionKind | null {
  if (actionId === 'workspace.setSelection' || /(^|[.:])select/i.test(actionId) || /selection/i.test(actionId)) {
    return 'select'
  }
  if (/preview|matrix/i.test(actionId)) return 'preview'
  if (/inspect|metadata|capabilities/i.test(actionId)) return 'inspect'
  if (isExportAction(actionId)) return 'export'
  if (actionId.startsWith('omics.')) return 'other'
  return null
}

function buildAgentSummary(input: {
  observation: WorkspaceObservation
  overview: OmicsWorkspaceViewerOverview
  selection: OmicsWorkspaceViewerSelectionModel
  actions: OmicsWorkspaceViewerAction[]
}): string {
  const { observation, overview, selection, actions } = input
  const omics = observation.omics
  const parts = compactStrings([
    omics?.matrixShape ? `shape ${formatShape(omics.matrixShape)}` : undefined,
    overview.matrixOptions.length ? `matrix options: ${overview.matrixOptions.map((matrix) => matrix.label).join(', ')}` : undefined,
    typeof omics?.observationCount === 'number' ? formatCount(omics.observationCount, 'observation') : undefined,
    typeof omics?.variableCount === 'number' ? formatCount(omics.variableCount, 'variable') : undefined,
    omics?.embeddings?.length ? `embeddings: ${joinList(omics.embeddings)}` : undefined,
    overview.metadataKeys.length ? `metadata keys: ${overview.metadataKeys.map((key) => key.label).join(', ')}` : undefined,
    overview.selectedRanges.length ? `ranges: ${overview.selectedRanges.map((range) => range.label).join(', ')}` : undefined,
    selection.kind === 'omics' ? `selection: ${selection.summary}` : undefined,
    'preview: metadata-only matrix overview',
    actions.length ? `actions: ${actions.map((action) => action.label).join(', ')}` : undefined
  ])

  return parts.length ? parts.join('; ') : 'Omics observation ready without reported matrix details.'
}

function createSelectionGroup(
  id: string,
  title: string,
  items: readonly string[] | undefined
): OmicsWorkspaceViewerGroup | null {
  const normalized = compactStrings(items)
  if (!normalized.length) return null

  return {
    id,
    title,
    summary: formatCount(normalized.length, title.replace(/^Selected /, '').replace(/s$/, '')),
    items: normalized
  }
}

function formatRange(range: NonNullable<OmicsStructuredSelection['ranges']>[number]): string {
  const name = range.matrixName || range.matrixId
  const axisLength = typeof range.axisLength === 'number' ? ` of ${formatInteger(range.axisLength)}` : ''
  const clipped = range.clipped ? ' (clipped)' : ''
  return `${name} ${range.axis} ${formatInteger(range.start)}-${formatInteger(range.end)}${axisLength}${clipped}`
}

function createEmptyOverview(): OmicsWorkspaceViewerOverview {
  return {
    title: 'Metadata-only matrix overview',
    summary: 'No omics matrix metadata has been reported yet.',
    shapeLabel: 'Not reported',
    dataShape: 'unknown',
    matrixOptions: [],
    axes: [
      {
        axis: 'obs',
        label: 'Observations',
        countLabel: 'Not reported',
        selectedKeyCount: 0
      },
      {
        axis: 'var',
        label: 'Variables',
        countLabel: 'Not reported',
        selectedKeyCount: 0
      }
    ],
    obsKeys: [],
    varKeys: [],
    embeddings: [],
    metadataKeys: [],
    selectedRanges: []
  }
}

function createChips(
  values: readonly string[] | undefined,
  selectedValues: readonly string[] | undefined
): OmicsWorkspaceViewerChip[] {
  const selected = new Set(compactStrings(selectedValues))

  return compactStrings(values).map((value) => ({
    id: value,
    label: value,
    selected: selected.has(value)
  }))
}

function mergeUnique(values: readonly (string | null | undefined | false)[]): string[] {
  return [...new Set(compactStrings(values))]
}

function formatShape(shape: NonNullable<NonNullable<WorkspaceObservation['omics']>['matrixShape']>): string {
  return `${formatInteger(shape[0])} x ${formatInteger(shape[1])}`
}

function formatActionLabel(actionId: string): string {
  if (isExportAction(actionId)) {
    const format = actionId.split(':').at(-1) ?? actionId.split('.').at(-1) ?? actionId
    return `Export ${format.toUpperCase()}`
  }

  const actionName = actionId.split(/[.:]/).filter(Boolean).at(-1) ?? actionId
  return titleCase(actionName.replace(/([a-z])([A-Z])/g, '$1 $2'))
}

function isExportAction(actionId: string): boolean {
  return actionId.startsWith('workspace.export:') || /^export[:.]/i.test(actionId) || /(^|[.:])export/i.test(actionId)
}

function row(
  id: string,
  label: string,
  value: string,
  description?: string
): OmicsWorkspaceViewerRow {
  return { id, label, value, description }
}

function compactGroups(
  groups: Array<OmicsWorkspaceViewerGroup | null | undefined>
): OmicsWorkspaceViewerGroup[] {
  return groups.filter((group): group is OmicsWorkspaceViewerGroup => Boolean(group))
}

function compactStrings(values: readonly (string | null | undefined | false)[] | undefined): string[] {
  return (values ?? [])
    .map((value) => typeof value === 'string' ? value.trim() : '')
    .filter(Boolean)
}

function joinList(values: readonly string[] | undefined): string {
  const compacted = compactStrings(values)
  return compacted.length ? compacted.join(', ') : 'Not reported'
}

function formatCount(count: number, singular: string, plural = `${singular}s`): string {
  return `${formatInteger(count)} ${count === 1 ? singular : plural}`
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
