import { posix as pathPosix } from 'node:path'

import { XMLParser } from 'fast-xml-parser'
import JSZip from 'jszip'

import {
  WORKSPACE_PREVIEW_CONTRACT_VERSION,
  WORKSPACE_TABULAR_ACTIONS,
  WORKSPACE_TABULAR_CONTRACT_VERSION,
  WORKSPACE_TABULAR_MAX_CELL_CHARS,
  WORKSPACE_TABULAR_MAX_COLUMNS,
  WORKSPACE_TABULAR_MAX_EDIT_ROWS,
  WORKSPACE_TABULAR_MAX_HEADER_CHARS,
  WORKSPACE_TABULAR_MAX_VISIBLE_TEXT_CHARS,
  WORKSPACE_TABULAR_MAX_WARNINGS,
  WORKSPACE_TABULAR_PLUGIN_ID,
  WORKSPACE_TABULAR_READONLY_ACTIONS,
  workspaceTabularDeleteColumnsInputSchema,
  workspaceTabularDeleteRowsInputSchema,
  workspaceTabularInsertColumnsInputSchema,
  workspaceTabularInsertRowsInputSchema,
  workspaceTabularPreviewResultSchema,
  workspaceTabularQueryInputSchema,
  workspaceTabularQueryResultSchema,
  workspaceTabularSelectionSummaryInputSchema,
  workspaceTabularSelectionSummarySchema,
  workspaceTabularUpdateCellInputSchema,
  workspaceTabularXlsxPreviewInputSchema,
  type NormalizedWorkspaceTabularPreviewInput,
  type NormalizedWorkspaceTabularQueryInput,
  type NormalizedWorkspaceTabularSelectionRequest,
  type NormalizedWorkspaceTabularSelectionSummaryInput,
  type NormalizedWorkspaceTabularXlsxPreviewInput,
  type WorkspaceTabularColumnSummary,
  type WorkspaceTabularColumnType,
  type WorkspaceTabularComparisonMode,
  type WorkspaceTabularDeleteColumnsInput,
  type WorkspaceTabularDeleteRowsInput,
  type WorkspaceTabularDelimiter,
  type WorkspaceTabularInsertColumnsInput,
  type WorkspaceTabularInsertRowsInput,
  type WorkspaceTabularObservation,
  type WorkspaceTabularPreviewResult,
  type WorkspaceTabularPreviewRow,
  type WorkspaceTabularQueryInput,
  type WorkspaceTabularQueryResult,
  type WorkspaceTabularResolvedFormat,
  type WorkspaceTabularSelectionRange,
  type WorkspaceTabularSelectionSummary,
  type WorkspaceTabularSelectionSummaryInput,
  type WorkspaceTabularUpdateCellInput
} from './contract.js'

type XmlRecord = Record<string, unknown>
type WorkspaceTabularTextResolvedFormat = Exclude<WorkspaceTabularResolvedFormat, 'xlsx'>

type ParsedDelimitedText = {
  rows: string[][]
  warnings: string[]
}

type JsonlParseOptions = {
  maxDiscoveryRows: number
  size?: number
}

type ParsedJsonlText = {
  records: JsonlRecord[]
  nonEmptyLineCount: number
  sampledLineCount: number
  invalidLineCount: number
  rowCount: number
  rowCountIsEstimate: boolean
  warnings: string[]
}

type JsonlRecord = {
  lineNumber: number
  value: unknown
}

type JsonlField =
  | {
      kind: 'property'
      key: string
      name: string
    }
  | {
      kind: 'index'
      index: number
      name: string
    }
  | {
      kind: 'value'
      name: string
    }

type RawJsonlField =
  | {
      kind: 'property'
      key: string
      rawName: string
    }
  | {
      kind: 'index'
      index: number
      rawName: string
    }
  | {
      kind: 'value'
      rawName: string
    }

type JsonlFieldValue = {
  exists: boolean
  value?: unknown
}

type ObservationBuildInput = {
  input: WorkspaceTabularObservationSourceInput
  format: WorkspaceTabularResolvedFormat
  delimiter?: WorkspaceTabularDelimiter
  sheetName?: string
  rowCount: number
  rowCountIsEstimate: boolean
  columnCount: number
  header: string[]
  columns: WorkspaceTabularColumnSummary[]
  previewRows: WorkspaceTabularPreviewRow[]
  truncatedRows: boolean
  truncatedColumns: boolean
  warnings: string[]
  actions?: readonly string[]
}

type WorkspaceTabularObservationSourceInput = Pick<
  NormalizedWorkspaceTabularPreviewInput,
  'path' | 'workspaceRoot' | 'mimeType' | 'size' | 'mtimeMs'
>

type XlsxRelationship = {
  id: string
  type: string
  targetPath: string
}

type XlsxSheetReference = {
  name: string
  path: string
}

type ParsedXlsxSheet = {
  sheetName: string
  rows: string[][]
  rowCount: number
  columnCount: number
  warnings: string[]
}

type PreviewRowFilterRule = NormalizedWorkspaceTabularQueryInput['filters'][number]
type PreviewRowSortRule = NormalizedWorkspaceTabularQueryInput['sorts'][number]

type QueryVisibleTextInput = {
  sourceRowCount: number
  filteredRowCount: number
  returnedRowCount: number
  truncatedRows: boolean
  filtersApplied: number
  sortsApplied: number
  selectionSummary?: WorkspaceTabularSelectionSummary
}

type CellCoordinate = {
  row: number
  column: number
}

type CellWithValue = CellCoordinate & {
  value?: string
}

export type WorkspaceTabularDelimitedEditOperation =
  | {
      kind: 'updateCell'
      row: number
      column: number
      value: unknown
    }
  | {
      kind: 'insertRows'
      afterRow: number
      rows: unknown[][]
    }
  | {
      kind: 'insertColumns'
      afterColumn: number
      columns: unknown[][]
    }
  | {
      kind: 'deleteRows'
      rows: number[]
    }
  | {
      kind: 'deleteColumns'
      columns: number[]
    }

export type WorkspaceTabularDelimitedEditInput = {
  text: string
  delimiter: WorkspaceTabularDelimiter
  hasHeader?: boolean
  operation: WorkspaceTabularDelimitedEditOperation
}

export type WorkspaceTabularDelimitedEditResult = {
  text: string
  rowCount: number
  columnCount: number
}

const NUMBER_PATTERN = /^[+-]?(?:(?:\d+\.?\d*)|(?:\.\d+))(?:[eE][+-]?\d+)?$/
const DATE_PATTERN = /^\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:[T\s].*)?$/
const BOOLEAN_PATTERN = /^(?:true|false)$/i
const JSONL_EXT_PATTERN = /\.(?:jsonl|ndjson)$/i
const JSONL_PARSEABLE_PREFIX_PATTERN = /^[\s\ufeff]*(?:\{|\[|"|-?\d|true\b|false\b|null\b)/
const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: false
})

export function createWorkspaceTabularPreview(
  input: NormalizedWorkspaceTabularPreviewInput
): WorkspaceTabularPreviewResult {
  const format = resolveTextFormat(input)
  if (isJsonlFormat(format)) {
    return createJsonlPreview(input, format)
  }

  const delimiter = delimiterForResolvedFormat(format)
  return createDelimitedPreview(input, format, delimiter)
}

export async function createWorkspaceTabularXlsxPreview(
  input: NormalizedWorkspaceTabularXlsxPreviewInput
): Promise<WorkspaceTabularPreviewResult> {
  const normalized = workspaceTabularXlsxPreviewInputSchema.parse(input)
  const parsed = await parseXlsxFirstSheet(normalized.bytes)
  const rows = parsed.rows
  const dataRows = normalized.hasHeader ? rows.slice(1) : rows
  const columnCount = parsed.columnCount
  const boundedColumnCount = Math.min(columnCount, normalized.maxColumns)
  const header = normalizeHeader(normalized.hasHeader ? rows[0] ?? [] : [], columnCount).slice(0, boundedColumnCount)
  const previewRows = dataRows.slice(0, normalized.maxPreviewRows).map((row, index) => ({
    index,
    values: valuesForDelimitedRow(row, boundedColumnCount)
  }))
  const columns = summarizeDelimitedColumns(dataRows, header, boundedColumnCount)
  const truncatedRows = dataRows.length > normalized.maxPreviewRows
  const truncatedColumns = columnCount > normalized.maxColumns
  const warnings = boundedWarnings([
    ...parsed.warnings,
    ...(truncatedRows ? [`Preview includes ${previewRows.length} of ${dataRows.length} data rows from the first XLSX sheet.`] : []),
    ...(truncatedColumns ? [`Preview includes ${boundedColumnCount} of ${columnCount} columns from the first XLSX sheet.`] : [])
  ])

  return workspaceTabularPreviewResultSchema.parse({
    ok: true,
    contractVersion: WORKSPACE_TABULAR_CONTRACT_VERSION,
    format: 'xlsx',
    rowCount: dataRows.length,
    rowCountIsEstimate: false,
    columnCount,
    header,
    previewRows,
    columns,
    truncatedRows,
    truncatedColumns,
    warnings,
    ...(normalized.includeObservation
      ? {
          observation: buildWorkspaceObservation({
            input: normalized,
            format: 'xlsx',
            sheetName: parsed.sheetName,
            rowCount: dataRows.length,
            rowCountIsEstimate: false,
            columnCount,
            header,
            columns,
            previewRows,
            truncatedRows,
            truncatedColumns,
            warnings,
            actions: WORKSPACE_TABULAR_READONLY_ACTIONS
          })
        }
      : {})
  })
}

export function parseDelimitedText(text: string, delimiter: WorkspaceTabularDelimiter): ParsedDelimitedText {
  if (text.length === 0) {
    return { rows: [], warnings: [] }
  }

  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let endedWithRecordSeparator = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    const next = text[index + 1]

    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"'
        index += 1
      } else if (char === '"') {
        inQuotes = false
      } else {
        field += char
      }
      endedWithRecordSeparator = false
      continue
    }

    if (char === '"' && field.length === 0) {
      inQuotes = true
      endedWithRecordSeparator = false
      continue
    }

    if (char === delimiter) {
      row.push(field)
      field = ''
      endedWithRecordSeparator = false
      continue
    }

    if (char === '\n' || char === '\r') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      endedWithRecordSeparator = true
      if (char === '\r' && next === '\n') {
        index += 1
      }
      continue
    }

    field += char
    endedWithRecordSeparator = false
  }

  if (!endedWithRecordSeparator || row.length > 0 || field.length > 0) {
    row.push(field)
    rows.push(row)
  }

  return {
    rows,
    warnings: inQuotes ? ['Input ended inside a quoted field; parsed best-effort preview.'] : []
  }
}

