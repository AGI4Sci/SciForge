## Context

See `proposal.md` for motivation. The synchronized baseline already contains C's OIDC/PKCE, canonical `/v1/me`, Device lease and cloud-authenticated Principal path, the 0.1 collaboration contracts/server/domain package, and the provider-neutral Content Space/OpenContent packages. It does not yet compose those pieces into one real file-bearing Project path.

The donor branches are not merge bases:

- A `29256050` contains useful binding/file-intent/execution-fence shapes, but regresses to anonymous pairing, models binding as persisted authorization scopes, and leaves production binding verification uninjected.
- B `543042e9` contains useful coordinator UI, local acceptance/recovery and Worker runner behavior, but duplicates OIDC material into collaboration storage, uses 0.2 contracts against a 0.1 server, and injects `productionMockContentSpace()`.
- C is already integrated in the baseline at `3f5527d1`; its Device revalidation and stable Principal behavior remain canonical.
- E1 `0d370464` contains useful generic system transfer, Workspace safety and receipt work, but its metadata ancestry observation must not be treated as Provider ACL.

All donor code is therefore reviewed by behavior and rewritten behind final package contracts. The public A deployment is evidence only and remains unchanged.

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

## Decisions

### 1. Package ownership follows business authority, not the demo screen

| Package/context | Owns | Explicitly does not own |
| --- | --- | --- |
| `domain-identity-access` | OIDC/token custody, current Principal, Device enrollment/status, Device signing, token-free authenticated Cloud transport | Agent registration, Project, Task, Provider identity |
| collaboration contracts/server | User/Agent/Project/Membership/Task/Execution/Inbox/Record, revisions, idempotency, persistence and authorization | Desktop Runtime, Provider calls, credentials |
| `domain-collaboration` | Agent registration/machine credential, presence/WSS, durable local Inbox/outbox, local acceptance policy and execution journal | OIDC Token, Coordinator business UI, Provider implementation |
| `domain-project-coordinator` | Project/plan/Worker selection/Task/review/recovery HCI and Project content saga orchestration | OIDC/Provider credential, Cloud repository, vendor client |
| `domain-content-space` | Provider-neutral resources, Broker authorization, ordinary/admin/system transfer capabilities, Workspace byte boundary and receipts | Project aggregate, Cloud membership, vendor credentials |
| OpenContent packages | Provider account binding, private credentials/transport, exact Team/file semantics and real Provider observation | SciForge User/Project/Task authority |
| Host/Domain SDK | Generic composition, Principal injection, capability governance, Device signature and Workspace ports | Domain IDs, provider switches or collaboration workflows |

Backend and renderer contributions of one business domain remain in one package/version with separate explicit entrypoints. `domain-collaboration` and `domain-project-coordinator` compose into one GUI through standard renderer contributions; the Host imports neither package implementation.

Alternative rejected: put all UI and runtime behavior in `domain-collaboration`. That would couple login/connection ownership to Coordinator planning and prevent independent release/testing.

### 2. Identity contributes a token-free authenticated transport

Domain SDK defines a generic main-only authenticated request contribution whose public request contains only an allowlisted relative Cloud route, strict method/body schema, idempotency metadata and abort signal. `domain-identity-access` resolves the current OIDC session, validates Device continuity, injects authorization in its private boundary, executes the request and returns a strict token-free response. Collaboration packages receive neither headers nor session material.

Agent machine credentials remain separate and are used only for Agent-authenticated routes/WSS after the Agent is registered to the current OIDC User and Device. Pairing uses the User-authenticated transport and binds only a Human endpoint.

Alternative rejected: B's collaboration-owned OIDC session broker and duplicated Token secret. It creates a second credential owner and makes logout/revocation races ambiguous.

### 3. Agent bootstrap is a guarded state machine

Desktop bootstrap order is:

`oidc_user_ready → device_active → runtime_configured → agent_registered → collaboration_connected`.

