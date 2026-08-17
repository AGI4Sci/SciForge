## Purpose

Defines the OpenContent ContentSpaceProvider mapping for bound-account personal/team libraries and the exact Change 1 Human/Agent file-operation boundary.

## ADDED Requirements

### Requirement: Adapter is independently composed and lazy

`opencontent-content-space-provider` SHALL be an optional trusted compile-time main-only package with exactly one generic extension at `main.content-space-provider-factory` for Provider Kind `opencontent`. It SHALL acquire only its Host-issued token-free Connector facade and SHALL register no renderer, public OpenContent capability, IPC/MCP, credential store, raw client, portable resolver, or DocumentProvider. Construction SHALL perform no login, credential, network, content, or mutation work.

#### Scenario: Adapter is absent

- **WHEN** the package is omitted
- **THEN** generic Content Space, its UI, mock/other Providers, and source/packaged application SHALL continue without fallback

### Requirement: Personal and Team libraries map to provider-neutral containers

The bound account's personal root SHALL map to one `ContentContainerSummary` with `scope: personal`. Each accessible OpenContent Team root SHALL map to a summary with `scope: shared`. Stable folder identity, preferably `folderGuid`, SHALL form the portable `containerId`; numeric folder IDs and Team DTOs SHALL remain integration-private. Team and Project SHALL NOT be treated as the same aggregate or identity.

#### Scenario: Team display name changes

- **WHEN** the Provider returns the same stable root identity with a different safe label
- **THEN** the reference SHALL remain stable and only display metadata SHALL change

### Requirement: One canonical Content Space path serves Human and Agent audiences

Renderer and Agent callers SHALL converge on the same Content Space service → pinned Provider path. Human operations SHALL use Human-only global capabilities and Host-selected file handles. Agent content operations SHALL use Agent-only Broker resource capabilities after a confirmed root authorization; an Agent SHALL NOT invoke the Human global content capabilities. The adapter SHALL use only the executing node owner's current Principal-bound connection. Callers SHALL NOT supply a connection, external account, endpoint, coordinator/admin credential, or alternate Provider.

#### Scenario: Requester supplies an account hint

- **WHEN** a Task, prompt, portable reference, or capability payload attempts to select an OpenContent account
- **THEN** the hint SHALL be rejected or ignored as invalid contract input before provider access

### Requirement: Agent resource scope is explicit and descendant-bounded

A Personal Session Agent SHALL first obtain Human confirmation for one exact personal or Team root that the bound account can currently enumerate. Host SHALL issue a bounded opaque resource tied to the exact Agent caller, Principal, and Workspace context. Children SHALL become reachable only when listing an already-authorized directory issues descendant resources; raw references SHALL NOT widen scope. A Project Task Agent, after Change 2 provides a binding, SHALL not use ad-hoc root authorization and SHALL access only the current Project Content Directory and descendants. Scope checks and OpenContent ACL SHALL both pass; Project membership SHALL never substitute for Provider permission.

#### Scenario: Bound account can access a sibling Team directory

- **WHEN** a Project Task requests that sibling outside its bound directory
- **THEN** Content Space SHALL deny the request before the adapter performs the content operation

#### Scenario: Agent submits a raw Team folder GUID

- **WHEN** no confirmed root or descendant Broker resource authorizes that folder
- **THEN** Agent content capabilities SHALL reject it without resolving or probing the raw folder reference

### Requirement: Change 1 operation set and ACL behavior are strict

The adapter SHALL implement only list containers, browse directory entries, create folder, upload-new up to 16 MiB, and download up to 1 GiB. OpenContent ACL SHALL be the permission authority. Unauthorized, unavailable, rate-limited, and malformed Provider responses SHALL remain distinct bounded provider-neutral outcomes with no raw response content. Unauthorized SHALL include Human guidance to obtain permission in OpenContent. The adapter SHALL NOT create accounts, invite members, change ACLs, borrow credentials, overwrite/update, auto-rename, move, delete, share, synchronize, or fall back.

#### Scenario: Project member lacks OpenContent permission

- **WHEN** the Provider denies the executing owner's account
- **THEN** SciForge SHALL return unauthorized and SHALL NOT use the Project Owner, Coordinator, administrator, or another member's connection

#### Scenario: OpenContent throttles or violates its pinned response schema

- **WHEN** the Connector reports rate limiting or a malformed response contract
- **THEN** the adapter SHALL preserve the bounded typed outcome and SHALL NOT expose Provider diagnostics, DTOs, endpoints, credentials, or numeric handles

### Requirement: Agent transfer bytes cross only approved Workspace grants

Agent upload SHALL accept only a Workspace-relative path in the current execution context's authorized Workspace. After Human confirmation, Host SHALL validate real-path containment, regular-file type, symlink escape, size, and access before issuing a one-shot upload handle. Agent download SHALL accept only a new Workspace-relative destination; Host SHALL reject existing targets, write a temporary file, validate bounds/completion, and atomically commit. Arbitrary filesystem paths and bearer/region URLs SHALL never enter renderer, Agent, or Provider business input.

#### Scenario: Download destination already exists or escapes by symlink

- **WHEN** Host validates the requested relative destination
- **THEN** it SHALL reject before provider transfer and SHALL NOT overwrite or write outside the authorized Workspace

### Requirement: Writes preserve conflict, cancellation, and uncertainty

Create-folder/upload-new SHALL use the exact explicit parent and name and SHALL never overwrite, auto-rename, retarget, retry blindly, or fall back. Collision SHALL map to typed conflict. Timeout, cancellation, session supersession, or ambiguous receipt after a write may have committed SHALL map to `outcome_unknown` and SHALL NOT retry.

#### Scenario: Upload response is ambiguous

- **WHEN** exact single creation cannot be proven
- **THEN** the adapter SHALL return `outcome_unknown` and SHALL not upload again

### Requirement: Development readiness is trusted and operation-specific

Only a trusted compile-time development profile MAY admit the reviewed shared demonstration Provider Instance, least-privilege account class, exact operation, transfer limit, and UI/Agent audience. Caller input, environment text, a successful sibling operation, or portable identity SHALL NOT widen readiness. Production remains blocked pending a separate decision.

#### Scenario: Listing is proven but upload schema is not

- **WHEN** the UI or Agent requests upload
- **THEN** upload SHALL remain `blocked_by_contract` even though listing succeeds

### Requirement: Project binding, Shared Documents, and artifacts remain separate

This adapter SHALL NOT own ProjectContentSpaceBinding, Project lifecycle, Team membership, Shared Documents, collaborative editing, or ArtifactReference issuance without immutable-version proof. Project archival/deletion SHALL never trigger Provider deletion.

#### Scenario: Change 1 completes before Change 2

- **WHEN** no Project binding contract is installed
- **THEN** existing-account binding and personal/team file operations SHALL remain complete without Project special cases
