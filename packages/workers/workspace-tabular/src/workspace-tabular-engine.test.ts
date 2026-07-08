import assert from 'node:assert/strict'
import test from 'node:test'

import JSZip from 'jszip'

import {
  WORKSPACE_TABULAR_MAX_PREVIEW_ROWS,
  WorkspaceTabularService,
  applyWorkspaceTabularDelimitedEdit,
  createWorkspaceTabularPreview,
  deleteWorkspaceTabularColumns,
  deleteWorkspaceTabularRows,
  insertWorkspaceTabularColumns,
  insertWorkspaceTabularRows,
  queryWorkspaceTabularPreviewRows,
  summarizeWorkspaceTabularSelection,
  updateWorkspaceTabularCell,
  workspaceTabularObservationSchema,
  workspaceTabularPreviewInputSchema,
  workspaceTabularQueryInputSchema,
  workspaceTabularSelectionSummarySchema
} from './index.js'

test('parses CSV text into a bounded preview and column summary', () => {
  const service = new WorkspaceTabularService()
  const result = service.preview({
    text: 'gene,count,note\n"A,1",10,alpha\n"B ""quoted""",12,beta\nC,13,gamma\n',
    format: 'csv',
    maxPreviewRows: 2,
    path: 'results.csv'
  })

  assert.equal(result.format, 'csv')
  assert.equal(result.rowCountIsEstimate, false)
  assert.equal(result.rowCount, 3)
  assert.equal(result.columnCount, 3)
  assert.deepEqual(result.header, ['gene', 'count', 'note'])
  assert.equal(result.previewRows.length, 2)
  assert.equal(result.truncatedRows, true)
  assert.deepEqual(result.previewRows[0]?.values, ['A,1', '10', 'alpha'])
  assert.deepEqual(result.previewRows[1]?.values, ['B "quoted"', '12', 'beta'])
  assert.equal(result.columns[1]?.inferredType, 'number')
  assert.deepEqual(result.columns[1]?.examples, ['10', '12', '13'])
})

test('parses TSV without a header and bounds columns', () => {
  const input = workspaceTabularPreviewInputSchema.parse({
    text: '1\ttrue\t2026-07-08\n4\t\t2026-07-09\n',
    format: 'tsv',
    hasHeader: false,
    maxColumns: 2
  })
  const result = createWorkspaceTabularPreview(input)

  assert.equal(result.format, 'tsv')
  assert.equal(result.rowCountIsEstimate, false)
  assert.equal(result.rowCount, 2)
  assert.equal(result.columnCount, 3)
  assert.deepEqual(result.header, ['Column 1', 'Column 2'])
  assert.equal(result.truncatedColumns, true)
  assert.deepEqual(result.previewRows[0]?.values, ['1', 'true'])
  assert.equal(result.columns[0]?.inferredType, 'number')
  assert.equal(result.columns[1]?.inferredType, 'boolean')
  assert.equal(result.columns[1]?.emptyCount, 1)
})

test('parses JSONL records with field discovery and nested value previews', () => {
  const service = new WorkspaceTabularService()
  const result = service.preview({
    text: [
      '{"id":"s1","count":1,"meta":{"tissue":"liver","qc":true},"tags":["a","b"]}',
      '{"id":"s2","count":2,"meta":{"tissue":"heart"},"extra":null}',
      '{"id":"s3","count":3,"tags":[]}'
    ].join('\n'),
    format: 'jsonl',
    maxPreviewRows: 2,
    path: 'records.jsonl'
  })

  assert.equal(result.format, 'jsonl')
  assert.equal(result.delimiter, undefined)
  assert.equal(result.rowCount, 3)
  assert.equal(result.rowCountIsEstimate, false)
  assert.equal(result.columnCount, 5)
  assert.deepEqual(result.header, ['id', 'count', 'meta', 'tags', 'extra'])
  assert.equal(result.truncatedRows, true)
  assert.deepEqual(result.previewRows[0]?.values, [
    's1',
    '1',
    '{"tissue":"liver","qc":true}',
    '["a","b"]',
    ''
  ])
  assert.equal(result.columns[1]?.inferredType, 'number')
  assert.equal(result.columns[2]?.inferredType, 'object')
  assert.equal(result.columns[3]?.inferredType, 'array')
  assert.equal(result.columns[4]?.inferredType, 'null')
  assert.match(result.observation?.visibleText ?? '', /Detected format: JSONL/)
  assert.match(result.observation?.visibleText ?? '', /\{"tissue":"liver","qc":true\}/)
  assert.equal(result.observation?.tables?.[0]?.rowCount, 3)
})

