# secure-provider-credentials Specification

## Purpose
Defines the generic Host-owned facility that protects provider credentials and makes them available only to their trusted composition-bound main-process owner.
## Requirements
### Requirement: Host owns the only secure credential facility
Provider credential material SHALL be stored and used only through the existing generic main-only Host package-secret facility, evolved with the bindings in this specification and backed by an approved operating-system secure-storage service. The implementation SHALL NOT add a second vault, storage root, facade, plaintext store, environment-variable persistence, renderer storage, provider-specific credential IPC, browser-cookie capture, or direct package access to platform secure storage.

#### Scenario: Trusted integration stores a credential
- **WHEN** an authorized main-only owner stores a provider credential
- **THEN** secret material SHALL enter only the Host secure facility and SHALL not appear in application-owned plaintext data

#### Scenario: Secure storage is unavailable
- **WHEN** the supported OS key service is locked, unavailable, insecure, corrupt, or cannot decrypt the record
- **THEN** the operation SHALL fail closed and SHALL NOT create or use a fallback secret store

#### Scenario: Existing package secret storage is migrated
- **WHEN** the provider-credential contract is added to the current owner-scoped package storage
- **THEN** owner derivation, encryption, atomic file lifecycle, and storage root SHALL remain canonical and no parallel provider credential repository SHALL be created

### Requirement: Credential owner identity is composition-bound
The Host SHALL bind each secure-credential facade to the trusted package owner selected by generated composition. Runtime callers and package code SHALL NOT supply, override, or impersonate an owner identity or access another owner's namespace.

#### Scenario: Owner-bound facade is constructed
- **WHEN** generated main composition activates a trusted package authorized for secure credentials
- **THEN** the package SHALL receive only its own owner-scoped facade without an owner parameter on credential operations

#### Scenario: Another package attempts access
- **WHEN** a renderer, Agent, business domain, or different main package attempts to address the owner's record
- **THEN** no callable path SHALL expose the record or confirm secret-bearing details

### Requirement: Records bind to the current Human Principal and node
Each record SHALL be keyed and cryptographically or structurally bound to owner package, execution-node identity, Host-asserted Human Principal, Provider Instance Reference, local connection ID, and record version. The facility SHALL accept only Host principal context whose assurance is admitted by trusted consuming-provider policy and SHALL never search another principal's records. Admission of `local-selection` scopes only the local record owner; the connector remains responsible for independently authenticating the external account.

#### Scenario: Binding matches
- **WHEN** the owning package uses a record under the same node, current principal, instance, and connection binding
- **THEN** the Host MAY make the secret available for that bounded main-process use

#### Scenario: Principal or node differs
- **WHEN** any binding differs or the Host principal is absent or below the required assurance
- **THEN** access SHALL fail without trying usernames, email equality, Project roles, other local accounts, or administrator records

### Requirement: Secret use is bounded and non-exporting
The facility SHALL expose secret material only inside the owning main-process operation for the minimum lifetime needed. It SHALL never return secret material through capability output, renderer, Agent/model traffic, public/caller-controlled/durable URL, log, trace, Workspace, Project, Task, cross-node message, diagnostics, or public connection summary. When a verified provider contract requires a query credential, only the owning main-process Connector MAY construct and immediately send the exact outbound request inside bounded use. That request SHALL target Connector-pinned HTTPS origins and paths, reject redirects, omit referrer and ambient credentials, discard raw provider/network diagnostics, and never expose or persist the credential-bearing URL.

#### Scenario: Public status is requested
- **WHEN** a caller observes connection or credential status
- **THEN** it SHALL receive only bounded non-secret states and identifiers

#### Scenario: Operation or error echoes a secret
- **WHEN** provider output, an exception, or a diagnostic contains an active credential value
- **THEN** managed logs and trace capture SHALL redact the value before persistence

#### Scenario: Verified provider requires a query Token
- **WHEN** the owning Connector performs an operation whose pinned provider contract requires the credential in the HTTPS query
- **THEN** it MAY serialize and immediately send that exact private request inside bounded use, while every public, durable, redirected, caller-controlled, or cross-node URL remains forbidden

### Requirement: Replacement and deletion are atomic
Credential create or rotation SHALL commit one versioned record atomically, and deletion SHALL make the local record unusable immediately. Interrupted replacement SHALL leave either the prior valid record or the complete new record, never a partial or silently mixed credential.

#### Scenario: Rotation succeeds
- **WHEN** the owner replaces a credential
- **THEN** new uses SHALL select only the committed new record and the replaced plaintext SHALL NOT be retained by the credential store or redaction registry after the atomic commit

#### Scenario: Replacement or deletion is interrupted
- **WHEN** the process or OS key service fails during the operation
- **THEN** restart recovery SHALL resolve to one well-defined usable or absent state and SHALL not expose partial secret data

### Requirement: Secret redaction is scoped to bounded credential use
Credential plaintext SHALL participate in the canonical managed-log and trace secret-redaction path only while the owning `use` callback is executing. The Host SHALL scrub a callback failure while that redaction lease is active, return only a bounded Host-owned error, and release the plaintext immediately when the callback settles. Status, replacement, and deletion SHALL NOT register or retain credential plaintext in the redaction registry.

#### Scenario: Credential use overlaps rotation
- **WHEN** a credential use is active while replacement or deletion is requested
- **THEN** the mutation SHALL wait for the bounded use callback to settle, any callback failure SHALL be scrubbed before its redaction lease is released, and the replaced plaintext SHALL NOT remain registered afterward

### Requirement: Source development behavior is verified
Enrollment storage, restart recovery, bounded use, rotation, deletion, principal/node isolation, redaction, and unavailable-key-service behavior SHALL be verified through a real Electron source-development application lifecycle on the current supported development platform. Automated platform-policy tests SHALL cover approved Windows, macOS, and Linux secure-storage backends plus insecure, unavailable, and unsupported fail-closed outcomes. Installed or distribution package acceptance is outside this open-source development change.

#### Scenario: Source application restarts
- **WHEN** a credential is stored, the source-development application restarts under the same authorized OS identity, then rotates and deletes the record and restarts again
- **THEN** the record SHALL be usable only before deletion and absent afterward

#### Scenario: A platform backend is insecure or unavailable
- **WHEN** automated policy evaluation observes an unapproved, unavailable, or unsupported secure-storage backend
- **THEN** provider credential operations SHALL fail closed without plaintext fallback
