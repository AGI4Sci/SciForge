# Full Collaboration Stage 4 readiness matrix

This matrix is the pre-execution ledger for OpenSpec change
`add-full-multi-user-collaboration-loop`. It was started from the clean
`codex/full-collaboration-loop-recovery` baseline at
`cd49aba883aff2829de321d8b740cfb8384a7085`. It records evidence that exists and
evidence that still has to be produced; it does not turn source tests or old
receipts into packaged or live acceptance.

Status vocabulary:

- `ready_local`: the existing source path can enter the Stage 4 gate, but the
  gate has not yet been rerun for this exact commit.
- `passed_local`: the required local/source checks have passed for the current
  worktree; packaged or live evidence is still tracked separately.
- `passed_server`: the exact read-only server observation for that row passed;
  later mutating server gates remain separate.
- `gap_local`: a required local, packaging, or evidence path is missing.
- `awaiting_candidate`: fresh A-server, backup/restore, candidate, or cutover
  evidence is missing.
- `awaiting_real_devices`: the five-profile/three-machine live evidence is
  missing.
- `approval_required`: the operation is forbidden until the user approves the
  exact displayed change.

No pending OpenSpec checkbox is satisfied merely by this matrix.

| OpenSpec | Frozen contract | Existing implementation | Existing source evidence | Packaged gap | Real-server gap | Account / credential gap | Physical device / VM gap | Evidence to generate | Initial status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 7.1 | ADR-0036; Run-0 frozen origin/issuer; read-only audit before mutation | Keycloak test delivery/runbook and Collaboration deployment metadata | Two-stage user-authorized SSH audit records OS/resources, exact DNS/443 containers and immutable images, Cloud/Keycloak DB identities, admitted `public-v5` catalog fingerprint, exact realm/client, Caddyfile digest/upstreams, capacity and rollback identity in `full-collaboration-stage4-a-host-baseline.md` | Not applicable | None for this read-only row | Required SSH and read-only non-interactive sudo authority were supplied and used without reading secrets | None | Fresh redacted timestamped receipt exists; preserve it as the pre-mutation baseline | `passed_server` |
| 7.2 | Backup Cloud DB, Keycloak DB/realm, edge config and image/resource metadata; restore into isolated resources before mutation | `packages/collaboration-server/deploy/backup-collaboration-db.sh`; Keycloak `backup-db.sh` and `restore-verify-db.sh` | Fresh session-prefixed Cloud/Keycloak dumps, Realm export/import, edge archive and image/resource metadata are sealed by one SHA-256 ledger; Cloud rows/catalog and both Keycloak restore paths passed in isolated resources | Not applicable | None for this row; the protected backup tree and stopped restore resources are retained under their exact names, while candidate work remains separately gated by 7.3 | Required A-host authority was supplied and used only for the bounded backup/restore rehearsal; no secret value entered the repository | None | Redacted receipt exists in `full-collaboration-stage4-a-host-backup-restore.md`; independently rechecked manifest, permissions, internal networks, zero ports, stopped containers and unchanged live stack | `passed_server` |
| 7.3 | Clone old Cloud DB; migrate only an independently named loopback/internal candidate; real health/OIDC/synthetic persistence smoke | Formal `migrations.ts`, supported fingerprints, PostgreSQL repository/server restart paths | Stage 3 real PostgreSQL migration/rollback/restart suite plus the exact A-host receipt in `full-collaboration-stage4-a-host-candidate.md` | Server image is the exact pushed source commit; sealed Desktop artifact remains a separate 8.4 gate | Session-prefixed clone migrated from the committed v12 boundary to ready v14, no-op/restart/catalog/health/issuer and aggregate audits passed, and real PKCE JIT identity persisted across candidate restart | Human registered/logged in one new synthetic account only in the system browser; no credential or Token entered evidence | None | Exact resource/image/schema ledger, redacted identity transition and retained failure/success containers are recorded | `passed_server` |
| 7.4 | Switch only the existing Caddy `cloud-test` upstream after all candidate gates; retain exact rollback target | Existing edge contract is documented; no second issuer/DNS/listener is allowed | Keycloak edge-contract tests validate the frozen public contract; 7.1 fixes the current Caddyfile digest, dynamic `app:8787` upstream and complete old-stack rollback identity, 7.2 proves restore, and 7.3 proves the isolated candidate | Packaged/live smoke must be ready before approval is requested | Exact cutover diff/reload/rollback packet is not yet approved or applied; old Caddy upstream remains selected and candidate remains loopback-only | A-host mutation authority and a separate explicit cutover approval | Live profiles must be available for post-cutover verification | Pre-cutover evidence packet, explicit user approval, applied diff, immediate health/OIDC/API smoke and rollback verification | `approval_required` |
| 8.2 | Repository architecture principles gate: no central feature map, Host-private/domain switch, compatibility/dual registration or hard-coded acceptance/provider behavior; same-package backend/UI; source and packaged composition | Standard manifests/generated composition, generic Domain SDK contracts, package-owned Collaboration/Coordinator/Content Space entrypoints; canonical changed-path/formal architecture gate and sealed Stage 4 receipt are implemented | Architecture/receipt/generator/manifest/tarball suite passed `28/28`; production-marker and private-import audit found no changed production violation | Formal gate still requires one exact clean/pushed artifact receipt and independently extracted packaged executable; artifact issuance is correctly blocked because the reviewed private verification-profile contribution count is zero | None | None | None for automated gate | Post-commit changed-path report plus source and sealed packaged executable evidence from one unchanged commit | `ready_local` |
| 8.3 | Focused gates, boundary/private-import, generated freshness, capability governance, secret audit and complete root regression | Stage 3 paths and aggregate scripts exist | Native Node/Python and two real loopback PostgreSQL databases produced `366/366` root files and `3389/3389` tests; all domain/package/tarball/internal-overlay/public-release pre-gates, typecheck, lint and secret audit passed | Existing optional package-level hardware/dependency skips remain explicitly outside root aggregate and are not live evidence | None | None | None | Preserve the exact command/result ledger and do not promote package-level skips to live evidence | `passed_local` |
| 8.4 | Source production composition and one packaged artifact from the same exact clean commit; no mock/fallback; frozen Cloud/OIDC contract | Source and packaged Electron smoke harnesses now inject and verify one exact Cloud/OIDC pair, exercise Identity pre-login readiness, and are consumed by the sealed-artifact formal gate | Source production composition and frozen pre-login boundary have passed locally | No sealed Stage 4 archive/receipt/digest exists; issuance remains fail-closed until the reviewed private verification-profile contribution exists, after which the formal gate must extract and run the receipted bytes outside the source tree | Public discovery/JWKS passed without login; authenticated packaged Cloud smoke waits for the live boundary | First packaged OIDC login requires the assigned U0-U4 account or user-driven browser login | One local machine is enough for pre-login packaged smoke | Build metadata, artifact absolute path/size/SHA-256/time/platform/arch/tool versions, executable locator, source smoke and unpacked-from-archive packaged smoke | `gap_local` |
| 8.5 | Fixed synthetic meeting input and dynamic U0-U4 evidence labels; fixture must not alter deployment contracts | `test-fixtures/collaboration/run0-meeting` and `scripts/run0-meeting-fixture.test.mjs` | Fixture test passed in Stage 2/3; OpenSpec 8.5 is already checked | Fixture must be shipped/read through the real Project/Content Space path during Run-0, not as a runtime response | None | None | None | Re-run fixture checks; remove the stale `awaiting_dns` wording because Run-0 reuses the frozen endpoints | `ready_local` |
| 8.6 | Five isolated profiles from one artifact across at least three physical machines/independent VMs; real OIDC, Device/Agent, Runtime and OpenContent | Product paths and fixed role script exist | Source tests characterize each contract but cannot satisfy live evidence | Artifact not yet sealed or distributed | Candidate/cutover must pass first | User must map U0-U4 to fresh Keycloak, OpenContent and Runtime credentials and perform/provide each login | Five profiles and at least three machines/independent VMs are not yet assigned | Redacted profile/device/agent/runtime/provider mapping and full happy-path timeline | `awaiting_real_devices` |
| 8.7 | R1-R10 on real packaged/Cloud/OIDC/Runtime/OpenContent; no duplicate Runtime turn or Provider write; permanent old-execution fencing | Durable Cloud/Desktop/Runtime/provider recovery implementation exists | Stage 3 focused tests cover recovery semantics only | No packaged-live recovery run | Candidate/cutover and live Cloud observability are missing | U0-U4 plus revoke/provider administration slots as explicitly assigned | Same five-profile/three-machine matrix as 8.6 | Per-recovery actor/entity/revision/epoch/sequence/idempotency/journal/runtime/provider/time expected-vs-actual receipt | `awaiting_real_devices` |
| 8.8 | Authorized final download, Human inspection and redacted receipt; missing live gates remain explicitly blocked | Receipt schema exists in the Run-0 runbook | Schema and secret audit exist | No final packaged artifact or downloaded outputs | No candidate/cutover/live outputs | U0 authorization and relevant Provider account | Authorized Desktop in the live matrix | Three final downloads, manual inspection, redacted sealed receipt, exact blocked/not-run rows | `awaiting_real_devices` |
| 9.1 | Remove changed-path anonymous pairing, Token duplication, 0.2/parallel contracts, production mock/fallback, private imports, hard-coding and dead paths | Stage 1-3 removed the known canonical conflicts; Stage 4 removed the OpenContent legacy Provider compatibility/migration path | Secret audit passed across 416 public candidates; tracked production scans found no retired compatibility/mock package marker or Host-private domain import; full regression passed | Packaged reachability remains part of the formal exact-artifact gate | Read-only topology and backup/restore are closed; candidate and cutover remain under 7.3–7.4 | None for local audit | None | Post-commit changed-path architecture report; packaged reachability follows once a reviewed private profile permits artifact issuance | `ready_local` |
| 9.2 | Logical commits by responsibility; checkboxes follow evidence | Stage 1-3 history is already logically separated | Stage 4 implementation is separated into compatibility cleanup `ea4903c9`, immutable team delivery `ff80c4a5`, packaged acceptance gates `c52b7d1b`, readiness/deployment docs `d86b8e15`, and generic local authorization generation `aa81f88e` | No packaged or live receipt was committed without its evidence | Live receipts remain absent and explicitly unchecked | None | None | Preserve the logical series and use status-only evidence updates for later live gates | `passed_local` |
| 9.3 | Push only `codex/full-collaboration-loop-recovery` to the personal Fork; no upstream PR without all gates and later confirmation | Branch and origin are correct | At `2026-08-26T06:49:29Z`, independent `ls-remote` returned pushed HEAD `d86b8e15dc4305c3eb26899d2bdc833d06a008e0` on the only integration branch | Artifact publication is separate and did not occur | No A deployment/cutover occurred and no upstream PR was created | Git push completed | None | Re-verify remote HEAD after each later evidence-only update | `passed_local` |

