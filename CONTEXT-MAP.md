# SciForge Context Map

> Current-state audit: 2026-08-24. This map distinguishes implemented authority, the frozen full-collaboration target, current provider-native capabilities, and deferred provider-neutral targets. It is not a catalog of every SciForge domain or integration package.

## Identity and Access

Owns the desktop Host's current Human Principal and assurance, system-browser OIDC/PKCE session, canonical Cloud User lookup, Desktop Device enrollment/revalidation, Device signing boundary, Agent credential bootstrap/custody, and token-free User/Agent authenticated Cloud transport. OIDC tokens, Device private keys, and Agent credential material remain inside Identity's private native-storage and network boundary; consumer packages receive only non-secret status and strict token-free operations. Local Account selection with `local-selection` assurance remains available for offline work, while cross-user authority requires an OIDC-backed `cloud-authenticated` Principal on an `ACTIVE` Device. External service accounts never become SciForge identity merely because attributes such as email addresses match.

Glossary: `docs/contexts/identity-access/CONTEXT.md`

## Cloud Collaboration

Owns canonical collaboration Users created only through OIDC JIT, Human Endpoint Bindings, Agent ownership and credential lifecycle/generation facts, presence and Worker availability, personal Session projections, multi-user Projects, Project Membership, the one current Coordinator Agent, Tasks and fenced executions, Project Records, durable inboxes, receipts, Project Content provisioning intent, content readiness and Project Content Space Binding. It never owns or returns replayable Agent credential material. Pairing binds only a communication endpoint for an already authenticated User; it never creates an account or grants a Project role.

Two independently ownable domain packages implement this context in Desktop. `domain-collaboration` owns Runtime configuration, Agent/presence status projection, durable Inbox/outbox and local Worker execution, while consuming only Identity-owned token-free Agent operations; `domain-project-coordinator` owns plan, Worker selection, Task/review and provisioning/recovery HCI. Identity UI and Agent credential custody remain in `identity-access`, and both collaboration packages compose through standard manifests rather than a Host feature map.

Glossary: `docs/contexts/cloud-collaboration/CONTEXT.md`

Current product narrative: `docs/SciForge_New_Cloudcolab.md`. The same-named root document is the superseded ADR-0020-era baseline and is historical only.

## Shared Documents

Defines the deferred provider-neutral target for cross-provider collaborative-document identity, structured content operations, authoritative revisions, conditional changes, and browser collaboration. ADR-0030 keeps Shared Documents and DocumentProvider out of the current MDoc delivery: provider-native document operations are activated through Content Space instead.

Glossary: `docs/contexts/shared-documents/CONTEXT.md`

## Content Space

Owns provider-space selection, Content Containers, ordinary-file transfer, fixed provider-backed artifacts, and provider-native document operations declared through the `ContentSpaceProvider` SPI. Provider-declared readiness records evidence, while invocation admission separately evaluates the exact caller, Principal, Broker authority, audience, platform and verification profile; OpenContent is the only current Provider, and Shared Documents does not participate in this delivery.

Glossary: `docs/contexts/content-space/CONTEXT.md`

Architecture and canonical call chain: `docs/content-space-architecture.md`

## Provider Integration Infrastructure

This is shared technical integration infrastructure rather than a business bounded context. It owns provider-neutral instance identity, portable-reference authority resolution, trusted Provider contribution contracts, node-local access bindings, and token-free Provider Binding Attestations. A provider-specific Connector owns one vendor's private endpoint/tenant policy, authentication, credentials, Connection/session state, transport, schema validation, operation-time authorization checks, and immediate pre-dispatch re-attestation. Provider integrations consume only Host-authorized narrow Connector facades; business domains consume only their own Provider SPI and never a vendor Connector directly.

Glossary: `docs/contexts/provider-integration/CONTEXT.md`

## Relationships

