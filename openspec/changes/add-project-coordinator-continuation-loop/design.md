## Context

See `proposal.md` for motivation and `specs/project-coordinator-continuation/spec.md` for observable behavior. The Cloud stores Project, confirmed Plan, Task, review, Inbox sequence, receipts and idempotency. The Project Coordinator package persists the exact Worker User assignment for every submitted Plan item. One package-owned reconciler now owns both initial ready-item creation and downstream dependency unlocks; no root-only dispatcher remains.

Two nearby constraints shape the slice. First, the Team production-flow work is independently changing invitation acceptance and activation gates, so continuation must treat `active` and existing Task Authority checks as inputs rather than duplicate them. Second, Plan-item Task IDs are currently derived by a server-private helper, while Task rows do not expose `planItemId`; a headless ready-set implementation must not copy that identity algorithm into the domain package.

## Goals / Non-Goals

**Goals:**

- Give `domain-project-coordinator` one renderer-independent, restart-safe reconcile service.
- Generalize initial root dispatch and downstream DAG unlock to the same ready-set algorithm.
- Preserve one Cloud command/state path and one identity rule.
- Make accepted-review-to-next-offer crash windows self-healing.
- Route strict result-arrival Inbox payloads to the existing Project Coordinator owner so a later Agent review turn has a durable trigger.

**Non-Goals:**

- Automatic evidence download, LLM review, request-revision generation, HumanNeeded escalation, final summary or Project completion in this slice.
- A Cloud-hosted Coordinator Runtime, a second scheduler, polling from renderer, or new database state.
- Relaxing invitation, Membership, Provider readiness, Runtime capability, budget, authority or execution fencing gates.
- Moving durable Worker User assignments to Cloud before that contract is separately designed.

## Decisions

### 1. The Project Coordinator package owns a pure ready-set derivation plus one effectful reconciler

A pure function receives the current confirmed Plan and current Tasks and returns Plan items whose canonical Task does not exist and whose dependency Tasks are all completed. An effectful package-owned reconciler reads the workspace, loads the submitted assignment projection, and invokes the existing Coordinator command service for each ready item.

This keeps domain knowledge with its owner and makes the derivation directly testable. Putting it in collaboration-server was rejected because Worker assignments are currently package-owned local facts and Cloud must not infer them. Putting it in renderer was rejected because closing the page would stop progress.

### 2. Canonical Task identity moves to collaboration contracts

The existing `taskIdForPlanItem` implementation becomes a named public contracts helper used by both server task creation and the Project Coordinator ready-set derivation. The helper accepts only validated Plan and Plan-item IDs and returns the existing deterministic ID, so there is no data migration and already-created IDs remain unchanged.

Copying the SHA-256 expression was rejected because two implementations could drift. Adding `planItemId` to persisted Task rows was rejected for this small slice because it would require a forward schema migration despite an already stable deterministic identity.

### 3. Reconcile is serialized per Project and re-reads before every write

The reconciler keeps an in-process per-Project promise tail so activation, Inbox and action triggers cannot concurrently dispatch the same ready set on one Desktop. Before each offer it reads the workspace again, recomputes the ready set and uses current Project/Plan revisions. Cloud CAS and idempotency remain the cross-process authority; the local queue is only contention control and carries no business truth.

A global lock was rejected because one stalled Project must not block unrelated Projects. Relying only on the local lock was rejected because restarts and Coordinator transfer require Cloud authority to remain decisive.

### 4. Stable idempotency is derived from immutable Plan identity

Each initial Task creation uses a key derived from `projectId`, `projectPlanId`, `planDigest` and `planItemId`. The same key is used whether the trigger is Plan confirmation, an accepted review, an Inbox replay or activation recovery. A Cloud commit followed by local failure therefore replays the exact command rather than creating a new logical action.

The existing invocation-scoped key is insufficient for recovery because a restarted lifecycle has no original UI invocation ID. Random retry keys were rejected because they turn an unknown response into duplicate-create conflicts rather than deterministic replay.

### 5. Cloud Inbox is a wake-up signal; fresh workspace is the decision source

Strict `project.plan.confirmed` and `task.result.submitted` Agent Inbox payloads are added to the versioned protocol and routed by `domain-collaboration` to the registered Project Coordinator owner. The handler validates recipient/current authority and then schedules reconcile; payload revisions never directly advance business state. Activation also scans current visible non-terminal Projects, covering messages already ACKed before a crash.

The Inbox handler awaits that reconcile before returning. The existing Collaboration connection persists an ACK only after its handler resolves, so a failed continuation leaves the event unacknowledged and replayable. This differs intentionally from the direct accepted-review action: the review is already committed when that UI command returns, so its continuation runs in the background and logs failure for the next Inbox or activation recovery instead of misreporting the review as rolled back.

Creating a new event bus or persisting a second continuation queue was rejected. The canonical collaboration Inbox already provides ordered replay/ACK semantics, while Cloud workspace facts provide the restart proof.

### 6. Reconcile failures are durable-by-facts, not reported as rollback of a committed review

The canonical workflow continuation awaits reconcile after it has verified readiness and activated the Project. Accepted result review schedules reconcile and logs bounded failure without changing the already returned review result; the next Inbox/activation reconcile retries from Cloud facts. Durable Inbox handling itself awaits reconcile so ACK remains after effects. This avoids telling the user that an accepted review failed after Cloud already committed it without weakening replay safety.

## Risks / Trade-offs

- [Worker availability expires before a newly ready item is dispatched] → Re-read immediately before each write and let the existing Cloud eligibility check fail closed; a later availability/inbox/activation trigger can retry.
- [Package-local Plan assignments are lost] → Stop with zero writes and expose the existing missing-assignment error; moving assignments into a Cloud Plan contract is a separate design decision.
- [No Inbox event occurs after a transient failure] → Activation always reconciles; this slice also triggers on current relevant Inbox/action paths. A periodic timer is intentionally deferred to avoid inventing a second scheduling policy.
- [Result-arrival routing may reveal an existing invalid Inbox payload] → Add strict protocol variants and focused server pull/parse tests before enabling owner routing.
- [This is not yet the complete autonomous loop] → Keep pending review explicit and build Agent evidence review as the next vertical slice on this same owner/reconciler instead of claiming completion.

## Migration Plan

1. Add and test the shared canonical Task identity helper, then switch server creation to it without changing generated IDs.
2. Add strict Coordinator Inbox payload variants and package-owner routing tests.
3. Add pure ready-set derivation and the Project Coordinator reconciler; replace the root-only helper with it.
4. Trigger reconcile from activation, Plan confirmation, accepted review and relevant Inbox handling.
5. Run contracts/server/coordinator/collaboration focused tests, typecheck, generated-composition and changed-path architecture gates.

Rollback removes the new triggers and reconciler while retaining the shared helper; no database or external state migration is required. Any Tasks created before rollback remain canonical Plan Tasks and continue through the existing Cloud path.
