---
name: scientific-reproduction-loop
description: Generic SciForge web/Computer-Use research reproduction workflow that exports replayable state/action/observation trajectories, repair history, artifact lineage, and self-prompt recommendations.
---

# Scientific Reproduction Loop

Use this pipeline skill when a research reproduction task should be operated through the SciForge web UI and exported as an audit/replay artifact.

## Boundaries

- Operate through the SciForge UI and selected backend contracts; do not bypass the product by calling internal scripts as the primary workflow.
- Use `local.vision-sense` and the Computer Use action provider only as ref-producing observe/action capabilities. This skill does not implement browser automation, DOM shortcuts, mouse control, or keyboard execution.
- Keep large objects refs-first: PDFs, screenshots, notebooks, stdout/stderr, trace JSON, and generated artifacts are stored in workspace files or artifacts and referenced compactly.
- Treat product capability failures and scientific negative results differently. Product failures can enter repair/retest; evidence-backed non-reproduction becomes a negative result.

## Run Loop

1. Open SciForge at the configured web entrypoint and capture a screen state ref.
2. Select or confirm the workspace and capture the workspace/session ref.
3. Upload or select paper/data refs through the UI. Record artifact refs, not absolute local paths.
4. Submit a human-like prompt with explicit selected refs and a short intent.
5. Observe the response stream, generated artifacts, execution units, stdout/stderr refs, verifier output, and visible UI state.
6. Inspect generated artifacts through the UI. Record mouse/keyboard actions and before/after screen refs.
7. Decide the next move with a rationale: ask a follow-up, change parameters, request missing data handling, run a verifier, or stop.
8. For failures, append a repair record with symptom, diagnosis, repair action, retest prompt, retest refs, and outcome.
9. Emit self-prompt recommendations in shadow mode until the recommendation quality gate is verified.
10. Export a `ScientificReproductionTrajectory` record and validate it with `validateScientificReproductionTrajectory`.

## Required Export Evidence

Every replayable attempt should include:

- `state/action/observation` steps with timestamps and stable ids.
- Human-like prompts, selected refs, and prompt intent.
- Screen state refs before and after meaningful UI actions.
- Computer Use trace refs from `local.vision-sense` or the action provider when GUI action was used.
- Artifact lineage refs for paper sources, plans, inventories, reports, notebooks, execution units, logs, and verdicts.
- Decision rationale for follow-up prompts, parameter changes, failure classification, or stopping.
- Repair history that distinguishes product capability failures, blocked missing evidence, and scientific negative results.
- Self-prompt recommendations with required refs, stop condition, quality gate, and mode.

## Redaction

Before export, run `sanitizeTrajectoryForExport`. The export must not contain local absolute paths, API keys, auth tokens, private temporary filenames, or raw screenshot bytes. Use workspace refs such as `artifact:*`, `trace:*`, `screen:*`, `workEvidence:*`, or `.sciforge` relative refs.

## TypeScript Contract

The reusable contract is exposed from:

```ts
import {
  buildSampleScientificReproductionTrajectory,
  sanitizeTrajectoryForExport,
  validateScientificReproductionTrajectory,
} from './index';
```

Use the sample trajectory as a fixture shape, not as a real research result.
