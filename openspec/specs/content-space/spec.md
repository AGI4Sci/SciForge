# content-space Specification

## Purpose

Defines the provider-neutral Content Space domain, its ContentSpaceProvider contract, common renderer surface, ordinary-file and Provider-declared feature operations, portable references, Project authority boundary, and immutable-artifact boundary.

## Requirements

### Requirement: Content Space is an independent trusted domain package

SciForge SHALL deliver `packages/domains/content-space` as a trusted compile-time domain package with a standard `sciforge.domain.json`, pure definition entrypoint, separate main and renderer entrypoints, lazy activation, package-owned tests, and generated source/packaged composition. Its public contract SHALL contain only Content Space and generic SDK/portable-reference terms and SHALL NOT import Shared Documents, OpenContent, any Provider integration, Cloud Collaboration, Project, Task, Coordinator, or Host-private `src/main`, `src/renderer`, `src/shared`, `@shared`, or `@renderer` paths. Agent transfer contracts MAY use the public Domain SDK's Workspace-relative path and Host-owned transfer-handle schemas, but Content Space SHALL NOT own Workspace filesystem semantics, accept arbitrary filesystem paths, or import Workspace implementation code.

#### Scenario: Provider integration is added or removed

- **WHEN** a compatible ContentSpaceProvider package is installed, paused, replaced, or omitted
- **THEN** Content Space contracts, generic Host Core, and renderer contribution host SHALL require no vendor-specific edit

#### Scenario: Domain package is disabled

- **WHEN** standard generated composition omits or disables Content Space
- **THEN** its capabilities, runtime lifecycle, commands, toolbar placement, and UI SHALL all disappear without a feature map or compatibility entrypoint

### Requirement: Content Space owns ContentSpaceProvider and its catalog

Content Space SHALL own a strict provider-neutral ContentSpaceProvider contract covering capability description, containers, entry observation, bounded navigation, create-folder, upload-new, download, safe portal target, immutable-version observation, and separately declared native-document, extended-operation, and Provider-administration feature families. Its domain-owned catalog/service SHALL consume only compatible `main.content-space-provider-factory` main extensions after trusted Provider Instance resolution. An optional provider-neutral Project provisioning port MAY compose inside the administration feature but SHALL remain dormant unless a Project-owning context supplies authoritative binding and identity evidence.

#### Scenario: Integration also implements DocumentProvider

- **WHEN** the same package contributes both domain factories
- **THEN** Content Space SHALL validate and consume only its exact Content Space contribution and SHALL NOT observe document methods or readiness

#### Scenario: Mock Provider is available for contract tests

- **WHEN** the `content-space-mock-provider` declares `composition: development-only`
- **THEN** generated production composition SHALL omit it while package and integration tests exercise the same manifest factory and instance contracts without a Host exception

### Requirement: Content Space owns typed portable reference kinds

Content Space SHALL own strict codecs for ContentContainerReference and ContentFileReference and the gated ArtifactReference schema/issuance rule. Each portable identity SHALL bind one trusted ProviderInstanceRef and provider resource identity without endpoint, path/name, display metadata, credential, connection, permission, audience, Broker handle, or Provider DTO. The codecs and exact Content Space resolver SHALL be composed as generic main extensions and materialized/exported only through the owner-scoped Portable Resource References Host service.

#### Scenario: Reference crosses a boundary

- **WHEN** a Content Space reference is persisted, copied, or transported to another node
- **THEN** it SHALL remain non-authorizing and SHALL require local codec validation, exact instance resolution, current-Principal reauthorization, and fresh Broker resource issuance

#### Scenario: Reference authority is forged

- **WHEN** the envelope names an unknown/duplicate instance, mismatched Provider, or identity that the pinned Provider cannot prove
- **THEN** materialization SHALL fail closed without trying any other Provider or resolver

### Requirement: Artifact Reference requires exact immutable provider proof

Content Space SHALL issue or materialize ArtifactReference only when the pinned Provider proves immutable version identity, retention guarantee, version-specific retrieval, and proof for the same Provider Instance, file identity, and immutable version identity. If the reference carries a digest, the current proof SHALL carry the exact same algorithm and value. Mutable latest identity, an optional version field, checksum alone, or upload receipt SHALL not satisfy the contract.

