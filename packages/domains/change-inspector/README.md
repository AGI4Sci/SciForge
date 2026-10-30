# Change Inspector

SciForge's official, package-owned session change inspector.

The package owns:

- the `change-inspector.open` renderer command and top-bar presentation;
- the Workbench right-panel UI, filtering, change summaries, and unified diff rendering;
- the Zod contract used to validate session change observations;
- a read-only capability that projects generic agent-thread artifacts into that contract.

The host remains authoritative for agent-thread history, workspace access, capability
auditing, and resource-change delivery. Hiding the toolbar item or disabling the
renderer contribution never stops host-side session or audit recording.

The package imports only public `@sciforge/domain-sdk` entrypoints. It has no
dependency on host-private main, renderer, or shared source paths.
