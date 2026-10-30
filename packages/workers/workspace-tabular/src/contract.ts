import { z } from 'zod'

export const WORKSPACE_TABULAR_CONTRACT_VERSION = 1
export const WORKSPACE_PREVIEW_CONTRACT_VERSION = 1
export const WORKSPACE_TABULAR_PACKAGE_NAME = '@sciforge/workspace-tabular'
export const WORKSPACE_TABULAR_PLUGIN_ID = 'tabular'

export const WORKSPACE_TABULAR_DEFAULT_PREVIEW_ROWS = 50
export const WORKSPACE_TABULAR_MAX_PREVIEW_ROWS = 200
export const WORKSPACE_TABULAR_DEFAULT_COLUMN_LIMIT = 100
export const WORKSPACE_TABULAR_MAX_COLUMNS = 500
export const WORKSPACE_TABULAR_MAX_TEXT_CHARS = 2_000_000
export const WORKSPACE_TABULAR_MAX_BINARY_BYTES = 4 * 1024 * 1024
export const WORKSPACE_TABULAR_MAX_CELL_CHARS = 10_000
export const WORKSPACE_TABULAR_MAX_HEADER_CHARS = 256
export const WORKSPACE_TABULAR_MAX_VISIBLE_TEXT_CHARS = 200_000
export const WORKSPACE_TABULAR_MAX_WARNINGS = 20
export const WORKSPACE_TABULAR_DEFAULT_DISCOVERY_ROWS = 1_000
export const WORKSPACE_TABULAR_MAX_DISCOVERY_ROWS = 5_000
export const WORKSPACE_TABULAR_MAX_EDIT_ROWS = 10_000
export const WORKSPACE_TABULAR_MAX_FILTERS = 50
export const WORKSPACE_TABULAR_MAX_SORTS = 10
export const WORKSPACE_TABULAR_MAX_SELECTION_CELLS = 10_000
export const WORKSPACE_TABULAR_MAX_QUERY_ROWS = WORKSPACE_TABULAR_MAX_EDIT_ROWS

export const WORKSPACE_TABULAR_ACTIONS = [
  'tabular.preview',
  'tabular.inspectColumns',
  'tabular.filterRows',
  'tabular.sortRows',
  'tabular.selectCells',
  'tabular.updateCell',
  'tabular.insertRows',
  'tabular.insertColumns',
  'tabular.deleteRows',
  'tabular.deleteColumns'
] as const

export const WORKSPACE_TABULAR_READONLY_ACTIONS = [
  'tabular.preview',
  'tabular.inspectColumns',
  'tabular.filterRows',
  'tabular.sortRows',
  'tabular.selectCells'
] as const

export const workspaceTabularFormatSchema = z.enum(['auto', 'csv', 'tsv', 'jsonl', 'ndjson'])
export const workspaceTabularResolvedFormatSchema = z.enum(['csv', 'tsv', 'jsonl', 'ndjson', 'xlsx'])
export const workspaceTabularDelimiterSchema = z.enum([',', '\t'])
export const workspaceTabularFilterOperatorSchema = z.enum([
  'equals',
  'notEquals',
  'contains',
  'notContains',
  'startsWith',
  'endsWith',
  'isEmpty',
  'isNotEmpty',
  'gt',
  'gte',
  'lt',
  'lte'
])
export const workspaceTabularSortDirectionSchema = z.enum(['asc', 'desc'])
export const workspaceTabularComparisonModeSchema = z.enum(['auto', 'string', 'number', 'date', 'boolean'])
export const workspaceTabularEmptySortOrderSchema = z.enum(['first', 'last'])
export const workspaceTabularColumnTypeSchema = z.enum([
  'empty',
  'null',
  'number',
  'boolean',
  'date',
  'object',
  'array',
  'string',
  'mixed'
])

