## Purpose

Defines trusted compile-time composition of separate domain Provider factories without a universal Provider API, Host vendor routing, or fallback.

## ADDED Requirements

### Requirement: Provider contracts remain domain-specific

DocumentProvider and ContentSpaceProvider SHALL be independently owned and SHALL NOT be merged into a universal optional-method Provider.

#### Scenario: One integration supports both domains

- **WHEN** a trusted package implements both contracts
- **THEN** it SHALL contribute two independently validated factories and neither SHALL imply the other

### Requirement: Provider factories use standard main extensions

Factories SHALL be trusted compile-time `main.extension` contributions at exact locations `main.document-provider-factory` or `main.content-space-provider-factory`, discovered through standard manifests and generated source/packaged composition.

#### Scenario: Package is added or removed

- **WHEN** generation processes the reviewed package set
- **THEN** the matching domain catalog SHALL change without a Host feature map, Provider switch, special IPC/Agent path, loader, alias, or dual registration

### Requirement: Declaration and runtime bindings fail closed

Location, contract version, manifest declaration version, Provider Kind, trusted owner, and runtime value SHALL match exactly. Unknown, malformed, missing, extra, incompatible, or duplicate Provider Kind contributions SHALL fail before factory use.

#### Scenario: Duplicate kind is contributed

- **WHEN** two packages claim one Content Space Provider Kind
- **THEN** catalog construction SHALL fail rather than select by priority or load order

### Requirement: Each domain owns its catalog

Content Space SHALL consume only its Content Space catalog and a later Shared Documents package only its Document catalog. Host SHALL expose only generic contribution metadata and lifecycle services and SHALL know no business operation, vendor, domain readiness, MIME type, or file extension.

#### Scenario: Both factory locations are installed

- **WHEN** Content Space builds its catalog
- **THEN** it SHALL filter exact location first and SHALL never invoke the Document contribution

### Requirement: Provider composition has no remote side effects

Directory/catalog construction, listing, and selection SHALL perform no network call, login, credential read, content access, remote mutation, or Provider session activation. Provider creation SHALL be lazy and exact.

#### Scenario: Provider is offline during startup

- **WHEN** the application composes extensions
- **THEN** unrelated domains SHALL start and only an operation pinned to that instance MAY return bounded unavailability

### Requirement: Provider Instances use a trusted non-secret directory

Standard `main.provider-instance-directory-entry` extensions SHALL bind an opaque ProviderInstanceRef, Provider Kind, safe display name, version, and owner without endpoint, credential, connection, or resource identity. Duplicates and mismatches SHALL fail before factory use.

#### Scenario: Duplicate instance is declared

- **WHEN** two entries claim one ProviderInstanceRef
- **THEN** directory construction SHALL fail closed

### Requirement: Routing is directory-pinned and never falls back

Every operation SHALL resolve ProviderInstanceRef, select its exact domain Provider Kind, and use only that Provider. Missing, blocked, incompatible, unavailable, unauthorized, or uncertain outcomes SHALL NOT choose a default, infer by extension/MIME, contact another Provider, blindly retry, reinterpret identity, or silently copy.

#### Scenario: Pinned Provider is unavailable

- **WHEN** another compatible Provider is installed
- **THEN** the pinned outcome SHALL be returned without contacting the other Provider

### Requirement: Runtime assembly uses the canonical lifecycle

All trusted main extensions SHALL be projected before package runtime lifecycle activation, and domain lifecycle code SHALL build its catalog/service through the generic contribution host without package-load singleton or ordering dependency.

#### Scenario: Source and packaged application start

- **WHEN** either generated composition path activates Content Space
- **THEN** both SHALL discover the same package contributions and build the same pinned routing graph
