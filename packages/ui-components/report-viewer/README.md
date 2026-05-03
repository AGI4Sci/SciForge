# @sciforge-ui/report-viewer

## Agent quick contract
- componentId: `report-viewer`
- accepts: `research-report`, `markdown-report`
- requires: one of `markdown`, `sections`, `report`, `summary`, `content`, or `dataRef`
- outputs: `research-report`
- events: `select-section`, `open-ref`
- fallback: `generic-artifact-inspector`
- safety: no code execution; no external resources; markdown is rendered as document content, not executed
- demo fixtures: `fixtures/basic.ts`, `fixtures/empty.ts`, `fixtures/selection.ts`
- primitive/preset: `document` primitive, markdown-report preset

## Human notes

### Data schema
Preferred payload is `{ title?, markdown?, sections?, references? }`; `sections` should include id, title, content or markdown. Use dataRef/reportRef/markdownRef/path for external document bodies.

### Interaction/edit output semantics
`select-section` emits section id/title; `open-ref` delegates reference preview to the host. The renderer does not execute notebooks or edit document content.

### Performance/resource limits
Large source files should stay as workspace refs. Keep inline markdown compact enough for Workbench preview.

### When not to use
Do not use this for raw JSON inspection, execution logs, evidence comparison, or decorative summaries that duplicate the assistant message without an artifact contract.

### Testing/publishing notes
Smoke-test markdown, sectioned, ref-only, empty, and selection states. Publish fixtures with the package.
