# Cloud Collaboration

> Current-state audit: 2026-08-27. The implemented baseline is OIDC/Device-backed and uses User-targeted Task Offers with atomic Device Agent claims.

Cloud Collaboration is the SciForge bounded context for coordinating multiple users and their Agent Hosts through shared Projects. It owns collaborative state while preserving each node's authority over local Workspaces and resources.

## Language

**Collaboration Project**:
A cloud-authoritative unit with one owning SciForge User, explicit members, one current Coordinator Agent, Tasks, and shared Project Records.
_Avoid_: Workspace, Project DAG, shared folder, OpenContent Team

**Project Workbench**:
A renderer surface for selecting, reading, and operating one Collaboration Project. Its selection is independent of the chat Session that hosts the surface and grants no Project, Task, or Provider authority.
_Avoid_: Session binding, Project authority, shared Workspace

**Project Workbench Target**:
The exact `projectId` selected in a Project Workbench and supplied as routing context to a canonical Project Coordinator capability. Each operation still re-reads the current Principal, Project membership, role, revisions, and execution fences before it can read or write.
_Avoid_: display name, Session ID, authorization token, durable Session binding

**Project Owner**:
The SciForge User identified by a Collaboration Project's `ownerUserId`. Every current Coordinator Agent belongs to this User, while Workers may belong to any Project Member; ownership does not imply access to another member's Workspace or external accounts.
_Avoid_: Workspace owner, Coordinator Agent, OpenContent administrator

**Project Member**:
An explicit relationship between a SciForge User and a Collaboration Project carrying that user's Project permissions.
_Avoid_: OpenContent Team member, Workspace collaborator, Agent

**Project Invitation**:
The pre-activation `invited` phase of a Project Membership addressed to one exact OIDC User. It permits that User to inspect and accept the current confirmed Plan, but grants no Task Authority and claims no Provider membership.
_Avoid_: active member, Task Offer, OpenContent Team invitation, unilateral add

**Project Membership State**:
The Cloud lifecycle of one Project relationship: invited, active, pending removal, or removed. It neither reports Provider membership nor grants Task execution by itself.
_Avoid_: Provider ACL, Worker availability, Task authority

**Coordinator Agent**:
The one Project-Owner-owned Agent that prepares plans, creates Tasks, and presents synthesis from Coordinator-approved Claims for one Collaboration Project. It assists the responsible Humans but cannot attest Worker results, approve scientific results, or complete a Project on their behalf.
_Avoid_: Project Owner, Coordinator product, cloud model runtime

**Worker User**:
The SciForge User selected by a Coordinator to receive one Task Offer. The User is the assignment choice; valid registration determines Device coverage; current Runtime availability is advisory execution evidence.
_Avoid_: Worker account type, preselected Agent, Project-wide role

**Task Offer**:
One durable invitation addressed to a Worker User. All active Devices owned by that User eventually receive the same Offer; it remains pending until that User accepts on one Device, explicitly rejects it, the Coordinator withdraws it, the Task is cancelled, a material Contract revision replaces it, or its deadline expires (24h by default, explicitly extendable by the Coordinator).
_Avoid_: Task Execution, per-Device copy, broadcast execution, reusable lease

**Worker Agent**:
The exact Agent/Device Runtime that wins a User-level Task Offer claim and becomes the actor of the resulting Task Execution. Worker is an execution relationship, not a SciForge account, permanent Agent type, or Coordinator selection.
_Avoid_: Worker User, preselected Device, primary Agent

**Worker Availability Projection**:
A time-stamped Cloud view of an Agent/Device's active and online state, heartbeat, Runtime capabilities, active Task count and current Cloud execution readiness. It informs execution readiness but does not decide whether an offline Worker User may receive an Offer or select the winning Device.
_Avoid_: assignment target, scheduler authority, auto-accept policy, Provider ACL

**Task Offer Decision**:
A Worker User's explicit human choice about a User-level Task Offer. Acceptance claims it from the Device where the choice was made, rejection closes the shared Offer, and dismissal only hides that Device's local view.
_Avoid_: automatic acceptance, per-Device assignment, silent claim

**Task Execution**:
One immutable assignment attempt created only when an eligible Device Agent atomically claims a User-level Task Offer. It records the exact User, Device and Agent, is identified by an `executionId`, and is fenced by the current Task revision. Reassignment first creates another User-level Offer; an older execution remains audit evidence but has no write authority.
_Avoid_: retry counter, Agent thread, Task identity, reusable lease

**Task Authority**:
The command-time permission derived from current Project, Membership, Device, Agent, Task and execution-fence facts. It is not stored or inferred as a Provider permission.
_Avoid_: Project Membership alone, Provider ACL, acceptance policy

