# Capability evaluation matrix

This generated matrix maps canonical product-evaluation cases to six evidence layers. It is a coverage inventory, not a single product quality score.

Unique executable cases: **109** · scenarios in bounded catalog: **15** · domains: **14**

Catalog coverage: 15/15. Readiness: partial=79, ready=19. Persisted observation counts by mode: deterministic=0, live=0, replay=0; these are run observations, not unique scenarios.

Live evidence binding: . Only `verified` runs are current-case evidence; legacy reports without a dataset SHA are retained as `unverified`.

## Dimension summary

| Dimension | Planned | Declared | Inferred | Not covered | Live-observed | Live-verified | Independent evidence | PASS | FAIL | INCONCLUSIVE |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 运行可用性 | 98 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 理解与交互 | 98 | 1 | 1 | 96 | 0 | 0 | 0 | 0 | 0 | 0 |
| 工具执行 | 98 | 22 | 76 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 任务结果 | 98 | 15 | 75 | 8 | 0 | 0 | 0 | 0 | 0 | 0 |
| 状态与产物 | 98 | 9 | 52 | 37 | 0 | 0 | 0 | 0 | 0 | 0 |
| 鲁棒与安全 | 98 | 2 | 11 | 85 | 0 | 0 | 0 | 0 | 0 | 0 |

## Domain summary

| Domain | Scenarios | Cases | Ready | Partial | Catalog-only | Blocked | Live runs | Live verified | PASS | FAIL | INCONCLUSIVE |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| anchored-comments | 1 | 1 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| artifact-versions | 24 | 30 | 6 | 18 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| biology-room | 9 | 9 | 1 | 8 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| create-loop | 9 | 9 | 1 | 8 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| cross-domain | 1 | 1 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| evidence-dag | 4 | 4 | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| git-checkpoints | 6 | 6 | 2 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| paper-radar | 22 | 22 | 0 | 22 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| project-coordinator | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| research-checkpoints | 1 | 1 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| scientific-plotting | 9 | 14 | 6 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| unknown | 2 | 2 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| version-control | 4 | 4 | 0 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| workspace-preview | 5 | 5 | 0 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

## Scenario matrix