## Current credential-free evidence

The local Stage 4 rerun uses native arm64 Node `v22.22.1`, an FTS5-capable
SQLite build, and native arm64 Python `3.13`. With the two real loopback
PostgreSQL databases enabled, the complete root run passed `366/366` files and
`3389/3389` tests with no root-level skips or failures. The environment defects
recorded under OpenSpec 8.3 were therefore resolved without editing Paper Radar,
DAG, Create Loop, Computer Use, Remote SSH, or Shared Documents production code.

The user-installed private OpenContent inputs have also passed canonical static
verification:

- one receipted internal runtime, overlay `opencontent-attachment-assets`
  version `1.0.1`, archive SHA-256
  `5838c94033e467d7a9e3be6669c7e72390cd9cecfa4b2a7466690734e718b598`;
- one package-owned private deployment configuration for
  `opencontent-edoc2-demo`, with its private HTTPS origin intentionally omitted
  from this ledger, SHA-256
  `163d8e7a2e72eb4a2dbd492d84ea78b647e909776225fad6d50e28c94cd891f5`;
- the immutable outer team delivery
  `SciForge-OpenContent-team-delivery-pr82-0b09e1c1.zip`, SHA-256
  `82f874e5e346e3b66bc76be9f51ba70c4aefea47beea5424be04555217fcef79`,
  passed the current checkout's outer inventory, inner overlay, deployment and
  Provider trust checks; installation retained the identical overlay, repaired
  the pre-existing identical sidecar from mode `0644` to `0600`, and a second
  execution returned `already-installed` for both inputs;
