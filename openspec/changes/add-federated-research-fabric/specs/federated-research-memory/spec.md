# Federated Research Memory Requirements

## Requirement: Research memory is layered by authority

SciForge SHALL keep cross-institution project knowledge in Cloud Project DAG, institution-private
scientific evidence in Site Evidence DAG, and non-scientific user preferences in Shared Memory.

### Scenario: Site records a failed experiment

- **WHEN** a Site Agent records a failed experiment with local data, logs, and environment
- **THEN** the ExperimentRun and detailed evidence SHALL enter the Site Evidence DAG
- **AND** only an authorized EvidenceCapsule MAY enter Cloud Project Memory
- **AND** the failure SHALL NOT be stored solely as free-form Shared Memory.

### Scenario: User preference is remembered

- **WHEN** a user asks SciForge to prefer Chinese output or begin with a small sanity check
- **THEN** that preference MAY be stored in personal Shared Memory
- **AND** it SHALL NOT be represented as a scientific Project Claim.

## Requirement: Cloud storage is not the sole scientific memory

Cloud SHALL store durable project coordination and explicitly shared knowledge, but Site Agents
SHALL remain able to use authorized local Evidence Snapshots without uploading all source content.

### Scenario: Restricted source data remains local

- **WHEN** a task depends on restricted Site data
- **THEN** the local Agent SHALL resolve permitted evidence and execute beside the data
- **AND** Cloud memory SHALL contain at most the permitted digest, metadata, result, and provenance
  summary.

### Scenario: Cloud is temporarily unavailable

- **WHEN** a Site has a valid WorkOrder, lease, and locally cached Project Snapshot
- **THEN** Site policy MAY allow the task to continue using local Evidence and the captured project
  context
- **AND** the resulting packet and output SHALL report their actual snapshot freshness.

## Requirement: Agents receive task-scoped Memory Packets

Agents SHALL obtain long-term context through a Research Memory Resolver that enforces project,
task, principal, Site, snapshot, policy, and budget boundaries.

### Scenario: Site Agent starts an experiment task

- **WHEN** the Agent begins planning
- **THEN** the Resolver SHALL return a Memory Packet bound to the Project Snapshot digest, authorized
  Site Evidence Snapshot digests, principal, policy digest, generated time, and freshness
- **AND** the Agent SHALL NOT receive unrestricted Cloud or Site database credentials.

### Scenario: Agent belongs to another institution

- **WHEN** an Agent requests context for a Project it can access but lacks permission for a private
  Evidence item
- **THEN** the Resolver SHALL hide the content and local locator
- **AND** MAY return a bounded restricted-evidence diagnostic if policy permits existence disclosure.

## Requirement: Memory Packets are snapshot-derived and naturally invalidated

Research Memory Packets and semantic indexes SHALL be derived views addressed by immutable snapshot
and policy identities, not independent factual state machines.

### Scenario: Project Decision is superseded

- **WHEN** a new committed Project Snapshot supersedes a prior method Decision
- **THEN** a current resolution SHALL not return the old Decision as active
- **AND** a cached packet for the old snapshot MAY remain inspectable as historical context but SHALL
  report stale relative to the current project.

### Scenario: Access policy changes

- **WHEN** the principal's access policy digest changes
- **THEN** packets and indexes keyed by the prior policy SHALL not be reused for current resolution.

## Requirement: Memory prioritizes governed knowledge over conversation history

The Resolver SHALL prioritize active Goal, Decision, supported or conflicted Claims, negative
results, open questions, provenance identity, and applicability constraints within the context
budget.

### Scenario: Context budget is limited

- **WHEN** the Agent requests a small Memory Packet
- **THEN** the Resolver SHALL retain scope, status, critical constraints, known negative results,
  conflicts, and evidence identities before low-value narrative history.

### Scenario: Only a conversation mentioned a conclusion

- **WHEN** a claim appears in chat but has not entered a committed Evidence or Project Snapshot
- **THEN** the Resolver SHALL label it ungoverned or omit it from authoritative memory
- **AND** SHALL NOT present it as a stable project fact.
