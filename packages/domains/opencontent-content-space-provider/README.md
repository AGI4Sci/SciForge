# OpenContent Content Space Provider

Adapts the OpenContent Connector to Content Space without moving integration ownership into
Content Space.

- The main entry maps the Connector's token-free facade into the provider-neutral
  `ContentSpaceProvider` contract.
- The renderer entry contributes the Connector-owned enrollment fragment to the
  provider-neutral `content-space.provider-enrollment-view` slot.
- The adapter selects by Provider Kind and forwards the exact Provider Instance Ref chosen by
  Content Space. It never receives a token, password, endpoint, or connection ID.

The binding remains owned by the Connector and scoped to the current Local Account, this device,
and the selected Provider Instance. The external OpenContent account is not a SciForge identity.

## Current readiness

Composition of this adapter is not production admission or live verification.
The current matrix has zero `live_verified` operations, and an `implemented`
adapter path does not imply `production_ready` or Agent eligibility.

- `updateFileVersion` is `blocked_by_contract`: the supplier exposes neither an
  exact expected version identity nor an atomic compare-and-update operation.
- Hash-bound native-document mutations are `blocked_by_contract`: a read,
  probe, or plan before the write cannot replace an atomic Provider-side
  `baseHash` comparison performed with the mutation.
- `observeImmutableVersion` is blocked. A file identity, version number, or
  digest does not prove immutable retention and version-specific retrieval, so
  this adapter cannot issue an `ArtifactReference`.
- Project Content Directory provisioning is not Cloud Task handoff. Content
  Space exposes no Task port; Cloud Collaboration must supply the binding,
  typed Task file intents, and exact Task-turn resource injection and
  retirement.

The authoritative operation inventory is
[the OpenContent capability matrix](../../../docs/opencontent-skill-capability-matrix.md).