- zero trusted domain contributions with `publicRelease: forbidden`.

The current Stage 4 changed-path architecture suite passed `28/28` tests and
then audited 403 paths from the frozen baseline, including 143 production source
files and all 27 domain packages, with zero findings. The separate production
marker/private-import scan and the 416-file secret audit also passed. This closes
the local cleanup obligation in OpenSpec 9.1; it does not replace the sealed
packaged reachability half of 8.2.

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

The packaged-artifact row is a real fail-closed blocker, not a packaging
inconvenience.
OpenContent operations remain `poc_only / verification_profile_required`, and
the profile must statically bind the exact Principal, authority/root, operation,
audience, transfer limits, validity interval and, where required, current opaque
Provider Binding Attestation. Consequently, no artifact built before a reviewed
profile exists may be called the unique Stage 4 artifact or reused as Run-0
evidence. `stage4:artifact:mac:arm64` enforces this boundary before invoking the
builder; the build-issued receipt then rechecks all three private composition
layers after canonical after-pack validation.

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

At pushed source commit `d86b8e15dc4305c3eb26899d2bdc833d06a008e0`,
the canonical production build completed with 292 governed actions, 27 fresh
domain packages, one statically verified private runtime, and both Identity and
OpenContent native addons. A real Electron `source/out` smoke then exercised 256
composed capabilities against the exact frozen Cloud/OIDC environment. Cloud
Identity and Device were both `signed-out` with no configuration error, the
installed OpenContent Provider Instance was discovered through Content Space,
Collaboration remained unconfigured, and Project Coordinator stopped at
`identity_required`. At the same clean, pushed source state, the formal arm64
artifact command stopped before Electron Builder with the expected reviewed
private-contribution requirement. No DMG/ZIP or receipt was emitted.

