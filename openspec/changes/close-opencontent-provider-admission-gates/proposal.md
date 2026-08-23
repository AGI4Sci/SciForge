## Why

At the start of this change, the OpenContent integration treated implemented adapters as production admission even though no operation had been verified through the packaged canonical path, while optional supplier assets still leaked into the public workspace and had multiple source/build resolution paths. This change restores the already-approved fail-closed Content Space and public/private package boundaries before any Project/Task integration proceeds.

## What Changes

- **BREAKING**: downgrade every contract-complete OpenContent operation without a separate production promotion from `production_ready` to `poc_only`, and keep every operation lacking an atomic or immutable Provider contract `blocked_by_contract`.
- **BREAKING**: block native-document `edit` until the Provider supplies and proves an atomic compare-and-mutate precondition; preserve the existing fail-closed `updateFileVersion` implementation.
- Add a trusted verification profile gate that can admit only an exact Provider Instance, full Host Principal/assurance, Broker-authoritative root, operation, audience, and bounded transfer policy through the normal Broker → Content Space → Provider → Connector path. Caller input and ordinary environment/configuration cannot enable it.
- Add Provider-authenticated opaque external binding evidence and Connector session-time revalidation so a reviewed PoC mutation/transfer/administration profile cannot survive Principal or external-account rebind drift.
- Report Provider readiness evidence separately from current invocation admission; renderer controls use admission without presenting PoC evidence as production readiness.
- **BREAKING**: remove Project provisioning from Content Space and the OpenContent Provider entirely: the generic Agent capability, administration operation, intent/report schemas, Provider port, implementation, and tests. A future Project-owning integration requires a separately reviewed authoritative contract.
- **BREAKING**: keep ordinary Administration at ten exact operations but remove the public member-role/ownership delegates and every Administration revision/CAS field. Membership page items are exactly `{ member }`, mutation receipts reuse that reference beside exact root/result fields, the five root/member mutations declare `concurrency.revision: "none"`, and every Administration result is exactly bound to its request and authority.
- Remove private packages from the public root workspace, resolve source assets only from the Host-injected repository root, and replace executable attachment builds with manifest-discovered SciForge-owned static validation outside the public npm graph.
- Restore package ownership so the Connector owns supplier wire/transport/process isolation and the Provider owns receipt-to-Content-Space semantic adapters; remove the standalone OpenContent runtime package rather than adding a third integration owner.
- Add fail-closed public-release and packaged-resource integrity checks so optional supplier assets cannot be published accidentally or executed during install/packaging outside the canonical Connector transport.
- Remove the compiled OpenContent demonstration origin and replace it with one strict package-declared private deployment sidecar; preserve Provider discovery while gating every legal runtime call before storage, credentials, network, or process work when configuration is unavailable.
- Reject disposable Content Space verification-profile packages from official public releases while allowing isolated local packaged acceptance through the canonical production path.
- Align ADRs, capability evidence, runbooks, tests, and generated capability documentation with the final design.

## Capabilities

### New Capabilities

- `internal-runtime-distribution`: Generic isolation, integrity, static validation, packaging, and public-release rules for optional internal runtime overlays.

### Modified Capabilities

- `content-space`: Adds the trusted verification-profile admission gate and removes the unused Project provisioning surface instead of retaining a second external-write path without an installed owner.
- `opencontent-connector`: Owns the single typed supplier execution transport, restricts optional supplier-asset resolution to one source path and one packaged path, freezes the 86-command inventory separately from the 50-command admitted union, and exposes only a token-free main contract to the Provider.
- `opencontent-content-space-provider`: Owns supplier receipt semantics, declares the exact 50-operation extended catalog with a 40 PoC / 10 blocked overlay split and a 1 PoC / 49 blocked no-overlay split, removes the unused Project provisioning implementation, and corrects atomic mutation and immutable artifact requirements.

## Impact

- Affects Content Space contracts/service/capability registration, the OpenContent Provider and Connector ownership boundary, internal overlay packaging and release scripts, capability governance, ADRs, and operator documentation.
- Ordinary product callers will see non-production operations as unavailable unless a reviewed verification profile admits one exact `poc_only` invocation; only a separately reviewed evidence-backed code and documentation change can promote that operation.
- Does not add Project Content Space Binding, Task file intents, a Task port, Shared Documents, or any A/B/C/E compatibility layer.