test('auto-detects NDJSON files, bounds discovered fields, and reports malformed sampled lines', () => {
  const service = new WorkspaceTabularService()
  const result = service.preview({
    text: [
      '{"a":1,"b":2,"c":3}',
      'not json',
      '{"a":4,"b":5,"d":6}'
    ].join('\n'),
    format: 'auto',
    maxColumns: 2,
    path: 'events.ndjson'
  })

  assert.equal(result.format, 'ndjson')
  assert.deepEqual(result.header, ['a', 'b'])
  assert.equal(result.columnCount, 4)
  assert.equal(result.truncatedColumns, true)
  assert.equal(result.rowCount, 3)
  assert.equal(result.previewRows.length, 2)
  assert.ok(result.warnings.some((warning) => warning.includes('malformed JSONL line')))
  assert.ok(result.warnings.some((warning) => warning.includes('2 of 4 discovered JSONL fields')))
})

test('parses XLSX first sheet into a bounded read-only preview observation', async () => {
  const service = new WorkspaceTabularService()
  const bytes = await createMinimalXlsxBytes()
  const result = await service.previewXlsx({
    bytes,
    maxPreviewRows: 2,
    maxColumns: 2,
    path: 'workbooks/samples.xlsx',
    workspaceRoot: '/workspace/project',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  })

  assert.equal(result.format, 'xlsx')
  assert.equal(result.rowCountIsEstimate, false)
  assert.equal(result.rowCount, 3)
  assert.equal(result.columnCount, 3)
  assert.deepEqual(result.header, ['sample', 'count'])
  assert.equal(result.previewRows.length, 2)
  assert.equal(result.truncatedRows, true)
  assert.equal(result.truncatedColumns, true)
  assert.deepEqual(result.previewRows[0]?.values, ['s1', '2'])
  assert.deepEqual(result.previewRows[1]?.values, ['s2', '3'])
  assert.equal(result.columns[1]?.inferredType, 'number')
  assert.ok(result.warnings.some((warning) => warning.includes('first sheet "Data"')))
  assert.ok(result.warnings.some((warning) => warning.includes('2 of 3 data rows')))
  assert.ok(result.warnings.some((warning) => warning.includes('2 of 3 columns')))

  assert.ok(result.observation)
  const observation = workspaceTabularObservationSchema.parse(result.observation)
  assert.equal(observation.tables?.[0]?.name, 'Data')
  assert.equal(observation.tables?.[0]?.rowCount, 3)
  assert.equal(observation.tables?.[0]?.columnCount, 3)
  assert.equal(observation.selection?.sheet, 'Data')
  assert.match(observation.visibleText ?? '', /Detected format: XLSX/)
  assert.match(observation.visibleText ?? '', /Sheet: Data/)
  assert.ok(observation.actions.includes('tabular.filterRows'))
  assert.ok(observation.actions.includes('tabular.selectCells'))
  assert.ok(!observation.actions.includes('tabular.updateCell'))
  assert.ok(!observation.actions.includes('tabular.insertRows'))
  assert.ok(!observation.actions.includes('tabular.insertColumns'))
  assert.ok(!observation.actions.includes('tabular.deleteRows'))
  assert.ok(!observation.actions.includes('tabular.deleteColumns'))
})

