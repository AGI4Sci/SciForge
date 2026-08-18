## Why

SciForge now has one generic owner-scoped `DomainMainPackageSecretStoreHost` backed by Electron OS encryption and issued through generated package composition. That canonical primitive does not yet provide the provider-credential contract required by ADR 0006: exact node/Principal/Provider Instance/connection binding, bounded use, assurance policy, lifecycle-safe rotation/deletion, or managed active/recent-secret redaction. OpenContent and future provider integrations must harden and reuse this path rather than invent provider-specific stores, a second vault, or IPC.

## What Changes

- Extend the existing generic main-only, OS-backed package secret path into the canonical secure provider-credential facility; do not add a parallel store or facade.
- Bind credential ownership to the package identity supplied by trusted composition, never to caller-controlled owner input.
- Bind each credential record to the execution node, Host-asserted Human Principal, Provider Instance, and local connection identity.
- Separate secret records from non-secret connection metadata and public status.
- Define atomic replacement, bounded use, deletion, logout/revocation reporting, lifecycle states, and managed secret redaction.
- Prohibit credentials in renderer state, Agent capability traffic, logs, traces, public/caller-controlled/durable URLs, Workspace, Project, Task, cross-node messages, plaintext settings, and package-private fallback stores. Permit only a verified provider-mandated outbound HTTPS query serialized and immediately sent inside the owning Connector's bounded main-process use to a pinned target with redirects disabled.

## Capabilities

### New Capabilities

- `secure-provider-credentials`: Generic composition-bound credential ownership, OS secure storage, principal binding, lifecycle, redaction, and fail-closed behavior.

### Modified Capabilities

None.

## Impact

- Evolves the existing public Domain Main Host/package-storage contract with the smallest provider-credential bindings and bounded-use semantics.
- Requires a stable Host Human Principal at the assurance level demanded by each provider policy. Under ADR-0026, `local-selection` may own a separately authenticated node-local OpenContent connection but never proves the external account identity.
- Requires a real Electron source-development lifecycle on the current supported development platform plus automated cross-platform backend-policy and fail-closed tests. Installed/distribution package acceptance is outside this open-source development change.
- Provides a prerequisite for `add-opencontent-connector` without exposing OpenContent-specific types in Host core.
