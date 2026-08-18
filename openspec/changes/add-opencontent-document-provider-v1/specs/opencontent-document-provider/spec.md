## Purpose

Defines the optional OpenContent implementation of DocumentProvider and its independent discovery, launch, structured-content, write, session, and Skill acceptance Gates.

## ADDED Requirements

### Requirement: Adapter is independently composed
SciForge SHALL deliver `opencontent-document-provider` as an optional trusted compile-time main-only package that registers exactly one `main.document-provider-factory` for Provider Kind `opencontent`. It SHALL register no ContentSpaceProvider, renderer editor, Agent tool, IPC, MCP, Workspace Server, or public Connector surface.

#### Scenario: Adapter is paused
- **WHEN** the package is omitted or disabled
- **THEN** Shared Documents contracts, mocks, launcher boundary, and other DocumentProviders SHALL continue while OpenContent references report unavailable

### Requirement: Adapter consumes only bounded Connector port
The adapter SHALL use only its composition-bound token-free OpenContent Connector document port and SHALL expose only DocumentProvider types. It SHALL NOT own credentials, issue raw HTTP, accept arbitrary endpoint, expose provider DTO/Skill, call Content Space, or create another approval path.

#### Scenario: Direct Skill or raw Client is requested
- **WHEN** Agent, renderer, domain, or adapter caller asks for raw Skill, Client, Token, DTO, URL, or another consumer port
- **THEN** no such public contract SHALL exist and no OpenContent operation SHALL occur

### Requirement: Formats do not imply capabilities
For `mdoc`, `docx`, `xlsx`, and `pptx`, search, reference/metadata, capability query, safe launch, structured read, create, and change SHALL have separate readiness. Filename extension, endpoint existence, UI behavior, demo, or installed package SHALL NOT imply structured capability.

#### Scenario: Office document is discoverable
- **WHEN** a DOCX resource is searchable/referenceable but has no structured API
- **THEN** discovery MAY be admitted independently while structured read/edit remains unsupported or blocked

### Requirement: Metadata authorization blocks production
Search, metadata, reference resolution, and materialization SHALL remain non-production while a revoked user can obtain object metadata by known ID or formal current-object authorization is absent. Project membership, cached team membership, allowlist, prior Token, or possession of ID SHALL NOT substitute.

#### Scenario: BOLA remains reproducible
- **WHEN** revoked-known-ID metadata access succeeds
- **THEN** affected production operations SHALL remain `blocked_by_contract` regardless of PoC results

### Requirement: Document launch requires official safe route
`open-document` SHALL remain blocked until OpenContent supplies a credential-free official document route, stable resource mapping, exact HTTPS origin/path/redirect policy, browser/API subject alignment, session coexistence, and main-owned opaque launch target. Portal, share/collaboration link, raw URL, Cookie bridge, or Token URL SHALL not substitute.

#### Scenario: Only portal or collaboration link exists
- **WHEN** no official safe resource route is proven
- **THEN** the adapter SHALL not claim or expose document launch

### Requirement: Structured MDoc remains blocked until formal contract
Structured `.mdoc` read SHALL require versioned typed tree, stable semantic IDs, current AuthoritativeRevision, bounds, and explicit unsupported nodes. Create/change SHALL additionally require side-effect-free preconditions, frozen typed operations, atomic conditional apply, zero-partial conflict, durable idempotency/status, resulting revision, and bounded audit correlation.

#### Scenario: Skill is announced but undelivered
- **WHEN** only oral statement, demo, product name, or instruction-style Skill description exists
- **THEN** structured read/create/change SHALL remain `blocked_by_contract` and the adapter SHALL perform no Skill integration

#### Scenario: Skill replans after confirmation
- **WHEN** apply would reinterpret natural language rather than submit the exact confirmed operations
- **THEN** change SHALL remain blocked

### Requirement: Skill requires separate acceptance change
Any delivered OpenContent Skill SHALL pass a separate acceptance change covering provenance, version/digest/signature, license, runtime/OS/architecture, dependencies/network/model/data handling, telemetry/crash behavior, callable typed boundary, credentials, snapshot/operations, revision/conflict, idempotency/status, audit, permission, errors, and deterministic plan/apply before readiness changes.

#### Scenario: Skill artifact arrives
- **WHEN** the vendor provides an executable package
- **THEN** this adapter's readiness SHALL remain unchanged until that acceptance change passes

### Requirement: Session coexistence gates production
Production OpenContent DocumentProvider operations SHALL require verified same-Human API/API, API/browser, and API/Skill session coexistence with stable expired/superseded/revoked/disabled outcomes. PoC MAY allow one active API node per Human but SHALL NOT use shared Token, administrator account, device-specific user, silent re-login, or remote Task.

#### Scenario: New login invalidates old Token
- **WHEN** coexistence scope remains incomplete
- **THEN** production readiness SHALL stay blocked and superseded connection SHALL require Human action without credential forwarding or fallback

### Requirement: Excluded and fallback paths remain absent
The adapter SHALL expose no Office structured edit, download-modify-upload semantic fallback, raw CRDT, private API, DOM automation, whole-file overwrite, comments/ACL/share/import/export/rollback, remote unattended write, or automatic Provider fallback.

#### Scenario: OpenContent is unavailable
- **WHEN** another DocumentProvider is installed
- **THEN** the adapter/domain SHALL return the pinned OpenContent outcome and SHALL NOT copy, reinterpret, or route the document to the other Provider
