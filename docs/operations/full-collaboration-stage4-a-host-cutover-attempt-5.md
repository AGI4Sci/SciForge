# Stage 4 A-host cutover attempt 5 and verified rollback

This receipt records the fifth explicitly approved OpenSpec 7.4 operation. The
approved source included the generic capability-envelope correction at personal-
fork commit `98f9c44c849a2a242b5de016138d2c06a6c43bb4`. The retained candidate
was selected through the existing public Edge, the real U0 OIDC session was
reauthenticated, the existing Device and sole U0 Agent were recovered, and a
real Agent heartbeat reached the candidate. Collaboration connection then
failed because a stale durable Worker-availability command was delivered before
the current heartbeat fact. U0 was stopped before the exact old Edge and
candidate isolation were restored. OpenSpec 7.4 therefore remains incomplete.

No credential, Token, private Provider origin, external account value,
unredacted Human identity or replayable authorization appears here.

## Exact source and bounded selection windows

The server preflight reconfirmed the immutable old rollback target, candidate
revision `763cc5a5619cc11cc491e75edb5f04dfb2e4deac`, schema v14/catalog
fingerprint, zero safety counters, retained U0 Agent and sole retained U0
Project `prj_5594a84705a34532b0dd50c3d16911f9`. The first candidate selection
passed the revision/mount and public `200/200/401` plus exact issuer gates. The
source launcher then rejected its isolated checkout because it was detached and
did not expose the required personal-fork branch identity. U0 had not started.
The old Edge was restored immediately and all rollback gates passed.

Only the isolated checkout metadata was corrected: its `origin` became the
personal fork, its branch became `codex/full-collaboration-loop-recovery`, its
HEAD remained the exact approved commit, and its status was clean. No source,
profile, server data or public repository was changed to bypass the guard. A
check against the restored old stack failed at the expected protocol probe with
HTTP 400, proving the launcher distinguishes the old protocol from the
candidate's strict unauthenticated HTTP 401 response.

Within the same fifth approved operation, the retained candidate was selected
again only after the old state and forward inputs were revalidated. The clean
exact-source preflight then passed branch/commit/origin/build, public candidate
health/readiness/authentication boundary, frozen OIDC issuer, public
OpenContent Provider reachability and `privateSkillRequired: false`.

## Real U0 authentication and connection result

The retained U0 profile's Cloud session had expired. A fresh system-browser
flow was initiated; after the initial bounded wait expired, the flow was
restarted and the existing Keycloak browser session completed it. The Identity
UI confirmed that the real U0 User and existing Desktop Device were connected.
No duplicate User, Device or Agent was created. This establishes that the fifth
failure was not an OIDC, Keycloak, public HTTPS or Alibaba Cloud instance
failure.

The Collaboration UI recovered the existing `Stage4-U0` Agent
`agt_df0f54bb1fd344019d44cadba8ad5c12`. Selecting the real Connect action then
returned `Handler for collaboration.connection.connect failed.` The candidate
database and retained local state provided the decisive chronology:

| Observation | Result |
| --- | --- |
| current Agent heartbeat at `2026-08-26T18:09:31Z` | accepted; Agent revision became 46 |
| next availability write at `2026-08-26T18:09:32Z` | rejected with `revision_conflict` |
| rejected command fence | expected Agent revision 45, offline |
| current revision-46 online fact | durably queued locally but not sent |
| previous Cloud availability | revision 44; no current connected projection was proved |

The durable outbox treated heartbeat-fenced availability observations as
ordinary append-only writes. It selected the oldest pending fact first, stopped
the drain after its stale CAS failed, and left the current fact pending. Repeated
heartbeats would therefore remain one revision behind instead of repairing the
online projection. This is a Desktop Collaboration outbox defect, not a server
schema, database migration, OIDC, network, Content Space or optional
OpenContent Skill defect.

## Generic source correction

Commit `f89b8180fff3e721e5e8aae36174f96443701700`, pushed only to the personal
fork, applies two canonical corrections:

- Worker availability is explicitly a superseding current observation keyed by
  Agent. A higher Agent revision, or a later observation at the same revision,
  removes older non-sending availability rows before drain. A late stale fact
  cannot replace a current fact, while an actively sending row remains until
  its in-flight delivery settles.
- `worker_availability_projection` is included in the shared strict REST entity
  union. The server already returns this canonical entity after a successful
  publish; without the registration the Desktop would reject the successful
  response even after the stale-queue problem was removed.

The regression was first observed red: the outbox attempted revision 45 instead
of 46. It now proves current-over-stale, late-stale rejection and in-flight-row
retention. The full Collaboration contracts, Provider, server, Desktop domain,
canonical path, transport/security and secret-audit suites passed; focused
counts included 104 contract tests, 146 passing server tests, 102 Desktop domain
tests and 23 canonical integration/security tests. Type checks, changed-file
lint, 27-package composition freshness, capability governance and the 25-test
architecture suite also passed with zero finding.

A separate clean exact-source checkout was fast-forwarded to `f89b8180`,
completed the production build under Node `22.22.1`, and again failed its
candidate-contract preflight against the restored old public Edge with the
expected HTTP 400. This is the prepared source for a later newly authorized
selection; it is not live evidence.

## Verified rollback and current state

The failed Collaboration gate triggered the approved sequence:

1. The U0 source process was stopped first; the authenticated profile and local
   evidence were retained.
2. Only the Edge service was recreated from the immutable old base compose and
   exact old revision.
3. Public `/healthz`, `/readyz` and unauthenticated `/v1/me` returned
   `200/200/401`; the header named old revision
   `eaf9925092db2d488fa3dc61ae35ec054c80539a`, and OIDC discovery retained
   `https://login-test.sciforge.cn/realms/SciForge`.
4. The candidate was detached from the public Edge network and restored to
   `restart=no` with only its isolated app/database networks.

A read-only recheck at `2026-08-27T02:22:15+08:00` reproduced those public
gates, exact old Caddyfile mount and candidate isolation. The old stack,
candidate, retained Project, approval marker and evidence remain present. No
database was migrated, rewritten or deleted during rollback.

## Remaining approval and Run-0 boundary

The fifth authorization ended at mandatory rollback. Another public selection
requires a new explicit authorization and must use one clean personal-fork
commit containing `f89b8180`. It must reuse the retained U0 Project rather than
blindly create a duplicate, then prove through the real UI: Identity connected,
Collaboration connected, a current online availability projection, Project
focus, and Coordinator-visible online User and Agent counts.

The source process also reported that its configured local Codex executable was
absent at the saved path. That does not explain the authentication or
availability failure above and is not part of the Edge rollback, but it remains
a separate Run-0 G3 prerequisite before real Task execution. It must be repaired
and exercised on each participant's own machine rather than hidden by a server
or profile bypass.

No upstream operation, old-stack retirement, evidence cleanup, formal release
artifact, five-Human completion or OpenContent private Skill installation was
performed.

Receipt generated at `2026-08-27T02:22:15+08:00`.
