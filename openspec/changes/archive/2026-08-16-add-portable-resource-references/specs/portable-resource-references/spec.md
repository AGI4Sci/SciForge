## Purpose

Defines durable, non-authorizing provider-resource envelopes and the only trusted path that converts them to and from process-local Capability Broker resources.

## ADDED Requirements

### Requirement: Portable envelopes are exact, versioned, canonical, and bounded

A Portable Resource Reference Envelope SHALL contain exactly version, kind, non-secret authority, and kind-owned identity. It SHALL reject excessive or non-plain data, prototype pollution, URLs/endpoints, credentials/Tokens, connections, local paths, display metadata, Provider DTOs, permissions, and Broker/capability handles.

#### Scenario: Hostile identity is received

- **WHEN** input is oversized, has extra fields, or uses `__proto__`, `constructor`, `prototype`, an accessor, or a non-plain prototype
- **THEN** parsing SHALL fail before codec, resolver, credential, Broker, or network use

### Requirement: Resource owners compose exact codecs and resolvers

Each portable kind SHALL have one owner/version-bound `main.portable-resource-codec` main extension that names its exact resolver and local resource kind. Each resolver SHALL use `main.portable-authority-resolver` and declare a bounded handled-kind set. Duplicate, missing, incompatible, or mismatched contributions SHALL fail closed; Host SHALL NOT scan resolvers or route by Provider, domain, MIME, extension, or vendor.

#### Scenario: Unrelated resolver is installed

- **WHEN** one valid kind is materialized
- **THEN** only the resolver named by its codec SHALL be invoked

### Requirement: Invalid references fail before Provider work

Materialization SHALL validate envelope, version, kind, codec identity, resolver binding, and trusted Provider Instance before factory creation, credential access, DNS, HTTP, authentication, or other provider work.

#### Scenario: Authority is unknown

- **WHEN** a valid-looking identity names an unregistered Provider Instance
- **THEN** no resolver network operation or Provider factory SHALL be invoked

### Requirement: Materialization uses current Principal and the canonical Broker

The owner-scoped Host facade SHALL obtain the Host Principal, reauthorize the exact resource, re-check cancellation and Principal lease, and issue only a fresh audience/scope/process/expiry-bound resource through the existing Broker. Runtime input and portable data SHALL NOT supply Principal, owner, consumer, audience, or local identity.

#### Scenario: Principal changes during resolution

- **WHEN** the current Principal or identity version changes before issue
- **THEN** no local resource SHALL be issued and no other Principal or connection SHALL be tried

### Requirement: Observation and Artifact proof remain current

Materialized observation SHALL re-check current Principal/provider authority. Artifact materialization SHALL additionally revalidate immutable identity, retention, version-specific retrieval, and exact Provider Instance/file/version proof; a digest carried by the reference SHALL match the current proof exactly.

#### Scenario: Access or immutable proof becomes stale

- **WHEN** authorization is revoked or proof no longer matches
- **THEN** the next observation/materialization SHALL fail rather than reuse cached state

### Requirement: Export is owner-bound, safe, and lifecycle-bound

Export SHALL accept only an authorized live Broker resource with a codec-owned projection, derive consumer identity from trusted composition, validate the canonical envelope, and expose no raw state or sensitive/local fields. Collision, expiry, retirement, and cleanup SHALL be bounded and atomic with Broker lifecycle.

#### Scenario: Caller supplies a consumer identity

- **WHEN** untrusted input attempts owner/consumer impersonation
- **THEN** export SHALL fail closed without a partial projection

### Requirement: Host composition stays generic

Host SHALL discover portable extensions through standard manifests/generated composition and the generic main contribution/lifecycle host, preserving existing Broker governance, resource navigation, content transport, and retirement without a parallel registry or compatibility path.

#### Scenario: New kind is installed

- **WHEN** a resource-owning package contributes compatible extensions
- **THEN** source and packaged application paths SHALL discover them without a Host business-kind switch
