## MODIFIED Requirements

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

### Requirement: Same-file mutation requires Provider-atomic preconditions

`updateFileVersion` and every hash-bound native-document mutation, including `edit`, SHALL remain `blocked_by_contract` unless OpenContent freezes and proves one Provider-side atomic compare-and-mutate operation carrying the exact expected immutable version, revision, or `baseHash`. A local probe, plan receipt, pre-read, write-time re-read, post-write digest, one-shot token, retry suppression, or read followed by upload SHALL NOT emulate CAS. A stale precondition SHALL return a deterministic conflict and prove that no file bytes, native-document state, metadata, version, or partial side effect changed. The exact same-file operation name and semantics, including `UPDATE` versus `UPGRADE`, SHALL be resolved with the supplier before implementation or promotion; aliases SHALL NOT be accepted.

#### Scenario: Native edit validates baseHash before an unconditional write

- **WHEN** the adapter validates probe/plan evidence and current content before invoking a supplier mutation with no atomic `baseHash` precondition
- **THEN** `edit` SHALL fail before supplier invocation because the remaining check/write race violates the Provider contract

#### Scenario: File-version update has no exact CAS

- **WHEN** the supplier upload contract exposes no exact expected-version compare-and-update transaction
- **THEN** `updateFileVersion` SHALL fail closed before Provider invocation and SHALL NOT perform a pre-read followed by upload
