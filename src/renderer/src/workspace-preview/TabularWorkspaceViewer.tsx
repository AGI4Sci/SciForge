import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type {
  WorkspaceObservation,
  WorkspacePreviewEditOperation,
  WorkspaceStructuredSelection
} from '@shared/workspace-preview'
import './TabularWorkspaceViewer.css'

type TabularStructuredSelection = Extract<WorkspaceStructuredSelection, { kind: 'tabular' }>
export type TabularWorkspaceViewerUpdateCellOperation = Extract<
  WorkspacePreviewEditOperation,
  { kind: 'tabular.updateCell' }
>
export type TabularWorkspaceViewerInsertRowsOperation = Extract<
  WorkspacePreviewEditOperation,
  { kind: 'tabular.insertRows' }
>
export type TabularWorkspaceViewerInsertColumnsOperation = Extract<
  WorkspacePreviewEditOperation,
  { kind: 'tabular.insertColumns' }
>
export type TabularWorkspaceViewerDeleteRowsOperation = Extract<
  WorkspacePreviewEditOperation,
  { kind: 'tabular.deleteRows' }
>
export type TabularWorkspaceViewerDeleteColumnsOperation = Extract<
  WorkspacePreviewEditOperation,
  { kind: 'tabular.deleteColumns' }
>
export type TabularWorkspaceViewerApplyEditOperation =
  | TabularWorkspaceViewerUpdateCellOperation
  | TabularWorkspaceViewerInsertRowsOperation
  | TabularWorkspaceViewerInsertColumnsOperation
  | TabularWorkspaceViewerDeleteRowsOperation
  | TabularWorkspaceViewerDeleteColumnsOperation
export type TabularWorkspaceViewerApplyEditHandler = (
  operation: TabularWorkspaceViewerApplyEditOperation
) => void | Promise<void>
export type TabularWorkspaceViewerEditDraft = {
  row: number
  column: number
  value: string
}
export type TabularWorkspaceViewerInsertRowsDraft = {
  afterRow: number
  values: string[]
}
export type TabularWorkspaceViewerInsertColumnsDraft = {
  afterColumn: number
  values: string[]
}
export type TabularWorkspaceViewerDeleteDraft =
  | {
      kind: 'rows'
      rows: number[]
    }
  | {
      kind: 'columns'
      columns: number[]
    }

export type TabularWorkspaceViewerStatus =
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

export type TabularWorkspaceViewerTableRow = {
  id: string
  name: string
  rowCount: string
  columnCount: string
  summary: string
}

export type TabularWorkspaceViewerGroup = {
  id: string
  title: string
  summary: string
  items: string[]
}

export type TabularWorkspaceViewerVisibleTextModel = {
  kind: 'none' | 'reported'
  summary: string
  lines: string[]
}

export type TabularWorkspaceViewerSortDirection = 'asc' | 'desc'

export type TabularWorkspaceViewerGridState = {
  filterText?: string
  sort?: {
    columnIndex: number
    direction: TabularWorkspaceViewerSortDirection
  } | null
}

export type TabularWorkspaceViewerGridFilterModel = {
  text: string
  active: boolean
  matchedRowCount: number
  sourceRowCount: number
  summary: string
}

export type TabularWorkspaceViewerGridSortModel = {
  columnIndex: number | null
  columnLabel: string | null
  direction: TabularWorkspaceViewerSortDirection | 'none'
  summary: string
}

export type TabularWorkspaceViewerGridModel = {
  kind: 'none' | 'preview'
  summary: string
  stateSummary: string
  header: string[]
  rows: Array<{
    id: string
    index: number
    values: string[]
  }>
  filter: TabularWorkspaceViewerGridFilterModel
  sort: TabularWorkspaceViewerGridSortModel
  truncatedRows: boolean
  truncatedColumns: boolean
}

export type TabularWorkspaceViewerActionKind =
  | 'preview'
  | 'inspect'
  | 'filter'
  | 'sort'
  | 'select'
  | 'edit'
  | 'insert'
  | 'export'
  | 'other'

export type TabularWorkspaceViewerAction = {
  id: string
  label: string
  kind: TabularWorkspaceViewerActionKind
  enabled: boolean
  reason?: string
}

export type TabularWorkspaceViewerSelectionModel = {
  kind: 'none' | 'tabular' | 'unsupported'
  summary: string
  groups: TabularWorkspaceViewerGroup[]
}

export type TabularWorkspaceViewerModel = {
  status: TabularWorkspaceViewerStatus
  title: string
  subtitle?: string
  viewport: {
    title: string
    message: string
  }
  grid: TabularWorkspaceViewerGridModel
  agentSummary: string
  tables: TabularWorkspaceViewerTableRow[]
  selection: TabularWorkspaceViewerSelectionModel
  visibleText: TabularWorkspaceViewerVisibleTextModel
  actions: TabularWorkspaceViewerAction[]
}

export type TabularWorkspaceViewerProps = {
  observation?: WorkspaceObservation | null
  model?: TabularWorkspaceViewerModel
  className?: string
  onApplyEdit?: TabularWorkspaceViewerApplyEditHandler
}

export type TabularWorkspaceViewerCellEditorProps = TabularWorkspaceViewerEditDraft & {
  observation?: WorkspaceObservation | null
  unavailableReason?: string
  onValueChange: (value: string) => void
  onApplyEdit?: TabularWorkspaceViewerApplyEditHandler
  onCancel: () => void
}

export type TabularWorkspaceViewerRowInsertEditorProps = TabularWorkspaceViewerInsertRowsDraft & {
  observation?: WorkspaceObservation | null
  header: readonly string[]
  rows: TabularWorkspaceViewerGridModel['rows']
  unavailableReason?: string
  onAfterRowChange: (afterRow: number) => void
  onValueChange: (columnIndex: number, value: string) => void
  onApplyEdit?: TabularWorkspaceViewerApplyEditHandler
  onCancel: () => void
}

export type TabularWorkspaceViewerColumnInsertEditorProps = TabularWorkspaceViewerInsertColumnsDraft & {
  observation?: WorkspaceObservation | null
  header: readonly string[]
  rows: TabularWorkspaceViewerGridModel['rows']
  unavailableReason?: string
  onAfterColumnChange: (afterColumn: number) => void
  onValueChange: (valueIndex: number, value: string) => void
  onApplyEdit?: TabularWorkspaceViewerApplyEditHandler
  onCancel: () => void
}

export type TabularWorkspaceViewerDeleteEditorProps = TabularWorkspaceViewerDeleteDraft & {
  observation?: WorkspaceObservation | null
  unavailableReason?: string
  onApplyEdit?: TabularWorkspaceViewerApplyEditHandler
  onCancel: () => void
}

const TABULAR_ACTION_LABELS: Record<string, string> = {
  'workspace.setSelection': 'Select',
  'tabular.preview': 'Preview Table',
  'tabular.inspectColumns': 'Inspect Columns',
  'tabular.filterRows': 'Filter Rows',
  'tabular.sortRows': 'Sort Rows',
  'tabular.selectCells': 'Select Cells',
  'tabular.updateCell': 'Update Cell',
  'tabular.insertRows': 'Insert Rows',
  'tabular.insertColumns': 'Insert Columns',
  'tabular.deleteRows': 'Delete Rows',
  'tabular.deleteColumns': 'Delete Columns'
}

const MAX_VISIBLE_TEXT_LINES = 8
const MAX_VISIBLE_TEXT_LINE_CHARS = 180
const MAX_CELL_VALUE_CHARS = 80
const MAX_FILTER_SUMMARY_CHARS = 60

