# Cloud Collaboration

> Current-state audit: 2026-08-24. The implemented baseline is OIDC/Device-backed; the `add-full-multi-user-collaboration-loop` change freezes the remaining Project content, execution and true-device collaboration language below.

Cloud Collaboration is the SciForge bounded context for coordinating multiple users and their Agent Hosts through shared Projects. It owns collaborative state while preserving each node's authority over local Workspaces and resources.

## Language

**Collaboration Project**:
A cloud-authoritative unit with one owning SciForge User, explicit members, one current Coordinator Agent, Tasks, and shared Project Records.
_Avoid_: Workspace, Project DAG, shared folder, OpenContent Team

**Project Owner**:
The SciForge User identified by a Collaboration Project's `ownerUserId`. Ownership does not imply access to a member's Workspace or external accounts.
_Avoid_: Workspace owner, Coordinator Agent, OpenContent administrator

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

**Project Content Provisioning Attestation**:
A Device-signed, non-secret statement of the exact Provider root and member observations made by the Project Owner Desktop for one provisioning intent revision. It proves who observed which facts, not continued Provider permission or reusable authorization.
_Avoid_: Provider Binding Attestation, access token, Provider ACL grant, persistent authorization scope

**Project Content Readiness**:
The per-Project, per-User Cloud projection of whether an exact Provider identity has been provisioned and most recently observed ready for file work. It is separate from Project Membership and is invalidated by real Provider denial or reconciliation.
_Avoid_: Project role, Provider ACL cache, Worker online status

**Project Content Directory**:
The shared provider directory selected by a Project Content Space Binding for ordinary Project files. It is exclusive to one Project association but remains owned and access-controlled by its Provider.
_Avoid_: Project database, Team root by implication, Workspace, Shared Document

**Coordinator Agent**:
The one Agent currently authorized to write a Collaboration Project's plan, create Tasks, confirm formal conclusions, and complete the Project.
_Avoid_: Project Owner, Coordinator product, cloud model runtime

**Worker Agent**:
The exact Agent selected as a Task assignee and authorized only for the current Task execution. Worker is a Task relationship, not a SciForge account or permanent Agent type.
_Avoid_: Project Member User, Worker account, available Device

**Worker Availability Projection**:
A time-stamped Cloud view of an Agent/Device's active and online state, heartbeat, Runtime capabilities, offer intake, active Task count, Provider identity readiness, and current Project content readiness. It helps a Coordinator choose an Agent but does not force acceptance or guarantee future availability.
_Avoid_: scheduler authority, auto-accept policy, Provider ACL, User role

**Local Task Acceptance Policy**:
The durable `manual` or `automatic` offer-handling preference of one Agent Device. Cloud observes only explicit accept or reject facts and never stores this policy as a Task field.
_Avoid_: Cloud acceptancePolicy, Project setting, cross-device preference

**Task Execution**:
One immutable assignment attempt identified by an `executionId` and fenced by the current Task revision and assignee Agent. Reassignment creates a new execution; an older execution remains audit evidence but has no write authority.
_Avoid_: retry counter, Agent thread, Task identity, reusable lease

**Task Authority**:
The command-time permission derived from current Project, Membership, Device, Agent, Task and execution-fence facts. It is not stored or inferred as a Provider permission.
_Avoid_: Project Membership alone, Provider ACL, acceptance policy

**Task File Intent**:
A strict non-secret Task description of Project input references, output constraints and the exact execution that may use them. It never selects a Provider Connection, exposes a Host path, or grants access by itself.
_Avoid_: file credential, Workspace mount, Provider request, portable authority

**HumanNeeded**:
A durable execution question addressed to one exact SciForge User; Run-0 addresses it to the Project Owner. It is answered by an authenticated Human, not by a Reviewer system role or another Agent.
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
