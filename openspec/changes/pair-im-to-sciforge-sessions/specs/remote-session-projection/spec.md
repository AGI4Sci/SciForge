## ADDED Requirements

### Requirement: One remote topic projects one local Session
Each active remote topic projection SHALL reference exactly one AgentRuntime runtime ID and thread ID, and ordinary messages in that topic SHALL NOT silently change the referenced Session.

#### Scenario: Two users post in one topic
- **WHEN** two authorized users send messages in the same projected Zulip topic
- **THEN** both messages enter the same local thread in provider order
- **AND** sender identity is recorded as message metadata rather than used to fork a Session

#### Scenario: User requests a new Session
- **WHEN** a user requests a new Session from an existing topic
- **THEN** the system creates a new local thread and a new remote topic projection
- **AND** the existing topic remains linked to its original thread

### Requirement: Project is a Session property
The projection SHALL derive its Project/workspace from the linked local thread, and pairing SHALL NOT own or require a workspaceRoot.

#### Scenario: Two Sessions share a Project
- **WHEN** two local threads use the same workspaceRoot
- **THEN** each thread may have an independent remote topic projection
- **AND** activity in one topic does not change the other topic's active thread

### Requirement: Projection identity survives rename
The system MUST assign a stable opaque projection ID and SHALL store remote topic names only as provider locators and display metadata.

#### Scenario: Local Session is renamed
- **WHEN** the local thread title changes
- **THEN** the projection keeps its ID and thread reference
- **AND** the provider adapter updates or reconciles the remote display title without generating a second projection

#### Scenario: Chinese topic title
- **WHEN** a topic title contains only non-ASCII characters
- **THEN** it receives a unique projection ID
- **AND** it cannot collide with another non-ASCII topic title

### Requirement: Projection lifecycle is explicit
The system SHALL support share/link, pause, resume, rename, close, and status operations for a Session projection.

#### Scenario: Projection is paused
- **WHEN** an operator pauses a projection
- **THEN** provider events remain non-executable and local messages are not mirrored to it
- **AND** the local thread, remote history, locator, and receipt history are retained

#### Scenario: Projection is closed
- **WHEN** an operator closes a projection
- **THEN** future provider messages cannot execute through it
- **AND** the system does not delete the local thread or remote topic history

### Requirement: Desktop focus does not retarget projections
A projection SHALL remain linked to its explicit thread until a lifecycle operation changes it; selecting another Project or Session in the desktop UI SHALL NOT retarget it.

#### Scenario: User changes the focused desktop Session
- **WHEN** a different desktop thread becomes active
- **THEN** existing remote projections retain their runtime ID, thread ID, and workspace

### Requirement: Multiple projections may execute in parallel
Different Session projections MAY process work concurrently, while each individual projection SHALL preserve its own ordered message queue.

#### Scenario: Two project topics receive messages
- **WHEN** messages arrive in two different projected topics
- **THEN** their local threads may run concurrently
- **AND** ordering within each topic remains deterministic
