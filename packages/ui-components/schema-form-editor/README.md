# @sciforge-ui/schema-form-editor

## Agent quick contract
- componentId: `schema-form-editor`
- accepts: `editable-design`, `schema-form`, `json-schema`, `form-artifact`, `parameter-set`
- requires: one of `schema`, `jsonSchema`, `uiSchema`, `formData`, `body`, or `designType`
- outputs: `editable-design`, `schema-form`, `record-set`
- events: `change-field`, `validate-form`, `submit-form`, `open-schema-ref`
- fallback: `generic-artifact-inspector`, `generic-data-table`
- safety: sandboxed; no code execution; remote schemas or assets must be declared refs
- demo fixtures: `fixtures/basic.ts`, `fixtures/empty.ts`, `fixtures/selection.ts`
- primitive/preset: `editable-design` schema-form profile

## Human notes

### Data schema
Artifacts should include JSON Schema-compatible `schema` or `jsonSchema`, optional `uiSchema`, current `formData`, revision metadata, and a clear design/form id.

### Interaction/edit output semantics
Change/validate/submit events are edit intents that should emit artifact patches or validated form artifacts. Validation must be declarative and must not execute arbitrary JavaScript.

### Performance/resource limits
Remote schemas or assets must be declared refs. Avoid large embedded schemas when a workspace ref plus preview fields is enough.

### When not to use
Do not use it for freeform documents, spreadsheet-like tables, notebook execution, code editors, or forms requiring arbitrary JavaScript validation.

### Testing/publishing notes
Fixtures should cover valid form data, empty/missing schema, and changed field or submit state. Publish fixtures with README.
