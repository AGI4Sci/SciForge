## Why

SciForge needs durable provider-resource identities that can cross contexts, restarts, and nodes without turning the Capability Broker's process-local `res_*` bindings into persisted authority. The latest Host already owns capability governance and resource lifecycle, so portable identity must integrate with that path rather than recreate it.

## What Changes

- Add an exact, versioned, canonically serialized, bounded, non-secret Portable Resource Reference Envelope.
- Add owner-bound codec and exact authority-resolver contributions through generic `main.extension` locations `main.portable-resource-codec` and `main.portable-authority-resolver`.
- Select a resolver only through the codec's declared resolver binding; reject unknown, duplicate, incompatible, or unrelated contributions before provider work.
- Materialize only under the Host-asserted current Principal, reauthorize the exact logical resource, and issue a fresh process-local resource through the existing Broker.
- Export only through an owner-scoped Host facade and codec-owned safe projection; runtime input cannot select a consumer or owner.
- Bind observations, export state, and retirement to the current principal lease and Broker lifecycle.
- Reject endpoints, credentials, connections, local paths, display metadata, Provider DTOs, polluted prototypes, and runtime handles.

## Capabilities

### New Capabilities

- `portable-resource-references`: Durable non-authorizing envelopes, exact codecs/resolvers, current-Principal materialization, and safe export.

### Modified Capabilities

None.

## Impact

- Extends the public Domain SDK and generic main runtime composition; it does not add a business-resource union.
- Adds one owner-scoped Host service around the existing Capability Broker resource path, not a second Broker, IPC, MCP, registry, or navigation path.
- Content Space owns its own Container, File, and Artifact codecs and resolver; future sibling domains remain independent.
- Source and packaged application composition use the same generated manifests and lifecycle activation.
