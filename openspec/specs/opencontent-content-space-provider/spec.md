# opencontent-content-space-provider Specification

## Purpose
Defines the independently composed OpenContent ContentSpaceProvider mapping for bound-account personal/Team libraries, ordinary files, Provider administration, native documents, extended operations, enrollment, and the public/private runtime boundary.
## Requirements
### Requirement: Adapter is independently composed and lazy

`opencontent-content-space-provider` SHALL be an optional trusted compile-time domain package with one main `main.content-space-provider-factory` extension and one renderer `content-space.provider-enrollment-view` extension for Provider Kind `opencontent`. Its main entry SHALL acquire only the Host-issued token-free public Connector facade; its renderer entry MAY adapt the Connector-owned public enrollment component and bounded connection-status capabilities into the provider-neutral enrollment slot. It SHALL register no parallel content capability, IPC/MCP, credential store, raw client, portable resolver, DocumentProvider, or Host feature switch. Main construction and renderer contribution construction SHALL perform no login, credential, network, content, or mutation work.

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

The adapter SHALL expose the six ordinary personal/Team-library operations (list containers, list entries, observe entry, create folder, upload-new up to 16 MiB, and download up to 1 GiB) plus only the strictly typed Content Space administration, native-document, and extended-operation contracts contributed by the installed public runtime and optional verified attachment. Each operation SHALL declare readiness separately and SHALL dispatch only through its matching Content Space feature and the token-free Connector facade; there SHALL be no raw command/API passthrough. OpenContent ACL SHALL remain the permission authority. Unauthorized, unavailable, rate-limited, malformed, conflict, cancellation, and uncertain Provider responses SHALL remain distinct bounded provider-neutral outcomes with no raw response content. Unauthorized SHALL include Human guidance to obtain permission in OpenContent. Team deletion, account creation, credential borrowing, implicit overwrite/rename, synchronization, and unspecified commands SHALL remain absent rather than fall back.

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

The OpenContent Connector, Content Space Provider adapter, and SciForge-authored skill runtime contracts/adapters SHALL remain public source packages installed through the standard public workspace and generated composition path. Optional supplier executable assets SHALL remain receipt-backed runtime data beneath `internal/opencontent/**`, outside the public workspace, lockfile, and package dependency graph. A clean checkout with no attachment SHALL install, build, test, start, and package SciForge normally; ordinary Content Space and public Team-governance adapters MAY remain composed, while attachment-backed native-document and extended operations SHALL be absent or unavailable without a stub, compatibility package, private registry, or fallback resolver.

The Connector SHALL resolve supplier assets from exactly one Host-injected fixed overlay root in source mode or one statically verified Electron resources root in packaged mode. Before either activation, SciForge-owned validation SHALL prove the expected overlay identity, receipt version, complete contained inventory, required entrypoints, and per-file digests without executing supplier code. Supplier executable code SHALL run only within the Connector-owned main-process transport after current Principal and Provider-binding revalidation; dependency installation, build, validation, packaging, and public release SHALL never execute it. Official public releases SHALL reject non-empty internal runtime composition.

#### Scenario: Attachment is absent

- **WHEN** SciForge runs from a clean public checkout or packaged application with no verified OpenContent supplier resources
- **THEN** application startup and non-attachment functionality SHALL remain normal, no shadow package or source tree SHALL be consulted, and attachment-backed operations SHALL fail boundedly before supplier dispatch

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

Every implemented, contract-complete OpenContent operation SHALL remain `poc_only` with `verification_profile_required` until that exact operation is promoted by a separate evidence-backed code and documentation change. Packaged canonical live verification is per-operation evidence only and SHALL NOT by itself change readiness or create a `production_ready` operation. Implementation, attachment presence, mock tests, historical direct API probes, or a successful sibling operation SHALL NOT make an operation `production_ready`. Operations lacking an atomic mutation, immutable retrieval, portal, identity mapping, or other required Provider contract SHALL remain `blocked_by_contract` and SHALL NOT be admitted by a verification profile.

