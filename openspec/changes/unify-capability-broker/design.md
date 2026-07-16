## Context

SciForge currently has four partially overlapping capability planes: renderer/preload IPC, main-process domain services, managed MCP workers, and runtime-specific dynamic tools/prompts. Workspace Preview demonstrates the failure mode: the main host owns rich actions, renderer code can invoke them, visible context advertises only an action count and internal IPC-like names, while the agent receives an unrelated file-summary tool. Biology Room similarly advertises agent tools that do not exist. New features can therefore appear complete in the UI while remaining unreachable or stale in long-lived agent tasks.

The worktree contains active unrelated changes, so implementation must prefer new modules and narrow edits to integration points. Existing domain engines remain authoritative; the broker replaces duplicate entry paths rather than reimplementing domain behavior.

## Goals / Non-Goals

**Goals:**

- Make one registry the source of truth for names, schemas, audiences, effects, approval, revisions, idempotency, documentation, and executable providers.
- Route UI, agent, and system callers through one broker and one domain provider per action.
- Give all runtimes a small stable discovery/observation/invocation/event interface that does not become stale when capabilities are added.
- Migrate Workspace Preview and Biology Room as complete vertical slices, including change publication.
- Make incomplete registration, false access metadata, duplicate IDs, and undocumented executable surfaces fail tests or builds.
- Delete conflicting migrated paths and aliases instead of preserving compatibility branches.

**Non-Goals:**

- Expose secrets, raw settings, file pickers, human approval decisions, or destructive desktop controls to agents.
- Rewrite existing Workspace Preview renderers, document parsers, Biology Room domain logic, or external MCP implementations.
- Migrate every existing worker in the first vertical slice; un-migrated domains remain explicit providers to be moved in later atomic changes.
- Make layout-only events such as scroll invalidate semantic resource revisions.

## Decisions

### 1. Main-process registry and broker are authoritative

Add shared serializable contracts and a main-process `CapabilityRegistry`/`CapabilityBroker`. A registered action contains an ID, version, audiences, scope, effect, approval, JSON-compatible input/output schemas, revision/idempotency policy, and exactly one handler. Registration rejects duplicate IDs and any agent-visible action without an executable handler.

Alternative considered: extend each managed MCP server independently. Rejected because it retains separate UI and agent behavior and cannot guarantee shared state, approval, or refresh semantics.

### 2. Transports are generated adapters, not business implementations

Renderer IPC and the built-in agent MCP surface expose the same registry through `discover`, `observe`, `invoke`, and `events`. They pass caller identity into the broker and contain no domain mutation logic. External workers can become providers, but SciForge callers still enter through the broker.

Alternative considered: expose every registered action as a top-level runtime tool. Rejected because long-lived tasks cache tool catalogs and large flattened catalogs increase tool-selection errors. The stable meta-tools discover current actions at call time.

### 3. Scoped opaque resource handles

Observation returns an opaque handle bound to audience, workspace, resource identity, semantic revision, and expiry. Internal session IDs, sidecar paths, IPC channel names, and worker endpoints are not agent-visible. The broker resolves handles and rejects scope or revision mismatches.

Semantic revision tracks content, selection, annotations, and domain state. Layout revision tracks scroll, resize, and coordinates separately. Layout changes do not invalidate a semantic handle.

### 4. Mutations are revisioned, idempotent, audited, and evented

Every non-read action requires an invocation ID. Actions declaring optimistic concurrency also require an expected revision. The broker caches completed invocation results for idempotent retry, records caller/action/resource/effect/policy/before-after revisions, and publishes `resource.changed` after a successful mutation. Renderer clients subscribe and re-observe instead of manually chaining refresh calls.

### 5. Workspace Preview and Biology Room become providers

Workspace Preview keeps its existing main `WorkspacePreviewHost` as the sole domain engine. The provider maps open/observe/read/invoke/export/release to registered operations and derives available action descriptors from observations. PDF/DOCX annotation storage stays internal to this provider and is never addressed directly by an agent.

Biology Room keeps its existing service/revision model as the sole domain engine. The provider registers observe/apply/history operations using the same broker contract. Generic preview routing must not create a second provider for formats owned by Biology Room.

### 6. Registration governance is enforced in code and CI

Add invariant tests that reject duplicate action IDs, missing handlers, invalid audience/effect/approval combinations, schema failures, undocumented registry entries, literal access hints naming tools, and agent-access booleans disconnected from actions. Capability reference documentation is generated from the registry and checked for a clean diff.

New product features must add a provider manifest and contract tests before UI or agent exposure. A renderer control that invokes an unregistered domain action is an architecture violation.

### 7. Atomic domain cutovers

Each migrated domain switches UI and agent adapters to the broker in one change, then deletes its old direct mutation IPC, prompt hints, aliases, and refresh chains. There is no compatibility alias or permanent dual path. Un-migrated domains are not falsely advertised as broker-backed.

## Risks / Trade-offs

- [Large cross-cutting cutover can collide with active changes] → Add the broker in new modules, use narrow integration edits, and migrate domains separately with focused tests.
- [Generic schemas can hide domain semantics] → Registry entries retain domain-specific schemas and descriptions; only transport is generic.
- [Opaque handles can expire during long research tasks] → Discovery and observation are cheap and handles can be renewed; layout-only changes do not expire semantic handles.
- [In-memory idempotency or events are lost on restart] → The first slice defines a bounded in-memory store and explicit restart semantics; persistent audit/event storage can replace it without changing the contract.
- [Broker becomes a bottleneck] → Handlers remain async and stream or reference large artifacts instead of copying them through events.
- [Agent exposure can exceed safe authority] → Audience and approval are mandatory registry fields, and unsafe combinations fail registration.

## Migration Plan

1. Add shared schemas plus registry, broker, policy, audit, and event tests without exposing them.
2. Register Workspace Preview and Biology Room providers.
3. Add renderer/preload and agent transport adapters generated from registry visibility.
4. Switch visible context to registry-derived resource handles and actions; subscribe renderer views to broker changes.
5. Delete migrated direct action paths, false agent metadata, literal hints, ambiguous preview tooling, and sidecar guidance.
6. Add generated capability reference and architecture-boundary CI tests.
7. Migrate remaining domains one at a time, deleting each old path during its cutover.

Rollback is code rollback of the atomic domain change; no runtime compatibility mode is retained.

## Open Questions

- Persistent audit storage format is deferred; the contract must allow replacement of the initial bounded store.
- External third-party MCP servers remain direct tools until a later migration defines whether they should be broker providers or intentionally external capabilities.