The Device installation identity is stable; Agent identity is Cloud-issued for `(userId, deviceId)` and Run-0 permits one active Agent per Device. Runtime/model selection is local and may change without changing Agent identity. Availability reports capability tags and readiness, never credentials.

Logout, Device revoke, ownership conflict or unconfirmable Device state moves Cloud authority to unavailable, stops connection and file work, and fences active executions. Local offline features remain governed separately.

Alternative rejected: create an Agent immediately after login. An Agent with no executable Runtime would advertise false capacity and create orphaned machine credentials.

### 4. Collaboration server keeps explicit orthogonal state

The database stores separate records instead of a composite “member is authorized” boolean:

- `project_membership`: `pending_membership | active | membership_removal_pending | removed`.
- `project_content_readiness`: per User and binding revision, `missing_identity | pending | ready | degraded` plus last Provider observation.
- `task_authority`: derived at command time from Project/Membership/Device/Agent/execution facts; live executions carry a durable fence.
- `project_content_binding`: `provisioning | active | degraded | closed` with a portable root, provisioning revision and attestation digest.

Task rows point to the current `executionId`; every offer/reoffer inserts an immutable execution attempt. Old executions remain audit facts but all writes check the current execution/fence and expected revision. Outbox/Inbox and the state transition commit in one database transaction. WSS only signals availability.

Alternative rejected: infer Provider permission from Project Member or collapse retry count into the same execution identity. Both allow stale devices to write after authority changes.

### 5. Local acceptance policy is not a Cloud field

`manual | automatic` is stored in `domain-collaboration` package settings keyed by local `agentId`. On offer, both modes run the same local preflight. Manual mode exposes accept/reject HCI; automatic mode sends an explicit accept only after preflight. Cloud sees the same transition either way.

Alternative rejected: A Cloud `acceptancePolicy` field. It would become a cross-device policy and claim knowledge of local Runtime/Provider state that Cloud does not own.

### 6. Project provisioning is a client-orchestrated durable saga

Cloud first creates Project facts and an exact provisioning intent at revision N. The Owner Desktop's coordinator package obtains one Human confirmation for the complete, immutable revision-N operation plan. The Broker turns that confirmation into finite, one-use approval proofs for each enumerated Content Space create/list/add/list operation; it is not a standing administration grant, and any changed member/root/request requires new confirmation.

Each external operation uses the normal Content Space capability and current Owner Provider Connection. The coordinator package journals logical invocation IDs and exact receipts, re-reads the Provider member list, builds a provider-neutral report, and asks Identity/Host to sign the structured digest with the current enrolled Device key. Cloud verifies the Device signature, current Owner/Device, intent revision and report digest before binding and activating the Project.

Failures preserve the journal. Definitive missing operations may continue; uncertain writes require observation. No failure path deletes the external Team/directory. Dynamic add/remove is the same saga with a new revision. Removal first fences Cloud task authority and only then attempts Provider removal.

Alternative rejected: a Cloud backend calling OpenContent. It would require shared Provider credentials and violate execution-node account authority. Also rejected: a Content Space `provisionProject` method, because Content Space must not import Project semantics.

### 7. Device signature attests observations, not Provider authority

`ProjectContentProvisioningAttestation` contains a version, project/intent/revision, Owner User, Device ID/public-key ID, current Principal identity version, Provider instance and opaque binding revision, exact portable root, normalized operation receipts, member-set digest, issued time and signature. Provider facts are supplied by Content Space; Identity/Host signs a canonical serialization; Cloud verifies with the Device public key stored during enrollment.

The attestation contains no Token, private key, Provider credential/Connection, endpoint or reusable Broker handle. It proves who observed what under which current bindings; subsequent Provider authorization is always re-evaluated at operation time.

Alternative rejected: A's persistent authorization-scope proof. Cloud cannot grant or continuously know Provider ACL, so such a proof would overstate authority.

### 8. Project file execution uses two generic system capabilities

