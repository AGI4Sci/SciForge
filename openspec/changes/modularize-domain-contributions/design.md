# Design: Modularize domain contributions

## Context

SciForge is organized into Electron process layers, but several domain features are not yet complete vertical modules. Create Loop, Visual Review, Change Inspector, Terminal, Anchored Comments, and Git Checkpoints still span Host-owned main services, preload/IPC, top-bar branches, right or bottom panel conditionals, a global overlay, and composer logic. Their current UI presence is easy to mistake for package lifecycle state.

The repository already provides the right foundations: Capability Broker contracts, provider contract suites, Workspace Preview manifests, worker packages, sandboxed renderer boundaries, and lazy renderer adapters. This change turns those foundations into a compile-time module host without prematurely introducing an untrusted runtime plugin loader.

## Goals

- Make every registered contribution attributable to one module owner.
- Detect duplicate IDs and incompatible module contracts before partial activation.
- Make contribution order deterministic and lifecycle cleanup explicit.
- Remove concrete plugin dispatch switches from Workspace Preview main services.
- Make renderer outlets consume registries rather than private static arrays.
- Make Workspace Preview and Paper Radar complete vertical package-owned modules, not host-owned examples.
- Preserve user operations and routes while removing superseded internal transports and fake installation state.
- Make adding or removing a trusted domain require changing only the installed-domain package set, not application core maps or switches.
- Make the six remaining Workbench features independent, preinstalled, default-enabled SciForge official packages.
- Make renderer commands, right panels, bottom panels, overlays, and composer context generic extension points instead of feature-specific Host branches.
- Keep toolbar placement, package enablement, and package installation as separate authorities.

## Non-Goals

- Expanding the runtime installer beyond its existing official-signature policy.
- Trusting third-party publisher keys in the first phase.
- Executing third-party JavaScript in the privileged renderer.
- Replacing the Capability Broker or creating domain-specific IPC transports.
- Changing the user-visible behavior, stored domain data, or default availability of the six migrated features.

## Decisions

### 1. One logical release cohort, separate runtime entrypoints

A future domain package is one versioned installation and rollback unit, but its contract, main/worker, and renderer entrypoints remain physically separate. UI is optional. Renderer code depends only on stable contracts and host SDKs, never on backend implementation files.

### 2. Use a compile-time installed-domain package set

The repository generator scans `packages/domains/*/sciforge.domain.json`, sorts packages deterministically, and emits one installed definition set plus process-specific static projections. Main and renderer import separate entrypoints from that same selected package cohort. The catalog validates manifest and contribution identity, then exposes immutable snapshots. Host core must not maintain a second list of domain IDs or implementations.

Runtime-installed packages use the same pure manifest contract only after Host verification, but feed isolated extension-host and sandboxed-webview projections rather than these privileged static entrypoints.

### 3. One contribution path; no compatibility side paths

Once a surface or provider is migrated, callers use its registry or the Capability Broker directly. Static-array overrides, domain-specific preload methods, duplicate IPC handlers, and local-storage installation flags are deleted rather than maintained as compatibility layers. Registration is the source of availability.

### 4. Contributions are owner-aware and disposable

Every contribution is registered under a module ID. Registries reject duplicate contribution IDs, retain deterministic order, and return a disposable registration. Module activation is staged so validation failure cannot leave a partially registered module.

### 5. Capability Broker remains the execution authority

Modules contribute capability definitions and handlers to the existing `CapabilityRegistry`. The module catalog owns discovery and lifecycle metadata; it does not duplicate validation, scope, approval, idempotency, audit, or invocation logic.

### 6. Workspace Preview uses one complete provider and renderer chain

The backend maps each preview plugin ID to a package-owned provider implementing every supported operation: observe, invoke action, apply edit, prepare artifact, and export. The renderer resolves the canonical manifest first and then selects that manifest's renderer/action contribution. Biology Room or file-shape heuristics cannot bypass this route.

### 7. Renderer slots accept trusted built-ins only

Workbench domain panels are registered into typed slots with lazy loaders and explicit owners. This privileged path is only for code shipped with the signed SciForge application. Runtime-installed UI uses a sandbox page and a narrow capability bridge, including after third-party publishers are accepted.

### 8. Preserve one authoritative business contract

Where main and renderer need the same metadata, shared module contracts and existing Workspace Preview contracts remain authoritative. Renderer registries may add display/rendering data, but must not redefine backend lifecycle or capability truth.

### 9. Workbench contributions own their complete presentation metadata

