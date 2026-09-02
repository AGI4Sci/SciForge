# Chat Research Checkpoints Requirements

## Requirement: Automatic policy is durable, independent and controllable from Dossier

SciForge SHALL persist automatic policy independently from recording lifecycle for each workspace/runtime/thread and SHALL default it to `enabled`. Canonical status SHALL expose `policyRevision`; Start and Stop SHALL require `expectedPolicyRevision`, reject stale revisions before mutation, and return the new revision. Research Dossier SHALL expose owner-backed `stop` and `start` while status is waiting, active or stopped; ordinary chat and composer SHALL NOT expose recording controls. `stop` SHALL persistently disable future automatic recording and close an active recording if one exists. `start` SHALL re-enable policy without emitting a checkpoint Version; the next accepted, completed turn SHALL create v1. Turns accepted while disabled SHALL remain unrecorded unless explicitly imported as legacy/incomplete.

### Scenario: First accepted turn

- **WHEN** a new conversation with no stored policy accepts its first turn
- **THEN** the Host SHALL treat automatic recording as enabled
- **AND** SHALL persist a boundary before provider dispatch
- **AND** a completed turn SHALL create checkpoint v1.

### Scenario: User stops before the first turn

- **WHEN** Dossier status is `waiting` with automatic policy enabled and the user invokes `stop`
- **THEN** the owner SHALL persist automatic policy as disabled
- **AND** the stop receipt SHALL contain `recording: null`
- **AND** SHALL contain the incremented `policyRevision`
- **AND** subsequent turns SHALL remain unrecorded across restart.

### Scenario: User stops an active recording from Dossier

- **WHEN** an existing recording's Dossier invokes `stop`
- **THEN** the system SHALL persist the disabled policy
- **AND** subsequent turns and application restarts SHALL NOT implicitly create another recording or checkpoint
- **AND** existing checkpoint history SHALL remain readable and unchanged.

### Scenario: User re-enables automatic recording

- **WHEN** Dossier invokes `start` while automatic policy is disabled
- **THEN** the system SHALL persist the enabled policy
- **AND** SHALL NOT emit a checkpoint Version or backfill turns that occurred while disabled
- **AND** the next accepted, completed turn SHALL create checkpoint v1.

### Scenario: Policy revision is stale

- **WHEN** Start or Stop supplies an `expectedPolicyRevision` different from canonical status
- **THEN** the request SHALL fail before changing policy or recording state
- **AND** the caller SHALL re-read status before retrying.

### Scenario: Disabled attempt is replayed after response loss

- **WHEN** an automatic attempt observes disabled policy
- **THEN** its exact Host attempt identity SHALL durably record a `skipped` decision with no recording or binding snapshot
- **AND WHEN** the same attempt is replayed after response loss
- **THEN** it SHALL remain skipped even if a later Start changed policy to enabled.

### Scenario: Default chat remains compact

- **WHEN** policy is waiting, enabled or disabled
- **THEN** ordinary chat and composer SHALL NOT render Start/Stop controls
- **AND** Dossier SHALL remain the canonical control surface.

## Requirement: Before-turn boundaries are owned by a durable delivery attempt

Before provider delivery, the Host SHALL persist a stable installation `issuerEpoch`, allocate a monotonic `deliveryAttemptOrdinal` within that epoch, generate a random `deliveryAttemptId`, persist its workspace-bound pending start in Turn Artifact Outbox V4, and acquire a boundary lease bound to that attempt. The lease SHALL NOT be derived from `clientDirectiveId`. For enabled policy, Research Checkpoints SHALL atomically bind the open lease to one `recordingId` and one exact binding snapshot. Acquisition and settlement SHALL be idempotent and SHALL reject scope or disposition conflicts.

### Scenario: Boundary persistence fails

- **WHEN** the Host cannot durably persist either the delivery-attempt start or its before-turn lease
- **THEN** it SHALL NOT dispatch the turn to the provider.

### Scenario: Authoritative terminal settlement is not completed

