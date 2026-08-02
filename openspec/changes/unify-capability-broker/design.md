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

### 8. Agent transport v2 hides infrastructure coordination

The agent-facing contract contains four stable broker meta-tools for product/domain capabilities plus the two Host Core native visual primitives. `observe` returns a compact resource state, opaque resource reference, operation references, schema references, artifacts, and optional surface target references. Full schemas are fetched only when explicitly requested. `invoke` accepts an operation reference and domain input; its adapter creates invocation IDs and supplies the revision from the observed handle. Native visual calls accept opaque source, target, snapshot, and region references; their adapter owns capture coordinates, authorized persistence paths, and proof issuance.

Codex may call the in-process agent adapter directly. SciForge Runtime reaches the same adapter through a narrow request bridge owned by the main process. The bridge serializes only meta-tool name, arguments, caller scope, and structured result/error; it does not host a second registry, cache domain state, or execute provider logic. Runtime-specific flattened catalogs are not an alternative provider path for migrated capabilities.

Snapshot tokens, component IDs, target coordinates, invocation IDs, and expected revisions are transport implementation details. They MUST NOT be required model inputs or emitted as instructions. This is a breaking replacement of the public `gui_visible_context` and `gui_visual_capture` tools.

### 9. Surface inspection uses the native visual runtime

Visible surfaces publish generic sources and opaque targets to Agent Visual Runtime. `sciforge_look` resolves a stable target reference to the latest layout atomically, captures an immutable snapshot, invokes the configured visual router, and returns typed proof. `sciforge_capture` persists only a snapshot or returned region through the authorized artifact store. Semantic content changes advance the resource revision; scroll, resize, rendering, target movement, and capture publication advance only a layout epoch. A layout change cannot make a semantic handle stale.

Alternative considered: refresh a snapshot token before each capture. Rejected because result rendering can itself change layout and invalidate the refreshed token, leaving correctness dependent on timing.

### 10. Observations are compact and operational

Observations include the current domain state needed to choose an operation, but do not inline every capability schema ahead of that state. Operation descriptors carry stable references to schemas. Large content is returned as artifacts or paged operation output. Important state, including current PDF annotation thread summaries, is not placed behind a large schema block where transport truncation can hide it.

### 11. Document annotations have one canonical provider and store

Workspace Preview registers annotation list, create/update, resolve, delete, and review operations against its canonical host. UI and agent calls enter through those operations. Runtime observation reads only the workspace-root canonical sidecar resolved by document identity; it never scans backup or legacy paths. Any legacy import is an explicit one-time migration command and is not part of normal reads.

The public `annotation.sidecar.read` action and sidecar path guidance are deleted. Annotation actions are removed from the generic `workspace-preview.invoke-action` schema and observation path; that dispatcher becomes UI-only for not-yet-migrated plugin domains and MUST NOT be discoverable by agents. Annotation UI and agent callers both use the dedicated registered operations.

### 12. One semantic execution governor serves every runtime

KUN pre-execution and the Codex adapter call one `ExecutionGovernorCore`. It consumes normalized attempts and receipts containing operation family, resource identity, failure class, stable error code, and evidence/state-change signals. Exact duplicate detection remains useful, but recovery escalates consecutive semantic failures across argument, token, or shell-command variants when they target the same blocked objective.

Family alone is not a failure signal. Successful evidence-producing reads, paginated operations, and trusted `computer_use` screenshots remain valid. When an authorized owned visual source can satisfy the request, shell-based OS screenshot/window automation is denied before execution with structured recovery directing the runtime to `sciforge_look` or `sciforge_capture`.

Dynamic MCP errors are normalized before governance. Runtime adapters MUST NOT maintain separate fingerprint or recovery decision engines.

### 13. Current resources are bound to the task, not the foreground session

When a turn refers to the current SciForge resource, the host captures the canonical semantic resource references at turn start and binds the current-surface resolver to that runtime/thread caller. Changing the foreground chat session does not retarget or invalidate a running turn. A later turn receives a new binding from the then-current session.

Renderer publication age is layout freshness only. It may make coordinates, scroll position, visible pages, or screenshots unavailable, but it does not expire the bound document, annotation threads, or other semantic provider resources. A visual operation requests a renderer refresh on demand and proceeds only if the bound session and resource are still visible; it must not capture the newly foregrounded session on behalf of a hidden task.

Stable opaque `resourceRef` values can be rebound to a fresh short-lived handle after the broker revalidates audience and workspace scope. This renewal keeps long-running or hidden turns operational without weakening optimistic semantic revision checks or exposing provider session IDs.

### 14. Discovery, historical references, and recovery are machine-actionable

Capability discovery accepts an exact capability ID independently of free-text
search. Free-text search is normalized into unordered tokens and ranked against
IDs, titles, descriptions, and tags. A strong partial token match remains
eligible so descriptive surplus words such as file format or intended view do
not hide the canonical capability; unmatched tokens reduce the score, while a
zero-overlap query remains empty. Scope, accepted resource kind, produced
resource kind, and provider family are separate filters; one field never
silently changes the meaning of another. Agent discovery defaults to a bounded
native registry result set and includes managed MCP capabilities only when the
caller explicitly requests that provider family.

