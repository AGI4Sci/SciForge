# @bioagent-ui/network-graph

## Agent quick contract
- componentId: `network-graph`
- accepts: `knowledge-graph`
- requires: `nodes`, `edges`
- outputs: `knowledge-graph`
- events: `select-node`, `select-edge`
- fallback: `generic-data-table`, `generic-artifact-inspector`
- safety: no code execution, no external resources

## Human notes
Use this package for entity and relationship exploration. Nodes and edges should be normalized and carry stable ids so selections can round-trip into object references.