test('estimates JSONL row count from provided file size metadata', () => {
  const text = '{"a":1}\n{"a":2}\n'
  const result = createWorkspaceTabularPreview(workspaceTabularPreviewInputSchema.parse({
    text,
    format: 'jsonl',
    size: text.length * 4,
    maxPreviewRows: 1
  }))

  assert.equal(result.rowCountIsEstimate, true)
  assert.equal(result.rowCount, 8)
  assert.equal(result.truncatedRows, true)
  assert.equal(result.observation?.tables?.[0]?.rowCount, 8)
  assert.match(result.observation?.visibleText ?? '', /approximately 8 data rows/)
  assert.ok(result.observation?.actions.includes('tabular.filterRows'))
  assert.ok(result.observation?.actions.includes('tabular.selectCells'))
  assert.ok(!result.observation?.actions.includes('tabular.updateCell'))
  assert.ok(!result.observation?.actions.includes('tabular.insertRows'))
  assert.ok(!result.observation?.actions.includes('tabular.insertColumns'))
  assert.ok(!result.observation?.actions.includes('tabular.deleteRows'))
  assert.ok(!result.observation?.actions.includes('tabular.deleteColumns'))
})

test('emits a WorkspaceObservation-compatible tabular summary shape', () => {
  const service = new WorkspaceTabularService()
  const result = service.preview({
    text: 'sample,value\ns1,1\ns2,2\n',
    delimiter: ',',
    path: 'tables/samples.csv',
    workspaceRoot: '/workspace/project',
    mimeType: 'text/csv'
  })

  assert.ok(result.observation)
  const observation = workspaceTabularObservationSchema.parse(result.observation)
  assert.equal(observation.schemaVersion, 1)
  assert.equal(observation.file.path, 'tables/samples.csv')
  assert.equal(observation.view.pluginId, 'tabular')
  assert.equal(observation.view.modality, 'tabular')
  assert.equal(observation.tables?.[0]?.rowCount, 2)
  assert.equal(observation.tables?.[0]?.columnCount, 2)
  assert.match(observation.visibleText ?? '', /2 data rows x 2 columns/)
  assert.equal(observation.selection?.kind, 'tabular')
  assert.ok(observation.actions.includes('tabular.filterRows'))
  assert.ok(observation.actions.includes('tabular.sortRows'))
  assert.ok(observation.actions.includes('tabular.selectCells'))
  assert.ok(observation.actions.includes('tabular.updateCell'))
  assert.ok(observation.actions.includes('tabular.insertRows'))
  assert.ok(observation.actions.includes('tabular.insertColumns'))
  assert.ok(observation.actions.includes('tabular.deleteRows'))
  assert.ok(observation.actions.includes('tabular.deleteColumns'))
})

