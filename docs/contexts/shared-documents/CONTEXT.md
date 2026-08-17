# Shared Documents

> Status: deferred by ADR-0025. This glossary defines a future provider-neutral domain contract and must not be read as an implemented feature or as permission to add a Document port before its predecessors.

Shared Documents is the SciForge bounded context for governed Human and Agent work on provider-hosted collaborative documents. It keeps document authority outside SciForge while giving every full SciForge node one stable, provider-neutral language.

## Language

**Shared Documents**:
The SciForge domain capability for provider-hosted collaborative documents. It is independent of any one provider, Agent Runtime, Workspace, or cloud coordinator.
_Avoid_: OpenContent integration, remote files

**Shared Document**:
An online document whose authoritative content, revisions, collaboration state, and access control are owned by its Document Provider. It is not a Workspace file even when a thread or task refers to it.
_Avoid_: synced file, Git document, remote Workspace file

**Document Provider**:
An external system that owns Shared Documents and presents provider-native collaboration behavior. A provider satisfies Shared Documents semantics without becoming a SciForge core concept.
_Avoid_: Agent Runtime, Workspace Host, cloud coordinator

**DocumentProvider**:
The Shared Documents-owned Provider Contract for live-document discovery, observation, safe launch, structured content, revisions, and conditional semantic operations.
_Avoid_: universal Provider, ContentSpaceProvider, vendor SDK

**Document Provider Integration**:
A Provider Integration that implements DocumentProvider for one Provider Kind without becoming part of the Shared Documents domain language.
_Avoid_: Shared Documents fork, Host document backend, vendor-specific Agent tool

**OpenContent Document Provider**:
The independently pausable V1 Document Provider Integration for OpenContent. It contributes only capabilities whose OpenContent contracts have passed their readiness Gates.
_Avoid_: Shared Documents core, universal document backend, ready-by-default Provider

**Document Reference**:
An opaque, durable identity containing the Provider Instance Reference and provider resource identity for one Shared Document. A reference is portable between SciForge nodes but never carries credentials or grants access by itself.
_Avoid_: filesystem path, browser URL as identity, share token

**Document Container Reference**:
An opaque identity for a provider-owned folder or container that can be the explicit target of a Shared Document creation. It has the same non-authorizing, non-secret identity boundary as a Document Reference but cannot be used where a document is required.
_Avoid_: Workspace folder, implicit default library, filesystem directory

**Document Reference Association**:
An explicit association, owned by a consuming context, between that context and a Document Reference. Shared Documents supplies and resolves the reference but does not own or import the consumer’s Thread, Task, Project, Coordinator, evidence, or record model.
_Avoid_: Document Attachment, Task Artifact, Workspace binding, mounted document, synchronized attachment

**Observed Document Evidence**:
A consuming context's association to a live Document Reference plus the Authoritative Revision observed at the time. The revision is provenance, not part of document identity; reproducible frozen evidence instead uses an Artifact Reference owned by Content Space.
_Avoid_: immutable artifact, revision-pinned Document Reference identity

**Document Authority**:
The rule that the Document Provider is the sole source of editable document content and collaboration state. SciForge retains references and audit correlation, not a second editable document.
_Avoid_: local mirror, bidirectional sync, parallel document database

**Shared Documents Capability Profile**:
The provider-declared set of operations available at a Provider Instance, Document Container, or Shared Document. Catalog search, creation, browser opening, structured reading, and structured editing are distinct capabilities, so one does not imply the others.
_Avoid_: universal document body, extension-only capability inference

**Capability Readiness**:
The explicit operational state of one provider capability: `poc_only`, `blocked_by_contract`, or `production_ready`. A PoC profile can only narrow the canonical path and cannot be promoted by caller input or ordinary configuration.
_Avoid_: feature flag implies readiness, demo means production-ready

**Display Label**:
A Human-approved, non-authoritative label retained by a consuming context to help recognize a reference. It is not provider metadata, must not be refreshed after access is unavailable, and grants no access.
_Avoid_: provider filename authority, provider path, authorization hint

**Authoritative Revision**:
The provider-issued concurrency marker for the exact Shared Document state an Agent observed or intends to change. A stale revision requires re-observation rather than silent overwrite.
_Avoid_: local revision, best-effort overwrite

**Logical Document Change**:
A bounded, previewable document mutation with a stated target and impact.
_Avoid_: background write, raw provider update, whole-file replacement

**Prepared Document Operation**:
A non-mutating proposal to create or change a Shared Document, bound to a target, impact preview, authoritative base revision or creation precondition, and operation digest. It becomes eligible for application only after confirmation by the owning Human Principal and successful revalidation.
_Avoid_: pending write, optimistic mutation, approval token

**Agent Actor**:
An attributable Agent invocation operating under one Human Principal’s current provider permissions.
_Avoid_: administrator Agent, browser-cookie impersonation, unattended delegated writer

**Provider-Native Document UI**:
The provider’s browser experience for editing, comments, annotations, and permission management. SciForge launches this experience but does not recreate it as a Shared Documents editor.
_Avoid_: SciForge document editor, Shared Documents panel

**Document Launch Target**:
A non-secret presentation authority for opening a Shared Document in the Provider-Native Document UI. It is neither document identity nor an access credential.
_Avoid_: raw URL, token-bearing URL, canonical resource ID

**Agent Document Capability**:
A provider-neutral Shared Documents operation exposed through SciForge’s governed capability surface. It is distinct from browser automation and from a provider’s raw or private transport API.
_Avoid_: provider-specific Agent tool, DOM automation, raw provider API

**Governed Execution Node**:
The full SciForge node that actually performs a Shared Documents operation and applies local identity, approval, capability, and audit governance. A remote task trigger does not move that authority to the cloud coordinator.
_Avoid_: credential-forwarding worker, headless Remote Workspace Runtime

**Workspace**:
The SciForge execution, filesystem, Runtime, and Git boundary. It neither contains nor authorizes live Shared Documents.
_Avoid_: Shared Document container, document permission scope
