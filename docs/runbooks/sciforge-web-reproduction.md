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
