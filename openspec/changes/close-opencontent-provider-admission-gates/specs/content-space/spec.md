## MODIFIED Requirements

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
