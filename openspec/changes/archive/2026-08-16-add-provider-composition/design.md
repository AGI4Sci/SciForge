## Context

Document and Content Space semantics belong to separate domain-owned Provider contracts, not one optional-method Provider. The current Domain SDK projects generic `main.extension` declarations with trusted owner metadata before activating runtime lifecycle contributions. Provider composition must use that mechanism and preserve the current Host lifecycle, renderer, resource governance, and application composition.

## Goals / Non-Goals

**Goals:**

- Provide one standard compile-time path for DocumentProvider and ContentSpaceProvider factories.
- Bind manifest declarations and runtime values exactly.
- Keep catalogs, Provider semantics, readiness, and services inside the owning domain.
- Resolve an opaque trusted Provider Instance before selecting and lazily creating a Provider.
- Fail missing, duplicate, incompatible, unavailable, and uncertain outcomes without fallback.

**Non-Goals:**

- A universal Provider, Host ProviderRegistry, vendor switch, credential system, or business UI.
- Runtime package installation, signing, sandboxing, permissions, dynamic loading, or upgrades.
- Default Provider selection, retry policy, migration, replication, or silent copying.

## Decisions

### Use generic main extensions with exact locations

Both factories are `main.extension` contributions. Their contracts and runtime values contain an exact domain-specific location, contract version, and bounded Provider Kind. The trusted projection also carries package/module/contribution owner and manifest declaration version. Each catalog filters by exact location before validating its own runtime shape.

### Keep catalogs and services with their domains

Host supplies only `DomainMainContributionHost`. Content Space builds its catalog/service during its package runtime lifecycle; a later Shared Documents package can do the same independently. Host never understands Provider operations, capability profiles, MIME/extension routing, or vendors.

### Compose a generic non-secret instance directory

Trusted compile-time packages contribute `main.provider-instance-directory-entry` values. Entries bind opaque ProviderInstanceRef, Provider Kind, safe display name, contract version, and owner. They contain no endpoint, credential, connection, or business resource identity, and duplicate references fail before factory use.

### Select lazily and stay pinned

An operation resolves ProviderInstanceRef in the directory, selects only its Provider Kind in the owning catalog, then creates/uses that exact Provider lazily with owner-bound Host ports. Catalog construction and selection perform no network, login, credential, content, or remote mutation work. Unavailability never selects another Provider.

### Activate through the current runtime lifecycle

Application composition projects all main extensions first. Domain lifecycle activation receives the generic contribution host and installs the domain service/capability graph without package-load singleton state or ordering dependency. Source and packaged paths share generated composition.

## Risks / Trade-offs

- **Cross-domain contamination** is closed by filtering exact location before domain validation.
- **Owner or version forgery** is closed by trusted manifest projection and exact declaration/runtime comparison.
- **Duplicate kind or instance selection** is closed by deterministic construction failure, never priority or last-wins behavior.
- **Offline startup coupling** is closed by side-effect-free construction and lazy operation-time Provider creation.
- **Users expect fallback** is answered by explicit migration/import/export as a separate future capability that creates a new destination reference.

## Migration Plan

1. Add public main-extension schemas and tests.
2. Project manifest declaration version with existing trusted owner metadata.
3. Add domain catalog and non-secret instance directory composition.
4. Build Content Space catalog/service during canonical lifecycle activation.
5. Regenerate and validate source/packaged composition, package boundaries, governance, and no hard-coded routing.
