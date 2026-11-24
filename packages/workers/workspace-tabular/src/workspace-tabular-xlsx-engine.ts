import { posix as pathPosix } from 'node:path'
import { XMLParser } from 'fast-xml-parser'
import JSZip from 'jszip'
import {
  WORKSPACE_TABULAR_CONTRACT_VERSION,
  WORKSPACE_TABULAR_READONLY_ACTIONS,
  workspaceTabularPreviewResultSchema,
  workspaceTabularXlsxPreviewInputSchema,
  type NormalizedWorkspaceTabularXlsxPreviewInput,
  type WorkspaceTabularPreviewResult
} from './contract.js'
import {
  boundedWarnings,
  buildWorkspaceObservation,
  normalizeHeader,
  summarizeDelimitedColumns,
  truncateCell,
  truncateHeader,
  valuesForDelimitedRow
} from './workspace-tabular-engine.js'

type XmlRecord = Record<string, unknown>

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

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: false
})

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

