# opencontent-content-space-provider Specification

## Purpose
Defines the independently composed OpenContent ContentSpaceProvider mapping for bound-account personal/Team libraries, ordinary files, Provider administration, native documents, extended operations, enrollment, and the Connector-owned supplier transport/private-overlay boundary.
## Requirements
### Requirement: Adapter is independently composed and lazy

`opencontent-content-space-provider` SHALL be an optional trusted compile-time domain package with one main `main.content-space-provider-factory` extension and one renderer `content-space.provider-enrollment-view` extension for Provider Kind `opencontent`. Its main entry SHALL acquire only the Host-issued token-free Connector `./main-contract` facade; its renderer entry MAY adapt the Connector-owned public enrollment component and bounded connection-status capabilities into the provider-neutral enrollment slot. It SHALL register no parallel content capability, IPC/MCP, credential store, raw client, portable resolver, DocumentProvider, or Host feature switch. Main construction and renderer contribution construction SHALL perform no login, credential, network, content, or mutation work.

#### Scenario: Adapter is absent

- **WHEN** the package is omitted
- **THEN** generic Content Space, its UI, mock/other Providers, and the source-development application SHALL continue without fallback

#### Scenario: Enrollment view is installed

- **WHEN** Content Space renders the OpenContent enrollment contribution for the selected Provider Instance
- **THEN** bind, unbind, and reauthentication SHALL use only the Connector's public enrollment capability path, and the resulting renderer state SHALL neither authorize nor dispatch a content operation

### Requirement: Personal and Team libraries map to provider-neutral containers

The bound account's personal root SHALL map to one `ContentContainerSummary` with `scope: personal`. Each accessible OpenContent Team root SHALL map to a summary with `scope: shared`. Stable folder identity, preferably `folderGuid`, SHALL form the portable `containerId`; numeric folder IDs and Team DTOs SHALL remain integration-private. Team and Project SHALL NOT be treated as the same aggregate or identity.

#### Scenario: Team display name changes

- **WHEN** the Provider returns the same stable root identity with a different safe label
- **THEN** the reference SHALL remain stable and only display metadata SHALL change

### Requirement: Team membership reuses typed OpenContent directory user references

The adapter SHALL accept ordinary Team member add/remove input only as an authoritative same-instance Content Space Provider directory `user` reference. `listMembers` MAY establish such references from its exact pinned response and SHALL return each item only as `{ member }`, with no role or revision. `getCurrentPrincipal` SHALL establish one only from the Connector-revalidated current session's exact canonical external identity through a package-private Provider semantic port; it SHALL NOT invoke or parse the supplier `user-info` command. The provider-neutral extended v2 contracts retain distinct literal-kind result schemas, but OpenContent `searchUsers`, `searchDepartments`, `searchPositions`, and `searchGroups` SHALL remain `blocked_by_contract / provider_contract_missing` and SHALL fail before supplier transport until each exact success item, identity, kind, and pagination shape is frozen. The adapter SHALL NOT guess aliases or assign the requested kind to an unproven item. It SHALL parse an authoritative opaque canonical principal ID only behind the Provider boundary, call the existing token-private Connector Team Administration methods through the current Principal-bound Connection, and observe the Team after mutation before reporting success. `listMembers` SHALL construct the same typed user reference from each Provider Team user so callers can remove a listed member without a Host `contentUserId` reverse mapping.

The adapter SHALL NOT accept legacy ordinary-member `contentUserId` payloads, select a Connection, expose a numeric identity or account DTO, add an extended-operation invite path, expose a member-role mutation or ownership-transfer operation, or use the current-owner identity binding as a cross-user fallback. Current-owner Team creation MAY use only the current Principal's verified external binding. The adapter SHALL expose no Project provisioning operation or port.

OpenContent's typed Team supplier surface exposes no atomic expected-state or Administration revision contract. The adapter's `updateSpace`, `pinSpace`, `unpinSpace`, `addMember`, and `removeMember` inputs SHALL therefore accept no `expectedRevision`, its Administration outputs SHALL return no revision, and the corresponding Agent capabilities SHALL declare `concurrency.revision: "none"`. The adapter SHALL NOT emulate CAS with a Team observation, pre-read, post-write observation, supplier value, or local lock.

