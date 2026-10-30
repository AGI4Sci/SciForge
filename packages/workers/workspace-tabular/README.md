# SciForge Workspace Tabular Worker

First-party TypeScript worker package for bounded workspace tabular previews.

This package currently focuses on lightweight text table formats:

- parses delimited text with quoted CSV fields and escaped quotes
- parses `.jsonl` / NDJSON records without adding heavy runtime dependencies
- returns bounded preview rows and bounded columns
- discovers JSONL object fields or top-level array indexes from a bounded sampled window
- renders nested JSON values as compact cell previews
- summarizes row count, row count estimates, column count, per-column examples, empties, and inferred type
- can emit a WorkspaceObservation-shaped tabular summary for the workspace preview host
- exposes pure in-memory preview-row helpers for filtering, sorting, and WorkspaceObservation-compatible structured selection summaries
- exposes pure in-memory helpers for simple `updateCell` and `insertRows` data changes

It intentionally does not write files, connect root IPC, start an MCP server, or add spreadsheet binary parsing yet.

## Scripts

```sh
npm --prefix packages/workers/workspace-tabular run typecheck
npm --prefix packages/workers/workspace-tabular run test
```

## Example

```ts
import { WorkspaceTabularService } from '@sciforge/workspace-tabular'

const service = new WorkspaceTabularService()
const preview = service.preview({
  text: 'gene,count\nTP53,12\nBRCA1,8\n',
  format: 'csv',
  path: 'results.csv'
})

console.log(preview.rowCount, preview.columns)
```

```ts
const jsonlPreview = service.preview({
  text: '{"sample":"s1","metrics":{"count":12}}\n{"sample":"s2","metrics":{"count":8}}\n',
  format: 'jsonl',
  path: 'results.jsonl'
})

console.log(jsonlPreview.header, jsonlPreview.previewRows)
```

```ts
const query = service.queryPreviewRows({
  rows: preview.previewRows,
  header: preview.header,
  filters: [{ columnName: 'count', operator: 'gte', value: 10, compareAs: 'number' }],
  sorts: [{ columnName: 'gene', direction: 'asc' }],
  selection: {
    ranges: [{ rowStart: 0, rowEnd: 4, columnStart: 0, columnEnd: 1 }]
  }
})

console.log(query.rows, query.selectionSummary?.selection)
```

`queryPreviewRows()` works against the common `previewRows` shape returned by CSV, TSV, JSONL, and NDJSON previews. Row indexes in selection summaries refer to `WorkspaceTabularPreviewRow.index`, preserving the original preview-row identity even after sorting.
