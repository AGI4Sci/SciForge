# portable-resource-references Specification

## Purpose

Defines bounded, durable, non-authorizing provider-resource identities and the only trusted conversion boundary between those identities and process-local Capability Broker resources.

## Requirements

### Requirement: Portable envelopes are exact, versioned, canonical, and bounded

A Portable Resource Reference Envelope SHALL contain exactly a contract version, a registered kind, a non-secret authority reference, and a kind-owned bounded identity payload. Parsing and serialization SHALL reject extra fields, accessors, non-plain or polluted prototypes, duplicate semantic keys, unsupported values, excessive depth, count, string length, identity size, or envelope size. Canonical serialization SHALL be deterministic across supported SciForge nodes.

The envelope and identity SHALL contain no URL or endpoint, credential or Token, Provider Connection ID, local path, process-local Broker or capability handle, display metadata, raw Provider DTO, executable code, or permission assertion.

#### Scenario: Valid envelope crosses a restart or node boundary

- **WHEN** a consumer serializes and later parses a supported envelope
- **THEN** the same version, kind, authority, and logical identity SHALL be recovered without adding executable authority

#### Scenario: Hostile object is offered as an identity

- **WHEN** input uses `__proto__`, `constructor`, `prototype`, an accessor, a non-plain prototype, or fields outside the exact envelope
- **THEN** parsing SHALL fail before codec, resolver, credential, Broker issuance, or network use

#### Scenario: Runtime or local identity is offered as portable data

- **WHEN** a caller supplies a Broker `res_*`, capability handle, local connection ID, URL, arbitrary URI, local path, Token, or display field in a portable position
- **THEN** validation SHALL reject it without returning a partial projection

### Requirement: Resource-owning packages own exact codecs

Each portable kind SHALL have exactly one trusted `main.extension` codec contribution at `main.portable-resource-codec`. The contribution SHALL bind one declared kind, one accepted local resource kind, one exact authority-resolver identifier, its contract version, and its composition owner. The package owning the business resource SHALL own its identity schema, canonical codec, and safe export projection; the generic SDK and Host SHALL NOT define a union of Content Space, Document, Artifact, Task, Project, MIME, extension, or Provider payloads.

#### Scenario: Duplicate or incompatible codec is composed

- **WHEN** two contributions claim one kind, or declaration version/location/owner does not match its runtime value
- **THEN** composition SHALL fail closed before either codec becomes available

#### Scenario: Sibling domains register distinct reference kinds

- **WHEN** Content Space and a later Shared Documents package contribute their own codecs
- **THEN** each SHALL depend only on generic portable-reference contracts and SHALL NOT import or route through the sibling domain

### Requirement: Authority resolvers are selected exactly by codec binding

Each resolver SHALL be a trusted `main.extension` contribution at `main.portable-authority-resolver`, with an exact resolver identifier, contract version, composition owner, and bounded set of handled portable kinds. Materialization SHALL select the codec first and then the one resolver named by that codec. It SHALL NOT probe every resolver, infer authority from Provider Kind, domain ID, MIME type, extension, endpoint, or load order.

#### Scenario: Unrelated resolver is installed

- **WHEN** a valid Content Space reference is materialized while unrelated resolvers are present
- **THEN** only the resolver bound by the selected Content Space codec SHALL be invoked

#### Scenario: Resolver ownership is unknown or duplicated

- **WHEN** the bound resolver is absent, duplicated, incompatible, or does not declare the reference kind
- **THEN** materialization SHALL fail before Provider factory creation, credential access, or network use

### Requirement: Invalid references fail before authority or network access

Materialization SHALL validate envelope bounds and exact shape, version, kind, codec-owned identity, codec/resolver binding, and locally trusted authority/Provider Instance registration in that order before any provider operation. Unknown kind, version, resolver, authority, Provider Instance, malformed identity, or embedded endpoint SHALL produce only a bounded fail-closed error.

#### Scenario: Unknown kind or version is received

- **WHEN** an envelope uses an unregistered kind or unsupported version
- **THEN** materialization SHALL reject it without invoking any resolver

#### Scenario: Unknown Provider Instance is received

- **WHEN** a structurally valid identity names an authority absent from the trusted Provider Instance Directory
- **THEN** materialization SHALL fail before DNS, HTTP, authentication, credential access, or Provider creation

### Requirement: Materialization reauthorizes the current Host Principal