Before an Administration operation relies on current Team or member state, the adapter SHALL prove every required Team and Team-user enumeration complete, bounded, and internally consistent. Incomplete, drifting, repeated, non-advancing, or count-inconsistent pagination SHALL return `provider_contract_violation` before remote mutation. A metadata-free full page whose completion cannot be proven and an empty page carrying a next-page signal SHALL both fail closed.

The adapter SHALL produce exact request-bound receipts for all ten Administration operations. Pages SHALL contain unique same-Provider roots or member references and valid progress; root-scoped outputs SHALL echo the exact requested root; create/update/pin/unpin outputs SHALL prove the requested label, current-owner binding, or pinned state; and add/remove receipts SHALL echo the exact root and member, with removal also proving `removed: true`. Content Space SHALL classify any binding mismatch from a read as `provider_unavailable` and any mismatch from an external write or destructive operation as `outcome_unknown`, without automatic retry.

#### Scenario: Current account invites another directory user

- **WHEN** Content Space supplies an authoritative canonical OpenContent directory user reference for the same Provider Instance as the authorized Team root
- **THEN** the adapter SHALL add that Provider identity through the existing Administration and Connector path, list the same canonical reference, and accept it for removal without exposing or borrowing either account's credential

#### Scenario: Current principal comes from the authenticated Provider session

- **WHEN** a caller requests the current OpenContent directory principal
- **THEN** the Provider SHALL construct the same-instance `user` reference only from the Connector-revalidated canonical external identity, SHALL issue no supplier command, and SHALL reject any object, alias, conflict, or non-canonical scalar before issuing the reference

#### Scenario: OpenContent directory search lacks an exact success receipt

- **WHEN** a caller requests any of the four OpenContent directory searches while its supplier item/kind/pagination contract remains unpinned
- **THEN** the Provider SHALL return `blocked_by_contract` before supplier transport and SHALL issue no directory reference

#### Scenario: Directory identity is non-canonical or belongs to another instance

- **WHEN** the member reference uses a non-user kind, a non-canonical OpenContent identity, or another Provider Instance
- **THEN** the adapter SHALL fail before Team mutation and SHALL NOT reinterpret it through Host identity mapping

#### Scenario: Administration pagination is incomplete or unstable

- **WHEN** a required Team or Team-user enumeration cannot prove a complete stable result
- **THEN** the adapter SHALL return `provider_contract_violation` before remote mutation and SHALL issue no Administration write

#### Scenario: Retired Team Administration fields are supplied

- **WHEN** a caller supplies `expectedRevision`, a revision receipt field, or a member role through the public Administration contract
- **THEN** strict validation SHALL reject it before Team mutation and SHALL NOT reinterpret it as supplier CAS or membership semantics

#### Scenario: Administration receipt is not exactly bound

- **WHEN** an Administration result drifts from the requested root, member, label, owner, pinned state, removal flag, Provider Instance, or bounded page contract
- **THEN** Content Space SHALL fail the read as `provider_unavailable` or the write/destructive operation as `outcome_unknown` and SHALL NOT automatically retry

### Requirement: One canonical Content Space path serves Human and Agent audiences

Renderer and Agent callers SHALL converge on the same Content Space service → pinned Provider path. Human operations SHALL use Human-only global capabilities and Host-selected file handles. Agent content operations SHALL use Agent-only Broker resource capabilities after a confirmed root authorization; an Agent SHALL NOT invoke the Human global content capabilities. The adapter SHALL use only the executing node owner's current Principal-bound connection. Callers SHALL NOT supply a connection, external account, endpoint, coordinator/admin credential, or alternate Provider.

Provider-neutral discovery metadata SHALL make external personal/Team library browse, folder, upload, and download intents discoverable as native Content Space operations even when the prompt also contains an installed Provider's display name. Generic runtime guidance SHALL search the native capability family before substituting an unrelated managed Provider; the Host SHALL NOT hard-code an OpenContent switch or expose Provider credentials to discovery.

