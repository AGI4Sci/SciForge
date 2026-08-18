## Purpose

Defines provider-neutral governed collaboration on Provider-authoritative live documents through replaceable DocumentProvider integrations.

## ADDED Requirements

### Requirement: Shared Documents is an independent provider-neutral domain
SciForge SHALL deliver Shared Documents as a trusted compile-time domain package through standard manifest/generated composition. Its public contract SHALL use only Shared Documents and generic SDK/reference terms and SHALL NOT import Content Space, vendor DTOs, integration packages, Cloud Collaboration, Project, Task, Coordinator, Workspace, or Host-private source types.

#### Scenario: Provider integration changes
- **WHEN** one compatible DocumentProvider package is added, removed, paused, or replaced
- **THEN** Shared Documents public contracts and Host Core SHALL require no vendor-specific edit

### Requirement: Shared Documents owns DocumentProvider
Shared Documents SHALL own a strict DocumentProvider contract covering capability description, document discovery/reference observation, safe launch target, structured snapshot/revision, validation of frozen create/change plans, conditional apply, and durable outcome recovery. It SHALL consume only compatible `main.document-provider-factory` contributions from its domain-owned catalog.

#### Scenario: Package also supports Content Space
- **WHEN** the same integration package contributes ContentSpaceProvider
- **THEN** the contributions SHALL remain independently validated and Shared Documents SHALL NOT observe file-transfer operations

### Requirement: Every operation has one governed path
UI, Agent, and system callers SHALL invoke Shared Documents only through the canonical Capability Broker/domain service and selected pinned Provider. The service SHALL own readiness, authority, prepared handles, Human confirmation, privacy, and provider-neutral receipts/errors. No provider-specific Agent tool, IPC, MCP, raw Client/Connector, private API, DOM automation, raw CRDT, whole-file replacement, or alternate writer SHALL exist.

#### Scenario: Provider attempts its own approval or tool path
- **WHEN** an integration exposes a direct write, approval, Agent tool, or raw transport outside the domain service
- **THEN** architecture validation SHALL reject it and no remote mutation SHALL occur

### Requirement: DocumentReference is portable live identity
Shared Documents SHALL own a strict DocumentReference codec containing only ProviderInstanceRef and provider document resource identity. It SHALL contain no revision, endpoint, URL, path/name, credential, access binding, Broker handle, Project/Task identity, or permission claim.

#### Scenario: Live document is used as completed artifact
- **WHEN** a consumer attempts to store DocumentReference as a completed Task artifact
- **THEN** schema validation SHALL reject it because a fixed artifact requires provider-guaranteed immutable ArtifactReference

### Requirement: Provider remains sole document authority
The selected Document Provider SHALL remain authoritative for content, revision, collaboration state, and access control. SciForge SHALL retain references, bounded readiness/receipts, and permitted audit correlation but SHALL NOT create an editable mirror, Workspace/Git projection, parallel CRDT service, or Provider ACL shadow.

#### Scenario: Human edits outside SciForge
- **WHEN** a Human changes the document in Provider UI
- **THEN** the next observation/apply SHALL use current Provider state and AuthoritativeRevision rather than a local copy

### Requirement: Capabilities and readiness are independent
Discovery, reference observation, launch, structured read, create, and change SHALL be separate capabilities with effective readiness `poc_only`, `blocked_by_contract`, or `production_ready`. Provider contribution, instance policy, resource capability, platform Gate, and audience policy MAY narrow readiness; caller input, extension, demo, package presence, or ordinary configuration SHALL NOT promote it.

#### Scenario: Provider supports launch but not structured body
- **WHEN** launch is admitted and structured read/write is blocked
- **THEN** Shared Documents MAY expose launch while keeping body operations absent or unavailable

### Requirement: Document editor UI belongs to Provider
Shared Documents renderer SHALL provide only provider-neutral reference/launch controls. DocumentProvider SHALL resolve an opaque short-lived DocumentLaunchTarget that main revalidates before the canonical external-browser open. Shared Documents SHALL NOT embed or implement a vendor editor, Browser Preview editor, iframe, webview, or Provider-specific panel.

