# @sciforge-ui/spatial-omics-viewer

## Agent quick contract
- componentId: `spatial-omics-viewer`
- accepts: `spatial-map`, `spatial-omics`, `visium-spots`, `cell-coordinates`, `tissue-expression-map`
- requires: one of `spots`, `cells`, `coordinates`, `imageRef`, `features`, `expression`, or `dataRef`
- outputs: `spatial-map`, `point-set`, `visual-annotation`
- events: `select-spot`, `select-cell`, `select-region`, `change-feature`
- fallback: `scientific-plot-viewer`, `generic-data-table`, `generic-artifact-inspector`
- safety: sandboxed; tissue images and large matrices must be declared refs; no code execution
- demo fixtures: `fixtures/basic.ts`, `fixtures/empty.ts`, `fixtures/selection.ts`
- primitive/preset: `spatial-map` primitive with point-set and visual-annotation projections

## Human notes

### Data schema
Payloads should include sample identity, spot/cell coordinates, optional tissue image ref, feature list, expression preview, and dataRef for full expression matrices.

### Interaction/edit output semantics
Spot/cell/region events emit stable ids and coordinates. Feature changes update the viewed overlay and may produce visual annotation or point-set projections.

### Performance/resource limits
No large scatter rendering, image tiling, or matrix loading is bundled in this skeleton. Use refs for tissue images and full matrices.

### When not to use
Do not use it for ordinary UMAP/PCA scatter plots, generic images, plate layouts, or non-spatial expression matrices.

### Testing/publishing notes
Keep `fixtures/basic.ts`, `fixtures/empty.ts`, and `fixtures/selection.ts` present and aligned with manifest `workbenchDemo`.