export function buildTabularWorkspaceViewerModel(
  observation: WorkspaceObservation | null | undefined,
  gridState: TabularWorkspaceViewerGridState = {}
): TabularWorkspaceViewerModel {
  if (!observation) {
    return createInactiveModel({
      kind: 'empty',
      title: 'No tabular observation',
      message: 'Open a CSV, TSV, or JSONL workspace preview to populate this baseline viewer.'
    })
  }

  const hasTabularContext = observation.view.modality === 'tabular' ||
    Boolean(observation.tables?.length) ||
    observation.selection?.kind === 'tabular'

  if (!hasTabularContext) {
    return createInactiveModel({
      kind: 'unsupported',
      title: 'Unsupported observation',
      message: `${formatModality(observation.view.modality)} observations cannot be rendered by the tabular viewer.`
    }, observation)
  }

  const selection = buildTabularSelectionModel(observation.selection)
  const tables = buildTableRows(observation)
  const grid = buildGridModel(observation, gridState)
  const visibleText = buildVisibleTextModel(observation.visibleText, grid)
  const actions = buildTabularActions(observation.actions)
  const agentSummary = buildAgentSummary({
    grid,
    tables,
    selection,
    visibleText,
    actions
  })

  return {
    status: {
      kind: 'ready',
      title: 'Tabular baseline ready',
      message: 'A future grid/editor can mount into the placeholder viewport.'
    },
    title: observation.view.title || basename(observation.file.path) || 'Tabular workspace',
    subtitle: compactStrings([
      observation.view.pluginId,
      formatModality(observation.view.modality),
      titleCase(observation.view.mode)
    ]).join(' | '),
    viewport: {
      title: grid.kind === 'preview' ? 'Bounded preview grid' : 'Grid/editor mount point',
      message: grid.summary
    },
    grid,
    agentSummary,
    tables,
    selection,
    visibleText,
    actions
  }
}

export function createTabularUpdateCellOperation(input: {
  observation: WorkspaceObservation
  row: number
  column: number
  value: string
}): TabularWorkspaceViewerUpdateCellOperation {
  return {
    kind: 'tabular.updateCell',
    path: input.observation.file.path,
    row: input.row,
    column: input.column,
    value: input.value
  }
}

export function createTabularInsertRowsOperation(input: {
  observation: WorkspaceObservation
  afterRow: number
  values: readonly string[]
}): TabularWorkspaceViewerInsertRowsOperation {
  return {
    kind: 'tabular.insertRows',
    path: input.observation.file.path,
    afterRow: input.afterRow,
    rows: [[...input.values]]
  }
}

export function createTabularInsertColumnsOperation(input: {
  observation: WorkspaceObservation
  afterColumn: number
  values: readonly string[]
}): TabularWorkspaceViewerInsertColumnsOperation {
  return {
    kind: 'tabular.insertColumns',
    path: input.observation.file.path,
    afterColumn: input.afterColumn,
    columns: [[...input.values]]
  }
}

export function createTabularDeleteRowsOperation(input: {
  observation: WorkspaceObservation
  rows: readonly number[]
}): TabularWorkspaceViewerDeleteRowsOperation {
  return {
    kind: 'tabular.deleteRows',
    path: input.observation.file.path,
    rows: [...input.rows]
  }
}

export function createTabularDeleteColumnsOperation(input: {
  observation: WorkspaceObservation
  columns: readonly number[]
}): TabularWorkspaceViewerDeleteColumnsOperation {
  return {
    kind: 'tabular.deleteColumns',
    path: input.observation.file.path,
    columns: [...input.columns]
  }
}

export function TabularWorkspaceViewerCellEditor({
  observation,
  row,
  column,
  value,
  unavailableReason,
  onValueChange,
  onApplyEdit,
  onCancel
}: TabularWorkspaceViewerCellEditorProps): ReactNode {
  const resolvedUnavailableReason = unavailableReason ?? getTabularEditUnavailableReason({
    observation,
    onApplyEdit,
    hasUpdateCellAction: Boolean(observation?.actions.includes('tabular.updateCell'))
  })
  const canApplyEdit = !resolvedUnavailableReason && Boolean(observation && onApplyEdit)

  return (
    <div
      className="workspace-preview-tabular-viewer__cell-editor"
      data-tabular-cell-editor="true"
      data-edit-row-index={row}
      data-edit-column-index={column}
    >
      <label>
        <span>{`R${row}C${column}`}</span>
        <input
          aria-label={`Edit row ${row} column ${column}`}
          value={value}
          onChange={(event) => onValueChange(event.currentTarget.value)}
        />
      </label>
      <div className="workspace-preview-tabular-viewer__cell-editor-actions">
        <button
          type="button"
          data-tabular-cell-apply="true"
          disabled={!canApplyEdit}
          title={resolvedUnavailableReason ?? 'Apply cell edit'}
          onClick={() => {
            if (!observation || !onApplyEdit || resolvedUnavailableReason) return
            onApplyEdit(createTabularUpdateCellOperation({
              observation,
              row,
              column,
              value
            }))
          }}
        >
          Apply
        </button>
        <button
          type="button"
          data-tabular-cell-cancel="true"
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
      {resolvedUnavailableReason ? (
        <small role="status">{resolvedUnavailableReason}</small>
      ) : null}
    </div>
  )
}

export function TabularWorkspaceViewerRowInsertEditor({
  observation,
  header,
  rows,
  afterRow,
  values,
  unavailableReason,
  onAfterRowChange,
  onValueChange,
  onApplyEdit,
  onCancel
}: TabularWorkspaceViewerRowInsertEditorProps): ReactNode {
  const resolvedUnavailableReason = unavailableReason ?? getTabularInsertRowsUnavailableReason({
    observation,
    onApplyEdit,
    hasInsertRowsAction: Boolean(observation?.actions.includes('tabular.insertRows'))
  })
  const canApplyInsert = !resolvedUnavailableReason && Boolean(observation && onApplyEdit)
  const normalizedValues = normalizeInsertRowValues(header, values)

  return (
    <div
      className="workspace-preview-tabular-viewer__row-insert-editor"
      data-tabular-row-insert-editor="true"
      data-insert-after-row={afterRow}
      data-insert-column-count={header.length}
    >
      <label>
        <span>Insert position</span>
        <select
          aria-label="Insert row position"
          value={String(afterRow)}
          disabled={Boolean(resolvedUnavailableReason)}
          onChange={(event) => onAfterRowChange(Number(event.currentTarget.value))}
        >
          <option value="-1">Top</option>
          {rows.map((row) => (
            <option key={row.id} value={row.index}>
              {`After row ${row.index}`}
            </option>
          ))}
        </select>
      </label>
      <div className="workspace-preview-tabular-viewer__row-insert-fields">
        {header.map((column, index) => (
          <label key={`${index}-${column}`}>
            <span>{column}</span>
            <input
              aria-label={`New row ${column}`}
              data-tabular-row-insert-input="true"
              data-column-index={index}
              value={normalizedValues[index]}
              disabled={Boolean(resolvedUnavailableReason)}
              onChange={(event) => onValueChange(index, event.currentTarget.value)}
            />
          </label>
        ))}
      </div>
      <div className="workspace-preview-tabular-viewer__row-insert-actions">
        <button
          type="button"
          data-tabular-row-insert-apply="true"
          disabled={!canApplyInsert}
          title={resolvedUnavailableReason ?? 'Apply row insert'}
          onClick={() => {
            if (!observation || !onApplyEdit || resolvedUnavailableReason) return
            onApplyEdit(createTabularInsertRowsOperation({
              observation,
              afterRow,
              values: normalizedValues
            }))
          }}
        >
          Apply
        </button>
        <button
          type="button"
          data-tabular-row-insert-cancel="true"
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
      {resolvedUnavailableReason ? (
        <small role="status">{resolvedUnavailableReason}</small>
      ) : null}
    </div>
  )
}