const pathSchema = z.string().trim().min(1).max(4096)
const optionalPathSchema = z.string().trim().max(4096).optional()
const mimeTypeSchema = z.string().trim().max(128)
const boundedWarningSchema = z.string().trim().min(1).max(1000)
const boundedCellSchema = z.string().max(WORKSPACE_TABULAR_MAX_CELL_CHARS)
const boundedHeaderSchema = z.string().max(WORKSPACE_TABULAR_MAX_HEADER_CHARS)
const boundedShortTextSchema = z.string().trim().max(256)
const boundedBytesSchema = z.instanceof(Uint8Array)
  .refine((bytes) => bytes.byteLength <= WORKSPACE_TABULAR_MAX_BINARY_BYTES, {
    message: `XLSX preview bytes must be ${WORKSPACE_TABULAR_MAX_BINARY_BYTES} bytes or smaller.`
  })
const filterValueSchema = z.union([
  boundedCellSchema,
  z.number().finite(),
  z.boolean(),
  z.null()
])

export const workspaceTabularPreviewInputSchema = z.object({
  text: z.string().max(WORKSPACE_TABULAR_MAX_TEXT_CHARS),
  format: workspaceTabularFormatSchema.default('auto'),
  delimiter: workspaceTabularDelimiterSchema.optional(),
  hasHeader: z.boolean().default(true),
  maxPreviewRows: z.number().int().min(0).max(WORKSPACE_TABULAR_MAX_PREVIEW_ROWS).default(WORKSPACE_TABULAR_DEFAULT_PREVIEW_ROWS),
  maxColumns: z.number().int().min(1).max(WORKSPACE_TABULAR_MAX_COLUMNS).default(WORKSPACE_TABULAR_DEFAULT_COLUMN_LIMIT),
  maxDiscoveryRows: z.number().int().min(1).max(WORKSPACE_TABULAR_MAX_DISCOVERY_ROWS).default(WORKSPACE_TABULAR_DEFAULT_DISCOVERY_ROWS),
  includeObservation: z.boolean().default(true),
  path: optionalPathSchema,
  workspaceRoot: optionalPathSchema,
  mimeType: mimeTypeSchema.optional(),
  size: z.number().finite().nonnegative().optional(),
  mtimeMs: z.number().finite().nonnegative().optional()
}).strict()

export const workspaceTabularXlsxPreviewInputSchema = z.object({
  bytes: boundedBytesSchema,
  hasHeader: z.boolean().default(true),
  maxPreviewRows: z.number().int().min(0).max(WORKSPACE_TABULAR_MAX_PREVIEW_ROWS).default(WORKSPACE_TABULAR_DEFAULT_PREVIEW_ROWS),
  maxColumns: z.number().int().min(1).max(WORKSPACE_TABULAR_MAX_COLUMNS).default(WORKSPACE_TABULAR_DEFAULT_COLUMN_LIMIT),
  includeObservation: z.boolean().default(true),
  path: optionalPathSchema,
  workspaceRoot: optionalPathSchema,
  mimeType: mimeTypeSchema.optional(),
  size: z.number().finite().nonnegative().optional(),
  mtimeMs: z.number().finite().nonnegative().optional()
}).strict()

export const workspaceTabularPreviewRowSchema = z.object({
  index: z.number().int().nonnegative(),
  values: z.array(boundedCellSchema).max(WORKSPACE_TABULAR_MAX_COLUMNS)
}).strict()

export const workspaceTabularColumnSummarySchema = z.object({
  index: z.number().int().nonnegative(),
  name: boundedHeaderSchema,
  inferredType: workspaceTabularColumnTypeSchema,
  nonEmptyCount: z.number().int().nonnegative(),
  emptyCount: z.number().int().nonnegative(),
  examples: z.array(boundedCellSchema).max(3)
}).strict()

