# Change: Preserve runtime directive continuity

## Why

User corrections sent during or between backend turns can be visible in the UI without surviving runtime compaction. A later backend turn may then act on stale context or end without performing the still-active mutation request, while the UI presents the ended turn as processed.

## What Changes

- Extend the existing runtime context ledger with bounded, idempotent user directive records.
- Route normal messages, queued delivery, direct steering, and runtime handoff through one host continuity path.
- Inject the authoritative directive tail after lossy compaction for both new turns and steering.
- Feed active directive text into the existing execution-integrity guard so continuation turns inherit pending execution obligations.
- Distinguish an ended backend turn from a successfully completed execution in the timeline.
- Delete parallel task-contract, task-lifecycle, task-binding, and completion-evidence engines.

## Capabilities

### New Capabilities

- `runtime-directive-continuity`: Durable user-directive identity, compact-context continuity, and inherited execution-integrity requirements.

### Modified Capabilities

None.

## Impact

- Existing runtime context ledger and host turn/steer routing.
- Existing execution-integrity guard.
- Renderer directive identity and terminal-state presentation.
- No new runtime, task engine, resource provider, or compatibility path.