Content Space owns `system-download` and `system-upload-new` as generic system-only capabilities. `domain-collaboration` requests them with an execution-bound portable resource and Workspace-relative path through Domain SDK; it never imports Content Space implementation or receives paths/credentials. A manifest-contributed system-capability grant binds the allowed caller, exact operation IDs and no wider content family.

For download, metadata proves identity/ancestry only; OpenContent `DownloadCheck` runs before Host opens the local destination. For upload, the real no-overwrite Provider write is the final ACL check. Both transfers enforce byte bounds, calculate bytes/SHA-256 and return exact receipts. Production composition has no mock factory.

Alternative rejected: B's `productionMockContentSpace()` and E1's metadata-as-ACL interpretation. Both can report success after the real member has lost access.

### 9. External write uncertainty is reconciled, never guessed

Every external write has one stable logical invocation ID and durable journal state: `prepared | dispatched | observed_success | observed_failure | outcome_unknown | abandoned`. A timeout after dispatch becomes `outcome_unknown`; no automatic retry is allowed. Coordinator recovery invokes canonical observation against the exact parent/name/digest. An exact observed output can be linked with Human provenance; otherwise the old execution is abandoned and a new execution/output name is created.

Alternative rejected: retry with the same or a generated idempotency key when the Provider does not guarantee idempotency. That can create duplicate content or overwrite Human-visible state.

### 10. Coordinator HCI is a projection over authoritative commands

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

## Risks / Trade-offs

- [The Provider's DownloadCheck or exact upload observation contract differs from current evidence] → freeze strict Connector schemas and characterize the real provider before admitting live operations; keep affected operation fail-closed rather than add a metadata fallback.
- [A single Human batch confirmation could become overly broad] → bind it to one immutable provisioning revision and exact ordered operations; issue one-use per-operation proofs and invalidate the batch on any drift.
- [Device signing expands Identity/Host responsibilities] → expose only canonical digest signing and public-key verification metadata; keep private keys inside native secure storage and prohibit arbitrary data signing by domain packages.
- [Cloud and Provider membership diverge for extended periods] → display three independent states, fence Task authority first, keep durable pending/degraded recovery and provide explicit Owner reconcile.
- [A late Provider success occurs after execution fencing] → retain observation in recovery journal but reject Task association until an authorized Human reconciles it.
- [Donor code embeds obsolete contract assumptions] → port behavior behind new public contracts and tests instead of merging commits wholesale.
- [Five-device live validation cannot run locally] → complete code/source/packaged gates, produce a packaged artifact and mark final status `awaiting_real_devices` until the real matrix is supplied.
- [Shared server resources are accidentally targeted] → unique Run-0 names, preflight assertions, no wildcard/destructive defaults, independent backups and explicit public-deployment immutability checks.

## Migration Plan

1. Freeze Context Map, glossary, ADRs, this OpenSpec and acceptance runbook on the user fork branch.
2. Add token-free Identity transport and Device signing without changing public server APIs; migrate collaboration Desktop to consume them and delete its OIDC/token path.
3. Evolve collaboration contracts/server with forward-only migrations for execution, membership/readiness and provisioning state; tests start from every prior schema version supported by the isolated stack.
4. Add Project coordinator package and manifest composition; port B's useful UI/runner behavior behind current contracts and remove production mock/fallback code.
5. Add Content Space system transfers and OpenContent operation-time checks; port E1 Workspace/receipt behavior while correcting ACL semantics.
6. Add isolated Run-0 deployment artifacts, deploy only the new stack, verify issuer/database/container separation and record a backup.
7. Run focused, full, architecture, generated-composition, source and packaged tests; build one exact packaged artifact.
8. Execute the live device/meeting/recovery matrix and seal the redacted receipt. Only after all gates pass is an upstream PR prepared.

Rollback before live data consists of removing the isolated Run-0 Compose project and its explicitly named data after a verified backup; it never touches public services. After Provider provisioning, rollback closes Cloud binding and preserves Provider content for Human cleanup. Database migrations are forward-only; application rollback uses the isolated database backup rather than down-migrations that could discard evidence.
