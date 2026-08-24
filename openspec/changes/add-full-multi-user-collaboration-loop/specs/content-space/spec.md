## ADDED Requirements

### Requirement: Project Task transfers use generic system content channels

Content Space SHALL expose only the generic trusted-system transfer operations required by Project Task execution: bounded `system-download` from one exact authorized file resource to an execution Workspace and bounded `system-upload-new` from an execution Workspace to one exact authorized directory resource. The operations SHALL be owned, versioned and composed by the Content Space package, invoked through the same Capability Broker → handler → service → pinned Provider path, and bound out-of-band to current Principal, caller package, Project/Task/execution, Workspace, exact portable resource authorization and logical invocation identity. They SHALL NOT accept or import a Project aggregate, Cloud client, Provider Connection, credential, raw local path or arbitrary Provider operation.

The trusted-system channel SHALL NOT be an Agent-facing discovery capability or a renderer IPC shortcut. A consuming domain package MAY call it only through the generic Domain SDK system-capability contract and SHALL prove its package ownership and exact execution context. Missing binding, stale execution, Device/Principal change, root escape, unsupported Provider operation or absent real Provider SHALL fail closed without a Mock/fallback path.

#### Scenario: Project Worker downloads an input

- **WHEN** an authorized project execution invokes `system-download` with an exact file resource and validated Workspace-relative destination
- **THEN** Content Space SHALL traverse the canonical service and pinned Provider path and write only through a Host-owned bounded destination
- **AND** the consuming collaboration package SHALL never receive Provider credential, raw local path or reusable transfer handle.

#### Scenario: Untrusted caller invokes a system channel

- **WHEN** renderer, Agent prompt, unknown package or mismatched execution invokes a system transfer capability
- **THEN** Broker SHALL reject it before Content Space or Provider dispatch
- **AND** no test/mock fallback SHALL execute.

### Requirement: Operation-time Provider authority is independent from metadata ancestry

Content Space SHALL use metadata observation only to validate portable locator shape, stable identity, parent chain and containment under the bound Project Content Directory. It SHALL NOT infer read or write permission from metadata visibility, a known resource ID, Project Membership, provisioning attestation or a prior successful operation. Before opening a local download destination, the pinned Provider SHALL perform its real operation-specific download authorization check; upload SHALL reach the real Provider write operation as the final ACL check. Unauthorized SHALL fail closed, while an uncertain write SHALL be classified `outcome_unknown` and never blindly retried.

#### Scenario: Known child remains observable after Provider removal

- **WHEN** metadata still proves that a file is a descendant but the real download check rejects the current Provider session
- **THEN** Content Space SHALL return unauthorized before opening the Workspace destination
- **AND** SHALL NOT treat ancestry evidence as read authority.

### Requirement: Project transfer receipts are exact and integrity-bound

Successful system download/upload receipts SHALL bind the Broker invocation, current Principal/Device identity version, caller, Project/Task/execution context digest, Provider Instance, exact root/resource/parent, byte count, SHA-256, operation result and observation time. Upload-new SHALL also re-observe exact parent/name/resource identity before returning success. Receipt drift from a read SHALL fail unavailable/unauthorized as applicable; drift after an external write SHALL return `outcome_unknown`. Receipts SHALL contain no credential, Provider Connection, endpoint, raw path or reusable authority.

#### Scenario: Provider upload receipt names another parent

- **WHEN** the Provider writes or reports a resource outside the execution-authorized Project directory
- **THEN** Content Space SHALL reject the result as `outcome_unknown`
- **AND** SHALL NOT associate that reference with the Task or automatically retry.

## MODIFIED Requirements

### Requirement: Project provisioning is outside the current Content Space contract

Content Space SHALL NOT expose a Project Content Space provisioning capability, Project administration operation, intent/report schema, Cloud client, or Provider Project port. The separately owned Project coordinator integration MAY orchestrate the existing ordinary shared-container and member operations through their canonical public capabilities, but it SHALL own the Project intent, membership mapping, saga journal and Device-signed provisioning attestation outside Content Space. That orchestrator SHALL NOT revive an unused compatibility surface, alias ordinary Provider administration as Cloud authority, or inject Project DTOs into Content Space. Project archival or deletion SHALL never trigger Provider deletion.

Ordinary shared-container creation SHALL continue to accept only the shared-container label. The logical invocation identity SHALL come solely from the Broker invocation envelope outside that request. The capability handler SHALL derive the owner from the Broker's current Principal, and the Provider SHALL map only that Principal's currently authenticated external binding. The create request SHALL NOT accept a caller-authored invocation identity, owner, initial member set, coordinator, Project, or external-account field; later member changes SHALL use only the separate Provider-directory member operations. A Project provisioning orchestrator SHALL therefore perform and receipt the same exact create/list/add/remove operations rather than call a privileged batch/provider shortcut.

#### Scenario: Agent prompt supplies Project membership

- **WHEN** an Agent attempts to provision or reconcile a Project content root from prompt or Content Space payload fields
- **THEN** no generic Content Space capability SHALL accept the Project fields and no Provider administration operation SHALL occur
- **AND** only the Project-owning HCI/system orchestrator MAY start its own saga through separately authorized ordinary operations.

#### Scenario: Ordinary Agent supplies Project membership

- **WHEN** an ordinary Agent attempts to provision or reconcile a Project content root from prompt or capability payload fields
- **THEN** no generic capability SHALL accept the request and no Provider administration operation SHALL occur.

#### Scenario: Provider returns an extra Project provisioning port

- **WHEN** an administration feature binds an object containing any field beyond the exact ordinary Administration port
- **THEN** Content Space SHALL reject the binding before Provider dispatch and SHALL NOT silently retain or invoke the extra port.

#### Scenario: Project orchestrator creates and verifies a shared container

- **WHEN** the Project-owning integration has a current Owner Principal, exact Cloud intent, Human confirmation and Broker invocation identities for the ordinary operations
- **THEN** Content Space SHALL execute each create/member/list operation independently through the canonical path
- **AND** SHALL return only provider-neutral references and receipts, without importing or asserting Project state.

#### Scenario: Agent creates an ordinary shared container

- **WHEN** an admitted Agent requests non-Project shared-container creation with a label and the Broker envelope supplies the logical invocation identity
- **THEN** Content Space SHALL inject the current Principal as owner, reject caller-authored ownership or Project fields, and SHALL NOT treat the result as Project provisioning.