export function parseJsonlText(text: string, options: JsonlParseOptions): ParsedJsonlText {
  const lines = splitJsonlLines(text)
  const records: JsonlRecord[] = []
  const invalidLineNumbers: number[] = []
  let nonEmptyLineCount = 0
  let sampledLineCount = 0
  let invalidLineCount = 0

  for (let index = 0; index < lines.length; index += 1) {
    const line = stripLineBom(lines[index] ?? '', index).trim()
    if (!line) continue

    nonEmptyLineCount += 1
    if (sampledLineCount >= options.maxDiscoveryRows) continue

    sampledLineCount += 1
    try {
      records.push({
        lineNumber: index + 1,
        value: JSON.parse(line) as unknown
      })
    } catch {
      invalidLineCount += 1
      if (invalidLineNumbers.length < 5) {
        invalidLineNumbers.push(index + 1)
      }
    }
  }

  const estimate = estimateJsonlRowCount(nonEmptyLineCount, text, options.size)
  const warnings = [
    ...(invalidLineCount > 0
      ? [`Skipped ${invalidLineCount} malformed JSONL line${invalidLineCount === 1 ? '' : 's'} in the sampled window (${formatLineNumberList(invalidLineNumbers)}).`]
      : []),
    ...(records.length === 0 && nonEmptyLineCount > 0
      ? ['No valid JSONL records were parsed from the sampled window.']
      : []),
    ...(sampledLineCount < nonEmptyLineCount
      ? [`Field discovery parsed ${sampledLineCount} of ${nonEmptyLineCount} non-empty JSONL lines.`]
      : []),
    ...(estimate.rowCountIsEstimate
      ? [`Row count is estimated from ${nonEmptyLineCount} sampled line${nonEmptyLineCount === 1 ? '' : 's'} and the provided file size.`]
      : [])
  ]

  return {
    records,
    nonEmptyLineCount,
    sampledLineCount,
    invalidLineCount,
    rowCount: estimate.rowCount,
    rowCountIsEstimate: estimate.rowCountIsEstimate,
    warnings
  }
}

export function detectTabularDelimiter(text: string): WorkspaceTabularDelimiter {
  const sample = text.slice(0, 8192)
  const commaScore = scoreDelimiter(sample, ',')
  const tabScore = scoreDelimiter(sample, '\t')
  return tabScore > commaScore ? '\t' : ','
}

export function updateWorkspaceTabularCell(input: WorkspaceTabularUpdateCellInput): unknown[][] {
  const normalized = workspaceTabularUpdateCellInputSchema.parse(input)
  if (normalized.row >= normalized.rows.length) {
    throw new RangeError(`Cannot update row ${normalized.row}; table has ${normalized.rows.length} rows.`)
  }

  const nextRows = cloneDataRows(normalized.rows)
  const targetRow = nextRows[normalized.row]
  while (targetRow.length <= normalized.column) {
    targetRow.push('')
  }
  targetRow[normalized.column] = normalized.value
  return nextRows
}

export function insertWorkspaceTabularRows(input: WorkspaceTabularInsertRowsInput): unknown[][] {
  const normalized = workspaceTabularInsertRowsInputSchema.parse(input)
  if (normalized.afterRow >= normalized.rows.length) {
    throw new RangeError(`Cannot insert after row ${normalized.afterRow}; table has ${normalized.rows.length} rows.`)
  }

  const insertionIndex = normalized.afterRow + 1
  return [
    ...cloneDataRows(normalized.rows.slice(0, insertionIndex)),
    ...cloneDataRows(normalized.insertRows),
    ...cloneDataRows(normalized.rows.slice(insertionIndex))
  ]
}

export function insertWorkspaceTabularColumns(input: WorkspaceTabularInsertColumnsInput): unknown[][] {
  const normalized = workspaceTabularInsertColumnsInputSchema.parse(input)
  const columnCount = countDataColumns(normalized.rows)
  if (normalized.afterColumn >= columnCount) {
    throw new RangeError(`Cannot insert after column ${normalized.afterColumn}; table has ${columnCount} columns.`)
  }
  if (columnCount + normalized.columns.length > WORKSPACE_TABULAR_MAX_COLUMNS) {
    throw new RangeError(`Cannot insert ${normalized.columns.length} columns; maximum editable column count is ${WORKSPACE_TABULAR_MAX_COLUMNS}.`)
  }

  const insertIndex = normalized.afterColumn + 1
  return normalized.rows.map((row, rowIndex) => {
    const nextRow = [...row]
    while (nextRow.length < columnCount) {
      nextRow.push('')
    }
    nextRow.splice(insertIndex, 0, ...normalized.columns.map((column) => column[rowIndex] ?? ''))
    return nextRow
  })
}

export function deleteWorkspaceTabularRows(input: WorkspaceTabularDeleteRowsInput): unknown[][] {
  const normalized = workspaceTabularDeleteRowsInputSchema.parse(input)
  const rowIndices = uniqueSortedIndices(normalized.rowIndices)
  const outOfRange = rowIndices.find((rowIndex) => rowIndex >= normalized.rows.length)
  if (outOfRange !== undefined) {
    throw new RangeError(`Cannot delete row ${outOfRange}; table has ${normalized.rows.length} rows.`)
  }
  const rowsToDelete = new Set(rowIndices)
  return normalized.rows
    .filter((_row, rowIndex) => !rowsToDelete.has(rowIndex))
    .map((row) => [...row])
}

export function deleteWorkspaceTabularColumns(input: WorkspaceTabularDeleteColumnsInput): unknown[][] {
  const normalized = workspaceTabularDeleteColumnsInputSchema.parse(input)
  const columnIndices = uniqueSortedIndices(normalized.columnIndices)
  const columnCount = countDataColumns(normalized.rows)
  const outOfRange = columnIndices.find((columnIndex) => columnIndex >= columnCount)
  if (outOfRange !== undefined) {
    throw new RangeError(`Cannot delete column ${outOfRange}; table has ${columnCount} columns.`)
  }
  const columnsToDelete = new Set(columnIndices)
  return normalized.rows.map((row) => row.filter((_cell, columnIndex) => !columnsToDelete.has(columnIndex)))
}

