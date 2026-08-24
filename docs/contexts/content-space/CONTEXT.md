# Content Space

Content Space is the SciForge bounded context for provider-hosted directories, ordinary files, fixed provider-backed artifacts, and Provider-declared native document operations. It remains separate from the deferred provider-neutral Shared Documents domain and from the SciForge Workspace filesystem.

## Language

**Content Space**:
The provider-neutral SciForge capability for selecting provider-backed space, navigating directories, transferring ordinary files, producing fixed resource references, and invoking supported provider-native document operations.
_Avoid_: Shared Documents, Workspace, Project state store, OpenContent drive

**ContentSpaceProvider**:
The Content Space-owned Provider SPI for container discovery, directory navigation, ordinary-file transfer, version observation, portal targets, and separately declared provider-native capability families.
_Avoid_: universal Provider, DocumentProvider, storage SDK

**Content Space Provider Integration**:
A Provider Integration that implements ContentSpaceProvider for one Provider Kind without becoming part of the Content Space domain language.
_Avoid_: Content Space fork, Host storage backend, provider-specific UI

**Content Container**:
A provider-owned space, library, or directory selected as an explicit target for ordinary-file operations.
_Avoid_: Content Space bounded context, Workspace directory, Project

**Shared Content Container**:
A Content Container whose Provider-native access model permits an explicit multi-user association. OpenContent calls its current shared-root construct a Team, but that vendor term is not provider-neutral domain language.
_Avoid_: Content Space, Collaboration Project, universal Team

**Provider Directory Principal Reference**:
A non-secret typed reference to one user, department, position, or group in a specific Provider Instance directory. It contains only `providerInstanceRef`, a closed principal kind, and the Provider-owned opaque `principalId`; display metadata, Host Principal identity, local Connection identity, endpoint, and credentials are not part of the reference or its authority. Any operation that issues such references must prove a kind-specific summary/page/result (`user`, `department`, `position`, or `group`) and reject mixed-kind items. A current-user reference may instead come from an exact canonical identity in the Connector-revalidated current Provider session; it never comes from first-defined supplier aliases or an untyped account DTO.
_Avoid_: SciForge user ID, OpenContent token, local account selector, portable authorization

**Shared Content Container Member**:
A Provider directory `user` reference associated with one exact shared Content Container. Ordinary member add, list, and remove operations use this reference end to end and require the member and root to name the same Provider Instance. Administration v3 membership page items are exactly `{ member }`, while mutation receipts reuse that same reference alongside the exact root/result fields; neither exposes a member role or Administration revision, and the five root/member mutations declare no optimistic-concurrency revision. A listed member reference is reusable by the same canonical mutation contracts, but the reference itself grants no root, account, or Provider authority.
_Avoid_: Project Member, Host `contentUserId`, email-as-identity, raw Provider account DTO, role-bearing member DTO

**Content Container Scope**:
The provider-neutral classification `personal` or `shared` describing whether a Content Container is private to the enrolled External Account or eligible for an explicit multi-user association. Scope is descriptive and never substitutes for Provider authorization.
_Avoid_: OpenContent Team type, Project membership, ACL

**Content Container Reference**:
A non-secret typed reference to a Content Container, containing only a Provider Instance Reference and stable provider container identity. Cloud Collaboration may own a Project Content Space Binding to it; Content Space does not own Project state.
_Avoid_: endpoint, path as authority, local connection, Project ID

**Provider-Native Document**:
An editable document type whose specialized creation, reading, or change operations are supplied by the selected ContentSpaceProvider. It remains a Content Space resource and does not instantiate a provider-neutral Shared Document or DocumentProvider.
_Avoid_: provider-neutral Shared Document, ordinary byte-only file, Workspace document

**Provider-Native Document Capability**:
A trusted ContentSpaceProvider declaration that contributes a supported native-document operation family to Content Space composition. Every invocation still requires separate admission; an absent or blocked capability never falls back to another Provider or a Host/vendor branch.
_Avoid_: manual feature toggle, default Provider, DocumentProvider adapter, OpenContent hard-coding in Host Core