export const workspaceTabularFilterRuleSchema = z.object({
  column: z.number().int().min(0).max(WORKSPACE_TABULAR_MAX_COLUMNS - 1).optional(),
  columnName: boundedHeaderSchema.optional(),
  operator: workspaceTabularFilterOperatorSchema,
  value: filterValueSchema.optional(),
  caseSensitive: z.boolean().default(false),
  compareAs: workspaceTabularComparisonModeSchema.default('auto')
}).strict().superRefine((rule, context) => {
  if (rule.column === undefined && !rule.columnName) {
    context.addIssue({
      code: 'custom',
      message: 'Filter rule requires either column or columnName.'
    })
  }
  if (rule.operator !== 'isEmpty' && rule.operator !== 'isNotEmpty' && rule.value === undefined) {
    context.addIssue({
      code: 'custom',
      message: `Filter operator ${rule.operator} requires a value.`
    })
  }
})

export const workspaceTabularSortRuleSchema = z.object({
  column: z.number().int().min(0).max(WORKSPACE_TABULAR_MAX_COLUMNS - 1).optional(),
  columnName: boundedHeaderSchema.optional(),
  direction: workspaceTabularSortDirectionSchema.default('asc'),
  compareAs: workspaceTabularComparisonModeSchema.default('auto'),
  empty: workspaceTabularEmptySortOrderSchema.default('last')
}).strict().superRefine((rule, context) => {
  if (rule.column === undefined && !rule.columnName) {
    context.addIssue({
      code: 'custom',
      message: 'Sort rule requires either column or columnName.'
    })
  }
})

export const workspaceTabularSelectionRangeSchema = z.object({
  rowStart: z.number().int().min(0),
  rowEnd: z.number().int().min(0),
  columnStart: z.number().int().min(0).max(WORKSPACE_TABULAR_MAX_COLUMNS - 1),
  columnEnd: z.number().int().min(0).max(WORKSPACE_TABULAR_MAX_COLUMNS - 1)
}).strict()

export const workspaceTabularSelectionCellSchema = z.object({
  row: z.number().int().min(0),
  column: z.number().int().min(0).max(WORKSPACE_TABULAR_MAX_COLUMNS - 1),
  value: z.unknown().optional()
}).strict()

export const workspaceTabularSelectionCellReferenceSchema = z.object({
  row: z.number().int().min(0),
  column: z.number().int().min(0).max(WORKSPACE_TABULAR_MAX_COLUMNS - 1)
}).strict()

export const workspaceTabularStructuredSelectionSchema = z.object({
  kind: z.literal('tabular'),
  sheet: boundedShortTextSchema.optional(),
  ranges: z.array(workspaceTabularSelectionRangeSchema).min(1).max(WORKSPACE_TABULAR_MAX_SELECTION_CELLS),
  cells: z.array(workspaceTabularSelectionCellSchema).max(WORKSPACE_TABULAR_MAX_SELECTION_CELLS).optional()
}).strict()

export const workspaceTabularSelectionRequestSchema = z.object({
  sheet: boundedShortTextSchema.optional(),
  ranges: z.array(workspaceTabularSelectionRangeSchema).max(WORKSPACE_TABULAR_MAX_SELECTION_CELLS).default([]),
  cells: z.array(workspaceTabularSelectionCellReferenceSchema).max(WORKSPACE_TABULAR_MAX_SELECTION_CELLS).default([]),
  includeCellValues: z.boolean().default(true),
  maxCells: z.number().int().min(0).max(WORKSPACE_TABULAR_MAX_SELECTION_CELLS).default(WORKSPACE_TABULAR_MAX_SELECTION_CELLS)
}).strict().superRefine((selection, context) => {
  if (selection.ranges.length === 0 && selection.cells.length === 0) {
    context.addIssue({
      code: 'custom',
      message: 'Selection request requires at least one range or cell.'
    })
  }
})

export const workspaceTabularSelectionSummarySchema = z.object({
  selection: workspaceTabularStructuredSelectionSchema,
  selectedRowCount: z.number().int().nonnegative(),
  selectedCellCount: z.number().int().nonnegative(),
  truncatedCells: z.boolean(),
  visibleText: z.string().max(WORKSPACE_TABULAR_MAX_VISIBLE_TEXT_CHARS)
}).strict()