A Workbench panel contribution declares its mode, label, icon, title, visible-context resource metadata, availability, and renderer together. Workbench and its top bar iterate contributions; they do not special-case Paper Radar.

### 10. Agent and UI callers share Capability Broker definitions

UI, system, and agent callers invoke the same registered capability definitions. MCP may remain a generic adapter surface, but it must not maintain a second domain contract or call a domain service through an independent business path.

### 11. Domain wire formats stay package-owned

The public Workspace Preview SDK carries built-in host shapes and bounded namespaced extension slots only. A domain package owns its concrete modality, selection, observation metadata, and encoder/decoder. Breaking migrations remove the old decoder instead of making core accept two representations. Life Science Preview uses one v2 envelope, rejects oversized selections, and explicitly marks truncated observations.

### 12. Release packaging has one executable representation

Trusted compile-time domain dependencies are compiled into the Electron main or renderer output. Release packaging does not also ship those packages' TypeScript source as a parallel runtime. Source-shipped worker entries remain only for genuine sidecar runtimes.

### 13. Toolbar availability and user placement are separate authorities

A package owns whether an action exists, its stable command ID, target, label, icon, and contextual availability. The user owns whether that installed action is placed in the Workbench toolbar and its relative order. Preferences are persisted in the host settings store by command ID rather than contribution index or package path.

An empty preference means the deterministic package-declared default. Newly installed actions therefore appear by default after explicitly ordered actions. Hidden or ordered command IDs are retained when their package is absent, so reinstalling the same command restores the user's choice. Resetting removes only placement preferences and never installs, enables, disables, or uninstalls a package.

### 14. Six Workbench features become official domain packages

The generated installed-domain set includes these independent packages:

| Feature | Package | Primary renderer contributions | Main/runtime ownership |
| --- | --- | --- | --- |
| Create Loop | `@sciforge/domain-create-loop` | command, Workbench right panel | workflow capabilities and runtime lifecycle |
| Visual Review | `@sciforge/domain-visual-review` | command, Workbench right panel, bounded composer context | annotation/artifact capabilities and owned services |
| Change Inspector | `@sciforge/domain-change-inspector` | command, Workbench right panel | change inspection capabilities and owned worker lifecycle |
| Terminal | `@sciforge/domain-terminal` | command, Workbench bottom panel | terminal session capabilities and owner-scoped runtime lifecycle |
| Anchored Comments | `@sciforge/domain-anchored-comments` | command, overlay, bounded composer context | comment/capture/feedback capabilities and owned services |
| Git Checkpoints | `@sciforge/domain-git-checkpoints` | command, Workbench right panel | checkpoint capabilities and owned service lifecycle |

Each package owns one manifest, one version, its shared pure-data contract, separate main and renderer entrypoints, all of its contribution IDs, and any required worker or assets. Cross-package cooperation uses public contracts and capabilities, never another package's implementation source.

All six packages are selected in the signed SciForge distribution, represented as installed, and enabled on first launch and migration. Their order and defaults come from manifests and generated composition; Host core does not contain a six-item feature map or domain-ID switch. A package that has no main work for a given build may omit the main entrypoint rather than provide an empty facade.

### 15. Renderer surfaces use generic contribution contracts

A generic `renderer.command` declares a stable command ID, label/icon metadata, contextual availability, and an invocation target. Toolbar items, menus, shortcuts, and other launchers reference that command; they do not own a second callback. Command existence comes from the enabled package, while toolbar visibility and order come from user placement preferences.

The renderer SDK exposes owner-aware, batch-validated contribution types for:

- `renderer.workbench-right-panel`: a lazy panel renderer, stable panel ID, title, visible-context metadata, and optional session workspace state contract;
- `renderer.workbench-bottom-panel`: a lazy bottom panel renderer plus sizing/focus metadata;
- `renderer.overlay`: an application-level, z-ordered interaction surface with explicit activation, sensitive-target policy, and cleanup;
- `renderer.composer-context`: a bounded, serializable context provider that resolves selected package context at send time and supplies display chips plus runtime payload;
- `renderer.command`: the single executable UI command referenced by placements.

The Host owns generic slot layout, focus, accessibility, context limits, deterministic order, and error boundaries. A package owns feature rendering and state. The Workbench must not import the six feature components or branch on their IDs. Complete renderer activation is atomic: if any declared contribution cannot bind, none of that package's renderer contributions become visible.

### 16. Lifecycle and capability authorities remain process-local

A package main entrypoint may contribute `main.capability-factory` for business operations and `main.runtime-lifecycle` for resources that must start, subscribe, recover, or dispose. Activation validates the whole package before starting runtime resources. Disable, version switch, application shutdown, or failed activation disposes package-owned resources in reverse order and is idempotent.

