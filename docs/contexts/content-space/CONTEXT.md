# Content Space

Content Space is the SciForge bounded context for provider-hosted directories, ordinary files, fixed provider-backed artifacts, and Provider-declared native document operations. It remains separate from the deferred provider-neutral Shared Documents domain and from the SciForge Workspace filesystem.

Current OpenContent composition is not production admission: no operation is live-verified, and the ordinary, administration, and safely contract-shaped native/extended operations remain `poc_only`. Content Space owns a generic trusted verification-policy seam, but the default composition installs no active profile. A package-owned static profile may match only one exact Provider Instance, complete Host Principal snapshot and assurance, authority, operation, audience, zero transfer limits, and validity window of at most 24 hours; caller input and ordinary configuration cannot select or widen it. Host assurance is not an external Provider account class. Because the Connector currently supplies no attested external account subject or opaque binding revision, provider-instance authority is limited to the read-only `list-containers` bootstrap, exact Broker-bound content-root authority is limited to reads, and mutation/administration profiles fail composition. Same-file update and all hash-bound native-document mutations, including native `edit`, are `blocked_by_contract`; immutable-version observation is also blocked, so OpenContent cannot issue an Artifact Reference. Content Space publishes no generic Agent Project-provisioning capability: Provider operation `provision-project` is blocked and the provider-neutral provisioning port remains dormant until Cloud Collaboration supplies an authoritative Project Content Space Binding and verified identities. Cloud Task handoff remains unavailable because Collaboration has not supplied typed Task file intents or exact Task-turn resource injection and retirement, and Content Space exposes no Task-specific port.

## Language

**Content Space**:
The provider-neutral SciForge capability for selecting provider-backed space, navigating directories, transferring ordinary files, producing fixed resource references, and invoking supported provider-native document operations.
_Avoid_: Shared Documents, Workspace, Project state store, OpenContent drive

**ContentSpaceProvider**:
The Content Space-owned Provider Contract for container discovery, directory navigation, ordinary-file transfer, version observation, portal targets, and separately declared provider-native capability families.
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
A shared Content Container selected or provisioned for one Collaboration Project. Cloud Collaboration supplies its desired content owner from the Project Owner and its desired member set from explicit Project Members; Content Space never infers either from an Agent, requester, prompt, or Provider listing. It remains Provider-owned and access-controlled, cannot be bound to a second Project, and is never deleted as a consequence of Project archival or deletion.
_Avoid_: Collaboration Project, Agent-owned Team library, Workspace, synchronized folder

**Provider-Native Document**:
An editable document type whose specialized creation, reading, or change operations are supplied by the selected ContentSpaceProvider. It remains a Content Space resource and does not instantiate a provider-neutral Shared Document or DocumentProvider.
_Avoid_: provider-neutral Shared Document, ordinary byte-only file, Workspace document

**Provider-Native Document Capability**:
A trusted ContentSpaceProvider declaration that contributes a supported native-document operation family to Content Space composition. Every operation remains unavailable until its exact readiness admits the caller; an absent or blocked capability never falls back to another Provider or a Host/vendor branch.
_Avoid_: manual feature toggle, default Provider, DocumentProvider adapter, OpenContent hard-coding in Host Core

**Content File Reference**:
A live reference to an ordinary provider file without a guarantee that its current version is immutable. It remains distinct from an Artifact Reference until the Provider proves an immutable, retained, version-specifically retrievable result.
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
A per-operation state of `poc_only`, `blocked_by_contract`, or `production_ready`. Composition and resource authority do not promote readiness; PoC execution additionally requires an exact trusted Provider Instance, complete Host Principal/assurance, authority, operation, audience, zero-transfer, and validity match.
_Avoid_: environment flag as production approval, partial means complete

**Trusted Content Space Verification Policy**:
A strict aggregation of package-owned static `main.extension` profiles whose manifest and runtime values match exactly. One profile may admit a `poc_only` operation only when the exact Provider Instance, complete Host Principal snapshot and assurance, authority, operation, audience, zero upload/download limits, and validity window of at most 24 hours all match. Host assurance is not an external Provider account class, and the Connector currently supplies no attested external account subject or opaque binding revision. Until it does, provider-instance authority admits only the read-only `list-containers` bootstrap, exact Broker-bound content-root authority admits only reads, and mutation/administration profiles fail composition. The policy narrows one invocation without rewriting Provider readiness and can never admit `blocked_by_contract`; invalid, drifting, or duplicate profiles fail composition, while callers, renderer state, prompts, Tasks, environment variables, package presence, and successful sibling operations cannot install, select, or widen it.
_Avoid_: development mode bypass, caller-selected profile, Provider-specific Host switch, bulk promotion

