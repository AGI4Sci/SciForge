# OpenHands-Style Agent Loop Migration

## Goal Description

Replace SciForge Runtime's monolithic model/tool control loop with an independently
testable, event-driven coding-agent kernel while preserving the existing Electron UI,
HTTP/SSE protocol, persisted thread/turn/item formats, Model Router integration, tool
providers, approvals, user-input gates, plans, goals, memory, attachments, and child
agent behavior.

The adopted architecture is based on the OpenHands Software Agent SDK's stateless
single-step reasoning/action loop and bounded event-history stuck detector. The
implementation remains native TypeScript and uses SciForge's existing ports. The
linear, auditable trajectory and explicit step/cost limits of mini-SWE-agent are used
as secondary design constraints; its bash-only execution model is not adopted because
it would remove SciForge capabilities.

Reference revisions audited for this migration:

- OpenHands Software Agent SDK: `75842b1f9fba38af4e9f384177d7b5c7e5b23013`
- mini-SWE-agent: `e187bcb2ff5825d85761a6f9c1f98c9fa6cfbc79`

## Acceptance Criteria

- AC-1: Preserve the external runtime contract.
  - Positive Tests (expected to PASS):
    - Existing thread/turn HTTP tests receive the same accepted and terminal lifecycle.
    - SSE text, reasoning, tool, approval, input, usage, and terminal events still map
      through the desktop adapter.
    - Existing persisted threads resume without schema migration.
  - Negative Tests (expected to FAIL):
    - A replacement that changes public item IDs, call IDs, event kinds, or terminal
      statuses is rejected.

- AC-2: Run each reasoning cycle as an atomic event-driven step.
  - Positive Tests (expected to PASS):
    - The runner checks abort, steering, stuck state, and iteration limits between steps.
    - A step reconstructs context from persisted history rather than mutable runner
      messages.
    - Stuck decisions and tool-call counts are reconstructed from a bounded persisted
      item window; process-local objects may cache that derivation but are not its source
      of truth.
    - A final model message finishes the turn; actions produce observations and another
      step.
  - Negative Tests (expected to FAIL):
    - Hidden mutable message state becomes the source of truth.
    - Tool execution bypasses `ToolHost`, `TurnService`, or `RuntimeEventRecorder`.

- AC-3: Bound unproductive tool use.
  - Positive Tests (expected to PASS):
    - Repeated action/observation cycles stop at the configured threshold.
    - Repeated action/error and alternating A/B cycles stop deterministically.
    - Absolute/relative paths and overlapping read ranges are normalized for redundant
      read detection.
    - One redundant read is tolerated; a second covered read of the same reported file
      version stops the trajectory, while a changed content hash resets coverage.
    - A default hard per-turn tool budget forces a final synthesis request with no tools.
    - Detector diagnostics reuse the existing public `error` event/item contract with
      code `agent_stuck`; no new unmapped renderer event kind is introduced.
  - Negative Tests (expected to FAIL):
    - Successful but redundant reads reset all non-progress state.
    - A normal turn can execute tools until the 64/128 model-step ceiling without an
      earlier guard.

- AC-4: Preserve SciForge extensions.
  - Positive Tests (expected to PASS):
    - Plan mode still writes `create_plan` output and synchronizes todos.
    - Active goals, steering, compaction, memory, skills, attachments, remote targets,
      tool policies, and usage accounting still work.
    - Approval and structured user-input waits remain interruptible.
    - Review and child-agent paths instantiate the same kernel policy as main turns.
    - The child runner's larger model-step allowance is an intentional delegation
      override; stuck thresholds and the default tool budget remain shared.
  - Negative Tests (expected to FAIL):
    - Main, review, and child turns silently use different loop implementations.

- AC-5: Improve prompt/tool economy without degrading simple answers.
  - Positive Tests (expected to PASS):
    - A simple explanatory prompt can finish without tools.
    - Independent reads returned in one model response can still execute in parallel.
    - Tool descriptions remain stable for prompt caching.
  - Negative Tests (expected to FAIL):
    - The system prompt requires inspection for every request.
    - The agent rereads unchanged, already-covered file ranges without suppression.

