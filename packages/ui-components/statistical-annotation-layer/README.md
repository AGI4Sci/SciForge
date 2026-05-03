# @sciforge-ui/statistical-annotation-layer

## Agent quick contract
- componentId: `statistical-annotation-layer`
- accepts: `statistical-result`, `visual-annotation`, `plot-spec`, `figure-spec`, `comparison-summary`
- requires: one of `annotations`, `tests`, `pValue`, `effectSize`, `confidenceInterval`, or `target`
- outputs: `statistical-result`, `visual-annotation`
- events: `select-annotation`, `edit-label`, `toggle-annotation`, `open-stat-result-ref`
- fallback: `scientific-plot-viewer`, `generic-data-table`, `generic-artifact-inspector`
- safety: no code execution; no external resources
- demo fixtures: `fixtures/basic.ts`, `fixtures/empty.ts`, `fixtures/selection.ts`
- primitive/preset: `statistical-result` overlay represented as `visual-annotation` over Plotly-compatible plot/figure specs

## Human notes

### Data schema
Payloads should link each annotation to a plot, figure panel, group pair, or visual target, and include test name, sample size, multiple-testing method, p value, adjusted p value, effect size, confidence interval, and result refs when available.

### Interaction/edit output semantics
Annotation selection/toggle/label edits patch visual-annotation metadata only. The layer displays declared statistical results and must not compute tests. Plotly-compatible `plot-spec`/`figure-spec` remains the source; Matplotlib output is derived export metadata only.

### Performance/resource limits
Do not compute statistics, fetch resources, or render annotations disconnected from a declared target.

### When not to use
Do not use it to run tests, replace a statistical report, or decorate charts without real statistical results.

### Testing/publishing notes
Keep `fixtures/basic.ts`, `fixtures/empty.ts`, and `fixtures/selection.ts` present and aligned with manifest `workbenchDemo`. Statistical publication examples should be Plotly-first with Matplotlib marked derived.