export function applyWorkspaceTabularDelimitedEdit(
  input: WorkspaceTabularDelimitedEditInput
): WorkspaceTabularDelimitedEditResult {
  const hasHeader = input.hasHeader ?? true
  const parsed = parseDelimitedText(input.text, input.delimiter)
  if (parsed.warnings.length > 0) {
    throw new Error(`Cannot safely edit malformed delimited text: ${parsed.warnings[0]}`)
  }
  stripBom(parsed.rows)

  const rows = parsed.rows
  const dataStart = hasHeader ? 1 : 0
  const dataRowCount = Math.max(0, rows.length - dataStart)
  if (dataRowCount > WORKSPACE_TABULAR_MAX_EDIT_ROWS) {
    throw new RangeError(`Cannot edit ${dataRowCount} rows; maximum editable row count is ${WORKSPACE_TABULAR_MAX_EDIT_ROWS}.`)
  }

  switch (input.operation.kind) {
    case 'updateCell': {
      const targetIndex = dataStart + input.operation.row
      if (input.operation.row >= dataRowCount || targetIndex >= rows.length) {
        throw new RangeError(`Cannot update row ${input.operation.row}; table has ${dataRowCount} data rows.`)
      }
      if (input.operation.column >= WORKSPACE_TABULAR_MAX_COLUMNS) {
        throw new RangeError(`Cannot update column ${input.operation.column}; maximum column index is ${WORKSPACE_TABULAR_MAX_COLUMNS - 1}.`)
      }
      const targetRow = rows[targetIndex]
      while (targetRow.length <= input.operation.column) {
        targetRow.push('')
      }
      targetRow[input.operation.column] = tabularCellToText(input.operation.value)
      break
    }
    case 'insertRows': {
      if (input.operation.afterRow >= dataRowCount) {
        throw new RangeError(`Cannot insert after row ${input.operation.afterRow}; table has ${dataRowCount} data rows.`)
      }
      const insertRows = input.operation.rows.map((row) =>
        row.slice(0, WORKSPACE_TABULAR_MAX_COLUMNS).map(tabularCellToText)
      )
      if (dataRowCount + insertRows.length > WORKSPACE_TABULAR_MAX_EDIT_ROWS) {
        throw new RangeError(`Cannot insert ${insertRows.length} rows; maximum editable row count is ${WORKSPACE_TABULAR_MAX_EDIT_ROWS}.`)
      }
      rows.splice(dataStart + input.operation.afterRow + 1, 0, ...insertRows)
      break
    }
    case 'insertColumns': {
      const columnCount = countColumns(rows)
      if (input.operation.afterColumn >= columnCount) {
        throw new RangeError(`Cannot insert after column ${input.operation.afterColumn}; table has ${columnCount} columns.`)
      }
      const insertColumns = input.operation.columns.map((column) =>
        column.slice(0, WORKSPACE_TABULAR_MAX_EDIT_ROWS + (hasHeader ? 1 : 0)).map(tabularCellToText)
      )
      if (columnCount + insertColumns.length > WORKSPACE_TABULAR_MAX_COLUMNS) {
        throw new RangeError(`Cannot insert ${insertColumns.length} columns; maximum editable column count is ${WORKSPACE_TABULAR_MAX_COLUMNS}.`)
      }
      if (hasHeader && rows.length === 0) {
        rows.push([])
      }
      const insertIndex = input.operation.afterColumn + 1
      for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
        const row = rows[rowIndex]
        while (row.length < columnCount) {
          row.push('')
        }
        row.splice(insertIndex, 0, ...insertColumns.map((column) => column[rowIndex] ?? ''))
      }
      break
    }
    case 'deleteRows': {
      const rowIndices = uniqueSortedIndices(input.operation.rows)
      const outOfRange = rowIndices.find((rowIndex) => rowIndex >= dataRowCount)
      if (outOfRange !== undefined) {
        throw new RangeError(`Cannot delete row ${outOfRange}; table has ${dataRowCount} data rows.`)
      }
      for (const rowIndex of [...rowIndices].sort((left, right) => right - left)) {
        rows.splice(dataStart + rowIndex, 1)
      }
      break
    }
    case 'deleteColumns': {
      const columnCount = countColumns(rows)
      const columnIndices = uniqueSortedIndices(input.operation.columns)
      const outOfRange = columnIndices.find((columnIndex) => columnIndex >= columnCount)
      if (outOfRange !== undefined) {
        throw new RangeError(`Cannot delete column ${outOfRange}; table has ${columnCount} columns.`)
      }
      const columnsToDelete = new Set(columnIndices)
      for (const row of rows) {
        for (let columnIndex = row.length - 1; columnIndex >= 0; columnIndex -= 1) {
          if (columnsToDelete.has(columnIndex)) {
            row.splice(columnIndex, 1)
          }
        }
      }
      break
    }
  }

  return {
    text: serializeDelimitedRows(rows, input.delimiter, endsWithLineBreak(input.text)),
    rowCount: Math.max(0, rows.length - dataStart),
    columnCount: countColumns(rows)
  }
}

export function serializeDelimitedRows(
  rows: readonly unknown[][],
  delimiter: WorkspaceTabularDelimiter,
  trailingLineBreak = false
): string {
  const content = rows
    .map((row) => row.map((cell) => serializeDelimitedCell(cell, delimiter)).join(delimiter))
    .join('\n')
  return trailingLineBreak && content.length > 0 ? `${content}\n` : content
}

export function queryWorkspaceTabularPreviewRows(input: WorkspaceTabularQueryInput): WorkspaceTabularQueryResult {
  const normalized = workspaceTabularQueryInputSchema.parse(input)
  const sourceRows = clonePreviewRows(normalized.rows)
  const filteredRows = applyPreviewRowFilters(sourceRows, normalized)
  const sortedRows = applyPreviewRowSorts(filteredRows, normalized)
  const rows = clonePreviewRows(sortedRows.slice(0, normalized.maxRows))
  const truncatedRows = sortedRows.length > rows.length
  const selectionSummary = normalized.selection
    ? buildSelectionSummary({
        rows: sortedRows,
        header: normalized.header,
        selection: normalized.selection
      })
    : undefined
  const visibleText = buildQueryVisibleText({
    sourceRowCount: sourceRows.length,
    filteredRowCount: sortedRows.length,
    returnedRowCount: rows.length,
    truncatedRows,
    filtersApplied: normalized.filters.length,
    sortsApplied: normalized.sorts.length,
    selectionSummary
  })

  return workspaceTabularQueryResultSchema.parse({
    rows,
    sourceRowCount: sourceRows.length,
    filteredRowCount: sortedRows.length,
    returnedRowCount: rows.length,
    truncatedRows,
    filtersApplied: normalized.filters.length,
    sortsApplied: normalized.sorts.length,
    ...(selectionSummary ? { selectionSummary } : {}),
    visibleText
  })
}

export function summarizeWorkspaceTabularSelection(
  input: WorkspaceTabularSelectionSummaryInput
): WorkspaceTabularSelectionSummary {
  const normalized = workspaceTabularSelectionSummaryInputSchema.parse(input)
  return buildSelectionSummary(normalized)
}

function createDelimitedPreview(
  input: NormalizedWorkspaceTabularPreviewInput,
  format: Extract<WorkspaceTabularResolvedFormat, 'csv' | 'tsv'>,
  delimiter: WorkspaceTabularDelimiter
): WorkspaceTabularPreviewResult {
  const parsed = parseDelimitedText(input.text, delimiter)
  stripBom(parsed.rows)

  const rows = parsed.rows
  const dataRows = input.hasHeader ? rows.slice(1) : rows
  const columnCount = countColumns(rows)
  const boundedColumnCount = Math.min(columnCount, input.maxColumns)
  const header = normalizeHeader(input.hasHeader ? rows[0] ?? [] : [], columnCount).slice(0, boundedColumnCount)
  const previewRows = dataRows.slice(0, input.maxPreviewRows).map((row, index) => ({
    index,
    values: valuesForDelimitedRow(row, boundedColumnCount)
  }))
  const columns = summarizeDelimitedColumns(dataRows, header, boundedColumnCount)
  const truncatedRows = dataRows.length > input.maxPreviewRows
  const truncatedColumns = columnCount > input.maxColumns
  const warnings = boundedWarnings([
    ...parsed.warnings,
    ...(truncatedRows ? [`Preview includes ${previewRows.length} of ${dataRows.length} data rows.`] : []),
    ...(truncatedColumns ? [`Preview includes ${boundedColumnCount} of ${columnCount} columns.`] : [])
  ])

  return workspaceTabularPreviewResultSchema.parse({
    ok: true,
    contractVersion: WORKSPACE_TABULAR_CONTRACT_VERSION,
    format,
    delimiter,
    rowCount: dataRows.length,
    rowCountIsEstimate: false,
    columnCount,
    header,
    previewRows,
    columns,
    truncatedRows,
    truncatedColumns,
    warnings,
    ...(input.includeObservation
      ? {
          observation: buildWorkspaceObservation({
            input,
            format,
            delimiter,
            rowCount: dataRows.length,
            rowCountIsEstimate: false,
            columnCount,
            header,
            columns,
            previewRows,
            truncatedRows,
            truncatedColumns,
            warnings
          })
        }
      : {})
  })
}

