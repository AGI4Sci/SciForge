## Purpose

Defines the future single main-only OpenContent integration package that owns per-Principal connection/authentication state, validated transport, reviewed Provider Instance entries, and one Host-mediated owner-scoped Content Space adapter facade.

## ADDED Requirements

### Requirement: Connector is an optional main-only package

`opencontent-connector` SHALL be a trusted compile-time package discovered by standard manifest/generated composition. It SHALL expose only main-process infrastructure and SHALL register no renderer, Agent, MCP, public business capability, Provider factory, portable codec/resolver, Workspace Server, sidecar, or runtime-installable entrypoint.

#### Scenario: Connector is absent

- **WHEN** the package and OpenContent adapter are omitted or paused
- **THEN** Content Space, its mock Provider, other Providers, renderer, and source/packaged application SHALL continue without a Host switch, alias, or fallback

### Requirement: Connector uniquely owns OpenContent access infrastructure

The Connector SHALL be the only owner of OpenContent local connections, authentication/Token lifecycle, owner-scoped credential use, pinned upstream schemas, canonical transport, and redaction. Business domains and Provider adapters SHALL NOT independently log in, store/renew/revoke Tokens, create raw clients, or select endpoints.

#### Scenario: Adapter requests raw infrastructure

- **WHEN** any consumer requests a Token, Cookie, credential record, raw HTTP client/DTO, arbitrary endpoint, or another consumer's port
- **THEN** no such callable contract SHALL exist

### Requirement: Instance, connection, and secret records remain separate

The Connector package SHALL contribute each reviewed OpenContent instance through `main.provider-instance-directory-entry`. Each generic entry SHALL remain trusted and non-secret and SHALL use Provider Kind `opencontent`. Connector-private endpoint/tenant policy SHALL be keyed by that exact reference and SHALL reject a missing, duplicate, wrong-kind, caller-created, portable-created, or otherwise untrusted registration. Connector connection metadata SHALL bind exactly one Host Principal and instance and remain node-local. Secret material SHALL exist only in the separately reviewed secure credential store under the Connector owner's facade.

#### Scenario: Matching connection is missing or ambiguous

- **WHEN** the current Principal has zero or multiple unselected connections for an instance
- **THEN** the Connector SHALL require Human action and SHALL NOT try another Principal, administrator, connection, credential, or endpoint

### Requirement: Content Space facade is exact and Host-mediated

The generic contribution host SHALL NOT expose a raw callable Connector port. This future change SHALL add or reuse a package-generic Host-mediated owner-scoped internal-service contract. The Connector SHALL publish only a validated non-callable service descriptor through `main.extension` and register its callable internal-service implementation only through the private generic mediator on its trusted main-entry Host facade. This facade implementation registration is neither `main.document-provider-factory` nor `main.content-space-provider-factory`. Host SHALL close and validate the complete registration set before dependent lifecycle acquisition, then derive the trusted requesting main-entry owner and issue a narrow token-free facade only when that owner is allowlisted by the descriptor. Declaration/runtime location, version, implementation owner, and consumer policy SHALL match exactly. Missing, duplicate, incompatible, or owner-mismatched registration SHALL fail without priority, last-wins, or load-order selection. Runtime input cannot select or impersonate either owner, and Content Space itself SHALL not receive the facade.

#### Scenario: Authorized adapter invokes a selected operation

- **WHEN** the Host-authorized OpenContent ContentSpaceProvider facade requests an admitted transport operation
- **THEN** the Connector SHALL validate instance, current Principal, connection, readiness, request, response, and cancellation and return only bounded token-free facts

#### Scenario: Unauthorized package knows the port identifier

- **WHEN** another package, global extension consumer, or caller attempts to acquire or invoke it
- **THEN** access SHALL fail before credential or network use

### Requirement: Connector has no Document or portable-resolver surface

This milestone SHALL define no Document adapter port, optional Document method, DocumentProvider, placeholder package, or universal Provider/client. It SHALL also register no resolver for Content Space portable kinds; the Content Space domain resolver SHALL reach OpenContent only through its pinned Provider and Host-issued Connector facade.

#### Scenario: Shared Documents is absent

- **WHEN** only the Content Space track is installed
- **THEN** Connector construction SHALL be complete without any Document stub or duplicate authority resolver

### Requirement: Authentication and transport fail closed

Only a formally supported per-user authentication lifecycle and pinned schemas MAY execute. HTTP success SHALL not override provider business failure. Malformed/unknown/secret-bearing results, superseded/revoked/expired sessions, cancellation, and uncertain writes SHALL return bounded failure; they SHALL NOT leak data, silently log in, blindly retry, or switch connection.

#### Scenario: Write outcome is uncertain

- **WHEN** timeout, cancellation, or session supersession prevents proof of completion
- **THEN** the port SHALL return `outcome_unknown` and SHALL NOT retry

### Requirement: Readiness cannot be promoted by callers

Each operation SHALL remain `blocked_by_contract` until exact identity, credential, lifecycle, schema, authorization, tenant, transport, and coexistence evidence passes. Evidence MAY make it eligible for a later dedicated non-production profile, but `poc_only` SHALL remain non-executable through the normal product path until a separate cloud-space PoC change installs a trusted policy/audience Gate in Content Space service composition. That later Gate may only narrow exact instances, roots, accounts, limits, audiences, and operations; renderer, Agent, task, environment text, portable identity, or ordinary configuration SHALL NOT promote it.

#### Scenario: Only a shared tenant exists

- **WHEN** no dedicated non-production tenant and object authorization evidence are available
- **THEN** product-integrated OpenContent access SHALL remain blocked and any verification SHALL stay outside the product path

### Requirement: Delivery order remains Content Space first

The Connector SHALL depend on completed Content Space V1 and Secure Provider Credentials, precede the independent OpenContent ContentSpaceProvider adapter, and precede a separate cloud-space PoC change that adds the trusted Content Space execution Gate. Shared Documents and every Document port/provider SHALL remain deferred.

#### Scenario: Later milestone is proposed early

- **WHEN** adapter, PoC, or Document work lacks its predecessor
- **THEN** it SHALL remain blocked rather than add a stub, fallback, or compatibility path
