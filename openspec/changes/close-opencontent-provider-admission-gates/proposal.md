## Why

At the start of this change, the OpenContent integration treated implemented adapters as production admission even though no operation had been verified through the packaged canonical path, while optional supplier assets still leaked into the public workspace and had multiple source/build resolution paths. This change restores the already-approved fail-closed Content Space and public/private package boundaries before any Project/Task integration proceeds.

## What Changes

- **BREAKING**: downgrade every contract-complete OpenContent operation without a separate production promotion from `production_ready` to `poc_only`, and keep every operation lacking an atomic or immutable Provider contract `blocked_by_contract`.
- **BREAKING**: block native-document `edit` until the Provider supplies and proves an atomic compare-and-mutate precondition; preserve the existing fail-closed `updateFileVersion` implementation.
- Add a trusted verification profile gate that can admit only an exact Provider Instance, full Host Principal/assurance, Broker-authoritative root, operation, audience, and bounded transfer policy through the normal Broker → Content Space → Provider → Connector path. Caller input and ordinary environment/configuration cannot enable it.
- Add Provider-authenticated opaque external binding evidence and Connector session-time revalidation so a reviewed PoC mutation/transfer/administration profile cannot survive Principal or external-account rebind drift.
- Report Provider readiness evidence separately from current invocation admission; renderer controls use admission without presenting PoC evidence as production readiness.
- **BREAKING**: remove the generic `content-space.agent-provision-project` capability while retaining the provider-neutral provisioning port for a future Cloud-owned Project Content Space Binding.
- Remove private packages from the public root workspace, resolve source assets only from the Host-injected repository root, and replace executable attachment builds with manifest-discovered SciForge-owned static validation outside the public npm graph.
- Guarantee public source-owned runtime dependencies are bundled through package-owned/generated composition rather than an OpenContent-specific Host switch.
- Add fail-closed public-release and packaged-resource integrity checks so optional supplier assets cannot be published accidentally or executed during install/packaging outside the canonical Connector transport.
- Reject disposable Content Space verification-profile packages from official public releases while allowing isolated local packaged acceptance through the canonical production path.
- Align ADRs, capability evidence, runbooks, tests, and generated capability documentation with the final design.

## Capabilities

### New Capabilities

- `internal-runtime-distribution`: Generic isolation, integrity, static validation, packaging, and public-release rules for optional internal runtime overlays.

### Modified Capabilities

- `content-space`: Adds the trusted verification-profile admission gate and removes caller-authored Project provisioning authority from generic Agent capabilities.
- `opencontent-connector`: Restricts optional supplier-asset resolution to one source path and one packaged path while keeping the public SciForge runtime in the main bundle.
- `opencontent-content-space-provider`: Corrects operation readiness, atomic mutation, immutable artifact, and Project authority requirements.

## Impact

- Affects Content Space contracts/service/capability registration, the OpenContent Provider and Connector, public runtime bundling, internal overlay packaging and release scripts, capability governance, ADRs, and operator documentation.
- Ordinary product callers will see non-production operations as unavailable unless a reviewed verification profile admits one exact `poc_only` invocation; only a separately reviewed evidence-backed code and documentation change can promote that operation.
- Does not add Project Content Space Binding, Task file intents, a Task port, Shared Documents, or any A/B/C/E compatibility layer.
