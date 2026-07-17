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

### Requirement: Agent transport hides infrastructure fields
SciForge SHALL expose owned capabilities to agents only through stable broker meta-tools whose domain inputs exclude transport coordination fields.

#### Scenario: Agent invokes a mutation
- **WHEN** an agent invokes an observed operation with its operation reference and domain input
- **THEN** the adapter supplies the current handle revision and a generated invocation ID without requiring either from the model

#### Scenario: Agent inspects a surface
- **WHEN** an agent requests an available surface inspection operation
- **THEN** it does not provide a snapshot token, component ID, raw target coordinate, or layout revision

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
