## ADDED Requirements

### Requirement: New features fail closed
New SciForge product features SHALL remain unavailable to UI and agent audiences until their provider, schemas, policies, and tests are registered successfully.

#### Scenario: UI advertises an unregistered action
- **WHEN** a renderer surface or visible-context resource references an action absent from the registry
- **THEN** validation or CI fails and the feature cannot be released

### Requirement: Agent access is executable
SciForge MUST NOT represent agent accessibility with free-standing booleans or hand-written tool names; agent access SHALL be derived from registered executable actions.

#### Scenario: Agent-visible capability has no handler
- **WHEN** a manifest declares the agent audience without an executable provider
- **THEN** registry validation fails

#### Scenario: Legacy owned tool remains public
- **WHEN** a migrated domain still exposes a per-feature agent tool or direct dispatcher alongside the broker meta-tools
- **THEN** the architecture check fails

### Requirement: Capability reference is generated
Human-readable capability documentation and visible-context access metadata SHALL be generated from the authoritative registry.

#### Scenario: Registry and documentation diverge
- **WHEN** a capability is added, renamed, or removed without regenerating its reference output
- **THEN** the documentation verification task fails

### Requirement: Domain cutovers are atomic
Each migrated domain SHALL remove its prior execution route in the same change that enables broker-backed UI and agent access.

#### Scenario: Duplicate domain providers
- **WHEN** tests detect more than one executable provider or a direct bypass for a migrated action
- **THEN** the architecture check fails

#### Scenario: Runtime scans legacy annotation storage
- **WHEN** normal observation code reads backup or legacy sidecar candidates instead of the canonical provider path
- **THEN** the architecture check fails

### Requirement: Registration contract tests are reusable
SciForge SHALL provide reusable tests that every provider can run for discovery, schema validation, audience policy, revision conflict, idempotency, audit, and event behavior.

#### Scenario: A new provider is introduced
- **WHEN** a developer registers a new provider
- **THEN** the standard provider contract suite verifies the provider before it is accepted
