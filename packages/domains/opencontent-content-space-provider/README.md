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
The authoritative capability matrix records a limited exact packaged-live
ordinary-operation subset; every verified operation remains `poc_only`, no
native-document operation has a live-success claim, and `production_ready`
remains zero. An `implemented` adapter path or successful sibling operation does
not imply Agent eligibility.

- The six ordinary file operations, all ten Team Administration operations,
  ten safely contract-shaped native-document operations, and 53 extended
  operations are `poc_only` / `verification_profile_required` when their
  required runtime is installed. The default product composition cannot
  execute them.
- Provider-declared readiness and current invocation admission remain separate.
  A separately reviewed package-owned Content Space profile can admit only one
  exact PoC invocation matching the Provider Instance, complete Host Principal
  snapshot and assurance, authority, operation, audience, bounded transfer
  maxima, and validity window. Admission does not promote readiness.
- Provider-scoped operations, mutations, Administration, and non-zero transfers
  additionally require a v2 Provider Binding Attestation. This adapter obtains
  the token-free attestation from the Connector, maps it to the provider-neutral
  contract, and passes the exact expectation back through every Connector
  business call. The Connector reauthenticates and recomputes it immediately
  before dispatch, closing the admission-to-dispatch rebind window. Raw external
  account identifiers remain adapter-private.
- `updateFileVersion` is `blocked_by_contract`: the supplier exposes neither an
  exact expected version identity nor an atomic compare-and-update operation.
  A receipt-verified static characterization of pinned attachment `1.0.1` and
  the public offline SDK confirmed that the current request carries no atomic
  expected-state field, returns `FileVerId` only after the operation, uses
  `UPDATE` in the CLI (including an automatic same-name `610` retry), and still
  conflicts with the SDK overview's `UPGRADE` spelling. This negative snapshot
  evidence keeps mutation blocked; it is not a future supplier guarantee or a
  readiness promotion.
- All ten hash-bound native-document mutations, including `edit`, are
  `blocked_by_contract`: a read, probe, plan receipt, write-time re-read, or
  post-write digest cannot replace an atomic Provider-side `baseHash`
  comparison performed with the mutation.
- `observeImmutableVersion` is blocked. A file identity, version number, or
  digest does not prove immutable retention and version-specific retrieval, so
  this adapter cannot issue an `ArtifactReference`.
- The provider-neutral Project Content Space provisioning port remains dormant.
  Its `provision-project` Provider operation is `blocked_by_contract` /
  `provider_contract_missing`. No generic Agent provisioning capability exists;
  a future Project-owning consumer must supply the authoritative binding and
  verified identities.
  Provisioning is not Cloud Task handoff. Content Space exposes no Task port;
  Cloud Collaboration must also supply typed Task file intents and exact
  Task-turn resource injection and retirement.

Agent `createSpace` capability input does not contain an owner. The Content
Space Broker injects the current Principal as `contentOwnerUserId`, and this
adapter permits creation only when that identity maps to the authenticated
current OpenContent session. The created object is a shared Content Container
(an OpenContent Team), not the Content Space bounded context and not a Project
binding.

The authoritative operation inventory is
[the OpenContent capability matrix](../../../docs/opencontent-skill-capability-matrix.md),
and the complete module flow is in the
[Content Space architecture guide](../../../docs/content-space-architecture.md).
