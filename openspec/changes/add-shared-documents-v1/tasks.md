## 0. ADR 0025 Deferral Gate

- [ ] 0.1 Do not start implementation until the complete Content Space → Secure Provider Credentials → OpenContent Connector Content Space port → OpenContent ContentSpaceProvider → cloud-space PoC sequence is complete and a new review explicitly opens Shared Documents work.

## 1. Dependency Baselines

- [ ] 1.1 Complete/archive `add-portable-resource-references`, `add-provider-composition`, and the required Capability Broker, restricted-trace, Host principal, and generic confirmation baselines.
- [ ] 1.2 Scaffold the trusted compile-time Shared Documents package with strict manifest, definition/main/minimal renderer exports, tests/typecheck, lazy activation, and no Workspace Server/sidecar/editor.
- [ ] 1.3 Define provider-neutral DocumentReference, readiness, AuthoritativeRevision, structured snapshot, frozen operation, prepared handle, confirmation, receipt, and closed error schemas/codecs.
- [ ] 1.4 Define DocumentProvider and consume only `main.document-provider-factory` contributions through a domain-owned catalog.

## 2. Mock and Domain Governance

- [ ] 2.1 Add mock-backed capability discovery, reference observation, safe launch, structured read, create/change validation/apply, conflict, durable idempotency/status, and bounded audit behavior.
- [ ] 2.2 Route UI/Agent/system callers through one Broker/domain service path and the pinned Provider Instance; expose no Provider factory, Connector, raw Client, endpoint, credential, private API, or alternate writer.
- [ ] 2.3 Implement short-lived node-local prepared handles bound to principal, actor, target, exact revision/precondition, frozen typed operations, preview, digest, and expiry; keep prepare non-mutating.
- [ ] 2.4 Add mock tests for operation-specific confirmation, stale conflict, zero partial effect, replay, lost response, outcome recovery, revocation, unsupported nodes, and no apply-time replanning.

## 3. Safe Launch and Renderer Boundary

- [ ] 3.1 Add only generic Shared Document reference/launch commands and localization; add no editor, Provider-specific panel, Browser Preview integration, iframe, webview, or raw URL handling.
- [ ] 3.2 Resolve DocumentLaunchTarget as a short-lived opaque main-validated handle and open only through the canonical external-browser path.
- [ ] 3.3 Add negative tests for wrong Provider/instance/resource, unsafe redirect/origin, credentials, tampered/replayed/expired handle, subject mismatch, and fallback.

## 4. Privacy and Architecture Boundaries

- [ ] 4.1 Declare document bodies, snippets, names/paths, snapshots, semantic payloads, and approval previews restricted before first durable capture; allow only bounded reference/digest/revision/result/audit projections.
- [ ] 4.2 Keep Agent body operations unavailable until canonical Broker/Full Trace lineage and model-egress Gates pass end to end.
- [ ] 4.3 Add package-boundary tests forbidding Content Space, vendor DTOs, integration packages, Cloud Collaboration, Project, Task, Coordinator, Workspace, Host-private imports, raw CRDT, whole-file fallback, DOM automation, and Provider-specific Agent tools/IPC/MCP.
- [ ] 4.4 Reject DocumentReference in completed Task artifact associations, automatic Provider fallback, extension-based capability inference, and cross-provider identity reuse.

## 5. Verification

- [ ] 5.1 Run package tests/typecheck, Provider catalog tests, codec/materialization tests, generated composition freshness, capability governance, package boundaries, and changed-file lint.
- [ ] 5.2 Run mock end-to-end read R1 → external Human edit R2 → stale conflict → re-read/reprepare/reconfirm → success R3, plus duplicate apply and lost-response recovery.
- [ ] 5.3 Run full regression plus source and packaged application smoke/security tests before enabling any real Provider operation.
