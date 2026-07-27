# Runtime Directive Continuity Requirements

## Requirement: Persist accepted user directives

SciForge SHALL persist each accepted user directive before backend delivery using a stable client identity.

### Scenario: Active-turn correction

- **WHEN** a correction is steered into an active backend turn
- **THEN** the raw user-visible correction SHALL be present in the existing context ledger before delivery
- **AND** a retry with the same identity SHALL NOT duplicate delivery.

### Scenario: Ambiguous acknowledgement

- **WHEN** backend delivery may have succeeded but acknowledgement is lost
- **THEN** SciForge SHALL retain the directive as acknowledgement-uncertain
- **AND** SHALL NOT blindly deliver it again.

## Requirement: Preserve directives across compaction

SciForge SHALL inject the authoritative directive tail independently of lossy backend history compaction.

### Scenario: Later correction invalidates stale context

- **WHEN** a later user directive says earlier inputs or resources are stale
- **THEN** the next turn and direct steer SHALL contain that later directive after compaction
- **AND** SHALL state that later directives override conflicts.

## Requirement: Reuse backend execution receipts

SciForge SHALL use existing backend tool lifecycle events and the existing execution-integrity guard to validate requested execution.

### Scenario: Continuation has no new mutation receipt

- **WHEN** an active mutation request is followed by a continuation turn
- **AND** the backend ends that turn without a matching terminal mutation receipt
- **THEN** SciForge SHALL mark the turn incomplete or failed rather than completed.

## Requirement: Separate user and control steering

SciForge SHALL NOT treat governance or recovery control text as a user directive or authorization.

## Requirement: Accurate terminal presentation

SciForge SHALL distinguish backend turn completion from verified task completion and from failed, interrupted, or cancelled outcomes.