**ContentFileReference**:
A live reference to an ordinary provider file without a guarantee that its current version is immutable. It remains distinct from an ArtifactReference until the Provider proves an immutable, retained, version-specifically retrievable result.
_Avoid_: fixed ArtifactReference, Shared Document, Workspace file

**ArtifactReference**:
A fixed provider-backed result identity containing a Provider Instance Reference, provider resource identity, and provider-guaranteed immutable version identity, with an optional non-content digest. It may be issued only when version immutability, retention, and version-specific retrieval are formally supported.
_Avoid_: current file ID only, live Document Reference, mutable latest version

**Task Artifact**:
An ordinary provider-backed file associated with a task as a fixed result rather than an ongoing collaborative document. Its business association belongs to the consuming task or record context, while its bytes remain in the provider.
_Avoid_: Shared Document, Document Reference Association, Workspace output mirror

**Task Artifact Association**:
A Cloud Collaboration association from a completed task result or record to an ArtifactReference. Content Space produces and resolves the reference but imports no Task or Project type.
_Avoid_: Content Space owns Task, live Document Reference as fixed output

**Display Label**:
A Human-approved non-authoritative label stored with a consuming association. It is not the current provider filename or path and is not refreshed after provider access becomes unavailable.
_Avoid_: authoritative provider metadata, ACL hint

**Content Space Capability Readiness**:
A descriptive per-operation evidence state of `poc_only`, `blocked_by_contract`, or `production_ready`. Composition, resource authority, and a successful verification invocation never promote it.
_Avoid_: environment flag as production approval, partial means complete

**Content Space Invocation Admission**:
The decision whether one exact operation may execute now for the current Principal, authority, audience, platform, resource capability, transfer limits, and trusted verification evidence. Admission never rewrites readiness, and `blocked_by_contract` is never admissible.
_Avoid_: readiness promotion, package presence, global feature enablement

**Trusted Content Space Verification Policy**:
A trusted set of static profiles that may admit one exact `poc_only` invocation by matching its Provider Instance, complete Host Principal and assurance, authority, operation, audience, bounded transfer maxima, validity window, and any required Provider Binding Attestation. It narrows authority for that invocation and can never admit `blocked_by_contract` or be selected or widened by the caller.
_Avoid_: development mode bypass, caller-selected profile, Provider-specific Host switch, bulk promotion

**Broker Resource**:
A process-local executable resource bound to one caller, current Principal, audience, and exact Content Space authority. It is issued only after Human selection or portable-reference reauthorization and is never interchangeable with a raw Provider ID or portable reference.
_Avoid_: portable authority, raw GUID, Connection, reusable provider-wide grant

**Agent Root Candidate**:
A bounded, non-authorizing projection of one trusted Provider Instance, `personal | shared` scope, Human-visible `libraryLabel`, and optional opaque page cursor. It lets a Personal Session ask the Human to select an exact root without exposing or accepting a Provider folder identity, and it never substitutes for confirmed root authorization.
_Avoid_: Content Container Reference, Provider Instance display label, folder ID/GUID, Team ID, authorization cache

**Agent Content Space Scope**:
The Content Space authority available to an Agent execution context. A Personal Session obtains an installed Provider Instance from native Broker discovery and supplies `personal | shared` scope. If the Human has not supplied an exact library label, the Agent may page through label-only Agent Root Candidates; zero or multiple distinct choices require Human clarification and are never guessed, while canonically duplicate labels remain unavailable until the Provider-side ambiguity is resolved. Root authorization remains separately confirmed and resolves exactly one live match from the complete current container listing while rejecting raw Provider folder identities. Host then issues only a bounded caller/Principal/Workspace-bound Broker resource, and descendants arise only by listing an authorized directory. That delegated resource is sufficient authority for an invocation-admitted non-destructive ordinary content write without confirmation of every invocation; it is neither standing root-administration authority nor destructive-operation approval. `updateSpace`, `pinSpace`, `unpinSpace`, `addMember`, `removeMember`, and every native-document or extended destructive operation each require fresh per-invocation confirmation. An ordinary child, feature-selection, or Provider-administration resource cannot substitute for that confirmation. The delegation never authorizes an implicit overwrite. A Project Task's authority is limited to its Project Content Directory and descendants even when the executing owner's Provider access is broader.
_Avoid_: all resources visible to the Token, task-supplied connection, Project-wide Provider account

