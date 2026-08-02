## ADDED Requirements

### Requirement: Authoritative capability registration
SciForge SHALL register each product action exactly once with an executable handler, version, schemas, audiences, scope, effect, approval policy, and concurrency/idempotency metadata.

#### Scenario: Valid capability registration
- **WHEN** a complete capability definition with a unique action ID is registered
- **THEN** the registry exposes the definition to only its declared audiences and resolves it to exactly one handler

#### Scenario: Incomplete or duplicate registration
- **WHEN** a capability has a duplicate ID, missing handler, invalid schema, or unsafe audience-policy combination
- **THEN** registry construction fails before the feature is exposed

### Requirement: Runtime discovery remains current
SciForge SHALL expose stable discovery, observation, invocation, and event operations whose results are resolved against the current registry at call time.

#### Scenario: Capability added after task creation
- **WHEN** an enabled capability is registered after an agent task was created
- **THEN** the next discovery call returns it without rematerializing the task tool catalog

#### Scenario: Exact capability lookup
- **WHEN** an agent supplies a registered capability ID
- **THEN** discovery returns that capability regardless of free-text token order

#### Scenario: Tokenized ranked search
- **WHEN** an agent searches with words that occur in a capability title, ID, description, or tags in a different order
- **THEN** discovery returns a deterministic bounded ranking with exact and native registry matches ahead of broader results

#### Scenario: Search includes descriptive surplus words
- **WHEN** an agent search contains strong capability tokens plus unmatched format or presentation words
- **THEN** the strong partial match remains eligible with a lower deterministic score while a zero-overlap search remains empty

#### Scenario: Explicit discovery filters
- **WHEN** an agent filters by scope, accepted resource kind, produced resource kind, or provider family
- **THEN** each filter applies only its documented dimension and managed MCP capabilities are excluded unless their provider family is requested

#### Scenario: Empty discovery result
- **WHEN** no capability matches the applied query and filters
- **THEN** discovery returns registry readiness, the applied filters, and suggested relaxed queries instead of an unqualified empty array

### Requirement: Capability readiness is fail-visible
SciForge SHALL perform an explicit broker contract and required-operation readiness handshake before migrated callers treat discovery or facade results as authoritative.

#### Scenario: Required operations are ready
- **WHEN** the transport contract matches and every caller-required operation is registered for its audience and workspace
- **THEN** readiness returns the current contract version, registry fingerprint, and a `ready` status, including when no optional operations exist

#### Scenario: Transport or registration is incomplete
- **WHEN** the main/preload/renderer contract versions differ, the readiness channel is absent, or a required operation is not registered
- **THEN** the caller reports an incompatible or incomplete capability error and does not substitute an empty list, legacy API, direct domain IPC, or shell fallback

### Requirement: Current visible resources are canonical
SciForge SHALL publish the current visible surface as a generic canonical capability resource summary with identity, freshness, and operation references.

#### Scenario: Agent acts on the current surface
- **WHEN** an agent request refers to the current visible resource and a current registered resource summary exists
- **THEN** the agent resolves and observes that resource before acting, without guessing a workspace path or reading a historical sidecar

#### Scenario: Current resource is stale or unavailable
- **WHEN** the semantic current resource is superseded, unavailable, or lacks a required operation
- **THEN** the agent receives a fail-visible resource readiness error and does not route through a legacy GUI tool, direct sidecar access, or shell path fallback

#### Scenario: Renderer layout publication is old
- **WHEN** the bound current resource still exists but its renderer layout publication exceeds the layout freshness threshold
- **THEN** semantic observation and provider operations remain available while visual inspection refreshes layout on demand

#### Scenario: Foreground session changes during a turn
- **WHEN** a running turn has bound the current semantic resource and the user selects another session
- **THEN** the running turn continues to resolve its original bound resource and is not retargeted to the newly foregrounded session

