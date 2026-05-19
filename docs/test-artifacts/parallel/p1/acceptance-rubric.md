# P1 Runtime Codex in-app browser acceptance rubric

Observed: 2026-05-19T09:50:00Z
Actual UI: http://127.0.0.1:5173/
Actual workspace writer: http://127.0.0.1:6173
Profile/provider/model visible in browser: sciforge-runtime-deepseek / sciforge-deepseek-proxy / bailian/deepseek-v4-flash
Workspace: /Applications/workspace/ailab/research/app/SciForge/workspace/parallel/p1

## Single turn
User intent: explain why seawater is salty in three sentences and include p1-beta-20260519.
Expected: visible answer explains salt accumulation and contains p1-beta-20260519.
Actual: visible in-app browser answer completed via Runtime Codex with command codex-command-mpcf9fyv-gaipln and included p1-beta-20260519.
Evidence refs: workspace/parallel/p1/.sciforge/sessions/2026-05-19_literature-evidence-review_session-literature-evidence-review-mpcf9ehv-1f2f09/records/session.json; docs/test-artifacts/runtime-codex-browser-acceptance/p1-live-acceptance-visible-text.txt.
Negative checks: answer is not seed/demo/fixture; visible primary answer is not raw stdout/jsonl/stderr; failed pre-proxy run codex-command-mpceyzkz-sy18tk is not counted.
Remaining risk: result pane still reports no ConversationProjection/gui.present for this class of direct Runtime Codex answer.

## Two-turn resume
User intent: first turn stores passphrase SCIFORGE-CODEX-BROWSER-MT-20260519; second turn outputs only the remembered passphrase.
Expected: second visible answer is SCIFORGE-CODEX-BROWSER-MT-20260519 and both runs share the same Codex session id.
Actual: command codex-command-mpcfslkc-0hsoqq answered 已记住 SCIFORGE-CODEX-BROWSER-MT-20260519; command codex-command-mpcftdbi-9hqm9r answered SCIFORGE-CODEX-BROWSER-MT-20260519; both persisted codexSessionId 019e3f96-8d0b-70b3-99ff-9993caf89fcf.
Evidence refs: workspace/parallel/p1/.sciforge/sessions/2026-05-19_literature-evidence-review_session-literature-evidence-review-mpcfs1y2-wh94ob/records/session.json; docs/test-artifacts/runtime-codex-browser-acceptance/p1-live-acceptance-visible-text.txt.
Negative checks: no hardcoded success phrase in request code; test covers nested raw Codex session id extraction; raw audit remains folded.
Remaining risk: same ConversationProjection/gui.present gap as above.

## Artifact selected-ref follow-up
User intent: with research-report selected in the browser, answer PDF extraction count and next step without external search.
Expected: Runtime Codex resolves the selected artifact path, reads artifact content, and answers from that content.
Actual: initial selected-ref run codex-command-mpcfwi8y-5ltoy5 failed semantically because only short artifact:research-report reached Runtime Codex. After patching ref ordering to carry dataRef first, command codex-command-mpcg92c8-1o2p41 completed with codexSessionId 019e3f99-5501-74a1-813b-506e78d0c16f and answered 已抽取 PDF 全文片段：0 plus a report-derived next step.
Evidence refs: workspace/parallel/p1/.sciforge/sessions/2026-05-18_literature-evidence-review_session-literature-evidence-review-mpbf6p6j-p3xis2/records/session.json; workspace/parallel/p1/.sciforge/sessions/2026-05-18_literature-evidence-review_session-literature-evidence-review-mpbf6p6j-p3xis2/task-results/agentserver-direct-literature-76fefd4201a5-research-report.md; docs/test-artifacts/runtime-codex-browser-acceptance/p1-live-acceptance-visible-text.txt.
Negative checks: selected artifact was opened/read in browser; answer is not from raw stdout/jsonl/stderr; failed semantic run is recorded but not counted as pass.
Remaining risk: visible historical-session UI did not show the live Runtime Codex badge next to the final selected-ref retry, but session state proves Runtime Codex command/provider/model/codexSessionId.