- **WHEN** Turn Artifact Outbox V4 owns an authoritative failed, cancelled or rejected terminal settlement
- **THEN** the Host SHALL deliver that settlement at least once until its consumer receipt is durable
- **AND** Research Checkpoints SHALL idempotently set the lease to `released` and clear its self-contained exact binding snapshot
- **AND** Research Checkpoints SHALL NOT create a successful checkpoint for that turn
- **AND** replay of the same settlement SHALL NOT change the disposition.

### Scenario: Provider delivery outcome is ambiguous

- **WHEN** the Host cannot prove whether provider delivery or its terminal outcome occurred
- **THEN** Outbox V4 SHALL retain the durable owner and Research Checkpoints SHALL keep the lease `open` and fail closed
- **AND** the system SHALL NOT classify the attempt as rejected or release it by age, process restart or runtime generation.

### Scenario: Application restarts with an open lease

- **WHEN** startup reconciliation receives the complete Host-authoritative durable owner snapshot
- **THEN** it SHALL validate `issuerEpoch`, next issued ordinal, exact retired ranges and each owner's ordinal/attempt/workspace/runtime/thread/directive/turn scope
- **AND** an issued ordinal SHALL exist as an owner/receipt or in an exact retired range
- **AND** a missing ordinal, owner conflict or retired `open` lease SHALL fail closed rather than imply release
- **AND** SHALL retain or settle every owned lease according to its pending-start, watch, completed-intent or terminal-settlement phase.

## Requirement: Turn Artifact Outbox V4 durably owns lifecycle settlement

Turn Artifact Outbox V4 SHALL durably represent pending start, provider-accepted watch, completed artifact intent and terminal settlement. Settlement handoff SHALL be at least once and SHALL retry until a durable consumer receipt exists. Owner snapshots SHALL include one exact issuer epoch, next ordinal and exact retired ordinal ranges and SHALL be complete and authoritative for Research Checkpoints reconciliation. It SHALL NOT use Bloom filters or time cutoffs.

### Scenario: Provider returns an authoritative accepted handle

- **WHEN** provider `startTurn` returns an exact accepted turn handle
- **THEN** the Host SHALL atomically bind the matching pending start to a watch
- **AND** SHALL NOT discover that binding by scanning text, latest turn or historical turns.

### Scenario: Provider acceptance remains ambiguous

- **WHEN** a pending start has no authoritative accepted handle
- **THEN** it SHALL remain durably pending and fail closed
- **AND** generic governed list/resolve/release SHALL be the only explicit recovery surface
- **AND** list/release SHALL validate runtime, thread and workspace owner scope
- **AND** resolve SHALL additionally verify the exact provider turn and user-message item before binding.

### Scenario: Settlement delivery is interrupted

- **WHEN** a terminal settlement was persisted but consumer delivery or acknowledgement is interrupted
- **THEN** Outbox V4 SHALL retry the same settlement identity
- **AND** Research Checkpoints SHALL idempotently adopt it without a conflicting or duplicate disposition.

### Scenario: Owner snapshot conflicts with a lease

- **WHEN** an owner changes the delivery attempt, workspace, runtime, thread, directive, turn or terminal disposition of an existing lease
- **THEN** reconciliation SHALL fail closed
- **AND** SHALL NOT release or consume the conflicting lease.

### Scenario: Receipts retire after both acknowledgements

- **WHEN** lifecycle settlement and related artifact delivery are both durably acknowledged and no live start/watch/intent/settlement remains
- **THEN** bounded receipts MAY retire into exact ordinal ranges for their issuer epoch
- **AND** the retired range SHALL remain exact anti-replay evidence.

### Scenario: One thread has a pending gap

- **WHEN** one runtime/thread has an unresolved pending start or settlement retry
- **THEN** its ordering SHALL remain blocked as required
- **AND** unrelated runtime/thread delivery SHALL continue independently.

## Requirement: Consecutive turns use a deterministic pending predecessor

When a prior turn's output is locally and exactly verified but its Artifact transaction is still pending, the next lease SHALL freeze that output as a pending predecessor overlay using stable operation identity and exact bytes/ref. It SHALL NOT wait for commit merely to establish the boundary, and SHALL NOT fall back to a stale committed current.

### Scenario: Next turn starts before prior commit completes