function createJsonlPreview(
  input: NormalizedWorkspaceTabularPreviewInput,
  format: Extract<WorkspaceTabularResolvedFormat, 'jsonl' | 'ndjson'>
): WorkspaceTabularPreviewResult {
  const parsed = parseJsonlText(input.text, {
    maxDiscoveryRows: input.maxDiscoveryRows,
    ...(input.size !== undefined ? { size: input.size } : {})
  })
  const fields = discoverJsonlFields(parsed.records)
  const columnCount = fields.length
  const boundedFields = fields.slice(0, input.maxColumns)
  const header = boundedFields.map((field) => field.name)
  const previewRows = parsed.records.slice(0, input.maxPreviewRows).map((record, index) => ({
    index,
    values: valuesForJsonlRecord(record.value, boundedFields)
  }))
  const columns = summarizeJsonlColumns(parsed.records, boundedFields)
  const truncatedRows = parsed.rowCount > previewRows.length
  const truncatedColumns = columnCount > input.maxColumns
  const warnings = boundedWarnings([
    ...parsed.warnings,
    ...(truncatedRows ? [`Preview includes ${previewRows.length} of ${formatRowCount(parsed.rowCount, parsed.rowCountIsEstimate)} JSONL rows.`] : []),
    ...(truncatedColumns ? [`Preview includes ${boundedFields.length} of ${columnCount} discovered JSONL fields.`] : [])
  ])

  return workspaceTabularPreviewResultSchema.parse({
    ok: true,
    contractVersion: WORKSPACE_TABULAR_CONTRACT_VERSION,
    format,
    rowCount: parsed.rowCount,
    rowCountIsEstimate: parsed.rowCountIsEstimate,
    columnCount,
    header,
    previewRows,
    columns,
    truncatedRows,
    truncatedColumns,
    warnings,
    ...(input.includeObservation
      ? {
          observation: buildWorkspaceObservation({
            input,
            format,
            rowCount: parsed.rowCount,
            rowCountIsEstimate: parsed.rowCountIsEstimate,
            columnCount,
            header,
            columns,
            previewRows,
            truncatedRows,
            truncatedColumns,
            warnings,
            actions: WORKSPACE_TABULAR_READONLY_ACTIONS
          })
        }
      : {})
  })
}

async function parseXlsxFirstSheet(bytes: Uint8Array): Promise<ParsedXlsxSheet> {
  const zip = await JSZip.loadAsync(bytes)
  const warnings: string[] = []
  const sheetReferences = await readXlsxSheetReferences(zip, warnings)
  const firstSheet = sheetReferences[0]
  if (!firstSheet) {
    throw new Error('XLSX workbook has no worksheets.')
  }

  const sharedStrings = await readXlsxSharedStrings(zip, warnings)
  const worksheet = await readXmlEntry(zip, firstSheet.path, warnings, true)
  if (!worksheet) {
    throw new Error(`XLSX is missing first worksheet part: ${firstSheet.path}`)
  }

  const rows = parseXlsxWorksheetRows(worksheet, sharedStrings)
  if (sheetReferences.length > 1) {
    warnings.push(`Workbook has ${sheetReferences.length} sheets; preview uses the first sheet "${firstSheet.name}".`)
  }

  return {
    sheetName: firstSheet.name,
    rows: rows.rows,
    rowCount: rows.rows.length,
    columnCount: rows.columnCount,
    warnings: boundedWarnings(warnings)
  }
}

async function readXlsxSheetReferences(zip: JSZip, warnings: string[]): Promise<XlsxSheetReference[]> {
  const workbook = await readXmlEntry(zip, 'xl/workbook.xml', warnings, false)
  if (!workbook) return fallbackXlsxSheetReferences(zip)

  const workbookRelationships = await readXmlEntry(zip, 'xl/_rels/workbook.xml.rels', warnings, false)
  const relationships = new Map(
    (workbookRelationships ? parseXlsxRelationships(workbookRelationships, 'xl/workbook.xml') : [])
      .map((relationship) => [relationship.id, relationship])
  )
  const workbookSheets = extractWorkbookSheets(workbook)
  const sheets = workbookSheets
    .map((sheet, index) => {
      const relationship = sheet.relationshipId ? relationships.get(sheet.relationshipId) : undefined
      const fallbackPath = `xl/worksheets/sheet${index + 1}.xml`
      const path = relationship?.targetPath ?? fallbackPath
      if (!zip.file(path)) {
        warnings.push(`Missing XLSX worksheet part for "${sheet.name}": ${path}`)
        return undefined
      }
      return {
        name: sheet.name,
        path
      }
    })
    .filter((sheet): sheet is XlsxSheetReference => Boolean(sheet))

  return sheets.length > 0 ? sheets : fallbackXlsxSheetReferences(zip)
}

function fallbackXlsxSheetReferences(zip: JSZip): XlsxSheetReference[] {
  return listWorksheetPaths(zip).map((path, index) => ({
    name: `Sheet ${index + 1}`,
    path
  }))
}

function extractWorkbookSheets(root: unknown): Array<{ name: string; relationshipId?: string }> {
  const workbook = firstChildByLocalName(root, 'workbook') ?? root
  const sheetsRoot = firstChildByLocalName(workbook, 'sheets')
  return childrenByLocalName(sheetsRoot, 'sheet').map((sheet, index) => ({
    name: truncateHeader(attributeValue(sheet, 'name') ?? `Sheet ${index + 1}`),
    ...(attributeValue(sheet, 'r:id') ? { relationshipId: attributeValue(sheet, 'r:id') } : {})
  }))
}

async function readXlsxSharedStrings(zip: JSZip, warnings: string[]): Promise<string[]> {
  const sharedStrings = await readXmlEntry(zip, 'xl/sharedStrings.xml', warnings, false)
  if (!sharedStrings) return []

  const sharedStringTable = firstChildByLocalName(sharedStrings, 'sst') ?? sharedStrings
  return childrenByLocalName(sharedStringTable, 'si').map((entry) => truncateCell(extractXlsxText(entry)))
}

function parseXlsxWorksheetRows(
  root: unknown,
  sharedStrings: readonly string[]
): { rows: string[][]; columnCount: number } {
  const worksheet = firstChildByLocalName(root, 'worksheet') ?? root
  const sheetData = firstChildByLocalName(worksheet, 'sheetData')
  const rows: string[][] = []
  let columnCount = 0

  for (const row of childrenByLocalName(sheetData, 'row')) {
    const rowValues: string[] = []
    let nextColumnIndex = 0

    for (const cell of childrenByLocalName(row, 'c')) {
      const explicitColumn = columnIndexFromCellReference(attributeValue(cell, 'r'))
      const columnIndex = explicitColumn ?? nextColumnIndex
      while (rowValues.length < columnIndex) {
        rowValues.push('')
      }
      rowValues[columnIndex] = readXlsxCellValue(cell, sharedStrings)
      nextColumnIndex = columnIndex + 1
    }

    if (rowValues.some((value) => value.trim().length > 0)) {
      rows.push(rowValues)
      columnCount = Math.max(columnCount, rowValues.length)
    }
  }

  return { rows, columnCount }
}

function readXlsxCellValue(cell: unknown, sharedStrings: readonly string[]): string {
  const type = attributeValue(cell, 't')

  if (type === 'inlineStr') {
    const inlineString = firstChildByLocalName(cell, 'is') ?? cell
    return truncateCell(extractXlsxText(inlineString))
  }

  const rawValue = normalizeCellText(extractXlsxValue(cell))
  if (type === 's') {
    const sharedStringIndex = Number.parseInt(rawValue, 10)
    return Number.isInteger(sharedStringIndex) ? sharedStrings[sharedStringIndex] ?? '' : ''
  }
  if (type === 'b') {
    if (rawValue === '1') return 'true'
    if (rawValue === '0') return 'false'
  }

  return truncateCell(rawValue)
}

function extractXlsxValue(cell: unknown): string {
  const valueNode = firstChildByLocalName(cell, 'v')
  if (valueNode !== undefined) return textValueRaw(valueNode) ?? ''
  const textNode = firstChildByLocalName(cell, 't')
  return textNode !== undefined ? textValueRaw(textNode) ?? '' : ''
}

function extractXlsxText(root: unknown): string {
  const texts: string[] = []

  function visit(value: unknown, tagName?: string): void {
    if (Array.isArray(value)) {
      for (const item of value) visit(item, tagName)
      return
    }

    if (tagName && localName(tagName) === 't') {
      const text = textValueRaw(value)
      if (text !== undefined) texts.push(text)
      return
    }

    if (!isRecord(value)) return
    for (const [key, child] of Object.entries(value)) {
      if (isAttributeKey(key)) continue
      visit(child, key)
    }
  }

  visit(root)
  return texts.join('')
}

async function readXmlEntry(
  zip: JSZip,
  path: string,
  warnings: string[],
  required: boolean
): Promise<unknown | undefined> {
  const entry = zip.file(path)
  if (!entry) {
    if (required) warnings.push(`Missing XLSX part: ${path}`)
    return undefined
  }

  try {
    return xmlParser.parse(await entry.async('string')) as unknown
  } catch (error) {
    warnings.push(`Could not parse XLSX XML part ${path}: ${errorMessage(error)}`)
    return undefined
  }
}

function parseXlsxRelationships(root: unknown, sourcePath: string): XlsxRelationship[] {
  const relationshipsRoot = firstChildByLocalName(root, 'Relationships') ?? root
  return childrenByLocalName(relationshipsRoot, 'Relationship')
    .map((relationship) => {
      const id = attributeValue(relationship, 'Id')
      const type = attributeValue(relationship, 'Type')
      const target = attributeValue(relationship, 'Target')
      if (!id || !type || !target) return undefined
      return {
        id,
        type,
        targetPath: resolveZipTarget(sourcePath, target)
      }
    })
    .filter((relationship): relationship is XlsxRelationship => Boolean(relationship))
}

