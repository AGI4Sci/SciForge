# Design: Modularize domain contributions

## Context

SciForge is organized into Electron process layers, but its domain features are not yet vertical modules. The main capability registry, Workspace Preview worker client, renderer preview outlet, and Workbench know concrete domains directly. Package metadata such as `workerPackage` and `rendererModule` is descriptive rather than load-bearing.

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

## Non-Goals

- Downloading or installing packages at runtime.
- Executing third-party JavaScript in the privileged renderer.
- Signed bundles, permission prompts, hot unload, rollback, or crash recovery.
- Replacing the Capability Broker or creating domain-specific IPC transports.

## Decisions

### 1. One logical release cohort, separate runtime entrypoints

A future domain package is one versioned installation and rollback unit, but its contract, main/worker, and renderer entrypoints remain physically separate. UI is optional. Renderer code depends only on stable contracts and host SDKs, never on backend implementation files.

### 2. Use a compile-time installed-domain package set

The repository generator scans `packages/domains/*/sciforge.domain.json`, sorts packages deterministically, and emits one installed definition set plus process-specific static projections. Main and renderer import separate entrypoints from that same selected package cohort. The catalog validates manifest and contribution identity, then exposes immutable snapshots. Host core must not maintain a second list of domain IDs or implementations.

The future untrusted runtime loader may feed the same contracts after package verification and process isolation are implemented.

### 3. One contribution path; no compatibility side paths

Once a surface or provider is migrated, callers use its registry or the Capability Broker directly. Static-array overrides, domain-specific preload methods, duplicate IPC handlers, and local-storage installation flags are deleted rather than maintained as compatibility layers. Registration is the source of availability.

### 4. Contributions are owner-aware and disposable

Every contribution is registered under a module ID. Registries reject duplicate contribution IDs, retain deterministic order, and return a disposable registration. Module activation is staged so validation failure cannot leave a partially registered module.

### 5. Capability Broker remains the execution authority

Modules contribute capability definitions and handlers to the existing `CapabilityRegistry`. The module catalog owns discovery and lifecycle metadata; it does not duplicate validation, scope, approval, idempotency, audit, or invocation logic.

### 6. Workspace Preview uses one complete provider and renderer chain

The backend maps each preview plugin ID to a package-owned provider implementing every supported operation: observe, invoke action, apply edit, prepare artifact, and export. The renderer resolves the canonical manifest first and then selects that manifest's renderer/action contribution. Biology Room or file-shape heuristics cannot bypass this route.

### 7. Renderer slots accept trusted built-ins only

Workbench domain panels are registered into typed slots with lazy loaders and explicit owners. This fast path is for code shipped with the application. A later third-party path must use a sandbox page and a narrow capability bridge.

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

## Risks and Mitigations

- **Risk: registry abstraction changes precedence.** Preserve existing arrays' exact order and add selection tests.
- **Risk: activation failure leaves partial state.** Validate complete batches before commit and dispose registrations in reverse order.
- **Risk: refactoring giant composition roots causes broad churn.** Limit this change to selected seams and delete replaced paths only after focused parity tests pass.
- **Risk: apparent plugin support is mistaken for runtime installation.** Name and document the first phase as built-in/compile-time modules only.
- **Risk: dead-code cleanup removes latent behavior.** Delete only code with no non-test references and with focused regression coverage.

## Migration Plan

1. Introduce module contracts, validation, and catalog tests.
2. Add Biology Room, Life Science Preview, and Paper Radar packages and generate their process projections.
3. Convert Workspace Preview backend and renderer dispatch to one canonical provider/contribution chain.
4. Convert Paper Radar's Workbench surface to a renderer contribution and its GUI operations to broker capabilities; then delete the old IPC/preload, MCP business path, and fake marketplace paths.
5. Run focused tests after each seam, then the full typecheck/build/capability contract suite.
6. Document deferred runtime package loading and sandbox requirements.

## Future Runtime Package Shape

```text
@sciforge/domain-<name>
├── sciforge.domain.json
├── contracts/
├── main-or-worker/
├── renderer/          # optional; trusted built-in or sandbox page
├── skills/            # optional
└── assets/            # optional
```

The manifest will eventually declare host API ranges, separate entrypoints, permissions, contributed capability/view/preview IDs, and integrity metadata. Installing the domain is atomic; executing its UI and backend remains isolated.

## Deferred Boundary Work

- Discovery is compile-time in this change. Runtime package location, signature verification, permissions, sandbox UI, rollback, and crash recovery remain a separate phase built on the same package contracts.
- Third-party custom UI remains prohibited in the privileged renderer. The future runtime package path must use a sandbox page and the generic capability transport.
