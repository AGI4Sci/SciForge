# Change: Modularize domain contributions

## Why

The application already has strong process boundaries and a capable Capability Broker, but several first-party Workbench features are still assembled through core-owned imports, switch statements, top-bar conditionals, overlays, composer branches, and process lifecycle wiring. Create Loop, Visual Review, Change Inspector, Terminal, Anchored Comments, and Git Checkpoints are substantial vertical features, but the host still treats parts of them as built-in UI modes rather than independently owned domain packages.

This change establishes one domain-package boundary that owns each selected domain's contract, main/worker contributions, optional renderer contributions, and lifecycle. The six Workbench features become independent SciForge-official packages that are preinstalled and enabled by default. Supported operations remain available, while obsolete central maps, host-private feature branches, and duplicate transport surfaces are removed.

## What Changes

- Add a versioned module contract and an owner-aware catalog for built-in domain modules.
- Compose domain capabilities and lifecycle contributions through module-owned registrations instead of anonymous central wiring.
- Replace Workspace Preview backend dispatch switches with a provider registry.
- Replace Workspace Preview renderer defaults and selected Workbench panels with owner-aware UI contributions and slots.
- Package Biology Room, Life Science Preview, and Paper Radar as trusted vertical domain modules and remove their superseded host-owned wiring.
- Route Paper Radar GUI operations through the Capability Broker and delete its domain-specific IPC/preload transport.
- Add architecture checks for duplicate IDs, incompatible host contracts, deterministic ordering, and cleanup/disposal.
- Let users choose which installed Workbench toolbar contributions are visible and in which order, with preferences stored by stable command ID.
- Remove superseded compatibility paths plus dead or redundant code established by repository-wide reference search and tests.
- Generate one installed-domain package set from `packages/domains/*/sciforge.domain.json` as the only composition input for main, renderer, and governance.
- Keep domain-specific Workspace Preview wire schemas in their owning package, carried through generic namespaced SDK extension slots without legacy decoders.
- Move complete Workspace Preview operations and Workbench metadata behind package-owned contributions so new domains do not require core switches.
- Package Create Loop, Visual Review, Change Inspector, Terminal, Anchored Comments, and Git Checkpoints as six independent SciForge-official domain packages.
- Include those six packages in the generated installed set, preinstalled and enabled by default, without making the Host core aware of their IDs.
- Add generic renderer contribution contracts for commands, right panels, bottom panels, overlays, and bounded composer context.
- Move package runtime startup/shutdown and all business operations behind module-owned runtime lifecycle and Capability Broker contributions.
- Keep toolbar placement, package enablement, and package installation as three independent states: hiding a command does not disable its package, and disabling a package does not uninstall it.

## Capabilities

### New Capabilities

- `domain-module-catalog`: Defines module manifests, contribution ownership, compatibility validation, deterministic composition, and lifecycle disposal for built-in modules.
- `domain-ui-contributions`: Defines typed renderer slots and registries used by Workspace Preview and selected Workbench panels.
- `official-workbench-domain-packages`: Defines ownership, default installation/enablement, lifecycle, and contribution requirements for the six SciForge Workbench packages.
- `workbench-toolbar-customization`: Persists user-owned visibility and ordering preferences for installed toolbar contributions.
- `workspace-preview-provider-registry`: Routes preview observe/action/artifact operations through registered backend providers rather than plugin-ID switches.

### Modified Capabilities

- `capability-broker`: Existing capability definitions remain authoritative but may be supplied by module-owned contribution factories.
- `workspace-preview`: User-visible operations remain available while manifests, providers, renderers, and domain wire encoding become package-owned and old host-specific contract branches are removed.
- `paper-radar`: Existing user operations move to broker capabilities and a module-owned renderer slot; the local-storage fake installer and development-only guard are removed.

## Impact

- Affected code: shared module contracts, main composition and lifecycle services, renderer contribution registries and Workbench assembly, six new package roots, focused tests, and architecture documentation.
- User toolbar preferences are app-global, survive package removal/reinstallation, and can be reset without changing package installation state.
- Existing users receive all six official packages installed and enabled, preserving their current Workbench capabilities and default placements.
- Disabling one package removes only its active contributions and disposes its owned runtime resources; it does not alter another package or delete package-owned data.
- Existing domain data is not rewritten; a bounded settings initialization/migration records default enablement while preserving stable toolbar and session-layout preferences.
- Paper Radar's private domain IPC namespace is removed in favor of the existing public Capability Broker transport.
- No third-party publisher is trusted by this change. These six packages use the trusted compile-time path shipped by SciForge; runtime-installed packages remain confined to the extension-host and sandboxed-webview path.
