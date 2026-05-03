# @sciforge-ui/time-series-viewer

## Agent quick contract
- componentId: `time-series-viewer`
- accepts: `time-series`, `growth-curve`, `sensor-trace`, `longitudinal-measurement`, `plot-spec`
- requires: one of `series`, `points`, `time`, `timestamps`, `rows`, or `dataRef`
- outputs: `time-series`, `plot-spec`
- events: `select-time-window`, `hover-point`, `select-series`, `export-plot`
- fallback: `scientific-plot-viewer`, `generic-data-table`, `generic-artifact-inspector`
- safety: no code execution; no external resources
- demo fixtures: `fixtures/basic.ts`, `fixtures/empty.ts`, `fixtures/selection.ts`
- primitive/preset: `time-series` primitive; Plotly-compatible `plot-spec` projection for charts

## Human notes

### Data schema
Payloads should include named series, units, explicit `timeUnit`, and points with `t` plus `value`; missing values may be `null`.

### Interaction/edit output semantics
Window/point/series events emit time ranges and series names for linked filtering. Exports should produce Plotly-compatible plot-spec artifacts first; Matplotlib is only derived if routed through scientific plotting export.

### Performance/resource limits
For large traces, pass a downsampled preview inline and keep the full signal behind `dataRef`.

### When not to use
Do not use it for unordered scatter plots, static publication figures, survival curves with censoring semantics, dense matrices, or event timelines/provenance logs.

### Testing/publishing notes
Fixtures should cover multiple series, empty data, and selected time window or series.
