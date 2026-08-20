## Why

The OpenContent integration currently treats implemented adapters as production admission even though no operation has been verified through the packaged canonical path, while optional supplier assets still leak into the public workspace and have multiple source/build resolution paths. This change restores the already-approved fail-closed Content Space and public/private package boundaries before any Project/Task integration proceeds.

## What Changes

- **BREAKING**: downgrade every unverified OpenContent operation from `production_ready` to `poc_only`, and keep every operation lacking an atomic or immutable Provider contract `blocked_by_contract`.
- **BREAKING**: block native-document `edit` until the Provider supplies and proves an atomic compare-and-mutate precondition; preserve the existing fail-closed `updateFileVersion` implementation.
- Add a trusted verification profile gate that can admit only an exact Provider Instance, full Host Principal/assurance, Broker-authoritative root, operation, audience, and bounded transfer policy through the normal Broker → Content Space → Provider → Connector path. Caller input and ordinary environment/configuration cannot enable it.
- **BREAKING**: remove the generic `content-space.agent-provision-project` capability while retaining the provider-neutral provisioning port for a future Cloud-owned Project Content Space Binding.
- Remove private packages from the public root workspace, resolve source assets only from the Host-injected repository root, and replace executable attachment builds with manifest-discovered SciForge-owned static validation outside the public npm graph.
- Guarantee public source-owned runtime dependencies are bundled through package-owned/generated composition rather than an OpenContent-specific Host switch.
- Add fail-closed public-release and packaged-resource integrity checks so optional supplier assets cannot be published accidentally or executed during install/packaging outside the canonical Connector transport.
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
- Ordinary product callers will see unverified operations as unavailable until a reviewed verification profile admits an exact test operation or live evidence promotes that operation.
- Does not add Project Content Space Binding, Task file intents, a Task port, Shared Documents, or any A/B/C/E compatibility layer.
