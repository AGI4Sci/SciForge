# Content Space

> Current-state audit: 2026-08-17. Provider-neutral Content Space V1, portable codecs/resolution, Principal-aware routing, mock Provider, and UI are implemented. OpenContent Change 1 may admit only its reviewed development profile while production remains blocked.

Content Space is the SciForge bounded context for provider-hosted directories, ordinary files, and fixed provider-backed artifacts. It is separate from live collaborative documents and from the SciForge Workspace filesystem.

## Language

**Content Space**:
The provider-neutral SciForge capability for selecting provider-backed space, navigating directories, transferring ordinary files, and producing fixed resource references.
_Avoid_: Shared Documents, Workspace, Project state store, OpenContent drive

**ContentSpaceProvider**:
The Content Space-owned Provider Contract for container discovery, directory navigation, ordinary-file transfer, version observation, and portal targets.
_Avoid_: universal Provider, DocumentProvider, storage SDK

**Content Space Provider Integration**:
A Provider Integration that implements ContentSpaceProvider for one Provider Kind without becoming part of the Content Space domain language.
_Avoid_: Content Space fork, Host storage backend, provider-specific UI

**Content Container**:
A provider-owned space, library, or directory selected as an explicit target for ordinary-file operations.
_Avoid_: Content Space bounded context, Workspace directory, Project

**Content Container Scope**:
The provider-neutral classification `personal` or `shared` describing whether a Content Container is private to the enrolled External Account or eligible for an explicit multi-user association. Scope is descriptive and never substitutes for Provider authorization.
_Avoid_: OpenContent Team type, Project membership, ACL

**Content Container Reference**:
A non-secret typed reference to a Content Container, containing only a Provider Instance Reference and stable provider container identity. Cloud Collaboration may own a Project Content Space Binding to it; Content Space does not own Project state.
_Avoid_: endpoint, path as authority, local connection, Project ID

**Project Content Directory**:
A shared Content Container dedicated to one Collaboration Project and selected by its Project Owner. It remains Provider-owned, cannot be bound to a second Project, and is never deleted as a consequence of Project archival or deletion.
_Avoid_: Collaboration Project, OpenContent Team root, Workspace, synchronized folder

**Content File Reference**:
A live reference to an ordinary provider file without a guarantee that its current version is immutable. A PoC upload result remains a Content File Reference or artifact candidate until the provider's immutable-version contract is proven.
_Avoid_: fixed Artifact Reference, Shared Document, Workspace file

**Artifact Reference**:
A fixed provider-backed result identity containing a Provider Instance Reference, provider resource identity, and provider-guaranteed immutable version identity, with an optional non-content digest. It may be issued only when version immutability, retention, and version-specific retrieval are formally supported.
_Avoid_: current file ID only, live Document Reference, mutable latest version

**Task Artifact**:
An ordinary provider-backed file associated with a task as a fixed result rather than an ongoing collaborative document. Its business association belongs to the consuming task or record context, while its bytes remain in the provider.
_Avoid_: Shared Document, Document Reference Association, Workspace output mirror

**Task Artifact Association**:
A Cloud Collaboration association from a completed task result or record to an Artifact Reference. Content Space produces and resolves the reference but imports no Task or Project type.
_Avoid_: Content Space owns Task, live Document Reference as fixed output

**Display Label**:
A Human-approved non-authoritative label stored with a consuming association. It is not the current provider filename or path and is not refreshed after provider access becomes unavailable.
_Avoid_: authoritative provider metadata, ACL hint

**Content Space Capability Readiness**:
The state `poc_only`, `blocked_by_contract`, or `production_ready` for one operation. PoC-only execution requires a trusted instance/root/account/operation/audience policy and cannot be promoted by Agent, renderer, remote Task, portable input, or untrusted configuration.
_Avoid_: environment flag as production approval, partial means complete

**Agent Content Space Scope**:
The Content Space authority available to an Agent execution context. A Personal Session starts only after Human confirmation of one currently enumerable personal or Team root; Host issues a bounded caller/Principal/Workspace-bound Broker resource, and descendants arise only by listing an authorized directory. A Project Task uses only its Project Content Directory and descendants even when the executing owner's Provider ACL is broader.
_Avoid_: all resources visible to the Token, task-supplied connection, Project-wide Provider account

**Workspace Content Transfer**:
One explicit, approved upload from or download to the current execution context's authorized Workspace using a one-shot Host grant. It creates no synchronization, mirror, mount, ownership transfer, or cascading deletion relationship.
_Avoid_: Content Space sync, Workspace projection, provider mount

**Provider Content Authority**:
The rule that the provider remains the sole source of stored file bytes, versions, directory state, and access control. SciForge keeps typed references and necessary status, not a second provider file store.
_Avoid_: Workspace mirror, SciForge ACL shadow, bidirectional file sync