export function TabularWorkspaceViewerColumnInsertEditor({
  observation,
  header,
  rows,
  afterColumn,
  values,
  unavailableReason,
  onAfterColumnChange,
  onValueChange,
  onApplyEdit,
  onCancel
}: TabularWorkspaceViewerColumnInsertEditorProps): ReactNode {
  const resolvedUnavailableReason = unavailableReason ?? getTabularInsertColumnsUnavailableReason({
    observation,
    onApplyEdit,
    hasInsertColumnsAction: Boolean(observation?.actions.includes('tabular.insertColumns'))
  })
  const canApplyInsert = !resolvedUnavailableReason && Boolean(observation && onApplyEdit)
  const normalizedValues = normalizeInsertColumnValues(rows, values)

  return (
    <div
      className="workspace-preview-tabular-viewer__column-insert-editor"
      data-tabular-column-insert-editor="true"
      data-insert-after-column={afterColumn}
      data-insert-row-value-count={normalizedValues.length}
    >
      <label>
        <span>Insert position</span>
        <select
          aria-label="Insert column position"
          value={String(afterColumn)}
          disabled={Boolean(resolvedUnavailableReason)}
          onChange={(event) => onAfterColumnChange(Number(event.currentTarget.value))}
        >
          <option value="-1">First</option>
          {header.map((column, index) => (
            <option key={`${index}-${column}`} value={index}>
              {`After column ${index}`}
            </option>
          ))}
        </select>
      </label>
      <div className="workspace-preview-tabular-viewer__column-insert-fields">
        <label>
          <span>Header</span>
          <input
            aria-label="New column header"
            data-tabular-column-insert-input="true"
            data-value-index={0}
            value={normalizedValues[0]}
            disabled={Boolean(resolvedUnavailableReason)}
            onChange={(event) => onValueChange(0, event.currentTarget.value)}
          />
        </label>
        {rows.map((row, index) => (
          <label key={row.id}>
            <span>{`Row ${row.index}`}</span>
            <input
              aria-label={`New column row ${row.index}`}
              data-tabular-column-insert-input="true"
              data-value-index={index + 1}
              value={normalizedValues[index + 1]}
              disabled={Boolean(resolvedUnavailableReason)}
              onChange={(event) => onValueChange(index + 1, event.currentTarget.value)}
            />
          </label>
        ))}
      </div>
      <div className="workspace-preview-tabular-viewer__column-insert-actions">
        <button
          type="button"
          data-tabular-column-insert-apply="true"
          disabled={!canApplyInsert}
          title={resolvedUnavailableReason ?? 'Apply column insert'}
          onClick={() => {
            if (!observation || !onApplyEdit || resolvedUnavailableReason) return
            onApplyEdit(createTabularInsertColumnsOperation({
              observation,
              afterColumn,
              values: normalizedValues
            }))
          }}
        >
          Apply
        </button>
        <button
          type="button"
          data-tabular-column-insert-cancel="true"
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
      {resolvedUnavailableReason ? (
        <small role="status">{resolvedUnavailableReason}</small>
      ) : null}
    </div>
  )
}

export function TabularWorkspaceViewerDeleteEditor({
  observation,
  unavailableReason,
  onApplyEdit,
  onCancel,
  ...draft
}: TabularWorkspaceViewerDeleteEditorProps): ReactNode {
  const isRowDelete = draft.kind === 'rows'
  const targets = isRowDelete ? draft.rows : draft.columns
  const canApplyDelete = !unavailableReason && Boolean(observation && onApplyEdit)
  const summary = isRowDelete
    ? `Delete ${formatCount(targets.length, 'row')}: ${formatIndexList(targets)}`
    : `Delete ${formatCount(targets.length, 'column')}: ${formatIndexList(targets)}`

  return (
    <div
      className="workspace-preview-tabular-viewer__delete-editor"
      data-tabular-delete-editor="true"
      data-delete-kind={draft.kind}
      data-delete-targets={targets.join(',')}
    >
      <strong>{summary}</strong>
      <div className="workspace-preview-tabular-viewer__delete-actions">
        <button
          type="button"
          data-tabular-delete-apply="true"
          disabled={!canApplyDelete}
          title={unavailableReason ?? 'Apply delete'}
          onClick={() => {
            if (!observation || !onApplyEdit || unavailableReason) return
            onApplyEdit(isRowDelete
              ? createTabularDeleteRowsOperation({ observation, rows: draft.rows })
              : createTabularDeleteColumnsOperation({ observation, columns: draft.columns }))
          }}
        >
          Apply
        </button>
        <button
          type="button"
          data-tabular-delete-cancel="true"
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
      {unavailableReason ? (
        <small role="status">{unavailableReason}</small>
      ) : null}
    </div>
  )
}

