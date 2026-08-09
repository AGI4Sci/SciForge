# Federated Project Coordination Requirements

## Requirement: One canonical cross-institution project state

SciForge SHALL assign cross-institution Goal, WorkOrder, accepted result, shared Decision, and
Project DAG state to one Cloud Coordinator for a project, while institution-private evidence remains
owned by the originating Site Node.

### Scenario: Two institutions contribute to one project

- **WHEN** two Site Nodes accept WorkOrders belonging to the same project
- **THEN** both SHALL report task events to the same canonical project event stream
- **AND** the Cloud Coordinator SHALL derive one member-visible Project DAG from accepted shared
  evidence and results
- **AND** neither Site Node SHALL maintain a competing project truth.

### Scenario: An institution keeps evidence private

- **WHEN** a Site policy permits sharing result metadata but not detailed Evidence nodes
- **THEN** the Cloud Coordinator SHALL store only the permitted EvidenceCapsule and ArtifactRefs
- **AND** SHALL NOT require a copy of the private Evidence DAG to mark the task delivered.

## Requirement: Versioned and immutable WorkOrders

Every federated task SHALL use a stable task identity, immutable version, idempotency key, explicit
inputs, requested capabilities, completion criteria, policy constraints, and provenance requirements.

### Scenario: A coordinator changes an active task

- **WHEN** a task's inputs, requested execution, policy, or completion criteria change
- **THEN** the Cloud Coordinator SHALL create a new WorkOrder version
- **AND** SHALL mark the prior version superseded or explicitly cancel it
- **AND** SHALL NOT mutate the accepted Site copy in place.

### Scenario: A duplicate delivery is received

- **WHEN** a Site Node receives the same task version and idempotency key more than once
- **THEN** it SHALL return the existing reservation, execution, or terminal receipt
- **AND** SHALL NOT submit a duplicate local job.

## Requirement: Durable, ordered, and observable project events

Commands and task events SHALL be persisted before publication, carry stable identities and
per-stream sequence information, and support acknowledgment and replay.

### Scenario: Site reconnects after network interruption

- **WHEN** a Site Node reconnects with its last acknowledged sequence
- **THEN** the Cloud Coordinator and Site Node SHALL replay missing events in order
- **AND** SHALL return a typed replay-gap when authoritative state must be refreshed.

### Scenario: UI stops waiting

- **WHEN** a Desktop client closes or times out while a federated task remains active
- **THEN** the canonical task SHALL remain queued or running
- **AND** client timeout SHALL NOT cancel, fail, or duplicate the task.

## Requirement: Human-readable project progress

SciForge SHALL present task ownership, current phase, last confirmed update, blocking reason,
pending approval, result status, and snapshot freshness without inventing progress.

### Scenario: A task is running without measurable percentage

- **WHEN** a Site reports `running` and a phase but no quantitative progress
- **THEN** the project UI SHALL show indeterminate progress, the phase, Site, and last update time
- **AND** SHALL NOT synthesize a completion percentage.

### Scenario: Institution rejects a task

- **WHEN** a Site rejects an offered WorkOrder
- **THEN** the project UI SHALL show a bounded, policy-safe rejection reason and whether the task can
  be revised or offered elsewhere
- **AND** SHALL NOT present the rejection as infrastructure failure.

## Requirement: Project decisions do not bypass Site authority

Cloud project autonomy SHALL be limited to proposing and coordinating actions allowed by project
policy; it SHALL NOT grant local data, resource, or egress authority on behalf of a Site.

### Scenario: Project Agent selects an institution GPU

- **WHEN** the Project Orchestrator proposes a WorkOrder for a Site resource
- **THEN** the Site SHALL perform its own current authorization and capacity checks before reservation
- **AND** a Cloud decision alone SHALL NOT create local execution authority.

### Scenario: Formal result acceptance

- **WHEN** project policy requires human or independent review for a result
- **THEN** the result SHALL remain published-but-unaccepted until the required decision is recorded
- **AND** the Project Agent SHALL NOT silently promote it to an accepted project conclusion.