#### Scenario: Requester supplies an account hint

- **WHEN** a Task, prompt, portable reference, or capability payload attempts to select an OpenContent account
- **THEN** the hint SHALL be rejected or ignored as invalid contract input before provider access

#### Scenario: Prompt names an installed content Provider and Team library

- **WHEN** a Personal Session asks to browse or upload to a named external Team library
- **THEN** native discovery SHALL return the provider-neutral root-authorization operation without requiring a Provider-specific Agent tool or managed-storage fallback

### Requirement: Agent resource scope is explicit and descendant-bounded

A Personal Session Agent SHALL first obtain Human confirmation for one exact personal or Team root that the bound account can currently enumerate. The authorization request SHALL contain only the selected Provider Instance, provider-neutral scope, and Human-visible library label; it SHALL NOT accept a Provider folder ID/GUID. After confirmation, Host SHALL enumerate that Provider Instance through the canonical Content Space service and SHALL authorize only one exact canonical-label-and-scope match. Zero or multiple matches SHALL fail without issuing a resource. Host SHALL issue a bounded opaque resource tied to the exact Agent caller, Principal, and Workspace context. Children SHALL become reachable only when listing an already-authorized directory issues descendant resources; raw references SHALL NOT widen scope. If a separately reviewed Project integration later supplies an authoritative binding, a Project Task Agent SHALL not use ad-hoc root authorization and SHALL access only the current Project Content Directory and descendants. Scope checks and OpenContent ACL SHALL both pass; Project membership SHALL never substitute for Provider permission.

#### Scenario: Human names one currently enumerable Team root

- **WHEN** the request selects a Provider Instance, `shared` scope, and a Team label that has exactly one canonical match in the current bound account's paginated container listing
- **THEN** confirmation SHALL authorize that exact stable root and return only its caller-bound Broker resource authority

#### Scenario: Team label is missing or ambiguous

- **WHEN** the current listing contains zero or multiple canonical matches for the requested label and scope
- **THEN** Content Space SHALL reject the selection and SHALL NOT guess, probe a raw identity, or issue any Agent resource

#### Scenario: Bound account can access a sibling Team directory

- **WHEN** a Project Task requests that sibling outside its bound directory
- **THEN** Content Space SHALL deny the request before the adapter performs the content operation

#### Scenario: Agent submits a raw Team folder GUID

- **WHEN** no confirmed root or descendant Broker resource authorizes that folder
- **THEN** Agent content capabilities SHALL reject it without resolving or probing the raw folder reference

### Requirement: Operation families and ACL behavior are explicit

The adapter SHALL expose the six ordinary personal/Team-library operations (list containers, list entries, observe entry, create folder, upload-new up to 16 MiB, and download up to 1 GiB) plus only the strictly typed Content Space administration, native-document, and extended-operation contracts implemented by Provider-owned semantic adapters and, where required, the optional verified attachment through Connector-owned transport. Each operation SHALL declare readiness separately and SHALL dispatch only through its matching Content Space feature and the token-free Connector facade; there SHALL be no raw command/API passthrough. OpenContent ACL SHALL remain the permission authority. Unauthorized, unavailable, rate-limited, malformed, conflict, cancellation, and uncertain Provider responses SHALL remain distinct bounded provider-neutral outcomes with no raw response content. Unauthorized SHALL include Human guidance to obtain permission in OpenContent. Team deletion, account creation, credential borrowing, implicit overwrite/rename, synchronization, and unspecified commands SHALL remain absent rather than fall back.

#### Scenario: Project member lacks OpenContent permission

- **WHEN** the Provider denies the executing owner's account
- **THEN** SciForge SHALL return unauthorized and SHALL NOT use the Project Owner, Coordinator, administrator, or another member's connection

#### Scenario: OpenContent throttles or violates its pinned response schema

- **WHEN** the Connector reports rate limiting or a malformed response contract
- **THEN** the adapter SHALL preserve the bounded typed outcome and SHALL NOT expose Provider diagnostics, DTOs, endpoints, credentials, or numeric handles