- **WHEN** the prior turn has a locally verified pending output with stable operation identity and exact bytes/ref
- **THEN** the following lease SHALL atomically include it in the exact binding snapshot for the same recording
- **AND** strict patch replay SHALL use that pending predecessor.

### Scenario: Pending predecessor is not exactly verified

- **WHEN** the pending operation identity or exact bytes/ref cannot be verified
- **THEN** it SHALL NOT enter the overlay
- **AND** the system SHALL fail closed rather than claim continuous lineage from a stale current.

## Requirement: Domain capability invocation is package scoped

The Host SHALL create a system capability invoker for each installed domain runtime whose caller identity is derived from authoritative package composition. Privileged behavior SHALL be authorized by generic Broker grants defined by SDK contracts. An owner domain SHALL NOT hard-code a consumer domain ID or action-specific application-core branch.

### Scenario: Checkpoint requests deterministic identities

- **WHEN** Research Checkpoints invokes Artifact Versions through its production-composed scoped invoker with the requested-identity grant
- **THEN** the Broker SHALL allow deterministic Artifact and Version identities
- **AND** the output candidates and checkpoint SHALL reach the canonical Artifact Versions commit handler.

### Scenario: Caller lacks the requested-identity grant

- **WHEN** any caller requests deterministic Artifact or Version identities without the generic grant
- **THEN** the Broker SHALL reject the request before owner state changes
- **AND** Artifact Versions SHALL NOT decide authorization by comparing the caller to a concrete domain ID.

## Requirement: Checkpoints and trusted outputs commit atomically

Each recording SHALL retain one stable checkpoint Artifact identity. Trusted changed outputs SHALL have independent stable Artifact identities, and all output candidates plus the producing checkpoint SHALL enter one optimistic Artifact Versions transaction.

### Scenario: One output candidate is stale

- **WHEN** any candidate has a stale current, identity conflict or invalid exact content
- **THEN** no output current and no checkpoint current SHALL advance.

### Scenario: Commit response is lost

- **WHEN** the Artifact transaction committed but the producer lost its response
- **THEN** replay SHALL adopt the same exact Versions without rerunning the producer or creating duplicates.

### Scenario: Production-composed file output commits

- **WHEN** a completed turn contains a valid Host-authenticated `apply_patch/fileChange` receipt
- **THEN** the production Host/Broker/domain composition SHALL commit that output and its checkpoint in one transaction
- **AND** the test SHALL NOT inject a privileged caller or construct another domain's private service directly.

## Requirement: File attribution remains fail closed

Only a successful Host-authenticated Codex `apply_patch/fileChange` receipt with complete call, sequence, path, patch/content and terminal byte verification SHALL qualify as trusted file lineage. External Terminal, IDE, PTY, ordinary `exec_command`, watcher, recursive scan, Git diff, mtime, stdout, exit status and later hash SHALL remain observation only.

### Scenario: Strict patch replay matches terminal bytes

- **WHEN** ordered authenticated hunks replay from the exact before-turn parent and match the independently captured terminal digest and length
- **THEN** the path MAY become an output Version in the atomic transaction.

### Scenario: Ambient write occurs in the same time window

- **WHEN** another process changes a file during the turn without a matching authenticated receipt
- **THEN** that path SHALL remain `untracked/incomplete` even if its time, diff or later digest appears related.

## Requirement: Persisted research text is privacy bounded

New checkpoint text and journal free-form fields SHALL be structurally redacted and passed through the Host opaque-secret sanitizer before identity/digest persistence. Source URLs SHALL remove userinfo and fragments and redact sensitive query values. New checkpoint/output access policy SHALL be workspace-only with export disabled.

### Scenario: Narrative contains a configured secret and signed URL

- **WHEN** a turn contains an opaque settings secret or token/signature query parameter
- **THEN** neither the checkpoint manifest, producer journal, CAS manifest nor bundle-visible metadata SHALL contain the original value.

## Requirement: Capacity failure preserves prior durable state

Artifact index, workspace CAS, active staging and checkpoint store SHALL have hard bounds checked before publishing a new current/index state. The system SHALL NOT silently delete committed immutable history to recover capacity.

### Scenario: A new batch exceeds the CAS budget

