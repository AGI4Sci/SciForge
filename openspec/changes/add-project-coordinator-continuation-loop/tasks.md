## 1. Canonical identity and Inbox contracts

- [x] 1.1 Export the existing Plan-item-to-Task canonical ID derivation from collaboration contracts, switch collaboration-server to consume it, and verify contract/server identity tests preserve every existing Task ID.
- [x] 1.2 Add strict `project.plan.confirmed` and `task.result.submitted` Agent Inbox payloads, verify server-produced messages round-trip through `inboxMessageSchema`, and route them only to the registered Project Coordinator owner.

## 2. Project continuation core

- [x] 2.1 Implement a pure ready-set derivation for root and dependency-gated Plan items, with tests for partial dependencies, multiple ready items, existing canonical Tasks, non-active Projects and non-confirmed Plans.
- [x] 2.2 Implement the per-Project serialized continuation reconciler using fresh workspace reads, durable Worker User assignments, canonical Task IDs, stable fact-derived idempotency and the existing Coordinator command service; verify replay and stale-authority behavior with focused tests.
- [x] 2.3 Replace the root-only Plan confirmation dispatcher with the reconciler while preserving current initial dispatch behavior and verify Plan workflow tests.

## 3. Renderer-independent triggers and recovery

- [x] 3.1 Trigger reconcile after an accepted result review and relevant Coordinator Inbox handling without rolling back an already committed review when continuation fails; verify request-revision and pending-review paths do not unlock dependencies.
- [x] 3.2 Reconcile visible non-terminal Projects on runtime activation, keep failures bounded/logged, and verify page-unmounted/startup-recovery behavior without renderer calls.

## 4. Validation and architecture audit

- [x] 4.1 Run changed package tests, typecheck and lint; validate the OpenSpec change and mark completed tasks only for passing evidence.
- [x] 4.2 Run package-boundary, private-import, generated-composition and capability-governance checks; audit that no parallel Task API, renderer scheduler, central feature map edit, domain hard-code or compatibility path was introduced.
