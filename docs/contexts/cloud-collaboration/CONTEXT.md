# Cloud Collaboration

> Current-state audit: 2026-08-17. This glossary follows `unify-user-device-collaboration` and the implemented collaboration contracts, not the superseded Keycloak baseline.

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

**Project Content Space Binding**:
The cloud-authoritative association from one Collaboration Project to at most one shared Content Container Reference. Only the Project Owner may create, replace, or remove it; the binding grants no Provider permission and never contains a Provider Connection or credential.
_Avoid_: OpenContent Team identity, Project-owned storage, shared credential, Workspace binding

**Project Content Directory**:
The shared provider directory selected by a Project Content Space Binding for ordinary Project files. It is exclusive to one Project association but remains owned and access-controlled by its Provider.
_Avoid_: Project database, Team root by implication, Workspace, Shared Document

**Coordinator Agent**:
The one Agent currently authorized to write a Collaboration Project's plan, create Tasks, confirm formal conclusions, and complete the Project.
_Avoid_: Project Owner, Coordinator product, cloud model runtime

**Task Workspace Use**:
The temporary use of a Workspace by an Agent Host while executing a Task after the Workspace's local authorization requirements have been satisfied. The Project neither owns nor uploads the Workspace.
_Avoid_: Project Workspace, cloud mount, automatic synchronization

**Task Content Space Use**:
The use of only the current Project Content Directory and its descendants by a Project Task through the executing Agent owner's local Provider Connection. The Task requester cannot select a connection or widen the directory scope.
_Avoid_: Project credential, requester account, personal-library access, arbitrary Team access
