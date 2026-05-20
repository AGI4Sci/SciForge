# SciForge Web Reproduction Runbook

This runbook defines the browser-facing scientific reproduction loop used by the `scientific-reproduction-loop` skill and its replayable trajectory export.

## Scope

Use this workflow when a user asks SciForge to reproduce, audit, or partially verify a scientific result through the web UI. The run must start from the user-visible SciForge workspace, preserve refs instead of raw local paths, and export a replayable `sciforge.scientific-reproduction-trajectory.v1` record.

## Loop

Each replayable step records:

- `state/action/observation`: the visible workspace state, the user or agent action, and the resulting observation.
- `Computer Use`: screen refs and GUI perception evidence when a browser or desktop action is part of the proof.
- Artifact lineage: selected paper refs, dataset refs, analysis-plan refs, execution-unit refs, and verifier refs.
- `repairHistory`: bounded repair attempts for product failures, with failure reasons and changed refs.
- `selfPromptRecommendations`: next prompts that remain human-reviewed unless schema, verifier, refs, budget, stop condition, and human confirmation all allow auto-submit.

## Pass Boundaries

Scientific negative results are not product failures. Missing raw data, license limits, compute limits, unavailable provider responses, or verifier rejection should produce partial or blocked artifacts with evidence refs. They must not be converted into a successful reproduction claim.

Product failures can enter repair only when the run has a bounded target, a failing artifact or execution-unit ref, and a rerunnable validation command. Repeated failures, missing evidence, unresolved refs, raw download requirements, or exceeded compute budget must stop automatic continuation.

## Export Requirements

The exported trajectory must:

- Use refs such as `artifact:`, `workspace-file:`, `trace:`, `screen:`, `execution-unit:`, `audit:`, or `ledger:`.
- Redact secrets and machine-local absolute paths.
- Keep raw screenshots, raw provider output, and raw logs folded into audit refs rather than primary prose.
- Preserve human confirmation points for any self-prompt continuation.
- Include enough state/action/observation evidence to replay the decision path without embedding full raw datasets or PDFs.
