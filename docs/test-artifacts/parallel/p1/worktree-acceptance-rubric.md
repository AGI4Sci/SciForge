# P1 worktree live acceptance rerun rubric

Observed: 2026-05-19T10:41:43.517Z
Worktree: `/Applications/workspace/ailab/research/app/SciForge-p1-live-acceptance`
Actual UI: `http://127.0.0.1:5173/`
Actual workspace writer: `http://127.0.0.1:6173`
Workspace: `/Applications/workspace/ailab/research/app/SciForge/workspace/parallel/p1`

## User Intent

Use the Codex in-app browser from the default chat entry to prove the p1 worktree can execute a live Runtime Codex turn through the visible UI.

## Expected Result

The user prompt asks for the uppercase version of `p1worktreeproxyok`. The expected visible assistant answer is `P1WORKTREEPROXYOK`, which is not present verbatim in the user prompt.

## Actual Result

The in-app browser showed visible answer `P1WORKTREEPROXYOK`. The persisted GUI run is `codex-command-mpci6iqi-tie3z4`; the Runtime Codex command is `codex-c1b0a7cf246d83e9`; the attempt is `codex-c1b0a7cf246d83e9-attempt-mpci6iuv`; the native Codex session id is `019e3fd3-b807-7051-832c-a0da54ff1227`.

## Evidence Refs

- DOM: `docs/test-artifacts/parallel/p1/p1-worktree-live-rerun-dom.txt`
- Screenshot: `docs/test-artifacts/parallel/p1/p1-worktree-live-rerun.png`
- Manifest: `docs/test-artifacts/parallel/p1/worktree-rerun-manifest.json`
- Session: `workspace/parallel/p1/.sciforge/sessions/2026-05-19_literature-evidence-review_session-literature-evidence-review-mpci6fxo-q2lxrl/records/session.json`

## Negative Checks

- The expected uppercase answer was not included verbatim in the prompt.
- The counted run status is completed, not blocked or failed.
- The primary visible answer is not raw stdout, stderr, or JSONL.
- The earlier proxy-misconfigured exit-code-1 run is recorded but not counted as success.
- The browser path used Codex in-app browser against `http://127.0.0.1:5173/`; no system browser or external Chrome was used for acceptance.

## Remaining Risk

This worktree rerun re-proves the live single-turn path after moving code to a dedicated git worktree. The broader M0 evidence for two-turn resume and selected artifact follow-up remains in the earlier p1 manifest and session records copied into this evidence directory.
