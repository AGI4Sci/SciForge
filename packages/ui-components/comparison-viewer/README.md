# @sciforge-ui/comparison-viewer

## Agent quick contract
- componentId: `comparison-viewer`
- accepts: `artifact-diff`, `comparison-summary`, `record-set-diff`, `schema-diff`, `text-diff`, `model-comparison`
- requires: one of `base`, `candidate`, `changes`, `diff`, `left`, `right`, or `summary`
- outputs: `artifact-diff`, `comparison-summary`
- events: `select-change`, `open-left-ref`, `open-right-ref`, `accept-change`
- fallback: `generic-data-table`, `generic-artifact-inspector`
- safety: no code execution; compared artifacts and large diff bodies must be declared refs
- demo fixtures: `fixtures/basic.ts`, `fixtures/empty.ts`, `fixtures/selection.ts`
- primitive/preset: structured artifact diff over document, record-set, schema, model, or design artifacts

## Human notes

### Data schema
Payloads should include left/right labels or refs, a concise summary count, and structured `changes` with path, kind, before/after values, and optional severity.

### Interaction/edit output semantics
`select-change` anchors a diff row or region; open-ref events delegate left/right artifact previews to the host. `accept-change` is an edit intent that should emit a patch proposal, not mutate source artifacts inside the renderer.

### Performance/resource limits
Keep large raw diffs behind refs and provide a concise preview. Avoid rendering heavyweight side-by-side documents until a dedicated diff engine exists.

### When not to use
Do not use it for multi-run dashboards, statistical hypothesis testing, arbitrary tables, or automated conflict resolution.

### Testing/publishing notes
Fixture variants must cover added/changed rows, empty diffs, and selected-change state. Publish fixtures and README together.
