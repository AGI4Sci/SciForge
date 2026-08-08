## ADDED Requirements

### Requirement: One authoritative Artifact Version owner
SciForge SHALL assign research Artifact identity, immutable Version records, verified bytes, current pointers, structural dependencies, lifecycle events, restore, and bundles exclusively to the Artifact Versions domain, and consumers SHALL NOT maintain another live Registry or current pointer.

#### Scenario: Evidence ingests a source
- **WHEN** Evidence creates a SourceAnchor for a research source
- **THEN** the anchor pins a full `ArtifactVersionRefV1` issued by Artifact Versions and never resolves a latest version

#### Scenario: A producer saves identical bytes explicitly
- **WHEN** save, rerun, restore, or publish commits bytes already present in CAS
- **THEN** a new immutable semantic Version is appended while the underlying content object is deduplicated

#### Scenario: A stale editor commits
- **WHEN** an existing Artifact commit supplies an expected current Version that no longer matches
- **THEN** the whole transaction is rejected as stale and no candidate becomes current

### Requirement: Durable lifecycle propagation without historical mutation
Evidence DAG SHALL consume ordered Artifact lifecycle events with durable cursors and idempotent receipts, SHALL enqueue every affected thread before advancing its cursor, and SHALL create a new Evidence Snapshot for changed status.

#### Scenario: A source becomes missing
- **WHEN** Artifact Versions records a missing or content-changed event for a pinned source version
- **THEN** dependent Evidence becomes stale in a new Snapshot while the old Snapshot remains byte-for-byte resolvable

#### Scenario: A lifecycle page fails partway
- **WHEN** one affected thread cannot be durably enqueued
- **THEN** the cursor does not pass that page and a restart retries it without duplicating completed receipts

### Requirement: Exact scientific-plot provenance and reproduction
Scientific Plotting SHALL record data versions, transformations, statistical definitions, resolved parameters, renderer/environment, review state, and expected outputs, and formal reruns SHALL read only exact Artifact Version bytes.

#### Scenario: Only style changes
- **WHEN** a figure is saved with unchanged data, transformations, and statistics but different resolved style
- **THEN** a new Figure Version is appended and comparison attributes the difference to style rather than data or statistics

#### Scenario: A historical plot reruns in a clean workspace
- **WHEN** its exact dependency bundle is verified and imported into an empty workspace
- **THEN** rerun uses imported CAS refs without original mutable paths and records `replicates` or `fails-to-replicate`

#### Scenario: A required scientific input is unavailable
- **WHEN** an exact input, extractor, permission, environment, or digest cannot be verified
- **THEN** rerun fails closed with a provenance breakpoint and does not fall back to latest or a similarly named file

### Requirement: Version-bound human review
Visual Review SHALL bind candidate bytes to an exact Artifact Version, SHALL leave current unchanged on reject, and SHALL append an accepted version with an exact `reviewed-from` dependency.

#### Scenario: Candidate bytes do not match their ref
- **WHEN** digest, size, media type, availability, or registry identity differs from the supplied version ref
- **THEN** staging or accept fails before a formal version commit

#### Scenario: Activation fails after commit
- **WHEN** the Artifact transaction succeeds but local review activation is interrupted
- **THEN** a durable receipt permits idempotent recovery without another Version or a permanently ambiguous candidate

### Requirement: Fixed-snapshot semantic exports are versioned
Evidence DAG SHALL generate semantic exports only for an explicitly supplied immutable Snapshot digest and SHALL atomically save their bytes through Artifact Versions with exact source-version dependencies.

#### Scenario: Export digest is stale or unknown
- **WHEN** the requested digest is not the exact committed Snapshot selected for export
- **THEN** generation fails closed and no export Version is committed

#### Scenario: Several export formats are requested
- **WHEN** PROV, RO-Crate, DataCite, audit, and reproduction reports are exported together
- **THEN** all files commit in one idempotent transaction or none do, and every receipt identifies the fixed Snapshot digest

### Requirement: Exact portable dependency bundles
Artifact bundle export SHALL include only explicitly selected Versions and their transitive exact dependencies, and import SHALL verify every manifest and CAS object digest before atomically installing records.

#### Scenario: An older Figure Version is exported
- **WHEN** the same Artifact also has newer history
- **THEN** the bundle contains the selected old Figure and its pinned dependency closure, not unrelated newer versions

#### Scenario: A bundle object is corrupted
- **WHEN** object bytes do not match the manifest digest
- **THEN** verification and import fail without partially installing records
