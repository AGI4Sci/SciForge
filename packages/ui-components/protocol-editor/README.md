# @sciforge-ui/protocol-editor

## Agent quick contract
- componentId: `protocol-editor`
- accepts: `protocol`, `editable-design`, `experimental-protocol`, `method-document`, `workflow-protocol`
- requires: one of `steps`, `materials`, `parameters`, `body`, `protocolId`, or `designType`
- outputs: `editable-design`, `document`, `workflow-provenance`
- events: `select-step`, `edit-step`, `edit-parameter`, `insert-step`, `export-protocol`
- fallback: `schema-form-editor`, `report-viewer`, `generic-artifact-inspector`
- safety: sandboxed; external SOP/material refs must be declared; no code execution
- demo fixtures: `fixtures/basic.ts`, `fixtures/empty.ts`, `fixtures/selection.ts`
- primitive/preset: `editable-design` protocol profile with document and workflow-provenance projections

## Human notes

### Data schema
Payloads should include stable step ids, ordered steps, materials, parameter values, safety notes, revision metadata, and optional execution status refs.

### Interaction/edit output semantics
Step and parameter edit events are patch intents. Export events may produce document or workflow-provenance artifacts, but the component is not an execution engine.

### Performance/resource limits
Do not run notebooks, protocols, or lab automation. Keep external SOP/material refs declared and preview only.

### When not to use
Do not use it for freeform manuscripts, plate maps, workflow provenance logs, or executable code.

### Testing/publishing notes
Keep `fixtures/basic.ts`, `fixtures/empty.ts`, and `fixtures/selection.ts` present and aligned with manifest `workbenchDemo`.
