# @sciforge-ui/prediction-reviewer

## Agent quick contract
- componentId: `prediction-reviewer`
- accepts: `prediction-set`, `prediction-review`, `model-artifact`, `ai-predictions`, `record-set`
- requires: one of `predictions`, `rows`, `reviews`, `model`, `predictionRef`, or `dataRef`
- outputs: `prediction-review`, `record-set`, `claim-evidence`
- events: `accept-prediction`, `reject-prediction`, `request-review`, `edit-label`, `open-evidence-ref`
- fallback: `model-eval-viewer`, `generic-data-table`, `generic-artifact-inspector`
- safety: no code execution; evidence refs and prediction files must be declared refs
- demo fixtures: `fixtures/basic.ts`, `fixtures/empty.ts`, `fixtures/selection.ts`
- primitive/preset: human-reviewed prediction `record-set` with optional `claim-evidence` output

## Human notes

### Data schema
Artifacts should include model identity, prediction rows, confidence, review status, optional evidence refs, reviewer feedback, and dataRef for large prediction sets.

### Interaction/edit output semantics
Accept/reject/request-review/edit-label events are human review intents that should output prediction-review rows or patches. The component must not run inference or modify model checkpoints.

### Performance/resource limits
Keep inline prediction samples small and put large prediction files behind declared refs.

### When not to use
Do not use it for aggregate model metrics, training dashboards, generic tables, or automated approval.

### Testing/publishing notes
Keep `fixtures/basic.ts`, `fixtures/empty.ts`, and `fixtures/selection.ts` present and aligned with manifest `workbenchDemo`.
