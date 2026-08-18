## Purpose

Defines the provider-neutral Content Space domain, ContentSpaceProvider contract, common renderer, V1 ordinary-file operations, portable references, and immutable-artifact boundary.

## ADDED Requirements

### Requirement: Content Space is an independent trusted domain package

Content Space SHALL use a standard manifest, separate definition/main/renderer entrypoints, lazy lifecycle, and generated source/packaged composition. It SHALL import no Shared Documents, OpenContent, cloud collaboration, Project/Task/Coordinator/Workspace, integration package, or Host-private source path.

#### Scenario: Integration package changes

- **WHEN** a ContentSpaceProvider is added, removed, paused, or replaced
- **THEN** Content Space public contracts and Host Core SHALL need no vendor edit or feature switch

### Requirement: Content Space owns Provider catalog and portable kinds

Content Space SHALL own ContentSpaceProvider, its domain catalog/service, Container/File/Artifact codecs, safe export, and one exact resolver for those kinds. It SHALL consume only exact Content Space factory contributions after trusted Provider Instance resolution.

#### Scenario: Mock Provider is installed

- **WHEN** the standard mock factory and instance contributions are discovered
- **THEN** the same production catalog/service/UI path SHALL operate without a test registry or default Provider

### Requirement: Artifact Reference requires exact immutable proof

Issue and materialization SHALL require immutable version identity, retention, version-specific retrieval, and proof for the same Provider Instance, file, and immutable version. If a digest is present, it SHALL match the current proof exactly. Mutable latest, optional version, digest, or upload receipt alone SHALL not qualify.

#### Scenario: Proof is absent or mismatched

- **WHEN** upload succeeds without all exact guarantees
- **THEN** only ContentFileReference SHALL be returned and no Artifact local resource SHALL be issued

### Requirement: Renderer uses current generic contributions

The provider-neutral UI SHALL publish stable generic commands/workbench placement and use only public Content Space schemas and Broker capability client. It SHALL support selection, bounded listing, create-folder, upload-new, download, references, readiness, bounded finite phase progress, cancellation, and bounded errors without Provider UI/code, vendor branch, MIME/extension routing, iframe/webview, or parallel registry. V1 phase progress SHALL come only from the closed set `selecting`, `preparing`, `uploading` or `downloading`, `finalizing`, and one of `succeeded`, `failed`, or `cancelled`; it SHALL NOT claim byte-level telemetry.

#### Scenario: Two Providers are present

- **WHEN** both are compatible
- **THEN** one common UI SHALL present trusted instances and provider-neutral operations without an arbitrary default

### Requirement: Every operation follows one governed path

UI, Agent, and system callers SHALL use Broker → Content Space handler → service → trusted directory → catalog → pinned Provider → operation. Host SHALL inject current Principal; the Broker SHALL admit and bind a write invocation identity outside Content Space business input. Domain input and Provider output SHALL not replace those values or access Provider/Connector through another IPC, MCP, service, facade, or registry.

#### Scenario: Caller attempts a direct Provider request

- **WHEN** input contains endpoint, package/factory ID, credential, raw operation, or alternate identity
- **THEN** no such path SHALL exist and no Provider call SHALL occur

### Requirement: PoC eligibility is not execution authority

Every operation SHALL be `blocked_by_contract`, `poc_only`, or `production_ready`. The normal Content Space V1 product path SHALL execute only `production_ready`; `poc_only` SHALL remain blocked unless a separately reviewed trusted service policy/audience Gate is installed. Provider output, caller input, renderer state, Agent requests, filenames, MIME/extensions, and ordinary configuration SHALL NOT create or promote that authority.

#### Scenario: Provider reports PoC eligibility without a Host Gate

- **WHEN** an operation reports `poc_only` but no trusted Content Space service policy/audience Gate is installed
- **THEN** the requested Provider business operation and any remote mutation SHALL remain blocked

### Requirement: Navigation and writes are bounded and cancellable

Listing SHALL bound pagination/cursors/results and propagate cancellation. Create-folder/upload-new SHALL require current authorization, explicit parent, bounded input, cancellation, and one Broker-admitted logical invocation identity outside the business payload; collision SHALL return typed conflict and uncertain completion `outcome_unknown` without blind retry.

#### Scenario: Write outcome cannot be proven

- **WHEN** timeout, cancellation, or session loss makes completion uncertain
- **THEN** the Provider SHALL not be retried and the caller SHALL receive `outcome_unknown`

### Requirement: Download and portal authority stay in Host

Download SHALL write only to a Host-owned destination without exposing path authority or bearer URLs. After Content Space rejects non-HTTPS, userinfo-bearing, fragment-bearing, oversized, or invalid-lifetime Provider targets, Host SHALL retain the exact target only in main process and expose only a short-lived, single-use opaque handle bound to package owner, caller, current Principal, target, and expiry; opening SHALL reauthorize.

#### Scenario: Principal changes before transfer or open

- **WHEN** the captured Principal lease is no longer current
- **THEN** the Host SHALL reject the operation without exposing or using the underlying target

### Requirement: Pinned Provider never falls back

Missing, incompatible, disabled, unavailable, unauthorized, or uncertain behavior SHALL NOT select another Provider, default, connection, MIME/extension route, or silent copy.

#### Scenario: Another Provider is available

- **WHEN** the pinned Provider fails
- **THEN** only the pinned outcome SHALL be returned and the other Provider SHALL not be contacted

### Requirement: Excluded V1 behavior remains absent

Content Space SHALL NOT implement OpenContent APIs/credentials/Connector/adapter, Shared Documents, collaborative editing, resource open routing, cloud collaboration, overwrite/update/move/rename/delete/share/ACL/member/rollback, migration, or Project/Task/Coordinator semantics.

#### Scenario: Excluded action is attempted

- **WHEN** a caller uses malformed input, browser automation, raw Provider, or compatibility alias
- **THEN** it SHALL fail without remote mutation or alternate path
