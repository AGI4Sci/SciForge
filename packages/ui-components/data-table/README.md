# @bioagent-ui/data-table

## Agent quick contract
- componentId: `data-table`
- accepts: `paper-list`, `structure-summary`, `knowledge-graph`, `omics-differential-expression`, `sequence-alignment`, `inspection-summary`, `research-report`, `runtime-artifact`
- requires: array-like rows, records, or table-compatible payload
- outputs: `data-table`
- events: `select-row`
- fallback: `generic-artifact-inspector`
- safety: no code execution, no external resources

## Human notes
Use this package as a safe table view for structured data. Large datasets should be summarized, paginated, or referenced by dataRef rather than embedded in full.
