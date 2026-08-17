# provider-composition Specification

## Purpose

Defines trusted compile-time composition of separate domain-specific Provider factories and instance-pinned routing without a universal Provider API, Host vendor routing, or fallback.

## Requirements

### Requirement: Provider contracts remain domain-specific

SciForge SHALL define independent DocumentProvider and ContentSpaceProvider contracts owned by their business domains. It SHALL NOT define a universal Provider containing optional document, file, storage, launch, credential, or vendor operations.

#### Scenario: One integration supports both domains

- **WHEN** one trusted package implements both Provider contracts
- **THEN** it SHALL declare and return two independent contributions with separate validation, factories, readiness, lifecycle, and tests

#### Scenario: Only Content Space is installed

- **WHEN** no Shared Documents package or DocumentProvider is present
- **THEN** Content Space Provider composition SHALL remain complete and SHALL NOT manufacture a document surface or stub

### Requirement: Provider factories use standard main extensions

V1 Provider implementations SHALL be trusted compile-time packages discovered through standard `sciforge.domain.json` manifests and generated source/packaged composition. Their declarations SHALL use generic `main.extension` contributions whose exact `location` is `main.document-provider-factory` or `main.content-space-provider-factory`. Adding or removing a package SHALL require no Host feature map, Provider Kind switch, vendor IPC, Agent Runtime branch, renderer registry, dynamic loader, compatibility alias, or dual registration.

#### Scenario: Compatible Provider package is added

- **WHEN** generation processes a reviewed manifest and its process-separated main entrypoint
- **THEN** only the owning domain catalog SHALL discover its matching factory location

#### Scenario: Runtime plugin is offered

- **WHEN** an unbundled package attempts runtime installation or dynamic code execution
- **THEN** V1 composition SHALL reject it because signing, sandboxing, permissions, upgrades, and isolation are outside this contract

### Requirement: Declaration and runtime values are bound exactly

Each factory contribution SHALL bind its trusted package/module/contribution owner, manifest declaration version, exact location, supported contract version, and one bounded Provider Kind. The runtime value SHALL match every declared field. Unknown contract major, missing or extra runtime value, location mismatch, Provider Kind mismatch, forged owner, malformed factory, or duplicate Provider Kind within one domain catalog SHALL fail closed before factory use.

#### Scenario: Two packages claim one Content Space Provider Kind

- **WHEN** both compatible-looking contributions claim that kind
- **THEN** the Content Space catalog SHALL reject the duplicate rather than select by priority, package order, or last registration

#### Scenario: Package contributes one valid and one invalid domain factory

- **WHEN** a package's Content Space contribution is valid and its Document contribution is incompatible
- **THEN** neither contribution SHALL be reinterpreted as the other or merged into a universal Provider; each declaration is validated independently

### Requirement: Each domain owns its Provider catalog and service

Shared Documents SHALL consume only its Document Provider catalog, and Content Space SHALL consume only its Content Space Provider catalog and service. Host Core SHALL expose only generic contribution metadata and generic runtime lifecycle services; it SHALL NOT understand domain operations, Provider capabilities, resource kinds, file extensions, MIME types, Provider/vendor identities, or domain readiness.

#### Scenario: Content Space catalog enumerates contributions

- **WHEN** both Document and Content Space factory extensions are installed
- **THEN** the Content Space catalog SHALL filter by exact location before domain validation and SHALL never invoke the Document contribution

### Requirement: Provider construction is lazy and locally side-effect free

Composition, directory construction, catalog construction, and factory selection SHALL perform no network call, login, credential read, content access, remote resource creation, or Provider session activation. A selected factory SHALL create only the exact pinned domain Provider lazily under trusted main-process dependencies at operation time.

#### Scenario: Provider infrastructure is offline at startup

- **WHEN** one installed Provider cannot reach its service
- **THEN** unrelated domains and Provider contributions SHALL still compose, while an operation pinned to that instance returns a bounded unavailable outcome

#### Scenario: Catalog is listed

- **WHEN** UI or a domain lists trusted Provider instances or factory metadata
- **THEN** no factory SHALL be created and no credential or network operation SHALL occur

### Requirement: Provider Instances use a trusted non-secret directory extension

Selectable Provider Instances SHALL be declared through standard generic `main.extension` contributions at `main.provider-instance-directory-entry`. Each entry SHALL bind its contract version, trusted composition owner, bounded opaque ProviderInstanceRef, Provider Kind, and safe display name. The directory SHALL contain no endpoint, credential, Token, Provider Connection, resource identity, or caller-selected registration.

Duplicate ProviderInstanceRef, declaration/runtime mismatch, unknown contract, invalid reference, or conflicting ownership SHALL fail during composition before any Provider factory is invoked.

#### Scenario: Integration package adds an instance

- **WHEN** a trusted package contributes a compatible factory and directory entry
- **THEN** generated source and packaged composition SHALL expose that instance without a Host/provider switch or implicit default

#### Scenario: Duplicate instance is declared

- **WHEN** two contributions claim the same ProviderInstanceRef
- **THEN** directory construction SHALL fail closed before either Provider is created

### Requirement: Routing is pinned through directory then domain catalog

Every domain operation SHALL first resolve its ProviderInstanceRef through the trusted Provider Instance Directory, then select the exact matching Provider Kind in the owning domain catalog, then lazily create/use that Provider for the operation. Caller input and portable identity SHALL NOT name a package, factory, endpoint, credential, connection, fallback order, unregistered directory entry, or default Provider.

#### Scenario: Provider Instance is unknown

- **WHEN** a valid-looking reference names an unregistered instance
- **THEN** routing SHALL fail before factory invocation, endpoint resolution, credential access, or network use

#### Scenario: Two instances share one Provider Kind

- **WHEN** distinct trusted instance entries select the same factory implementation
- **THEN** selection and Provider runtime state SHALL remain pinned and distinguishable by ProviderInstanceRef

### Requirement: Provider failure never causes fallback

A reference and operation SHALL remain bound to the selected Provider Instance. Missing, disabled, incompatible, unavailable, unauthorized, or uncertain Provider behavior SHALL return a bounded failure or Human-action disposition and SHALL NOT invoke another Provider, reinterpret identity, infer from extension/MIME, choose an arbitrary default, retry an uncertain write, or silently copy/migrate the resource.

#### Scenario: Pinned Provider is unavailable

- **WHEN** another compatible Provider is installed
- **THEN** SciForge SHALL stop with the pinned Provider outcome and SHALL NOT contact the other Provider

#### Scenario: Cross-provider migration is requested

- **WHEN** a Human wants a resource moved to another Provider
- **THEN** a separate explicit governed migration/import/export capability SHALL be required and a successful destination SHALL receive a new reference

### Requirement: Runtime assembly uses the canonical lifecycle

The application SHALL project all trusted main extensions before activating package runtime lifecycle contributions. Domain lifecycle code SHALL obtain the generic contribution host from `DomainMainRuntimeLifecycleContext`. Owner-scoped services SHALL come from the trusted package main-entry Host and be captured into the lifecycle/capability implementation rather than exposed as global contributions. The package SHALL install its catalog/service/capability graph without package-load singletons or contribution load-order dependencies.

#### Scenario: Runtime contribution activates before remote use

- **WHEN** Content Space activates from source or packaged composition
- **THEN** it SHALL build the same directory/catalog/service graph from projected extensions before any Provider operation is accepted