#### Scenario: Upload succeeds without immutability proof

- **WHEN** upload-new completes but the Provider cannot prove all immutable-version conditions
- **THEN** the result SHALL remain a ContentFileReference and no ArtifactReference SHALL be issued

#### Scenario: Immutable proof belongs to another file or instance

- **WHEN** proof fields do not exactly match the reference being issued or materialized
- **THEN** ArtifactReference validation SHALL fail without producing a local resource

### Requirement: Content Space uses generic renderer contributions

The package SHALL publish its UI through the current generic renderer contribution host, including stable `renderer.command` launch actions, standard workbench placement, and a provider-neutral lazy UI. It SHALL use only public Content Space schemas and the generic renderer capability client. A Provider package MAY contribute one renderer enrollment view through the generic `content-space.provider-enrollment-view` extension keyed by Provider Kind; Content Space SHALL treat the view's private state as opaque and only its bounded provider-neutral access status as UI state. Enrollment MAY invoke the owning Connector's public enrollment capabilities, but SHALL NOT become a second content-operation path or authorization proof. The UI SHALL NOT restore a parallel registry, add a Host Content Space feature map or domain-ID switch, use iframe/webview, route content operations by extension/MIME, expose raw Provider clients/DTOs/endpoints/credentials, or call a ContentSpaceProvider directly.

The UI SHALL support trusted Provider Instance and container selection, bounded directory/file listing, create-folder, upload-new, download, resource/reference display, readiness, progress, cancellation, and bounded errors.

#### Scenario: Two Providers are installed

- **WHEN** both declare compatible Content Space factories and instances
- **THEN** the same renderer UI SHALL present provider-neutral data and operations without vendor branches or an arbitrary default

#### Scenario: Renderer attempts direct Provider access

- **WHEN** a renderer content-operation payload supplies a factory/package ID, endpoint, raw Provider operation, credential, raw Connector command, or readiness promotion
- **THEN** no such public path SHALL exist and no Provider call SHALL occur

#### Scenario: Provider contributes enrollment UI

- **WHEN** a compatible renderer enrollment extension matches the selected Provider Kind
- **THEN** Content Space MAY render it for bind, unbind, or reauthentication and SHALL re-run canonical Provider discovery after its access state changes without treating renderer state as operation authority

### Requirement: Every operation follows one governed canonical path

UI, Agent, and trusted system callers SHALL reach every ordinary, native-document, extended, and administration Content Space operation only through Capability Broker invocation, the Content Space capability handler, ContentSpaceService, trusted ProviderInstanceRef resolution, ContentSpaceProviderCatalog selection, and the pinned ContentSpaceProvider feature. A concrete integration MAY then use its one package-owned Connector transport, but Content Space SHALL neither require nor select a vendor Connector. Host SHALL inject the current Principal. A write's logical invocation identity SHALL be admitted and idempotency-bound by the Broker invocation envelope outside the Content Space business payload; domain input and Provider output SHALL NOT replace it. No parallel IPC, MCP, facade, service, registry, raw Provider, Connector, or fallback path SHALL implement the same behavior.

#### Scenario: Agent and UI perform equivalent reads

- **WHEN** admitted Agent and renderer callers request the same Content Space operation
- **THEN** both SHALL traverse the same Broker handler, service validation, instance resolution, catalog, and Provider operation

#### Scenario: Business payload injects a Principal or invocation identity

- **WHEN** Content Space business input attempts to replace Host Principal or the Broker invocation envelope
- **THEN** strict payload validation SHALL reject it; only the Broker-admitted out-of-band invocation identity MAY reach the handler

### Requirement: Current Principal and authorization govern all access

Each operation SHALL require the Host-asserted current PrincipalSnapshot at the assurance required by policy. The service and Provider SHALL reauthorize the exact instance and resource for that Principal. A Principal switch, sign-out, identity-version change, assurance downgrade, cancellation, or permission revocation SHALL invalidate stale authority and SHALL NOT reuse another Human's materialization, portal grant, Provider connection, idempotency result, or observation.

#### Scenario: Principal changes between selection and operation