#### Scenario: Supplier command lacks a typed Content Space contract

- **WHEN** an attachment contains an undocumented command or generic request surface
- **THEN** the Provider SHALL not publish or invoke it, even when the command could be called directly by supplier code

### Requirement: Agent transfer bytes cross only approved Workspace grants

Agent upload SHALL accept only a Workspace-relative path in the current execution context's authorized Workspace. After Human confirmation, Host SHALL validate real-path containment, regular-file type, symlink escape, size, and access before issuing a one-shot upload handle. Agent download SHALL accept only a new Workspace-relative destination; Host SHALL reject existing targets, write a temporary file, validate bounds/completion, and atomically commit. Arbitrary filesystem paths and bearer/region URLs SHALL never enter renderer, Agent, or Provider business input.

#### Scenario: Download destination already exists or escapes by symlink

- **WHEN** Host validates the requested relative destination
- **THEN** it SHALL reject before provider transfer and SHALL NOT overwrite or write outside the authorized Workspace

### Requirement: Public integration code and private supplier assets remain isolated

The OpenContent Connector and Content Space Provider adapter SHALL remain independently versioned public domain packages installed through the standard public workspace and generated composition path. The Connector SHALL own deployment-origin resolution and supplier wire/transport/process isolation; the Provider SHALL own receipt-to-Content-Space semantics and SHALL consume only the Connector's shared package-private availability gate. No standalone OpenContent runtime package, compatibility package, endpoint environment channel, private cross-package implementation import, or Provider-owned parallel client SHALL exist. The package-declared deployment sidecar and optional supplier executable assets SHALL remain distinct private deployment inputs outside public npm files, workspace, lockfile, and dependency graph. The packaged sidecar SHALL use the isolated generic `resources/domain-deployments/opencontent-connector.json` namespace and SHALL NOT create or imply a supplier overlay under `resources/opencontent/**`. A clean checkout with neither private input SHALL install, build, test, start, and package SciForge normally; Provider discovery, the public adapter, capabilities, and the Connector service descriptor SHALL remain composed, while every legal Provider operation SHALL be unavailable before settings, credentials, network, or supplier process work.

The Connector SHALL resolve supplier assets from exactly one Host-injected fixed overlay root in source mode or one statically verified Electron resources root in packaged mode. Before either activation, SciForge-owned validation SHALL prove the expected overlay identity, receipt version, complete contained inventory, required entrypoints, and per-file digests without executing supplier code. Supplier executable code SHALL run only within the Connector-owned main-process transport after current Principal and Provider-binding revalidation; dependency installation, build, validation, packaging, and public release SHALL never execute it. Official public releases SHALL reject non-empty internal runtime composition.

#### Scenario: Attachment is absent

- **WHEN** SciForge runs from a clean public checkout or packaged application with no verified OpenContent supplier resources
- **THEN** application startup and non-attachment functionality SHALL remain normal, no shadow package or source tree SHALL be consulted, and attachment-backed operations SHALL fail boundedly before supplier dispatch

#### Scenario: Deployment configuration is absent

- **WHEN** the adapter acquires the registered Connector facade without a valid package-owned deployment sidecar
- **THEN** ordinary, Team, and supplier calls SHALL all fail `provider_unavailable` through that same facade before settings, credentials, network, or process work

#### Scenario: Packaged deployment exists without a supplier overlay

- **WHEN** a packaged application contains the valid isolated deployment sidecar but no `resources/opencontent/**` supplier overlay
- **THEN** ordinary HTTP and Team operations SHALL remain available through the canonical Connector facade while supplier transport SHALL remain absent

#### Scenario: Installed attachment no longer matches its receipt

- **WHEN** a file is missing, extra, changed, escaping, wrong-version, or otherwise differs from the trusted complete inventory
- **THEN** source activation or packaging SHALL fail closed before the Provider publishes or invokes that supplier runtime

### Requirement: Writes preserve conflict, cancellation, and uncertainty

