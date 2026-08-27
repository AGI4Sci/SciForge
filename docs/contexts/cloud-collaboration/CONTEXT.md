# Cloud Collaboration

> Current-state audit: 2026-08-27. The implemented baseline is OIDC/Device-backed and uses User-targeted Task Offers with atomic Device Agent claims.

Cloud Collaboration is the SciForge bounded context for coordinating multiple users and their Agent Hosts through shared Projects. It owns collaborative state while preserving each node's authority over local Workspaces and resources.

## Language

**Collaboration Project**:
A cloud-authoritative unit with one owning SciForge User, explicit members, one current Coordinator Agent, Tasks, and shared Project Records.
_Avoid_: Workspace, Project DAG, shared folder, OpenContent Team

**Project Owner**:
The SciForge User identified by a Collaboration Project's `ownerUserId`. Every current Coordinator Agent belongs to this User, while Workers may belong to any Project Member; ownership does not imply access to another member's Workspace or external accounts.
_Avoid_: Workspace owner, Coordinator Agent, OpenContent administrator

**Project Content Owner**:
The SciForge User whose current Provider Connection is authorized to administer the Project Content Directory. In Run-0 the initial Project Content Owner is always the Project Owner; a future explicit change is a separate saga on the new content owner's Desktop.
_Avoid_: implicit administrator, borrowed Connection, arbitrary initial member

**Project Member**:
An explicit relationship between a SciForge User and a Collaboration Project carrying that user's Project permissions.
_Avoid_: OpenContent Team member, Workspace collaborator, Agent

**Project Membership State**:
The Cloud lifecycle of one Project Member: pending addition, active, pending removal, or removed. It neither reports Provider membership nor grants Task execution by itself.
_Avoid_: Provider ACL, Worker availability, Task authority

**Project Content Space Binding**:
The cloud-authoritative association from one Collaboration Project to at most one shared Content Container Reference. Only the Project Owner may create, replace, or remove it; the binding grants no Provider permission and never contains a Provider Connection or credential.
_Avoid_: OpenContent Team identity, Project-owned storage, shared credential, Workspace binding

**Project Content Provisioning Intent**:
The durable Cloud request that names one Project, content owner, exact desired Provider directory members, target Provider Instance, and provisioning revision. It is not evidence that any Provider write has happened.
_Avoid_: Provider mutation receipt, Team ACL, Task offer

**Provider Directory Principal Fact**:
The current global, non-secret Cloud fact that one exact SciForge User published one exact Provider Directory Principal Reference for one Provider Instance from an ACTIVE Device. It has a stable fact identity, compare-and-set revision, current readiness, Device/Principal provenance, and an opaque binding-attestation digest. It can exist before a Project so Project creation can atomically select exact fact revisions; it neither proves Provider membership nor grants Project or Task authority.
_Avoid_: Provider ACL, Project Content Readiness, inferred email mapping, local Connection, reusable authorization

**Provider Membership Observation**:
The latest external fact returned by a real Provider member-list, download, upload, or explicit reconcile operation for an exact Project Content Directory. It reports Provider reality but grants no Project Membership or Task Authority.
_Avoid_: Cloud membership, cached ACL grant, inferred readiness

**Project Content Provisioning Attestation**:
A Device-signed, non-secret statement of the exact Provider root and member observations made by the Project Owner Desktop for one provisioning intent revision. It proves who observed which facts, not continued Provider permission or reusable authorization.
_Avoid_: Provider Binding Attestation, access token, Provider ACL grant, persistent authorization scope

**Project Content Readiness**:
The derived per-Project, per-User Cloud projection of whether an exact Provider identity has been provisioned and most recently observed ready for file work. `degraded` belongs here, never to Project Membership; readiness is invalidated by real Provider denial or reconciliation.
_Avoid_: Project role, Provider ACL cache, Worker online status

**Project Content Directory**:
The shared provider directory selected by a Project Content Space Binding for ordinary Project files. It is exclusive to one Project association but remains owned and access-controlled by its Provider.
_Avoid_: Project database, Team root by implication, Workspace, Shared Document

**Coordinator Agent**:
The one Project-Owner-owned Agent currently authorized to write one Collaboration Project's plan, create Tasks, confirm formal conclusions, and complete that Project. Project creation uses the creator's current Device Agent automatically; the role applies only to that Project. Transfer may select only another exact Agent owned by the same Project Owner.
_Avoid_: Project Owner, Coordinator product, cloud model runtime

**Worker User**:
The SciForge User selected by a Coordinator to receive one Task Offer. The User is the assignment choice; current Agent/Device availability is only eligibility and delivery evidence.
_Avoid_: Worker account type, preselected Agent, Project-wide role

**Task Offer**:
One durable invitation addressed to a Worker User. Before claim it has no Task Execution or assignee Device/Agent, and Cloud notifies every currently eligible Runtime owned by that User. Coordinator withdrawal, expiry, or one successful claim closes the shared Offer.
_Avoid_: Task Execution, per-Device copy, broadcast execution, reusable lease

**Worker Agent**:
The exact Agent/Device Runtime that wins a User-level Task Offer claim and becomes the actor of the resulting Task Execution. Worker is an execution relationship, not a SciForge account, permanent Agent type, or Coordinator selection.
_Avoid_: Worker User, preselected Device, primary Agent

**Worker Availability Projection**:
A time-stamped Cloud view of an Agent/Device's active and online state, heartbeat, Runtime capabilities, offer intake, active Task count, Provider identity readiness, and current Project content readiness. It determines whether a Worker User has an eligible Runtime and which runtimes receive the User's Offer; it does not select the winning Agent or guarantee future availability.
_Avoid_: assignment target, scheduler authority, auto-accept policy, Provider ACL

**Local Task Acceptance Policy**:
The durable `manual` or `automatic` offer-handling preference of one Agent Device. Accept attempts an atomic Cloud claim; dismiss affects only that Device's local view and is not a shared rejection. Cloud never stores this policy as a Task field.
_Avoid_: global reject, Cloud acceptancePolicy, Project setting, cross-device preference

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
The Task/execution state used when an external write outcome cannot be proven and a Human must reconcile exact Provider observations before linking or abandoning it. It cannot be cleared by an unobserved “mark success” action.
_Avoid_: automatic retry, assumed success, generic failure

**Task Workspace Use**:
The temporary use of a Workspace by an Agent Host while executing a Task after the Workspace's local authorization requirements have been satisfied. The Project neither owns nor uploads the Workspace.
_Avoid_: Project Workspace, cloud mount, automatic synchronization

**Task Content Space Use**:
The use of only the current Project Content Directory and its descendants by a Project Task through the executing Agent owner's local Provider Connection. The Task requester cannot select a connection or widen the directory scope.
_Avoid_: Project credential, requester account, personal-library access, arbitrary Team access
