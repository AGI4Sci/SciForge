# Tasks: Modularize domain contributions

## 1. Module contract and catalog

- [x] 1.1 Define versioned built-in module manifests and typed contribution metadata.
- [x] 1.2 Implement owner-aware, deterministic, disposable registration with batch validation.
- [x] 1.3 Add tests for compatibility, duplicate IDs, atomic failure, ordering, and disposal.

## 2. Main-process composition

- [x] 2.1 Add built-in module descriptors for Workspace Preview and Paper Radar.
- [x] 2.2 Introduce module-owned capability contribution composition through the catalog's single registration path.
- [x] 2.3 Resolve main capability/service contributions generically from the catalog and preserve lazy service lifecycles.

## 3. Workspace Preview backend

- [x] 3.1 Replace plugin-ID operation switches with a typed backend provider registry.
- [x] 3.2 Register all current built-in preview providers in their existing precedence and behavior.
- [x] 3.3 Add focused provider routing and unknown-provider regression tests.

## 4. Renderer contributions

- [x] 4.1 Add an owner-aware renderer contribution registry with deterministic ordering and disposal.
- [x] 4.2 Move Workspace Preview fully behind the live registry and delete static-array compatibility paths without changing matching or output.
- [x] 4.3 Register Paper Radar's Workbench surface through a typed built-in slot and remove its development/local-storage availability guard.
- [x] 4.4 Route Paper Radar GUI operations through broker capabilities and remove its dedicated IPC/preload namespace.
- [x] 4.5 Remove the fake extension marketplace path; installed/discovered state must come from a real module or skill source.

## 5. Cleanup and boundaries

- [x] 5.1 Remove only provably unreachable code or redundant branches discovered during migration.
- [x] 5.2 Avoid adding new imports of worker package private `src` paths and document remaining deferred boundary debt.
- [x] 5.3 Document the built-in phase and the future signed/sandboxed runtime package phase.

## 6. Verification

- [x] 6.1 Run focused unit tests for the module catalog and migrated registries.
- [x] 6.2 Run TypeScript checks and the Capability Broker contract check.
- [x] 6.3 Run the production build or the closest repository-supported build verification.
- [x] 6.4 Review the final diff for user-visible behavior changes and unresolved dead-code claims.

## 7. Trusted domain package ownership

- [x] 7.1 Define process-separated domain package entrypoints and one installed-domain package set.
- [x] 7.2 Make main composition and capability governance consume the same package definitions; delete the legacy capability composition entry.
- [x] 7.3 Make renderer composition consume package-owned complete panel metadata rather than Paper Radar-specific props and mode maps.
- [x] 7.4 Prove that adding or removing a fixture domain changes all of its contributions without editing core feature maps.

## 8. Complete Workspace Preview chain

- [x] 8.1 Extend provider contributions to cover observe, action, edit, artifact, export, and host actions through one dispatch path.
- [x] 8.2 Remove Biology Room's pre-registry preview routing and route all recognized formats through the canonical manifest registry.
- [x] 8.3 Resolve renderer and toolbar behavior from the canonical plugin contribution rather than secondary MIME, extension, or observation-shape heuristics.
- [x] 8.4 Make manifest registration owner-aware, duplicate-safe, and disposable; remove the redundant renderer descriptor registry.

## 9. Transport and contract cleanup

- [x] 9.1 Replace the Biology Room file-picker IPC exception with one generic constrained file-picker transport.
- [x] 9.2 Remove migrated Workspace Preview and Biology Room capability facades after their callers use the generic capability client.
- [x] 9.3 Unify Paper Radar UI and agent operations on one capability contract and remove the second service/MCP business path.
- [x] 9.4 Remove proven test-only compatibility exports, unused descriptor fields, and remaining private worker imports in migrated modules.

## 10. Completion verification

- [x] 10.1 Add architectural acceptance tests for package selection, complete activation/disposal, and absence of core domain maps.
- [x] 10.2 Add real Electron Workspace Preview read/edit/release coverage and Paper Radar UI capability coverage.
- [x] 10.3 Build an unpacked distributable and launch the packaged app through the migrated domain paths.
- [x] 10.4 Re-run full tests, package tests, typechecks, governance, lint on changed files, build, and dead-path audits.

## 11. User-configurable Workbench toolbar contributions

