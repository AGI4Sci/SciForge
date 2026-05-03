# @sciforge-ui/publication-figure-builder

## Agent quick contract
- componentId: `publication-figure-builder`
- accepts: `figure-spec`, `plot-spec`, `publication-figure`, `plot-export-bundle`, `visual-annotation`
- requires: one of `figure`, `panels`, `layout`, `exportProfile`, `plotSpec`, or `dataRef`
- outputs: `figure-spec`, `plot-spec`, `export-artifact`
- events: `select-panel`, `edit-panel-label`, `update-export-profile`, `export-figure`
- fallback: `scientific-plot-viewer`, `report-viewer`, `generic-artifact-inspector`
- safety: sandboxed; external panel assets must be declared refs; no code execution
- demo fixtures: `fixtures/basic.ts`, `fixtures/empty.ts`, `fixtures/selection.ts`
- primitive/preset: `figure-spec` primitive with Plotly-compatible panel specs and export-artifact outputs

## Human notes

### Data schema
Panels should carry Plotly-compatible `plotSpec` payloads or refs, figure dimensions, panel labels, annotations, export profile, and export QA metadata such as format, DPI, font, color space, and vector/raster status.

### Interaction/edit output semantics
Panel selection and label/profile edits patch the `figure-spec`. `export-figure` produces `export-artifact` refs. Plotly-compatible `plot-spec`/`figure-spec` is the source of truth; Matplotlib is only a derived fallback or advanced publication export with source spec refs.

### Performance/resource limits
This skeleton does not implement canvas layout editing or static export. External panel assets must be declared refs.

### When not to use
Do not use it for single exploratory charts, raw statistical results, report prose, or image annotation.

### Testing/publishing notes
Keep `fixtures/basic.ts`, `fixtures/empty.ts`, and `fixtures/selection.ts` present and aligned with manifest `workbenchDemo`. Publication demos must remain Plotly-first and mark Matplotlib exports as derived.
