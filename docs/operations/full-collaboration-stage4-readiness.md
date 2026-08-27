# Full Collaboration Stage 4 readiness matrix

This matrix is the pre-execution ledger for OpenSpec change
`add-full-multi-user-collaboration-loop`. It was started from the clean
`codex/full-collaboration-loop-recovery` baseline at
`cd49aba883aff2829de321d8b740cfb8384a7085`. It records evidence that exists and
evidence that still has to be produced; it does not turn source tests or old
receipts into live acceptance.

Status vocabulary:

- `ready_local`: the existing source path can enter the Stage 4 gate, but the
  gate has not yet been rerun for this exact commit.
- `passed_local`: the required local/source checks have passed for the current
  worktree; live evidence is still tracked separately.
- `passed_server`: the exact read-only server observation for that row passed;
  later mutating server gates remain separate.
- `gap_local`: a required local or evidence path is missing.
- `deferred_user`: the User explicitly removed this row from the current
  vertical-loop scope; it remains recorded for a later request.
- `awaiting_candidate`: fresh A-server, backup/restore, candidate, or cutover
  evidence is missing.
- `awaiting_real_devices`: the five-profile/three-machine live evidence is
  missing.
- `approval_required`: the operation is forbidden until the user approves the
  exact displayed change.

No pending OpenSpec checkbox is satisfied merely by this matrix.

