import {
  Children,
  createElement,
  isValidElement,
  type ReactElement,
  type ReactNode
} from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  WORKSPACE_PREVIEW_CONTRACT_VERSION,
  type WorkspaceObservation
} from '@shared/workspace-preview'
import {
  buildTabularWorkspaceViewerModel,
  createTabularDeleteColumnsOperation,
  createTabularDeleteRowsOperation,
  createTabularInsertColumnsOperation,
  createTabularInsertRowsOperation,
  createTabularUpdateCellOperation,
  TabularWorkspaceViewerCellEditor,
  TabularWorkspaceViewerColumnInsertEditor,
  TabularWorkspaceViewerDeleteEditor,
  TabularWorkspaceViewerRowInsertEditor,
  TabularWorkspaceViewer,
  tabularSelectionContainsCoordinate
} from './TabularWorkspaceViewer'

function createTabularObservation(
  overrides: Partial<WorkspaceObservation> = {}
): WorkspaceObservation {
  return {
    schemaVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
    file: {
      path: '/workspace/lab/samples.csv',
      workspaceRoot: '/workspace/lab',
      mimeType: 'text/csv',
      size: 512
    },
    view: {
      pluginId: 'tabular',
      modality: 'tabular',
      mode: 'preview',
      title: 'Sample metadata'
    },
    visibleText: [
      'Tabular preview: 3 data rows x 2 columns.',
      'Detected format: CSV.',
      'Columns: sample, count.',
      'Column summary:',
      '- sample: string, 3 non-empty, 0 empty. examples: s1, s2',
      '- count: number, 3 non-empty, 0 empty. examples: 10, 20',
      'Preview rows:',
      'sample\tcount',
      's1\t10'
    ].join('\n'),
    tables: [
      {
        id: 'table-1',
        name: 'samples.csv',
        rowCount: 3,
        columnCount: 2
      }
    ],
    tabular: {
      header: ['sample', 'count'],
      rows: [
        { index: 0, values: ['s1', '10'] },
        { index: 1, values: ['s2', '20'] }
      ],
      truncatedRows: true,
      truncatedColumns: false
    },
    selection: {
      kind: 'tabular',
      sheet: 'samples.csv',
      ranges: [
        { rowStart: 0, rowEnd: 2, columnStart: 0, columnEnd: 1 },
        { rowStart: 4, rowEnd: 4, columnStart: 1, columnEnd: 1 }
      ],
      cells: [
        { row: 0, column: 0, value: 's1' },
        { row: 0, column: 1, value: 10 },
        { row: 1, column: 1, value: 20 }
      ]
    },
    actions: [
      'tabular.preview',
      'tabular.inspectColumns',
      'tabular.filterRows',
      'tabular.sortRows',
      'tabular.selectCells',
      'tabular.updateCell',
      'tabular.insertRows',
      'tabular.insertColumns',
      'tabular.deleteRows',
      'tabular.deleteColumns',
      'workspace.export:csv',
      'workspace.setSelection',
      'sequence.search'
    ],
    ...overrides
  }
}

function findElementByDataAttribute(
  node: ReactNode,
  attribute: string
): ReactElement<Record<string, unknown>> | null {
  if (!isValidElement(node)) return null

  const props = node.props as Record<string, unknown> & { children?: ReactNode }
  if (props[attribute] === 'true') return node as ReactElement<Record<string, unknown>>

  for (const child of Children.toArray(props.children)) {
    const match = findElementByDataAttribute(child, attribute)
    if (match) return match
  }

  return null
}