export const workspaceTabularSelectionSummaryInputSchema = z.object({
  rows: z.array(workspaceTabularPreviewRowSchema).max(WORKSPACE_TABULAR_MAX_QUERY_ROWS),
  header: z.array(boundedHeaderSchema).max(WORKSPACE_TABULAR_MAX_COLUMNS).optional(),
  selection: workspaceTabularSelectionRequestSchema
}).strict()

export const workspaceTabularQueryInputSchema = z.object({
  rows: z.array(workspaceTabularPreviewRowSchema).max(WORKSPACE_TABULAR_MAX_QUERY_ROWS),
  header: z.array(boundedHeaderSchema).max(WORKSPACE_TABULAR_MAX_COLUMNS).optional(),
  filters: z.array(workspaceTabularFilterRuleSchema).max(WORKSPACE_TABULAR_MAX_FILTERS).default([]),
  sorts: z.array(workspaceTabularSortRuleSchema).max(WORKSPACE_TABULAR_MAX_SORTS).default([]),
  selection: workspaceTabularSelectionRequestSchema.optional(),
  maxRows: z.number().int().min(0).max(WORKSPACE_TABULAR_MAX_QUERY_ROWS).default(WORKSPACE_TABULAR_DEFAULT_PREVIEW_ROWS)
}).strict()

export const workspaceTabularQueryResultSchema = z.object({
  rows: z.array(workspaceTabularPreviewRowSchema).max(WORKSPACE_TABULAR_MAX_QUERY_ROWS),
  sourceRowCount: z.number().int().nonnegative(),
  filteredRowCount: z.number().int().nonnegative(),
  returnedRowCount: z.number().int().nonnegative(),
  truncatedRows: z.boolean(),
  filtersApplied: z.number().int().nonnegative(),
  sortsApplied: z.number().int().nonnegative(),
  selectionSummary: workspaceTabularSelectionSummarySchema.optional(),
  visibleText: z.string().max(WORKSPACE_TABULAR_MAX_VISIBLE_TEXT_CHARS)
}).strict()

export const workspaceTabularObservationSchema = z.object({
  schemaVersion: z.literal(WORKSPACE_PREVIEW_CONTRACT_VERSION),
  file: z.object({
    path: pathSchema,
    workspaceRoot: optionalPathSchema,
    mimeType: mimeTypeSchema.optional(),
    size: z.number().finite().nonnegative().optional(),
    mtimeMs: z.number().finite().nonnegative().optional()
  }).strict(),
  view: z.object({
    pluginId: z.literal(WORKSPACE_TABULAR_PLUGIN_ID),
    modality: z.literal('tabular'),
    mode: z.literal('preview'),
    title: z.string().trim().min(1).max(512)
  }).strict(),
  selection: workspaceTabularStructuredSelectionSchema.optional(),
  visibleText: z.string().max(WORKSPACE_TABULAR_MAX_VISIBLE_TEXT_CHARS).optional(),
  tables: z.array(z.object({
    id: z.string().trim().min(1).max(256),
    name: z.string().trim().max(256).optional(),
    rowCount: z.number().int().nonnegative().optional(),
    columnCount: z.number().int().nonnegative().optional()
  }).strict()).max(1000).optional(),
  annotations: z.array(z.object({
    id: z.string().trim().min(1).max(256),
    kind: z.string().trim().min(1).max(128),
    summary: z.string().trim().max(1000).optional()
  }).strict()).max(1000).optional(),
  actions: z.array(z.string().trim().min(1).max(128)).max(256)
}).strict()