Create-folder/upload-new SHALL use the exact explicit parent and name and SHALL never overwrite, auto-rename, retarget, retry blindly, or fall back. Collision SHALL map to typed conflict. Timeout, cancellation, session supersession, or ambiguous receipt after a write may have committed SHALL map to `outcome_unknown` and SHALL NOT retry.

#### Scenario: Upload response is ambiguous

- **WHEN** exact single creation cannot be proven
- **THEN** the adapter SHALL return `outcome_unknown` and SHALL not upload again

### Requirement: Same-file mutation requires Provider-atomic preconditions

`updateFileVersion` and every hash-bound native-document mutation, including `edit`, SHALL remain `blocked_by_contract` unless OpenContent freezes and proves one Provider-side atomic compare-and-mutate operation carrying the exact expected immutable version, revision, or `baseHash`. A local probe, plan receipt, pre-read, write-time re-read, post-write digest, one-shot token, retry suppression, or read followed by upload SHALL NOT emulate CAS. A stale precondition SHALL return a deterministic conflict and prove that no file bytes, native-document state, metadata, version, or partial side effect changed. The exact same-file operation name and semantics, including `UPDATE` versus `UPGRADE`, SHALL be resolved with the supplier before implementation or promotion; aliases SHALL NOT be accepted.

#### Scenario: Native edit validates baseHash before an unconditional write

- **WHEN** the adapter validates probe/plan evidence and current content before invoking a supplier mutation with no atomic `baseHash` precondition
- **THEN** `edit` SHALL fail before supplier invocation because the remaining check/write race violates the Provider contract

#### Scenario: File-version update has no exact CAS

- **WHEN** the supplier upload contract exposes no exact expected-version compare-and-update transaction
- **THEN** `updateFileVersion` SHALL fail closed before Provider invocation and SHALL NOT perform a pre-read followed by upload

### Requirement: Development readiness is trusted and operation-specific

Every implemented, contract-complete OpenContent operation SHALL remain `poc_only` with `runtime_authorization_required` until that exact operation is promoted by a separate evidence-backed code and documentation change. Packaged canonical live verification is per-operation evidence only and SHALL NOT by itself change readiness or create a `production_ready` operation. Implementation, optional skill/attachment presence, mock tests, historical direct API probes, or a successful sibling operation SHALL NOT make an operation `production_ready`. Operations lacking an atomic mutation, immutable retrieval, portal, identity mapping, or other required Provider contract SHALL remain `blocked_by_contract` and SHALL NOT be runtime-admitted.

The OpenContent extended catalog SHALL contain exactly 50 operations. With a valid supplier overlay, exactly 40 SHALL remain `poc_only / runtime_authorization_required` and exactly 10 SHALL remain `blocked_by_contract / provider_contract_missing`. In catalog order, the blocked operations SHALL be `resolveInternalLink`, `listMetadataChoices`, `updateFileVersion`, `searchUsers`, `searchDepartments`, `searchPositions`, `searchGroups`, `resolveCollaborationInvitation`, `listKnowledgeCollections`, and `searchKnowledgeCollections`. Without the supplier overlay, only session-backed `getCurrentPrincipal` SHALL remain `poc_only`; the other 49 extended operations SHALL remain `blocked_by_contract / provider_contract_missing`. PDF export SHALL remain a format of `native-document:export`, and ordinary directory enumeration SHALL remain `listEntries`.

The four OpenContent directory searches SHALL remain blocked because current supplier evidence does not freeze their exact success item, identity, literal-kind, and pagination shapes. The supplier `file-internal-link`, `meta-modeldata`, `collab-link`, and `kbox-list` commands SHALL remain inventory-only and outside the admitted adapter union, so their corresponding five extended operations SHALL fail before supplier transport. `updateFileVersion` SHALL remain blocked by the separate atomic expected-state requirement. Runtime authorization SHALL NOT admit any of these ten operations.