function listWorksheetPaths(zip: JSZip): string[] {
  return Object.values(zip.files)
    .filter((entry) => !entry.dir)
    .map((entry) => normalizeZipPath(entry.name))
    .filter((path) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(path))
    .sort(compareWorksheetPaths)
}

function compareWorksheetPaths(left: string, right: string): number {
  return worksheetNumberForPath(left) - worksheetNumberForPath(right) || left.localeCompare(right)
}

function worksheetNumberForPath(path: string): number {
  const match = /\/sheet(\d+)\.xml$/i.exec(path)
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER
}

function resolveZipTarget(sourcePath: string, target: string): string {
  const normalizedTarget = target.replace(/\\/g, '/')
  if (normalizedTarget.startsWith('/')) return normalizeZipPath(normalizedTarget.slice(1))
  return normalizeZipPath(pathPosix.join(pathPosix.dirname(sourcePath), normalizedTarget))
}

function normalizeZipPath(path: string): string {
  return pathPosix.normalize(path.replace(/\\/g, '/')).replace(/^\.\//, '')
}

function columnIndexFromCellReference(reference: string | undefined): number | undefined {
  const match = /^([A-Z]+)\d+$/i.exec(reference ?? '')
  if (!match) return undefined

  let index = 0
  for (const letter of match[1]?.toUpperCase() ?? '') {
    index = index * 26 + (letter.charCodeAt(0) - 64)
  }
  return index > 0 ? index - 1 : undefined
}

function childrenByLocalName(value: unknown, name: string): unknown[] {
  if (!isRecord(value)) return []
  return Object.entries(value).flatMap(([key, child]) => {
    if (isAttributeKey(key) || localName(key) !== name) return []
    return Array.isArray(child) ? child : [child]
  })
}

function firstChildByLocalName(value: unknown, name: string): unknown | undefined {
  return childrenByLocalName(value, name)[0]
}

function attributeValue(value: unknown, name: string): string | undefined {
  if (!isRecord(value)) return undefined
  const exact = value[`@_${name}`]
  if (typeof exact === 'string') return exact
  if (typeof exact === 'number' || typeof exact === 'boolean') return String(exact)
  if (name.includes(':')) return undefined

  const match = Object.entries(value).find(([key]) => isAttributeKey(key) && localName(key) === name)
  if (typeof match?.[1] === 'string') return match[1]
  if (typeof match?.[1] === 'number' || typeof match?.[1] === 'boolean') return String(match[1])
  return undefined
}

function textValueRaw(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (!isRecord(value)) return undefined

  const textNode = value['#text']
  if (typeof textNode === 'string') return textNode
  if (typeof textNode === 'number' || typeof textNode === 'boolean') return String(textNode)
  return undefined
}

function normalizeCellText(value: string): string {
  return value.replace(/\r\n|\r/g, '\n')
}

function localName(name: string): string {
  return name.replace(/^@_/, '').split(':').at(-1) ?? name
}

function isAttributeKey(key: string): boolean {
  return key.startsWith('@_')
}

function isRecord(value: unknown): value is XmlRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function resolveTextFormat(input: NormalizedWorkspaceTabularPreviewInput): WorkspaceTabularTextResolvedFormat {
  if (input.format !== 'auto') return input.format
  if (input.delimiter) return formatForDelimiter(input.delimiter)

  const pathFormat = formatFromPath(input.path)
  if (pathFormat) return pathFormat

  const mimeFormat = formatFromMimeType(input.mimeType)
  if (mimeFormat) return mimeFormat

  if (looksLikeJsonl(input.text)) return 'jsonl'
  return formatForDelimiter(detectTabularDelimiter(input.text))
}

function formatFromPath(path: string | undefined): WorkspaceTabularTextResolvedFormat | undefined {
  const trimmed = path?.trim().toLowerCase()
  if (!trimmed) return undefined
  if (trimmed.endsWith('.ndjson')) return 'ndjson'
  if (trimmed.endsWith('.jsonl')) return 'jsonl'
  if (trimmed.endsWith('.tsv')) return 'tsv'
  if (trimmed.endsWith('.csv')) return 'csv'
  return undefined
}

function formatFromMimeType(mimeType: string | undefined): WorkspaceTabularTextResolvedFormat | undefined {
  const normalized = mimeType?.trim().toLowerCase()
  if (!normalized) return undefined
  if (normalized.includes('ndjson')) return 'ndjson'
  if (normalized.includes('jsonl')) return 'jsonl'
  if (normalized.includes('tab-separated-values')) return 'tsv'
  if (normalized.includes('csv')) return 'csv'
  return undefined
}

function isJsonlFormat(format: WorkspaceTabularResolvedFormat): format is Extract<WorkspaceTabularResolvedFormat, 'jsonl' | 'ndjson'> {
  return format === 'jsonl' || format === 'ndjson'
}

function delimiterForResolvedFormat(format: Extract<WorkspaceTabularResolvedFormat, 'csv' | 'tsv'>): WorkspaceTabularDelimiter {
  return format === 'tsv' ? '\t' : ','
}

function scoreDelimiter(text: string, delimiter: WorkspaceTabularDelimiter): number {
  const rows = parseDelimitedText(text, delimiter).rows
    .filter((row) => row.some((cell) => cell.trim().length > 0))
    .slice(0, 10)
  if (rows.length === 0) return 0

  const counts = rows.map((row) => row.length)
  const maxColumns = Math.max(...counts)
  const matchingRows = counts.filter((count) => count === maxColumns).length
  return maxColumns * 10 + matchingRows
}

function formatForDelimiter(delimiter: WorkspaceTabularDelimiter): Extract<WorkspaceTabularResolvedFormat, 'csv' | 'tsv'> {
  return delimiter === '\t' ? 'tsv' : 'csv'
}

function applyPreviewRowFilters(
  rows: WorkspaceTabularPreviewRow[],
  input: NormalizedWorkspaceTabularQueryInput
): WorkspaceTabularPreviewRow[] {
  if (input.filters.length === 0) return rows

  return input.filters.reduce((nextRows, filter) => {
    const column = resolveQueryColumn(filter, input.header)
    return nextRows.filter((row) => rowMatchesFilter(row, column, filter))
  }, rows)
}

function applyPreviewRowSorts(
  rows: WorkspaceTabularPreviewRow[],
  input: NormalizedWorkspaceTabularQueryInput
): WorkspaceTabularPreviewRow[] {
  if (input.sorts.length === 0) return rows

  const sorts = input.sorts.map((sort) => ({
    ...sort,
    resolvedColumn: resolveQueryColumn(sort, input.header)
  }))

  return rows
    .map((row, order) => ({ row, order }))
    .sort((left, right) => {
      for (const sort of sorts) {
        const comparison = compareCellsForSort(
          left.row.values[sort.resolvedColumn] ?? '',
          right.row.values[sort.resolvedColumn] ?? '',
          sort
        )
        if (comparison !== 0) return comparison
      }
      return left.order - right.order
    })
    .map((entry) => entry.row)
}

function resolveQueryColumn(
  rule: Pick<PreviewRowFilterRule | PreviewRowSortRule, 'column' | 'columnName'>,
  header: string[] | undefined
): number {
  if (rule.column !== undefined) return rule.column

  const columnName = rule.columnName?.trim()
  if (!columnName) {
    throw new RangeError('Column rule requires either column or columnName.')
  }
  if (!header || header.length === 0) {
    throw new RangeError(`Cannot resolve columnName "${columnName}" without a header.`)
  }

  const exactIndex = header.findIndex((name) => name === columnName)
  if (exactIndex >= 0) return exactIndex

  const normalizedName = columnName.toLocaleLowerCase()
  const insensitiveIndex = header.findIndex((name) => name.toLocaleLowerCase() === normalizedName)
  if (insensitiveIndex >= 0) return insensitiveIndex

  throw new RangeError(`Column "${columnName}" was not found in the preview header.`)
}

function rowMatchesFilter(row: WorkspaceTabularPreviewRow, column: number, filter: PreviewRowFilterRule): boolean {
  const cell = row.values[column] ?? ''
  const empty = isEmptyCell(cell)

  if (filter.operator === 'isEmpty') return empty
  if (filter.operator === 'isNotEmpty') return !empty

  const value = filterValueToText(filter.value)
  if (filter.operator === 'contains') {
    return normalizeFilterText(cell, filter.caseSensitive).includes(normalizeFilterText(value, filter.caseSensitive))
  }
  if (filter.operator === 'notContains') {
    return !normalizeFilterText(cell, filter.caseSensitive).includes(normalizeFilterText(value, filter.caseSensitive))
  }
  if (filter.operator === 'startsWith') {
    return normalizeFilterText(cell, filter.caseSensitive).startsWith(normalizeFilterText(value, filter.caseSensitive))
  }
  if (filter.operator === 'endsWith') {
    return normalizeFilterText(cell, filter.caseSensitive).endsWith(normalizeFilterText(value, filter.caseSensitive))
  }

  const comparison = compareCellValues(cell, value, filter.compareAs, filter.caseSensitive)
  if (filter.operator === 'equals') return comparison === 0
  if (filter.operator === 'notEquals') return comparison !== 0
  if (filter.operator === 'gt') return comparison > 0
  if (filter.operator === 'gte') return comparison >= 0
  if (filter.operator === 'lt') return comparison < 0
  return comparison <= 0
}

function compareCellsForSort(
  left: string,
  right: string,
  sort: PreviewRowSortRule & { resolvedColumn: number }
): number {
  const leftEmpty = isEmptyCell(left)
  const rightEmpty = isEmptyCell(right)
  if (leftEmpty || rightEmpty) {
    if (leftEmpty && rightEmpty) return 0
    const emptyComparison = sort.empty === 'first' ? -1 : 1
    return sort.direction === 'desc' ? -emptyComparison : emptyComparison
  }

  const comparison = compareCellValues(left, right, sort.compareAs, false)
  return sort.direction === 'desc' ? -comparison : comparison
}

function compareCellValues(
  left: string,
  right: string,
  mode: WorkspaceTabularComparisonMode,
  caseSensitive: boolean
): number {
  if (mode === 'number') return compareNumbersOrText(left, right, caseSensitive)
  if (mode === 'date') return compareDatesOrText(left, right, caseSensitive)
  if (mode === 'boolean') return compareBooleansOrText(left, right, caseSensitive)
  if (mode === 'string') return compareText(left, right, caseSensitive)

  const numberComparison = compareParsedNumbers(left, right)
  if (numberComparison !== undefined) return numberComparison

  const dateComparison = compareParsedDates(left, right)
  if (dateComparison !== undefined) return dateComparison

  const booleanComparison = compareParsedBooleans(left, right)
  if (booleanComparison !== undefined) return booleanComparison

  return compareText(left, right, caseSensitive)
}

function compareNumbersOrText(left: string, right: string, caseSensitive: boolean): number {
  return compareParsedNumbers(left, right) ?? compareText(left, right, caseSensitive)
}

function compareDatesOrText(left: string, right: string, caseSensitive: boolean): number {
  return compareParsedDates(left, right) ?? compareText(left, right, caseSensitive)
}

function compareBooleansOrText(left: string, right: string, caseSensitive: boolean): number {
  return compareParsedBooleans(left, right) ?? compareText(left, right, caseSensitive)
}

function compareParsedNumbers(left: string, right: string): number | undefined {
  const leftNumber = parseCellNumber(left)
  const rightNumber = parseCellNumber(right)
  if (leftNumber === undefined || rightNumber === undefined) return undefined
  return comparePrimitive(leftNumber, rightNumber)
}

function compareParsedDates(left: string, right: string): number | undefined {
  const leftDate = parseCellDate(left)
  const rightDate = parseCellDate(right)
  if (leftDate === undefined || rightDate === undefined) return undefined
  return comparePrimitive(leftDate, rightDate)
}

function compareParsedBooleans(left: string, right: string): number | undefined {
  const leftBoolean = parseCellBoolean(left)
  const rightBoolean = parseCellBoolean(right)
  if (leftBoolean === undefined || rightBoolean === undefined) return undefined
  return comparePrimitive(leftBoolean ? 1 : 0, rightBoolean ? 1 : 0)
}

function comparePrimitive(left: number, right: number): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function compareText(left: string, right: string, caseSensitive: boolean): number {
  return normalizeFilterText(left, caseSensitive).localeCompare(normalizeFilterText(right, caseSensitive), undefined, {
    numeric: true,
    sensitivity: caseSensitive ? 'variant' : 'base'
  })
}

function parseCellNumber(value: string): number | undefined {
  const trimmed = value.trim()
  if (!NUMBER_PATTERN.test(trimmed)) return undefined

  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : undefined
}

function parseCellDate(value: string): number | undefined {
  const trimmed = value.trim()
  if (!DATE_PATTERN.test(trimmed)) return undefined

  const parsed = Date.parse(trimmed)
  return Number.isNaN(parsed) ? undefined : parsed
}

function parseCellBoolean(value: string): boolean | undefined {
  const trimmed = value.trim().toLocaleLowerCase()
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  return undefined
}

function filterValueToText(value: PreviewRowFilterRule['value']): string {
  if (value === undefined) return ''
  if (value === null) return 'null'
  return String(value)
}

function normalizeFilterText(value: string, caseSensitive: boolean): string {
  return caseSensitive ? value : value.toLocaleLowerCase()
}

function isEmptyCell(value: string): boolean {
  return value.trim().length === 0
}

function looksLikeJsonl(text: string): boolean {
  const lines = splitJsonlLines(text)
    .map((line, index) => stripLineBom(line, index).trim())
    .filter(Boolean)
    .slice(0, 5)
  if (lines.length === 0) return false

  let parsedCount = 0
  let structuredCount = 0
  for (const line of lines) {
    if (!JSONL_PARSEABLE_PREFIX_PATTERN.test(line)) return false
    try {
      const value = JSON.parse(line) as unknown
      parsedCount += 1
      if (isPlainJsonObject(value) || Array.isArray(value)) {
        structuredCount += 1
      }
    } catch {
      return false
    }
  }

  return parsedCount === lines.length && structuredCount > 0
}

function splitJsonlLines(text: string): string[] {
  return text.split(/\r\n|\n|\r/)
}

function stripLineBom(line: string, index: number): string {
  return index === 0 && line.startsWith('\ufeff') ? line.slice(1) : line
}

function estimateJsonlRowCount(
  nonEmptyLineCount: number,
  text: string,
  size: number | undefined
): { rowCount: number; rowCountIsEstimate: boolean } {
  const textBytes = Buffer.byteLength(text, 'utf8')
  if (size !== undefined && textBytes > 0 && nonEmptyLineCount > 0 && size > textBytes) {
    const estimated = Math.max(nonEmptyLineCount, Math.ceil((nonEmptyLineCount * size) / textBytes))
    return {
      rowCount: estimated,
      rowCountIsEstimate: estimated > nonEmptyLineCount
    }
  }

  return {
    rowCount: nonEmptyLineCount,
    rowCountIsEstimate: false
  }
}

function discoverJsonlFields(records: JsonlRecord[]): JsonlField[] {
  const rawFields: RawJsonlField[] = []
  const propertyKeys = new Set<string>()
  const arrayIndexes = new Set<number>()
  let hasPrimitiveValue = false

  const addPropertyField = (key: string): void => {
    if (propertyKeys.has(key)) return
    propertyKeys.add(key)
    rawFields.push({ kind: 'property', key, rawName: key })
  }

  const addIndexField = (index: number): void => {
    if (arrayIndexes.has(index)) return
    arrayIndexes.add(index)
    rawFields.push({ kind: 'index', index, rawName: `[${index}]` })
  }

  for (const record of records) {
    const value = record.value
    if (isPlainJsonObject(value)) {
      for (const key of Object.keys(value)) {
        addPropertyField(key)
      }
      continue
    }

    if (Array.isArray(value)) {
      for (let index = 0; index < Math.min(value.length, WORKSPACE_TABULAR_MAX_COLUMNS); index += 1) {
        addIndexField(index)
      }
      continue
    }

    hasPrimitiveValue = true
  }

  if (hasPrimitiveValue) {
    rawFields.push({ kind: 'value', rawName: 'value' })
  }

  const names = normalizeHeader(rawFields.map((field) => field.rawName), rawFields.length)
  return rawFields.map((field, index) => {
    const name = names[index] ?? `Column ${index + 1}`
    if (field.kind === 'property') {
      return { kind: field.kind, key: field.key, name }
    }
    if (field.kind === 'index') {
      return { kind: field.kind, index: field.index, name }
    }
    return { kind: field.kind, name }
  })
}

function valuesForJsonlRecord(value: unknown, fields: JsonlField[]): string[] {
  return fields.map((field) => {
    const fieldValue = readJsonlField(value, field)
    return fieldValue.exists ? previewJsonValue(fieldValue.value) : ''
  })
}

function summarizeJsonlColumns(
  records: JsonlRecord[],
  fields: JsonlField[]
): WorkspaceTabularColumnSummary[] {
  return fields.map((field, index) => summarizeJsonlColumn(records, field, index))
}

function summarizeJsonlColumn(records: JsonlRecord[], field: JsonlField, index: number): WorkspaceTabularColumnSummary {
  const detectedTypes = new Set<Exclude<WorkspaceTabularColumnType, 'empty' | 'mixed'>>()
  const examples: string[] = []
  let nonEmptyCount = 0

  for (const record of records) {
    const fieldValue = readJsonlField(record.value, field)
    if (!fieldValue.exists || isEmptyJsonFieldValue(fieldValue.value)) continue

    nonEmptyCount += 1
    detectedTypes.add(detectJsonValueType(fieldValue.value))

    const example = previewJsonValue(fieldValue.value)
    if (examples.length < 3 && !examples.includes(example)) {
      examples.push(example)
    }
  }

  return {
    index,
    name: field.name,
    inferredType: inferColumnType(detectedTypes, nonEmptyCount),
    nonEmptyCount,
    emptyCount: records.length - nonEmptyCount,
    examples
  }
}

function readJsonlField(value: unknown, field: JsonlField): JsonlFieldValue {
  if (field.kind === 'property') {
    if (!isPlainJsonObject(value) || !Object.prototype.hasOwnProperty.call(value, field.key)) {
      return { exists: false }
    }
    return { exists: true, value: value[field.key] }
  }

  if (field.kind === 'index') {
    if (!Array.isArray(value) || field.index >= value.length) {
      return { exists: false }
    }
    return { exists: true, value: value[field.index] }
  }

  if (isPlainJsonObject(value) || Array.isArray(value)) {
    return { exists: false }
  }
  return { exists: true, value }
}

function isPlainJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isEmptyJsonFieldValue(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length === 0
}

function detectJsonValueType(value: unknown): Exclude<WorkspaceTabularColumnType, 'empty' | 'mixed'> {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (isPlainJsonObject(value)) return 'object'
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'number' && Number.isFinite(value)) return 'number'
  if (typeof value === 'string') return detectCellType(value)
  return 'string'
}