The Capability Broker remains the only business-operation authority. Commands, panels, overlays, composer providers, agents, and generic adapters call the same package-owned capabilities; migrating a package must delete its parallel domain IPC/preload/service facade. Long-lived output such as terminal data uses a generic owner-scoped lifecycle/event contract when request/response capability calls are insufficient, not a terminal-specific Host transport.

Main entrypoints cannot import renderer code, renderer entrypoints cannot import main services or Node/Electron privileged APIs, and neither entrypoint imports Host-private source. The Host can depend on generic SDK contribution types only. Package disablement blocks new invocations before lifecycle disposal and cannot silently fall back to a legacy path.

### 17. Placement, enablement, and installation are distinct

The state model is explicit:

- **Hidden toolbar command:** only the command's toolbar placement is suppressed. The package remains enabled; its command may remain available from another registered placement and its panels, overlay, composer context, capabilities, and runtime remain active.
- **Disabled package:** the artifact remains installed and package-owned settings/data remain intact, but none of its commands, views, overlay, composer context, capabilities, or runtime lifecycle contributions are active.
- **Uninstalled package:** the installed artifact/version is absent and therefore cannot be enabled or activated. Stable placement preferences may be retained for reinstall.

The six official packages are preinstalled and default enabled. Product policy may mark a bundled package non-removable, but that policy cannot collapse hide into disable or disable into uninstall. Resetting toolbar customization affects placement only. Enabling a package does not force a hidden command back into the toolbar, and reinstalling restores retained preferences by stable command ID.

## Risks and Mitigations

- **Risk: registry abstraction changes precedence.** Preserve existing arrays' exact order and add selection tests.
- **Risk: activation failure leaves partial state.** Validate complete batches before commit and dispose registrations in reverse order.
- **Risk: refactoring giant composition roots causes broad churn.** Limit this change to selected seams and delete replaced paths only after focused parity tests pass.
- **Risk: apparent plugin support is mistaken for runtime installation.** Name and document the first phase as built-in/compile-time modules only.
- **Risk: dead-code cleanup removes latent behavior.** Delete only code with no non-test references and with focused regression coverage.
- **Risk: package extraction changes mounting or session state.** Preserve the current right-panel session workspace, bottom-panel sizing/focus, overlay cleanup, and composer send-time semantics with focused parity tests.
- **Risk: disable leaves background work alive.** Block new capability calls first, then dispose owner-scoped registrations and runtime resources in reverse order; assert no events arrive after disposal.
- **Risk: toolbar hiding is presented as package removal.** Use separate placement and package controls and test the three lifecycle states independently.

## Migration Plan

1. Introduce module contracts, validation, and catalog tests.
2. Add Biology Room, Life Science Preview, and Paper Radar packages and generate their process projections.
3. Convert Workspace Preview backend and renderer dispatch to one canonical provider/contribution chain.
4. Convert Paper Radar's Workbench surface to a renderer contribution and its GUI operations to broker capabilities; then delete the old IPC/preload, MCP business path, and fake marketplace paths.
5. Run focused tests after each seam, then the full typecheck/build/capability contract suite.
6. Add generic renderer command, right-panel, bottom-panel, overlay, and composer-context contracts.
7. Create the six official package roots and move each feature's renderer UI, main capabilities, runtime lifecycle, contracts, and assets into its owning package.
8. Replace Workbench/top-bar/composer/overlay and main startup branches with generated, owner-aware contribution iteration; delete retired feature transports after caller migration.
9. Verify default installation and enablement plus the independent hidden/disabled/uninstalled state transitions.
10. Validate source and packaged application composition and document the official-signature/sandbox boundary.

## Runtime-installed package relationship

```text
@sciforge/domain-<name>
├── sciforge.domain.json
├── contracts/
├── main-or-worker/
├── renderer/          # optional; trusted built-in entry or sandbox page
├── skills/            # optional
└── assets/            # optional
```

The pure manifest contract covers both trusted compile-time and sandboxed-runtime packages. The six packages in this change use separate privileged static projections because they ship inside the signed SciForge build. An installed runtime artifact cannot select that trust path: its backend runs in an extension host, its UI runs in a sandboxed webview, and its permissions are grants owned by the Host rather than claims in its manifest.

The first runtime-install phase accepts only SciForge official Ed25519 signatures. Future third-party acceptance changes the Host-owned publisher key policy, not the contribution contracts or privileged process boundary.
