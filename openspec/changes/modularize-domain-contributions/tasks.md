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