test('filters, sorts, and selects CSV and TSV preview rows in memory', () => {
  const service = new WorkspaceTabularService()
  const csvPreview = service.preview({
    text: [
      'sample,count,group',
      's1,4,control',
      's2,10,treated',
      's3,7,treated',
      's4,12,treated'
    ].join('\n'),
    format: 'csv',
    path: 'samples.csv'
  })
  const csvQuery = service.queryPreviewRows({
    rows: csvPreview.previewRows,
    header: csvPreview.header,
    filters: [
      { columnName: 'group', operator: 'equals', value: 'treated' },
      { columnName: 'count', operator: 'gte', value: 10, compareAs: 'number' }
    ],
    sorts: [{ columnName: 'count', direction: 'desc', compareAs: 'number' }],
    selection: {
      ranges: [{ rowStart: 0, rowEnd: 3, columnStart: 0, columnEnd: 1 }],
      maxCells: 3
    },
    maxRows: 5
  })

  assert.equal(csvQuery.sourceRowCount, 4)
  assert.equal(csvQuery.filteredRowCount, 2)
  assert.equal(csvQuery.returnedRowCount, 2)
  assert.equal(csvQuery.truncatedRows, false)
  assert.deepEqual(csvQuery.rows.map((row) => row.values[0]), ['s4', 's2'])
  assert.deepEqual(csvPreview.previewRows.map((row) => row.values[0]), ['s1', 's2', 's3', 's4'])
  assert.equal(csvQuery.selectionSummary?.selectedRowCount, 2)
  assert.equal(csvQuery.selectionSummary?.selectedCellCount, 4)
  assert.equal(csvQuery.selectionSummary?.truncatedCells, true)
  assert.equal(csvQuery.selectionSummary?.selection.cells?.length, 3)
  assert.match(csvQuery.visibleText, /Applied 2 filters and 1 sort rule/)

  const observation = workspaceTabularObservationSchema.parse({
    schemaVersion: 1,
    file: { path: 'samples.csv', mimeType: 'text/csv' },
    view: {
      pluginId: 'tabular',
      modality: 'tabular',
      mode: 'preview',
      title: 'samples.csv'
    },
    selection: csvQuery.selectionSummary?.selection,
    actions: []
  })
  assert.equal(observation.selection?.kind, 'tabular')

  const tsvPreview = service.preview({
    text: 'id\tlabel\n1\tbeta\n2\t\n3\talpha\n',
    format: 'tsv',
    path: 'labels.tsv'
  })
  const tsvQuery = queryWorkspaceTabularPreviewRows({
    rows: tsvPreview.previewRows,
    header: tsvPreview.header,
    filters: [{ column: 1, operator: 'isNotEmpty' }],
    sorts: [{ column: 0, direction: 'desc', compareAs: 'number' }]
  })

  assert.equal(tsvQuery.filteredRowCount, 2)
  assert.deepEqual(tsvQuery.rows.map((row) => row.values), [
    ['3', 'alpha'],
    ['1', 'beta']
  ])
})

test('filters JSONL preview fields and builds standalone selection summaries', () => {
  const service = new WorkspaceTabularService()
  const jsonlPreview = service.preview({
    text: [
      '{"id":"s1","score":2,"meta":{"tissue":"heart"}}',
      '{"id":"s2","score":1,"meta":{"tissue":"liver"}}',
      '{"id":"s3","score":3,"meta":{"tissue":"liver"}}'
    ].join('\n'),
    format: 'jsonl',
    path: 'records.jsonl'
  })
  const query = service.queryPreviewRows({
    rows: jsonlPreview.previewRows,
    header: jsonlPreview.header,
    filters: [{ columnName: 'meta', operator: 'contains', value: 'liver' }],
    sorts: [{ columnName: 'score', direction: 'asc', compareAs: 'number' }],
    selection: {
      cells: [
        { row: 1, column: 0 },
        { row: 2, column: 0 }
      ],
      includeCellValues: false
    }
  })

  assert.equal(query.filteredRowCount, 2)
  assert.deepEqual(query.rows.map((row) => row.values[0]), ['s2', 's3'])
  assert.equal(query.selectionSummary?.selectedRowCount, 2)
  assert.deepEqual(query.selectionSummary?.selection.ranges, [{
    rowStart: 1,
    rowEnd: 2,
    columnStart: 0,
    columnEnd: 0
  }])
  assert.deepEqual(query.selectionSummary?.selection.cells, [
    { row: 1, column: 0 },
    { row: 2, column: 0 }
  ])

  const summary = summarizeWorkspaceTabularSelection({
    rows: jsonlPreview.previewRows,
    header: jsonlPreview.header,
    selection: {
      ranges: [{ rowStart: 2, rowEnd: 1, columnStart: 1, columnEnd: 0 }]
    }
  })

  const parsedSummary = workspaceTabularSelectionSummarySchema.parse(summary)
  assert.equal(parsedSummary.selectedRowCount, 2)
  assert.equal(parsedSummary.selectedCellCount, 4)
  assert.deepEqual(parsedSummary.selection.ranges, [{
    rowStart: 1,
    rowEnd: 2,
    columnStart: 0,
    columnEnd: 1
  }])
  assert.match(parsedSummary.visibleText, /2 selected rows/)
})