- **WHEN** a different Principal becomes current before a Provider operation or local resource issuance
- **THEN** the operation SHALL stop or reauthorize from the new trusted context, never continue with the captured credential or grant

### Requirement: Readiness is explicit per operation

Every ordinary, native-document, extended, and administration operation SHALL declare exactly one descriptive readiness state: `poc_only`, `blocked_by_contract`, or `production_ready`. Content Space SHALL evaluate the current invocation's admission separately from that declaration using the trusted Provider contribution, Provider Instance policy, Broker authority, resource capability, platform Gate, audience, current Principal, and any installed verification profile. An admitted `poc_only` invocation SHALL continue to be reported as `poc_only`; admission SHALL NOT rewrite it as `production_ready`. `blocked_by_contract` SHALL never be admitted.

`poc_only` SHALL remain non-executable unless Content Space composition installs a separately reviewed trusted verification profile that exactly matches the Provider Instance, complete Host Principal snapshot and assurance, authority, operation, audience, bounded validity period, and transfer limits. The matched transfer limits SHALL be enforced as the actual maximum bytes accepted or emitted by that invocation, not merely compared with a global constant. Provider-instance authority without a Provider binding attestation MAY admit only the zero-transfer read-only `list-containers` bootstrap; exact Broker-authoritative content-root authority without such attestation MAY admit only zero-transfer reads. Mutation, administration, Provider-scoped operations, and non-zero transfers SHALL additionally require a current Provider binding attestation for the exact Provider Instance, opaque external subject reference, and opaque binding revision. Content Space SHALL obtain and match the current attestation only through the pinned Provider before admission. A Connector-backed Provider SHALL pass that exact expected attestation through its canonical Connector boundary, which SHALL re-attest the actual session immediately before business dispatch; rebind, unbind, or revision change SHALL invalidate admission.

Caller input, renderer state, Agent request, filename, extension/MIME, Task, prompt text, ordinary environment/configuration, package presence, or a successful sibling operation SHALL NOT install, select, widen, or promote a verification profile or readiness state. Host assurance SHALL NOT be treated as an external Provider account class.

#### Scenario: Operation is unavailable

- **WHEN** any effective Gate blocks it or no exact trusted verification profile matches a `poc_only` operation
- **THEN** discovery SHALL preserve the declared readiness while current admission is unavailable, and execution SHALL fail before the requested Provider business operation and any remote mutation with a bounded unavailable result

#### Scenario: Verification profile admits one exact operation

- **WHEN** a reviewed static profile and all trusted invocation facts match one `poc_only` operation
- **THEN** only that invocation MAY traverse the canonical path, its declared readiness SHALL remain `poc_only`, and every unmatched operation or caller SHALL remain blocked

#### Scenario: Connector binding changes after admission begins

- **WHEN** the pinned Provider or its current Connector session reports an external subject or opaque binding revision that no longer matches the attested profile facts
- **THEN** Content Space SHALL stop before Provider business dispatch and SHALL NOT reuse the prior account authority

### Requirement: Verification profiles compose as exact static package contributions

Content Space SHALL discover verification profiles only through generic package-owned `main.extension` composition at `main.content-space-verification-profile`. Each contribution SHALL contain one strict static profile whose manifest contract and runtime value are identical. Zero profiles SHALL leave PoC admission disabled; invalid metadata, contract/value drift, duplicate profile identity, unsafe authority, or a mutation/administration profile lacking the required Provider binding attestation SHALL fail composition. The Host SHALL contain no domain-ID switch, default profile, or caller/configuration profile loader.

Every official public release path SHALL reject any active verification-profile contribution before build, signing, or upload and SHALL repeat that check after packaging. Local internal acceptance MAY compose a reviewed disposable profile only outside public release mode.

#### Scenario: Verification contribution drifts

- **WHEN** a manifest profile differs from its runtime contribution or duplicates another profile identity
- **THEN** Content Space activation SHALL fail instead of ignoring, merging, or selecting one value

#### Scenario: Public release contains an acceptance profile

- **WHEN** an official public build or packaged artifact contains an active Content Space verification-profile contribution
- **THEN** release SHALL fail closed before signing or upload without logging Principal, root, or external-binding profile values

### Requirement: Navigation, progress, and cancellation are bounded

