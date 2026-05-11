# SciForge Web Reproduction Runbook

This runbook defines a generic web and Computer Use workflow for scientific reproduction attempts. It supports PROJECT R001, R011, and R013: human-like UI operation, trajectory export, repair history, and self-prompt recommendations.

## Scope

Use this for any paper or research question where SciForge should be operated through the web UI first. The runbook records what a researcher saw, did, asked, inspected, repaired, and concluded. It does not define a new browser automation implementation.

## Preconditions

- SciForge UI is reachable, usually `http://127.0.0.1:5173/`.
- Workspace writer is reachable, usually `http://127.0.0.1:5174/`.
- The active workspace path is configured in SciForge settings.
- `local.vision-sense` or the Computer Use action provider can produce screenshot, window, action, and trace refs when GUI actions are used.
- Paper PDFs, supplementary files, datasets, and generated outputs are stored as workspace refs or artifacts.

## Human-Like Operation Sequence

1. Open the SciForge web UI and capture the initial screen state.
2. Confirm the workspace and backend configuration. Record workspace/session refs.
3. Select the scenario and attach paper or data refs through the UI.
4. Submit a natural research prompt that names the topic and selected refs.
5. Wait for the backend stream and record visible progress, execution units, artifacts, logs, and validation failures.
6. Open generated artifacts from the UI, inspect them, and capture before/after screen refs for meaningful mouse or keyboard actions.
7. Ask follow-up prompts that a researcher would naturally ask: clarify claims, find datasets, check methods, run analysis, test counterevidence, or request a verdict.
8. When a failure occurs, classify it before repair:
   - Product capability failure: UI/backend/tool/schema/runtime issue that needs a generic fix and retest.
   - Blocked missing evidence: data, code, accession, or license is unavailable; create a structured missing-data result.
   - Scientific negative result: available evidence fails to support, partially supports, or contradicts the paper claim.
9. After a generic repair, replay the same class of UI action and record the retest refs.
10. Stop only when the attempt has a verdict, a structured partial/negative result, or a blocked state with explicit missing evidence.

## Generic Web Retest Packet

Use this packet after any generic repair that touches contracts, validators, verifier behavior, artifact preservation, PDF/data extraction, progress reporting, or view manifests. It intentionally avoids paper-specific expectations so the same packet can be reused for biology, chemistry, physics, social science, or methods papers.

### Retest Checklist

1. Start from a fresh chat in the web UI and record the current URL, scenario name, workspace ref, backend profile, and initial screenshot ref.
2. Select one or more paper/data refs through the UI. Do not paste full PDFs or large tables into the prompt.
3. Submit the baseline prompt template below with only bracketed fields replaced.
4. While the run streams, record whether the UI exposes stage names, progress, validation failures, repair attempts, partial artifacts, and cancel/continue controls.
5. Open every produced artifact from the UI, not from the filesystem, and record whether it can be inspected, referenced in follow-up prompts, and exported or linked by ref.
6. If validation fails, confirm the UI still exposes a structured partial/failure artifact with diagnostic refs instead of only a chat error.
7. Ask one follow-up prompt that cites the produced refs and requests a narrower next step, such as data discovery, one-figure reproduction, counterevidence, or final verdict.
8. Classify the outcome as operational success, product capability failure, blocked missing evidence, scientific partial result, or scientific negative result.
9. Export or locate the trajectory record and verify it includes screen/action refs, prompts, selected refs, generated code refs, stdout/stderr refs, artifacts, verifier findings, and repair history.
10. Update `PROJECT.md` with the retest date, paper/topic, outcome class, artifact refs, remaining generic gaps, and whether the repair passed M4.

### Baseline Prompt Template

```text
I want to reproduce or critically test the main conclusions of [paper/topic] using the selected workspace refs: [paper refs, data refs, or supplement refs].

Operate refs-first: do not paste full documents into the prompt. First produce structured artifacts that a verifier can check:

1. paper-claim-graph: at least 5 checkable claims when the source supports that many, each with locator, evidence type, method/data dependency, and uncertainty.
2. figure-to-claim-map: key figures or tables mapped to claims and required data/analysis steps.
3. dataset-inventory: accessions, links, supplements, code refs, processed data alternatives, licenses, and missing evidence.
4. analysis-plan: the smallest reproducible computation for one high-value claim, including required inputs, parameters, expected outputs, and failure fallbacks.
5. evidence-matrix and claim-verdict draft: use reproduced, partially-reproduced, not-reproduced, contradicted, or blocked-missing-evidence.

If extraction, data access, validation, or execution fails, keep partial outputs as structured artifacts with diagnostic refs. Do not turn an operational failure into a scientific verdict, and do not turn a scientific negative result into a repair request.
```