- AC-6: Stress-test multi-turn correctness.
  - Positive Tests (expected to PASS):
    - Deterministic scenarios cover repeated reads, alternating actions, failed edits,
      steering, approval/input pauses, compaction, persisted-policy reconstruction, and
      final synthesis.
    - Stress results report model steps, executed/suppressed tools, terminal state, and
      relevant quality assertions.
  - Negative Tests (expected to FAIL):
    - Stress tests depend on a paid/network model or nondeterministic external service.

## Path Boundaries

### Upper Bound (Maximum Scope)

- Replace the internal turn runner and stuck/termination policies.
- Extract reusable runner, trajectory detector, and configuration modules.
- Additive runtime configuration and diagnostics fields are allowed.
- Update prompt wording, documentation, notices, and deterministic tests.
- Correct loop-local bugs discovered during migration when covered by tests.

### Lower Bound (Minimum Scope)

- `AgentLoop.runTurn()` remains source-compatible but delegates to the new event-driven
  runner.
- OpenHands-style stuck detection and a default hard tool budget are active.
- Existing local-runtime tests and new stress tests pass.

### Allowed Choices

- Can use existing `ModelClient`, `ToolHost`, stores, services, gates, compactor, and
  runtime events.
- Can reimplement MIT-licensed architectural ideas with explicit provenance.
- Can retain `AgentLoop` as a compatibility facade and progressively extract its
  SciForge-specific context-building helpers.
- Cannot replace the Electron renderer, preload IPC, HTTP/SSE routes, Model Router, or
  persisted public contracts.
- Cannot add Python/OpenHands as a runtime dependency.
- Cannot make network model calls part of the deterministic test suite.

## Dependencies and Sequence

### Milestones

1. Architecture and provenance
   - Validate OpenHands/mini-SWE-agent reference revisions and licenses.
   - Freeze the SciForge external compatibility boundary.
2. Kernel and policy extraction
   - Add the event-driven conversation runner and trajectory stuck detector.
   - Route `AgentLoop.runTurn()` through the new runner.
   - Expose bounded policy configuration with safe defaults.
3. Compatibility migration
   - Keep main, review, and child-agent construction on the shared policy.
   - Preserve lifecycle, item/event ordering, gates, and compaction behavior.
4. Stress suite
   - Add deterministic multi-turn adversarial scenarios and metrics assertions.
   - Characterize public benchmark tasks suitable for optional external evaluation.
5. Review and validation
   - Run local-runtime typecheck/tests and desktop adapter tests.
   - Run an independent Humanize/Codex code review and resolve findings.

## Implementation Notes

- The new runner should inspect only a bounded recent event/item window after the last
  user message, matching OpenHands' interruptible step-boundary design.
- Stuck comparison ignores volatile IDs and timestamps, but keeps semantic action and
  observation content.
- Read coverage is reset only for a relevant file mutation, not for every unrelated
  mutation.
- Budget exhaustion should request a final answer with tools removed instead of marking
  the turn successful without user-visible output.
- The hard tool budget is a conversation-runner limit independent from the optional
  exact-repeat `toolStorm` guard.
- Source comments and `THIRD_PARTY_NOTICES.md` must distinguish architectural adaptation
  from copied source.

## Independent Review Resolution

The Humanize/Codex review on 2026-07-10 identified four release-critical gaps in the
initial plan: hidden process-local detector state, an unreachable hard-tool-budget
configuration, exact-JSON-only loop detection, and potentially unmapped diagnostics.
The implementation resolves them by rebuilding the exact-repeat cache and tool count
from persisted items, exposing tool and stuck policy in the strict runtime schema,
adding a pure bounded trajectory detector with path/range normalization and A/B checks,
and reporting failures through the existing `error` contract. Main, review, and child
construction paths all pass the same stuck policy.