function previewJsonValue(value: unknown): string {
  if (value === undefined) return ''
  if (typeof value === 'string') return truncateCell(value)
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return String(value)
  }

  try {
    return truncateCell(JSON.stringify(value) ?? String(value))
  } catch {
    return truncateCell(String(value))
  }
}

function stripBom(rows: string[][]): void {
  const firstCell = rows[0]?.[0]
  if (firstCell?.startsWith('\ufeff')) {
    rows[0][0] = firstCell.slice(1)
  }
}

function countColumns(rows: string[][]): number {
  return rows.reduce((max, row) => Math.max(max, row.length), 0)
}

function normalizeHeader(rawHeader: string[], columnCount: number): string[] {
  const names: string[] = []
  const seen = new Map<string, number>()

  for (let index = 0; index < columnCount; index += 1) {
    const fallback = `Column ${index + 1}`
    const raw = rawHeader[index]?.trim() || fallback
    const base = truncateHeader(raw)
    const previousCount = seen.get(base) ?? 0
    const nextCount = previousCount + 1
    seen.set(base, nextCount)
    names.push(nextCount === 1 ? base : truncateHeader(`${base} ${nextCount}`))
  }

  return names
}

function valuesForDelimitedRow(row: string[], columnCount: number): string[] {
  return Array.from({ length: columnCount }, (_unused, index) => truncateCell(row[index] ?? ''))
}

