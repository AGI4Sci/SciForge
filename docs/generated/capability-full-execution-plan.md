# Capability full execution plan

This is the executable denominator for the complete capability evaluation. It separates unique action coverage from workflow and confirmation scenario executions.

| Scope | Planned units | Current design/live evidence |
| --- | ---: | --- |
| Agent-visible action anchors | 198 | design-ready 69; live no-live-evidence=198 |
| Same-domain workflows | 18 | readiness 7 ready, 11 blocked |
| Cross-domain workflows | 12 | readiness 4 ready, 8 blocked |
| Recovery/boundary workflows | 12 | readiness 7 ready, 5 blocked |
| Confirmation-denied scenarios | 43 | case-scoped: yes |

The planned scenario-unit count is 283. The 43 confirmation-denied branches are not extra action IDs; they are explicit authorization executions attached to the 198-action denominator.

Canonical inputs:

- `action-directed-planned.jsonl`: one positive natural-language anchor per Agent-visible action.
- `workflow-expansion-plan.jsonl`: 18 same-domain, 12 cross-domain, and 12 recovery/boundary workflow designs.
- `workflow-expansion-cases.jsonl`: runner-compatible cases generated from the workflow plan.
- `confirmation-action-matrix.jsonl`: one approved and one denied configuration per confirmation action.
- `case-source-index.json`: package-owned versus integration-owned deterministic case sources.

Blocked or unobserved entries remain in the denominator. No action is accepted from discovery, invocation alone, package unit tests, or a model self-report; acceptance requires independent outcome evidence.
