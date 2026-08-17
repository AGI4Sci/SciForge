# content-space Specification

## Purpose

Defines the provider-neutral Content Space domain, its ContentSpaceProvider contract, common renderer surface, ordinary-file operations, portable references, and immutable-artifact boundary.

## Requirements

### Requirement: Content Space is an independent trusted domain package

SciForge SHALL deliver `packages/domains/content-space` as a trusted compile-time domain package with a standard `sciforge.domain.json`, pure definition entrypoint, separate main and renderer entrypoints, lazy activation, package-owned tests, and generated source/packaged composition. Its public contract SHALL contain only Content Space and generic SDK/portable-reference terms and SHALL NOT import Shared Documents, OpenContent, any Provider integration, Cloud Collaboration, Project, Task, Coordinator, Workspace, or Host-private `src/main`, `src/renderer`, `src/shared`, `@shared`, or `@renderer` paths.

#### Scenario: Provider integration is added or removed

- **WHEN** a compatible ContentSpaceProvider package is installed, paused, replaced, or omitted
- **THEN** Content Space contracts, generic Host Core, and renderer contribution host SHALL require no vendor-specific edit

#### Scenario: Domain package is disabled

- **WHEN** standard generated composition omits or disables Content Space
- **THEN** its capabilities, runtime lifecycle, commands, toolbar placement, and UI SHALL all disappear without a feature map or compatibility entrypoint

### Requirement: Content Space owns ContentSpaceProvider and its catalog

Content Space SHALL own a strict provider-neutral ContentSpaceProvider contract covering capability description, containers, entry observation, bounded navigation, create-folder, upload-new, download, safe portal target, and immutable-version observation. Its domain-owned catalog/service SHALL consume only compatible `main.content-space-provider-factory` main extensions after trusted Provider Instance resolution.

#### Scenario: Integration also implements DocumentProvider

- **WHEN** the same package contributes both domain factories
- **THEN** Content Space SHALL validate and consume only its exact Content Space contribution and SHALL NOT observe document methods or readiness

#### Scenario: Mock Provider is installed

- **WHEN** the trusted compile-time `content-space-mock-provider` contributes its standard manifest factory and instance
- **THEN** the production catalog/service/UI path SHALL operate without a test-only registry or Host exception

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

The package SHALL publish its UI through the current generic renderer contribution host, including stable `renderer.command` launch actions, standard workbench placement, and a provider-neutral lazy UI. It SHALL use only public Content Space schemas and the generic renderer capability client. It SHALL NOT restore a parallel registry, add a Host Content Space feature map or domain-ID switch, inject Provider renderer code, use iframe/webview/vendor UI, route by extension/MIME, expose raw Provider clients/DTOs/endpoints/credentials, or call a Provider directly.

The UI SHALL support trusted Provider Instance and container selection, bounded directory/file listing, create-folder, upload-new, download, resource/reference display, readiness, progress, cancellation, and bounded errors.

#### Scenario: Two Providers are installed

- **WHEN** both declare compatible Content Space factories and instances
- **THEN** the same renderer UI SHALL present provider-neutral data and operations without vendor branches or an arbitrary default

#### Scenario: Renderer attempts direct Provider access

- **WHEN** renderer supplies a factory/package ID, endpoint, raw Provider operation, credential, Connector command, or readiness promotion
- **THEN** no such public path SHALL exist and no Provider call SHALL occur

### Requirement: Every operation follows one governed canonical path

UI, Agent, and trusted system callers SHALL reach Content Space only through Capability Broker invocation, the Content Space capability handler, ContentSpaceService, trusted ProviderInstanceRef resolution, ContentSpaceProviderCatalog selection, the pinned ContentSpaceProvider, and then the requested operation. Host SHALL inject the current Principal. A write's logical invocation identity SHALL be admitted and idempotency-bound by the Broker invocation envelope outside the Content Space business payload; domain input and Provider output SHALL NOT replace it. No parallel IPC, MCP, facade, service, registry, raw Provider, Connector, or fallback path SHALL implement the same behavior.

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

Every operation SHALL be exactly `poc_only`, `blocked_by_contract`, or `production_ready`, constrained by the trusted Provider contribution, instance policy, resource capability, platform Gate, and audience policy. `poc_only` SHALL remain non-executable through the normal product path unless a separately reviewed trusted PoC policy and audience Gate is installed in Content Space service composition; without that Gate it is rejected like `blocked_by_contract`. Caller input, renderer state, Agent request, filename, extension/MIME, Task, environment text, or ordinary configuration SHALL NOT promote readiness.

#### Scenario: Operation is unavailable

- **WHEN** any effective Gate blocks it
- **THEN** it SHALL be absent from discovery or fail before the requested Provider business operation and any remote mutation with a bounded unavailable result

### Requirement: Navigation, progress, and cancellation are bounded

Container and entry listing SHALL enforce bounded page size, opaque bounded cursor, result limits, cancellation, and deterministic error bounds. Long-running transfer operations SHALL report only bounded finite phase progress from the closed V1 phase set (`selecting`, `preparing`, `uploading` or `downloading`, `finalizing`, and one of `succeeded`, `failed`, or `cancelled`); V1 does not promise byte-level telemetry. Renderer cancellation SHALL propagate through the generic capability transport and Broker AbortSignal to the service and Provider; switching instance/container or destroying the renderer SHALL cancel superseded work.

#### Scenario: Page or cursor exceeds bounds

- **WHEN** input asks for an unbounded listing or malformed cursor
- **THEN** Content Space SHALL reject it before Provider contact

#### Scenario: User cancels an upload or switches container

- **WHEN** cancellation reaches the Broker before a definitive result
- **THEN** the service SHALL signal the pinned Provider, suppress stale UI state, and return a bounded cancellation or `outcome_unknown` result according to Provider evidence

### Requirement: Writes are explicit, unique, and never blindly retried

Create-folder and upload-new SHALL require the current authorized Principal, one explicit container/parent target, bounded Human-approved name and input, cancellation, and one Broker-admitted logical invocation identity outside the business payload. The Provider and service SHALL not replace or manufacture that identity, overwrite, choose a different target, or retry after an uncertain result. Collision SHALL return a typed conflict and an indeterminate remote result SHALL return `outcome_unknown`.

#### Scenario: Name already exists

- **WHEN** create-folder or upload-new would collide
- **THEN** the service SHALL return the typed conflict without overwrite, rename, or target change

#### Scenario: Write outcome is uncertain

- **WHEN** cancellation, timeout, session supersession, or transport loss prevents proof of success or failure
- **THEN** the operation SHALL return `outcome_unknown` and SHALL NOT automatically retry

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

### Requirement: Excluded V1 operations remain absent

V1 SHALL NOT expose overwrite/update, move, rename, delete, share, ACL/member administration, rollback, generalized migration, Project/Task/Coordinator or Cloud Collaboration semantics, Workspace projection, Git sync, Portable Resource Open Routing, collaborative-document launch/edit, OpenContent APIs, credentials, Connectors, provider adapters, or Shared Documents through Content Space.

#### Scenario: Excluded operation is attempted

- **WHEN** a caller attempts an excluded action through an identifier, raw Provider, browser automation, malformed input, or compatibility alias
- **THEN** it SHALL fail without remote mutation or alternate path
