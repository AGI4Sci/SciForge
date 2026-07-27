## ADDED Requirements

### Requirement: One durable update owner per DAG
SciForge SHALL assign Evidence extraction durability to the Evidence domain and Project compilation durability to the Project domain, and SHALL NOT maintain a second Project retry or terminal state machine in the desktop host.

#### Scenario: Evidence commits a new snapshot
- **WHEN** the Evidence domain commits the target watermark
- **THEN** the Project domain's durable handoff consumer observes the committed Evidence watermark through its public capability, submits Project once, and never occupies the Evidence execution slot

#### Scenario: Project observation exceeds a client deadline
- **WHEN** a Project job remains active after a client stops waiting
- **THEN** the job remains canonically queued or running and the client does not mark it failed or enqueue it again

### Requirement: Idempotent Project receipt and generation coverage
Project DAG SHALL return a stable receipt for a canonical desired fingerprint and SHALL consider a request complete when its generation is committed or monotonically covered by a newer committed generation.

#### Scenario: Identical input is submitted while active
- **WHEN** the same canonical Project input is submitted for an active job
- **THEN** Project DAG returns the existing receipt without incrementing the request generation

#### Scenario: A newer desired generation supersedes an accepted request
- **WHEN** generation N+1 includes a monotonic update beyond generation N and N+1 commits
- **THEN** generation N resolves as covered or superseded rather than timing out or failing

#### Scenario: A stale Evidence vector is submitted
- **WHEN** an update would replace a thread's newer committed Evidence snapshot with an older version
- **THEN** Project DAG rejects the regression with a typed error

### Requirement: Authoritative target-relative status
SciForge SHALL compute current DAG status from the latest target and authoritative committed state, and historical terminal attempts SHALL NOT override newer committed success.

#### Scenario: Historical Project coordination failed but a newer snapshot committed
- **WHEN** the Project service reports a committed snapshot covering the current target
- **THEN** the Project panel reports the snapshot as available and keeps the old failure only in history

#### Scenario: Application restarts with terminal jobs
- **WHEN** persisted terminal jobs are loaded
- **THEN** their occurrence and last-activity timestamps remain unchanged

#### Scenario: A pending Evidence delta fails
- **WHEN** an older committed Evidence snapshot remains valid and the latest delta fails
- **THEN** the UI keeps the committed graph visible and separately reports the failed delta

### Requirement: Typed structured-Evidence failures
Evidence DAG SHALL validate the terminal Responses state and structured output before JSON parsing for extraction and independent judgement operations, and SHALL expose stable error codes with bounded adaptive recovery.

#### Scenario: Model output is incomplete and empty
- **WHEN** the model returns `status=incomplete` with `max_output_tokens` and no output text
- **THEN** Evidence DAG reports `model_output_incomplete` with the incomplete reason and does not report a JSON parser error

#### Scenario: Deterministic structured operation exhausts its budget
- **WHEN** extraction, NLI verification, or adversarial review exhausts its operation-specific output budget without producing structured output
- **THEN** Evidence DAG increases the bounded output allowance at most once under the low-reasoning contract instead of replaying an identical request five times

#### Scenario: Transport fails transiently
- **WHEN** Model Router returns a retryable timeout, rate limit, or upstream failure
- **THEN** Evidence DAG applies bounded backoff while preserving the latest committed watermark

### Requirement: Truthful DAG progress and rendering
The DAG UI SHALL derive status from authoritative telemetry, SHALL NOT display fabricated percentages, and SHALL refresh graph frames only when committed identity changes.

#### Scenario: A job is active without measurable progress
- **WHEN** the service exposes a phase but no quantitative progress
- **THEN** the panel presents indeterminate progress and the current phase without a percentage

#### Scenario: Status polling returns the same snapshot
- **WHEN** repeated polls report the same committed URL and digest
- **THEN** the existing graph iframe remains mounted

### Requirement: Package-owned DAG features
Evidence DAG and Project DAG SHALL each be discoverable installed domain packages that own their backend, contracts, lifecycle entrypoint, and optional renderer entrypoint as one versioned unit.

#### Scenario: A DAG domain package is removed
- **WHEN** its manifest is absent from the installed-domain package set
- **THEN** all of its main and renderer contributions disappear without editing a host feature map or domain switch

#### Scenario: Host code composes DAG domains
- **WHEN** the application starts in source or packaged form
- **THEN** host code imports only generic SDK contracts and generated package entrypoints, never package-private or host-private domain implementation paths

### Requirement: Self-contained and transaction-safe domain runtimes
The packaged DAG runtimes SHALL start without mutating the host Python
environment, and every concurrent Project runtime actor SHALL own an isolated
SQLite connection with atomic job claims.

#### Scenario: Packaged DAG runtimes start without global Python packages
- **WHEN** Evidence and Project server entrypoints load from the unpacked package layout with Python site packages disabled
- **THEN** both entrypoints import successfully without a startup install or dependency fallback

#### Scenario: An API enqueue overlaps a Project worker transaction
- **WHEN** the API accepts a new Project generation while an update worker is claiming or committing work
- **THEN** each actor uses its own connection and both receipt generations remain durable without a nested transaction

### Requirement: Evidence update scope follows the public workspace contract
Evidence DAG SHALL receive workspace scope through its public update contract
and SHALL derive package-owned registry identity without Project-domain
metadata.

#### Scenario: A historical thread lacks captured workspace metadata
- **WHEN** the Evidence panel has a current workspace root but the agent thread detail does not
- **THEN** the manual update carries the panel workspace through the durable queue to the Evidence service

#### Scenario: An artifact event has no workspace scope
- **WHEN** a completed-turn artifact event cannot identify a workspace
- **THEN** Evidence DAG does not enqueue work that cannot safely resolve artifact provenance