## Execution order

1. Preserve the completed local/source gates and finish the reviewed static
   verification-profile plus sealed packaged artifact without weakening PoC
   admission.
2. Preserve the completed 7.1 baseline, 7.2 protected restore evidence and 7.3
   loopback candidate/resource ledger.
3. Present the exact cutover/rollback packet and stop for a separate explicit
   7.4 approval; do not infer it from the completed candidate.
4. Map U0-U4 to five real packaged profiles on at least three machines/VMs;
   every Human enters only their own OIDC, Runtime and OpenContent credentials.
5. Run the five-profile happy path and R1-R10 only through the packaged product;
   source tests, direct SQL and fixture responses never satisfy those rows.

The exact non-executed 7.4 selection diff, compose render, forward gates and
mandatory rollback are now frozen in
[`full-collaboration-stage4-a-host-cutover-plan.md`](./full-collaboration-stage4-a-host-cutover-plan.md).
The first retained packaged profile, U0, has a real OIDC User and active Device,
a configured local Runtime, and a live-attested OpenContent connection. Its
Agent count remains zero because the product correctly rejects an HTTP
Collaboration URL; registering that Agent over the existing public HTTPS origin
is the immediate post-cutover smoke. This evidence prepares but does not approve
or complete 7.4, 8.4, 8.6, 8.7 or 8.8.

The first separately approved 7.4 attempt is recorded in
[`full-collaboration-stage4-a-host-cutover-attempt-1.md`](./full-collaboration-stage4-a-host-cutover-attempt-1.md).
The Edge selection and public candidate gates passed, but the retained U0
bootstrap process correctly rejected a Collaboration origin different from its
active loopback Identity endpoint. The exact rollback passed before the
candidate Edge attachment was removed. No settings or Agent were created, so
7.4 remains `approval_required`; a reattempt must first stop the loopback-bound
process, then relaunch the same profile against public HTTPS only while the
candidate is publicly selected.
