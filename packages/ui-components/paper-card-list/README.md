# @bioagent-ui/paper-card-list

## Agent quick contract
- componentId: `paper-card-list`
- accepts: `paper-list`
- requires any of: `papers`, `rows`
- outputs: `paper-list`
- events: `select-paper`, `select-target`
- fallback: `generic-data-table`, `generic-artifact-inspector`
- safety: no code execution, declared external resources only

## Human notes
Use this package only when the current user asks for paper search, paper comparison, or a literature list. Do not generate paper-list just because the active scenario is literature-oriented.