An empty discovery result is a typed outcome containing registry readiness,
applied filters, and suggested relaxed queries. It is not an unqualified empty
array that can be mistaken for capability absence.

Historical events never imply that an opaque reference is still executable.
Event projections annotate every returned reference as `live` or `retired`
after checking the current handle/reference stores. Retired references remain
valuable for audit but cannot be renewed or invoked.

Native and managed failures enter the shared governor with a stable code,
failure class, retryability, objective, resource identity, and evidence-change
signal. A non-retryable failure opens a turn-scoped circuit immediately. A
retryable failure without new evidence receives one retry; later variants of the
same semantic objective are denied with the original recovery action plus an
explicit statement that the retry was exhausted. An exhausted denial never
repeats the earlier claim that a retry remains available.

### 15. Vision produces evidence while the text reasoner remains primary

The configured text reasoner remains the primary model for planning, synthesis,
tool selection, and final answers. A vision translator is a bounded evidence
producer: it observes authorized immutable images and returns textual evidence
with explicit artifact grounding. Model Router then supplies that evidence to
the text reasoner through the existing canonical `/v1/responses` path.

Provider protocol compatibility is decided from semantic payload state, not
field presence. In particular, a completed Responses payload with `error: null`
is a successful model response. Only a non-null explicit error, a failed event,
or a structurally valid error envelope can reject the provider attempt.

Requests that require native visual proof use a strict evidence contract. The
text reasoner may synthesize or format verified vision evidence, but it cannot
replace failed vision with an HTTP-success text answer containing no grounded
claims. A failed translator, malformed evidence, missing artifact grounding, or
missing attestation crosses worker and Host boundaries as a typed cause.
Ordinary conversational image requests may still degrade visibly to text-only
reasoning when the request does not require native proof.

Protocol negotiation may switch once after a definitive endpoint or schema
rejection before any model output. Transient provider failures enter the shared
governor with their retryable classification. Evidence repair is bounded to one
attempt for the same immutable snapshot and does not create a second hidden
retry engine.

The browser development surface uses the same surface-capture provider
contract as Electron. The main-process bridge issues a one-time capture
challenge to the exact connected browser client, bound to the current layout
revision and requested bounds. It accepts only a bounded PNG response that
matches the client, challenge, revision, PNG signature, dimensions, and crop
scale before applying Host-owned redaction and inspection. This development
transport is not a text fallback and does not create a second visual reasoning
path.

## Risks / Trade-offs

- [Large cross-cutting cutover can collide with active changes] → Add the broker in new modules, use narrow integration edits, and migrate domains separately with focused tests.
- [Generic schemas can hide domain semantics] → Registry entries retain domain-specific schemas and descriptions; only transport is generic.
- [Opaque handles can expire during long research tasks] → Stable resource references are rebound only after broker scope checks, and observation renews short-lived handles; layout-only changes do not expire semantic resources.
- [A hidden task could inspect the wrong foreground session] → Semantic resources stay task-bound, while layout inspection verifies the bound thread/resource is still visible and otherwise fails with a structured layout-unavailable error.
- [In-memory idempotency or events are lost on restart] → The first slice defines a bounded in-memory store and explicit restart semantics; persistent audit/event storage can replace it without changing the contract.
- [Broker becomes a bottleneck] → Handlers remain async and stream or reference large artifacts instead of copying them through events.
- [Agent exposure can exceed safe authority] → Audience and approval are mandatory registry fields, and unsafe combinations fail registration.
- [Tokenized discovery may broaden results] → Exact IDs and explicit filters take
  precedence, ranking is deterministic, and result counts are bounded.
- [Historical reference liveness checks add work] → Resolve liveness only for the
  bounded event page and expose retired references without attempting renewal.
- [Text-primary routing can obscure visual provenance] → Keep vision evidence
  explicitly artifact-grounded, preserve the translator/provider stage in typed
  diagnostics, and prohibit text-only success for strict native visual proof.
- [A browser development renderer could return stale or mismatched pixels] →
  Bind capture to the exact bridge client, a one-time challenge, and the current
  layout revision; validate the PNG and crop geometry in the main process and
  fail closed before visual inspection on any mismatch.

## Migration Plan

1. Add shared schemas plus registry, broker, policy, audit, and event tests without exposing them.
2. Register Workspace Preview and Biology Room providers.
3. Add renderer/preload and agent transport adapters generated from registry visibility.
4. Switch visible context to registry-derived resource handles and actions; subscribe renderer views to broker changes.
5. Delete migrated direct action paths, false agent metadata, literal hints, ambiguous preview tooling, and sidecar guidance.
6. Add generated capability reference and architecture-boundary CI tests.
7. Migrate remaining domains one at a time, deleting each old path during its cutover.
8. Cut the agent transport to v2, migrate visual inspection to the native visual runtime and PDF annotations to broker operations, then delete their public legacy tools and dispatchers.
9. Replace runtime-specific failure guards with the shared semantic execution governor.

Rollback is code rollback of the atomic domain change; no runtime compatibility mode is retained.

## Open Questions

- Persistent audit storage format is deferred; the contract must allow replacement of the initial bounded store.
- External third-party MCP servers remain direct tools until a later migration defines whether they should be broker providers or intentionally external capabilities.
