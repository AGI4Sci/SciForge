# @sciforge-ui/record-table

## Agent quick contract
- componentId: `record-table`
- accepts: `record-set`, `data-table`, `table`, `dataframe`, `annotation-table`, `runtime-artifact`, `knowledge-graph`, `sequence-alignment`
- requires any of: `rows`, `records`, `items`, `papers`, `nodes`, `sequences`
- outputs: `record-set`, `data-table`
- events: `select-row`
- fallback: `generic-artifact-inspector`
- safety: no code execution, no external resources
- demo fixtures: `fixtures/basic.ts`, `fixtures/empty.ts`, `fixtures/selection.ts`
- replacement route: supersedes `data-table`; keep historical `data-table` as an alias until deletion checks pass

## Human notes
Use this package for compact row previews, metadata tables, record sets, and fallback inspection of array-like artifact payloads. The renderer is intentionally dependency-light and works from inline rows or common row-like fields.

Large dataframes should be summarized inline and linked through `dataRef`. Do not use it for dense matrices, graphs, structures, or publication figures when a domain renderer is available.

## 何时不要使用该组件
Do not use it as decorative companion content, for matrix heatmaps, graph topology, molecular structures, or full spreadsheet editing.
