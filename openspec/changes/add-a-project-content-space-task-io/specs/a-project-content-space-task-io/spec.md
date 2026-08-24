# A Project ContentSpace and Task file-I/O requirements

## ADDED Requirements

### Requirement: Project ContentSpace binding requires current-Principal authorization

Cloud SHALL treat a portable ContentSpace locator only as an opaque locator. Creating or revising a Project binding SHALL require a trusted E/Host authorization proof verified for the exact current Principal, Project root, required read/upload scopes, and validity interval. Cloud SHALL cross-bind the verified result to the current actor Principal digest and SHALL fail closed when no trusted verifier is configured.

#### Scenario: A locator is supplied without proof

- **WHEN** an authorized Project owner supplies a valid portable container locator without a valid E/Host proof
- **THEN** Cloud SHALL reject the binding
- **AND** SHALL NOT infer authorization from the locator or envelope.

#### Scenario: A proof belongs to another Principal

- **WHEN** E/Host proof metadata does not match the exact current OIDC identity or credential Principal digest
- **THEN** Cloud SHALL reject the binding before persisting any Project revision.

### Requirement: Typed file intent is the sole caller-authored file truth

Task creation SHALL accept only a strict, bounded `TaskFileIntent`. Caller input SHALL NOT contain `resourceRefIds` or caller-selected Cloud ResourceRef identities. Cloud SHALL atomically derive one input ResourceRef for every typed input and one output-container ResourceRef for the active Project binding root.

#### Scenario: Caller supplies ResourceRef IDs

- **WHEN** a Task create request includes `resourceRefIds` in addition to `fileIntent`
- **THEN** the strict command schema SHALL reject the request
- **AND** no Task or ResourceRef SHALL be written.

#### Scenario: Cloud derives typed ResourceRefs

- **WHEN** a valid file Task is created against the current binding revision
- **THEN** Cloud SHALL derive all ResourceRef IDs inside the Task transaction
- **AND** each reference SHALL preserve Project, Task, execution, Task revision, binding revision, intent digest, role, ordinal, locator digest, and status.

### Requirement: executionId is the only assignment epoch

Every Task assignment SHALL persist exactly one execution fence containing `executionId`, assignee Agent, Task revision, binding revision, and intent digest. Reassignment SHALL create a new `executionId`; the system SHALL NOT add or infer `assignmentEpoch` or an equivalent epoch alias.

#### Scenario: An old execution reports after reassignment

- **WHEN** a former assignee submits progress, result, failure, or HumanNeeded using the previous `executionId`
- **THEN** Cloud SHALL reject the write
- **AND** current Task state and current ResourceRefs SHALL remain unchanged.

#### Scenario: Binding is removed during an open file execution

- **WHEN** an owner attempts to unbind a Project while an accepted or running file Task uses that binding revision
- **THEN** Cloud SHALL reject the unbind
- **AND** SHALL permit it only after open executions are terminal and their references are invalidated.

### Requirement: Forward-only schema lineage accepts only frozen sources

The canonical migrator SHALL accept fresh schema creation, exact common v4, exact public v5, and exact isolated v9. It SHALL use PostgreSQL catalog fingerprints in addition to version rows, apply only migration `0011`, converge to schema v11, and fail before mutation for unknown, hybrid, or partial lineage.

#### Scenario: A known route upgrades on PostgreSQL 17

- **WHEN** any frozen source route is migrated in an isolated PostgreSQL 17 database
- **THEN** it SHALL reach schema v11 and the canonical authoritative schema fingerprint
- **AND** all concurrency, binding, typed-intent, unbind/reassign, and stale-execution assertions SHALL run with zero skips.

#### Scenario: A catalog has a known version but different structure

- **WHEN** a database reports v4, v5, or v9 but its catalog fingerprint differs from the frozen source
- **THEN** migration SHALL fail before executing `0011`.

### Requirement: Only A-owned server semantics cross the donor boundary

This change SHALL include only A-owned OIDC, Device, Agent, human-approval, collaboration contract, and server behavior required by the canonical service. It SHALL NOT include B WorkerRunner, C identity UI, E ContentSpace implementation, or a parallel deployment directory.

#### Scenario: The change is audited by path and symbol

- **WHEN** the branch diff is compared with common base `941dafba5f9b94ecd2afedb4a50a804f10f35dd8`
- **THEN** modified product paths SHALL be limited to the approved A-owned packages and canonical deployment assets
- **AND** `assignmentEpoch`, WorkerRunner, identity UI, and ContentSpace provider implementation SHALL not be introduced.
