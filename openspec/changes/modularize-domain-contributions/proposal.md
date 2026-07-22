# Change: Modularize domain contributions

## Why

The application already has strong process boundaries and a capable Capability Broker, but domain features are still assembled through static imports, central switch statements, and large renderer conditionals. Adding a future domain package therefore requires editing core application files across main, preload, shared, and renderer layers.

This change establishes a trusted compile-time domain-package boundary that owns each selected domain's contract, main/worker contributions, and optional renderer contributions. Supported domain operations remain available, while obsolete fake-install, central domain maps, and duplicate transport surfaces are removed.

## What Changes

- Add a versioned module contract and an owner-aware catalog for built-in domain modules.
- Compose domain capabilities and lifecycle contributions through module-owned registrations instead of anonymous central wiring.
- Replace Workspace Preview backend dispatch switches with a provider registry.
- Replace Workspace Preview renderer defaults and selected Workbench panels with owner-aware UI contributions and slots.
- Package Biology Room, Life Science Preview, and Paper Radar as trusted vertical domain modules and remove their superseded host-owned wiring.
- Route Paper Radar GUI operations through the Capability Broker and delete its domain-specific IPC/preload transport.
- Add architecture checks for duplicate IDs, incompatible host contracts, deterministic ordering, and cleanup/disposal.
- Remove superseded compatibility paths plus dead or redundant code established by repository-wide reference search and tests.
- Generate one installed-domain package set from `packages/domains/*/sciforge.domain.json` as the only composition input for main, renderer, and governance.
- Keep domain-specific Workspace Preview wire schemas in their owning package, carried through generic namespaced SDK extension slots without legacy decoders.
- Move complete Workspace Preview operations and Workbench metadata behind package-owned contributions so new domains do not require core switches.

## Capabilities

### New Capabilities

- `domain-module-catalog`: Defines module manifests, contribution ownership, compatibility validation, deterministic composition, and lifecycle disposal for built-in modules.
- `domain-ui-contributions`: Defines typed renderer slots and registries used by Workspace Preview and selected Workbench panels.
- `workspace-preview-provider-registry`: Routes preview observe/action/artifact operations through registered backend providers rather than plugin-ID switches.

### Modified Capabilities

- `capability-broker`: Existing capability definitions remain authoritative but may be supplied by module-owned contribution factories.
- `workspace-preview`: User-visible operations remain available while manifests, providers, renderers, and domain wire encoding become package-owned and old host-specific contract branches are removed.
- `paper-radar`: Existing user operations move to broker capabilities and a module-owned renderer slot; the local-storage fake installer and development-only guard are removed.

## Impact

- Affected code: shared module contracts, main composition and Workspace Preview services, renderer contribution registries and Workbench assembly, focused tests, and architecture documentation.
- No persistent data migration is required.
- Paper Radar's private domain IPC namespace is removed in favor of the existing public Capability Broker transport.
- No untrusted runtime JavaScript loading is introduced in this change; selected trusted packages are composed at build time through separate process entrypoints.
