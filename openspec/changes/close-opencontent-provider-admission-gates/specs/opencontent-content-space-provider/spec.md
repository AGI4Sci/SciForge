## MODIFIED Requirements

### Requirement: Development readiness is trusted and operation-specific

Every implemented OpenContent operation without packaged live evidence SHALL declare `poc_only` with `verification_profile_required`; implementation, private attachment presence, mock tests, historical direct API probes, or a successful sibling operation SHALL NOT make it `production_ready`. An operation MAY execute for verification only when the generic Content Space trusted verification policy matches the exact Provider Instance, complete Host Principal/assurance, permitted authority, operation, audience, zero limits, and validity period. Host assurance SHALL NOT be treated as an external OpenContent account class. Because the Connector currently supplies no attested external account subject or opaque binding revision, Provider Instance authority MAY admit only the read-only `list-containers` bootstrap, exact Broker-bound content-root authority MAY admit only reads, and mutation/administration profiles SHALL fail composition. Operations lacking an atomic mutation, immutable retrieval, portal, or other required Provider contract SHALL remain `blocked_by_contract` and SHALL NOT be admitted by a verification policy. Production promotion SHALL be a separate per-operation evidence-backed code and documentation change.

#### Scenario: Installed attachment exposes implemented operations

- **WHEN** a valid private attachment contributes native-document or extended operation adapters without packaged live evidence
- **THEN** safely shaped operations SHALL remain `poc_only`, contract-incomplete operations SHALL remain `blocked_by_contract`, and no operation SHALL be bulk-promoted by attachment presence

#### Scenario: One operation passes packaged verification

- **WHEN** a single exact operation succeeds under the trusted verification policy
- **THEN** sibling operations SHALL retain their prior readiness until each has separate evidence and review

#### Scenario: Listing is proven but upload schema is not

- **WHEN** listing succeeds but upload lacks its own packaged live evidence or trusted verification-policy match
- **THEN** upload SHALL remain unavailable even though listing succeeds

#### Scenario: Connector account is rebound under the same Host Principal

- **WHEN** OpenContent credentials or external account binding can change without a Connector-attested opaque binding revision
- **THEN** a Host Principal match SHALL NOT admit mutation, administration, or Provider-scoped operations other than the zero-transfer `list-containers` bootstrap

### Requirement: Project binding, Shared Documents, and artifacts remain separate

This adapter SHALL NOT own ProjectContentSpaceBinding, Project lifecycle, authoritative Project owner or membership, Task file intents, Task execution identity, Shared Documents, or ArtifactReference issuance without immutable-version proof. It MAY implement the provider-neutral Project Content Space provisioning port, but no generic Agent capability SHALL expose that port before the Project-owning context supplies the authoritative binding and verified identity mappings. Project archival/deletion SHALL never trigger Provider deletion.

#### Scenario: Change 1 completes before Project binding

- **WHEN** no Project Content Space Binding contract is installed
- **THEN** existing-account Content Space composition SHALL remain complete, provisioning SHALL remain dormant, and no Agent SHALL synthesize Project authority

#### Scenario: Change 1 completes before Change 2

- **WHEN** no Project Content Space Binding contract is installed
- **THEN** existing-account binding and personal/team file operations SHALL remain complete without a generic Agent Project provisioning entrypoint

#### Scenario: Version and digest are observed without immutable retrieval proof

- **WHEN** OpenContent returns a version-like identifier or digest but cannot prove immutable retention and version-specific retrieval
- **THEN** the result SHALL remain a mutable Content File Reference and no Artifact Reference SHALL be issued

## ADDED Requirements

### Requirement: Same-file mutation requires Provider-atomic preconditions

Any OpenContent same-file or hash-bound mutation SHALL remain `blocked_by_contract` unless the Provider performs one atomic compare-and-mutate operation against an exact expected immutable version, revision, or content hash and proves conflict caused zero mutation. A local probe, plan receipt, pre-read, write-time re-read, one-shot token, post-write digest, or retry suppression SHALL NOT substitute for the Provider-atomic precondition.

#### Scenario: Native edit checks the hash before an unconditioned write

- **WHEN** `edit` verifies a plan and current hash before issuing a write that has no atomic expected-version/hash precondition
- **THEN** `edit` SHALL remain blocked before supplier invocation

#### Scenario: File-version update lacks exact CAS

- **WHEN** `updateFileVersion` has no verified expected-version compare-and-update contract
- **THEN** it SHALL fail closed before Provider invocation and SHALL NOT emulate CAS with read followed by upload
