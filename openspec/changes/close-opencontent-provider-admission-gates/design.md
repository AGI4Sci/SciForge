## Context

The archived OpenContent Content Space change established separate public Connector, Provider, and SciForge Runtime packages with optional supplier assets under `internal/**`. At change inception, the code violated that target in four places: readiness was used as production dispatch admission without live evidence, private packages still participated in the public npm workspace, source resolution had a second `node_modules` path, and packaging could execute or publicly release installed supplier assets. Content Space already has provider-neutral per-operation readiness and canonical Broker/service/provider routing, so the correction extends those contracts rather than adding a parallel verification path.

## Goals / Non-Goals

**Goals:**

- Make ordinary product execution fail closed while retaining the implemented adapters for exact packaged verification.
- Express verification admission as a generic Content Space policy evaluated inside the canonical service path.
- Restore a reproducible public dependency graph and one asset location per application mode.
- Make internal packaging manifest/receipt-driven, static, and safe for public release workflows.
- Keep Project authority in the future Project-owning context and retain only the provider-neutral dormant provisioning port.

**Non-Goals:**

- Promoting OpenContent operations to production from PoC acceptance alone, or claiming a supplier CAS/version contract that has not been supplied.
- Adding Project Content Space Binding, Task file intents, Task execution injection, Shared Documents, or A/B/C/E compatibility contracts.
- Promoting any OpenContent operation to production or manufacturing an atomic CAS/immutable version contract.

## Decisions

### Keep Provider readiness descriptive and add one generic verification admission policy

OpenContent will keep every implemented, contract-complete operation `poc_only` until a separate production-promotion change; operations with missing safety contracts remain `blocked_by_contract`. Content Space accepts only package-owned static profiles discovered through the public `main.content-space-verification-profile` `main.extension` location. Manifest contract and runtime value use one identical strict shape; zero profiles disables admission, while invalid metadata, drift, or duplicate profile identity fails composition. The Host contains no domain switch or default profile.

The policy receives only the complete Host Principal/assurance, audience, Provider Instance, Broker-authoritative root/target, operation, limits, time, and other trusted execution facts; it can admit only `poc_only`, and cannot change the reported Provider state or admit `blocked_by_contract`. Host assurance is not an external Provider account class. A Connector-backed Provider may contribute a token-free attestation containing the exact Provider Instance and Principal plus an opaque external-subject reference and opaque binding revision. Unsafe profiles must match that attestation exactly. Content Space then carries the matched expectation in the Provider execution context, and the Connector re-observes the current authenticated account and exact revision inside the serialized credential session before any HTTP, Team, transfer, or supplier-runtime business dispatch. Rebind or Principal drift therefore invalidates the profile rather than silently authorizing a new account.

Provider readiness and invocation admission are separate outputs. Readiness remains the evidence state contributed by the Provider. Admission is computed by Content Space for the current Principal, audience, authority, platform gates, and reviewed profile; renderer controls use admission and never rewrite `poc_only` evidence as `production_ready`.

This is preferred over a Provider-specific Host switch, environment flag, test-only service bypass, or temporary `production_ready` value because all callers continue through the same production handler and Provider dispatch.

Live PoC acceptance uses a disposable trusted compile-time profile package in an isolated local build. The profile remains static for that build, is exact per operation/authority/audience, expires within 24 hours, and is never committed or included in a public release. Public release discovery rejects any active verification-profile contribution generically. The packaged business invocation still uses the normal Broker → Content Space → Provider → Connector path; the temporary package supplies evidence policy, not an alternate execution path. A successful packaged invocation adds evidence only for that exact operation and scope; it does not alter readiness or establish a sibling operation.

### Block edit at the Provider readiness boundary and retain adapter code

`edit` joins the existing non-atomic native mutation set. The probe/plan adapter remains implemented and tested, but dispatch stops before the supplier runtime until a Provider-atomic compare-and-mutate contract exists. `updateFileVersion` keeps its source-level unconditional failure and readiness block; stale generated `dist` artifacts are not accepted as alternate runtime implementations.

### Remove generic Agent Project provisioning, not the provider-neutral SPI

The static Agent capability and its generated governance entry are deleted. The Content Space administration contract and optional Provider port remain because a future Project-owned adapter can invoke them with authoritative binding and identity evidence. The unused `coordinatorAgentId` is removed from the provider-neutral intent because it neither authorizes nor affects provisioning.

### Build public runtime inclusion from generic package metadata

Public source-owned main runtime dependencies will be declared by package-owned metadata consumed by the existing generated domain composition/build configuration. Electron Vite derives its no-external/bundle set from that generated data. A hard-coded OpenContent package name in Host configuration is rejected because adding another domain/runtime must not require a central edit.

### Discover internal packages by directory without executing them

Internal composition retains the manifest-discovered package directory for containment and receipt validation, but does not invoke package scripts or attachment entrypoints. The public root no longer lists internal workspaces. Source runtime resolution uses only `Host.getAppRoot()/internal/...` and returns the fixed asset location only after the Connector consumes the shared public verifier's exact overlay identity/root/version receipt and complete inventory proof; packaged resolution uses only after-pack-verified Electron resources.

### Validate internal assets statically and separate public release from internal packaging

Installation records a complete trusted inventory and digest receipt. Build/after-pack validates bytes using SciForge-owned code and never runs supplier entrypoints. Official release scripts assert empty internal composition before signing or upload; direct local/internal packaging may include verified assets for packaged acceptance.

## Risks / Trade-offs

- [PoC operations become unavailable until a policy is installed] → This is intentional fail-closed behavior; add policy tests and keep the default composition empty.
- [Generic verification policy could become an ambient bypass] → Require exact instance, complete Host Principal/assurance, Broker-authoritative root, operation, audience, limits, and expiry; accept only trusted composition and never caller data.
- [A stale profile could authorize a rebound external account] → Match a Provider-authenticated opaque subject/revision and require the Connector to recheck the same expected binding in the current serialized credential session before business dispatch.
- [A local acceptance profile could leak into a public artifact] → Discover profile contributions from canonical manifests and fail every official public release before build/sign/upload and after packaging.
- [Removing root workspaces breaks current internal build commands] → Delete executable attachment builds and replace them with manifest-discovered, SciForge-owned static validation in the same change.
- [Generated bundle metadata can become stale] → Include it in standard generation/checks and assert the main build contains no bare imports for public source runtimes.
- [Existing locally installed overlays may lack complete receipts] → Fail packaging with actionable reinstall guidance; source use may remain available only after the same static validation.

## Migration Plan

1. Add failing readiness, Project capability, source resolver, workspace, public-release, and packaged integrity tests.
2. Apply fail-closed Provider states and remove the generic Project provisioning capability.
3. Add strict package-owned static verification-profile composition with no default profile, Provider-authenticated binding evidence for unsafe PoC operations, and Connector execution-time revalidation.
4. Remove public/internal workspace coupling and make internal build/validation directory-based and static.
5. Generate generic public-runtime bundle metadata, rebuild source and packaged artifacts, and run composition/boundary checks.
6. Align evidence and operator documentation; run disposable packaged PoC acceptance where the reviewed environment evidence permits, while retaining CAS/edit and production promotion as blocked until their stronger contracts exist.

Rollback is a normal commit revert before release. No persisted user data schema changes, remote migrations, or compatibility aliases are introduced.