export function TabularWorkspaceViewer({
  observation,
  model,
  className,
  onApplyEdit
}: TabularWorkspaceViewerProps): ReactNode {
  const [filterText, setFilterText] = useState('')
  const [sort, setSort] = useState<TabularWorkspaceViewerGridState['sort']>(null)
  const [editDraft, setEditDraft] = useState<TabularWorkspaceViewerEditDraft | null>(null)
  const [insertDraft, setInsertDraft] = useState<TabularWorkspaceViewerInsertRowsDraft | null>(null)
  const [insertColumnDraft, setInsertColumnDraft] = useState<TabularWorkspaceViewerInsertColumnsDraft | null>(null)
  const [deleteDraft, setDeleteDraft] = useState<TabularWorkspaceViewerDeleteDraft | null>(null)
  const gridScrollRef = useRef<HTMLDivElement | null>(null)
  const resolvedModel = useMemo(
    () => model ?? buildTabularWorkspaceViewerModel(observation, { filterText, sort }),
    [filterText, model, observation, sort]
  )
  const statusRole = resolvedModel.status.kind === 'unsupported' ? 'alert' : 'status'
  const gridControlsEnabled = resolvedModel.status.kind === 'ready' && resolvedModel.grid.kind === 'preview'
  const editUnavailableReason = getTabularEditUnavailableReason({
    observation,
    onApplyEdit,
    hasUpdateCellAction: Boolean(observation?.actions.includes('tabular.updateCell'))
  })
  const canEnterCellEdit = gridControlsEnabled && !editUnavailableReason
  const insertUnavailableReason = getTabularInsertRowsUnavailableReason({
    observation,
    onApplyEdit,
    hasInsertRowsAction: Boolean(observation?.actions.includes('tabular.insertRows'))
  })
  const canEnterRowInsert = gridControlsEnabled && !insertUnavailableReason
  const insertColumnsUnavailableReason = getTabularInsertColumnsUnavailableReason({
    observation,
    onApplyEdit,
    hasInsertColumnsAction: Boolean(observation?.actions.includes('tabular.insertColumns'))
  })
  const canEnterColumnInsert = gridControlsEnabled && !insertColumnsUnavailableReason
  const deleteRowsUnavailableReason = getTabularDeleteRowsUnavailableReason({
    observation,
    onApplyEdit,
    hasDeleteRowsAction: Boolean(observation?.actions.includes('tabular.deleteRows'))
  })
  const deleteColumnsUnavailableReason = getTabularDeleteColumnsUnavailableReason({
    observation,
    onApplyEdit,
    hasDeleteColumnsAction: Boolean(observation?.actions.includes('tabular.deleteColumns'))
  })
  const canEnterRowDelete = gridControlsEnabled && !deleteRowsUnavailableReason
  const canEnterColumnDelete = gridControlsEnabled && !deleteColumnsUnavailableReason
  const bottomInsertAfterRow = getBottomInsertAfterRow(resolvedModel.grid)
  const createInsertDraft = (afterRow: number): TabularWorkspaceViewerInsertRowsDraft => ({
    afterRow,
    values: createEmptyInsertRowValues(resolvedModel.grid.header)
  })
  const createInsertColumnDraft = (afterColumn: number): TabularWorkspaceViewerInsertColumnsDraft => ({
    afterColumn,
    values: createEmptyInsertColumnValues(resolvedModel.grid.rows)
  })
  const initialTabularRange = observation?.selection?.kind === 'tabular'
    ? observation.selection.ranges[0]
    : undefined

  useEffect(() => {
    const grid = gridScrollRef.current
    if (!grid || !initialTabularRange) return
    grid.querySelector<HTMLElement>(
      `[data-cell-coordinate="${initialTabularRange.rowStart}:${initialTabularRange.columnStart}"]`
    )?.scrollIntoView({ block: 'center', inline: 'center' })
  }, [initialTabularRange])

  return (
    <section
      className={compactClassName('workspace-preview-tabular-viewer', className)}
      data-workspace-preview-tabular-viewer
      data-status={resolvedModel.status.kind}
    >
      <header className="workspace-preview-tabular-viewer__header">
        <div className="workspace-preview-tabular-viewer__header-copy">
          <h3>{resolvedModel.title}</h3>
          {resolvedModel.subtitle ? <p>{resolvedModel.subtitle}</p> : null}
        </div>
      </header>

      {resolvedModel.status.kind !== 'ready' ? (
        <div
          className="workspace-preview-tabular-viewer__state"
          role={statusRole}
          data-state-kind={resolvedModel.status.kind}
        >
          <strong>{resolvedModel.status.title}</strong>
          <p>{resolvedModel.status.message}</p>
        </div>
      ) : (
        <>
          <div
            className="workspace-preview-tabular-viewer__viewport"
            data-tabular-grid={resolvedModel.grid.kind === 'preview' ? 'true' : undefined}
            data-tabular-placeholder={resolvedModel.grid.kind === 'none' ? 'true' : undefined}
            role={resolvedModel.grid.kind === 'preview' ? undefined : 'img'}
            aria-label={resolvedModel.grid.kind === 'preview' ? undefined : 'Tabular grid and editor placeholder'}
          >
            <div className="workspace-preview-tabular-viewer__grid-heading">
              <strong>{resolvedModel.viewport.title}</strong>
              <p>{resolvedModel.viewport.message}</p>
            </div>
            {resolvedModel.grid.kind === 'preview' ? (
              <>
                <div className="workspace-preview-tabular-viewer__toolbar">
                  <div
                    className="workspace-preview-tabular-viewer__grid-controls"
                    data-filter-active={resolvedModel.grid.filter.active ? 'true' : 'false'}
                    data-sort-direction={resolvedModel.grid.sort.direction}
                  >
                    <label>
                      <span>Filter rows</span>
                      <input
                        type="search"
                        value={resolvedModel.grid.filter.text}
                        placeholder="Search visible cells"
                        aria-label="Filter preview rows"
                        disabled={!gridControlsEnabled}
                        onChange={(event) => setFilterText(event.currentTarget.value)}
                      />
                    </label>
                    <span data-tabular-grid-state>{resolvedModel.grid.stateSummary}</span>
                  </div>
                  <div className="workspace-preview-tabular-viewer__toolbar-actions">
                    <div
                      className="workspace-preview-tabular-viewer__row-insert-controls"
                      data-tabular-row-insert-controls="true"
                      data-insert-enabled={canEnterRowInsert ? 'true' : 'false'}
                    >
                      <button
                        type="button"
                        data-tabular-row-insert-top="true"
                        disabled={!canEnterRowInsert}
                        title={insertUnavailableReason ?? 'Insert row at top'}
                        onClick={() => {
                          if (!canEnterRowInsert) return
                          setInsertDraft(createInsertDraft(-1))
                        }}
                      >
                        Insert top
                      </button>
                      <button
                        type="button"
                        data-tabular-row-insert-bottom="true"
                        data-insert-after-row={bottomInsertAfterRow}
                        disabled={!canEnterRowInsert}
                        title={insertUnavailableReason ?? 'Insert row at bottom'}
                        onClick={() => {
                          if (!canEnterRowInsert) return
                          setInsertDraft(createInsertDraft(bottomInsertAfterRow))
                        }}
                      >
                        Insert bottom
                      </button>
                      {insertUnavailableReason ? (
                        <small role="status">{insertUnavailableReason}</small>
                      ) : null}
                    </div>
                    <div
                      className="workspace-preview-tabular-viewer__column-insert-controls"
                      data-tabular-column-insert-controls="true"
                      data-insert-enabled={canEnterColumnInsert ? 'true' : 'false'}
                    >
                      <button
                        type="button"
                        data-tabular-column-insert-first="true"
                        disabled={!canEnterColumnInsert}
                        title={insertColumnsUnavailableReason ?? 'Insert column first'}
                        onClick={() => {
                          if (!canEnterColumnInsert) return
                          setInsertColumnDraft(createInsertColumnDraft(-1))
                        }}
                      >
                        Insert first column
                      </button>
                      <button
                        type="button"
                        data-tabular-column-insert-last="true"
                        data-insert-after-column={getLastInsertAfterColumn(resolvedModel.grid)}
                        disabled={!canEnterColumnInsert}
                        title={insertColumnsUnavailableReason ?? 'Insert column last'}
                        onClick={() => {
                          if (!canEnterColumnInsert) return
                          setInsertColumnDraft(createInsertColumnDraft(getLastInsertAfterColumn(resolvedModel.grid)))
                        }}
                      >
                        Insert last column
                      </button>
                      {insertColumnsUnavailableReason ? (
                        <small role="status">{insertColumnsUnavailableReason}</small>
                      ) : null}
                    </div>
                  </div>
                </div>
                {insertDraft ? (
                  <TabularWorkspaceViewerRowInsertEditor
                    observation={observation}
                    header={resolvedModel.grid.header}
                    rows={resolvedModel.grid.rows}
                    afterRow={insertDraft.afterRow}
                    values={insertDraft.values}
                    unavailableReason={insertUnavailableReason}
                    onAfterRowChange={(afterRow) => {
                      setInsertDraft((current) => ({
                        afterRow,
                        values: normalizeInsertRowValues(
                          resolvedModel.grid.header,
                          current?.values ?? []
                        )
                      }))
                    }}
                    onValueChange={(columnIndex, value) => {
                      setInsertDraft((current) => {
                        const nextValues = normalizeInsertRowValues(
                          resolvedModel.grid.header,
                          current?.values ?? []
                        )
                        nextValues[columnIndex] = value

                        return {
                          afterRow: current?.afterRow ?? -1,
                          values: nextValues
                        }
                      })
                    }}
                    onApplyEdit={onApplyEdit
                      ? (operation) => {
                          void onApplyEdit(operation)
                          setInsertDraft(null)
                        }
                      : undefined}
                    onCancel={() => setInsertDraft(null)}
                  />
                ) : null}
                {insertColumnDraft ? (
                  <TabularWorkspaceViewerColumnInsertEditor
                    observation={observation}
                    header={resolvedModel.grid.header}
                    rows={resolvedModel.grid.rows}
                    afterColumn={insertColumnDraft.afterColumn}
                    values={insertColumnDraft.values}
                    unavailableReason={insertColumnsUnavailableReason}
                    onAfterColumnChange={(afterColumn) => {
                      setInsertColumnDraft((current) => ({
                        afterColumn,
                        values: normalizeInsertColumnValues(
                          resolvedModel.grid.rows,
                          current?.values ?? []
                        )
                      }))
                    }}
                    onValueChange={(valueIndex, value) => {
                      setInsertColumnDraft((current) => {
                        const nextValues = normalizeInsertColumnValues(
                          resolvedModel.grid.rows,
                          current?.values ?? []
                        )
                        nextValues[valueIndex] = value

                        return {
                          afterColumn: current?.afterColumn ?? -1,
                          values: nextValues
                        }
                      })
                    }}
                    onApplyEdit={onApplyEdit
                      ? (operation) => {
                          void onApplyEdit(operation)
                          setInsertColumnDraft(null)
                        }
                      : undefined}
                    onCancel={() => setInsertColumnDraft(null)}
                  />
                ) : null}
                {deleteDraft ? (
                  <TabularWorkspaceViewerDeleteEditor
                    {...deleteDraft}
                    observation={observation}
                    unavailableReason={deleteDraft.kind === 'rows'
                      ? deleteRowsUnavailableReason
                      : deleteColumnsUnavailableReason}
                    onApplyEdit={onApplyEdit
                      ? (operation) => {
                          void onApplyEdit(operation)
                          setDeleteDraft(null)
                        }
                      : undefined}
                    onCancel={() => setDeleteDraft(null)}
                  />
                ) : null}
                <div ref={gridScrollRef} className="workspace-preview-tabular-viewer__grid-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">#</th>
                        {resolvedModel.grid.header.map((column, index) => {
                          const direction = resolvedModel.grid.sort.columnIndex === index
                            ? resolvedModel.grid.sort.direction
                            : 'none'

                          return (
                            <th key={`${index}-${column}`} scope="col">
                              <button
                                type="button"
                                data-sort-column-index={index}
                                data-sort-direction={direction}
                                aria-label={`Sort by ${column}`}
                                aria-pressed={direction !== 'none'}
                                disabled={!gridControlsEnabled}
                                onClick={() => setSort(toggleGridSort(resolvedModel.grid.sort, index))}
                              >
                                <span>{column}</span>
                                {direction !== 'none' ? (
                                  <small>{direction === 'asc' ? 'Asc' : 'Desc'}</small>
                                ) : null}
                              </button>
                              <button
                                type="button"
                                data-tabular-column-insert-after="true"
                                data-insert-after-column={index}
                                disabled={!canEnterColumnInsert}
                                title={insertColumnsUnavailableReason ?? `Insert column after ${index}`}
                                onClick={() => {
                                  if (!canEnterColumnInsert) return
                                  setInsertColumnDraft(createInsertColumnDraft(index))
                                }}
                              >
                                Insert column
                              </button>
                              <button
                                type="button"
                                data-tabular-column-delete="true"
                                data-delete-column-index={index}
                                disabled={!canEnterColumnDelete}
                                title={deleteColumnsUnavailableReason ?? `Delete column ${index}`}
                                onClick={() => {
                                  if (!canEnterColumnDelete) return
                                  setDeleteDraft({ kind: 'columns', columns: [index] })
                                }}
                              >
                                Delete column
                              </button>
                            </th>
                          )
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {resolvedModel.grid.rows.length ? (
                        resolvedModel.grid.rows.map((row) => (
                          <tr
                            key={row.id}
                            data-row-index={row.index}
                            data-selection-intersects={resolvedModel.grid.header.some((_, columnIndex) =>
                              tabularSelectionContainsCoordinate(observation?.selection, row.index, columnIndex)
                            ) ? 'true' : 'false'}
                          >
                            <th scope="row">
                              <span>{row.index}</span>
                              <button
                                type="button"
                                data-tabular-row-insert-after="true"
                                data-insert-after-row={row.index}
                                disabled={!canEnterRowInsert}
                                title={insertUnavailableReason ?? `Insert row after ${row.index}`}
                                onClick={() => {
                                  if (!canEnterRowInsert) return
                                  setInsertDraft(createInsertDraft(row.index))
                                }}
                              >
                                Insert after
                              </button>
                              <button
                                type="button"
                                data-tabular-row-delete="true"
                                data-delete-row-index={row.index}
                                disabled={!canEnterRowDelete}
                                title={deleteRowsUnavailableReason ?? `Delete row ${row.index}`}
                                onClick={() => {
                                  if (!canEnterRowDelete) return
                                  setDeleteDraft({ kind: 'rows', rows: [row.index] })
                                }}
                              >
                                Delete row
                              </button>
                            </th>
                            {resolvedModel.grid.header.map((_, columnIndex) => {
                              const displayedValue = row.values[columnIndex] ?? ''
                              const sourceValue = getTabularCellValue(observation, row.index, columnIndex, displayedValue)
                              const isEditing = editDraft?.row === row.index && editDraft.column === columnIndex
                              const isSelected = tabularSelectionContainsCoordinate(
                                observation?.selection,
                                row.index,
                                columnIndex
                              )

                              return (
                                <td
                                  key={`${row.id}-${columnIndex}`}
                                  data-cell-coordinate={`${row.index}:${columnIndex}`}
                                  data-selected={isSelected ? 'true' : 'false'}
                                  onDoubleClick={() => {
                                    if (!canEnterCellEdit) return
                                    setEditDraft({ row: row.index, column: columnIndex, value: sourceValue })
                                  }}
                                >
                                  {isEditing ? (
                                    <TabularWorkspaceViewerCellEditor
                                      observation={observation}
                                      row={row.index}
                                      column={columnIndex}
                                      value={editDraft.value}
                                      unavailableReason={editUnavailableReason}
                                      onValueChange={(value) => {
                                        setEditDraft({ row: row.index, column: columnIndex, value })
                                      }}
                                      onApplyEdit={onApplyEdit
                                        ? (operation) => {
                                            void onApplyEdit(operation)
                                            setEditDraft(null)
                                          }
                                        : undefined}
                                      onCancel={() => setEditDraft(null)}
                                    />
                                  ) : (
                                    <div
                                      className="workspace-preview-tabular-viewer__cell-view"
                                      data-edit-enabled={canEnterCellEdit ? 'true' : 'false'}
                                    >
                                      <span data-tabular-cell-value="true">{displayedValue}</span>
                                      <button
                                        type="button"
                                        data-tabular-cell-edit="true"
                                        aria-label={`Edit row ${row.index} column ${columnIndex}`}
                                        disabled={!canEnterCellEdit}
                                        title={editUnavailableReason ?? 'Edit cell'}
                                        onClick={() => {
                                          if (!canEnterCellEdit) return
                                          setEditDraft({ row: row.index, column: columnIndex, value: sourceValue })
                                        }}
                                      >
                                        Edit
                                      </button>
                                    </div>
                                  )}
                                </td>
                              )
                            })}
                          </tr>
                        ))
                      ) : (
                        <tr data-row-empty="true">
                          <td colSpan={resolvedModel.grid.header.length + 1}>
                            No bounded preview rows match the current filter.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            ) : null}
          </div>

          <p className="workspace-preview-tabular-viewer__agent-summary">
            {resolvedModel.agentSummary}
          </p>

          <section
            className="workspace-preview-tabular-viewer__section"
            aria-label="Tabular tables summary"
          >
            <h4>Tables</h4>
            {resolvedModel.tables.length ? (
              <dl>
                {resolvedModel.tables.map((table) => (
                  <div key={table.id} data-table-id={table.id}>
                    <dt>{table.name}</dt>
                    <dd>
                      {table.summary}
                      <small>
                        Rows: {table.rowCount}; Columns: {table.columnCount}
                      </small>
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p>No table row/column summary was reported.</p>
            )}
          </section>

          <section
            className="workspace-preview-tabular-viewer__section"
            aria-label="Tabular selection"
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
            className="workspace-preview-tabular-viewer__section"
            aria-label="Tabular visible text summary"
            data-visible-text-kind={resolvedModel.visibleText.kind}
          >
            <h4>Visible Text</h4>
            <p>{resolvedModel.visibleText.summary}</p>
            {resolvedModel.visibleText.lines.length ? (
              <ol>
                {resolvedModel.visibleText.lines.map((line, index) => (
                  <li key={`${index}-${line}`}>{line}</li>
                ))}
              </ol>
            ) : null}
          </section>

          <section
            className="workspace-preview-tabular-viewer__section"
            aria-label="Tabular actions"
          >
            <h4>Actions</h4>
            {resolvedModel.actions.length ? (
              <ul role="toolbar" aria-label="Tabular action toolbar">
                {resolvedModel.actions.map((action) => (
                  <li
                    key={action.id}
                    data-action-id={action.id}
                    data-action-kind={action.kind}
                    data-action-enabled={action.enabled ? 'true' : 'false'}
                  >
                    <button
                      type="button"
                      disabled={!action.enabled}
                      title={action.reason ?? action.label}
                    >
                      {action.label}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p>No select, inspect, filter, sort, edit, insert, or export actions are available.</p>
            )}
          </section>
        </>
      )}
    </section>
  )
}

function createInactiveModel(
  status: Extract<TabularWorkspaceViewerStatus, { kind: 'empty' | 'unsupported' }>,
  observation?: WorkspaceObservation
): TabularWorkspaceViewerModel {
  return {
    status,
    title: observation?.view.title || 'Tabular viewer',
    subtitle: observation ? compactStrings([
      observation.view.pluginId,
      formatModality(observation.view.modality),
      titleCase(observation.view.mode)
    ]).join(' | ') : undefined,
    viewport: {
      title: 'Grid/editor mount point',
      message: 'No tabular viewport is active.'
    },
    grid: {
      kind: 'none',
      summary: 'No bounded tabular preview rows were reported.',
      stateSummary: 'Bounded grid state: Filter: none; Sort: none.',
      header: [],
      rows: [],
      filter: createGridFilterModel('', 0, 0),
      sort: createGridSortModel(null, []),
      truncatedRows: false,
      truncatedColumns: false
    },
    agentSummary: status.message,
    tables: [],
    selection: {
      kind: 'none',
      summary: 'No tabular selection.',
      groups: []
    },
    visibleText: {
      kind: 'none',
      summary: 'No visible text summary was reported.',
      lines: []
    },
    actions: []
  }
}

function getTabularEditUnavailableReason(input: {
  observation?: WorkspaceObservation | null
  onApplyEdit?: TabularWorkspaceViewerApplyEditHandler
  hasUpdateCellAction: boolean
}): string | undefined {
  if (!input.onApplyEdit) return 'Connect an edit apply handler before editing cells.'
  if (!input.observation) return 'A source tabular observation is required before edits can be applied.'
  if (!input.hasUpdateCellAction) return 'This observation does not advertise tabular.updateCell.'
  return undefined
}

function getTabularInsertRowsUnavailableReason(input: {
  observation?: WorkspaceObservation | null
  onApplyEdit?: TabularWorkspaceViewerApplyEditHandler
  hasInsertRowsAction: boolean
}): string | undefined {
  if (!input.onApplyEdit) return 'Connect an edit apply handler before inserting rows.'
  if (!input.observation) return 'A source tabular observation is required before rows can be inserted.'
  if (!input.hasInsertRowsAction) return 'This observation does not advertise tabular.insertRows.'
  return undefined
}

function getTabularInsertColumnsUnavailableReason(input: {
  observation?: WorkspaceObservation | null
  onApplyEdit?: TabularWorkspaceViewerApplyEditHandler
  hasInsertColumnsAction: boolean
}): string | undefined {
  if (!input.onApplyEdit) return 'Connect an edit apply handler before inserting columns.'
  if (!input.observation) return 'A source tabular observation is required before columns can be inserted.'
  if (!input.hasInsertColumnsAction) return 'This observation does not advertise tabular.insertColumns.'
  return undefined
}

function getTabularDeleteRowsUnavailableReason(input: {
  observation?: WorkspaceObservation | null
  onApplyEdit?: TabularWorkspaceViewerApplyEditHandler
  hasDeleteRowsAction: boolean
}): string | undefined {
  if (!input.onApplyEdit) return 'Connect an edit apply handler before deleting rows.'
  if (!input.observation) return 'A source tabular observation is required before rows can be deleted.'
  if (!input.hasDeleteRowsAction) return 'This observation does not advertise tabular.deleteRows.'
  return undefined
}

function getTabularDeleteColumnsUnavailableReason(input: {
  observation?: WorkspaceObservation | null
  onApplyEdit?: TabularWorkspaceViewerApplyEditHandler
  hasDeleteColumnsAction: boolean
}): string | undefined {
  if (!input.onApplyEdit) return 'Connect an edit apply handler before deleting columns.'
  if (!input.observation) return 'A source tabular observation is required before columns can be deleted.'
  if (!input.hasDeleteColumnsAction) return 'This observation does not advertise tabular.deleteColumns.'
  return undefined
}

function getTabularCellValue(
  observation: WorkspaceObservation | null | undefined,
  rowIndex: number,
  columnIndex: number,
  fallback: string
): string {
  const row = observation?.tabular?.rows?.find((candidate) => candidate.index === rowIndex)
  return row?.values[columnIndex] ?? fallback
}

function createEmptyInsertRowValues(header: readonly string[]): string[] {
  return header.map(() => '')
}

function createEmptyInsertColumnValues(rows: TabularWorkspaceViewerGridModel['rows']): string[] {
  return Array.from({ length: rows.length + 1 }, () => '')
}

function normalizeInsertRowValues(header: readonly string[], values: readonly string[]): string[] {
  return header.map((_, index) => values[index] ?? '')
}

function normalizeInsertColumnValues(
  rows: TabularWorkspaceViewerGridModel['rows'],
  values: readonly string[]
): string[] {
  return Array.from({ length: rows.length + 1 }, (_unused, index) => values[index] ?? '')
}

function formatIndexList(indices: readonly number[]): string {
  return indices.length ? indices.join(', ') : 'none'
}

function getBottomInsertAfterRow(grid: TabularWorkspaceViewerGridModel): number {
  if (grid.kind !== 'preview') return -1
  return grid.rows.at(-1)?.index ?? -1
}

function getLastInsertAfterColumn(grid: TabularWorkspaceViewerGridModel): number {
  if (grid.kind !== 'preview') return -1
  return Math.max(-1, grid.header.length - 1)
}

function buildTableRows(observation: WorkspaceObservation): TabularWorkspaceViewerTableRow[] {
  return (observation.tables ?? []).map((table, index) => {
    const name = table.name || table.id || `Table ${index + 1}`
    const rowCount = formatOptionalInteger(table.rowCount)
    const columnCount = formatOptionalInteger(table.columnCount)

    return {
      id: table.id || `table-${index + 1}`,
      name,
      rowCount,
      columnCount,
      summary: `${formatDimension(table.rowCount, 'row')} x ${formatDimension(table.columnCount, 'column')}`
    }
  })
}

function buildGridModel(
  observation: WorkspaceObservation,
  gridState: TabularWorkspaceViewerGridState
): TabularWorkspaceViewerGridModel {
  const rows = observation.tabular?.rows ?? []
  if (!rows.length) {
    return {
      kind: 'none',
      summary: 'No bounded tabular preview rows were reported.',
      stateSummary: 'Bounded grid state: Filter: none; Sort: none.',
      header: [],
      rows: [],
      filter: createGridFilterModel(gridState.filterText ?? '', 0, 0),
      sort: createGridSortModel(null, []),
      truncatedRows: Boolean(observation.tabular?.truncatedRows),
      truncatedColumns: Boolean(observation.tabular?.truncatedColumns)
    }
  }

  const maxColumnCount = Math.max(
    observation.tabular?.header?.length ?? 0,
    ...rows.map((row) => row.values.length)
  )
  const header = Array.from({ length: maxColumnCount }, (_, index) =>
    observation.tabular?.header?.[index]?.trim() || `Column ${index + 1}`
  )
  const truncatedRows = Boolean(observation.tabular?.truncatedRows)
  const truncatedColumns = Boolean(observation.tabular?.truncatedColumns)
  const truncation = compactStrings([
    truncatedRows ? 'more rows available' : undefined,
    truncatedColumns ? 'more columns available' : undefined
  ])
  const sourceRows = rows.map((row) => ({
    id: `row-${row.index}`,
    index: row.index,
    values: row.values.map((value) => truncateText(value, MAX_CELL_VALUE_CHARS))
  }))
  const filterText = gridState.filterText ?? ''
  const filterQuery = filterText.trim()
  const filteredRows = filterQuery
    ? sourceRows.filter((row) => rowMatchesFilter(row.values, filterQuery))
    : sourceRows
  const sortModel = normalizeGridSort(gridState.sort, header)
  const sortedRows = sortModel.direction === 'none'
    ? filteredRows
    : sortGridRows(filteredRows, sortModel)
  const filter = createGridFilterModel(filterText, filteredRows.length, sourceRows.length)
  const rowCountSummary = filter.active
    ? `Showing ${formatInteger(sortedRows.length)} of ${formatCount(sourceRows.length, 'preview row')} x ${formatCount(header.length, 'column')}.`
    : `Showing ${formatCount(sortedRows.length, 'preview row')} x ${formatCount(header.length, 'column')}.`

  return {
    kind: 'preview',
    summary: compactStrings([
      rowCountSummary,
      `${filter.summary}.`,
      `${sortModel.summary}.`,
      truncation.length ? `Bounded preview: ${truncation.join(', ')}.` : undefined
    ]).join(' '),
    stateSummary: `Bounded grid state: ${filter.summary}; ${sortModel.summary}.`,
    header,
    rows: sortedRows,
    filter,
    sort: sortModel,
    truncatedRows,
    truncatedColumns
  }
}

export function tabularSelectionContainsCoordinate(
  selection: WorkspaceStructuredSelection | undefined,
  row: number,
  column: number
): boolean {
  if (selection?.kind !== 'tabular') return false
  if (selection.cells?.some((cell) => cell.row === row && cell.column === column)) return true
  return selection.ranges.some((range) =>
    row >= range.rowStart && row <= range.rowEnd &&
    column >= range.columnStart && column <= range.columnEnd)
}

function buildTabularSelectionModel(
  selection: WorkspaceStructuredSelection | undefined
): TabularWorkspaceViewerSelectionModel {
  if (!selection) {
    return {
      kind: 'none',
      summary: 'No tabular selection.',
      groups: []
    }
  }

  if (selection.kind !== 'tabular') {
    return {
      kind: 'unsupported',
      summary: `${titleCase(selection.kind)} selection is active outside the tabular viewer.`,
      groups: []
    }
  }

  const ranges = selection.ranges.map(formatRange)
  const cells = selection.cells?.map(formatCell) ?? []
  const groups = compactGroups([
    selection.sheet ? createSelectionGroup('sheet', 'Sheet', [selection.sheet]) : null,
    createSelectionGroup('ranges', 'Selected ranges', ranges),
    createSelectionGroup('cells', 'Selected cells', cells)
  ])
  const summaryParts = compactStrings([
    selection.sheet ? `sheet ${selection.sheet}` : undefined,
    ranges.length ? formatCount(ranges.length, 'range') : undefined,
    cells.length ? formatCount(cells.length, 'cell') : undefined
  ])

  return {
    kind: 'tabular',
    summary: summaryParts.length ? `Selected ${summaryParts.join(', ')}.` : 'Tabular selection is empty.',
    groups
  }
}

function buildVisibleTextModel(
  visibleText: string | undefined,
  grid?: TabularWorkspaceViewerGridModel
): TabularWorkspaceViewerVisibleTextModel {
  const text = visibleText ?? ''
  const gridStateLine = grid?.kind === 'preview' ? grid.stateSummary : undefined
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const previewLines = lines
    .slice(0, MAX_VISIBLE_TEXT_LINES)
    .map((line) => truncateText(line, MAX_VISIBLE_TEXT_LINE_CHARS))

  if (!text.trim()) {
    if (gridStateLine) {
      return {
        kind: 'reported',
        summary: `No visible text summary was reported. ${gridStateLine}`,
        lines: [gridStateLine]
      }
    }

    return {
      kind: 'none',
      summary: 'No visible text summary was reported.',
      lines: []
    }
  }

  const omittedLines = Math.max(0, lines.length - previewLines.length)
  const omitted = omittedLines ? ` Showing first ${previewLines.length}; ${formatCount(omittedLines, 'line')} omitted.` : ''

  return {
    kind: 'reported',
    summary: compactStrings([
      `Visible text has ${formatInteger(text.length)} characters across ${formatCount(lines.length, 'non-empty line')}.${omitted}`,
      gridStateLine
    ]).join(' '),
    lines: compactStrings([
      gridStateLine,
      ...previewLines
    ])
  }
}

function buildTabularActions(actions: readonly string[]): TabularWorkspaceViewerAction[] {
  const resolved = new Map<string, TabularWorkspaceViewerAction>()

  for (const actionId of actions) {
    const kind = classifyTabularAction(actionId)
    if (!kind) continue

    resolved.set(actionId, {
      id: actionId,
      label: TABULAR_ACTION_LABELS[actionId] ?? formatActionLabel(actionId),
      kind,
      ...getTabularActionAvailability(kind)
    })
  }

  return [...resolved.values()]
}

function toggleGridSort(
  current: TabularWorkspaceViewerGridSortModel,
  columnIndex: number
): TabularWorkspaceViewerGridState['sort'] {
  if (current.columnIndex !== columnIndex) {
    return { columnIndex, direction: 'asc' }
  }

  if (current.direction === 'asc') return { columnIndex, direction: 'desc' }
  return null
}

function normalizeGridSort(
  sort: TabularWorkspaceViewerGridState['sort'],
  header: readonly string[]
): TabularWorkspaceViewerGridSortModel {
  if (!sort || !Number.isInteger(sort.columnIndex)) return createGridSortModel(null, header)
  if (sort.columnIndex < 0 || sort.columnIndex >= header.length) return createGridSortModel(null, header)
  if (sort.direction !== 'asc' && sort.direction !== 'desc') return createGridSortModel(null, header)
  return createGridSortModel(sort, header)
}

function createGridFilterModel(
  filterText: string,
  matchedRowCount: number,
  sourceRowCount: number
): TabularWorkspaceViewerGridFilterModel {
  const query = filterText.trim()

  return {
    text: filterText,
    active: Boolean(query),
    matchedRowCount,
    sourceRowCount,
    summary: query
      ? `Filter "${truncateText(query, MAX_FILTER_SUMMARY_CHARS)}" matched ${formatInteger(matchedRowCount)} of ${formatCount(sourceRowCount, 'bounded row')}`
      : 'Filter: none'
  }
}

function createGridSortModel(
  sort: TabularWorkspaceViewerGridState['sort'],
  header: readonly string[]
): TabularWorkspaceViewerGridSortModel {
  if (!sort) {
    return {
      columnIndex: null,
      columnLabel: null,
      direction: 'none',
      summary: 'Sort: none'
    }
  }

  const columnLabel = header[sort.columnIndex] ?? `Column ${sort.columnIndex + 1}`
  return {
    columnIndex: sort.columnIndex,
    columnLabel,
    direction: sort.direction,
    summary: `Sort: ${columnLabel} ${sort.direction === 'asc' ? 'ascending' : 'descending'}`
  }
}

function rowMatchesFilter(values: readonly string[], query: string): boolean {
  const normalizedQuery = query.toLocaleLowerCase()
  return values.some((value) => value.toLocaleLowerCase().includes(normalizedQuery))
}

function sortGridRows(
  rows: TabularWorkspaceViewerGridModel['rows'],
  sort: TabularWorkspaceViewerGridSortModel
): TabularWorkspaceViewerGridModel['rows'] {
  if (sort.columnIndex === null || sort.direction === 'none') return rows

  const direction = sort.direction === 'asc' ? 1 : -1
  return rows
    .map((row, ordinal) => ({ row, ordinal }))
    .sort((left, right) => {
      const leftValue = left.row.values[sort.columnIndex ?? -1] ?? ''
      const rightValue = right.row.values[sort.columnIndex ?? -1] ?? ''
      const compared = leftValue.localeCompare(rightValue, undefined, {
        numeric: true,
        sensitivity: 'base'
      })

      return compared ? compared * direction : left.ordinal - right.ordinal
    })
    .map(({ row }) => row)
}

function getTabularActionAvailability(
  kind: TabularWorkspaceViewerActionKind
): Pick<TabularWorkspaceViewerAction, 'enabled' | 'reason'> {
  if (kind === 'edit' || kind === 'insert') {
    return {
      enabled: false,
      reason: 'This action needs a dedicated tabular editor control before it can run.'
    }
  }

  if (kind === 'export') {
    return {
      enabled: false,
      reason: 'Export needs a renderer target picker or plugin implementation.'
    }
  }

  return { enabled: true }
}

function classifyTabularAction(actionId: string): TabularWorkspaceViewerActionKind | null {
  if (actionId === 'workspace.setSelection') return 'select'

  const isTabularAction = actionId.startsWith('tabular.')
  if (isExportAction(actionId) && (isTabularAction || isGenericExportAction(actionId))) return 'export'
  if (!isTabularAction) return null

  if (/preview/i.test(actionId)) return 'preview'
  if (/update|edit|replace|delete|remove/i.test(actionId)) return 'edit'
  if (/insert|append|addRow/i.test(actionId)) return 'insert'
  if (/filter/i.test(actionId)) return 'filter'
  if (/sort/i.test(actionId)) return 'sort'
  if (/(^|[.:])select/i.test(actionId) || /selection/i.test(actionId)) return 'select'
  if (/inspect|column|schema|infer/i.test(actionId)) return 'inspect'
  return 'other'
}

function buildAgentSummary(input: {
  grid: TabularWorkspaceViewerGridModel
  tables: TabularWorkspaceViewerTableRow[]
  selection: TabularWorkspaceViewerSelectionModel
  visibleText: TabularWorkspaceViewerVisibleTextModel
  actions: TabularWorkspaceViewerAction[]
}): string {
  const { tables, selection, visibleText, actions } = input
  const parts = compactStrings([
    input.grid.kind === 'preview' ? `grid: ${input.grid.summary}` : undefined,
    tables.length ? `tables: ${tables.map((table) => `${table.name} (${table.summary})`).join('; ')}` : 'tables: not reported',
    selection.kind === 'tabular' ? `selection: ${selection.summary}` : undefined,
    visibleText.kind === 'reported' ? visibleText.summary : undefined,
    actions.length ? `actions: ${actions.map((action) => action.label).join(', ')}` : undefined
  ])

  return parts.length ? parts.join('; ') : 'Tabular observation ready without reported table details.'
}

function createSelectionGroup(
  id: string,
  title: string,
  items: readonly string[] | undefined
): TabularWorkspaceViewerGroup | null {
  const normalized = compactStrings(items)
  if (!normalized.length) return null

  return {
    id,
    title,
    summary: formatCount(normalized.length, title.replace(/^Selected /, '').replace(/s$/, '')),
    items: normalized
  }
}

function formatRange(range: TabularStructuredSelection['ranges'][number]): string {
  const rows = range.rowStart === range.rowEnd
    ? `row ${formatInteger(range.rowStart)}`
    : `rows ${formatInteger(range.rowStart)}-${formatInteger(range.rowEnd)}`
  const columns = range.columnStart === range.columnEnd
    ? `column ${formatInteger(range.columnStart)}`
    : `columns ${formatInteger(range.columnStart)}-${formatInteger(range.columnEnd)}`

  return `${rows}, ${columns}`
}

function formatCell(cell: NonNullable<TabularStructuredSelection['cells']>[number]): string {
  const coordinate = `R${formatInteger(cell.row)}C${formatInteger(cell.column)}`
  if (!Object.prototype.hasOwnProperty.call(cell, 'value')) return coordinate
  return `${coordinate} = ${formatCellValue(cell.value)}`
}

function formatCellValue(value: unknown): string {
  if (value === undefined) return 'undefined'
  if (value === null) return 'null'
  if (typeof value === 'string') return truncateText(value, MAX_CELL_VALUE_CHARS)
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value)
  }

  try {
    return truncateText(JSON.stringify(value), MAX_CELL_VALUE_CHARS)
  } catch {
    return truncateText(String(value), MAX_CELL_VALUE_CHARS)
  }
}

function formatActionLabel(actionId: string): string {
  if (isExportAction(actionId)) {
    const explicitFormat = actionId.includes(':') ? actionId.split(':').at(-1) : undefined
    const actionName = actionId.split(/[.:]/).filter(Boolean).at(-1) ?? actionId
    const inferredFormat = explicitFormat || actionName.replace(/^export/i, '')
    return inferredFormat ? `Export ${formatExportFormat(inferredFormat)}` : 'Export'
  }

  const actionName = actionId.split(/[.:]/).filter(Boolean).at(-1) ?? actionId
  return titleCase(actionName.replace(/([a-z])([A-Z])/g, '$1 $2'))
}

function isGenericExportAction(actionId: string): boolean {
  return actionId.startsWith('workspace.export:') || /^export[:.]/i.test(actionId)
}

function isExportAction(actionId: string): boolean {
  return isGenericExportAction(actionId) || /(^|[.:])export/i.test(actionId)
}

function formatExportFormat(value: string): string {
  const spaced = value
    .replace(/^[:.]/, '')
    .replace(/[-_]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim()

  if (/^[a-z0-9]+$/i.test(spaced) && spaced.length <= 5) return spaced.toUpperCase()
  return titleCase(spaced)
}

function formatDimension(value: number | undefined, singular: string): string {
  return typeof value === 'number' ? formatCount(value, singular) : `unknown ${singular}s`
}

function formatOptionalInteger(value: number | undefined): string {
  return typeof value === 'number' ? formatInteger(value) : 'Not reported'
}

function truncateText(value: string, maxChars: number): string {
  return value.length > maxChars ? `${value.slice(0, Math.max(0, maxChars - 1))}...` : value
}

function compactGroups(
  groups: Array<TabularWorkspaceViewerGroup | null | undefined>
): TabularWorkspaceViewerGroup[] {
  return groups.filter((group): group is TabularWorkspaceViewerGroup => Boolean(group))
}

function compactStrings(values: readonly (string | null | undefined | false)[] | undefined): string[] {
  return (values ?? [])
    .map((value) => typeof value === 'string' ? value.trim() : '')
    .filter(Boolean)
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
