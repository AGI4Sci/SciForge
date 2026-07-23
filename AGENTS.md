# SciForge repository instructions

These are standing instructions for every Codex task in this repository, including work delegated to sub-agents. Apply them by default without requiring the user to repeat them.

## Architecture principles

- Design every feature as a cohesive, independently ownable module with an explicit public contract. Keep domain implementation details out of the application core.
- A domain package is the unit of ownership, versioning, installation, and release. Its backend and UI belong to the same package and version, while main-process and renderer code use separate explicit entrypoints. UI is optional for backend-only domains.
- Discover installed domain packages through the standard manifest and generated composition path. Adding or removing a domain package must not require editing a central feature map, domain-ID switch, or domain-specific host configuration.
- The host may depend on generic SDK contracts and extension points only. Domain packages must not import host-private `src/main`, `src/renderer`, `src/shared`, `@shared`, or `@renderer` implementation paths.
- Keep one canonical path for each capability, preview operation, state transition, and external write. Do not add parallel IPC, MCP, service, facade, registry, or fallback paths for the same behavior.

## Change policy

- When legacy behavior or structure conflicts with the target architecture, delete it and implement the clean target design directly. Do not add compatibility aliases, forwarding layers, migration shims, deprecated branches, or dual registration unless the user explicitly requires compatibility.
- All changes must be general. Never add a hard-coded exception for a showcase, fixture, domain ID, MIME type, plugin, provider, or current package when the behavior belongs in a contract, registry, manifest, or package-owned contribution.
- Consolidate duplicated logic at the narrowest shared generic boundary. Remove redundant branches, unused exports, unreachable code, stale tests, and dependencies once their remaining references have been audited.
- Prefer the smallest design that completely satisfies the requirement. Avoid speculative abstraction, extra lifecycle layers, duplicated metadata, and configuration that has no current consumer.
- Preserve user-visible behavior unless the requested target explicitly changes it. Tests should exercise the canonical production path rather than compatibility or test-only bypasses.

## Completion criteria

- Verify package boundaries, generated composition freshness, capability governance, type safety, focused package tests, full regression tests, and changed-file linting in proportion to the change.
- For runtime composition changes, validate both source and packaged application paths when supported by the repository.
- Before completion, audit for old entrypoints, private cross-boundary imports, duplicate runtime implementations, domain hard-coding in core, and dead files left behind by the migration.
- Documentation and architecture tests must describe and enforce the final design, not transitional history.
