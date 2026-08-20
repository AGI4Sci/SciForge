## MODIFIED Requirements

### Requirement: Readiness is explicit per operation

Every operation SHALL be exactly `poc_only`, `blocked_by_contract`, or `production_ready`, constrained by the trusted Provider contribution, instance policy, resource capability, platform Gate, and audience policy. `poc_only` SHALL remain non-executable through the normal product path unless Content Space composition installs a separately reviewed trusted verification policy that matches the exact Provider Instance, complete Host Principal/assurance, authority, operation, audience, zero transfer limits, and bounded validity period. Host assurance SHALL NOT be treated as an external Provider account class. Until a Provider contributes an attested external subject and opaque binding revision, Provider Instance authority SHALL admit only the read-only `list-containers` bootstrap, Broker-authoritative content-root authority SHALL admit only exact root-scoped reads, and mutation or administration profiles SHALL fail composition. The policy SHALL only narrow a Provider's `poc_only` declaration for that invocation and SHALL NOT rewrite it as `production_ready`. Caller input, renderer state, Agent request, filename, extension/MIME, Task, prompt text, ordinary environment/configuration, package presence, or a successful sibling operation SHALL NOT install, select, or widen the policy or promote readiness.

#### Scenario: Operation is unavailable

- **WHEN** any effective Gate blocks it or no exact trusted verification policy matches a `poc_only` operation
- **THEN** it SHALL be absent from operation discovery or fail before the requested Provider business operation and any remote mutation with a bounded unavailable result

#### Scenario: Verification policy admits one exact operation

- **WHEN** a reviewed policy matches the current Provider Instance, full Host Principal/assurance, allowed Provider/bootstrap or Broker-authoritative root authority, operation, zero limits, and validity period
- **THEN** that invocation MAY traverse the ordinary Broker → Content Space → Provider path while every unmatched operation and caller remains blocked

### Requirement: Verification profiles compose as exact static package contributions

Content Space SHALL discover verification profiles only through the generic `main.extension` composition path at the public `main.content-space-verification-profile` location. Each contribution SHALL contain one static profile whose manifest contract and runtime value are identical. Zero profiles SHALL leave verification admission disabled; invalid metadata, contract/value drift, or duplicate profile identity SHALL fail Content Space composition. The Host SHALL NOT contain a domain-ID switch, default profile, or caller/configuration profile loader.

#### Scenario: Contribution metadata drifts

- **WHEN** a package's manifest-declared verification profile differs from its runtime contribution or duplicates another profile identity
- **THEN** Content Space activation SHALL fail instead of ignoring, merging, or selecting one value

#### Scenario: External Provider account binding is unavailable

- **WHEN** the invocation has a current Host Principal but no Provider-attested external subject and opaque binding revision
- **THEN** Provider Instance authority MAY admit only zero-transfer `list-containers`, exact Broker-bound content-root authority MAY admit only reads, and mutation/administration admission SHALL remain unavailable

## ADDED Requirements

### Requirement: Project provisioning authority comes from the Project-owning context

Content Space MAY expose a provider-neutral Project Content Space provisioning port to a trusted consuming context, but SHALL NOT register a generic Agent capability that accepts caller-authored Project identity, owner, membership, coordinator, or binding intent. Provisioning SHALL remain unavailable until the Project-owning context supplies an authoritative Project Content Space Binding and verified identity mappings through a separately reviewed integration.

#### Scenario: Ordinary Agent submits Project membership

- **WHEN** an Agent attempts to provision or reconcile a Project content root from prompt or capability payload fields
- **THEN** no generic capability SHALL accept the request and no Provider administration operation SHALL occur

#### Scenario: Provider package implements the dormant port

- **WHEN** no authoritative Project Content Space Binding consumer is installed
- **THEN** the provider-neutral port MAY compose for future use but SHALL create no Project root and confer no Agent authority
