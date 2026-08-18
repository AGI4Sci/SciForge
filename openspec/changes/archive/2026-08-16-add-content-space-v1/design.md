## Context

Ordinary file/artifact semantics remain separate from collaborative-document revisions/edits; portable identity remains separate from local Broker authority; and ContentSpaceProvider remains separate from DocumentProvider. The latest GUI baseline supplies generic manifests/generated composition, main runtime lifecycle, Capability Broker governance, renderer contribution host, and resource navigation that this change must extend rather than replace.

## Goals / Non-Goals

**Goals:**

- Deliver a cohesive provider-neutral Content Space domain and local mock Provider.
- Keep one governed production path for UI, Agent, and system callers.
- Support bounded browse, create-folder, upload-new, download, safe portal, and portable references.
- Reauthorize the current Host Principal and pin every operation to one trusted Provider Instance.
- Keep live mutable files distinct from immutable Artifacts.

**Non-Goals:**

- OpenContent HTTP/API, login, Tokens, secure credential storage, Connector, or Provider adapter.
- Shared Documents, document launch/edit, Portable Resource Open Routing, or cloud collaboration.
- Overwrite/update/move/rename/delete/share/ACL/member/rollback or cross-provider migration.
- Provider-specific renderer code, MIME/extension routing, default Provider, compatibility alias, or fallback.

## Decisions

### Package owns backend, renderer, and public contract

`content-space` publishes strict process-separated entrypoints and standard manifest contributions. Main lifecycle code builds the catalog/service/capabilities after all main extensions are projected. Renderer exposes stable generic commands and workbench placement and calls only the public Broker capability client. `content-space-mock-provider` uses the same factory/directory path as any future Provider.

### Follow one canonical operation path

All callers traverse Capability Broker, Content Space handler, ContentSpaceService, Provider Instance Directory, ContentSpaceProviderCatalog, and the pinned Provider. Host injects Principal; for writes, the Broker admits and binds the logical invocation ID outside Content Space business input. The domain does not expose a Provider, Connector, raw IPC/MCP, or alternate service.

### Keep PoC eligibility separate from execution authority

Every Provider operation reports `blocked_by_contract`, `poc_only`, or `production_ready`. Content Space V1's normal product path executes only `production_ready`. A future PoC must add a separately reviewed trusted policy/audience Gate to service composition before exact `poc_only` operations can execute; Provider, caller, renderer, and ordinary configuration cannot add that authority.

### Own exact portable kinds and resolver

Content Space owns Container, File, and Artifact identity schemas, codecs, safe export projections, and the one resolver bound to those kinds. The resolver uses the same directory/catalog/service path and current Principal. A later OpenContent Connector does not contribute a competing Content Space resolver; its adapter only implements the Provider contract.

### Treat writes as non-idempotent unless proven

Create-folder and upload-new require explicit authorized parent, bounded input, cancellation, and one Broker-admitted invocation identity outside the business payload. Collision returns typed conflict. Timeout, cancellation, or session loss that cannot prove outcome returns `outcome_unknown`; no blind retry or overwrite is performed.

### Keep transfer and navigation authority in Host

Download writes only to a Host-selected destination through an opaque handle and main-process transfer path. After Content Space rejects non-HTTPS, userinfo-bearing, fragment-bearing, oversized, or invalid-lifetime Provider targets, Host retains the exact target only in main process and returns a bounded single-use handle bound to package owner, caller, Principal lease, target, and expiry; opening reauthorizes.

### Gate immutable artifacts on exact proof

ArtifactReference needs immutable version identity, retention, version-specific retrieval, and proof matching exact Provider Instance, file, and immutable version both at issue and materialization. When the reference carries a digest, the current proof must match it exactly. Upload receipt, mutable latest, optional version, or digest alone is insufficient.

## Risks / Trade-offs

- **Stale UI requests overwrite current state** is closed by AbortSignal propagation and cancellation when selection changes.
- **Provider returns cross-instance or cross-target data** is closed by service validation against pinned instance, target, and invocation.
- **Typed Provider errors collapse at Broker** is closed by bounded domain result contracts.
- **Portal or transfer leaks local/secret authority** is closed by opaque Host-owned handles and current-Principal reauthorization.
- **Artifact proof is replayed** is closed by exact instance/file/immutable-version binding, optional-digest matching, and materialization-time revalidation.
- **PoC evidence silently enables product access** is closed by requiring a separate trusted service policy/audience Gate.
- **Generic Host becomes domain-aware** is closed by standard contribution hosts/ports and boundary scans.

## Migration Plan

1. Establish the Principal, Portable References, and Provider Composition foundations on the latest GUI architecture.
2. Add contracts, service, catalog, codecs/resolver, mock Provider, and capability handlers.
3. Add the provider-neutral renderer through current commands/workbench contributions.
4. Regenerate manifests/composition and validate source/packaged discovery.
5. Verify governance, boundaries, cancellation, write uncertainty, portal/transfer safety, no fallback, and full regression before archiving.
