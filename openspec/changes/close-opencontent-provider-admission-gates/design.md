## Context

OpenContent integrates through two independently owned public domain packages: the Provider owns receipt-to-Content-Space semantics, and the Connector owns authentication plus typed supplier transport. Optional supplier assets remain runtime data under `internal/**`; they are not a third package owner. At change inception, readiness was used as production dispatch admission without live evidence, private packages still participated in the public npm workspace, source resolution had a second `node_modules` path, and packaging could execute or publicly release installed supplier assets. Content Space already has provider-neutral per-operation readiness and canonical Broker/service/provider routing, so the correction extends those contracts rather than adding a parallel verification path.

## Goals / Non-Goals

**Goals:**

- Make ordinary product execution fail closed while retaining the implemented adapters for exact packaged verification.
- Express verification admission as a generic Content Space policy evaluated inside the canonical service path.
- Restore a reproducible public dependency graph and one asset location per application mode.
- Make internal packaging manifest/receipt-driven, static, and safe for public release workflows.
- Keep Project authority outside the current integration and remove the unused provisioning surface until a Project-owning context proposes an authoritative contract.

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

### Remove unused Project provisioning instead of retaining a second write path

No installed Project-owning consumer invokes this surface, while the OpenContent implementation can directly create Teams and mutate membership outside the ordinary Administration operation contract. The static Agent capability, administration operation, intent/report schemas, optional Provider port, OpenContent implementation, tests, and generated governance entry are therefore deleted together. Content Space validates the Provider administration binding as an exact `{ administration }` object and rejects extra legacy ports before dispatch. A future Project-owned integration must introduce its authoritative binding and identity contract in a separately reviewed change rather than revive the removed path or alias ordinary Team writes.

### Use authoritative Provider directory references for ordinary shared-container membership

The extended catalog contains exactly 50 operations. With a valid overlay, 40 are `poc_only` and 10 are `blocked_by_contract`; without the overlay, only session-backed `getCurrentPrincipal` is `poc_only` and the other 49 are blocked. In catalog order, the blocked set is `resolveInternalLink`, `listMetadataChoices`, `updateFileVersion`, `searchUsers`, `searchDepartments`, `searchPositions`, `searchGroups`, `resolveCollaborationInvitation`, `listKnowledgeCollections`, and `searchKnowledgeCollections`. PDF export remains a native-document export format, and directory enumeration remains ordinary `listEntries`.

Extended contract v2 gives the four provider-neutral directory searches distinct literal-kind summary/page/result schemas. The current OpenContent supplier evidence does not freeze the exact success item or pagination shapes for those searches, so the OpenContent Provider marks all four `blocked_by_contract` and stops before supplier dispatch. The supplier `file-internal-link`, `meta-modeldata`, `collab-link`, and `kbox-list` commands likewise remain inventory-only and outside the admitted union, so their five corresponding extended operations stop before transport. `updateFileVersion` remains blocked by the separate atomic expected-state requirement. Ordinary member add, list, and remove still carry one authoritative same-instance `user` reference through the existing Administration port. `listMembers` may establish that reference from its strict Provider Team-user response. `getCurrentPrincipal` instead uses a narrow package-private semantic port backed by the Connector-revalidated current session's canonical external identity and dispatches no supplier command; a future search may establish references only after its exact raw contract is frozen. Content Space verifies same-instance root/input/output authority, while the Provider integration alone translates the opaque ID behind its token-free Connector boundary. This avoids guessed aliases, requested-kind laundering, a Host-wide cross-user identity map, raw account DTOs, and a second extended-operation invite path.

Ordinary Administration treats every required Team or Team-user enumeration as a fail-closed precondition. Pagination must prove a complete, stable, duplicate-free result before remote mutation; a metadata-free full page or empty page with a continuation signal fails closed. Membership page items are exactly `{ member }`, and mutation receipts reuse that same typed reference alongside their exact root/result fields. The public contract exposes no role mutation or ownership transfer.

OpenContent's typed Team supplier surface exposes no atomic expected-state field. Administration v3 therefore removes `expectedRevision` from `updateSpace`, `pinSpace`, `unpinSpace`, `addMember`, and `removeMember`, removes every Administration result revision, and declares `concurrency.revision: "none"` for those Agent capabilities. Observation and post-write reconciliation prove bounded receipts, not CAS. An ordinary content-root resource is not standing administration approval, so each of those five Agent mutations requires fresh per-invocation Human confirmation before Provider dispatch. Content Space validates exact request-and-authority binding for every one of the ten Administration outputs; a mismatch on a read maps to `provider_unavailable`, while a mismatch after an external write or destructive operation maps to `outcome_unknown`, with no automatic retry.

Delegated Content Space resources authorize non-destructive ordinary writes only. Every native-document or extended operation declared `destructive` requires fresh per-invocation Human confirmation and carries no autonomous-write grant; an ordinary child, feature-selection, or Provider-administration resource cannot substitute for that confirmation. The Broker rejects a missing approval before Provider binding or dispatch while preserving exact-target and no-implicit-overwrite checks after approval.

No Project identity-mapping contract is installed in Content Space or the OpenContent Provider. Ordinary Provider directory search and membership cannot synthesize Project membership or authority; a future Project-owning integration must define that boundary independently.

### Keep supplier execution inside the owning domain packages

