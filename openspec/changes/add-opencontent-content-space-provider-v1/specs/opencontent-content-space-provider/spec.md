## Purpose

Defines the future optional OpenContent implementation of ContentSpaceProvider and the boundary before a separately admitted cloud-space PoC.

## ADDED Requirements

### Requirement: Adapter is independently composed and lazy

`opencontent-content-space-provider` SHALL be an optional trusted compile-time main-only package with exactly one generic main extension at `main.content-space-provider-factory` for Provider Kind `opencontent`. Declaration/runtime version, location, kind, and owner SHALL match. Factory/catalog construction SHALL perform no network, credential, login, content, or remote mutation work.

#### Scenario: Adapter is absent or paused

- **WHEN** the package is omitted
- **THEN** Content Space, its UI, mock/other Providers, and source/packaged application SHALL continue while pinned OpenContent instances report unavailable without fallback

### Requirement: Adapter consumes only its Host-issued Connector facade

The adapter SHALL use only the token-free OpenContent Content Space facade issued by a package-generic Host mediator to its trusted main-entry owner. A raw callable Connector port SHALL NOT appear in the global contribution host. The adapter SHALL expose only ContentSpaceProvider types and SHALL NOT access credentials, log in, issue raw HTTP, select endpoints/connections, expose DTO/client/Token, or acquire another consumer's facade.

#### Scenario: Raw infrastructure is requested

- **WHEN** adapter code or caller requests a Token, Cookie, credential, endpoint, raw client/DTO, or another port
- **THEN** no such contract SHALL exist and no OpenContent operation SHALL occur

### Requirement: Adapter adds no parallel domain or reference surface

The package SHALL register no DocumentProvider, Document port, portable codec/resolver, renderer, Agent/MCP capability, IPC, service facade, or universal Provider. Content Space SHALL continue to own its capabilities, UI, references, resolver, transfer/navigation, and immutable-artifact decision.

#### Scenario: Portable OpenContent reference is materialized

- **WHEN** Content Space receives a reference pinned to an OpenContent instance
- **THEN** it SHALL traverse Content Space resolver → service → trusted directory → Content Space catalog → pinned adapter Provider → Host-issued Connector facade, with no OpenContent resolver or alternate path

### Requirement: Instance, Principal, target, and invocation remain exact

Every adapter operation and result SHALL be bound to the Connector-contributed trusted ProviderInstanceRef, Host current Principal/connection, explicit container/parent/resource, Broker-admitted logical invocation identity for writes outside the business payload, cancellation state, and capability/readiness. Business input and Provider output SHALL NOT replace those bindings.

#### Scenario: Result belongs to another instance or target

- **WHEN** Connector/provider output does not match the pinned operation
- **THEN** the adapter SHALL return a bounded contract violation and SHALL NOT issue a reference or retry elsewhere

### Requirement: Writes preserve conflict and uncertainty

Create-folder/upload-new SHALL never overwrite, silently rename/retarget, blindly retry, or fall back. A collision SHALL map to typed conflict; timeout, cancellation, session supersession, or ambiguous receipt SHALL map to `outcome_unknown`.

#### Scenario: Upload response is ambiguous

- **WHEN** the adapter cannot prove whether exact bytes were created once at the explicit target
- **THEN** it SHALL return `outcome_unknown` and SHALL NOT retry

### Requirement: Transfers, portals, and artifacts preserve Host/domain Gates

Download SHALL deliver only through the Host-owned destination path without returning a bearer URL. Content Space SHALL reject a non-HTTPS, userinfo-bearing, fragment-bearing, oversized, or invalid-lifetime portal target; Host SHALL retain the exact target only in main process and expose only a one-shot opaque grant bound to package owner, caller, current Principal, target, and expiry. ArtifactReference SHALL remain blocked until exact immutable version identity, retention, version retrieval, and Provider Instance/file/version proof are validated at issue and materialization; if the reference carries a digest, the current proof SHALL match it exactly.

#### Scenario: Provider returns a version field or token URL

- **WHEN** immutability or secret-free main-process transfer is not proven
- **THEN** ArtifactReference or download respectively SHALL remain blocked

### Requirement: Adapter completion precedes cloud-space PoC admission

Every operation SHALL begin `blocked_by_contract`. Evidence alone SHALL NOT make `poc_only` executable through the normal Content Space product path. A later dedicated-non-production cloud-space PoC change SHALL add a trusted policy/audience Gate to Content Space service composition before it may admit exact operations after identity, credential, authorization/BOLA, tenant, schema, bounds, cancellation, transfer, portal, session, and outcome evidence passes. Shared-tenant product access and production readiness SHALL remain blocked.

#### Scenario: One operation passes evidence

- **WHEN** listing passes but upload or portal remains incomplete
- **THEN** only listing MAY be admitted by the later PoC milestone and incomplete operations SHALL remain blocked

### Requirement: Shared Documents and fallback remain absent

Shared Documents, Document Connector port, DocumentProvider, collaborative editing, Project/Task/Coordinator semantics, overwrite/update/move/rename/delete/share/ACL/member/rollback/search/migration, default Provider, and fallback SHALL remain outside this adapter.

#### Scenario: Pinned OpenContent Provider fails

- **WHEN** another ContentSpaceProvider is installed
- **THEN** only the pinned OpenContent outcome SHALL be returned and the other Provider SHALL not be contacted
