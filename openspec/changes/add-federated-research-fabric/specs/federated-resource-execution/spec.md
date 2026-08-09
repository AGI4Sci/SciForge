# Federated Resource Execution Requirements

## Requirement: Resources are offered as bounded execution venues

An institution SHALL share compute or instrument capacity through expiring ResourceOffers and
typed task capabilities rather than general remote login or direct global scheduler control.

### Scenario: Institution offers GPU capacity

- **WHEN** a Site chooses to share GPU capacity with a project
- **THEN** its ResourceOffer SHALL declare bounded requirements, supported runtime constraints,
  quota, validity, and policy summary
- **AND** another institution SHALL submit a WorkOrder rather than receive a Site shell account.

### Scenario: Offer expires before reservation

- **WHEN** Cloud attempts to place a task after the offer expires
- **THEN** the Site SHALL reject the reservation as stale
- **AND** the Cloud SHALL refresh discovery instead of assuming the old capacity still exists.

## Requirement: Execution uses two-phase reservation and lease

Cloud SHALL first request a Site reservation and SHALL create an ExecutionLease only after the Site
confirms current policy and capacity.

### Scenario: Site can run the task

- **WHEN** the Site validates the WorkOrder and reserves compatible capacity
- **THEN** it SHALL return a short-lived Reservation bound to the task version and requested resource
- **AND** Cloud SHALL explicitly commit or release it before expiry.

### Scenario: Site capacity changes

- **WHEN** local capacity or policy becomes incompatible before lease commit
- **THEN** the Site MAY reject or expire the Reservation
- **AND** Cloud SHALL NOT treat the provisional reservation as a running task.

## Requirement: Local scheduler remains authoritative for actual execution

Site Node SHALL adapt a committed ExecutionLease to the institution scheduler through one canonical
adapter path and SHALL report actual scheduler receipts and state without exposing scheduler
authority to Cloud.

### Scenario: WorkOrder enters Slurm

- **WHEN** a committed lease targets a Slurm-backed capability
- **THEN** Site Node SHALL submit exactly one bounded job using the canonical local adapter
- **AND** TaskEvents SHALL distinguish `leased`, `queued_at_site`, and `running`.

### Scenario: Cancellation is requested

- **WHEN** Cloud or an authorized human requests cancellation
- **THEN** Site Node SHALL submit cancellation through the local scheduler adapter and report
  `cancel_requested` until the scheduler confirms a terminal state
- **AND** SHALL NOT report cancellation complete merely because the request was accepted.

## Requirement: Data locality and policy precede idle capacity

Placement SHALL prefer execution beside authorized data and SHALL never move restricted inputs only
because another Site has faster or idle resources.

### Scenario: Data is Site-only

- **WHEN** an input Artifact is marked `site-only`
- **THEN** Cloud placement SHALL select an authorized capability at that Site or report no eligible
  placement
- **AND** SHALL NOT copy the Artifact to another Site or Cloud exchange storage.

### Scenario: Input is approved for transfer

- **WHEN** policy permits a versioned input Artifact to be transferred
- **THEN** the transfer SHALL use a scoped ArtifactRef, digest verification, bounded authorization,
  and an auditable receipt
- **AND** task execution SHALL bind the received digest rather than an unversioned filename.

## Requirement: Result publication is separate from local completion

Local execution completion SHALL NOT automatically make outputs visible to other institutions.

### Scenario: Task completes locally

- **WHEN** the local scheduler and Evidence ingestion complete successfully
- **THEN** Site Node SHALL record `completed_locally`, bind the Evidence Snapshot identity, and begin
  export review according to Site policy.

### Scenario: Only derived results may leave

- **WHEN** Site policy permits metrics and plots but forbids raw outputs
- **THEN** the published ResultManifest SHALL include only allowed derived ArtifactRefs and a bounded
  EvidenceCapsule
- **AND** private artifacts SHALL remain locally addressable only.

### Scenario: Export is rejected

- **WHEN** required Site review rejects result egress
- **THEN** Cloud SHALL see a policy-safe `export_rejected` or `publication_blocked` state
- **AND** SHALL NOT infer that local computation failed.

## Requirement: Accepted results carry reproducibility and integrity evidence

A federated ResultManifest SHALL bind the WorkOrder version, Site, workload identity, execution
environment, input digests, output digests, timestamps, terminal status, Evidence Snapshot, and
signature.

### Scenario: Result digest does not match

- **WHEN** Cloud or another authorized consumer retrieves an Artifact whose digest differs from the
  signed ResultManifest
- **THEN** it SHALL reject the Artifact as an integrity failure
- **AND** SHALL NOT compile it into the accepted Project Snapshot.

### Scenario: Independent verification is required

- **WHEN** WorkOrder policy requires an independent verifier
- **THEN** the result SHALL remain pending acceptance until a distinct authorized actor records the
  verification outcome against the same result and evidence digests.
