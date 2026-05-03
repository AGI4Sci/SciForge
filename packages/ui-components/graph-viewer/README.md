# @sciforge-ui/graph-viewer

## Agent quick contract
- componentId: `graph-viewer`
- accepts: `graph`, `knowledge-graph`, `network-graph`, `pathway-graph`, `ppi-graph`, `workflow-dag`
- requires: `nodes`, `edges`
- outputs: `graph`, `knowledge-graph`
- events: `select-node`, `select-edge`
- fallback: `record-table`, then `generic-artifact-inspector`
- safety: no code execution, no external resources
- demo fixtures: `fixtures/basic.ts`, `fixtures/empty.ts`, `fixtures/selection.ts`
- replacement route: supersedes `network-graph`; historical `network-graph` remains an alias during migration

## Human notes
Use this package for typed node/edge artifacts. The renderer provides a deterministic dependency-light topology preview and edge table, suitable for Workbench and runtime artifact previews.

## 何时不要使用该组件
Do not use it for ordinary tables, embeddings, molecular structures, or evidence matrices where claim/evidence semantics matter more than topology.