test('validates preview inputs with zod contracts', () => {
  const service = new WorkspaceTabularService()

  assert.throws(() => {
    service.preview({
      text: 'a\nb\n',
      maxPreviewRows: WORKSPACE_TABULAR_MAX_PREVIEW_ROWS + 1
    })
  }, { name: 'ZodError' })

  assert.throws(() => {
    workspaceTabularQueryInputSchema.parse({
      rows: [],
      filters: [{ column: 0, operator: 'contains' }]
    })
  }, { name: 'ZodError' })
})

test('updates cells and inserts rows and columns with pure immutable data helpers', () => {
  const original = [
    ['sample', 'count'],
    ['s1', 1]
  ]

  const updated = updateWorkspaceTabularCell({
    rows: original,
    row: 1,
    column: 2,
    value: 'ok'
  })
  assert.deepEqual(updated, [
    ['sample', 'count'],
    ['s1', 1, 'ok']
  ])
  assert.deepEqual(original, [
    ['sample', 'count'],
    ['s1', 1]
  ])

  const inserted = insertWorkspaceTabularRows({
    rows: updated,
    afterRow: 0,
    insertRows: [['s0', 0, 'new']]
  })
  assert.deepEqual(inserted, [
    ['sample', 'count'],
    ['s0', 0, 'new'],
    ['s1', 1, 'ok']
  ])

  assert.throws(() => {
    insertWorkspaceTabularRows({
      rows: original,
      afterRow: 99,
      insertRows: [['nope']]
    })
  }, { name: 'RangeError' })

  const columnInserted = insertWorkspaceTabularColumns({
    rows: [
      ['s1', 2],
      ['s2', 3]
    ],
    afterColumn: -1,
    columns: [
      ['control', 'treated'],
      ['batch-a']
    ]
  })
  assert.deepEqual(columnInserted, [
    ['control', 'batch-a', 's1', 2],
    ['treated', '', 's2', 3]
  ])

  assert.throws(() => {
    insertWorkspaceTabularColumns({
      rows: original,
      afterColumn: 99,
      columns: [['nope']]
    })
  }, { name: 'RangeError' })

  const rowDeleted = deleteWorkspaceTabularRows({
    rows: inserted,
    rowIndices: [0]
  })
  assert.deepEqual(rowDeleted, [
    ['s0', 0, 'new'],
    ['s1', 1, 'ok']
  ])

  const columnDeleted = deleteWorkspaceTabularColumns({
    rows: inserted,
    columnIndices: [1]
  })
  assert.deepEqual(columnDeleted, [
    ['sample'],
    ['s0', 'new'],
    ['s1', 'ok']
  ])
})

test('applies delimited text edits with safe CSV escaping and trailing newline preservation', () => {
  const updated = applyWorkspaceTabularDelimitedEdit({
    text: 'sample,count,note\ns1,2,old\ns2,3,ok\n',
    delimiter: ',',
    operation: {
      kind: 'updateCell',
      row: 0,
      column: 2,
      value: 'alpha, "quoted"\nline'
    }
  })

  assert.equal(updated.text, 'sample,count,note\ns1,2,"alpha, ""quoted""\nline"\ns2,3,ok\n')
  assert.equal(updated.rowCount, 2)
  assert.equal(updated.columnCount, 3)
})