**Project Content Space Provisioning Port**:
A provider-neutral dormant SPI through which a future Project-owning context may reconcile one Project Content Directory from an authoritative binding and verified identity mappings. It is not an Agent capability and accepts no prompt-authored Project authority.
_Avoid_: Agent self-provisioning, Content Space owns Project membership, provider Team API tool

**Agent Root Candidate**:
A bounded, non-authorizing projection of one trusted Provider Instance, `personal | shared` scope, Human-visible `libraryLabel`, and optional opaque page cursor. It lets a Personal Session ask the Human to select an exact root without exposing or accepting a Provider folder identity, and it never substitutes for confirmed root authorization.
_Avoid_: Content Container Reference, Provider Instance display label, folder ID/GUID, Team ID, authorization cache

**Agent Content Space Scope**:
The Content Space authority available to an Agent execution context. A Personal Session obtains an installed Provider Instance from native Broker discovery and supplies `personal | shared` scope. If the Human has not supplied an exact library label, the Agent may page through label-only Agent Root Candidates; zero or multiple distinct choices require Human clarification and are never guessed, while canonically duplicate labels remain unavailable until the Provider-side ambiguity is resolved. Root authorization remains separately confirmed and resolves exactly one live match from the complete current container listing while rejecting raw Provider folder identities. Host then issues only a bounded caller/Principal/Workspace-bound Broker resource, and descendants arise only by listing an authorized directory. That delegated resource is sufficient authority for a readiness-admitted resource-scoped write without confirmation of every invocation; it never authorizes an implicit overwrite, and a destructive operation must remain separately classified and name the exact authorized target. If Cloud Collaboration gives a Project Task Content Space authority, that authority is limited to its Project Content Directory and descendants even when the executing owner's Provider access is broader.
_Avoid_: all resources visible to the Token, task-supplied connection, Project-wide Provider account

**Delegated Resource Write Authority**:
The authority carried by an exact caller/Principal/Workspace-bound Broker resource after its root or parent has been authorized. It can admit a declared write only when that operation is also ready; it cannot change Provider, escape to a sibling or ancestor, synthesize a resource identity, or broaden a destructive target.
_Avoid_: global write grant, raw GUID authority, prompt-derived target, unbounded destructive access

**Feature Selection Resource**:
A short-lived Broker resource for one strictly parsed multi-resource Content Space operation. It binds the operation, canonical request digest, exact primary, and every already delegated constituent resource; changing the operation, array order, reference set, caller, Principal, Workspace, root, or a constituent's live record invalidates it. A direct resource never gains ambient sibling authority, and a Content Space root may be used as a destination but cannot be renamed, moved, copied, shortcut, deleted, property-edited, or permission-edited through ordinary entry operations.
_Avoid_: same-root ambient authority, raw reference batch, reusable provider-wide grant, root deletion

**No Implicit Overwrite**:
The rule that delegated write authority never turns a name collision, stale observation, or existing destination into permission to replace content. Creation and transfer fail closed on collision, while an intentional update must identify the already-authorized resource and satisfy its declared concurrency precondition.
_Avoid_: overwrite by default, last-write-wins, create-or-replace fallback

**Workspace Content Transfer**:
A bounded upload from or download to the current execution context's authorized Workspace using a one-shot Host transfer and an authorized Provider resource. Agent contracts accept only a validated Workspace-relative path and never expose or accept a Host transfer handle; the Host opens the bounded source or no-overwrite destination and the Provider receives only a managed byte port. Once readiness and that resource admit the operation, no additional Provider-write confirmation is required for the invocation; destinations remain no-overwrite, and the transfer creates no synchronization, mirror, mount, ownership transfer, or cascading-deletion relationship.
_Avoid_: Content Space sync, Workspace projection, provider mount, overwrite transfer

**Principal Lease Revalidation**:
The rule that one Content Space invocation remains bound to the same current Principal for its lifetime and revalidates that identity before every external effect. The lease cannot be replaced by a caller assertion, retained after the invocation, or serialized as a credential.
_Avoid_: login-time-only check, cached Principal assertion, retained session capability, Provider-supplied guard

**Provider Content Authority**:
The rule that the provider remains the sole source of stored file bytes, provider-native document state, versions, directory state, and access control. SciForge keeps typed references and necessary status, not a second provider file or document store.
_Avoid_: Workspace mirror, SciForge ACL shadow, bidirectional file sync
