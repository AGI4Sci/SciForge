## Context

See `proposal.md` for motivation. The clean recovery baseline is the user's personal Fork `origin/gui@e0038b8c7109390445dccb691052fec74a153c09`. It already contains C's OIDC/PKCE, canonical `/v1/me`, Device lease and cloud-authenticated Principal path, the collaboration contracts/server/domain package, and the provider-neutral Content Space/OpenContent packages, but it does not yet compose those pieces into one real file-bearing Project path.

The donor branches are not merge bases:

- A `29256050` contains useful binding/file-intent/execution-fence shapes, but regresses to anonymous pairing, models binding as persisted authorization scopes, and leaves production binding verification uninjected.
- B `543042e9` contains useful coordinator UI, local acceptance/recovery and Worker runner behavior, but duplicates OIDC material into collaboration storage, uses 0.2 contracts against a 0.1 server, and injects `productionMockContentSpace()`.
- C is already integrated in the baseline at `3f5527d1`; its Device revalidation and stable Principal behavior remain canonical.
- E1 `0d370464` contains useful generic system transfer, Workspace safety and receipt work, but its metadata ancestry observation must not be treated as Provider ACL.

All donor code is therefore reviewed by behavior and rewritten behind final package contracts. The previous `codex/full-collaboration-loop` branch and local WIP snapshot are read-only audit/donor sources, are never merged as integration history, and do not establish implementation progress. The recovery branch `codex/full-collaboration-loop-recovery` is the sole integration mainline. The public A deployment is evidence only and remains unchanged.

## Goals / Non-Goals

**Goals:**

- One canonical OIDC → User → Device → configured Runtime → Agent chain and one token-free Cloud request path.
- One Cloud-authoritative collaboration state machine with durable revision, idempotency, execution fencing, Inbox and recovery.
- One Owner-Desktop-orchestrated Project content saga using ordinary Content Space operations and a Device-signed fact attestation.
- One real Worker file path using the executing User's Provider Connection, operation-time Provider authorization and bounded Workspace transfer.
- Independently ownable domain packages discovered through manifests/generated composition in source and packaged builds.
- An isolated, reproducible Run-0 deployment and a fixed evidence script that does not constrain product dynamism.

**Non-Goals:**

- Replacing or migrating the existing public A deployment.
- Productionizing email verification, MFA, signature notarization, public release policy or complete disaster recovery.
- Making Cloud Project Membership an OpenContent ACL, synchronizing Provider and Cloud databases, or deleting Provider content on Project lifecycle changes.
- Introducing a Cloud-hosted LLM, collaboration-specific Agent Runtime, provider-specific Host switch, shared Provider credential, file sync/mount, or second content execution path.
- Treating the five acceptance users, output names or OpenContent as hard-coded product limits.
- Implementing provider-neutral Shared Documents or real-time co-editing; this PoC uses Content Space file handoff/review and Provider-native operations only.
- Refactoring historical architecture or secret findings outside the production paths changed for this collaboration loop.
- Developing Computer Use TS/Python, Evidence DAG, Project DAG, Create Loop, Remote SSH, or unrelated Worker capabilities; only a minimal generic adapter is allowed if a changed collaboration contract would otherwise fail to compile.

## Decisions

### 1. Package ownership follows business authority, not the demo screen

| Package/context | Owns | Explicitly does not own |
| --- | --- | --- |
| `domain-identity-access` | OIDC/token custody, current Principal, Device enrollment/status, Device signing, Agent credential bootstrap/custody, token-free User/Agent Cloud transport | Project, Task, Agent Project role, Provider identity |
| collaboration contracts/server | User/Agent/Project/Membership/Task/Execution/Inbox/Record, revisions, idempotency, persistence and authorization | Desktop Runtime, Provider calls, credentials |
| `domain-collaboration` | Runtime configuration, Agent facts/status projection, token-free presence/WSS consumption, durable local Inbox/outbox, local acceptance policy and execution journal | OIDC Token, Agent machine credential, Coordinator business UI, Provider implementation |
| `domain-project-coordinator` | Project/plan/Worker selection/Task/review/recovery HCI and Project content saga orchestration | OIDC/Provider credential, Cloud repository, vendor client |
| `domain-content-space` | Provider-neutral resources, Broker authorization, ordinary/admin/system transfer capabilities, Workspace byte boundary and receipts | Project aggregate, Cloud membership, vendor credentials |
| OpenContent packages | Provider account binding, private credentials/transport, exact Team/file semantics and real Provider observation | SciForge User/Project/Task authority |
| Host/Domain SDK | Generic composition, Principal injection, capability governance, Device signature and Workspace ports | Domain IDs, provider switches or collaboration workflows |

