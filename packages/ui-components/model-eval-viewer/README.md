# @sciforge-ui/model-eval-viewer

## Agent quick contract
- componentId: `model-eval-viewer`
- accepts: `model-artifact`, `model-evaluation`, `classification-metrics`, `regression-metrics`, `model-report`
- requires: one of `model`, `metrics`, `roc`, `pr`, `confusionMatrix`, `evaluation`, or `predictionsRef`
- outputs: `model-artifact`, `statistical-result`, `plot-spec`
- events: `select-threshold`, `select-class`, `hover-curve-point`, `open-model-ref`
- fallback: `scientific-plot-viewer`, `generic-data-table`, `generic-artifact-inspector`
- safety: no code execution; checkpoints, configs, and prediction files must be declared refs
- demo fixtures: `fixtures/basic.ts`, `fixtures/empty.ts`, `fixtures/selection.ts`
- primitive/preset: `model-artifact` evaluation profile with `statistical-result` and Plotly-compatible `plot-spec` projections

## Human notes

### Data schema
Separate model identity from evaluation identity. Include dataset/split metadata, scalar metrics, ROC/PR coordinate arrays, confusion matrix data, and refs for checkpoints/configs/raw predictions.

### Interaction/edit output semantics
Threshold/class/curve events emit selection context for linked plots and tables. Evaluation charts should be Plotly-first; Matplotlib outputs are derived publication exports from the same plot spec, never the editing source of truth.

### Performance/resource limits
Do not load ML frameworks or raw prediction files inline. Keep predictions behind declared refs and show aggregate metrics/curves in preview.

### When not to use
Do not use it to train, tune, or execute models; do not use it for generic statistical tables without model identity.

### Testing/publishing notes
Fixtures must cover metrics, empty state, and selected threshold/class. Publication export examples should keep Plotly spec as source and mark Matplotlib as derived.
