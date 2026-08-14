## ADDED Requirements

### Requirement: Desktop and remote share one logical transcript
An active Session projection SHALL synchronize local and remote user messages and final assistant replies so that both surfaces represent one logical thread.

#### Scenario: Message starts on desktop
- **WHEN** a user submits a message in the linked SciForge thread
- **THEN** the local thread accepts the user message first
- **AND** the same logical user message is mirrored to the remote topic
- **AND** the final assistant reply is visible in both surfaces

#### Scenario: Message starts on mobile
- **WHEN** an authorized user submits a text message in the projected remote topic
- **THEN** the message is written once to the linked local thread with remote sender metadata
- **AND** the Agent runs in that same thread
- **AND** the final assistant reply is visible in both surfaces

### Requirement: Synchronization is idempotent
The system MUST maintain durable message receipts sufficient to prevent provider retries, reconnect replay, Bot self-events, and application restarts from creating duplicate local turns or duplicate logical remote messages.

#### Scenario: Provider redelivers an event
- **WHEN** the same provider message ID is received more than once
- **THEN** at most one local user message and one Agent turn are created
- **AND** later deliveries return the existing receipt state

#### Scenario: Outbound send times out after acceptance
- **WHEN** the provider accepted a message but the client did not receive a success response
- **THEN** retry uses the existing receipt/idempotency identity
- **AND** reconciliation prevents a second logical message from being treated as new work

### Requirement: Messages are ordered per projection
Executable messages for one projection SHALL be queued and processed in provider acceptance order; the system SHALL NOT run concurrent turns in the same linked thread.

#### Scenario: Two users send while a turn is running
- **WHEN** a second authorized message arrives before the first turn completes
- **THEN** the second message is visibly queued
- **AND** it starts only after the first message reaches a terminal state

### Requirement: Failures are visible and recoverable
Every accepted message SHALL reach delivered or failed state, and failed synchronization SHALL expose a redacted diagnostic and retry action without silently switching Session or Project.

#### Scenario: Zulip is temporarily unavailable
- **WHEN** outbound delivery fails with a retryable network or server error
- **THEN** the receipt remains pending/failed with a retry schedule
- **AND** the local thread remains authoritative and unchanged

#### Scenario: Linked local thread no longer exists
- **WHEN** a remote message targets a projection whose local thread is unavailable
- **THEN** the message is not executed in another thread
- **AND** the projection enters an explicit error state requiring relink or close

### Requirement: First release synchronization is append-only text
The first release SHALL synchronize text user messages and final assistant replies and SHALL NOT mutate local Agent history in response to remote edits, deletes, reactions, or streaming deltas.

#### Scenario: Remote message is edited
- **WHEN** a previously accepted remote message is edited
- **THEN** the existing local message and turn remain unchanged
- **AND** the system may record an audit event or require a new correction message

### Requirement: Remote synchronization does not bypass governance
Messages originating from IM SHALL use the same AgentRuntime mode, model selection, capability broker, approval, and audit path as messages submitted from the desktop.

#### Scenario: Remote request requires privileged external write
- **WHEN** the linked Agent requests a capability that requires approval
- **THEN** execution pauses in the canonical approval path
- **AND** the provider pairing does not grant or synthesize approval

### Requirement: Message origin remains attributable
The local transcript and synchronization ledger SHALL preserve whether a user message originated locally or remotely and, for remote messages, the provider sender ID and display name.

#### Scenario: Team reviews a shared Session
- **WHEN** multiple Zulip users contributed messages to one Session
- **THEN** the desktop transcript or message details can distinguish their remote identities
- **AND** secrets and provider credentials are absent from that metadata