export const workspaceTabularPreviewResultSchema = z.object({
  ok: z.literal(true),
  contractVersion: z.literal(WORKSPACE_TABULAR_CONTRACT_VERSION),
  format: workspaceTabularResolvedFormatSchema,
  delimiter: workspaceTabularDelimiterSchema.optional(),
  rowCount: z.number().int().nonnegative(),
  rowCountIsEstimate: z.boolean(),
  columnCount: z.number().int().nonnegative(),
  header: z.array(boundedHeaderSchema).max(WORKSPACE_TABULAR_MAX_COLUMNS),
  previewRows: z.array(workspaceTabularPreviewRowSchema).max(WORKSPACE_TABULAR_MAX_PREVIEW_ROWS),
  columns: z.array(workspaceTabularColumnSummarySchema).max(WORKSPACE_TABULAR_MAX_COLUMNS),
  truncatedRows: z.boolean(),
  truncatedColumns: z.boolean(),
  warnings: z.array(boundedWarningSchema).max(WORKSPACE_TABULAR_MAX_WARNINGS),
  observation: workspaceTabularObservationSchema.optional()
}).strict()

export const workspaceTabularDataRowSchema = z.array(z.unknown()).max(WORKSPACE_TABULAR_MAX_COLUMNS)
export const workspaceTabularDataColumnSchema = z.array(z.unknown()).max(WORKSPACE_TABULAR_MAX_EDIT_ROWS + 1)
export const workspaceTabularDataSchema = z.array(workspaceTabularDataRowSchema).max(WORKSPACE_TABULAR_MAX_EDIT_ROWS)

export const workspaceTabularUpdateCellInputSchema = z.object({
  rows: workspaceTabularDataSchema,
  row: z.number().int().min(0).max(WORKSPACE_TABULAR_MAX_EDIT_ROWS - 1),
  column: z.number().int().min(0).max(WORKSPACE_TABULAR_MAX_COLUMNS - 1),
  value: z.unknown()
}).strict()

export const workspaceTabularInsertRowsInputSchema = z.object({
  rows: workspaceTabularDataSchema,
  afterRow: z.number().int().min(-1).max(WORKSPACE_TABULAR_MAX_EDIT_ROWS - 1),
  insertRows: z.array(workspaceTabularDataRowSchema).min(1).max(WORKSPACE_TABULAR_MAX_EDIT_ROWS)
}).strict()

export const workspaceTabularInsertColumnsInputSchema = z.object({
  rows: workspaceTabularDataSchema,
  afterColumn: z.number().int().min(-1).max(WORKSPACE_TABULAR_MAX_COLUMNS - 1),
  columns: z.array(workspaceTabularDataColumnSchema).min(1).max(WORKSPACE_TABULAR_MAX_COLUMNS)
}).strict()

export const workspaceTabularDeleteRowsInputSchema = z.object({
  rows: workspaceTabularDataSchema,
  rowIndices: z.array(z.number().int().min(0).max(WORKSPACE_TABULAR_MAX_EDIT_ROWS - 1))
    .min(1)
    .max(WORKSPACE_TABULAR_MAX_EDIT_ROWS)
}).strict()

export const workspaceTabularDeleteColumnsInputSchema = z.object({
  rows: workspaceTabularDataSchema,
  columnIndices: z.array(z.number().int().min(0).max(WORKSPACE_TABULAR_MAX_COLUMNS - 1))
    .min(1)
    .max(WORKSPACE_TABULAR_MAX_COLUMNS)
}).strict()

