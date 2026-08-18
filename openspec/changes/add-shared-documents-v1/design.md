## Context

ADR 0025 defers this entire domain until the provider-neutral Content Space, Secure Provider Credentials, OpenContent Connector Content Space port, OpenContent ContentSpaceProvider, and separately gated cloud-space PoC milestones are complete. Nothing in this design authorizes adding a Document port or Provider early.

ADR 0007 makes Shared Documents provider-neutral and compile-time composed. ADR 0010 separates collaborative-document semantics from Content Space. ADR 0024 establishes DocumentProvider as a distinct Provider Contract and moves vendor adapters behind generated factory contributions.

See `domain-capability-separation-design.md`, `docs/contexts/shared-documents/CONTEXT.md`, and `openspec/specs/provider-composition/spec.md`.

## Goals / Non-Goals

**Goals:**

- Define stable live-document references, structured observation, revision, prepare-confirm-apply, and launch contracts.
- Keep Provider content/ACL authoritative and every operation on one governed domain path.
- Support replaceable trusted compile-time DocumentProvider integrations.
- Let real operations remain blocked independently while mocks/contracts/UI boundaries progress.

**Non-Goals:**

- Provider authentication, Connector/Client/schema code, vendor Skill acceptance, or vendor evidence.
- A SciForge desktop document editor or Provider-specific renderer UI.
- Ordinary file transfer, fixed Task Artifact, Workspace/Git mirror, CRDT service, or automatic Provider migration.
- Rename, move, delete, share, ACL/member management, comments, annotations, import/export, rollback, or structured Office editing in V1.

## Decisions

### Own the DocumentProvider SPI

Shared Documents exports a strict DocumentProvider contract for capability description, discovery/reference observation, safe launch resolution, structured read, provider-side validation of frozen typed plans, conditional apply, and durable outcome recovery. It consumes only its domain-owned Document Provider catalog and never imports an integration package.

### Keep domain governance above Provider

Shared Documents service owns Broker registration, prepared-handle lifecycle, Human confirmation, restricted trace policy, and provider-neutral receipts/errors. DocumentProvider receives trusted operation context and exact frozen semantic input; it cannot create another approval path, Agent tool, or apply-time replanning path.

### Keep content and revisions provider-authoritative

SciForge stores references and permitted metadata/audit correlation, not an editable body mirror. Every read/apply boundary observes the selected Provider's current authorization and AuthoritativeRevision. A stale operation conflicts rather than merges, rebases, overwrites, or switches Provider.

### Keep editor UI with Provider

Shared Documents renderer offers generic reference/launch commands only. DocumentProvider may resolve an opaque short-lived DocumentLaunchTarget after its deep-link/security Gates pass. The Provider's external Web application owns editing UI; Browser Preview, iframe, webview, or vendor panel is not used.

### Gate operations independently

Discovery, reference resolution, launch, structured read, create, and change are distinct capabilities. Effective readiness is the most restrictive provider/instance/resource/platform/audience state. A filename, demo, or installed package does not imply body capability.

## Risks / Trade-offs

- **[Provider adapter leaks vendor semantics]** → Public schemas and errors remain closed/provider-neutral; package tests forbid DTO/Connector imports.
- **[Mocks are mistaken for readiness]** → Mocks prove contracts only; operation discovery remains governed by trusted readiness.
- **[Provider lacks safe conditional semantics]** → Keep create/change blocked and retain another Provider replacement path.
- **[Live reference becomes fixed artifact]** → Consumer schemas reject DocumentReference for completed Task artifact associations.
- **[Provider outage triggers fallback]** → Preserve pinned identity and return unavailable/human action.

## Migration Plan

1. Complete Portable Resource References, Provider composition, and required Broker/trace/confirmation baselines.
2. Add domain contracts, codec, Document Provider catalog, mock Provider, service, launcher boundary, and negative tests.
3. Integrate DocumentProvider packages independently; none becomes a domain compile-time dependency.
4. Enable discovery, launch, read, create, and change separately only when the selected Provider's exact Gates pass.
5. Remove/disable a Provider through generated composition; existing references fail unavailable and are never reinterpreted.
