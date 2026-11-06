# Capability full execution plan

This is the executable denominator for the complete capability evaluation. It separates unique action coverage from workflow and confirmation scenario executions.

| Scope | Planned units | Current design/live evidence |
| --- | ---: | --- |
| Agent-visible action anchors | 152 | design-ready 29; live no-live-evidence=158 |
| Same-domain workflows | 18 | readiness 4 ready, 14 blocked |
| Cross-domain workflows | 9 | readiness 1 ready, 8 blocked |
| Recovery/boundary workflows | 12 | readiness 7 ready, 5 blocked |
| Confirmation-denied scenarios | 39 | case-scoped: yes |

The planned scenario-unit count is 230. The 39 confirmation-denied branches are not extra action IDs; they are explicit authorization executions attached to the 152-action denominator.

Canonical inputs:

- `action-directed-planned.jsonl`: one positive natural-language anchor per Agent-visible action.
- `workflow-expansion-plan.jsonl`: 18 same-domain, 9 cross-domain, and 12 recovery/boundary workflow designs.
- `workflow-expansion-cases.jsonl`: runner-compatible cases generated from the workflow plan.
- `confirmation-action-matrix.jsonl`: one approved and one denied configuration per confirmation action.
- `case-source-index.json`: package-owned versus integration-owned deterministic case sources.

Blocked or unobserved entries remain in the denominator. No action is accepted from discovery, invocation alone, package unit tests, or a model self-report; acceptance requires independent outcome evidence.