export type WorkspaceTabularFormat = z.infer<typeof workspaceTabularFormatSchema>
export type WorkspaceTabularResolvedFormat = z.infer<typeof workspaceTabularResolvedFormatSchema>
export type WorkspaceTabularDelimiter = z.infer<typeof workspaceTabularDelimiterSchema>
export type WorkspaceTabularFilterOperator = z.infer<typeof workspaceTabularFilterOperatorSchema>
export type WorkspaceTabularSortDirection = z.infer<typeof workspaceTabularSortDirectionSchema>
export type WorkspaceTabularComparisonMode = z.infer<typeof workspaceTabularComparisonModeSchema>
export type WorkspaceTabularEmptySortOrder = z.infer<typeof workspaceTabularEmptySortOrderSchema>
export type WorkspaceTabularColumnType = z.infer<typeof workspaceTabularColumnTypeSchema>
export type WorkspaceTabularPreviewInput = z.input<typeof workspaceTabularPreviewInputSchema>
export type NormalizedWorkspaceTabularPreviewInput = z.output<typeof workspaceTabularPreviewInputSchema>
export type WorkspaceTabularXlsxPreviewInput = z.input<typeof workspaceTabularXlsxPreviewInputSchema>
export type NormalizedWorkspaceTabularXlsxPreviewInput = z.output<typeof workspaceTabularXlsxPreviewInputSchema>
export type WorkspaceTabularPreviewRow = z.infer<typeof workspaceTabularPreviewRowSchema>
export type WorkspaceTabularColumnSummary = z.infer<typeof workspaceTabularColumnSummarySchema>
export type WorkspaceTabularFilterRule = z.input<typeof workspaceTabularFilterRuleSchema>
export type NormalizedWorkspaceTabularFilterRule = z.output<typeof workspaceTabularFilterRuleSchema>
export type WorkspaceTabularSortRule = z.input<typeof workspaceTabularSortRuleSchema>
export type NormalizedWorkspaceTabularSortRule = z.output<typeof workspaceTabularSortRuleSchema>
export type WorkspaceTabularSelectionRange = z.infer<typeof workspaceTabularSelectionRangeSchema>
export type WorkspaceTabularSelectionCell = z.infer<typeof workspaceTabularSelectionCellSchema>
export type WorkspaceTabularSelectionCellReference = z.infer<typeof workspaceTabularSelectionCellReferenceSchema>
export type WorkspaceTabularStructuredSelection = z.infer<typeof workspaceTabularStructuredSelectionSchema>
export type WorkspaceTabularSelectionRequest = z.input<typeof workspaceTabularSelectionRequestSchema>
export type NormalizedWorkspaceTabularSelectionRequest = z.output<typeof workspaceTabularSelectionRequestSchema>
export type WorkspaceTabularSelectionSummary = z.infer<typeof workspaceTabularSelectionSummarySchema>
export type WorkspaceTabularSelectionSummaryInput = z.input<typeof workspaceTabularSelectionSummaryInputSchema>
export type NormalizedWorkspaceTabularSelectionSummaryInput = z.output<typeof workspaceTabularSelectionSummaryInputSchema>
export type WorkspaceTabularQueryInput = z.input<typeof workspaceTabularQueryInputSchema>
export type NormalizedWorkspaceTabularQueryInput = z.output<typeof workspaceTabularQueryInputSchema>
export type WorkspaceTabularQueryResult = z.infer<typeof workspaceTabularQueryResultSchema>
export type WorkspaceTabularObservation = z.infer<typeof workspaceTabularObservationSchema>
export type WorkspaceTabularPreviewResult = z.infer<typeof workspaceTabularPreviewResultSchema>
export type WorkspaceTabularDataRow = z.infer<typeof workspaceTabularDataRowSchema>
export type WorkspaceTabularDataColumn = z.infer<typeof workspaceTabularDataColumnSchema>
export type WorkspaceTabularData = z.infer<typeof workspaceTabularDataSchema>
export type WorkspaceTabularUpdateCellInput = z.input<typeof workspaceTabularUpdateCellInputSchema>
export type WorkspaceTabularInsertRowsInput = z.input<typeof workspaceTabularInsertRowsInputSchema>
export type WorkspaceTabularInsertColumnsInput = z.input<typeof workspaceTabularInsertColumnsInputSchema>
export type WorkspaceTabularDeleteRowsInput = z.input<typeof workspaceTabularDeleteRowsInputSchema>
export type WorkspaceTabularDeleteColumnsInput = z.input<typeof workspaceTabularDeleteColumnsInputSchema>