### Follow-Up Prompt Template

```text
Using the artifact refs from the previous turn, continue one concrete reproduction step: [claim id, figure/table id, dataset id, or counterevidence check].

Keep the same schemas. Show which refs are reused, which new refs are created, and what would change the verdict. If the data or method is unavailable, return a missing-data or negative-result artifact instead of summarizing around the gap.
```

### Expected Artifact Gates

- `paper-claim-graph`: claims are arrays, each claim has a stable id, locator, evidence refs or explicit missing evidence, and no full-document text copy.
- `figure-to-claim-map`: every mapped figure/table points to claim ids and required data/analysis steps; absent figure access is recorded as missing evidence.
- `dataset-inventory`: each source has provenance, availability, access method, assay/data type, license or access note, and download/runtime risk.
- `analysis-plan`: one minimal executable path is described with inputs, parameters, outputs, budget assumptions, and fallback behavior.
- `figure-reproduction-report`: code, inputs, parameters, stdout/stderr, produced figures/tables, and statistics are linked by ref.
- `evidence-matrix`: each claim is connected to supporting, weakening, missing, or contradictory evidence.
- `claim-verdict`: verdict vocabulary is controlled and distinguishes operational failure from scientific outcome.
- `negative-result-report`: contains the check motivation, data/code/statistics used, limitations, and impact on the original claim.
- `trajectory-training-record`: state/action/observation steps are ordered and replayable without chat memory.

### Retesting the Known Failure Class

The 2026-05-11 UI attempt exposed a generic failure class: task execution produced partial scientific work but failed the ToolPayload envelope and artifact shape validation, while PDF extraction errors were opaque. Any repair claiming to address this class must pass these checks from the web UI:

- A malformed or repair-needed backend result is visible as a structured product failure with diagnostic refs.
- Partial scientific artifacts, if any were produced before failure, remain openable and referenceable from the UI.
- `artifacts`, `claims`, and `uiManifest` payload fields validate as arrays when present.
- Missing `message` or invalid envelope shape is reported through validation/repair/audit, not hidden as a generic unknown error.
- PDF or document extraction failure includes source ref, stage name, failing operation, and enough diagnostic context to decide whether to retry, use a processed source, or emit missing evidence.
- A follow-up prompt can cite the partial/failure artifact refs and continue or narrow the reproduction attempt.

## Trajectory Export Contract

Export one `ScientificReproductionTrajectory` per attempt. The TypeScript scaffold lives in `packages/skills/pipeline_skills/scientific-reproduction-loop`.

Required top-level fields:

- `schemaVersion`: `sciforge.scientific-reproduction-trajectory.v1`.
- `attemptRef`, `runbookRef`, and `workspaceRef`.
- `subject` with title, topic/scenario when known, and paper refs.
- `actors` for operator, SciForge backend, and Computer Use/vision bridge when used.
- `steps` in timestamp order.
- `repairHistory`.
- `selfPromptRecommendations`.
- `finalVerdict`.
- `exportNotes` with redaction policy and replay instructions.

Each step should carry:

- `prompt`: role, text, selected refs, and intent when the step includes a user or self-prompt.
- `action`: modality, command, target/input summary, before/after screen refs, and trace refs.
- `observation`: summary, tool result refs, artifact refs, stdout/stderr refs when available.
- `rationale`: why the next research move was chosen.
- `repair`: symptom, diagnosis, repair action, retest refs, and outcome.
- `selfPromptRecommendation`: next prompt, required refs, stop condition, quality gate, and mode.

## Self-Prompt Recommendations

Self-prompt recommendations start in `shadow-only` mode. They can be shown to a human reviewer but should not automatically submit new turns until they repeatedly satisfy these gates:

- The prompt cites required refs instead of relying on chat memory.
- The stop condition prevents infinite loops.
- The quality gate demands evidence refs and a clear distinction between product failure and scientific negative result.
- The recommendation advances one concrete research objective: reading, planning, data discovery, computation, verification, counterevidence, or verdict.

## Redaction and Replay

Before export:

- Replace local absolute paths with workspace refs.
- Remove API keys, auth tokens, secrets, and private temporary filenames.
- Store screenshots, logs, notebooks, and large data as file/artifact refs.
- Keep enough locator detail to replay the attempt without chat history.

Replay should resolve refs from `.sciforge/workspace-state.json`, task attempts, artifact storage, trace files, and capability-evolution ledgers. If a ref cannot be resolved, replay should fail with a missing-ref diagnostic rather than silently using memory.
