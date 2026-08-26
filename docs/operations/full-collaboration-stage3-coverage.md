# Full Collaboration Stage 3 coverage matrix

This matrix is the implementation ledger for OpenSpec change
`add-full-multi-user-collaboration-loop`, tasks 3.4, 3.8 and 3.9. It records the
recovery baseline at `1d47941dabae8185efec4f27a036d1da7908df32`, the accepted
donor behaviour, and the evidence still required before a checkbox can be
marked complete. The Cloud database remains the source of truth; WSS is only an
Inbox-availability hint.

## Donor and baseline decision

| Source | Reused in the recovery baseline | Stage 3 decision |
| --- | --- | --- |
| Current commits `515539d7`, `18e4cd37`, `92fd26a0`, `5251d47b`, `de63aa33`, `7eb7fb62`, `e5dc419d`, `77a0ad24`, `5b867e67`, `c92f6026`, `1d47941d` | Worker execution journal/restart and late-result fencing; result/review loop; Coordinator HCI and transfer; independent membership/readiness/authority; provisioning; uncertain-write recovery; content binding; audit-safe recovery marker; content review; Stage 2 regression gates. | Keep as the Stage 3 baseline. Add characterization at the existing canonical service, repository and Desktop store boundaries. |
| B `79200c70`, `f23c6788`, `4a48efa7`, `32be3a74`, `0b1e8043`, `42d1d9ee` | Workbench intent, completion/recovery intent, execution-journal behaviour, durable WSS refill/ACK behaviour. These behaviours are already rewritten into the current Coordinator and `domain-collaboration` owners. | Do not cherry-pick. Reject the old `project-coordinator/worker-runner`, `task.transition`, `resource.create`, `sourceKind`/`targetUserId`, and Collaboration-owned identity/session paths. |
| Old `codex/full-collaboration-loop` | No additional canonical recovery path. | Do not merge: relative to the recovery baseline it removes substantial Stage 2 recovery, Coordinator and Content Space coverage. Use only as comparison evidence. |
| A / C / E donors | A schema lineage and PostgreSQL route fixtures; C identity threat cases; E generic system download/upload-new ownership. | Reconstruct only the supported database fixtures and missing characterization. Do not import old auth, provider, or feature-specific facades. |

## 3.4 offer and execution recovery

| Frozen requirement | Existing implementation and evidence | Baseline gap / Stage 3 evidence |
| --- | --- | --- |
| `task.offer.withdraw` is the sole offer cancellation command; `revoke` is Device/Agent authority revoke. | Strict protocol union exposes `task.offer.withdraw`; service has one withdraw transition. | Add a contract negative test for `task.offer.revoke` and any public client-reported timeout command. |
| Accept/reject/withdraw are exact-offer, exact-execution, revision-checked and idempotent. | `CollaborationService` locks Task/Execution/Offer and uses the common transactional receipt path; server tests cover accept/reject/withdraw and duplicate receipts. | Extend duplicate and stale-revision characterization across every terminal offer transition. |
| Timeout is decided only by Cloud current time and durable `expiresAt`; it is idempotent and creates no successor. | Accept rejects an already-expired offer, but no durable timeout transition exists. | Add one Cloud-owned expiry scan/transition, with no REST/SDK/Desktop timeout command. Persist Offer `timed_out`, Execution `timed_out` + `offer_timed_out` fence, Task `revision_requested`, Inbox and receipt in one transaction. Test repeat scan/no-op and revision race. |
| Only the current Coordinator may reassign after reject/timeout/withdraw/revoke. | Reassign checks current Coordinator and generates a new `executionId`, but currently permits replacement of a non-terminal open execution. | Characterize and enforce the legal predecessor fence reasons/states. Reject pending, accepted, running and unrelated terminal predecessors. |
| Every reassignment creates a fresh `executionId`; an old execution is an immutable audit fact and permanently fenced. | Existing reject→reassign test proves a new execution and rejects an old start. | Cover reject, timeout, withdraw, Agent revoke and Device revoke; assert distinct IDs and unchanged old records after delayed writes. |
| Every late old-execution write is rejected. | `assertOpenCurrentExecution` is used by start/fail/preflight/result and execution-bound content/recovery paths. | Add one table-driven fence suite covering accept/reject, start/fail, HumanNeeded, result, resource/file association, review and recovery writes where their actor owns that surface. |
| Device/Agent revoke, logout/ownership conflict or Principal lease loss stops command/WSS, Runtime and file access and fences current execution. | Desktop Identity runtime stops HTTP/WSS and locally fences on revoke/lease changes; Cloud Agent revoke fences current executions. | Cloud Device revoke currently revokes credentials only. Extend its single transaction to revoke Device-owned Agents/availability and fence their current executions. Retain Desktop restart/revoke characterization. |
| Coordinator transfer targets an active Agent owned by the same Project Owner and immediately fences old Coordinator-only writes. | Current Cloud service and Coordinator HCI tests cover Owner-owned transfer and stale authority epoch. | Retain as regression evidence; add it to the final recovery/security gate set rather than a second transfer path. |
| Provider removal is independent of metadata visibility; uncertain writes remain `outcome_unknown` until exact observe/link or abandon. | Current service, Content Space/OpenContent and Coordinator recovery tests cover removal, exact observation/link/abandon and never-used successor output names. | Retain as Stage 3 recovery regression evidence. No Provider/Mock fallback is permitted. |