### Requirement: Agent transport hides infrastructure fields
SciForge SHALL expose owned capabilities to agents only through stable broker meta-tools whose domain inputs exclude transport coordination fields.

#### Scenario: Agent invokes a mutation
- **WHEN** an agent invokes an observed operation with its operation reference and domain input
- **THEN** the adapter supplies the current handle revision and a generated invocation ID without requiring either from the model

#### Scenario: Agent inspects a surface
- **WHEN** an agent invokes `sciforge_look` for an available visual source
- **THEN** it does not provide a snapshot token, component ID, raw target coordinate, layout revision, or capture path

### Requirement: Observations remain compact and actionable
SciForge SHALL return current resource state before optional large metadata and SHALL represent operation schemas by fetchable references.

#### Scenario: Resource has many registered operations
- **WHEN** an agent observes the resource
- **THEN** the current state and operation references remain available without inlining the full registry schema catalog

### Requirement: All callers use one broker path
UI, agent, and system callers SHALL invoke registered product actions through the same broker and domain handler.

#### Scenario: UI and agent invoke the same action
- **WHEN** UI and agent callers invoke the same registered action with equivalent authorized inputs
- **THEN** both calls execute the same handler and use the same validation, policy, audit, revision, and event logic

#### Scenario: Different agent runtimes use the same operation
- **WHEN** Codex and SciForge Runtime invoke the same operation reference with equivalent caller scope and input
- **THEN** both requests enter the same main-process agent adapter and broker; any runtime bridge only transports the request and result

### Requirement: Scoped resource handles
SciForge SHALL use opaque resource handles that bind caller audience, workspace scope, resource identity, semantic revision, and expiry without exposing internal paths or session identifiers.

#### Scenario: Handle used outside its scope
- **WHEN** a handle is forged, expired, or reused from another workspace or audience
- **THEN** the broker rejects the request before executing the provider

#### Scenario: Layout changes after observation
- **WHEN** only scroll, resize, or other layout state changes after a resource is observed
- **THEN** the semantic resource handle remains valid

#### Scenario: Stable reference renews a short-lived handle
- **WHEN** an authorized caller observes a previously issued opaque resource reference after its cached handle is absent or expired
- **THEN** the broker revalidates audience and workspace scope and issues a fresh handle for the same current semantic resource

#### Scenario: Cross-scope reference renewal
- **WHEN** a caller attempts to renew a resource reference from another workspace or a disallowed audience
- **THEN** the broker rejects the request before the provider executes

### Requirement: Mutation integrity
Registered mutations SHALL support declared revision checks, idempotency, audit records, and resource change events.

#### Scenario: Idempotent retry
- **WHEN** a caller repeats a completed mutation with the same invocation ID and equivalent input
- **THEN** the broker returns the prior result without executing the provider again

#### Scenario: Stale semantic revision
- **WHEN** a mutation supplies an expected revision older than the current semantic revision
- **THEN** the broker rejects it with a version conflict and makes no domain change

#### Scenario: Successful mutation
- **WHEN** an authorized mutation completes
- **THEN** the broker records its policy and before-after revisions and publishes a resource change event

### Requirement: Broker policy enforcement
SciForge SHALL enforce effect and approval policy before handler execution.

#### Scenario: UI-only or confirmation action called by agent
- **WHEN** an agent invokes an action whose audience excludes agents or whose approval has not been satisfied
- **THEN** the broker rejects the request and the handler is not called

### Requirement: Event reference liveness is explicit
SciForge SHALL project historical resource references with their current
liveness and SHALL NOT imply that an audit reference remains executable.

#### Scenario: Historical live reference
- **WHEN** an event page contains a reference that remains resolvable for the caller
- **THEN** the event marks it `live` and the ordinary observe path may renew its short-lived handle

#### Scenario: Historical retired reference
- **WHEN** an event page contains a reference whose backing resource or scoped reference has been retired
- **THEN** the event marks it `retired`, preserves it for audit, and invocation fails with `resource_ref_retired`