| OpenSpec | Frozen contract | Existing implementation | Existing source evidence | Packaging scope | Real-server gap | Account / credential gap | Physical device / VM gap | Evidence to generate | Initial status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 7.1 | ADR-0036; Run-0 frozen origin/issuer; read-only audit before mutation | Keycloak test delivery/runbook and Collaboration deployment metadata | Two-stage user-authorized SSH audit records OS/resources, exact DNS/443 containers and immutable images, Cloud/Keycloak DB identities, admitted `public-v5` catalog fingerprint, exact realm/client, Caddyfile digest/upstreams, capacity and rollback identity in `full-collaboration-stage4-a-host-baseline.md` | Not applicable | None for this read-only row | Required SSH and read-only non-interactive sudo authority were supplied and used without reading secrets | None | Fresh redacted timestamped receipt exists; preserve it as the pre-mutation baseline | `passed_server` |
| 7.2 | Backup Cloud DB, Keycloak DB/realm, edge config and image/resource metadata; restore into isolated resources before mutation | `packages/collaboration-server/deploy/backup-collaboration-db.sh`; Keycloak `backup-db.sh` and `restore-verify-db.sh` | Fresh session-prefixed Cloud/Keycloak dumps, Realm export/import, edge archive and image/resource metadata are sealed by one SHA-256 ledger; Cloud rows/catalog and both Keycloak restore paths passed in isolated resources | Not applicable | None for this row; the protected backup tree and stopped restore resources are retained under their exact names, while candidate work remains separately gated by 7.3 | Required A-host authority was supplied and used only for the bounded backup/restore rehearsal; no secret value entered the repository | None | Redacted receipt exists in `full-collaboration-stage4-a-host-backup-restore.md`; independently rechecked manifest, permissions, internal networks, zero ports, stopped containers and unchanged live stack | `passed_server` |
| 7.3 | Clone old Cloud DB; migrate only an independently named loopback/internal candidate; real health/OIDC/synthetic persistence smoke | Formal `migrations.ts`, supported fingerprints, PostgreSQL repository/server restart paths | Stage 3 real PostgreSQL migration/rollback/restart suite plus the exact A-host receipt in `full-collaboration-stage4-a-host-candidate.md` | Not required for current vertical source-app scope; formal packaging remains deferred in 8.4 | Session-prefixed clone migrated from the committed v12 boundary to ready v14, no-op/restart/catalog/health/issuer and aggregate audits passed, and real PKCE JIT identity persisted across candidate restart | Human registered/logged in one new synthetic account only in the system browser; no credential or Token entered evidence | None | Exact resource/image/schema ledger, redacted identity transition and retained failure/success containers are recorded | `passed_server` |
| 7.4 | Switch only the existing Caddy `cloud-test` upstream after all candidate gates; retain exact rollback target | Existing edge contract is documented; no second issuer/DNS/listener is allowed | Seven approved operations proved exact Edge selection/rollback. Attempt 7 proved refreshed commit `94f6d89b` accepts the real U0 revision-48 heartbeat and commits the current online availability; its remaining failure was the U0 machine selecting a broken Codex executable before Collaboration Connect completed | Formal packaging is deferred and is not a source-app cutover prerequisite | Public Edge is on the old stable stack. The refreshed candidate is again running on two isolated networks with `restart=no`; image, v14/no-op migration, safety/identity aggregates, public `200/200/401`, strict unauthenticated contract, issuer, Caddy and compose gates passed in both Attempt 7 windows | The retained U0 User/Device/Agent and Project remain; U0 is stopped. The approval marker is retained evidence only. U0 now stores the verified absolute `/usr/local/bin/codex` path; another public selection still requires explicit approval | Live U0-U4 profiles remain required after the U0 Coordinator smoke; each machine must prove its own Runtime path before selection | Reuse exact source/profile and retained Project; prove the corrected Runtime, Collaboration connected, current availability, Project focus and Coordinator online User/Agent counts through the real UI | `approval_required` |
| 8.2 | Repository architecture principles gate: no central feature map, Host-private/domain switch, compatibility/dual registration or hard-coded acceptance/provider behavior; same-package backend/UI; source composition | Standard manifests/generated composition, generic Domain SDK contracts, package-owned Collaboration/Coordinator/Content Space entrypoints and canonical changed-path architecture gate | Runtime authorization, optional-skill, manifest/tarball, changed-path and exact Cloud/OIDC source smoke pass locally | Not required; 8.4 is separately deferred | None | None | None for automated gate | Preserve the exact source command/result ledger | `passed_local` |
| 8.3 | Focused gates, boundary/private-import, generated freshness, capability governance, secret audit and complete root regression | Stage 3 paths and aggregate scripts exist | Native Node/Python and two real loopback PostgreSQL databases produced `366/366` root files and `3389/3389` tests; all domain/package/tarball/internal-overlay/public-release pre-gates, typecheck, lint and secret audit passed | Existing optional package-level hardware/dependency skips remain explicitly outside root aggregate and are not live evidence | None | None | None | Preserve the exact command/result ledger and do not promote package-level skips to live evidence | `passed_local` |
| 8.4 | Formal installer/release-artifact production-composition verification | Existing packaging tools remain available as optional release tooling | Source production composition is covered by 8.2 and does not complete this packaging-only row | Explicitly deferred by the User on 2026-08-26; not a current vertical-loop prerequisite | None | None | None | Revisit only when the User later requests formal installers or release artifacts | `deferred_user` |
| 8.5 | Fixed synthetic meeting input and dynamic U0-U4 evidence labels; fixture must not alter deployment contracts | `test-fixtures/collaboration/run0-meeting` and `scripts/run0-meeting-fixture.test.mjs` | Fixture test passed in Stage 2/3; OpenSpec 8.5 is already checked | Fixture must be shipped/read through the real Project/Content Space path during Run-0, not as a runtime response | None | None | None | Re-run fixture checks; remove the stale `awaiting_dns` wording because Run-0 reuses the frozen endpoints | `ready_local` |
| 8.6 | Five isolated source-app profiles from one exact commit across at least three physical machines/independent VMs; real OIDC, Device/Agent, Runtime and OpenContent | Product paths and fixed role script exist | Source tests characterize each contract but cannot satisfy live evidence | Not required | Candidate/cutover must pass first | User must map U0-U4 to fresh Keycloak, OpenContent and Runtime credentials and perform/provide each login | Five profiles and at least three machines/independent VMs are not yet assigned | Redacted profile/device/agent/runtime/provider mapping and full happy-path timeline | `awaiting_real_devices` |
| 8.7 | R1-R10 on real source apps/Cloud/OIDC/Runtime/OpenContent; no duplicate Runtime turn or Provider write; permanent old-execution fencing | Durable Cloud/Desktop/Runtime/provider recovery implementation exists | Stage 3 focused tests cover recovery semantics only | Not required | Candidate/cutover and live Cloud observability are missing | U0-U4 plus revoke/provider administration slots as explicitly assigned | Same five-profile/three-machine matrix as 8.6 | Per-recovery actor/entity/revision/epoch/sequence/idempotency/journal/runtime/provider/time expected-vs-actual receipt | `awaiting_real_devices` |
| 8.8 | Authorized final download, Human inspection and redacted receipt; missing live gates remain explicitly blocked | Receipt schema exists in the Run-0 runbook | Schema and secret audit exist | Not required | No candidate/cutover/live outputs | U0 authorization and relevant Provider account | Authorized source-app profile in the live matrix | Three final downloads, manual inspection, redacted receipt, exact blocked/not-run rows | `awaiting_real_devices` |
| 9.1 | Remove changed-path anonymous pairing, Token duplication, 0.2/parallel contracts, production mock/fallback, private imports, hard-coding and dead paths | Stage 1-3 removed the known canonical conflicts; Stage 4 removed the OpenContent legacy Provider compatibility/migration path | Secret audit passed across 421 public candidates; tracked production scans found no retired compatibility/mock package marker or Host-private domain import; full regression passed | Not required for current scope | Read-only topology and backup/restore are closed; candidate and cutover remain under 7.3–7.4 | None for local audit | None | Post-commit changed-path architecture and source-composition report | `ready_local` |
| 9.2 | Logical commits by responsibility; checkboxes follow evidence | Stage 1-3 history is already logically separated | Stage 4 implementation is separated into compatibility cleanup `ea4903c9`, immutable team delivery `ff80c4a5`, packaged acceptance gates `c52b7d1b`, readiness/deployment docs `d86b8e15`, and generic local authorization generation `aa81f88e` | No packaged or live receipt was committed without its evidence | Live receipts remain absent and explicitly unchecked | None | None | Preserve the logical series and use status-only evidence updates for later live gates | `passed_local` |
| 9.3 | Push only `codex/full-collaboration-loop-recovery` to the personal Fork; no upstream PR without all current-scope gates and later confirmation | Branch and origin are correct | Independent `ls-remote` matched pushed HEAD `c5cbf4aba98c059b09b97f8c5c32f8c0aea50d74` before this fresh-clone evidence correction | Packaging is deferred and no artifact publication occurred | Public edge still selects the old stack; candidate remains detached and no upstream PR was created | Git push completed | None | Re-verify remote HEAD after each later evidence-only update | `passed_local` |