## 3.8 PostgreSQL durability

| Requirement | Existing implementation and evidence | Baseline gap / Stage 3 evidence |
| --- | --- | --- |
| Supported routes are exactly `fresh-v4`, `upstream-v4`, `public-v5`, `staging-v9`, `a-v11`, `current-v12`, `current-v13`, `current-v14`. | `migrations.ts` declares v14, explicit route detection and catalog fingerprints. Unit tests exercise a fake SQL harness. | Real PostgreSQL must create every source catalog, migrate it to v14 and reject an unknown catalog. |
| Fresh install, repeated startup/no-op, forward-only route and final catalog fingerprint. | SQL migration files and fingerprint verifier exist. | Run against a session-owned PostgreSQL container; especially prove A `public-v5 -> v14`, then repeat migration with no catalog change. |
| Migration failure rolls back. | Environment-gated rollback test exists and is skipped without a URL. | Inject a failing migration statement against real PostgreSQL and assert the pre-migration version/catalog/data remain intact. |
| Task/Execution/Offer/fence, Inbox and business idempotency receipt commit atomically. | The service `commit` helper uses one repository transaction; mock SQL tests assert `BEGIN/COMMIT`. | Inject a real repository failure after business rows/Inbox but before receipt and assert none are visible after rollback. |
| Cloud restart preserves revision, execution, Inbox, receipt, idempotency and external-operation journal. | Repository models persist all facts; unit tests reconstruct selected repositories. | Recreate Pool/repository/service against the same real database and replay the same idempotency key; assert exact facts, sequence and receipt identity. |
| No Cloud/Desktop distributed transaction. | Desktop store owns processed message, sequence, ACK intent/outbox and stable Runtime invocation; provider writes use durable prepare/dispatch/observation journal. | Keep these as separate characterization suites and document recovery operations. |

## 3.9 public recovery and security surface

All public JSON schemas are strict. Write commands use a body idempotency key
that must equal the `Idempotency-Key` header. The default REST body limit is 64
KiB and the configured value is clamped to 1 MiB; WSS frames are limited to 8
KiB and compression is disabled. Collection/page schemas impose their own
bounds in addition to the transport bounds.

