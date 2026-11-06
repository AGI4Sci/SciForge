# Capability workflow readiness audit

Generated from the two canonical workflow case files. It covers 14 cases: 8 golden and 6 controlled scenarios.

Readiness counts: blocked=13, ready=1. Readiness means the case has package-owned fixture and independent-oracle contracts; it does not mean the latest live run passed.

| Case | Set | Type | Required actions | Readiness | Fixture | Oracle | Latest live | Latest replay |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `workflow-single-paper-search` | golden | single-action | `paper-radar.search` | blocked | needs-case-or-package-fixture | needs-final-state-contract | not observed | not observed |
| `workflow-paper-ranking-recent` | golden | multi-step | `paper-radar.search`<br>`paper-radar.rank` | blocked | needs-case-or-package-fixture | declared | not observed | not observed |
| `workflow-paper-digest-grounded` | golden | multi-step | `paper-radar.search`<br>`paper-radar.rank`<br>`paper-radar.digest` | blocked | needs-case-or-package-fixture | declared | not observed | not observed |
| `workflow-paper-profile-review` | golden | multi-step | `paper-radar.profiles.list`<br>`paper-radar.rank`<br>`paper-radar.digest` | blocked | needs-case-or-package-fixture | declared | not observed | not observed |
| `workflow-paper-trend-plot` | golden | cross-domain | `paper-radar.search`<br>`paper-radar.rank`<br>`scientific-plotting.map-data`<br>`scientific-plotting.render` | blocked | needs-case-or-package-fixture | declared | not observed | not observed |
| `workflow-evidence-project-review` | golden | cross-domain | `evidence-dag.view`<br>`project-dag.view` | blocked | needs-case-or-package-fixture | declared | not observed | not observed |
| `workflow-paper-profile-save-approval` | golden | single-action | `paper-radar.profiles.save` | blocked | needs-case-or-package-fixture | declared | not observed | not observed |
| `workflow-capability-explanation-no-call` | golden | single-action | none | ready | declared | declared | not observed | not observed |
| `workflow-paper-empty-result` | scenarios | multi-step | `paper-radar.search` | blocked | needs-case-or-package-fixture | declared | not observed | not observed |
| `workflow-paper-search-retry-recover` | scenarios | multi-step | `paper-radar.search` | blocked | needs-case-or-package-fixture | declared | not observed | not observed |
| `workflow-paper-search-persistent-failure` | scenarios | single-action | `paper-radar.search` | blocked | needs-case-or-package-fixture | declared | not observed | not observed |
| `workflow-paper-profile-approval-denied` | scenarios | single-action | `paper-radar.profiles.save` | blocked | needs-case-or-package-fixture | declared | not observed | not observed |
| `workflow-paper-rational-alternative` | scenarios | multi-step | `paper-radar.search` | blocked | needs-case-or-package-fixture | declared | not observed | not observed |
| `workflow-paper-to-plot-data-dependency` | scenarios | cross-domain | `paper-radar.search`<br>`scientific-plotting.map-data` | blocked | needs-case-or-package-fixture | declared | not observed | not observed |

The audit records observed failures and inconclusive traces as evidence; it does not turn them into passes or relax the case contract.
