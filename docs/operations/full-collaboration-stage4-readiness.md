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
| 7.1 | ADR-0036; Run-0 frozen origin/issuer; read-only audit before mutation | Keycloak test delivery/runbook and Collaboration deployment metadata | Keycloak contract tests; Stage 3 schema route/fingerprint tests; 2026-08-24 donor audit is historical only | Not applicable | Fresh exact Cloud image/container/config, Cloud/Keycloak DB, schema/catalog, Caddy upstream, TLS/DNS, Docker context/resources, health/disk audit is absent | A-host SSH access; any privileged read must use an explicitly supplied login method | None | Redacted, timestamped read-only baseline receipt with observed values and discrepancies | `awaiting_candidate` |
| 7.2 | Backup Cloud DB, Keycloak DB/realm, edge config and image/resource metadata; restore into isolated resources before mutation | `packages/collaboration-server/deploy/backup-collaboration-db.sh`; Keycloak `backup-db.sh` and `restore-verify-db.sh` | Script/contract tests and the older Keycloak acceptance receipt | Not applicable | No fresh Stage 4 backup set, SHA-256 ledger, isolated Cloud restore, fresh realm export restore, or exact resource inventory | A-host SSH plus database, Docker, Keycloak realm-export and edge-config read authority | None | Protected backup ledger and redacted restore-rehearsal receipt for every required asset | `awaiting_candidate` |
| 7.3 | Clone old Cloud DB; migrate only an independently named loopback/internal candidate; real health/OIDC/synthetic persistence smoke | Formal `migrations.ts`, supported fingerprints, PostgreSQL repository/server restart paths | Stage 3 real PostgreSQL migration/rollback/restart suite | Candidate image must correspond to the exact sealed Desktop/source commit where applicable; no candidate artifact exists yet | No independently named Stage 4 database/volume/container/network, candidate-only port, target image, migration, repeated-start, health or synthetic smoke evidence | A-host SSH/Docker/DB authority and designated synthetic OIDC account | None | Exact resource ledger, old/candidate image digest, clone/migration/rollback/no-op/restart/catalog/health/OIDC/Inbox/receipt/journal receipt | `awaiting_candidate` |
| 7.4 | Switch only the existing Caddy `cloud-test` upstream after all candidate gates; retain exact rollback target | Existing edge contract is documented; no second issuer/DNS/listener is allowed | Keycloak edge-contract tests validate the frozen public contract, not a Cloud cutover | Packaged/live smoke must be ready before approval is requested | Current upstream, proposed exact diff, validated config/reload and rollback commands have not been observed | A-host SSH and Caddy administration authority | Live profiles must be available for post-cutover verification | Pre-cutover evidence packet, explicit user approval, applied diff, immediate health/OIDC/API smoke and rollback verification | `approval_required` |
| 8.2 | Repository architecture principles gate: no central feature map, Host-private/domain switch, compatibility/dual registration or hard-coded acceptance/provider behavior; same-package backend/UI; source and packaged composition | Standard manifests/generated composition, generic Domain SDK contracts, package-owned Collaboration/Coordinator/Content Space entrypoints; canonical changed-path/formal architecture gate and sealed Stage 4 receipt are implemented | Architecture/receipt/manifest/tarball suite passed `25/25`; production-marker and private-import audit found no changed production violation | Formal gate still requires one exact clean/pushed artifact receipt and independently extracted packaged executable; artifact issuance is correctly blocked because the reviewed private verification-profile contribution count is zero | None | None | None for automated gate | Post-commit changed-path report plus source and sealed packaged executable evidence from one unchanged commit | `ready_local` |
| 8.3 | Focused gates, boundary/private-import, generated freshness, capability governance, secret audit and complete root regression | Stage 3 paths and aggregate scripts exist | Native Node/Python and two real loopback PostgreSQL databases produced `366/366` root files and `3389/3389` tests; all domain/package/tarball/internal-overlay/public-release pre-gates, typecheck, lint and secret audit passed | Existing optional package-level hardware/dependency skips remain explicitly outside root aggregate and are not live evidence | None | None | None | Preserve the exact command/result ledger and do not promote package-level skips to live evidence | `passed_local` |
| 8.4 | Source production composition and one packaged artifact from the same exact clean commit; no mock/fallback; frozen Cloud/OIDC contract | Source and packaged Electron smoke harnesses now inject and verify one exact Cloud/OIDC pair, exercise Identity pre-login readiness, and are consumed by the sealed-artifact formal gate | Source production composition and frozen pre-login boundary have passed locally | No sealed Stage 4 archive/receipt/digest exists; issuance remains fail-closed until the reviewed private verification-profile contribution exists, after which the formal gate must extract and run the receipted bytes outside the source tree | Public discovery/JWKS passed without login; authenticated Cloud smoke waits for the live boundary | First OIDC login requires the assigned U0-U4 account or user-driven browser login | One local machine is enough for pre-login packaged smoke | Build metadata, artifact absolute path/size/SHA-256/time/platform/arch/tool versions, executable locator, source smoke and unpacked-from-archive packaged smoke | `gap_local` |
| 8.5 | Fixed synthetic meeting input and dynamic U0-U4 evidence labels; fixture must not alter deployment contracts | `test-fixtures/collaboration/run0-meeting` and `scripts/run0-meeting-fixture.test.mjs` | Fixture test passed in Stage 2/3; OpenSpec 8.5 is already checked | Fixture must be shipped/read through the real Project/Content Space path during Run-0, not as a runtime response | None | None | None | Re-run fixture checks; remove the stale `awaiting_dns` wording because Run-0 reuses the frozen endpoints | `ready_local` |
| 8.6 | Five isolated profiles from one artifact across at least three physical machines/independent VMs; real OIDC, Device/Agent, Runtime and OpenContent | Product paths and fixed role script exist | Source tests characterize each contract but cannot satisfy live evidence | Artifact not yet sealed or distributed | Candidate/cutover must pass first | User must map U0-U4 to fresh Keycloak, OpenContent and Runtime credentials and perform/provide each login | Five profiles and at least three machines/independent VMs are not yet assigned | Redacted profile/device/agent/runtime/provider mapping and full happy-path timeline | `awaiting_real_devices` |
| 8.7 | R1-R10 on real packaged/Cloud/OIDC/Runtime/OpenContent; no duplicate Runtime turn or Provider write; permanent old-execution fencing | Durable Cloud/Desktop/Runtime/provider recovery implementation exists | Stage 3 focused tests cover recovery semantics only | No packaged-live recovery run | Candidate/cutover and live Cloud observability are missing | U0-U4 plus revoke/provider administration slots as explicitly assigned | Same five-profile/three-machine matrix as 8.6 | Per-recovery actor/entity/revision/epoch/sequence/idempotency/journal/runtime/provider/time expected-vs-actual receipt | `awaiting_real_devices` |
| 8.8 | Authorized final download, Human inspection and redacted receipt; missing live gates remain explicitly blocked | Receipt schema exists in the Run-0 runbook | Schema and secret audit exist | No final packaged artifact or downloaded outputs | No candidate/cutover/live outputs | U0 authorization and relevant Provider account | Authorized Desktop in the live matrix | Three final downloads, manual inspection, redacted sealed receipt, exact blocked/not-run rows | `awaiting_real_devices` |
| 9.1 | Remove changed-path anonymous pairing, Token duplication, 0.2/parallel contracts, production mock/fallback, private imports, hard-coding and dead paths | Stage 1-3 removed the known canonical conflicts; Stage 4 removed the OpenContent legacy Provider compatibility/migration path | Secret audit passed across 415 public candidates; tracked production scans found no retired compatibility/mock package marker or Host-private domain import; full regression passed | Packaged reachability remains part of the formal exact-artifact gate | Live deployment resources still require the 7.1 read-only topology audit | None for local audit | None | Post-commit changed-path architecture report; packaged reachability follows once a reviewed private profile permits artifact issuance | `ready_local` |
| 9.2 | Logical commits by responsibility; checkboxes follow evidence | Stage 1-3 history is already logically separated | Git history and clean opening baseline | Stage 4 changes are uncommitted by definition | Live receipts cannot be committed before they exist | None | None | Commit hashes for readiness/gates, packaging, deployment/E2E and evidence updates | `ready_local` |
| 9.3 | Push only `codex/full-collaboration-loop-recovery` to the personal Fork; no upstream PR without all gates and later confirmation | Branch and origin are correct and equal at opening | Opening remote-tracking ref equals `cd49aba883aff2829de321d8b740cfb8384a7085` | Artifact publication is separate and not implied by Git push | No deployment or cutover is implied by push | Git remote write authority when push occurs | None | Successful push and independently read remote HEAD; explicit statement that no upstream PR was created | `ready_local` |

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