## Current credential-free evidence

The local Stage 4 rerun uses native arm64 Node `v22.22.1`, an FTS5-capable
SQLite build, and native arm64 Python `3.13`. With the two real loopback
PostgreSQL databases enabled, the complete root run passed `366/366` files and
`3389/3389` tests with no root-level skips or failures. The environment defects
recorded under OpenSpec 8.3 were therefore resolved without editing Paper Radar,
DAG, Create Loop, Computer Use, Remote SSH, or Shared Documents production code.

The user-installed private OpenContent inputs were audited as two independent
classes:

- one optional Provider supplier overlay, `opencontent-attachment-assets`
  version `1.0.1`, archive SHA-256
  `5838c94033e467d7a9e3be6669c7e72390cd9cecfa4b2a7466690734e718b598`.
  Its 43-file receipt contains supplier/skill material, but only five
  package-pinned files feed the optional `useSupplierTransport` path for
  native-document and supplier-backed extended features. Ordinary personal,
  file and Team paths do not consume it, and the canonical source build/smoke
  was also proven with this optional overlay absent;
- one package-owned private deployment configuration for
  `opencontent-edoc2-demo`, with its private HTTPS origin intentionally omitted
  from this ledger, SHA-256
  `163d8e7a2e72eb4a2dbd492d84ea78b647e909776225fad6d50e28c94cd891f5`;
- the immutable outer team delivery, retained only as an optional Provider
  supplier-asset distribution,
  `SciForge-OpenContent-team-delivery-pr82-0b09e1c1.zip`, SHA-256
  `82f874e5e346e3b66bc76be9f51ba70c4aefea47beea5424be04555217fcef79`,
  passed the current checkout's outer inventory, inner overlay, deployment and
  Provider trust checks; installation retained the identical overlay, repaired
  the pre-existing identical sidecar from mode `0644` to `0600`, and a second
  execution returned `already-installed` for both inputs;
- zero trusted domain contributions with `publicRelease: forbidden`.