function summarizeDelimitedColumns(
  rows: string[][],
  header: string[],
  columnCount: number
): WorkspaceTabularColumnSummary[] {
  return Array.from({ length: columnCount }, (_unused, index) => summarizeDelimitedColumn(rows, header[index] ?? `Column ${index + 1}`, index))
}

function summarizeDelimitedColumn(rows: string[][], name: string, index: number): WorkspaceTabularColumnSummary {
  const detectedTypes = new Set<Exclude<WorkspaceTabularColumnType, 'empty' | 'mixed'>>()
  const examples: string[] = []
  let nonEmptyCount = 0

  for (const row of rows) {
    const raw = row[index] ?? ''
    const trimmed = raw.trim()
    if (!trimmed) continue

    nonEmptyCount += 1
    detectedTypes.add(detectCellType(trimmed))

    const example = truncateCell(trimmed)
    if (examples.length < 3 && !examples.includes(example)) {
      examples.push(example)
    }
  }

  return {
    index,
    name,
    inferredType: inferColumnType(detectedTypes, nonEmptyCount),
    nonEmptyCount,
    emptyCount: rows.length - nonEmptyCount,
    examples
  }
}

function detectCellType(value: string): Exclude<WorkspaceTabularColumnType, 'empty' | 'mixed'> {
  if (BOOLEAN_PATTERN.test(value)) return 'boolean'
  if (NUMBER_PATTERN.test(value) && Number.isFinite(Number(value))) return 'number'
  if (DATE_PATTERN.test(value) && !Number.isNaN(Date.parse(value))) return 'date'
  return 'string'
}

function inferColumnType(
  types: Set<Exclude<WorkspaceTabularColumnType, 'empty' | 'mixed'>>,
  nonEmptyCount: number
): WorkspaceTabularColumnType {
  if (nonEmptyCount === 0) return 'empty'
  if (types.size === 1) {
    return [...types][0] ?? 'string'
  }
  return 'mixed'
}

function buildSelectionSummary(input: NormalizedWorkspaceTabularSelectionSummaryInput): WorkspaceTabularSelectionSummary {
  const ranges = normalizedSelectionRanges(input.selection)
  const selectedCells = collectSelectedCells(input.rows, input.selection, ranges)
  const selectionRanges = ranges.length > 0 ? ranges : rangesForExplicitCells(input.selection.cells)
  const outputCells = selectedCells.cells
  const selection = {
    kind: 'tabular' as const,
    ...(input.selection.sheet ? { sheet: input.selection.sheet } : {}),
    ranges: selectionRanges,
    ...(outputCells.length > 0 ? { cells: outputCells } : {})
  }
  const visibleText = buildSelectionVisibleText({
    rows: input.rows,
    selectedRowCount: selectedCells.selectedRowCount,
    selectedCellCount: selectedCells.selectedCellCount,
    returnedCellCount: outputCells.length,
    truncatedCells: selectedCells.truncatedCells,
    sheet: input.selection.sheet
  })

  return workspaceTabularSelectionSummarySchema.parse({
    selection,
    selectedRowCount: selectedCells.selectedRowCount,
    selectedCellCount: selectedCells.selectedCellCount,
    truncatedCells: selectedCells.truncatedCells,
    visibleText
  })
}

function normalizedSelectionRanges(selection: NormalizedWorkspaceTabularSelectionRequest): WorkspaceTabularSelectionRange[] {
  return selection.ranges.map(normalizeSelectionRange)
}

function normalizeSelectionRange(range: WorkspaceTabularSelectionRange): WorkspaceTabularSelectionRange {
  return {
    rowStart: Math.min(range.rowStart, range.rowEnd),
    rowEnd: Math.max(range.rowStart, range.rowEnd),
    columnStart: Math.min(range.columnStart, range.columnEnd),
    columnEnd: Math.max(range.columnStart, range.columnEnd)
  }
}

function rangesForExplicitCells(cells: CellCoordinate[]): WorkspaceTabularSelectionRange[] {
  if (cells.length === 0) {
    return [{
      rowStart: 0,
      rowEnd: 0,
      columnStart: 0,
      columnEnd: 0
    }]
  }

  return [{
    rowStart: Math.min(...cells.map((cell) => cell.row)),
    rowEnd: Math.max(...cells.map((cell) => cell.row)),
    columnStart: Math.min(...cells.map((cell) => cell.column)),
    columnEnd: Math.max(...cells.map((cell) => cell.column))
  }]
}

function collectSelectedCells(
  rows: WorkspaceTabularPreviewRow[],
  selection: NormalizedWorkspaceTabularSelectionRequest,
  ranges: WorkspaceTabularSelectionRange[]
): {
  cells: CellWithValue[]
  selectedRowCount: number
  selectedCellCount: number
  truncatedCells: boolean
} {
  const explicitCellsByRow = explicitCellMap(selection.cells)
  const selectedRows = new Set<number>()
  const outputCells: CellWithValue[] = []
  let selectedCellCount = 0
  let truncatedCells = false

  for (const row of rows) {
    const columns = selectedColumnsForRow(row.index, ranges, explicitCellsByRow.get(row.index))
    if (columns.length === 0) continue

    selectedRows.add(row.index)
    for (const column of columns) {
      selectedCellCount += 1
      if (outputCells.length >= selection.maxCells) {
        truncatedCells = true
        continue
      }

      const cell: CellWithValue = {
        row: row.index,
        column
      }
      if (selection.includeCellValues) {
        cell.value = row.values[column] ?? ''
      }
      outputCells.push(cell)
    }
  }

  return {
    cells: outputCells,
    selectedRowCount: selectedRows.size,
    selectedCellCount,
    truncatedCells
  }
}

function explicitCellMap(cells: CellCoordinate[]): Map<number, Set<number>> {
  const explicitCellsByRow = new Map<number, Set<number>>()
  for (const cell of cells) {
    const columns = explicitCellsByRow.get(cell.row) ?? new Set<number>()
    columns.add(cell.column)
    explicitCellsByRow.set(cell.row, columns)
  }
  return explicitCellsByRow
}