**Task File Intent**:
A strict non-secret Task description of Project input references, output constraints and the exact execution that may use them. It never selects a Provider Connection, exposes a Host path, or grants access by itself.
_Avoid_: file credential, Workspace mount, Provider request, portable authority

**HumanNeeded**:
A durable execution question addressed to one exact active Project-member SciForge User. A Worker execution addresses its owning Worker User by default; a Coordinator question selects the target member explicitly. It is answered only by that target User's authenticated Human identity, not by a Reviewer system role or another Agent.
_Avoid_: tool approval, broadcast chat, Reviewer role

**Project Record**:
An accepted Project observation, decision, result, or summary with User, Agent, Task, execution and revision provenance. It is not a private Agent transcript, full tool log, credential store, or Provider file copy.
_Avoid_: shared prompt history, Workspace snapshot, Provider content mirror

**Manual Recovery Required**:
The Task/execution state used when a Cloud operation outcome cannot be proven and the original operation must be reconciled against exact object, manifest and receipt facts. It cannot be cleared by an unobserved “mark success” action.
_Avoid_: automatic retry, assumed success, generic failure

**Task Workspace Use**:
The temporary use of a Workspace by an Agent Host while executing a Task after the Workspace's local authorization requirements have been satisfied. The Project neither owns nor uploads the Workspace.
_Avoid_: Project Workspace, cloud mount, automatic synchronization

## Scientific result and review language

**Task Contract**:
The immutable scientific description of one Task revision: its objective, scope, inputs, constraints, acceptance criteria, and required outputs. Clarification and communication do not change the Contract.
_Avoid_: prompt, assignment note, mutable task summary

**Contract Revision**:
The numbered version of a Task Contract that changes the scientific work to be performed. A material change creates a new Offer and requires the responsible Worker to accept that revision.
_Avoid_: result correction, message revision

**Result Bundle**:
One revisioned Worker scientific result containing a summary, Claims, EvidenceRefs, and any recorded interventions. A Bundle is eligible for synthesis only after the required Human review chain has approved it.
_Avoid_: chat transcript, progress update, raw Agent answer

**Claim**:
A material scientific assertion that may be used by synthesis and is supported by one or more validated EvidenceRefs. Claim types describe its scientific role, such as quantitative, method, conclusion, or other.
_Avoid_: sentence, message, model output

**EvidenceRef**:
A reference to exact supporting Cloud object versions or an immutable Delivery/Project manifest, with verifiable digest and lineage. A live file name, current path, or mutable latest version is not an EvidenceRef.
_Avoid_: file hint, download URL, current file reference

**Worker Attestation**:
The responsible Worker User's Human statement that one exact Result Bundle and its digest are scientifically accepted for Coordinator review. An Agent cannot create an Attestation.
_Avoid_: Agent completion, automatic acceptance, Provider ACL observation

**Coordinator Review**:
The Project Owner's Human decision to approve one attested Result Bundle or request a result revision. It is separate from the Coordinator Agent's planning and synthesis work.
_Avoid_: Agent review, Project Record acceptance, final summary

**Approved Claim**:
A Claim from a Worker-attested Bundle that has also passed Coordinator Review. Only Approved Claims enter scientific synthesis.
_Avoid_: preliminary claim, accepted summary, progress fact

**Result Revision**:
An append-only correction to a Result Bundle for the same Task Contract, Execution, and Worker. It does not require Contract re-acceptance, and it never rewrites an earlier Bundle, Review, or Attestation.
_Avoid_: Contract Revision, reassignment, mutable edit

**Scientific Synthesis**:
A derived Project view or Agent operation whose input is limited to Approved Claims and their permitted provenance. Draft results, progress, messages, raw chats, and revision-requested Bundles are outside its authority.
_Avoid_: context dump, final chat message, unrestricted Project history

## File authority boundary

Collaboration has no OpenContent or Content Space dependency. SharedMaterial revisions, Task input references, Delivery manifests and Project Results use the same PostgreSQL + MinIO/S3 object authority. Project creation, membership and execution never require Provider provisioning, a Team root, Provider ACLs or Provider readiness. Removed Provider concepts may appear only in authorized read-only historical records; they do not authorize new commands or resume old external operations. See the Owner clarification in OpenSpec `align-conversational-collaboration-mvp` design §9.21.

2026-10-20 D1/D2：需求文档是新工作唯一基线。七项旧 Plan/workflow 能力和两个 Plan 写命令退役；启动/Inbox 不再自动推进旧 Plan 项目。历史读取、事件 ACK、成员邀请、需求派单及共享 project.transition/task.offer.create 保留。Agent 草稿写权限 D3 仍待决。
