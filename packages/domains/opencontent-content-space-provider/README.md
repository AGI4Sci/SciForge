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
The current matrix has zero `live_verified` and zero `production_ready`
operations, and an `implemented` adapter path does not imply Agent eligibility.

- The six ordinary file operations, all ten Team Administration operations,
  ten safely contract-shaped native-document operations, and 53 extended
  operations are `poc_only` / `verification_profile_required` when their
  required runtime is installed. The default product composition cannot
  execute them.
- A separately reviewed package-owned Content Space profile can admit only one
  exact PoC invocation matching the Provider Instance, complete Host Principal
  snapshot and assurance, authority, operation, audience, zero transfer limits,
  and a validity window of at most 24 hours. Host assurance is not an external
  OpenContent account class. The Connector currently supplies no attested
  external account subject or opaque binding revision, so provider-instance
  profiles are limited to the read-only `list-containers` bootstrap and exact
  Broker-bound content-root profiles are limited to reads. Mutation and
  administration profiles remain inadmissible until that attestation exists.
  A profile does not promote readiness and cannot be selected or widened by a
  caller or ordinary configuration.
- `updateFileVersion` is `blocked_by_contract`: the supplier exposes neither an
  exact expected version identity nor an atomic compare-and-update operation.
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

The authoritative operation inventory is
[the OpenContent capability matrix](../../../docs/opencontent-skill-capability-matrix.md).