| Scenario | Domain | Cases | Runtime | Interaction | Tool execution | Task result | State | Robustness | Readiness |
| --- | --- | ---: | --- | --- | --- | --- | --- | --- | --- |
| `artifact-compare` | artifact-versions | 2 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (declared) | NOT_COVERED (absent) | NOT_COVERED (absent) | NOT_COVERED (absent) | ready |
| `artifact-describe` | artifact-versions | 2 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (declared) | NOT_COVERED (absent) | NOT_COVERED (absent) | NOT_COVERED (absent) | ready |
| `artifact-history` | artifact-versions | 3 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (declared) | NOT_COVERED (absent) | NOT_COVERED (absent) | NOT_COVERED (absent) | ready |
| `artifact-read` | artifact-versions | 3 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (declared) | NOT_COVERED (absent) | NOT_COVERED (absent) | NOT_COVERED (absent) | ready |
| `artifact-versions-bundle-export-local-fixture` | artifact-versions | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_COVERED (absent) | partial |
| `artifact-versions-bundle-export-v2-local-fixture` | artifact-versions | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_COVERED (absent) | partial |
| `artifact-versions-bundle-import-local-fixture` | artifact-versions | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_COVERED (absent) | partial |
| `artifact-versions-bundle-verify-local-fixture` | artifact-versions | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_COVERED (absent) | partial |
| `artifact-versions-bundle-verify-v2-local-fixture` | artifact-versions | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_COVERED (absent) | partial |
| `artifact-versions-commit-local-fixture` | artifact-versions | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_COVERED (absent) | partial |
| `artifact-versions-compare-local-fixture` | artifact-versions | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_COVERED (absent) | partial |
| `artifact-versions-describe-local-fixture` | artifact-versions | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_COVERED (absent) | partial |
| `artifact-versions-events-list-local-fixture` | artifact-versions | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_COVERED (absent) | partial |
| `artifact-versions-list-local-fixture` | artifact-versions | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_COVERED (absent) | partial |
| `artifact-versions-list-v2-local-fixture` | artifact-versions | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_COVERED (absent) | partial |
| `artifact-versions-materialize-local-fixture` | artifact-versions | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_RUN (inferred) | partial |
| `artifact-versions-observe-local-fixture` | artifact-versions | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_COVERED (absent) | partial |
| `artifact-versions-read-local-fixture` | artifact-versions | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_COVERED (absent) | partial |
| `artifact-versions-read-range-local-fixture` | artifact-versions | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_COVERED (absent) | partial |
| `artifact-versions-refresh-local-fixture` | artifact-versions | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_COVERED (absent) | partial |
| `artifact-versions-restore-local-fixture` | artifact-versions | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_COVERED (absent) | partial |
| `biology-room-apply-local-fixture` | biology-room | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_COVERED (absent) | partial |
| `biology-room-create-local-fixture` | biology-room | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_COVERED (absent) | partial |
| `biology-room-history-local-fixture` | biology-room | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_COVERED (absent) | partial |
| `biology-room-list-local-fixture` | biology-room | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_COVERED (absent) | partial |
| `biology-room-load-local-fixture` | biology-room | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_COVERED (absent) | partial |
| `biology-room-open-local-fixture` | biology-room | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_COVERED (absent) | partial |
| `biology-room-open-or-create-local-fixture` | biology-room | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_COVERED (absent) | partial |
| `biology-room-refresh-local-fixture` | biology-room | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_COVERED (absent) | partial |
| `create-loop-check-code` | create-loop | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_COVERED (absent) | NOT_COVERED (absent) | partial |
| `create-loop-export-dsl` | create-loop | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_COVERED (absent) | NOT_COVERED (absent) | partial |
| `create-loop-import-dsl` | create-loop | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_COVERED (absent) | NOT_COVERED (absent) | partial |
| `create-loop-read` | create-loop | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_COVERED (absent) | NOT_COVERED (absent) | partial |
| `create-loop-run-approval` | create-loop | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_COVERED (absent) | NOT_RUN (inferred) | partial |
| `create-loop-run-node-approval` | create-loop | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_COVERED (absent) | NOT_RUN (inferred) | partial |
| `create-loop-status-final-state` | create-loop | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_COVERED (absent) | partial |
| `create-loop-test-node` | create-loop | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_COVERED (absent) | NOT_COVERED (absent) | partial |
| `evidence-dag-view` | evidence-dag | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_COVERED (absent) | NOT_COVERED (absent) | partial |
| `git-checkpoints-create-local-fixture` | git-checkpoints | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_COVERED (absent) | NOT_COVERED (absent) | partial |
| `git-checkpoints-list` | git-checkpoints | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_COVERED (absent) | NOT_COVERED (absent) | partial |
| `git-checkpoints-preview-local-fixture` | git-checkpoints | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_COVERED (absent) | NOT_COVERED (absent) | partial |
| `git-checkpoints-restore-local-fixture` | git-checkpoints | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_COVERED (absent) | NOT_RUN (inferred) | partial |
| `non-capability-distractor` | unknown | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_COVERED (absent) | NOT_COVERED (absent) | partial |
| `paper-radar-digest-local-fixture` | paper-radar | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_COVERED (absent) | partial |
| `paper-radar-profiles-list-local-fixture` | paper-radar | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_COVERED (absent) | partial |
| `paper-radar-profiles-save-local-fixture` | paper-radar | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_COVERED (absent) | NOT_COVERED (absent) | partial |
| `paper-radar-rank-local-fixture` | paper-radar | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_COVERED (absent) | partial |
| `paper-radar-review-local-fixture` | paper-radar | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_COVERED (absent) | partial |
| `paper-radar-search-local-fixture` | paper-radar | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_COVERED (absent) | partial |
| `paper-radar-status-local-fixture` | paper-radar | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_COVERED (absent) | partial |
| `paper-radar-sync-arxiv-local-fixture` | paper-radar | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_COVERED (absent) | partial |
| `paper-radar-sync-biorxiv-local-fixture` | paper-radar | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_COVERED (absent) | partial |
| `paper-radar-sync-profile-local-fixture` | paper-radar | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_COVERED (absent) | partial |
| `plot-compare` | scientific-plotting | 2 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (declared) | NOT_COVERED (absent) | NOT_COVERED (absent) | NOT_COVERED (absent) | ready |
| `plot-environment-status` | scientific-plotting | 3 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (declared) | NOT_COVERED (absent) | NOT_COVERED (absent) | NOT_COVERED (absent) | ready |
| `plot-render` | scientific-plotting | 2 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (declared) | NOT_COVERED (absent) | NOT_COVERED (absent) | NOT_COVERED (absent) | ready |
| `plot-temperature-trend` | scientific-plotting | 2 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (declared) | NOT_COVERED (absent) | NOT_COVERED (absent) | NOT_COVERED (absent) | ready |
| `product-ambiguous-clarification` | cross-domain | 1 | NOT_RUN (harness) | NOT_RUN (declared) | NOT_RUN (inferred) | NOT_RUN (declared) | NOT_COVERED (absent) | NOT_COVERED (absent) | partial |
| `product-approval-denial` | create-loop | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (declared) | NOT_RUN (declared) | NOT_RUN (declared) | NOT_RUN (declared) | ready |
| `product-artifact-bundle` | artifact-versions | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (declared) | NOT_RUN (declared) | NOT_RUN (declared) | NOT_COVERED (absent) | ready |
| `product-artifact-compare` | artifact-versions | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (declared) | NOT_RUN (declared) | NOT_RUN (declared) | NOT_COVERED (absent) | ready |
| `product-artifact-history` | artifact-versions | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (declared) | NOT_RUN (declared) | NOT_RUN (inferred) | NOT_COVERED (absent) | partial |
| `product-biology-room-open` | biology-room | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (declared) | NOT_RUN (declared) | NOT_RUN (declared) | NOT_COVERED (absent) | ready |
| `product-checkpoint-create` | git-checkpoints | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (declared) | NOT_RUN (declared) | NOT_RUN (declared) | NOT_COVERED (absent) | ready |
| `product-checkpoint-restore` | git-checkpoints | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (declared) | NOT_RUN (declared) | NOT_RUN (declared) | NOT_RUN (declared) | ready |
| `product-comments-review` | anchored-comments | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (declared) | NOT_RUN (declared) | NOT_RUN (inferred) | NOT_COVERED (absent) | partial |
| `product-evidence-export` | evidence-dag | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (declared) | NOT_RUN (declared) | NOT_RUN (declared) | NOT_COVERED (absent) | ready |
| `product-evidence-view` | evidence-dag | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (declared) | NOT_RUN (declared) | NOT_COVERED (absent) | NOT_COVERED (absent) | ready |
| `product-plot-render` | scientific-plotting | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (declared) | NOT_RUN (declared) | NOT_RUN (declared) | NOT_COVERED (absent) | ready |
| `product-plot-status` | scientific-plotting | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (declared) | NOT_RUN (declared) | NOT_RUN (inferred) | NOT_COVERED (absent) | partial |
| `product-plot-workflow` | scientific-plotting | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (declared) | NOT_RUN (declared) | NOT_RUN (declared) | NOT_COVERED (absent) | ready |
| `product-project-plan` | project-coordinator | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (declared) | NOT_RUN (declared) | NOT_COVERED (absent) | NOT_COVERED (absent) | ready |
| `research-checkpoints-status` | research-checkpoints | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_COVERED (absent) | NOT_COVERED (absent) | partial |
| `scientific-plotting-status-local-fixture` | scientific-plotting | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_COVERED (absent) | partial |
| `scientific-plotting-workflow-local-fixture` | scientific-plotting | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_COVERED (absent) | partial |
| `version-control-create-snapshot` | version-control | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_COVERED (absent) | NOT_COVERED (absent) | partial |
| `version-control-diff` | version-control | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_COVERED (absent) | NOT_COVERED (absent) | partial |
| `version-control-open-status` | version-control | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_COVERED (absent) | NOT_COVERED (absent) | partial |
| `version-control-restore-approval` | version-control | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_COVERED (absent) | NOT_RUN (inferred) | partial |
| `workflow-capability-explanation-no-call` | unknown | 1 | NOT_RUN (harness) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_COVERED (absent) | NOT_COVERED (absent) | partial |
| `workflow-evidence-project-review` | evidence-dag | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_COVERED (absent) | partial |
| `workflow-paper-digest-grounded` | paper-radar | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_COVERED (absent) | partial |
| `workflow-paper-empty-result` | paper-radar | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_RUN (inferred) | partial |
| `workflow-paper-profile-approval-denied` | paper-radar | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_RUN (inferred) | partial |
| `workflow-paper-profile-review` | paper-radar | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_COVERED (absent) | partial |
| `workflow-paper-profile-save-approval` | paper-radar | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_RUN (inferred) | partial |
| `workflow-paper-ranking-recent` | paper-radar | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_COVERED (absent) | partial |
| `workflow-paper-rational-alternative` | paper-radar | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_COVERED (absent) | partial |
| `workflow-paper-search-persistent-failure` | paper-radar | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_RUN (inferred) | partial |
| `workflow-paper-search-retry-recover` | paper-radar | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_RUN (inferred) | partial |
| `workflow-paper-to-plot-data-dependency` | paper-radar | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_COVERED (absent) | partial |
| `workflow-paper-trend-plot` | paper-radar | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_COVERED (absent) | partial |
| `workflow-single-paper-search` | paper-radar | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_COVERED (absent) | NOT_COVERED (absent) | partial |
| `workspace-preview-annotations-list` | workspace-preview | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_COVERED (absent) | NOT_COVERED (absent) | partial |
| `workspace-preview-apply-edit` | workspace-preview | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_COVERED (absent) | NOT_COVERED (absent) | partial |
| `workspace-preview-export-approval` | workspace-preview | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_COVERED (absent) | NOT_RUN (inferred) | partial |
| `workspace-preview-list` | workspace-preview | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_COVERED (absent) | NOT_COVERED (absent) | partial |
| `workspace-preview-open-read` | workspace-preview | 1 | NOT_RUN (harness) | NOT_COVERED (absent) | NOT_RUN (inferred) | NOT_RUN (inferred) | NOT_COVERED (absent) | NOT_COVERED (absent) | partial |

### Status semantics

- `NOT_COVERED`: no executable contract for this layer; it is a scope gap, not a failure.
- `NOT_RUN`: a contract exists, but no persisted observation was found.
- `SIMULATION_ONLY`: only deterministic/synthetic evidence was found; it is not live Agent evidence.
- `OBSERVED`: a live Agent observation exists. PASS/FAIL/INCONCLUSIVE counts remain separate.
- `catalog_only`: the product scenario is in the bounded catalog but has no executable case yet.
- Dimension PASS/FAIL/INCONCLUSIVE counts come from that dimension's evaluator result. A case-level PASS is not copied into every dimension.
- `verified` live binding means the run manifest contains the current case-file SHA-256. Older reports remain visible but are not current-case evidence.
- `inferred` contracts are legacy metadata inferred from existing fields and should be upgraded to explicit dimensions before formal acceptance.