The current Stage 4 architecture suite passed `25/25` package/composition tests
and `3/3` generic private-skill installer tests, then audited 419 paths from the frozen baseline, including 144 production source
files and all 27 domain packages, with zero findings. The separate production
marker/private-import scan and the current 417-file Collaboration secret audit also passed. This closes
the local cleanup obligation in OpenSpec 9.1. The exact Cloud/OIDC source smoke
and post-change architecture rerun independently close the source-composition
portion of 8.2; they do not replace live 7.4 or 8.6–8.8 evidence.

The user-authorized A-host SSH audit also passed. Its two-stage non-privileged
and separately authorized read-only privileged evidence is recorded in
[`full-collaboration-stage4-a-host-baseline.md`](./full-collaboration-stage4-a-host-baseline.md).
It confirms the frozen DNS/public edge, exact five-resource DNS/443 stack and
immutable image identities, the Cloud `public-v5` catalog fingerprint, exact
Keycloak realm/client contract, Caddyfile digest/dynamic upstreams, capacity and
complete retained rollback identity. Database sessions were forced read-only;
no container, database, Caddy, backup or filesystem mutation occurred. OpenSpec
7.1 is therefore complete.

The separately authorized 7.2 rehearsal is recorded in
[`full-collaboration-stage4-a-host-backup-restore.md`](./full-collaboration-stage4-a-host-backup-restore.md).
It sealed the Cloud and Keycloak dumps, Realm export, edge archive and safe
image/resource metadata under protected root-owned storage; restored Cloud and
Keycloak into session-prefixed internal networks with no published ports; and
proved an independent Realm export/import path. A later independent read-only
check reproduced the exact manifest and receipt hashes, verified every listed
file as `OK`, observed all six retained restore containers stopped with zero
published ports, and reconfirmed the original five live image IDs, zero restart
counts, Caddyfile digest and public health/OIDC responses. OpenSpec 7.2 is
therefore complete. The independently named 7.3 candidate is recorded in
[`full-collaboration-stage4-a-host-candidate.md`](./full-collaboration-stage4-a-host-candidate.md):
the restored public-v5 data reached ready v14, no-op and restart checks were
stable, and one real PKCE/JIT synthetic identity persisted across an application
restart without creating a fake Device or Agent. The next mutating boundary is
the separately approval-gated 7.4 Caddy cutover, not the current database.

Formal installer/release-artifact verification is retained as OpenSpec 8.4 but
is explicitly deferred by the User and is not a blocker for the current
vertical source-app loop.
OpenContent operations remain `poc_only / runtime_authorization_required`.
Each real invocation must match the current Principal, authority/root, trusted
audience, Host transfer limits and current opaque Provider Binding Attestation;
the Connector revalidates that binding before dispatch. Neither the Provider nor
the current source-app acceptance waits for or embeds a static verification
profile or an optional Agent skill ZIP.

At `2026-08-26T06:27:20Z`, the credential-free public edge was also checked
against the frozen contract:

- both `cloud-test.sciforge.cn` and `login-test.sciforge.cn` resolved to the
  frozen A host `47.76.230.118`, with no AAAA record observed;
- Cloud `/healthz` and `/readyz` each returned HTTP 200, no redirect, verified
  HTTPS and the exact bounded body `{"ok":true}`; unauthenticated `/v1/me`
  returned HTTP 401 with the strict error-envelope keys and no login attempt;
- the canonical `verify-edge-contract.sh` external-public route accepted the
  exact frozen issuer, same-origin authorization/token/JWKS endpoints, one
  RS256 signing key and a minimum RSA size of 2048 bits; token-claim validation
  remained explicitly skipped in that credential-free observation because no
  login had occurred there. The later 7.3 candidate receipt records the real
  signed-token validation and JIT persistence smoke.

Those credential-free public observations prove the public edge contract only.
The separately authorized 7.1 receipt closes the hidden topology portion, the
7.2 receipt independently closes backup/restore, and the later 7.3 receipt
closes isolated candidate migration/health/synthetic persistence. None of them
authorizes or supplies 7.4 cutover evidence.

At pushed source commit `03aae9155eec87e8d859ef0ed0e9e8b8fa74e3ce`,
the canonical production build and a real Electron `source/out` smoke exercised
256 composed capabilities against the exact frozen Cloud/OIDC environment.
Cloud Identity and Device were both `signed-out` with no configuration error,
the installed OpenContent Provider Instance was discovered through Content
Space, Collaboration remained unconfigured, and Project Coordinator stopped at
`identity_required`. The repeatable online entry is
`npm run smoke:electron:source:cloud`; it intentionally performs no Human login,
Agent registration, Project write or Provider write. No DMG/ZIP is required or
emitted for the current scope.