Container and entry listing SHALL enforce bounded page size, opaque bounded cursor, result limits, cancellation, and deterministic error bounds. Long-running transfer operations SHALL report only bounded finite phase progress from the closed V1 phase set (`selecting`, `preparing`, `uploading` or `downloading`, `finalizing`, and one of `succeeded`, `failed`, or `cancelled`); V1 does not promise byte-level telemetry. Renderer cancellation SHALL propagate through the generic capability transport and Broker AbortSignal to the service and Provider; switching instance/container or destroying the renderer SHALL cancel superseded work.

#### Scenario: Page or cursor exceeds bounds

- **WHEN** input asks for an unbounded listing or malformed cursor
- **THEN** Content Space SHALL reject it before Provider contact

#### Scenario: User cancels an upload or switches container

- **WHEN** cancellation reaches the Broker before a definitive result
- **THEN** the service SHALL signal the pinned Provider, suppress stale UI state, and return a bounded cancellation or `outcome_unknown` result according to Provider evidence

### Requirement: Writes are explicit, uniquely authorized, and never blindly retried

Every ordinary, native-document, extended, and administration write SHALL require the current authorized Principal, exact Broker authority for every target, a separately admitted operation, bounded typed input, cancellation, and one Broker-admitted logical invocation identity outside the business payload. Create-folder and upload-new SHALL additionally require one explicit container/parent target and bounded Human-approved name/input. The Provider and service SHALL not replace or manufacture the invocation identity, overwrite implicitly, choose another target, widen from one resource to a sibling, or retry after an uncertain result. Collision SHALL return a typed conflict and an indeterminate remote result SHALL return `outcome_unknown`.

#### Scenario: Name already exists

- **WHEN** create-folder or upload-new would collide
- **THEN** the service SHALL return the typed conflict without overwrite, rename, or target change

#### Scenario: Write outcome is uncertain

- **WHEN** cancellation, timeout, session supersession, or transport loss prevents proof of success or failure
- **THEN** the operation SHALL return `outcome_unknown` and SHALL NOT automatically retry

### Requirement: Agent file transfers use only bounded Workspace-relative paths

Agent upload, import, image upload, attachment upload, download, export, and equivalent transfer contracts SHALL accept only a Workspace-relative path in the current execution context's authorized Workspace. Host SHALL validate real-path containment, regular-file type, symlink escape, size, and access before opening a one-shot upload source. A download destination SHALL be new, containment-validated, no-overwrite, written through a temporary file, bounded to the admitted profile limit, and atomically committed only after successful completion. Renderer, Agent, portable reference, Provider business input, and logs SHALL never receive a raw local path authority or reusable Host transfer handle.

#### Scenario: Agent destination exists or escapes the Workspace

- **WHEN** a download names an existing target, absolute path, traversal, or symlink escape
- **THEN** Host SHALL reject it before Provider transfer and SHALL neither overwrite nor write outside the authorized Workspace

### Requirement: Same-file mutation requires a Provider-atomic precondition

Any same-file, expected-version, expected-revision, or hash-bound mutation SHALL remain `blocked_by_contract` unless the Provider performs one atomic compare-and-mutate operation against the exact expected immutable version, revision, or content hash and proves that a stale conflict caused zero mutation. A local probe, plan receipt, pre-read, write-time re-read, one-shot token, post-write digest, retry suppression, or read followed by upload SHALL NOT substitute for the Provider-atomic precondition.

#### Scenario: Hash is checked before an unconditional write

- **WHEN** Content Space or a Provider adapter validates the current hash and then invokes a mutation that carries no atomic expected-state precondition
- **THEN** dispatch SHALL remain blocked before the remote mutation because the check/write race is not closed

### Requirement: Download uses a Host-owned destination

Download SHALL require current authorization, explicit source, bounded transfer, cancellation, and a destination selected and owned by Host through a generic transfer handle. Renderer, Agent, portable reference, log, browser, and UI state SHALL never receive a credential-bearing URL, Token, raw local path authority, or Provider transport secret.

#### Scenario: Provider offers only a bearer URL to renderer

- **WHEN** bytes cannot be delivered through the Host-owned main-process transfer path without exposing a credential
- **THEN** download SHALL remain blocked rather than open or return that URL

