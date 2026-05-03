# @sciforge-ui/paper-card-list

## Agent quick contract
- componentId: `paper-card-list`
- accepts: `paper-list`
- requires: one of `papers` or `rows`
- outputs: `paper-list`
- events: `select-paper`, `select-target`
- fallback: `generic-data-table`, `generic-artifact-inspector`
- safety: no code execution; declared external resources only
- demo fixtures: `fixtures/basic.ts`, `fixtures/empty.ts`, `fixtures/selection.ts`
- primitive/preset: `claim-evidence` literature evidence-list preset over record-set-like paper rows

## Human notes

### Data schema
Expected data is `artifact.data.papers[]` or `artifact.data.rows[]`; each item should include stable id when available, title, source, year, authors, evidenceLevel, target, and url.

### Interaction/edit output semantics
`select-paper` and `select-target` emit stable refs for downstream preview and filtering. URLs are display/navigation metadata only; the renderer must not fetch external resources during preview.

### Performance/resource limits
Keep cards concise and use declared refs for full text, PDFs, or external resources.

### When not to use
Do not use it for decorative bibliography summaries, generic tables, narrative reports, or generated citations that have not been resolved to real papers.

### Testing/publishing notes
Test basic, empty, and selection fixtures once package checks cover fixture loading.
