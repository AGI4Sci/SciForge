# P6 Adversarial Browser Report

Date: 2026-05-19
Instance: p6
UI: http://127.0.0.1:5178/
Workspace writer: http://127.0.0.1:6178
RuntimeCodex port: http://127.0.0.1:18085
Workspace: /Applications/workspace/ailab/research/app/SciForge/workspace/parallel/p6

## Scenario

Scenario id: `p6-rotor-thermal-20260519`

Prompt asked the live default chat to create `p6-rotor-thermal-drift/validation-plan.md` for a wind-tunnel rotor thermal drift experiment with:

- token `P6-THERMAL-NOVEL-7Q4Z`
- sensors: two thermistors and one tachometer
- sample windows: 12 runs of 90 seconds
- metrics: drift slope, RPM stability, sensor disagreement
- sections: Scope, Data Columns, Acceptance Rubric, Failure Recovery
- visible final answer naming the artifact path and confirming no hardcoded shortcut or fixture answer

## Acceptance Rubric

- Pass only if the visible second or third turn answer appears in the in-app browser.
- The answer must name the requested artifact path and reflect the active user requirements.
- Artifact content must be inspectable and include the requested sections and measurements.
- Selected artifact/ref follow-up must prove it used the selected artifact/ref instead of generic context.
- Refresh/reopen must preserve the same session/run and recover state.
- Raw stdout, JSONL, stderr, plugin warnings, seed/demo fixtures, and hardcoded passphrases must not become the foreground answer.

## Result

Status: failed / partial, not multi-turn passed.

The first live browser turn failed before producing the requested artifact. The browser showed Runtime Codex command `codex-command-mpcf3797-g575sh` as `failed` / `repair-needed`. After page reload, the same failed command and repair-needed state were still visible, so failed run persistence is observable. Because no second-turn or third-turn visible answer was observed, p6 must not claim multi-turn success.

The persisted run records include command id, attempt id, profile, workspace, provider/model, audit refs, stderr summary, and a Runtime Codex session id. The pre-fix persisted `recoverState` did not include `stderrSummary`; code and tests now require `recoverState.stderrSummary` for newly persisted failed runs.

## Evidence

- `turn1-prompt.txt`
- `default-chat-initial-dom.txt`
- `default-chat-initial.png`
- `turn1-after-submit-dom.txt`
- `turn1-after-submit.png`
- `turn1-terminal-dom.txt`
- `turn1-terminal.png`
- `turn1-reload-dom.txt`
- `turn1-reload.png`
- session bundle: `workspace/parallel/p6/.sciforge/sessions/2026-05-19_literature-evidence-review_session-literature-evidence-review-mpcf2d4o-7bq3ri`

## Fixes Added

- Preserve Runtime Codex `codexSessionId` from SSE completion data into normalized run/message refs.
- Recover future turns from top-level run raw, failed Runtime Codex metadata, legacy nested output result, or `codex-thread:` object references.
- Persist `stderrSummary` into failed run `recoverState`.
- Harden reload recovery checks so failed Runtime Codex runs must retain command id, attempt id, workspace, profile, provider/model, session id, stderr summary, and evidence refs.

## Remaining Risk

- Live provider/runtime failure still blocks the adversarial artifact scenario.
- Existing pre-fix persisted p6 run lacks `recoverState.stderrSummary`; future failed runs are covered by tests.
- Selected artifact continuation and third-turn citation remain unverified because turn 1 did not produce an artifact.

## Worktree Continuation

Worktree: `/Applications/workspace/ailab/research/app/SciForge-p6-adversarial-browser`
Branch: `codex/parallel-p6-adversarial-browser-cont`

Continuation result:

- Updated `smoke:complex-multiturn-chat` so it matches the Runtime Codex terminal-equivalent boundary: current user command is carried as `commandText`; historical failure/guidance bodies do not leak into the request; reusable state is represented by GUI refs and counts.
- `npm run smoke:browser-multiturn` passed.
- `npm run smoke:complex-multiturn-chat` passed.
- `npm run smoke:runtime-codex-browser-acceptance` remained blocked because `SCIFORGE_RUNTIME_API_KEY` is not configured.
- `git diff --check` passed.
- In-app browser opened `http://127.0.0.1:5178/` from the worktree server and captured `worktree-continuation-initial-dom.txt` plus `worktree-continuation-initial.png`.

Continuation verdict: the worktree is ready for the next adversarial browser loop, but live Runtime Codex acceptance remains blocked until the runtime API key is configured.
