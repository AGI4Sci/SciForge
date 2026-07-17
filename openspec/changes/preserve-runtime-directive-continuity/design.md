# Design: Runtime directive continuity

## Principle

Codex and Claude Code remain authoritative for transcript, turn lifecycle, tool execution, and receipts. SciForge stores only the user directives that can otherwise disappear at the host boundary and reuses its existing context ledger and execution-integrity guard.

## Ledger extension

`RuntimeContextLedgerService` stores a bounded chronological directive tail per runtime thread. Each record contains a stable client ID, raw user-visible text, accepted time, delivery state, and optional backend turn ID. Reusing an ID with different text fails closed. A delivered ID is never sent twice. A delivery with ambiguous acknowledgement is retained and cannot be blindly retried.

The ledger remains the only shared-context persistence path. There is no second journal, task reducer, task binding, or lifecycle store.

## Unified delivery

Normal start, active-turn steer, queued delivery, side-conversation delivery, and runtime handoff call one host helper:

1. persist the raw directive;
2. mark delivery in progress;
3. call the selected backend;
4. record delivered, explicitly rejected, or acknowledgement-uncertain.

Governance and recovery control messages bypass user-directive persistence but continue through the same adapter controls.

## Context continuity

After backend compaction and normal shared-context assembly, the host prepends a small directive envelope rendered from the existing ledger. Later entries override conflicting earlier entries. The envelope is supplied to both new turns and direct steering while `displayText` stays unchanged.

The envelope is bounded by a hard byte limit. Overflow fails visibly rather than silently discarding user instructions.

## Completion integrity

The existing execution-integrity guard receives the active directive text as host metadata. It derives execution obligations from the original action request and subsequent corrections, not only from a continuation phrase such as "continue". A mutation turn ending without a matching terminal backend receipt is rewritten as incomplete/failed using the existing guard path.

Assistant prose cannot request a stop. Only the explicit host interrupt control can stop a running turn.

## UI semantics

The timeline calls a backend `completed` state “turn ended”, not “task completed”. Guard-rejected, failed, interrupted, and cancelled states remain distinguishable and are never collapsed into a generic processed label.

## Non-goals

- Requirement extraction or per-requirement evidence matrices.
- A second task lifecycle or resource-binding engine.
- Compatibility with the discarded parallel task-contract implementation.