A trusted UI, Agent, or system invocation MAY execute one contract-complete `poc_only / runtime_authorization_required` operation only after the Provider obtains a current provider-neutral binding attestation for the exact Provider Instance and complete Host Principal snapshot. Immediately before business dispatch, the Provider SHALL require the Connector to match the attested opaque external subject and binding revision against the actual current session; bind, unbind, credential replacement, stable external-subject identity change, or binding-revision change SHALL invalidate the admission. Mutable account and display-name metadata SHALL NOT be identity keys or invalidate the same stable subject. Host assurance SHALL not stand in for an external OpenContent account class, and no raw external account identifier SHALL enter caller input or portable authority. Host transfer maxima and the real Provider ACL/DownloadCheck SHALL remain authoritative.

The public OpenContent Provider factory and enrollment view SHALL be composed independently of any `opencontent-base` Agent skill package. Without that skill, personal/Team container discovery and the six contract-complete ordinary operations plus ten Team Administration operations SHALL remain available through runtime authorization. Installing the private skill MAY add Agent instructions and supplier command coverage only; it SHALL NOT create the Provider, select a connection, grant ACL, or change readiness.

#### Scenario: Installed attachment exposes implemented operations

- **WHEN** a valid private supplier overlay contributes native-document or extended operation adapters
- **THEN** contract-complete operations SHALL remain `poc_only` until separately promoted, contract-incomplete operations SHALL remain `blocked_by_contract`, and no operation SHALL be bulk-promoted by attachment presence or packaged live evidence

#### Scenario: One operation passes packaged verification

- **WHEN** a single exact operation succeeds through the packaged canonical path under live runtime authorization
- **THEN** only that exact operation's sanitized evidence record SHALL be marked `live_verified`; `live_verified` SHALL NOT be treated as a readiness state, that operation SHALL remain `poc_only`, sibling evidence and readiness SHALL remain unchanged, and no `production_ready` state SHALL be inferred without a separate promotion change

#### Scenario: Listing is proven but upload schema is not

- **WHEN** the UI or Agent requests upload
- **THEN** upload SHALL retain its own declared readiness and SHALL remain unavailable unless its current binding attestation, authority, Host transfer bounds, and real Provider write authorization all succeed, even though listing succeeds

#### Scenario: Connector account is rebound under the same Host Principal

- **WHEN** the external OpenContent subject or opaque binding revision changes after the invocation was attested
- **THEN** the Provider SHALL fail before the requested Connector business operation and SHALL NOT reuse the Host Principal match as account authority

### Requirement: Project binding, Shared Documents, and artifacts remain separate

This adapter SHALL NOT own ProjectContentSpaceBinding, Project lifecycle, authoritative Project owner or membership, Task file intents or execution identity, Shared Documents, or provider-neutral DocumentProvider semantics. It SHALL expose no Project provisioning operation or Provider port. A future Project-owning integration requires a separately reviewed authoritative contract and SHALL NOT reuse ordinary Team Administration as Project authority. The adapter also SHALL NOT issue an ArtifactReference except under the separate immutable retention and retrieval proof requirement. Project archival/deletion SHALL never trigger Provider deletion.

#### Scenario: Existing-account integration runs before Project binding

- **WHEN** no Project binding contract is installed
- **THEN** existing-account binding and personal/Team operations SHALL remain independently composed, no Project provisioning surface SHALL exist, and no Agent SHALL synthesize Project authority

### Requirement: Artifact Reference issuance requires immutable retention and retrieval proof

The adapter SHALL NOT issue or materialize an ArtifactReference unless OpenContent proves, for the exact Provider Instance and file, a stable immutable version identity, retention guarantee, version-specific retrieval that accepts that identity directly, and continued byte-for-byte retrieval after newer writes. A mutable file identity, latest-version number, optional version field, upload receipt, checksum, or locally retained bytes SHALL not satisfy the contract. Until that proof exists, `observeImmutableVersion` SHALL remain `blocked_by_contract` and results SHALL remain mutable Content File References or native-document receipts.

#### Scenario: Version-like identity and digest are observed

- **WHEN** OpenContent reports a file version value or digest but does not prove immutable retention and version-specific retrieval
- **THEN** no ArtifactReference SHALL be issued and the Provider SHALL not represent the latest mutable file as a fixed artifact