Backend and renderer contributions of one business domain remain in one package/version with separate explicit entrypoints. `domain-collaboration` and `domain-project-coordinator` compose into one GUI through standard renderer contributions; the Host imports neither package implementation.

Alternative rejected: put all UI and runtime behavior in `domain-collaboration`. That would couple login/connection ownership to Coordinator planning and prevent independent release/testing.

### 2. Identity contributes a token-free authenticated transport

Domain SDK defines a generic main-only authenticated request contribution whose public request contains only an allowlisted relative Cloud route, strict method/body schema, idempotency metadata and abort signal. `domain-identity-access` resolves the current OIDC session, validates Device continuity, injects authorization in its private boundary, executes the request and returns a strict token-free response. Collaboration packages receive neither headers nor session material.

Agent machine credentials remain cryptographically separate from OIDC material, but their bootstrap, decryption, native persistence and Bearer injection belong to the same Identity private runtime. After the Agent is registered to the current OIDC User and exact ACTIVE Device, collaboration consumes only strict token-free Agent command, Inbox and WSS methods plus non-secret credential status; it never receives the sealed bootstrap private key or replayable credential. Pairing uses the User-authenticated transport and binds only a Human endpoint.

Alternative rejected: B's collaboration-owned OIDC session broker, Agent credential store or direct authenticated Cloud client. Any of them creates a second credential owner and makes logout, Device revoke and Agent rotation races ambiguous.

### 3. Agent bootstrap is a guarded state machine

Desktop bootstrap order is:

`oidc_user_ready → device_active → runtime_configured → agent_registered → collaboration_connected`.

The Device installation identity is stable; Agent identity is Cloud-issued for `(userId, deviceId)` and Run-0 permits one active Agent per Device. Runtime/model selection is local and may change without changing Agent identity. Availability reports capability tags and readiness, never credentials.

Logout, Device revoke, ownership conflict or unconfirmable Device state moves Cloud authority to unavailable, stops connection and file work, and fences active executions. Local offline features remain governed separately.

Alternative rejected: create an Agent immediately after login. An Agent with no executable Runtime would advertise false capacity and create orphaned machine credentials.

### 4. Collaboration server keeps explicit orthogonal state

The database stores four independent facts instead of a composite “member is authorized” boolean:

- `project_membership`: `pending_membership | active | membership_removal_pending | removed`.
- `provider_membership_observation`: the latest external member-list or operation fact observed from the Provider, with no Cloud authority.
- `project_content_readiness`: the derived per-Project, per-User projection `missing_identity | pending | ready | degraded` for one binding revision.
- `task_authority`: derived at command time from Project/Membership/Device/Agent/execution facts; live executions carry a durable fence.

`project_content_binding` separately tracks `provisioning | active | degraded | closed` with a portable root, provisioning revision and attestation digest. Project lifecycle status and binding status are separate fields; neither is encoded as a slash-composite status.

Task rows point to the current `executionId`; every offer/reoffer inserts an immutable execution attempt. Old executions remain audit facts but all writes check the current execution/fence and expected revision. Outbox/Inbox and the state transition commit in one database transaction. WSS only signals availability.

Alternative rejected: infer Provider permission from Project Member or collapse retry count into the same execution identity. Both allow stale devices to write after authority changes.

### 5. Local acceptance policy is not a Cloud field

`manual | automatic` is stored in `domain-collaboration` package settings keyed by local `agentId`. On offer, both modes run the same local preflight. Manual mode exposes accept/reject HCI; automatic mode sends an explicit accept only after preflight. Cloud sees the same transition either way.

Alternative rejected: A Cloud `acceptancePolicy` field. It would become a cross-device policy and claim knowledge of local Runtime/Provider state that Cloud does not own.

### 6. Project provisioning is a client-orchestrated durable saga

Before a file-bearing Project exists, each authenticated User publishes one current global `ProviderDirectoryPrincipalFact` for an exact Provider Instance from that User's ACTIVE Device. The fact wraps only a non-authorizing Provider Directory Principal Reference plus User/Device provenance, readiness and compare-and-set revision. One exact User and Provider Instance has one current stable fact; conflicting replacement is explicit and never inferred from email, display name, OIDC subject or Agent ownership.

Cloud then creates the Project, explicit Memberships and exact provisioning intent at revision N in one transaction. The Owner comes from the authenticated OIDC actor rather than a caller-authored field. For Run-0, Cloud derives `contentOwnerUserId = ownerUserId` and selects that Owner's exact ready Provider fact plus every desired Provider member fact by expected revision; the caller cannot nominate a different initial content owner. Stale, degraded, cross-User or cross-Provider facts fail closed. The Owner Desktop's coordinator package obtains one Human confirmation for the complete, immutable revision-N operation plan. The Broker turns that confirmation into finite, one-use approval proofs for each enumerated Content Space create/list/add/list operation; it is not a standing administration grant, and any changed member/root/request requires new confirmation.

