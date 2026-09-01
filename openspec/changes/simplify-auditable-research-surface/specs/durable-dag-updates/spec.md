## ADDED Requirements

### Requirement: Evidence has one durable delta owner and one authoritative head

Evidence DAG SHALL exclusively own completed-turn/execution Evidence ingestion, immutable delta ordering, authoritative thread heads, retry classification, and provisional compilation. Automatic capture SHALL append exact deltas and SHALL NOT require the Desktop Host, Project DAG, or another domain to publish, retry, or mark a complete Evidence Snapshot for every turn.

#### Scenario: A turn completes

- **WHEN** the Host publishes the canonical governed completion event
- **THEN** the Evidence package owns durable capture through one delta/queue path and advances its authoritative head after commit
- **AND** the Host and Project packages do not maintain another Evidence retry or terminal state machine.

#### Scenario: Evidence capture is interrupted

- **WHEN** processing stops after a predecessor delta or partial provisional compilation
- **THEN** restart resumes from the authoritative committed head and idempotency identities
- **AND** does not rewrite committed deltas or discard the last-good view.

### Requirement: Authoritative Evidence status separates committed history from pending interpretation

Evidence status SHALL expose the authoritative committed head and last-good provisional view separately from desired work, running work, bounded failure, freshness, coverage, and material risk. Historical failed attempts SHALL remain diagnostic and SHALL NOT override a newer committed head or successful view.

#### Scenario: New interpretation fails after a committed head

- **WHEN** the latest provisional compile or seal attempt fails after its input delta committed
- **THEN** status reports the committed head, last-good view, desired head, and failure separately
- **AND** ordinary UI continues to show last-good content as based on older Evidence.

#### Scenario: A newer head covers an older pending request

- **WHEN** a newer monotonic delta/head includes the input of an older accepted request
- **THEN** the older observation resolves as covered rather than corrupting current status or forcing duplicate work.

### Requirement: Evidence-to-Project propagation carries exact identity without forcing Project compilation

Evidence SHALL publish one canonical exact head/closure lifecycle event after durable commit. Project MAY use it to mark selected inputs stale or satisfy a requested derivation, but the event SHALL NOT require immediate compilation of every Project or copy Evidence payload into Project storage.

#### Scenario: Evidence advances while the Project surface is closed

- **WHEN** a Session selected by the Workspace's Project receives a newer committed Evidence head while the Project surface is closed
- **THEN** the canonical event lets Project mark the exact desired input stale
- **AND** does not require an immutable Project Snapshot or a global Project compile.

#### Scenario: Project does not include the Session

- **WHEN** an Evidence head advances for a Session outside a Project's captured desired Scope
- **THEN** Project ignores it for that Project and does not expand Scope by scanning the workspace.
