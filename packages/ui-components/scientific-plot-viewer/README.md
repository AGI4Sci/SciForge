# @sciforge-ui/scientific-plot-viewer

## Agent quick contract
- componentId: `scientific-plot-viewer`
- accepts: `plot-spec`, `point-set`, `matrix`, `record-set`, `time-series`
- requires: Plotly-compatible JSON with `data`, `layout`, `config`, `frames`, `selection`, or `exportProfile`; primitive inputs should normalize into a Plotly-compatible `plotSpec`
- outputs: `plot-spec`, `figure-spec`, `plot-export-bundle`
- events: `select-point`, `select-region`, `hover-point`, `relayout`, `export-plot`
- fallback: `generic-data-table`, `generic-artifact-inspector`
- safety: no code execution; no external resources
- demo fixtures: `fixtures/basic.ts`
- primitive/preset: `plot-spec` primitive, Plotly-first renderer; may derive from point-set, matrix, record-set, or time-series

## Human notes

### Data schema
The editable artifact is Plotly-compatible JSON: `data` traces, `layout`, `config`, optional `frames`, `selection`, annotations, and `exportProfile`. `figure-spec` and export bundles should reference the source plot spec.

### Interaction/edit output semantics
Selection, hover, relayout, and export events patch or reference the Plotly-compatible spec. Matplotlib is allowed only as a derived fallback/advanced publication export with source plotSpecRef, script/output refs, renderer versions, and purpose metadata.

### Performance/resource limits
This package is a lightweight contract/smoke renderer and should not bundle heavyweight plotting runtimes in this phase. Large data should remain behind refs or be downsampled with explicit metadata.

### When not to use
Do not make static images or Matplotlib scripts the main editing state, and do not use arbitrary chart JSON that cannot be normalized to Plotly-compatible shape.

### Testing/publishing notes
Only `fixtures/basic.ts` currently exists; README must not claim empty/selection fixtures until they are added. Scientific plot demos should remain Plotly-first, with Matplotlib examples marked derived exports.
