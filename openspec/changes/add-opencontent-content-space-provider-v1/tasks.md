## 1. Package and Predecessors

- [ ] 1.1 Complete/archive Content Space V1, Secure Provider Credentials, and the OpenContent Connector Content Space port; do not require Shared Documents or any Document package.
- [ ] 1.2 Add the optional main-only adapter with standard manifest, exact public exports, lazy factory, package tests/typecheck, and no renderer/Agent/MCP/IPC/sidecar.
- [ ] 1.3 Register exactly one `main.content-space-provider-factory` extension for Provider Kind `opencontent`; add no Document factory, portable codec/resolver, or alias.
- [ ] 1.4 Acquire only the Host-issued owner-scoped Connector facade, reject raw global callable transport and consumer impersonation, and prove factory/catalog construction has no network, credential, login, or remote side effect.

## 2. Strict Mapping and Governance

- [ ] 2.1 Map only pinned validated transport results into bounded Content Space contracts; expose no raw DTO/client/Token/endpoint.
- [ ] 2.2 Bind every result to the exact Connector-contributed Provider Instance, parent/resource, current Principal lease, Broker-admitted write invocation, cancellation state, and readiness.
- [ ] 2.3 Map collision to typed conflict and uncertain completion to `outcome_unknown`; never retry, overwrite, retarget, choose another connection, or fall back.
- [ ] 2.4 Leave Content Space codecs/resolver, Broker capability handlers, Host file destination, portal grants, renderer, and Artifact issuance in their owning layers.

## 3. Evidence-Gated Operations

- [ ] 3.1 Start container selection, listing, create-folder, upload-new, download, portal, observation/materialization, and Artifact proof as `blocked_by_contract`.
- [ ] 3.2 Validate schemas, business outcomes, current authorization, pagination/bounds, progress, cancellation, transfers, portal origins, and session supersession independently.
- [ ] 3.3 Keep ArtifactReference blocked until immutable identity, retention, version-specific retrieval, exact instance/file/version proof, and optional-digest matching pass.
- [ ] 3.4 Keep production metadata/materialization blocked while BOLA or session/tenant isolation evidence is incomplete.

## 4. Verification and PoC Handoff

- [ ] 4.1 Test missing/duplicate/incompatible Provider, unknown instance, wrong Principal/connection, cross-instance result, consumer impersonation, cancellation, collision, uncertainty, token leakage, unsafe portal, and no fallback.
- [ ] 4.2 Run adapter/Connector/catalog/reference tests and typecheck, generator freshness, governance/boundaries, lint, regression, and source/packaged smoke.
- [ ] 4.3 Hand exact proven operations to a separate dedicated-tenant OpenContent cloud-space PoC change that adds the trusted Content Space policy/audience Gate; do not promote from caller/configuration input.
- [ ] 4.4 Prove removing the adapter leaves Content Space mocks/other Providers/UI operational and Shared Documents remains deferred.
