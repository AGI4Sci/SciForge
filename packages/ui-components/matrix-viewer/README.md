# @sciforge-ui/matrix-viewer

## Agent quick contract
- componentId: `matrix-viewer`
- accepts: `matrix`, `heatmap-viewer`, `omics-differential-expression`, `confusion-matrix`, `attention-map`, `similarity-matrix`
- requires any of: `matrix`, `values`, `heatmap`, `confusionMatrix`
- outputs: `matrix`, `plot-spec`
- events: `select-cell`, `select-row`, `select-column`
- fallback: `record-table`, then `generic-artifact-inspector`
- safety: no code execution, no external resources
- demo fixtures: `fixtures/basic.ts`, `fixtures/empty.ts`, `fixtures/selection.ts`
- replacement route: supersedes `heatmap-viewer`; historical `heatmap-viewer` remains an alias during migration

## Human notes
Use this package for compact numeric matrix previews. The renderer produces a dependency-light heatmap grid and keeps dense matrix data bounded.

## 何时不要使用该组件
Do not use it for row tables, graph topology, or arbitrary Plotly figures when a plot spec is the source of truth.