#### Scenario: Future SciForge document service is selected
- **WHEN** its DocumentProvider returns an approved launch target
- **THEN** its Web editor SHALL remain Provider-owned rather than becoming Shared Documents desktop UI

### Requirement: Structured read requires typed snapshot and revision
Structured read SHALL return a versioned bounded document tree, stable semantic identities, current AuthoritativeRevision, and explicit opaque/read-only/unsupported handling. HTML, screenshots, OCR, exported files, raw CRDT, private DTO, or whole-file bytes SHALL NOT qualify.

#### Scenario: Provider lacks structured contract
- **WHEN** only rendered or whole-file content is available
- **THEN** structured read SHALL remain `blocked_by_contract`

### Requirement: Prepare is non-mutating and freezes intent
Create/change prepare SHALL perform no remote mutation and SHALL produce a short-lived node-local handle bound to Human Principal, Agent Actor, target, authoritative revision or safe creation precondition, normalized frozen typed operations, Human-readable preview, non-content digest, and expiry. Provider/Skill/model replanning after confirmation SHALL be forbidden.

#### Scenario: Only natural-language edit is available
- **WHEN** plan and apply would separately reinterpret an instruction
- **THEN** semantic change SHALL remain `blocked_by_contract`

### Requirement: Confirmation is operation-specific
Every prepared write SHALL require a generic confirmation proving the confirmer is the governing Host Human Principal and binding the exact target, digest, revision/precondition, operations, expiry, and first decision. Shared Documents SHALL not import consumer approval types or accept bare booleans/standing delegation in V1.

#### Scenario: Confirmation does not match
- **WHEN** principal, target, digest, revision, operations, expiry, or first decision differs
- **THEN** apply SHALL fail without Provider mutation

### Requirement: Apply is atomic and recoverable
Apply SHALL revalidate trusted operation context, selected Provider, current authority, prepared handle, digest, and confirmation. The Provider SHALL atomically evaluate revision/precondition with exact frozen operations and provide durable idempotency, status lookup, resulting revision, and bounded audit correlation.

#### Scenario: Human changed document after prepare
- **WHEN** current revision differs from prepared revision
- **THEN** apply SHALL return conflict with zero partial effect and require re-read, re-prepare, and reconfirm without merge, rebase, overwrite, or Provider fallback

#### Scenario: Outcome is uncertain
- **WHEN** the response is lost after possible commit
- **THEN** Shared Documents SHALL recover using the same durable operation identity or return `outcome_unknown` without blind retry

### Requirement: Shared Document content is restricted
Document bodies, snippets, names/paths, snapshots, semantic operations, and approval previews SHALL be classified restricted before first durable capture. Safe projection SHALL contain only bounded reference, operation type, non-content digest, revision/precondition, result code, and scalar operation/audit references. Agent body operations SHALL remain blocked until canonical Broker/trace lineage and model-egress policy enforce this end to end.

#### Scenario: Trace Gate is incomplete
- **WHEN** any durable or downstream path may retain restricted content
- **THEN** Agent body operations SHALL remain unavailable rather than capture then delete

### Requirement: Provider failure never causes fallback
A DocumentReference SHALL remain bound to its Provider Instance. Missing, blocked, unavailable, or unauthorized behavior SHALL NOT invoke another Provider, infer by extension, choose a default, reinterpret identity, or silently copy content.

#### Scenario: Another DocumentProvider is installed
- **WHEN** the pinned Provider is unavailable
- **THEN** Shared Documents SHALL return the pinned Provider outcome and SHALL NOT contact the other Provider

### Requirement: V1 exclusions remain absent
V1 SHALL expose no rename, move, delete, share, ACL/member management, comments, annotations, import/export, rollback, structured Office editing, ordinary-file transfer, automatic Provider migration, or remote unattended write.

#### Scenario: Excluded action is requested
- **WHEN** a caller attempts an excluded operation through raw Provider/Connector, private API, malformed input, or browser automation
- **THEN** it SHALL fail without remote mutation or alternate path