A full SciForge Host SHALL materialize a validated envelope only through the owner-scoped portable-resource Host facade. The Host SHALL obtain the current PrincipalSnapshot from trusted Principal Context, resolve the exact Provider Instance, and require the domain resolver to reauthorize the exact logical resource for that Principal before the existing Capability Broker issues a new audience-, scope-, principal-lease-, process-, and expiry-bound resource.

The caller, renderer, Agent, provider, codec, and envelope SHALL NOT inject or replace the Principal, owner, audience, consumer identity, Broker handle, or local resource identity. A portable envelope SHALL never itself satisfy capability authorization.

#### Scenario: Current principal is authorized

- **WHEN** the envelope is valid, its exact authority is trusted, and the resolver proves current access
- **THEN** the Broker MAY issue a fresh process-local resource reference for the codec's registered resource kind

#### Scenario: Principal changes during materialization

- **WHEN** the current Principal, identity version, required assurance, or cancellation state changes before Broker issuance
- **THEN** materialization SHALL stop and issue no resource

#### Scenario: Local authority cannot be established

- **WHEN** no matching current-principal connection exists, selection is ambiguous, or reauthorization fails
- **THEN** no resource SHALL be issued and no other principal, administrator, connection, default Provider, or fallback resolver SHALL be tried

### Requirement: Materialized observation is freshly reauthorized

Every observation or operation on a materialized resource SHALL use the canonical Broker resource path and SHALL re-check the current Principal lease and provider authorization as required by the resource contract. Materialization SHALL NOT cache a first observation as perpetual authority or advertise operation identifiers outside the Broker capability definitions registered for that resource kind.

#### Scenario: Access is revoked after materialization

- **WHEN** provider permission or the Host Principal lease changes after a local resource was issued
- **THEN** the next observation or operation SHALL fail closed rather than return the original cached state

#### Scenario: Local Broker reference crosses a boundary

- **WHEN** a stored or transported `res_*` reference is presented after restart, retirement, expiry, or on another node
- **THEN** the Broker SHALL reject it rather than reinterpret it as portable identity

### Requirement: Artifact materialization revalidates immutable proof

When a codec represents an Artifact Reference, materialization SHALL require the resolver to revalidate immutable version identity, retention guarantee, version-specific retrieval, and proof bound to the same Provider Instance, file identity, and immutable version. If the reference carries a digest, the current proof SHALL carry the same algorithm and value. A digest by itself, mutable current version, upload receipt, or previously accepted proof SHALL NOT authorize a local artifact resource.

#### Scenario: Artifact proof is forged or stale

- **WHEN** any proof field is missing, mismatched, no longer guaranteed, or belongs to another instance, file, or version
- **THEN** materialization SHALL issue no Broker resource

### Requirement: Export is owner-bound, explicit, atomic, and safe

Reverse export SHALL accept only a currently authorized live Broker resource whose resource owner registered an export projection and whose owner-scoped Host facade authorizes the requesting package. The Host SHALL derive the consumer/owner identity from trusted composition; runtime input SHALL NOT provide it. The codec SHALL validate the projection and produce the canonical envelope without exposing endpoints, credentials, connections, raw DTOs, paths/names, display data, permissions, or Broker handles.

Export registration, collision detection, issuance, retirement, expiry, and cleanup SHALL be bounded and atomic with the associated Broker resource lifecycle.

#### Scenario: Authorized package exports a live resource

- **WHEN** an owner-bound consumer exports an eligible, currently authorized local resource
- **THEN** it SHALL receive only a schema-valid canonical envelope for that resource

#### Scenario: Caller impersonates an export consumer

- **WHEN** renderer, Agent, system input, or a different package supplies a consumer or owner identifier
- **THEN** export SHALL fail closed without returning raw or partial resource state

#### Scenario: Export identity collides

- **WHEN** concurrent registrations would claim the same derived local identity for different principal leases or logical resources
- **THEN** no ambiguous projection SHALL be installed and neither registration SHALL be selected by timing

### Requirement: Host composition remains provider-neutral

Host core SHALL discover portable codecs and resolvers through the generic `main.extension` contribution host and activate their use through the standard runtime lifecycle. It SHALL preserve existing Capability Broker process-local issuance, resource navigation, governance, content transport, expiry, and retirement semantics without implying that local Broker authority survives a process restart. It SHALL add no central Provider map, Provider/domain/vendor switch, special Agent path, parallel IPC/MCP/service/registry, or compatibility decoder.

#### Scenario: New portable kind is added

- **WHEN** a trusted resource-owning package contributes a compatible codec and resolver binding through its manifest
- **THEN** generated source and packaged composition SHALL discover it without a Host business-kind edit
