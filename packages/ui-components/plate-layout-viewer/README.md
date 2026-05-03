# @sciforge-ui/plate-layout-viewer

## Agent quick contract
- componentId: `plate-layout-viewer`
- accepts: `plate-layout`, `editable-design`, `assay-layout`, `well-map`, `screen-design`
- requires: one of `plate`, `wells`, `rows`, `columns`, `format`, or `designType`
- outputs: `editable-design`, `plate-layout`, `record-set`
- events: `select-well`, `edit-well`, `assign-condition`, `export-layout`
- fallback: `schema-form-editor`, `generic-data-table`, `generic-artifact-inspector`
- safety: no code execution; no external resources
- demo fixtures: `fixtures/basic.ts`, `fixtures/empty.ts`, `fixtures/selection.ts`
- primitive/preset: `editable-design` plate-layout profile

## Human notes

### Data schema
Payloads should include plate format, row/column counts, well ids, sample names, conditions, replicate numbers, and optional measurements or QC flags.

### Interaction/edit output semantics
Selection emits well id. Edit/assign/export events are design patch or export intents and should produce editable-design, plate-layout, or record-set artifacts.

### Performance/resource limits
This skeleton does not implement drag/drop editing or robotic liquid-handler export. Keep well metadata compact and deterministic.

### When not to use
Do not use it for arbitrary tables, spatial tissue maps, protocol text, or dose-response plots.

### Testing/publishing notes
Keep `fixtures/basic.ts`, `fixtures/empty.ts`, and `fixtures/selection.ts` present and aligned with manifest `workbenchDemo`.