test('inserts delimited text rows relative to data rows after the header', () => {
  const inserted = applyWorkspaceTabularDelimitedEdit({
    text: 'sample\tcount\ns1\t2\n',
    delimiter: '\t',
    operation: {
      kind: 'insertRows',
      afterRow: -1,
      rows: [['s0', 1]]
    }
  })

  assert.equal(inserted.text, 'sample\tcount\ns0\t1\ns1\t2\n')
  assert.equal(inserted.rowCount, 2)
})

test('inserts delimited text columns across headers and data rows with safe escaping', () => {
  const inserted = applyWorkspaceTabularDelimitedEdit({
    text: 'sample,count\ns1,2\ns2\n',
    delimiter: ',',
    operation: {
      kind: 'insertColumns',
      afterColumn: -1,
      columns: [
        ['group', 'control, A'],
        ['note', '"quoted"']
      ]
    }
  })

  assert.equal(inserted.text, 'group,note,sample,count\n"control, A","""quoted""",s1,2\n,,s2,\n')
  assert.equal(inserted.rowCount, 2)
  assert.equal(inserted.columnCount, 4)

  assert.throws(() => {
    applyWorkspaceTabularDelimitedEdit({
      text: 'sample,count\n"unterminated',
      delimiter: ',',
      operation: {
        kind: 'insertColumns',
        afterColumn: -1,
        columns: [['group']]
      }
    })
  }, /Cannot safely edit malformed delimited text/)
})

test('deletes delimited text data rows and columns with header-aware indices', () => {
  const rowDeleted = applyWorkspaceTabularDelimitedEdit({
    text: 'sample,count,note\ns1,2,old\ns2,3,ok\ns3,4,done\n',
    delimiter: ',',
    operation: {
      kind: 'deleteRows',
      rows: [1]
    }
  })
  assert.equal(rowDeleted.text, 'sample,count,note\ns1,2,old\ns3,4,done\n')
  assert.equal(rowDeleted.rowCount, 2)
  assert.equal(rowDeleted.columnCount, 3)

  const columnDeleted = applyWorkspaceTabularDelimitedEdit({
    text: 'sample,count,note\ns1,2,old\ns2,3,ok\n',
    delimiter: ',',
    operation: {
      kind: 'deleteColumns',
      columns: [1]
    }
  })
  assert.equal(columnDeleted.text, 'sample,note\ns1,old\ns2,ok\n')
  assert.equal(columnDeleted.rowCount, 2)
  assert.equal(columnDeleted.columnCount, 2)
})

async function createMinimalXlsxBytes(): Promise<Uint8Array<ArrayBuffer>> {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
</Types>`)
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`)
  zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Data" sheetId="1" r:id="rId1"/>
    <sheet name="Second" sheetId="2" r:id="rId2"/>
  </sheets>
</workbook>`)
  zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
</Relationships>`)
  zip.file('xl/sharedStrings.xml', `<?xml version="1.0" encoding="UTF-8"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="8" uniqueCount="8">
  <si><t>sample</t></si>
  <si><t>count</t></si>
  <si><t>note</t></si>
  <si><t>s1</t></si>
  <si><t>s2</t></si>
  <si><t>s3</t></si>
  <si><t>ignored</t></si>
  <si><r><t>rich</t></r><r><t> text</t></r></si>
</sst>`)
  zip.file('xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>
    <row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2"><v>2</v></c><c r="C2" t="inlineStr"><is><t>alpha</t></is></c></row>
    <row r="3"><c r="A3" t="s"><v>4</v></c><c r="B3"><v>3</v></c><c r="C3" t="b"><v>1</v></c></row>
    <row r="4"><c r="A4" t="s"><v>5</v></c><c r="B4"><v>4</v></c><c r="C4" t="s"><v>7</v></c></row>
  </sheetData>
</worksheet>`)
  zip.file('xl/worksheets/sheet2.xml', `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1"><c r="A1" t="s"><v>6</v></c></row>
  </sheetData>
</worksheet>`)
  return new Uint8Array(await zip.generateAsync({ type: 'uint8array' }))
}