**Project System Content Transfer**:
A system-only, execution-bound download or upload-new between one authorized Project content resource and the current Task Workspace through the canonical Content Space path. It is not an Agent-discovered global capability, Provider shortcut, sync, mount, or Project-owned credential.
_Avoid_: mock file handoff, renderer IPC transfer, Workspace sync, Provider client call

**Content Resource Containment Observation**:
Provider metadata evidence that one resource identity is located under an exact authorized root. It proves locator and ancestry only and never proves that the current Provider account may read or write the resource.
_Avoid_: ACL check, DownloadCheck, Project membership, access token

**Operation-Time Provider Authorization**:
The Provider's real read check or write operation evaluated under the executing node owner's current Provider Connection immediately before the protected effect. A prior binding, member observation or metadata result cannot replace it.
_Avoid_: metadata visibility, cached ACL, Cloud permission, provisioning attestation

**Content Transfer Receipt**:
A non-secret result binding one transfer invocation to its Principal/execution context, exact Provider resource, byte count, digest, and observation outcome. It is evidence for integrity and recovery, not a reusable capability or credential.
_Avoid_: transfer handle, download URL, Provider Token, Task authority

**Delegated Resource Write Authority**:
The authority carried by an exact caller/Principal/Workspace-bound Broker resource after its root or parent has been authorized. A declared non-destructive ordinary content write still requires separate invocation admission; root-administration mutations and every destructive content operation require fresh Human confirmation and do not inherit this delegation. The resource cannot change Provider, escape to a sibling or ancestor, synthesize a resource identity, or authorize a destructive target by itself.
_Avoid_: global write grant, raw GUID authority, prompt-derived target, unbounded destructive access

**Feature Selection Resource**:
A short-lived Broker resource for one strictly parsed multi-resource Content Space operation. It binds the operation, canonical request digest, exact primary, and every already delegated constituent resource; changing the operation, array order, reference set, caller, Principal, Workspace, root, or a constituent's live record invalidates it. A direct resource never gains ambient sibling authority, and a Content Container root may be used as a destination but cannot be renamed, moved, copied, shortcut, deleted, property-edited, or permission-edited through ordinary entry operations.
_Avoid_: same-root ambient authority, raw reference batch, reusable provider-wide grant, root deletion

**No Implicit Overwrite**:
The rule that delegated write authority never turns a name collision, stale observation, or existing destination into permission to replace content. Creation and transfer fail closed on collision, while an intentional update must identify the already-authorized resource and satisfy its declared concurrency precondition.
_Avoid_: overwrite by default, last-write-wins, create-or-replace fallback

**Workspace Content Transfer**:
A bounded upload from or download to the current execution context's authorized Workspace using a one-shot Host transfer and an authorized Provider resource. Agent contracts accept only a validated Workspace-relative path and never expose or accept a Host transfer handle; the Host opens the bounded source or no-overwrite destination and the Provider receives only a managed byte port. Once the invocation is admitted against that resource, no additional Provider-write confirmation is required; destinations remain no-overwrite, and the transfer creates no synchronization, mirror, mount, ownership transfer, or cascading-deletion relationship.
_Avoid_: Content Space sync, Workspace projection, provider mount, overwrite transfer

**Principal Lease Revalidation**:
The rule that one Content Space invocation remains bound to the same current Principal for its lifetime and revalidates that identity before every external effect. The lease cannot be replaced by a caller assertion, retained after the invocation, or serialized as a credential.
_Avoid_: login-time-only check, cached Principal assertion, retained session capability, Provider-supplied guard

**Provider Content Authority**:
The rule that the provider remains the sole source of stored file bytes, provider-native document state, versions, directory state, and access control. SciForge keeps typed references and necessary status, not a second provider file or document store.
_Avoid_: Workspace mirror, SciForge ACL shadow, bidirectional file sync