describe('TabularWorkspaceViewer', () => {
  it('builds an agent-readable tabular view model from table summary, visible text, and actions', () => {
    const model = buildTabularWorkspaceViewerModel(createTabularObservation())

    expect(model.status.kind).toBe('ready')
    expect(model.title).toBe('Sample metadata')
    expect(model.tables).toEqual([
      {
        id: 'table-1',
        name: 'samples.csv',
        rowCount: '3',
        columnCount: '2',
        summary: '3 rows x 2 columns'
      }
    ])
    expect(model.visibleText.kind).toBe('reported')
    expect(model.grid).toMatchObject({
      kind: 'preview',
      summary: 'Showing 2 preview rows x 2 columns. Filter: none. Sort: none. Bounded preview: more rows available.',
      header: ['sample', 'count']
    })
    expect(model.grid.filter).toMatchObject({
      text: '',
      active: false,
      matchedRowCount: 2,
      sourceRowCount: 2,
      summary: 'Filter: none'
    })
    expect(model.grid.sort).toMatchObject({
      columnIndex: null,
      columnLabel: null,
      direction: 'none',
      summary: 'Sort: none'
    })
    expect(model.visibleText.summary).toContain('characters across 9 non-empty lines')
    expect(model.visibleText.summary).toContain('1 line omitted')
    expect(model.visibleText.summary).toContain('Bounded grid state: Filter: none; Sort: none.')
    expect(model.visibleText.lines).toContain('Tabular preview: 3 data rows x 2 columns.')
    expect(model.actions.map((action) => [action.id, action.kind])).toEqual([
      ['tabular.preview', 'preview'],
      ['tabular.inspectColumns', 'inspect'],
      ['tabular.filterRows', 'filter'],
      ['tabular.sortRows', 'sort'],
      ['tabular.selectCells', 'select'],
      ['tabular.updateCell', 'edit'],
      ['tabular.insertRows', 'insert'],
      ['tabular.insertColumns', 'insert'],
      ['tabular.deleteRows', 'edit'],
      ['tabular.deleteColumns', 'edit'],
      ['workspace.export:csv', 'export'],
      ['workspace.setSelection', 'select']
    ])
    expect(Object.fromEntries(model.actions.map((action) => [action.id, action.enabled]))).toMatchObject({
      'tabular.updateCell': false,
      'tabular.insertRows': false,
      'tabular.insertColumns': false,
      'tabular.deleteRows': false,
      'tabular.deleteColumns': false,
      'workspace.export:csv': false,
      'tabular.filterRows': true,
      'tabular.sortRows': true
    })
    expect(model.agentSummary).toContain('grid: Showing 2 preview rows x 2 columns')
    expect(model.agentSummary).toContain('Filter: none. Sort: none.')
    expect(model.agentSummary).toContain('tables: samples.csv (3 rows x 2 columns)')
    expect(model.agentSummary).toContain('actions: Preview Table, Inspect Columns, Filter Rows, Sort Rows, Select Cells, Update Cell, Insert Rows, Insert Columns, Delete Rows, Delete Columns, Export CSV, Select')
  })

  it('filters visible cells, sorts bounded rows, and reports that state without dumping the table', () => {
    const model = buildTabularWorkspaceViewerModel(createTabularObservation({
      tabular: {
        header: ['sample', 'count'],
        rows: [
          { index: 0, values: ['s1', '10'] },
          { index: 1, values: ['control', '5'] },
          { index: 2, values: ['S2', '20'] }
        ],
        truncatedRows: false,
        truncatedColumns: false
      }
    }), {
      filterText: 's',
      sort: { columnIndex: 1, direction: 'desc' }
    })
    const html = renderToStaticMarkup(createElement(TabularWorkspaceViewer, { model }))
    const s2Position = html.indexOf('>S2</span>')
    const s1Position = html.indexOf('>s1</span>')

    expect(model.grid.rows.map((row) => row.values)).toEqual([
      ['S2', '20'],
      ['s1', '10']
    ])
    expect(model.grid.filter).toMatchObject({
      text: 's',
      active: true,
      matchedRowCount: 2,
      sourceRowCount: 3,
      summary: 'Filter "s" matched 2 of 3 bounded rows'
    })
    expect(model.grid.sort).toMatchObject({
      columnIndex: 1,
      columnLabel: 'count',
      direction: 'desc',
      summary: 'Sort: count descending'
    })
    expect(model.grid.summary).toContain('Showing 2 of 3 preview rows x 2 columns.')
    expect(model.agentSummary).toContain('Filter "s" matched 2 of 3 bounded rows')
    expect(model.agentSummary).toContain('Sort: count descending')
    expect(model.visibleText.summary).toContain('Bounded grid state: Filter "s" matched 2 of 3 bounded rows; Sort: count descending.')
    expect(model.visibleText.lines[0]).toBe('Bounded grid state: Filter "s" matched 2 of 3 bounded rows; Sort: count descending.')
    expect(html).toContain('value="s"')
    expect(html).toContain('data-filter-active="true"')
    expect(html).toContain('data-sort-column-index="1"')
    expect(html).toContain('data-sort-direction="desc"')
    expect(html).not.toContain('>control</span>')
    expect(s2Position).toBeGreaterThan(-1)
    expect(s1Position).toBeGreaterThan(-1)
    expect(s2Position).toBeLessThan(s1Position)
  })

  it('reports empty and unsupported states without trying to render a grid placeholder', () => {
    const empty = buildTabularWorkspaceViewerModel(null)
    const unsupported = buildTabularWorkspaceViewerModel({
      schemaVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
      file: {
        path: '/workspace/lab/genome.fa',
        workspaceRoot: '/workspace/lab',
        mimeType: 'text/x-fasta'
      },
      view: {
        pluginId: 'sequence-genomics',
        modality: 'sequence',
        mode: 'preview',
        title: 'genome.fa'
      },
      actions: ['workspace.setSelection']
    })
    const emptyHtml = renderToStaticMarkup(createElement(TabularWorkspaceViewer, { model: empty }))
    const unsupportedHtml = renderToStaticMarkup(createElement(TabularWorkspaceViewer, { model: unsupported }))

    expect(empty.status).toMatchObject({
      kind: 'empty',
      title: 'No tabular observation'
    })
    expect(unsupported.status).toMatchObject({
      kind: 'unsupported',
      title: 'Unsupported observation'
    })
    expect(emptyHtml).toContain('data-status="empty"')
    expect(emptyHtml).not.toContain('data-tabular-placeholder')
    expect(unsupportedHtml).toContain('data-status="unsupported"')
    expect(unsupportedHtml).toContain('Sequence observations cannot be rendered')
  })

  it('summarizes tabular ranges and cells for selection-aware rendering', () => {
    const model = buildTabularWorkspaceViewerModel(createTabularObservation())
    const groupsById = new Map(model.selection.groups.map((group) => [group.id, group]))
    const html = renderToStaticMarkup(createElement(TabularWorkspaceViewer, {
      observation: createTabularObservation()
    }))

    expect(model.selection.kind).toBe('tabular')
    expect(model.selection.summary).toBe('Selected sheet samples.csv, 2 ranges, 3 cells.')
    expect(groupsById.get('ranges')).toMatchObject({
      title: 'Selected ranges',
      summary: '2 ranges',
      items: ['rows 0-2, columns 0-1', 'row 4, column 1']
    })
    expect(groupsById.get('cells')).toMatchObject({
      title: 'Selected cells',
      summary: '3 cells',
      items: ['R0C0 = s1', 'R0C1 = 10', 'R1C1 = 20']
    })
    expect(html).toContain('data-workspace-preview-tabular-viewer')
    expect(html).toContain('data-tabular-grid="true"')
    expect(html).toContain('Bounded preview grid')
    expect(html).toContain('data-sort-column-index="0"')
    expect(html).toContain('<span>sample</span>')
    expect(html).toContain('data-cell-coordinate="1:0"')
    expect(html).toMatch(/data-cell-coordinate="1:0"[^>]*data-selected="true"/)
    expect(html).toContain('data-selection-intersects="true"')
    expect(tabularSelectionContainsCoordinate(createTabularObservation().selection, 1, 0)).toBe(true)
    expect(tabularSelectionContainsCoordinate(createTabularObservation().selection, 3, 0)).toBe(false)
    expect(html).toContain('>s2</span>')
    expect(html).toContain('Rows: 3; Columns: 2')
    expect(html).toContain('Selected ranges')
    expect(html).toContain('rows 0-2, columns 0-1')
    expect(html).toContain('R0C1 = 10')
    expect(html).toContain('data-action-kind="edit"')
    expect(html).toContain('data-action-kind="export"')
    expect(html).toMatch(/data-action-id="tabular\.updateCell"[^>]*data-action-enabled="false"/)
    expect(html).toMatch(/data-action-id="tabular\.insertColumns"[^>]*data-action-enabled="false"/)
    expect(html).toMatch(/data-action-id="tabular\.deleteRows"[^>]*data-action-enabled="false"/)
    expect(html).toMatch(/data-action-id="tabular\.deleteColumns"[^>]*data-action-enabled="false"/)
    expect(html).toMatch(/data-action-id="workspace\.export:csv"[^>]*data-action-enabled="false"/)
  })

  it('creates a tabular.updateCell operation from the observation path and bounded row index', () => {
    const observation = createTabularObservation()
    const operation = createTabularUpdateCellOperation({
      observation,
      row: observation.tabular?.rows?.[1]?.index ?? -1,
      column: 1,
      value: '21'
    })
    const onApplyEdit = vi.fn()
    const editor = TabularWorkspaceViewerCellEditor({
      observation,
      row: 1,
      column: 1,
      value: '21',
      onValueChange: vi.fn(),
      onApplyEdit,
      onCancel: vi.fn()
    })
    const apply = findElementByDataAttribute(editor, 'data-tabular-cell-apply')

    expect(operation).toEqual({
      kind: 'tabular.updateCell',
      path: '/workspace/lab/samples.csv',
      row: 1,
      column: 1,
      value: '21'
    })
    expect(apply?.props.disabled).toBe(false)

    ;(apply?.props.onClick as () => void)()

    expect(onApplyEdit).toHaveBeenCalledWith(operation)
  })

  it('creates a tabular.insertRows operation from the observation path, placement, and header-shaped row values', () => {
    const observation = createTabularObservation()
    const model = buildTabularWorkspaceViewerModel(observation)
    const header = model.grid.kind === 'preview' ? model.grid.header : []
    const rows = model.grid.kind === 'preview' ? model.grid.rows : []
    const topOperation = createTabularInsertRowsOperation({
      observation,
      afterRow: -1,
      values: ['s0', '5']
    })
    const afterRowOperation = createTabularInsertRowsOperation({
      observation,
      afterRow: 1,
      values: ['s3', '30']
    })
    const onApplyEdit = vi.fn()
    const editor = TabularWorkspaceViewerRowInsertEditor({
      observation,
      header,
      rows,
      afterRow: 1,
      values: ['s3', '30'],
      onAfterRowChange: vi.fn(),
      onValueChange: vi.fn(),
      onApplyEdit,
      onCancel: vi.fn()
    })
    const editorHtml = renderToStaticMarkup(createElement(TabularWorkspaceViewerRowInsertEditor, {
      observation,
      header,
      rows,
      afterRow: 1,
      values: ['s3', '30'],
      onAfterRowChange: vi.fn(),
      onValueChange: vi.fn(),
      onApplyEdit,
      onCancel: vi.fn()
    }))
    const apply = findElementByDataAttribute(editor, 'data-tabular-row-insert-apply')

    expect(topOperation).toEqual({
      kind: 'tabular.insertRows',
      path: '/workspace/lab/samples.csv',
      afterRow: -1,
      rows: [['s0', '5']]
    })
    expect(afterRowOperation).toEqual({
      kind: 'tabular.insertRows',
      path: '/workspace/lab/samples.csv',
      afterRow: 1,
      rows: [['s3', '30']]
    })
    expect(editorHtml.match(/data-tabular-row-insert-input="true"/g)).toHaveLength(2)
    expect(editorHtml).toContain('aria-label="New row sample"')
    expect(editorHtml).toContain('aria-label="New row count"')
    expect(apply?.props.disabled).toBe(false)

    ;(apply?.props.onClick as () => void)()

    expect(onApplyEdit).toHaveBeenCalledWith(afterRowOperation)
  })

  it('creates a tabular.insertColumns operation from the observation path, placement, and bounded column values', () => {
    const observation = createTabularObservation()
    const model = buildTabularWorkspaceViewerModel(observation)
    const header = model.grid.kind === 'preview' ? model.grid.header : []
    const rows = model.grid.kind === 'preview' ? model.grid.rows : []
    const firstOperation = createTabularInsertColumnsOperation({
      observation,
      afterColumn: -1,
      values: ['batch', 'b1', 'b2']
    })
    const afterColumnOperation = createTabularInsertColumnsOperation({
      observation,
      afterColumn: 1,
      values: ['batch', 'b1', 'b2']
    })
    const onApplyEdit = vi.fn()
    const editor = TabularWorkspaceViewerColumnInsertEditor({
      observation,
      header,
      rows,
      afterColumn: 1,
      values: ['batch', 'b1', 'b2'],
      onAfterColumnChange: vi.fn(),
      onValueChange: vi.fn(),
      onApplyEdit,
      onCancel: vi.fn()
    })
    const editorHtml = renderToStaticMarkup(createElement(TabularWorkspaceViewerColumnInsertEditor, {
      observation,
      header,
      rows,
      afterColumn: 1,
      values: ['batch', 'b1', 'b2'],
      onAfterColumnChange: vi.fn(),
      onValueChange: vi.fn(),
      onApplyEdit,
      onCancel: vi.fn()
    }))
    const apply = findElementByDataAttribute(editor, 'data-tabular-column-insert-apply')

    expect(firstOperation).toEqual({
      kind: 'tabular.insertColumns',
      path: '/workspace/lab/samples.csv',
      afterColumn: -1,
      columns: [['batch', 'b1', 'b2']]
    })
    expect(afterColumnOperation).toEqual({
      kind: 'tabular.insertColumns',
      path: '/workspace/lab/samples.csv',
      afterColumn: 1,
      columns: [['batch', 'b1', 'b2']]
    })
    expect(editorHtml.match(/data-tabular-column-insert-input="true"/g)).toHaveLength(3)
    expect(editorHtml).toContain('aria-label="New column header"')
    expect(editorHtml).toContain('aria-label="New column row 1"')
    expect(apply?.props.disabled).toBe(false)

    ;(apply?.props.onClick as () => void)()

    expect(onApplyEdit).toHaveBeenCalledWith(afterColumnOperation)
  })

  it('creates tabular row and column delete operations from the observation path and confirms before apply', () => {
    const observation = createTabularObservation()
    const rowOperation = createTabularDeleteRowsOperation({
      observation,
      rows: [1]
    })
    const columnOperation = createTabularDeleteColumnsOperation({
      observation,
      columns: [0]
    })
    const onApplyEdit = vi.fn()
    const editor = TabularWorkspaceViewerDeleteEditor({
      observation,
      kind: 'rows',
      rows: [1],
      onApplyEdit,
      onCancel: vi.fn()
    })
    const editorHtml = renderToStaticMarkup(createElement(TabularWorkspaceViewerDeleteEditor, {
      observation,
      kind: 'columns',
      columns: [0],
      onApplyEdit,
      onCancel: vi.fn()
    }))
    const apply = findElementByDataAttribute(editor, 'data-tabular-delete-apply')

    expect(rowOperation).toEqual({
      kind: 'tabular.deleteRows',
      path: '/workspace/lab/samples.csv',
      rows: [1]
    })
    expect(columnOperation).toEqual({
      kind: 'tabular.deleteColumns',
      path: '/workspace/lab/samples.csv',
      columns: [0]
    })
    expect(editorHtml).toContain('data-tabular-delete-editor="true"')
    expect(editorHtml).toContain('data-delete-kind="columns"')
    expect(editorHtml).toContain('Delete 1 column: 0')
    expect(apply?.props.disabled).toBe(false)

    ;(apply?.props.onClick as () => void)()

    expect(onApplyEdit).toHaveBeenCalledWith(rowOperation)
  })

  it('renders bounded row/column insert and delete entry points when connected', () => {
    const html = renderToStaticMarkup(createElement(TabularWorkspaceViewer, {
      observation: createTabularObservation(),
      onApplyEdit: vi.fn()
    }))

    expect(html).toContain('data-tabular-row-insert-controls="true"')
    expect(html).toContain('data-insert-enabled="true"')
    expect(html).toContain('data-tabular-row-insert-top="true"')
    expect(html).toContain('data-tabular-row-insert-bottom="true"')
    expect(html).toContain('data-tabular-row-insert-after="true"')
    expect(html).toContain('data-insert-after-row="1"')
    expect(html).toContain('data-tabular-column-insert-controls="true"')
    expect(html).toContain('data-tabular-column-insert-first="true"')
    expect(html).toContain('data-tabular-column-insert-last="true"')
    expect(html).toContain('data-tabular-column-insert-after="true"')
    expect(html).toContain('data-insert-after-column="1"')
    expect(html).toContain('data-tabular-row-delete="true"')
    expect(html).toContain('data-delete-row-index="1"')
    expect(html).toContain('data-tabular-column-delete="true"')
    expect(html).toContain('data-delete-column-index="1"')
    expect(html).toMatch(/data-action-id="tabular\.insertRows"[^>]*data-action-enabled="false"/)
    expect(html).toMatch(/data-action-id="tabular\.insertColumns"[^>]*data-action-enabled="false"/)
    expect(html).not.toContain('Connect an edit apply handler before inserting rows.')
    expect(html).not.toContain('Connect an edit apply handler before inserting columns.')
    expect(html).not.toContain('Connect an edit apply handler before deleting rows.')
    expect(html).not.toContain('Connect an edit apply handler before deleting columns.')
  })

  it('disables bounded edit and row insert controls when no apply callback is connected', () => {
    const html = renderToStaticMarkup(createElement(TabularWorkspaceViewer, {
      observation: createTabularObservation()
    }))

    expect(html).toContain('data-tabular-cell-edit="true"')
    expect(html).toContain('data-edit-enabled="false"')
    expect(html).toContain('Connect an edit apply handler before editing cells.')
    expect(html).toContain('data-tabular-row-insert-controls="true"')
    expect(html).toContain('data-insert-enabled="false"')
    expect(html).toContain('Connect an edit apply handler before inserting rows.')
    expect(html).toContain('data-tabular-column-insert-controls="true"')
    expect(html).toContain('Connect an edit apply handler before inserting columns.')
    expect(html).toContain('data-tabular-row-delete="true"')
    expect(html).toContain('data-tabular-column-delete="true"')
    expect(html).toContain('Connect an edit apply handler before deleting rows.')
    expect(html).toContain('Connect an edit apply handler before deleting columns.')
    expect(html).toMatch(/data-tabular-cell-edit="true"[^>]*disabled=""/)
    expect(html).toMatch(/data-tabular-row-insert-top="true"[^>]*disabled=""/)
    expect(html).toMatch(/data-tabular-row-insert-bottom="true"[^>]*disabled=""/)
    expect(html).toMatch(/data-tabular-column-insert-first="true"[^>]*disabled=""/)
    expect(html).toMatch(/data-tabular-column-insert-last="true"[^>]*disabled=""/)
    expect(html).toMatch(/data-tabular-row-delete="true"[^>]*disabled=""/)
    expect(html).toMatch(/data-tabular-column-delete="true"[^>]*disabled=""/)
    expect(html).toMatch(/data-action-id="tabular\.updateCell"[^>]*data-action-enabled="false"/)
    expect(html).toMatch(/data-action-id="tabular\.insertRows"[^>]*data-action-enabled="false"/)
    expect(html).toMatch(/data-action-id="tabular\.insertColumns"[^>]*data-action-enabled="false"/)
    expect(html).toMatch(/data-action-id="tabular\.deleteRows"[^>]*data-action-enabled="false"/)
    expect(html).toMatch(/data-action-id="tabular\.deleteColumns"[^>]*data-action-enabled="false"/)
    expect(html).toMatch(/data-action-id="workspace\.export:csv"[^>]*data-action-enabled="false"/)
  })

  it('keeps read-only tabular observations non-editable even when an apply callback is connected', () => {
    const html = renderToStaticMarkup(createElement(TabularWorkspaceViewer, {
      observation: createTabularObservation({
        file: {
          path: '/workspace/lab/records.jsonl',
          workspaceRoot: '/workspace/lab',
          mimeType: 'application/x-ndjson',
          size: 512
        },
        actions: [
          'tabular.preview',
          'tabular.inspectColumns',
          'tabular.filterRows',
          'tabular.sortRows',
          'tabular.selectCells'
        ]
      }),
      onApplyEdit: vi.fn()
    }))

    expect(html).toContain('data-tabular-cell-edit="true"')
    expect(html).toContain('data-edit-enabled="false"')
    expect(html).toContain('data-insert-enabled="false"')
    expect(html).toContain('This observation does not advertise tabular.updateCell.')
    expect(html).toContain('This observation does not advertise tabular.insertRows.')
    expect(html).toContain('This observation does not advertise tabular.insertColumns.')
    expect(html).toContain('This observation does not advertise tabular.deleteRows.')
    expect(html).toContain('This observation does not advertise tabular.deleteColumns.')
    expect(html).toMatch(/data-tabular-cell-edit="true"[^>]*disabled=""/)
    expect(html).toMatch(/data-tabular-row-insert-top="true"[^>]*disabled=""/)
    expect(html).toMatch(/data-tabular-column-insert-first="true"[^>]*disabled=""/)
    expect(html).toMatch(/data-tabular-row-delete="true"[^>]*disabled=""/)
    expect(html).toMatch(/data-tabular-column-delete="true"[^>]*disabled=""/)
    expect(html).not.toContain('data-action-id="tabular.updateCell"')
    expect(html).not.toContain('data-action-id="tabular.insertRows"')
    expect(html).not.toContain('data-action-id="tabular.insertColumns"')
    expect(html).not.toContain('data-action-id="tabular.deleteRows"')
    expect(html).not.toContain('data-action-id="tabular.deleteColumns"')
  })

  it('disables bounded row insert controls when observation context is missing or insertRows is not advertised', () => {
    const onApplyEdit = vi.fn()
    const model = buildTabularWorkspaceViewerModel(createTabularObservation())
    const withoutObservationHtml = renderToStaticMarkup(createElement(TabularWorkspaceViewer, {
      model,
      onApplyEdit
    }))
    const withoutAdvertiseHtml = renderToStaticMarkup(createElement(TabularWorkspaceViewer, {
      observation: createTabularObservation({
        actions: [
          'tabular.preview',
          'tabular.updateCell'
        ]
      }),
      onApplyEdit
    }))

    expect(withoutObservationHtml).toContain('A source tabular observation is required before rows can be inserted.')
    expect(withoutObservationHtml).toMatch(/data-tabular-row-insert-top="true"[^>]*disabled=""/)
    expect(withoutAdvertiseHtml).toContain('This observation does not advertise tabular.insertRows.')
    expect(withoutAdvertiseHtml).toMatch(/data-tabular-row-insert-bottom="true"[^>]*disabled=""/)
  })

  it('disables bounded column insert controls when observation context is missing or insertColumns is not advertised', () => {
    const onApplyEdit = vi.fn()
    const model = buildTabularWorkspaceViewerModel(createTabularObservation())
    const withoutObservationHtml = renderToStaticMarkup(createElement(TabularWorkspaceViewer, {
      model,
      onApplyEdit
    }))
    const withoutAdvertiseHtml = renderToStaticMarkup(createElement(TabularWorkspaceViewer, {
      observation: createTabularObservation({
        actions: [
          'tabular.preview',
          'tabular.updateCell',
          'tabular.insertRows'
        ]
      }),
      onApplyEdit
    }))

    expect(withoutObservationHtml).toContain('A source tabular observation is required before columns can be inserted.')
    expect(withoutObservationHtml).toMatch(/data-tabular-column-insert-first="true"[^>]*disabled=""/)
    expect(withoutAdvertiseHtml).toContain('This observation does not advertise tabular.insertColumns.')
    expect(withoutAdvertiseHtml).toMatch(/data-tabular-column-insert-last="true"[^>]*disabled=""/)
  })

  it('disables bounded delete controls when observation context is missing or delete actions are not advertised', () => {
    const onApplyEdit = vi.fn()
    const model = buildTabularWorkspaceViewerModel(createTabularObservation())
    const withoutObservationHtml = renderToStaticMarkup(createElement(TabularWorkspaceViewer, {
      model,
      onApplyEdit
    }))
    const withoutAdvertiseHtml = renderToStaticMarkup(createElement(TabularWorkspaceViewer, {
      observation: createTabularObservation({
        actions: [
          'tabular.preview',
          'tabular.updateCell',
          'tabular.insertRows'
        ]
      }),
      onApplyEdit
    }))

    expect(withoutObservationHtml).toContain('A source tabular observation is required before rows can be deleted.')
    expect(withoutObservationHtml).toContain('A source tabular observation is required before columns can be deleted.')
    expect(withoutObservationHtml).toMatch(/data-tabular-row-delete="true"[^>]*disabled=""/)
    expect(withoutObservationHtml).toMatch(/data-tabular-column-delete="true"[^>]*disabled=""/)
    expect(withoutAdvertiseHtml).toContain('This observation does not advertise tabular.deleteRows.')
    expect(withoutAdvertiseHtml).toContain('This observation does not advertise tabular.deleteColumns.')
  })

  it('cancels an active cell edit without triggering apply', () => {
    const onApplyEdit = vi.fn()
    const onCancel = vi.fn()
    const editor = TabularWorkspaceViewerCellEditor({
      observation: createTabularObservation(),
      row: 1,
      column: 0,
      value: 's2-updated',
      onValueChange: vi.fn(),
      onApplyEdit,
      onCancel
    })
    const cancel = findElementByDataAttribute(editor, 'data-tabular-cell-cancel')

    ;(cancel?.props.onClick as () => void)()

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onApplyEdit).not.toHaveBeenCalled()
  })

  it('cancels an active row insert without triggering apply', () => {
    const onApplyEdit = vi.fn()
    const onCancel = vi.fn()
    const observation = createTabularObservation()
    const model = buildTabularWorkspaceViewerModel(observation)
    const editor = TabularWorkspaceViewerRowInsertEditor({
      observation,
      header: model.grid.kind === 'preview' ? model.grid.header : [],
      rows: model.grid.kind === 'preview' ? model.grid.rows : [],
      afterRow: -1,
      values: ['s0', '5'],
      onAfterRowChange: vi.fn(),
      onValueChange: vi.fn(),
      onApplyEdit,
      onCancel
    })
    const cancel = findElementByDataAttribute(editor, 'data-tabular-row-insert-cancel')

    ;(cancel?.props.onClick as () => void)()

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onApplyEdit).not.toHaveBeenCalled()
  })

  it('cancels an active column insert without triggering apply', () => {
    const onApplyEdit = vi.fn()
    const onCancel = vi.fn()
    const observation = createTabularObservation()
    const model = buildTabularWorkspaceViewerModel(observation)
    const editor = TabularWorkspaceViewerColumnInsertEditor({
      observation,
      header: model.grid.kind === 'preview' ? model.grid.header : [],
      rows: model.grid.kind === 'preview' ? model.grid.rows : [],
      afterColumn: -1,
      values: ['batch', 'b1', 'b2'],
      onAfterColumnChange: vi.fn(),
      onValueChange: vi.fn(),
      onApplyEdit,
      onCancel
    })
    const cancel = findElementByDataAttribute(editor, 'data-tabular-column-insert-cancel')

    ;(cancel?.props.onClick as () => void)()

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onApplyEdit).not.toHaveBeenCalled()
  })

  it('cancels an active row or column delete without triggering apply', () => {
    const onApplyEdit = vi.fn()
    const onCancel = vi.fn()
    const editor = TabularWorkspaceViewerDeleteEditor({
      observation: createTabularObservation(),
      kind: 'columns',
      columns: [1],
      onApplyEdit,
      onCancel
    })
    const cancel = findElementByDataAttribute(editor, 'data-tabular-delete-cancel')

    ;(cancel?.props.onClick as () => void)()

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onApplyEdit).not.toHaveBeenCalled()
  })

  it('keeps tabular observations without reported tables readable', () => {
    const model = buildTabularWorkspaceViewerModel(createTabularObservation({
      tables: [],
      tabular: undefined,
      selection: undefined,
      visibleText: undefined,
      actions: []
    }))
    const html = renderToStaticMarkup(createElement(TabularWorkspaceViewer, { model }))

    expect(model.status.kind).toBe('ready')
    expect(model.grid.kind).toBe('none')
    expect(model.tables).toEqual([])
    expect(model.selection.summary).toBe('No tabular selection.')
    expect(model.visibleText.summary).toBe('No visible text summary was reported.')
    expect(html).toContain('No table row/column summary was reported.')
    expect(html).toContain('No select, inspect, filter, sort, edit, insert, or export actions are available.')
  })
})