Each external operation uses the normal Content Space capability and current Owner Provider Connection. The coordinator package journals logical invocation IDs and exact receipts, re-reads the Provider member list, builds a provider-neutral report, and asks Identity/Host to sign the structured digest with the current enrolled Device key. Cloud verifies the Device signature, current Owner/Device, intent revision and report digest before binding and activating the Project.

Failures preserve the journal. Definitive missing operations may continue; uncertain writes require observation. No failure path deletes the external Team/directory. Dynamic add/remove is the same saga with a new revision. Removal first fences Cloud task authority and only then attempts Provider removal. A future explicit content-owner transfer is a separate saga executed on the new content owner's Desktop with that Human's current Provider Connection; it is not part of Run-0 and never reuses the old Owner's Provider authority.

Alternative rejected: a Cloud backend calling OpenContent. It would require shared Provider credentials and violate execution-node account authority. Also rejected: a Content Space `provisionProject` method, because Content Space must not import Project semantics.

### 7. Device signature attests observations, not Provider authority

`ProjectContentProvisioningAttestation` contains a version, project/intent/revision, Owner User, Device ID/public-key ID, current Principal identity version, Provider instance and opaque binding revision, exact portable root, normalized operation receipts, member-set digest, issued time and signature. Provider facts are supplied by Content Space; Identity/Host signs a canonical serialization; Cloud verifies with the Device public key stored during enrollment.

The attestation contains no Token, private key, Provider credential/Connection, endpoint or reusable Broker handle. It proves who observed what under which current bindings; subsequent Provider authorization is always re-evaluated at operation time.

Alternative rejected: A's persistent authorization-scope proof. Cloud cannot grant or continuously know Provider ACL, so such a proof would overstate authority.

### 8. Project file execution uses two generic system capabilities

Content Space owns `system-download` and `system-upload-new` as generic system-only capabilities. `domain-collaboration` requests them with an execution-bound portable resource and Workspace-relative path through Domain SDK; it never imports Content Space implementation or receives paths/credentials. A manifest-contributed system-capability grant binds the allowed caller, exact operation IDs and no wider content family.

For download, metadata proves identity/ancestry only; OpenContent `DownloadCheck` runs before Host opens the local destination. For upload, the real no-overwrite Provider write is the final ACL check. Both transfers enforce byte bounds and return receipts bound to the exact operation and resource identity. Implementations may retain byte counts or content digests as non-secret diagnostics, but per-file bytes/SHA-256 are not a Run-0 completion gate in this PoC. Production composition has no mock factory.

Alternative rejected: B's `productionMockContentSpace()` and E1's metadata-as-ACL interpretation. Both can report success after the real member has lost access.

### 9. External write uncertainty is reconciled, never guessed

Every external write has one stable logical invocation ID and durable journal state: `prepared | dispatched | observed_success | observed_failure | outcome_unknown | abandoned`. A timeout after dispatch becomes `outcome_unknown`; no automatic retry is allowed. Coordinator recovery invokes canonical observation against the exact parent/name/digest. An exact observed output can be linked with Human provenance; otherwise the old execution is abandoned and a new execution/output name is created.

Alternative rejected: retry with the same or a generated idempotency key when the Provider does not guarantee idempotency. That can create duplicate content or overwrite Human-visible state.

### 10. Coordinator HCI is a projection over authoritative commands

Every current Coordinator Agent is owned by the Project Owner. The authenticated Owner Human operates the Coordinator HCI, and Coordinator transfer may select only another exact Agent owned by that same Owner; Workers remain dynamically selected exact Agents owned by Project members.

The coordinator renderer consumes strict read projections and emits commands with expected revision/idempotency. Creating a Project returns and focuses its ID; plan confirmation, HumanNeeded and review cards are visible without entering a collapsed advanced region. Worker candidates are grouped by User but selection values are Agent IDs. Review provides accept/request-revision, and recovery exposes only evidence-backed actions.

The UI never directly calls Provider or database APIs. Provisioning and recovery commands route to the package's main orchestrator, which uses generic authenticated Cloud and Content Space capability ports.

Alternative rejected: a single collaboration screen owning Identity, Provider enrollment and Coordinator workflow. It obscures package authority and makes token/provider leakage difficult to audit.

### 11. Run-0 is a separate deployable stack

Repository-owned Run-0 deployment artifacts define a unique Compose project, Keycloak realm/client, collaboration service, PostgreSQL database/role, secrets mounts, Caddy/DNS contract, backup/restore scripts and verification commands. No script targets the public service by default; destructive or migration commands require the exact Run-0 project/database names. Existing containers/databases are read-only evidence and never migration targets.

