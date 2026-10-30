# Capability workflow readiness audit

Generated from the two canonical workflow case files. It covers 19 cases: 13 golden and 6 controlled scenarios.

Readiness counts: blocked=11, partial=2, ready=6. Readiness means the case has package-owned fixture and independent-oracle contracts; it does not mean the latest live run passed.

| Case | Set | Type | Required actions | Readiness | Fixture | Oracle | Latest live | Latest replay |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `workflow-single-paper-search` | golden | single-action | `paper-radar.search` | blocked | needs-case-or-package-fixture | needs-final-state-contract | not observed | not observed |
| `workflow-paper-ranking-recent` | golden | multi-step | `paper-radar.search`<br>`paper-radar.rank` | blocked | needs-case-or-package-fixture | declared | not observed | not observed |
| `workflow-paper-digest-grounded` | golden | multi-step | `paper-radar.search`<br>`paper-radar.rank`<br>`paper-radar.digest` | blocked | needs-case-or-package-fixture | declared | not observed | not observed |
| `workflow-paper-profile-review` | golden | multi-step | `paper-radar.profiles.list`<br>`paper-radar.rank`<br>`paper-radar.digest` | blocked | needs-case-or-package-fixture | declared | not observed | not observed |
| `workflow-paper-trend-plot` | golden | cross-domain | `paper-radar.search`<br>`paper-radar.rank`<br>`scientific-plotting.map-data`<br>`scientific-plotting.render` | partial | needs-case-or-package-fixture | declared | not observed | not observed |
| `workflow-dataset-to-plot` | golden | cross-domain | `dataset-api.profile`<br>`dataset-api.filter`<br>`scientific-plotting.map-data`<br>`scientific-plotting.render` | ready | declared | declared | not observed | not observed |
| `workflow-dataset-clean-validate` | golden | multi-step | `dataset-api.profile`<br>`dataset-api.deduplicate`<br>`dataset-api.select-columns`<br>`dataset-api.validate` | ready | declared | declared | not observed | not observed |
| `workflow-dataset-filter-transform` | golden | multi-step | `dataset-api.profile`<br>`dataset-api.filter`<br>`dataset-api.transform`<br>`dataset-api.validate` | ready | declared | declared | not observed | not observed |
| `workflow-dataset-join-validate` | golden | multi-step | `dataset-api.join`<br>`dataset-api.validate` | ready | declared | declared | not observed | not observed |
| `workflow-compute-baseline-artifacts` | golden | multi-step | `scientific-compute.status`<br>`scientific-compute.run-baseline` | ready | available-through-package | declared | not observed | not observed |
| `workflow-evidence-project-review` | golden | cross-domain | `evidence-dag.view`<br>`project-dag.view` | blocked | needs-case-or-package-fixture | declared | not observed | not observed |
| `workflow-paper-profile-save-approval` | golden | single-action | `paper-radar.profiles.save` | blocked | needs-case-or-package-fixture | declared | not observed | not observed |
| `workflow-capability-explanation-no-call` | golden | single-action | none | ready | declared | declared | not observed | not observed |
| `workflow-paper-empty-result` | scenarios | multi-step | `paper-radar.search` | blocked | needs-case-or-package-fixture | declared | not observed | not observed |
| `workflow-paper-search-retry-recover` | scenarios | multi-step | `paper-radar.search` | blocked | needs-case-or-package-fixture | declared | not observed | not observed |
| `workflow-paper-search-persistent-failure` | scenarios | single-action | `paper-radar.search` | blocked | needs-case-or-package-fixture | declared | not observed | not observed |
| `workflow-paper-profile-approval-denied` | scenarios | single-action | `paper-radar.profiles.save` | blocked | needs-case-or-package-fixture | declared | not observed | not observed |
| `workflow-paper-rational-alternative` | scenarios | multi-step | `paper-radar.search` | blocked | needs-case-or-package-fixture | declared | not observed | not observed |
| `workflow-paper-to-plot-data-dependency` | scenarios | cross-domain | `paper-radar.search`<br>`scientific-plotting.map-data` | partial | needs-case-or-package-fixture | declared | not observed | not observed |

The audit records observed failures and inconclusive traces as evidence; it does not turn them into passes or relax the case contract.
