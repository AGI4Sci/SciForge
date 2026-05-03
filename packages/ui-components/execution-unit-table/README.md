# @sciforge-ui/execution-unit-table

## Agent quick contract
- componentId: `execution-unit-table`
- accepts: `*`
- requires: execution units, code refs, log refs, output refs, status records, or workflow provenance
- outputs: none
- events: `open-code-ref`, `open-log-ref`
- fallback: `generic-artifact-inspector`
- safety: no code execution; no external resources; refs are displayed or opened by host policy only
- demo fixtures: `fixtures/basic.ts`, `fixtures/empty.ts`, `fixtures/selection.ts`
- primitive/preset: `workflow-provenance` execution-unit table preset

## Human notes

### Data schema
Preferred data is `{ executionUnits }` with id, tool, params, status, hash, language, codeRef, stdoutRef, stderrRef, outputRef, environment, dataFingerprint, and databaseVersions.

### Interaction/edit output semantics
`open-code-ref` and `open-log-ref` request host previews of immutable refs. The table reports recorded provenance and has no edit output semantics.

### Performance/resource limits
Display concise execution metadata and refs. Do not execute code, rerun jobs, or fetch undeclared log/code resources.

### When not to use
Do not use it for ordinary result rows, literature evidence, narrative reports, or as a default companion artifact when no execution actually occurred.

### Testing/publishing notes
Cover successful, record-only, failed/repair-needed, empty, and selected-ref states. Keep refs as workspace-style strings.
