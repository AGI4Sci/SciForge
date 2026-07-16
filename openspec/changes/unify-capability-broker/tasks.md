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
- [x] 3.2 Add a built-in broker-backed agent surface with stable discover, observe, invoke, and event tools resolved against the current registry.
- [x] 3.3 Add transport parity and hot-discovery tests, including long-lived tasks seeing newly registered capabilities.

## 4. Workspace Surface Cutover

- [x] 4.1 Change Workspace Preview visible context to publish registry-derived handles and executable operations instead of action counts and literal hints.
- [x] 4.2 Change Biology Room visible context and renderer mutations to use the broker and broker change events.
- [x] 4.3 Remove migrated direct mutation/refresh paths, false agent-access booleans, sidecar guidance, nonexistent tool hints, and the ambiguous preview tool without compatibility aliases.

## 5. Registration Governance

- [x] 5.1 Add a generated capability reference and a `capability:check` command that fails when generated output differs from the registry.
- [x] 5.2 Add reusable provider contract tests and architecture checks forbidding unregistered visible actions, literal tool hints, duplicate providers, and migrated direct business IPC paths.
- [x] 5.3 Document the mandatory new-feature workflow: define provider contract, register it, run contract suite, regenerate reference, and pass architecture checks.

## 6. Verification

- [x] 6.1 Run focused capability, Workspace Preview, Biology Room, IPC, runtime, and architecture test suites.
- [x] 6.2 Run TypeScript typecheck and lint on affected modules, then resolve all regressions caused by this change.