A read-only launch against the retained real U0 profile then showed
`OIDC_SESSION_EXPIRED`, no local Agent, Collaboration `unconfigured`, and zero
Projects. Public `/healthz` and `/readyz` remain 200, OIDC discovery/JWKS match
the frozen issuer, and unauthenticated WSS is rejected at the expected auth
boundary. A-host read-only inspection also confirms the public edge still
selects the old app while the migrated candidate remains detached. Therefore
the product can reach Cloud, but current U0 is not yet collaborating.

## Execution order

1. Rerun the local/source gates, verify Provider use without an Agent skill, and
   freeze one exact source commit for all live profiles.
2. Preserve the completed 7.1 baseline, 7.2 protected restore evidence and 7.3
   loopback candidate/resource ledger.
3. Present the exact cutover/rollback packet and stop for a separate explicit
   7.4 approval; do not infer it from the completed candidate.
4. Map U0-U4 to five real source-app profiles on at least three machines/VMs;
   every Human enters only their own OIDC, Runtime and OpenContent credentials.
5. Run the five-profile happy path and R1-R10 only through the real source app;
   source tests, direct SQL and fixture responses never satisfy those rows.

The exact non-executed 7.4 selection diff, compose render, forward gates and
mandatory rollback are now frozen in
[`full-collaboration-stage4-a-host-cutover-plan-94f6d89b.md`](./full-collaboration-stage4-a-host-cutover-plan-94f6d89b.md).
The retained U0 profile has a real OIDC User, active Device, one candidate Agent,
a configured local Runtime, and a live-attested OpenContent connection. The U0
source process is stopped, its Codex executable is pinned to the verified
absolute `/usr/local/bin/codex` path, and the refreshed candidate is isolated.
The retained approval marker records Attempt 7 only and does not authorize a
later selection, so a new explicit authorization and fresh exact-source launch
are required before the next Coordinator smoke.
This evidence prepares but does not approve or complete 7.4, 8.6, 8.7 or 8.8;
8.4 remains separately deferred.

The first separately approved 7.4 attempt is recorded in
[`full-collaboration-stage4-a-host-cutover-attempt-1.md`](./full-collaboration-stage4-a-host-cutover-attempt-1.md).
The Edge selection and public candidate gates passed, but the retained U0
bootstrap process correctly rejected a Collaboration origin different from its
active loopback Identity endpoint. The exact rollback passed before the
candidate Edge attachment was removed. No settings or Agent were created, so
7.4 remained `approval_required` until the revised-order reattempt.

The separately approved second attempt is recorded in
[`full-collaboration-stage4-a-host-cutover-attempt-2.md`](./full-collaboration-stage4-a-host-cutover-attempt-2.md).
It stopped loopback U0 first, passed the same Edge/public gates and recovered
the same packaged User/Device through public HTTPS without increasing the
Device aggregate. The renderer then incorrectly required an active phone
endpoint before enabling first Agent registration. The public U0 process was
stopped before the old Edge and candidate isolation were restored, and the one
new settings file was preserved outside the profile as rollback evidence. The
minimal generic UI repair passes focused, Collaboration security and changed-
path architecture gates. A newly authenticated exact-source U0 profile and a
new explicit cutover approval are still required. Therefore 7.4 remains
`approval_required`, not passed.

The separately approved third attempt is recorded in
[`full-collaboration-stage4-a-host-cutover-attempt-3.md`](./full-collaboration-stage4-a-host-cutover-attempt-3.md).
It used the exact source application, recovered the same OIDC User and Device,
the sole U0 Agent and `Collaboration connected`, then stopped before a Project
write because the Project Coordinator renderer omitted the confirmation option
declared by its main capability. The U0 Owner Project count remained zero. The
public U0 process was stopped before the exact old Edge, candidate isolation and
`restart=no` were restored. Commit `bc702433` aligns all 14 confirmation-gated
renderer invocations with their real main definitions and adds a drift-proof
matrix test. A fresh explicit cutover approval is still required; 7.4 remains
`approval_required`, not passed.

