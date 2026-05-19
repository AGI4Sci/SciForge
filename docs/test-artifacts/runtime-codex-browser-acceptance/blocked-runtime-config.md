# Runtime Codex browser acceptance blocked

Observed at: 2026-05-19T11:17:22.813Z
Requested UI port: 5173
Requested workspace writer port: 6173
Actual/intended URL: http://127.0.0.1:5173/
Actual/intended workspace writer URL: http://127.0.0.1:6173
Actual/intended RuntimeCodex URL: http://127.0.0.1:18080
Workspace path: /Applications/workspace/ailab/research/app/SciForge/workspace/parallel/p1
Profile: sciforge-runtime-deepseek
Provider: sciforge-deepseek-proxy
Model: bailian/deepseek-v4-flash
Reason: Runtime Codex API key is not configured; live browser E2E must fail closed until SCIFORGE_RUNTIME_API_KEY is present.
Acceptance scope: non-seed Runtime Codex messages only; seed/demo/fixture messages are excluded from success criteria.

Acceptance rubric:
- User intent: prove the real default-chat Runtime Codex path can complete single-turn, selected-ref, and multi-turn tasks.
- Expected observable result: visible live Runtime Codex/gui.present answers with provider/model/profile/workspace/command id and folded audit logs.
- Actual result: blocked before release acceptance because Runtime Codex API key is not configured; live browser E2E must fail closed until SCIFORGE_RUNTIME_API_KEY is present.
- Evidence refs: manifest.json plus screenshot/DOM/notes paths recorded in this bundle.
- Negative checks: fake passed status, missing DOM/screenshot, missing command id, missing task result, seed/demo evidence, and partial/blocked/failed status remain release-blocking.
- Remaining risk: live browser acceptance still requires a configured Runtime Codex API key and visible second-turn answer.

No passed user-level conclusion is claimed.
