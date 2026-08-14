## ADDED Requirements

### Requirement: Pairing targets one SciForge installation
The system SHALL pair an authenticated IM provider account with one stable SciForge installation without requiring a Project or workspace selection.

#### Scenario: First-time Zulip pairing
- **WHEN** an operator supplies a Zulip realm, bot identity, valid API credential, and approved remote access scope
- **THEN** the system creates one pairing owned by the current SciForge installation
- **AND** the pairing is usable before any Session projection exists

#### Scenario: Project is not selected
- **WHEN** an operator completes pairing while no Project is focused
- **THEN** pairing succeeds
- **AND** no synthetic workspace or hidden default Session is created

### Requirement: Pairing identity is independent of remote display names
The system MUST assign a stable opaque pairing ID and MUST NOT derive pairing identity from channel names, topic names, user-visible labels, or filesystem paths.

#### Scenario: Remote channel is renamed
- **WHEN** a paired remote channel changes its display name
- **THEN** the pairing ID remains unchanged
- **AND** the provider locator is reconciled without creating a second pairing

### Requirement: Provider credentials remain local secrets
Provider API keys, passwords, and refresh tokens MUST be stored through the local secret store and MUST NOT appear in application settings, QR payloads, logs, diagnostics, exported documentation, or Git-tracked files.

#### Scenario: Pairing status is rendered
- **WHEN** the renderer requests pairing status
- **THEN** it receives only non-sensitive identity, state, scope, and timestamps
- **AND** no credential value or reversible credential fragment is returned

### Requirement: Pairing ownership is explicit
At most one active SciForge installation SHALL own the execution lease for one provider pairing unless an operator explicitly transfers ownership.

#### Scenario: Second installation connects
- **WHEN** another installation attempts to activate the same provider identity
- **THEN** the system reports an ownership conflict
- **AND** it does not process remote messages until an explicit takeover succeeds

### Requirement: Pairing access scope is enforced
The pairing SHALL define which remote users or groups may submit executable messages, and commands from outside that scope SHALL be ignored and audited.

#### Scenario: Unauthorized channel subscriber posts
- **WHEN** a subscriber outside the approved access scope sends a message in a projected topic
- **THEN** the message is not written to an AgentRuntime thread
- **AND** an audit record identifies the rejected remote sender and target projection

### Requirement: Pairing is provider-extensible through one contract
Provider-specific authentication, event, locator, send, and lifecycle behavior SHALL implement the domain provider adapter contract; the Host SHALL NOT branch on provider IDs.

#### Scenario: A provider package is installed
- **WHEN** generated domain composition discovers a provider adapter contribution
- **THEN** the remote-client domain can offer that provider without editing a central provider map or Host-private configuration
