# @sciforge-ui/unknown-artifact-inspector

## Agent quick contract
- componentId: `unknown-artifact-inspector`
- accepts: `*`
- requires: any artifact, ref, file, log, JSON, metadata object, or unsupported payload
- outputs: none
- events: `open-ref`
- fallback: none
- safety: no code execution; no external resources; final safe fallback for inspection only
- demo fixtures: `fixtures/basic.ts`, `fixtures/empty.ts`, `fixtures/selection.ts`
- primitive/preset: none; safe fallback inspector, not a planner primitive

## Human notes

### Data schema
Accepts arbitrary `artifact.data`, `slot.props`, metadata, dataRef, and execution refs. Row-like payloads may display as compact tables; other payloads display as formatted JSON/ref chips.

### Interaction/edit output semantics
`open-ref` asks the host to preview safe refs. The inspector must not infer domain semantics, execute code, parse unsafe content, or fetch undeclared resources.

### Performance/resource limits
Keep previews compact and conservative. Unsupported binary descriptors should show metadata and refs only.

### When not to use
Do not select it when a registered component clearly accepts the artifact type, and do not use it to avoid creating a proper domain primitive for stable scientific data.

### Testing/publishing notes
Cover arbitrary JSON, row-like payloads, empty payloads, dataRef/codeRef/log refs, and unsupported descriptors.