The separately approved fourth attempt is recorded in
[`full-collaboration-stage4-a-host-cutover-attempt-4.md`](./full-collaboration-stage4-a-host-cutover-attempt-4.md).
It used the exact pushed source commit `d59c6537`, recovered the same OIDC User,
Device and sole U0 Agent, reached `Collaboration connected`, and durably created
one real U0 Project through the application UI. The global external-write
handler then reported `changed: true` without a broker resource handle, so the
Host rejected the successful Cloud result, did not focus the Project and never
rendered the Coordinator online User/Agent counts. The U0 source process was
stopped before the exact old Edge, candidate isolation and `restart=no` were
restored. The candidate database retains the new Project as evidence. A generic
capability-envelope correction, a real broker-path regression test and a fresh
explicit cutover approval are required; 7.4 remains `approval_required`, not
passed.

The separately approved fifth operation is recorded in
[`full-collaboration-stage4-a-host-cutover-attempt-5.md`](./full-collaboration-stage4-a-host-cutover-attempt-5.md).
After an initial exact-source checkout guard and rollback, its corrected clean
source window reauthenticated the real U0 identity and advanced the existing
Agent heartbeat to revision 46. Collaboration then delivered an older durable
revision-45 availability fact first, received `revision_conflict`, and left the
current online fact pending. U0 was stopped before the old Edge, candidate
isolation and `restart=no` were restored. Commit `f89b8180` makes Worker
availability a revision-ordered superseding fact and registers the server's
canonical availability entity in the strict response union. Full Collaboration,
type, lint, composition, security and architecture gates plus a clean production
build pass. A fresh explicit public-selection approval and real UI proof remain
required; 7.4 is still `approval_required`, not passed.

The separately approved sixth operation and its mandatory rollback are recorded
in
[`full-collaboration-stage4-a-host-cutover-attempt-6.md`](./full-collaboration-stage4-a-host-cutover-attempt-6.md).
The real U0 Agent heartbeat advanced to revision 47 and its exact current online
availability committed in the candidate database. The old candidate image then
returned `validation_failed` because its bundled strict REST entity union did
not recognize the successful `worker_availability_projection` response. U0 was
stopped before the exact old public Edge and candidate isolation were restored.
The failure is Cloud image version skew, not OIDC, Caddy, PostgreSQL, Alibaba
Cloud networking, Content Space or OpenContent.

Personal-fork commit `94f6d89b` adds the real HTTP heartbeat-to-availability
regression. A new image/application from that exact commit passed isolated
bundle/image, schema-v14/no-op migration, aggregate safety, identity-count,
`200/200/401`, issuer, Caddy and compose gates. Before Attempt 7, the previous
candidate remained retained and stopped while the refreshed candidate had only
its two isolated networks, `restart=no`, and no approval marker. The separately
frozen packet used by Attempt 7 is
[`full-collaboration-stage4-a-host-cutover-plan-94f6d89b.md`](./full-collaboration-stage4-a-host-cutover-plan-94f6d89b.md).

The separately approved seventh operation and its mandatory rollback are
recorded in
[`full-collaboration-stage4-a-host-cutover-attempt-7.md`](./full-collaboration-stage4-a-host-cutover-attempt-7.md).
Its first bounded window proved the refreshed public gates but stopped before
U0 launch because the shell supplied unsupported Node 23; exact rollback then
passed. A second window under supported Node `22.22.1` passed the exact-source,
public Cloud/OIDC and Identity gates. The refreshed Cloud accepted the existing
Agent's revision-48 heartbeat and committed its current online availability,
closing the Attempt 6 response-schema defect. The real UI nevertheless failed
Collaboration Connect because the U0 machine resolved `codex` to a broken
Homebrew npm installation whose platform vendor executable was absent. U0 was
stopped before the exact old Edge, candidate isolation and `restart=no` were
restored.

After rollback, the same U0 profile passed a bounded `app-server` probe and a
real offline Electron Runtime smoke with the working absolute
`/usr/local/bin/codex` path, which was saved through SciForge Settings. This was
a local profile correction, not a Cloud, Alibaba networking, OIDC, Content
Space, OpenContent Provider or optional Skill change. A new explicit
public-selection authorization plus real UI proof of Collaboration connected,
retained Project focus and Coordinator online User/Agent counts remain
required; 7.4 is still `approval_required`, not passed.
