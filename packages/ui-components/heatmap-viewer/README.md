# @bioagent-ui/heatmap-viewer

## Agent quick contract
- componentId: `heatmap-viewer`
- accepts: `omics-differential-expression`
- requires: `heatmap`
- outputs: `omics-differential-expression`
- events: `select-gene-set`
- fallback: `generic-data-table`
- safety: no code execution, no external resources

## Human notes
Use this package for matrix-style omics summaries. The artifact should include row/column labels and enough metadata for filtering or grouping.
