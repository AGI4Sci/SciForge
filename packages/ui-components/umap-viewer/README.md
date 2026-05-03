# @bioagent-ui/umap-viewer

## Agent quick contract
- componentId: `umap-viewer`
- accepts: `omics-differential-expression`
- requires: `umap`
- outputs: `omics-differential-expression`
- events: `select-cluster`
- fallback: `generic-data-table`
- safety: no code execution, no external resources

## Human notes
Use this package for single-cell or embedding-coordinate exploration. Artifacts should include stable cluster/cell identifiers when selections need to be referenced later.
