## 1. Core Contracts and Broker

- [x] 1.1 Add shared Zod contracts for capability descriptors, caller context, resource handles, observations, invocations, audit records, and change events.
- [x] 1.2 Implement `defineCapability` and a fail-fast registry that binds metadata, schemas, and exactly one executable handler.
- [x] 1.3 Implement broker policy, scope validation, semantic revisions, idempotent mutation handling, audit records, and event subscriptions.
- [x] 1.4 Add core tests for duplicate/incomplete registration, audience/approval policy, schema validation, handle scope, revision conflict, idempotency, audit, and events.

## 2. Workspace Surface Providers

- [x] 2.1 Register Workspace Preview discovery, observation, read, action, export, and release operations against the existing main host.
- [x] 2.2 Register Biology Room observation, apply, and history operations against the existing canonical service.
- [x] 2.3 Add provider contract tests proving UI and agent callers reach the same provider and mutations publish resource changes.

## 3. Unified Transports

- [x] 3.1 Add generic main-process/preload IPC adapters for discover, observe, invoke, and event subscription without domain business logic.
- [x] 3.2 Replace the built-in agent surface with only stable discover, observe, invoke, and event tools; hide snapshot tokens, revisions, target coordinates, and invocation IDs inside the adapter.
- [x] 3.3 Add transport parity, compact-observation, schema-reference, and hot-discovery tests.
- [x] 3.4 Route SciForge Runtime's four meta-tools through a transparent main-process bridge to the same `CapabilityAgentToolSurface` used by Codex; do not duplicate registry or provider logic.

## 4. Workspace Surface Cutover

- [x] 4.1 Change Workspace Preview observation to publish compact registry-derived state, handles, operation/schema references, artifacts, and surface target references.
- [x] 4.2 Change Biology Room visible context and renderer mutations to use the broker and broker change events.
- [x] 4.3 Remove migrated direct mutation/refresh paths, public `gui_*` tools, false agent-access booleans, sidecar guidance/access, nonexistent tool hints, and agent access to the ambiguous preview dispatcher without compatibility aliases.

## 5. Registration Governance

- [x] 5.1 Add a generated capability reference and a `capability:check` command that fails when generated output differs from the registry.
- [x] 5.2 Add reusable provider contract tests and architecture checks forbidding unregistered visible actions, literal tool hints, duplicate providers, and migrated direct business IPC paths.
- [x] 5.3 Document the mandatory new-feature workflow: define provider contract, register it, run contract suite, regenerate reference, and pass architecture checks.

## 6. Verification

- [x] 6.1 Run focused capability, Surface Inspection, Workspace Preview, PDF annotation, Biology Room, IPC, runtime, governance, and architecture suites.
- [x] 6.2 Run TypeScript typecheck and lint on affected modules, then resolve all regressions caused by this change.

## 7. Surface Inspection Cutover

- [x] 7.1 Register `surface.inspect` as a broker read and resolve stable target references to the latest layout atomically inside the provider.
- [x] 7.2 Split semantic resource revision from layout epoch and prove scroll, resize, render, and capture publication cannot stale a semantic handle.
- [x] 7.3 Delete public `gui_visible_context` and `gui_visual_capture` agent tools and their token-coordination guidance.

## 8. Canonical Document Annotation Cutover

- [x] 8.1 Register current annotation list/update/resolve/delete and supported review operations against the canonical Workspace Preview host.
- [x] 8.2 Publish actual current canonical thread summaries early in compact observations and correct thread/annotation count semantics.
- [x] 8.3 Delete public sidecar reads, sidecar path instructions, runtime legacy/backup scanning, and annotation routing through the generic preview action dispatcher; keep it UI-only for un-migrated plugin domains.

## 9. Shared Execution Governance

- [x] 9.1 Implement normalized attempts/receipts and one `ExecutionGovernorCore` used by KUN and Codex runtime adapters.
- [x] 9.2 Escalate consecutive semantic failures across argument/token variants while preserving valid multi-step reads and trusted computer-use flows.
- [x] 9.3 Normalize dynamic MCP structured errors and deny shell OS capture/window automation when a registered surface-inspection capability is available.
- [x] 9.4 Delete duplicated runtime-specific recovery decision engines and add cross-runtime contract tests.
- [x] 9.5 Replace the obsolete `toolStorm` configuration/capability vocabulary with runtime-neutral execution governance names; do not retain compatibility fields.

## 10. Fail-visible Readiness and Current-resource Routing

- [x] 10.1 Add a versioned capability readiness handshake that distinguishes a valid empty registry from transport mismatch, incompatible contract, and missing required operations.
- [ ] 10.2 Gate migrated preload facades and renderer hosts on readiness, surface failures to users, and remove empty-data error fallbacks.
- [x] 10.3 Publish the current visible surface as a canonical capability resource summary and require agent routing to prefer that resource over path guessing or legacy direct-tool/shell access.
- [ ] 10.4 Add readiness, version skew, missing-operation, resource freshness, and no-fallback regression tests.