The committed Stage 4 changed-path architecture suite passed `25/25` tests and
then audited 394 paths from the frozen baseline, including 143 production source
files and all 27 domain packages, with zero findings. The separate production
marker/private-import scan and the 415-file secret audit also passed. This closes
the local cleanup obligation in OpenSpec 9.1; it does not replace the sealed
packaged reachability half of 8.2.

The third row is a real fail-closed blocker, not a packaging inconvenience.
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
  remained explicitly skipped because no user login has occurred.

These observations prove the current public edge contract only. They do not
reveal the current Caddy upstream, image, database, schema or restore state and
therefore do not satisfy OpenSpec 7.1–7.4.

## Execution order

1. Close only credential-free local gaps: tests, architecture gate, cleanup audit,
   source composition, sealed packaged artifact, packaged pre-login smoke and
   public OIDC contract checks.
2. Stop at the first real login boundary and request the exact U0-U4 mapping or
   user-driven system-browser operation.
3. With separately supplied A-host access, perform 7.1 read-only and stop on any
   mismatch before backup/candidate work.
4. Preserve exact backup/candidate resource names and request a separate,
   explicit 7.4 cutover approval after presenting the complete candidate packet.
5. Run the five-profile happy path and R1-R10 only through the packaged product;
   source tests, direct SQL and fixture responses never satisfy those rows.