A package-owned trusted Content Space verification profile MAY admit only one exact `poc_only` invocation matching the Provider Instance, complete Host Principal snapshot and assurance, Broker authority, operation, audience, validity period, and bounded transfer limits. Those limits SHALL be enforced as the actual execution maxima. Provider-scoped operations, mutation, administration, and non-zero transfers SHALL also match a current provider-neutral Provider binding attestation containing the exact Provider Instance, an opaque external subject reference, and an opaque binding revision. Immediately before business dispatch, the Provider SHALL require the Connector to match those opaque values against the actual current session; bind, unbind, credential replacement, external-account change, or binding-revision change SHALL invalidate the admission. Host assurance SHALL not stand in for an external OpenContent account class, and no raw external account identifier SHALL enter caller input or portable authority.

#### Scenario: Installed attachment exposes implemented operations

- **WHEN** a valid private attachment contributes native-document or extended operation adapters
- **THEN** contract-complete operations SHALL remain `poc_only` until separately promoted, contract-incomplete operations SHALL remain `blocked_by_contract`, and no operation SHALL be bulk-promoted by attachment presence or packaged live evidence

#### Scenario: One operation passes packaged verification

- **WHEN** a single exact operation succeeds through the packaged canonical path under the trusted verification policy
- **THEN** only that exact operation's sanitized evidence record SHALL be marked `live_verified`; `live_verified` SHALL NOT be treated as a readiness state, that operation SHALL remain `poc_only`, sibling evidence and readiness SHALL remain unchanged, and no `production_ready` state SHALL be inferred without a separate promotion change

#### Scenario: Listing is proven but upload schema is not

- **WHEN** the UI or Agent requests upload
- **THEN** upload SHALL retain its own declared readiness and SHALL remain unavailable unless its exact profile, binding attestation, authority, and enforced transfer limit all match, even though listing succeeds

#### Scenario: Connector account is rebound under the same Host Principal

- **WHEN** the external OpenContent subject or opaque binding revision changes after a verification profile was composed
- **THEN** the Provider SHALL fail before the requested Connector business operation and SHALL NOT reuse the Host Principal match as account authority

### Requirement: Project binding, Shared Documents, and artifacts remain separate

This adapter SHALL NOT own ProjectContentSpaceBinding, Project lifecycle, authoritative Project owner or membership, Task file intents or execution identity, Shared Documents, or provider-neutral DocumentProvider semantics. It MAY implement the provider-neutral Project Content Space provisioning port, but `provision-project` SHALL remain `blocked_by_contract` and no generic Agent capability SHALL expose the port before a Project-owning context supplies an authoritative binding, desired owner/member set, and verified identity mappings. It also SHALL NOT issue an ArtifactReference except under the separate immutable retention and retrieval proof requirement. Project archival/deletion SHALL never trigger Provider deletion.

#### Scenario: Existing-account integration runs before Project binding

- **WHEN** no Project binding contract is installed
- **THEN** existing-account binding and personal/Team operations SHALL remain independently composed, provisioning SHALL remain dormant, and no Agent SHALL synthesize Project authority

### Requirement: Artifact Reference issuance requires immutable retention and retrieval proof

The adapter SHALL NOT issue or materialize an ArtifactReference unless OpenContent proves, for the exact Provider Instance and file, a stable immutable version identity, retention guarantee, version-specific retrieval that accepts that identity directly, and continued byte-for-byte retrieval after newer writes. A mutable file identity, latest-version number, optional version field, upload receipt, checksum, or locally retained bytes SHALL not satisfy the contract. Until that proof exists, `observeImmutableVersion` SHALL remain `blocked_by_contract` and results SHALL remain mutable Content File References or native-document receipts.

#### Scenario: Version-like identity and digest are observed

- **WHEN** OpenContent reports a file version value or digest but does not prove immutable retention and version-specific retrieval
- **THEN** no ArtifactReference SHALL be issued and the Provider SHALL not represent the latest mutable file as a fixed artifact