- **WHEN** committing its new unique objects would exceed the workspace budget
- **THEN** the commit SHALL fail before publishing objects or index changes
- **AND** prior current pointers and readable history SHALL remain unchanged.

### Scenario: A lease clears its self-contained snapshot

- **WHEN** an authoritative terminal settlement says a turn failed, was cancelled or was rejected
- **THEN** its lease SHALL become `released` and clear its exact binding snapshot
- **AND WHEN** a completed turn's artifact intent/event is durably owned and atomically enqueued
- **THEN** its lease SHALL become `consumed` and clear its exact binding snapshot.

## Requirement: Main chat contains only exact Dossier navigation

After a checkpoint commits, the producing turn MAY show one neutral “打开科研档案” entry bound to the exact Version ID and expected digest. It SHALL NOT show the expanded research record, version badge, change reason, outputs/previews, provenance warning, internal identifiers or a composer recording/current-version strip.

### Scenario: User opens a committed entry

- **WHEN** the user activates “打开科研档案”
- **THEN** Research Dossier SHALL load that exact Version and digest
- **AND** SHALL NOT resolve `latest`.

## Requirement: Dossier prioritizes researcher decisions

Research Dossier SHALL present research findings, sources, outputs, version position, reproduction status and actionable limitations by default. Raw identifiers, digests, receipts and codes SHALL be available in collapsed technical details. Empty and inapplicable projections SHALL be omitted, while access, integrity, claimed-owner and blocking failures remain visible.

### Scenario: An ordinary research output has no compute claim

- **WHEN** an output does not declare a Compute, Evidence or Review projection
- **THEN** the unrelated section SHALL be omitted rather than reported unavailable.

### Scenario: Exact owner projection mismatches

- **WHEN** an owner returns a different ref, digest, scope, availability or access policy
- **THEN** the Dossier SHALL fail closed and SHALL NOT substitute current/latest content.

## Requirement: V1 wire compatibility is exact

Every Artifact Versions action that existed before this change SHALL retain its original strict V1 input, output, issue and selector semantics. Additive requested identity, staged object, range read, rich list/describe and directory Bundle behavior SHALL use explicit V2 actions.

### Scenario: A strict V1 client decodes list/export/commit

- **WHEN** an existing client uses the origin V1 schemas
- **THEN** the response SHALL contain no new required or unknown V2-only fields
- **AND** an empty V1 export selector SHALL still be rejected rather than export the workspace.

## Requirement: Changed public packages have an installable release boundary

`@sciforge/domain-sdk` SHALL publish the changed public contracts as version `0.2.0`. Because Artifact Versions preserves its V1 wire while adding V2, `@sciforge/domain-artifact-versions` SHALL publish as version `1.1.0` without regressing its existing `1.0.0` domain package identity. Packages consuming those contracts SHALL declare compatible `^0.2.0` and `^1.1.0` dependency ranges respectively. Verification SHALL install packed tarballs outside workspace linking and exercise their public exports and minimum production composition path.

### Scenario: Packed packages are independently installed

- **WHEN** the final package manifests are packed and installed into an empty temporary project
- **THEN** dependency resolution SHALL select versions containing all required V2 and grant contracts
- **AND** the smoke SHALL NOT rely on workspace symlinks or private source imports.

## Requirement: Release evidence distinguishes passed and pending gates

The PR SHALL record package compatibility, privacy/capacity, dependency audit, repository regression, desktop acceptance, hygiene and remote mergeability as separate gates. A package-level pass SHALL NOT be reported as a repository, Electron or remote-merge pass. Known failures and unverified gates SHALL remain explicit until rerun on the final staged-equivalent source.

### Scenario: Root regression has unresolved failures

- **WHEN** focused package suites pass but root tests still contain failing assertions or an Electron concurrency collision
- **THEN** the PR SHALL report the focused passes and root failure diagnosis separately
- **AND** SHALL NOT mark the root test, build, Electron or mergeability gates complete.

### Scenario: Dependency audit reports vulnerabilities

- **WHEN** clean install reports known moderate or high dependency vulnerabilities
- **THEN** the PR SHALL record counts and disposition
- **AND** SHALL NOT apply a breaking automatic audit fix without compatibility review.
