## ADDED Requirements

### Requirement: Project file download uses OpenContent DownloadCheck before local destination

For a Project system download, the OpenContent adapter SHALL first validate the exact same-instance resource and root containment through metadata, then call the Connector-owned real `DownloadCheck` for that file under the executing node owner's current re-attested OpenContent session. Only an explicit authorized DownloadCheck result SHALL permit byte transfer and only after that result MAY Host open the no-overwrite Workspace destination. Folder/file metadata, `folder-info`, a known GUID/ID, prior Team listing, Cloud membership or provisioning attestation SHALL NOT substitute for DownloadCheck.

#### Scenario: Removed Team member can still query file metadata

- **WHEN** OpenContent returns known-file metadata but DownloadCheck denies the current external principal
- **THEN** the adapter SHALL return unauthorized before any local destination is opened
- **AND** SHALL expose enough typed status for collaboration to degrade only that User's Project content readiness.

### Requirement: Project upload reaches the real OpenContent write path

For `system-upload-new`, the adapter SHALL use only the current Principal-bound Connector session, exact authorized Project directory and Host-managed byte source. It SHALL execute the real OpenContent upload-new operation with no overwrite, no alternate account, no Owner/Coordinator credential and no mock response. The adapter SHALL validate the exact returned root/parent/resource/name/bytes/digest and re-observe the resource before success; permission denial SHALL return unauthorized, collision SHALL return typed conflict, and an indeterminate or drifted result SHALL return `outcome_unknown` without automatic retry.

#### Scenario: Worker loses Team membership immediately before upload

- **WHEN** the real OpenContent upload operation rejects the current Worker principal
- **THEN** the adapter SHALL fail the execution as unauthorized
- **AND** SHALL NOT reuse a cached metadata observation or another Connection.

### Requirement: Team provisioning uses exact ordinary Provider operations

The OpenContent adapter SHALL support Project orchestration only through its existing provider-neutral shared-container creation, current-principal reference, exact user member add/remove, full member listing and observation operations. Every operation SHALL remain independently authorized and receipt-bound; no OpenContent-specific Project DTO, batch provisioning method, Cloud identity mapping, email lookup, persistent authorization scope or privileged administrator session SHALL be introduced. Production composition SHALL contain no `productionMockContentSpace` or synthetic Team/file result.

#### Scenario: Owner provisions exact members

- **WHEN** Content Space supplies the Owner's current principal reference and exact same-instance member references one operation at a time
- **THEN** the adapter SHALL create/observe one Team root, mutate those exact Provider users and return a complete re-read member list
- **AND** Project binding SHALL be performed later by Cloud from a Device-signed attestation, not by this adapter.

### Requirement: Provider membership observation reports fact without inferring Cloud state

OpenContent member listing and explicit reconcile SHALL report only the Provider's current exact Team users under the Owner's current session. The adapter SHALL NOT infer Cloud Project Membership, Task authority, removal completion or another User's readiness. Metadata visibility after external removal SHALL remain non-authorizing; only member observation and real transfer results MAY be translated by the consuming Project integration into its own readiness state.

#### Scenario: A member is removed outside SciForge

- **WHEN** Owner listing omits the exact member reference or that User's real transfer returns unauthorized
- **THEN** the adapter SHALL return the exact Provider fact without mutating Cloud state itself
- **AND** the Project integration MAY separately mark that User degraded and fence affected executions.

## MODIFIED Requirements

### Requirement: Project binding, Shared Documents, and artifacts remain separate

This adapter SHALL NOT own ProjectContentSpaceBinding, Project lifecycle, authoritative Project owner or membership, Task file intents or execution identity, Shared Documents, or provider-neutral DocumentProvider semantics. It SHALL expose no Project provisioning operation or Provider port. The separately reviewed Project-owning integration MAY orchestrate this adapter's provider-neutral ordinary Team Administration and transfer operations only through Content Space; it SHALL retain all Project intent, membership, saga and attestation semantics and SHALL NOT reinterpret Team Administration as Project authority. The adapter also SHALL NOT issue an ArtifactReference except under the separate immutable retention and retrieval proof requirement. Project archival/deletion SHALL never trigger Provider deletion.

#### Scenario: Project integration is installed

- **WHEN** an authorized Owner Desktop provisions or reconciles Project content
- **THEN** OpenContent existing-account binding and ordinary Team/file operations SHALL remain independently composed behind Content Space
- **AND** the adapter SHALL receive no Project aggregate, Cloud credential or execution authority and SHALL synthesize none.

#### Scenario: Existing-account integration runs before Project binding

- **WHEN** no Project binding contract or active binding is installed
- **THEN** existing-account binding and personal/Team operations SHALL remain independently composed, no Project provisioning Provider surface SHALL exist, and no Agent SHALL synthesize Project authority.
