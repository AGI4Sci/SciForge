## MODIFIED Requirements

### Requirement: Development admission is exact and production remains blocked

The reviewed shared demonstration instance MAY execute only through a trusted development profile that fixes the Provider Instance, complete Host Principal snapshot, exact authority, operation, transfer limits, bounded validity window, and UI/Agent audience. Any operation that is not an explicitly allowed bootstrap or exact-root zero-transfer read SHALL also bind the profile to the Connector-attested opaque external subject and current binding revision. Renderer, Agent, Task, portable input, environment text, Host assurance, or ordinary configuration SHALL NOT nominate an external account or widen the profile. Production readiness remains a separate decision.

#### Scenario: One operation lacks a pinned contract

- **WHEN** another operation in the profile has passed its probe
- **THEN** only the proven operation MAY execute and the incomplete operation SHALL remain `blocked_by_contract`

### Requirement: Shared Documents and Project semantics remain absent

The Connector SHALL define no Document port/provider, collaborative editing, Project binding, Workspace synchronization, domain-level administration capability, or shared administrator fallback. Its narrow token-free facade MAY expose Provider-specific Team administration transport only to the owning ContentSpaceProvider integration; that transport SHALL register no capability, confer no authority, and accept no caller-selected credential or external account.

#### Scenario: Change 1 is installed alone

- **WHEN** Shared Documents and ProjectContentSpaceBinding are absent
- **THEN** account binding and provider-neutral personal/team file access SHALL remain complete