The Connector owns the typed supplier protocol, executable allowlist, verified assets, runner, and process isolation. Its pinned snapshot contains 86 inventory commands and exactly 50 admitted commands. The supplier `download`, `file-list`, `kbox-list`, `file-internal-link`, `meta-modeldata`, and `collab-link` commands remain inventory-only and cannot reach the process transport; ordinary download and `listEntries` stay on the typed Connector facade, while PDF export stays on `native-document:export`. The Provider owns the native-document and extended-operation semantic adapters and consumes only the Connector's token-free `./main-contract`. Both packages enter the application through standard manifests and generated composition; the standalone OpenContent runtime package and root-level private deep-import smoke are deleted. A hard-coded OpenContent package name in Host configuration is rejected because adding another domain must not require a central edit.

### Discover internal packages by directory without executing them

Internal composition retains the manifest-discovered package directory for containment and receipt validation, but does not invoke package scripts or attachment entrypoints. The public root no longer lists internal workspaces. Source runtime resolution uses only `Host.getAppRoot()/internal/...` and returns the fixed asset location only after the Connector consumes the shared public verifier's exact overlay identity/root/version receipt and complete inventory proof; packaged resolution uses only after-pack-verified Electron resources.

### Validate internal assets statically and separate public release from internal packaging

Installation records a complete trusted inventory and digest receipt. Build/after-pack validates bytes using SciForge-owned code and never runs supplier entrypoints. Official release scripts assert empty internal composition before signing or upload; direct local/internal packaging may include verified assets for packaged acceptance.

### Resolve deployment origin from one package-owned private sidecar

The Connector package manifest declares a generic deployment-configuration contract with no endpoint literal: contract version `1`, source path `.sciforge/private/deployments/opencontent-connector.json`, packaged Resources path `domain-deployments/opencontent-connector.json`, maximum size `4096`, and `publicRelease: forbidden`. The actual sidecar is strict `{ contractVersion: 1, providerInstanceRef: "opencontent-edoc2-demo", origin }`; the origin is an absolute HTTPS origin without userinfo, path, query, fragment, or extra fields. Activation opens exactly one mode-specific file, requests no-follow semantics when the platform exposes them, and always binds the opened descriptor to the pre-open regular-file identity, size, modification time, change time, and birth time. It reads at most `4097` bytes from that same descriptor, rejects drift in the same fields after the read, closes it, and freezes the strict JSON result. It never falls back between modes or reads environment, argv, caller, renderer, or package settings.

The Connector always registers its Provider Instance, capabilities, and service descriptor. One package-private runtime getter is shared by the connection service and facade. Without valid configuration, every legal bind/status/facade/Team call fails `provider_unavailable` before settings, credentials, network, transfer, or process access; unknown Provider Instances retain their existing higher-priority error. The integration-owned unavailable enrollment view still exposes the existing local unbind only behind explicit Human confirmation, deleting local credentials/settings without a Provider call or remote-file deletion. Valid configuration constructs the single HTTP/Team runtime, and supplier runtime is exposed only when verified assets are also present. A generic metadata-driven packaging composition preserves all manifest declarations and creates an `extraResources` entry plus exact size/digest receipt only for an existing source. Electron Builder captures this immutable composition once and passes it unchanged to the after-pack guard/verifier; active targets must match their receipts and inactive declared targets must be absent. Official public release checks reject each active configuration marked `forbidden`; public npm package files never include it. The isolated packaged target does not collide with or imply the optional supplier overlay.

## Risks / Trade-offs

- [PoC operations become unavailable until a policy is installed] → This is intentional fail-closed behavior; add policy tests and keep the default composition empty.
- [Generic verification policy could become an ambient bypass] → Require exact instance, complete Host Principal/assurance, Broker-authoritative root, operation, audience, limits, and expiry; accept only trusted composition and never caller data.
- [A stale profile could authorize a rebound external account] → Match a Provider-authenticated opaque subject/revision and require the Connector to recheck the same expected binding in the current serialized credential session before business dispatch.
- [A local acceptance profile could leak into a public artifact] → Discover profile contributions from canonical manifests and fail every official public release before build/sign/upload and after packaging.
- [Removing root workspaces breaks current internal build commands] → Delete executable attachment builds and replace them with manifest-discovered, SciForge-owned static validation in the same change.
- [Generated domain composition can become stale] → Include it in standard generation/checks and assert the main build contains no bare imports that bypass public package entrypoints.
- [Existing locally installed overlays may lack complete receipts] → Fail packaging with actionable reinstall guidance; source use may remain available only after the same static validation.
- [A private deployment origin could be compiled, overridden, or leak into public output] → Keep metadata endpoint-free, accept one strict fixed-path sidecar, gate runtime construction on its validation, digest-check it after pack, and reject it in every official public release path.

## Migration Plan

1. Add failing readiness, Project capability, source resolver, workspace, public-release, and packaged integrity tests.
2. Apply fail-closed Provider states and remove the entire unused Project provisioning surface.
3. Add strict package-owned static verification-profile composition with no default profile, Provider-authenticated binding evidence for unsafe PoC operations, and Connector execution-time revalidation.
4. Remove public/internal workspace coupling and make internal build/validation directory-based and static.
5. Regenerate domain composition, rebuild source and packaged artifacts, and run package-boundary checks proving no standalone runtime or private cross-package import remains.
6. Align evidence and operator documentation; run disposable packaged PoC acceptance where the reviewed environment evidence permits, while retaining same-file CAS/edit and production promotion as blocked until their stronger contracts exist.
7. Delete the compiled demonstration origin, add the strict package-owned deployment resolver and shared runtime gate, and extend generic packaging/public-release verification using only synthetic test roots.

Rollback is a normal commit revert before release. No persisted user data schema changes, remote migrations, or compatibility aliases are introduced.
