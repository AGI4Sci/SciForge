# @sciforge-ui/notebook-timeline

## Agent quick contract
- componentId: `notebook-timeline`
- accepts: `*`
- requires: timeline, decision, notebook, or provenance events
- outputs: `notebook-timeline`
- events: `select-timeline-event`
- fallback: `generic-artifact-inspector`
- safety: no code execution; no external resources; displays audit records and refs only
- demo fixtures: `fixtures/basic.ts`, `fixtures/empty.ts`, `fixtures/selection.ts`
- primitive/preset: `workflow-provenance` research-notebook timeline preset

## Human notes

### Data schema
Preferred data is `{ events }`; each event has id, time, scenario, title, desc, claimType, confidence, artifactRefs, executionUnitRefs, beliefRefs, dependencyRefs, and updateReason.

### Interaction/edit output semantics
`select-timeline-event` emits event id and linked refs. The timeline preserves chronology and auditability; it should not rewrite history or summarize away key refs.

### Performance/resource limits
Keep event bodies concise and use refs for long artifacts/logs. No external fetches or code execution.

### When not to use
Do not emit it by default for every answer, and do not use it for evidence comparison, execution logs, or tabular result exploration.

### Testing/publishing notes
Cover empty, chronological multi-event, cross-scenario refs, and selected-event variants with explicit timestamps.
