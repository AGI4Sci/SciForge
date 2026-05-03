# @bioagent-ui/execution-unit-table

## Agent quick contract
- componentId: `execution-unit-table`
- accepts: `*`
- requires: execution refs, code refs, log refs, or status records
- outputs: none
- events: `open-code-ref`, `open-log-ref`
- fallback: `generic-artifact-inspector`
- safety: no code execution, no external resources

## Human notes
Use this package for reproducibility and provenance. It presents existing execution records; it should not imply that a run succeeded unless the runtime status says so.
