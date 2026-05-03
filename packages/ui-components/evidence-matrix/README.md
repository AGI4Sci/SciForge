# @sciforge-ui/evidence-matrix

## Agent quick contract
- componentId: `evidence-matrix`
- accepts: `evidence-matrix`, `paper-list`, `structure-summary`, `knowledge-graph`, `omics-differential-expression`, `research-report`
- requires: claim/evidence rows or session `claims` with support/opposition refs
- outputs: `evidence-matrix`
- events: `select-claim`
- fallback: `generic-artifact-inspector`
- safety: no code execution; no external resources; only displays declared artifact/session refs
- demo fixtures: `fixtures/basic.ts`, `fixtures/empty.ts`, `fixtures/selection.ts`
- primitive/preset: `claim-evidence` primitive, matrix preset

## Human notes

### Data schema
Preferred artifacts carry `{ claimSetId?, rows }`; each row maps to a claim with id, text, type, confidence, evidenceLevel, supportingRefs, opposingRefs, dependencyRefs, and updateReason.

### Interaction/edit output semantics
`select-claim` emits the claim id and linked evidence refs. The component compares support/opposition/uncertainty and may output evidence-matrix artifacts, but must not invent claims or upgrade evidence levels.

### Performance/resource limits
Keep evidence rows compact and use refs for long papers, reports, and supporting artifacts. No external evidence fetching in preview.

### When not to use
Do not add an evidence matrix as scenario decoration when the user only asked for a plain report, raw table, code result, or visual preview.

### Testing/publishing notes
Cover no-claim, claim-only, uploaded-evidence, and selected-claim fixtures before publishing.