The packaged application is configured with the two frozen Run-0 origins at build/deployment configuration. If DNS/TLS is missing, verification stops at `awaiting_dns`; issuer overrides and HTTP fallbacks are forbidden.

Alternative rejected: reuse the public issuer/database for convenience. It would make evidence non-reproducible and risks changing a collaborator's accepted deployment.

### 12. Acceptance status is evidence-derived

The acceptance runner records but does not fake Human/device interactions. Source and packaged automated suites may use fakes only in their test entries. Isolated-live completion requires five independent packaged profiles on at least three machines/VMs, real OIDC/Provider/Runtime interactions, the fixed meeting script and recovery matrix. Missing DNS yields `awaiting_dns`; insufficient devices yields `awaiting_real_devices`; any failed required gate yields `failed` or `incomplete`, never “complete with caveats.”

The receipt uses fixture labels U0-U4 and redacted entity IDs, but records exact commit/package/image/schema and non-secret digests.

### 13. Repository architecture principles are a release gate

`Repository architecture principles gate` is a mandatory source and packaged release gate for the production paths added or modified by this change, not advisory review text. The exact frozen requirements are: **不得编辑 central feature map、Host 只能依赖通用 SDK、不得保留兼容 shim/双注册、不得写 showcase/provider/domain 硬编码、backend/UI 同包版本，以及 source/packaged 两条 composition 都必须验证。**

The gate SHALL fail this change if one of its changed production paths requires Host-private routing, imports a domain implementation rather than a generic SDK contract, retains old and new entrypoints together, uses acceptance/provider/domain identifiers to select production behavior, splits one business domain's backend and UI ownership/versioning, or lacks source or packaged composition evidence. Repository-wide scans MAY report pre-existing findings, but only findings introduced by or directly blocking the changed collaboration path are release blockers for this change; they SHALL NOT authorize unrelated historical-debt refactors. Passing unit tests cannot override an in-scope architecture failure.

## Risks / Trade-offs

- [The Provider's DownloadCheck or exact upload observation contract differs from current evidence] → freeze strict Connector schemas and characterize the real provider before admitting live operations; keep affected operation fail-closed rather than add a metadata fallback.
- [A single Human batch confirmation could become overly broad] → bind it to one immutable provisioning revision and exact ordered operations; issue one-use per-operation proofs and invalidate the batch on any drift.
- [Device signing expands Identity/Host responsibilities] → expose only canonical digest signing and public-key verification metadata; keep private keys inside native secure storage and prohibit arbitrary data signing by domain packages.
- [Cloud and Provider membership diverge for extended periods] → display Project Membership, Provider observation, derived Content Readiness and command-time Task Authority independently; fence Task authority first and provide explicit Owner reconcile.
- [A late Provider success occurs after execution fencing] → retain observation in recovery journal but reject Task association until an authorized Human reconciles it.
- [Donor code embeds obsolete contract assumptions] → port behavior behind new public contracts and tests instead of merging commits wholesale.
- [Five-device live validation cannot run locally] → complete code/source/packaged gates, produce a packaged artifact and mark final status `awaiting_real_devices` until the real matrix is supplied.
- [Shared server resources are accidentally targeted] → unique Run-0 names, preflight assertions, no wildcard/destructive defaults, independent backups and explicit public-deployment immutability checks.

## Migration Plan

1. Create `codex/full-collaboration-loop-recovery` from the personal Fork `origin/gui@e0038b8c7109390445dccb691052fec74a153c09`; freeze Context Map, glossary, ADRs, this OpenSpec and acceptance runbook there. The old integration branch and WIP snapshot remain read-only donors and are never ordinarily merged.
2. Add token-free Identity transport and Device signing without changing public server APIs; migrate collaboration Desktop to consume them and delete its OIDC/token path.
3. Evolve collaboration contracts/server with forward-only migrations for execution, membership/readiness and provisioning state; tests start from every prior schema version supported by the isolated stack.
4. Add Project coordinator package and manifest composition; port B's useful UI/runner behavior behind current contracts and remove production mock/fallback code.
5. Add Content Space system transfers and OpenContent operation-time checks; port E1 Workspace/receipt behavior while correcting ACL semantics.
6. Add isolated Run-0 deployment artifacts, deploy only the new stack, verify issuer/database/container separation and record a backup.
7. Run focused, full, architecture, generated-composition, source and packaged tests; build one exact packaged artifact.
8. Execute the live device/meeting/recovery matrix and seal the redacted receipt on the recovery branch. Only after all gates pass and the User confirms is an upstream PR prepared from that branch.

Rollback before live data consists of removing the isolated Run-0 Compose project and its explicitly named data after a verified backup; it never touches public services. After Provider provisioning, rollback closes Cloud binding and preserves Provider content for Human cleanup. Database migrations are forward-only; application rollback uses the isolated database backup rather than down-migrations that could discard evidence.