- [x] 11.1 Add bounded, normalized host settings for hidden command IDs and explicit toolbar order.
- [x] 11.2 Resolve visible toolbar contributions from installed actions plus user preferences without changing contribution availability or execution authority.
- [x] 11.3 Add an accessible toolbar configuration surface for add/remove, reorder, and reset actions.
- [x] 11.4 Cover normalization, persistence, ordering, missing-package retention, and UI rendering with focused tests.
- [x] 11.5 Run typechecks, focused regressions, build verification, and local UI validation.
- [x] 11.6 Make the toolbar customization entry visibly labeled and verify it in the running app.

## 12. Six-package architecture and contracts

- [x] 12.1 Define Create Loop, Visual Review, Change Inspector, Terminal, Anchored Comments, and Git Checkpoints as independent SciForge official domain packages that are preinstalled and enabled by default.
- [x] 12.2 Specify generic renderer command, right-panel, bottom-panel, overlay, and bounded composer-context contributions.
- [x] 12.3 Specify package installation, enablement, toolbar placement, capability authority, and runtime lifecycle as independent Host-owned boundaries.

## 13. Generic renderer contribution SDK

- [x] 13.1 Add stable owner-aware contracts and registries for `renderer.command`, `renderer.workbench-right-panel`, `renderer.workbench-bottom-panel`, `renderer.overlay`, and `renderer.composer-context`.
- [x] 13.2 Bind every renderer contribution declared by one package atomically, reject missing/extra/duplicate contributions, and dispose registrations in reverse order.
- [x] 13.3 Make Workbench, top bar, bottom panel, application overlay outlet, and composer resolve only generic installed contributions without feature IDs or imports.
- [x] 13.4 Route every toolbar/menu/shortcut placement through the same stable `renderer.command`; do not retain placement-owned callbacks.

## 14. Official Workbench packages

- [x] 14.1 Create `@sciforge/domain-create-loop` and move Create Loop contracts, command, right panel, capabilities, and runtime lifecycle behind its process-separated public entrypoints.
- [x] 14.2 Create `@sciforge/domain-visual-review` and move Visual Review contracts, command, right panel, bounded composer context, capabilities, and owned services behind its public entrypoints.
- [x] 14.3 Create `@sciforge/domain-change-inspector` and move Change Inspector contracts, command, right panel, capabilities, and worker lifecycle behind its public entrypoints.
- [x] 14.4 Create `@sciforge/domain-terminal` and move Terminal contracts, command, bottom panel, session capabilities, and owner-scoped event/runtime lifecycle behind its public entrypoints.
- [x] 14.5 Create `@sciforge/domain-anchored-comments` and move Anchored Comments contracts, command, overlay, bounded composer context, capture/feedback capabilities, and service lifecycle behind its public entrypoints.
- [x] 14.6 Create `@sciforge/domain-git-checkpoints` and move Git Checkpoints contracts, command, right panel, capabilities, and service lifecycle behind its public entrypoints.
- [x] 14.7 Select all six packages through generated installed-domain composition with preinstalled/default-enabled metadata, and remove their Host feature maps, imports, mode switches, and domain-specific transport paths.

## 15. Lifecycle and preference behavior

- [ ] 15.1 Persist package enablement independently from toolbar hidden/order preferences, with all six packages enabled on fresh and migrated installations.
- [x] 15.2 Ensure hiding a command changes only placement while the enabled package's other surfaces, composer context, capabilities, and runtime remain active.
- [ ] 15.3 Ensure disabling a package blocks new invocations, removes all owned contributions, disposes runtime resources idempotently, preserves package data/preferences, and does not affect another package.
- [x] 15.4 Ensure uninstall or package absence prevents activation while retaining bounded stable-ID placement preferences for reinstall; keep protected bundled-package removal policy separate from disablement.

## 16. Acceptance verification

- [x] 16.1 Add manifest/composition tests proving each of the six packages owns its full declared contribution set and can be added or removed without editing Host feature maps.
- [x] 16.2 Add renderer tests for command reuse, right/bottom panel routing, overlay activation/cleanup, composer context bounds, atomic activation, and reverse disposal.
- [ ] 16.3 Add lifecycle tests for fresh defaults and independent hidden, disabled, absent/reinstalled, reset, failed activation, shutdown, and version-switch states.
- [x] 16.4 Add capability-governance tests proving UI and agent callers use one broker path and that no migrated domain-specific IPC/preload/service facade remains.
- [x] 16.5 Run package boundary checks, generated composition freshness, typechecks, focused package tests, full regressions, changed-file lint, source build, unpacked packaged-app launch, and dead-path audits.
