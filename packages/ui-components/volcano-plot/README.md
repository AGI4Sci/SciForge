# @bioagent-ui/volcano-plot

## Agent quick contract
- componentId: `volcano-plot`
- accepts: `omics-differential-expression`
- requires: `points`
- outputs: `omics-differential-expression`
- events: `select-gene`
- fallback: `generic-data-table`
- safety: no code execution, no external resources

## Human notes
Use this package for differential expression effect-size/significance views. Keep point payloads bounded or paginated for large analyses.