- Identity and Access is authoritative for the current Human Principal, OIDC session and ACTIVE Device lease. Cloud Collaboration consumes its token-free authenticated transport and canonical User/Device facts; collaboration packages never receive OIDC Token material.
- Cloud Collaboration creates or finds a canonical User only from a validated OIDC `issuer + subject` through JIT. Pairing, Agent registration, Provider enrollment, email, display name, Local Account and installation ID cannot create or reconcile that User.
- A Desktop creates an Agent only after OIDC User and ACTIVE Device are established and a local Agent Runtime is configured. One Run-0 Desktop Device has at most one active Agent, while the same User may own distinct Agents on multiple Devices; Coordinator and Worker are Project/Task relationships, not account types.
- An External Account Binding associates a SciForge User with an external service account; the external provider remains authoritative for that external account and its provider-native permissions.
- Shared Documents and Content Space remain sibling contexts. The current MDoc capability is provider-native Content Space behavior, while a future provider-neutral Shared Documents domain retains its own public contract, readiness, tests, and replacement path.
- Content Space consumes only the ContentSpaceProvider catalog, including any declared provider-native document capability. The DocumentProvider catalog remains reserved for the deferred Shared Documents domain; an installed Provider that does not declare the Content Space capability neither receives it nor falls back to another Provider.
- Provider Integrations are selected at compile time through manifest/generated composition. Host Core owns only generic contribution catalogs and never routes by provider kind, vendor, resource extension, or domain ID.
- The `Repository architecture principles gate` is a release invariant:不得编辑 central feature map、Host 只能依赖通用 SDK、不得保留兼容 shim/双注册、不得写 showcase/provider/domain 硬编码、backend/UI 同包版本，以及 source/packaged 两条 composition 都必须验证。Missing build/artifact evidence, a `not_run` composition path, or any architecture finding fails the gate and blocks upstream PR preparation.
- When one vendor needs shared authentication or transport, its Provider adapters may consume a provider-specific main-only Connector. The Connector owns no document or file business semantics and is never called directly by Shared Documents, Content Space, renderer, Agent Runtime, or cloud orchestration.
- Provider Binding Attestation is token-free, non-portable evidence for one exact Provider Instance, complete current Principal, opaque external subject, and opaque Connection revision. Admission matches it through the pinned Provider, and the Connector re-attests the actual current session immediately before business dispatch so unbind/rebind drift fails closed. It is distinct from the Device-signed Project Content Provisioning Attestation consumed by Cloud Collaboration.
- Supplier-backed operations remain inside the same Provider and Connector path: the Provider integration owns receipt-to-domain semantics, while the Connector owns the typed supplier protocol, allowlist, asset verification, and bounded process transport. There is no separately versioned integration Runtime package. An optional private supplier overlay changes inventory only; it never becomes a domain package, readiness promotion, Connection, or authorization path.
- A consuming cloud, Project, Task, evidence, or record context owns its business association to a typed resource reference; neither content context imports those consumer models.
- Portable Resource Reference Envelopes are durable, versioned, non-authorizing cross-context values. A receiving full SciForge node validates the registered reference kind, resolves its trusted Provider Instance and current Human Principal's local Provider Connection, reauthorizes with the provider, and only then issues a process-local Broker resource reference.
- Before a file-bearing Project exists, each authenticated User may publish one current, non-secret Provider Directory Principal Fact for an exact Provider Instance from that User's ACTIVE Device. Cloud Collaboration owns the fact's User/Device provenance, readiness and revision, while its embedded Provider Directory Principal Reference remains a non-authorizing Content Space value. Publishing, replacing or degrading this fact never changes Provider ACL or Task authority.
- Cloud Collaboration owns the Project Content Space Binding and is the sole source of Project shared Content Container provisioning intent: its Project Owner selects exact current Provider Directory Principal Fact revisions for the content owner and explicit Project Members. Project creation atomically snapshots those exact facts with Project Membership and the provisioning intent; stale, degraded, cross-User or cross-Provider facts fail closed. The Owner Desktop's `domain-project-coordinator` orchestrates the ordinary Content Space create/member/list operations, and Identity/Host signs the resulting structured facts with the current Device key. Content Space does not import Project, Cloud state or Task authority; Project archival/deletion never deletes the Provider Content Container or its content.
- Cloud Project Membership, Provider Membership observation and Task execution authority are three independent states. Cloud fences Task authority before a member-removal Provider call, never claims an external ACL change from a database write, and keeps pending/degraded reconciliation when Provider truth is unavailable.
- A Personal Session Agent may use only a Human-confirmed, currently enumerable personal or Team root and descendant Broker resources issued by authorized listing. It cannot invoke Human global content capabilities or widen scope with a raw GUID. A Project Task Agent uses only its bound Project Content Directory and descendants through generic system transfer capabilities and the executing node owner's current Provider Connection; the requester cannot select or borrow a connection.
- After the Host delegates an exact Broker resource, an Agent may perform declared non-destructive ordinary content writes without a new Human confirmation for each invocation. The resource fixes the target boundary, but it is neither standing root-administration authority nor destructive-operation approval: `updateSpace`, `pinSpace`, `unpinSpace`, `addMember`, `removeMember`, and every native-document or extended destructive operation each require fresh per-invocation confirmation. An ordinary child, feature-selection, or Provider-administration resource cannot substitute for that confirmation; collisions or stale state fail closed rather than implicitly replacing existing content.
- Agent upload/download crosses the Workspace boundary only through bounded one-shot Host transfers using relative paths inside the execution context's authorized Workspace. Existing Workspace authority and the delegated Provider resource remain mandatory, but the Provider write does not require another per-invocation confirmation; transfer never creates a sync, mount, mirror, overwrite fallback, or cascading-delete relationship.
- Metadata observation proves only a portable resource's identity, ancestry and containment. OpenContent download requires a real `DownloadCheck` before Host opens a destination, and upload requires the real Provider write; a known resource ID or still-visible metadata after member removal is never treated as ACL authority.
- SciForge Workspace is an execution, filesystem, Runtime, and Git boundary. It owns neither Shared Documents nor Content Space resources.
- A Collaboration Project does not own, upload, or grant access to a Workspace. An Agent Host may use a Workspace for a Task only through the Workspace's local authorization path.
- Each selected Provider remains authoritative for its content and provider-native access control. SciForge Project membership never substitutes for Provider authorization.
- A portable reference pins its Provider Instance. Provider failure never triggers automatic fallback, silent copying, or reinterpretation by another Provider; migration is an explicit governed operation that produces a new reference.
- Development-only OpenContent invocations require a trusted static profile that fixes the Provider Instance, complete Principal/assurance, exact authority, operation, audience, enforced transfer maxima, validity window, and any required opaque external binding. A successful admitted invocation remains `poc_only`; production promotion is a separate per-operation evidence decision, and the Provider-specific track may pause without blocking provider-neutral contracts or UI.
