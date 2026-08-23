## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: Development readiness is trusted and operation-specific

Every implemented, contract-complete OpenContent operation SHALL remain `poc_only` with `verification_profile_required` until that exact operation is promoted by a separate evidence-backed code and documentation change. Packaged canonical live verification is per-operation evidence only and SHALL NOT by itself change readiness or create a `production_ready` operation. Implementation, attachment presence, mock tests, historical direct API probes, or a successful sibling operation SHALL NOT make an operation `production_ready`. Operations lacking an atomic mutation, immutable retrieval, portal, identity mapping, or other required Provider contract SHALL remain `blocked_by_contract` and SHALL NOT be admitted by a verification profile.

The OpenContent extended catalog SHALL contain exactly 50 operations. With a valid overlay, exactly 40 SHALL remain `poc_only / verification_profile_required` and exactly 10 SHALL remain `blocked_by_contract / provider_contract_missing`. In catalog order, the blocked operations SHALL be `resolveInternalLink`, `listMetadataChoices`, `updateFileVersion`, `searchUsers`, `searchDepartments`, `searchPositions`, `searchGroups`, `resolveCollaborationInvitation`, `listKnowledgeCollections`, and `searchKnowledgeCollections`. Without the overlay, only session-backed `getCurrentPrincipal` SHALL remain `poc_only`; the other 49 extended operations SHALL remain `blocked_by_contract / provider_contract_missing`. PDF export SHALL remain a format of `native-document:export`, and ordinary directory enumeration SHALL remain `listEntries`.

The four OpenContent directory searches SHALL remain blocked because current supplier evidence does not freeze their exact success item, identity, literal-kind, and pagination shapes. The supplier `file-internal-link`, `meta-modeldata`, `collab-link`, and `kbox-list` commands SHALL remain inventory-only and outside the admitted adapter union, so their corresponding five extended operations SHALL fail before supplier transport. `updateFileVersion` SHALL remain blocked by the separate atomic expected-state requirement. A verification profile SHALL NOT admit any of these ten operations.

A package-owned trusted Content Space verification profile MAY admit only one exact `poc_only` invocation matching the Provider Instance, complete Host Principal snapshot and assurance, Broker authority, operation, audience, validity period, and bounded transfer limits. Those limits SHALL be enforced as the actual execution maxima. Provider-scoped operations, mutation, administration, and non-zero transfers SHALL also match a current provider-neutral Provider binding attestation containing the exact Provider Instance, an opaque external subject reference, and an opaque binding revision. Immediately before business dispatch, the Provider SHALL require the Connector to match those opaque values against the actual current session; bind, unbind, credential replacement, stable external-subject identity change, or binding-revision change SHALL invalidate the admission. Mutable account and display-name metadata SHALL NOT be identity keys or invalidate the same stable subject. Host assurance SHALL not stand in for an external OpenContent account class, and no raw external account identifier SHALL enter caller input or portable authority.

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

### Requirement: Project binding, Shared Documents, and artifacts remain separate

This adapter SHALL NOT own ProjectContentSpaceBinding, Project lifecycle, authoritative Project owner or membership, Task file intents or execution identity, Shared Documents, or provider-neutral DocumentProvider semantics. It SHALL expose no Project provisioning operation or Provider port. A future Project-owning integration requires a separately reviewed authoritative contract and SHALL NOT reuse ordinary Team Administration as Project authority. The adapter also SHALL NOT issue an ArtifactReference except under the separate immutable retention and retrieval proof requirement. Project archival/deletion SHALL never trigger Provider deletion.

#### Scenario: Existing-account integration runs before Project binding

- **WHEN** no Project binding contract is installed
- **THEN** existing-account binding and personal/Team operations SHALL remain independently composed, no Project provisioning surface SHALL exist, and no Agent SHALL synthesize Project authority

### Requirement: Same-file mutation requires Provider-atomic preconditions

`updateFileVersion` and every hash-bound native-document mutation, including `edit`, SHALL remain `blocked_by_contract` unless OpenContent freezes and proves one Provider-side atomic compare-and-mutate operation carrying the exact expected immutable version, revision, or `baseHash`. A local probe, plan receipt, pre-read, write-time re-read, post-write digest, one-shot token, retry suppression, or read followed by upload SHALL NOT emulate CAS. A stale precondition SHALL return a deterministic conflict and prove that no file bytes, native-document state, metadata, version, or partial side effect changed. The exact same-file operation name and semantics, including `UPDATE` versus `UPGRADE`, SHALL be resolved with the supplier before implementation or promotion; aliases SHALL NOT be accepted.

#### Scenario: Native edit validates baseHash before an unconditional write

- **WHEN** the adapter validates probe/plan evidence and current content before invoking a supplier mutation with no atomic `baseHash` precondition
- **THEN** `edit` SHALL fail before supplier invocation because the remaining check/write race violates the Provider contract

#### Scenario: File-version update has no exact CAS

- **WHEN** the supplier upload contract exposes no exact expected-version compare-and-update transaction
- **THEN** `updateFileVersion` SHALL fail closed before Provider invocation and SHALL NOT perform a pre-read followed by upload
