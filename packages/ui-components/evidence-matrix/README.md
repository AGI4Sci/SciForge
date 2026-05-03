# @bioagent-ui/evidence-matrix

## Agent quick contract
- componentId: `evidence-matrix`
- accepts: `evidence-matrix`, `paper-list`, `structure-summary`, `knowledge-graph`, `omics-differential-expression`, `research-report`
- requires: claim/evidence rows when artifact type is `evidence-matrix`
- outputs: `evidence-matrix`
- events: `select-claim`
- fallback: `generic-artifact-inspector`
- safety: no code execution, no external resources

## Human notes
Use this package when a claim/evidence comparison is part of the user's actual goal. It should not be auto-generated as a scenario decoration.
