# @sciforge-ui/point-set-viewer

## Agent quick contract
- componentId: `point-set-viewer`
- accepts: `point-set`, `plot-spec`, `omics-differential-expression`, `volcano-plot`, `umap-viewer`, `embedding-scatter`
- requires any of: `points`, `umap`, `data`, `plotSpec`
- outputs: `point-set`, `plot-spec`
- events: `select-point`, `select-region`, `hover-point`
- fallback: `scientific-plot-viewer`, then `record-table`, then `generic-artifact-inspector`
- safety: no code execution, no external resources
- demo fixtures: `fixtures/basic.ts`, `fixtures/empty.ts`, `fixtures/selection.ts`
- replacement route: supersedes `volcano-plot` and `umap-viewer` as presets

## Human notes
Use this package for point-based scientific views. It supports volcano-style x/logFC and y/-log10(p) payloads, UMAP/PCA/t-SNE coordinates, and simple Plotly scatter traces.

## 何时不要使用该组件
Do not use it for dense matrices, graph topology, or publication figure layout.