### Requirement: Portal launch uses a reauthorized opaque grant

An optional Provider portal target SHALL first be validated by Content Space against the selected Provider operation. Content Space SHALL reject a non-HTTPS, userinfo-bearing, fragment-bearing, oversized, or invalid-lifetime target. Host SHALL retain the exact target only in main process and project only a short-lived, single-use opaque handle to renderer; the URL and any query data SHALL NOT cross that boundary. The Host grant SHALL bind the package owner, caller, Principal/identity version, exact target, and expiry; opening SHALL reauthorize the current Principal and consume the grant through the canonical Host external-navigation path.

#### Scenario: Portal handle is replayed or Principal changes

- **WHEN** a handle is expired, already consumed, tampered with, used by another caller, or used after a Principal change
- **THEN** Host SHALL reject it without revealing or opening the underlying target

### Requirement: Provider reference never falls back

A Content Space reference SHALL remain bound to its Provider Instance. Missing, disabled, blocked, incompatible, unavailable, unauthorized, or uncertain behavior SHALL NOT invoke another Provider, infer from extension/MIME, choose a default, reinterpret identity, reuse another connection, or silently copy bytes.

#### Scenario: Pinned Provider is offline

- **WHEN** another ContentSpaceProvider is installed and could store similar files
- **THEN** Content Space SHALL return the pinned Provider outcome and SHALL NOT contact the other Provider

### Requirement: Project provisioning authority comes only from the Project-owning context

Content Space MAY expose a provider-neutral Project Content Space provisioning port to a trusted consuming context, but SHALL NOT register a generic Agent capability that accepts caller-authored Project identity, owner, membership, coordinator, or binding intent. Provisioning SHALL remain dormant until the Project-owning context supplies an authoritative Project Content Space Binding and verified identity mappings through a separately reviewed integration. Project archival or deletion SHALL never trigger Provider deletion.

Ordinary Agent administration MAY create a non-Project shared Content Container, but its business request SHALL accept only the shared-container label. The logical invocation identity SHALL come solely from the Broker invocation envelope outside that business request. The capability handler SHALL derive the owner from the Broker's current Principal, and the Provider SHALL map only that Principal's currently authenticated external binding. Caller-authored invocation identity, owner, member, coordinator, Project, or external-account fields SHALL NOT be accepted.

#### Scenario: Ordinary Agent supplies Project membership

- **WHEN** an Agent attempts to provision or reconcile a Project content root from prompt or capability payload fields
- **THEN** no generic capability SHALL accept the request and no Provider administration operation SHALL occur

#### Scenario: Provider implements the dormant provisioning port

- **WHEN** no authoritative Project Content Space Binding consumer is installed
- **THEN** the port MAY compose but SHALL create no Project root and confer no Agent authority

#### Scenario: Agent creates an ordinary shared container

- **WHEN** an admitted Agent requests shared-container creation with a label and the Broker envelope supplies the logical invocation identity
- **THEN** Content Space SHALL inject the current Principal as owner, reject caller-authored ownership or Project fields, and SHALL NOT treat the result as Project provisioning

### Requirement: Domain-external responsibilities remain absent

Content Space SHALL NOT own Project, Task, Coordinator, or Cloud Collaboration semantics; a Task-specific Content Space port; Shared Documents or DocumentProvider; Workspace projection, synchronization, mirroring, mounting, or ownership; Git sync; raw/generic Provider APIs; credentials, endpoints, connection selection, or Provider DTOs; or Host/vendor-specific routing. Provider-neutral native-document, extended-operation, administration, enrollment, and Workspace-transfer contracts MAY exist only through their single governed Content Space paths and SHALL NOT become alternate raw Provider surfaces. A Provider integration MAY intentionally omit destructive or unsupported operations; absence SHALL remain absence rather than a compatibility alias or fallback.

#### Scenario: Domain-external operation is attempted

- **WHEN** a caller attempts a Project/Task action, raw Provider request, credential selection, Workspace projection, or unsupported Provider operation through an identifier, browser automation, malformed input, or compatibility alias
- **THEN** it SHALL fail without remote mutation or alternate path