function selectedColumnsForRow(
  rowIndex: number,
  ranges: WorkspaceTabularSelectionRange[],
  explicitColumns: Set<number> | undefined
): number[] {
  const columns = new Set<number>()
  for (const range of ranges) {
    if (rowIndex < range.rowStart || rowIndex > range.rowEnd) continue
    for (let column = range.columnStart; column <= range.columnEnd; column += 1) {
      columns.add(column)
    }
  }

  if (explicitColumns) {
    for (const column of explicitColumns) {
      columns.add(column)
    }
  }

  return [...columns].sort((left, right) => left - right)
}

function buildSelectionVisibleText(input: {
  rows: WorkspaceTabularPreviewRow[]
  selectedRowCount: number
  selectedCellCount: number
  returnedCellCount: number
  truncatedCells: boolean
  sheet?: string
}): string {
  const lines = [
    `Tabular selection: ${input.selectedRowCount} selected row${input.selectedRowCount === 1 ? '' : 's'} and ${input.selectedCellCount} selected cell${input.selectedCellCount === 1 ? '' : 's'} from ${input.rows.length} preview row${input.rows.length === 1 ? '' : 's'}.`
  ]
  if (input.sheet) {
    lines.push(`Sheet: ${input.sheet}.`)
  }
  if (input.truncatedCells) {
    lines.push(`Selection cell list includes ${input.returnedCellCount} of ${input.selectedCellCount} selected cells.`)
  }
  return truncateText(lines.join('\n'), WORKSPACE_TABULAR_MAX_VISIBLE_TEXT_CHARS)
}

function buildQueryVisibleText(input: QueryVisibleTextInput): string {
  const lines = [
    `Tabular query: returned ${input.returnedRowCount} of ${input.filteredRowCount} filtered preview rows from ${input.sourceRowCount} source preview rows.`,
    `Applied ${input.filtersApplied} filter${input.filtersApplied === 1 ? '' : 's'} and ${input.sortsApplied} sort rule${input.sortsApplied === 1 ? '' : 's'}.`
  ]
  if (input.truncatedRows) {
    lines.push('Query rows are bounded by maxRows.')
  }
  if (input.selectionSummary) {
    lines.push(input.selectionSummary.visibleText)
  }
  return truncateText(lines.join('\n'), WORKSPACE_TABULAR_MAX_VISIBLE_TEXT_CHARS)
}

function buildWorkspaceObservation(input: ObservationBuildInput): WorkspaceTabularObservation {
  const title = titleForPath(input.input.path)
  const visibleText = buildVisibleText(input)
  const selection = buildSelection(input.previewRows, input.header.length, input.sheetName)
  const annotations = input.warnings.map((warning, index) => ({
    id: `warning-${index + 1}`,
    kind: 'warning',
    summary: warning
  }))

  return {
    schemaVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
    file: {
      path: input.input.path?.trim() || 'inline-tabular-data',
      ...(input.input.workspaceRoot ? { workspaceRoot: input.input.workspaceRoot } : {}),
      mimeType: input.input.mimeType ?? defaultMimeType(input.format),
      ...(input.input.size !== undefined ? { size: input.input.size } : {}),
      ...(input.input.mtimeMs !== undefined ? { mtimeMs: input.input.mtimeMs } : {})
    },
    view: {
      pluginId: WORKSPACE_TABULAR_PLUGIN_ID,
      modality: 'tabular',
      mode: 'preview',
      title
    },
    ...(selection ? { selection } : {}),
    visibleText,
    tables: [{
      id: 'table-1',
      name: input.sheetName ?? title,
      rowCount: input.rowCount,
      columnCount: input.columnCount
    }],
    ...(annotations.length > 0 ? { annotations } : {}),
    actions: [...(input.actions ?? WORKSPACE_TABULAR_ACTIONS)]
  }
}

function buildSelection(
  previewRows: WorkspaceTabularPreviewRow[],
  columnCount: number,
  sheetName?: string
): WorkspaceTabularObservation['selection'] {
  if (previewRows.length === 0 || columnCount === 0) return undefined

  const lastRow = previewRows[previewRows.length - 1]
  const cells = previewRows.flatMap((row) => row.values.map((value, column) => ({
    row: row.index,
    column,
    value
  }))).slice(0, 10_000)

  return {
    kind: 'tabular',
    ...(sheetName ? { sheet: sheetName } : {}),
    ranges: [{
      rowStart: 0,
      rowEnd: lastRow?.index ?? 0,
      columnStart: 0,
      columnEnd: columnCount - 1
    }],
    cells
  }
}

function buildVisibleText(input: ObservationBuildInput): string {
  const lines = [
    `Tabular preview: ${formatRowCount(input.rowCount, input.rowCountIsEstimate)} data rows x ${input.columnCount} columns.`,
    `Detected format: ${formatDisplayName(input)}.`
  ]

  if (input.sheetName) {
    lines.push(`Sheet: ${input.sheetName}.`)
  }

  if (input.header.length > 0) {
    lines.push(`Columns: ${input.header.join(', ')}.`)
  }

  if (input.columns.length > 0) {
    lines.push('Column summary:')
    for (const column of input.columns.slice(0, 20)) {
      const examples = column.examples.length > 0 ? ` examples: ${column.examples.join(', ')}` : ''
      lines.push(`- ${column.name}: ${column.inferredType}, ${column.nonEmptyCount} non-empty, ${column.emptyCount} empty.${examples}`)
    }
  }

  if (input.previewRows.length > 0) {
    lines.push('Preview rows:')
    lines.push(input.header.join('\t'))
    for (const row of input.previewRows.slice(0, 10)) {
      lines.push(row.values.join('\t'))
    }
  }

  if (input.truncatedRows || input.truncatedColumns) {
    lines.push('Preview is bounded; use the full file for complete data.')
  }

  return truncateText(lines.join('\n'), WORKSPACE_TABULAR_MAX_VISIBLE_TEXT_CHARS)
}

function titleForPath(path: string | undefined): string {
  const trimmed = path?.trim()
  if (!trimmed) return 'Tabular data'
  return trimmed.split(/[\\/]/).filter(Boolean).at(-1) ?? trimmed
}

function defaultMimeType(format: WorkspaceTabularResolvedFormat): string {
  if (format === 'xlsx') return XLSX_MIME_TYPE
  if (format === 'tsv') return 'text/tab-separated-values'
  if (isJsonlFormat(format)) return 'application/x-ndjson'
  return 'text/csv'
}

function formatDisplayName(input: ObservationBuildInput): string {
  if (input.format === 'xlsx') return 'XLSX'
  if (input.format === 'csv' || input.format === 'tsv') {
    return input.format.toUpperCase()
  }
  return input.format === 'ndjson' ? 'NDJSON' : 'JSONL'
}

function formatRowCount(rowCount: number, isEstimate: boolean): string {
  return isEstimate ? `approximately ${rowCount}` : String(rowCount)
}

function formatLineNumberList(lineNumbers: number[]): string {
  if (lineNumbers.length === 0) return 'line number unavailable'
  return `line${lineNumbers.length === 1 ? '' : 's'} ${lineNumbers.join(', ')}`
}

function cloneDataRows(rows: readonly unknown[][]): unknown[][] {
  return rows.map((row) => [...row])
}

function countDataColumns(rows: readonly unknown[][]): number {
  return rows.reduce((max, row) => Math.max(max, row.length), 0)
}

function uniqueSortedIndices(indices: readonly number[]): number[] {
  return [...new Set(indices)].sort((left, right) => left - right)
}

function clonePreviewRows(rows: readonly WorkspaceTabularPreviewRow[]): WorkspaceTabularPreviewRow[] {
  return rows.map((row) => ({
    index: row.index,
    values: [...row.values]
  }))
}

function tabularCellToText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return truncateCell(value)
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value)
  }
  return truncateCell(JSON.stringify(value) ?? '')
}

function serializeDelimitedCell(value: unknown, delimiter: WorkspaceTabularDelimiter): string {
  const text = tabularCellToText(value)
  if (!text.includes(delimiter) && !/["\r\n]/.test(text)) return text
  return `"${text.replaceAll('"', '""')}"`
}

function endsWithLineBreak(value: string): boolean {
  return value.endsWith('\n') || value.endsWith('\r')
}

function boundedWarnings(warnings: string[]): string[] {
  return warnings.map((warning) => truncateText(warning.trim(), 1000)).filter(Boolean).slice(0, WORKSPACE_TABULAR_MAX_WARNINGS)
}

function truncateHeader(value: string): string {
  return truncateText(value.trim() || 'Column', WORKSPACE_TABULAR_MAX_HEADER_CHARS)
}

function truncateCell(value: string): string {
  return truncateText(value, WORKSPACE_TABULAR_MAX_CELL_CHARS)
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  if (maxLength <= 3) return value.slice(0, maxLength)
  return `${value.slice(0, maxLength - 3)}...`
}