| Surface | Actor / audience and resource ownership | Revision / epoch / idempotency | Bounds and safe failure | Required matrix evidence |
| --- | --- | --- | --- | --- |
| `GET /v1/me`, `GET /v1/me/devices` | OIDC User; only the authenticated User and their Devices. | Read-only; fresh OIDC/lease validation at the Identity broker. | No request body; strict bounded response; no credentials returned. | Positive, missing/foreign bearer, revoked/expired principal, redacted error. |
| `POST /v1/device-enrollments`, `POST /v1/devices` | OIDC User; enrollment and Device ownership are bound to that User. | Business idempotency receipt; enrollment expiry and single-use proof; Device key attestation. | REST body limit plus strict key/attestation schemas. | Positive, wrong owner/expired enrollment, mismatched header, duplicate request. |
| `DELETE /v1/me/devices/:deviceId` | OIDC User; only a Device owned by that User. | Expected ownership fact and idempotency receipt; path/body ID equality. | REST body limit; opaque not-found/denial; no credential material. | Positive, foreign Device, stale/revoked Device, mismatched path, duplicate revoke. |
| `POST /v1/commands`: `agent.heartbeat`, `agent.rotate_credential`, `agent.revoke` | Device Agent for self heartbeat/rotation; owning OIDC User for revoke. | Agent/Device revision, credential/authority epoch and business idempotency. | Capability arrays max 256; strict credential envelope; safe errors. | Positive, cross-Agent, stale revision/epoch, duplicate write, revoked Device. |
| `task.offer.accept` / `task.offer.reject` | Exact offered Worker Agent on the assigned Device. | Offer + Task + Execution revisions and business idempotency. | Strict reason/text bounds; Cloud `expiresAt` check. | Positive, wrong Agent/Device, stale revision, duplicate, expired offer. |
| `task.offer.withdraw` / `task.offer.reassign` | Current Coordinator Agent only; target is an eligible exact active Agent in the same Project. | Project Coordinator authority epoch, Task/Offer/Execution revisions and idempotency. | Strict IDs/reason/file intent; no `revoke` alias or timeout command. | Positive, old/foreign Coordinator, illegal predecessor, stale epoch/revision, duplicate. |
| `task.execution.start` / `task.execution.fail` / `task.execution.preflight.get` | Exact current Worker Agent/Device/execution. | Execution + Task revision and all persisted authority epochs; writes idempotent. | Strict timestamp/error fields; preflight exposes bounded reason facts, not secrets. | Positive, wrong actor, old fenced execution, stale revision/epoch, duplicate writes. |
| `human.needed.create`, `task.result.submit` | Exact current Worker execution. | Execution/Task/authority revisions and idempotency; execution-bound file references. | Bounded text/outputs; strict portable references; safe Provider failures. | Positive, cross-execution, stale fence, duplicate and removed Provider. |
| `task.result.review`, `task.recovery.link_observed_output`, `task.recovery.abandon` | Current Coordinator Agent only; Owner Human may approve/answer but cannot perform Coordinator writes. | Coordinator authority epoch, Task/Execution/result/journal revisions and idempotency. | Exact observed output identity; no mark-success; safe never-used output name validation. | Positive, Human/old Coordinator denial, stale revision, duplicate, `outcome_unknown` paths. |
| `project.transfer_coordinator` | Project Owner User; target must be another active Owner-owned Agent. | Project revision + Coordinator authority epoch + idempotency; transfer bumps the epoch. | Strict IDs; no target credential/route input. | Positive, non-Owner/foreign Agent, stale epoch/revision, duplicate and old-Coordinator fence. |
| `inbox.pull` / `inbox.ack` | User pulls own User Inbox; Agent pulls exact own Agent Inbox. | Durable monotonic sequence; ACK write is idempotent and recipient-bound. | `afterSequence` bounded to safe integer; page 1..1000 contract and service clamp 1..200; response max 1000. | Positive, cross-recipient, duplicate page/message/ACK, stale/out-of-order ACK, reconnect refill. |
| `GET WSS /v1/events` | Authenticated OIDC User or exact Agent Device; audience is only that principal's Inbox. | Authentication/lifecycle checked at connect; no business writes; sequence refill remains REST/SDK-owned. | 8 KiB frames, no compression, origin allowlist for browser origins, strict ping/pong/error envelopes. | Positive, bad origin/bearer, revoked actor disconnect, oversized/malformed frame, reconnect hint/refill. |
| Identity-owned token-free SDK transports | Domain callers receive allowlisted request/response contracts only; Identity privately injects OIDC or Agent credentials. | Lifecycle generation/authority epoch is checked before and after I/O; idempotency forwarded exactly. | 1 MiB authenticated response and 2 MiB Agent response limits; queue max 1000; URLs/headers are not caller-controlled. | Positive, disallowed command, stale lifecycle, duplicate, oversize response, redacted failure. |

## Completion ledger

- [ ] 3.4: characterization, implementation and focused recovery gates complete.
- [ ] 3.8: every route and rollback/transaction/restart case proven on real PostgreSQL.
- [ ] 3.9: public matrix tests, security audit and recovery operations runbook complete.
- [ ] Stage 3 gates recorded with exact command counts, skips and failures.
- [ ] OpenSpec 3.4/3.8/3.9 updated only after the matching evidence above passes.

Stage 4 packaged, multi-device and live recovery evidence remains explicitly out
of scope here; OpenSpec 8.3, 8.4 and 8.7 remain unchecked.
