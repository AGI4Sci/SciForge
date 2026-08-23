## ADDED Requirements

### Requirement: Supplier execution has one Connector-owned transport

The Connector SHALL own the typed supplier invocation/result protocol, executable command allowlist, verified asset resolution, runtime snapshot, bounded runner, and isolated process transport. It SHALL expose to the owning Provider only a token-free `./main-contract` facade and typed supplier invocation surface. Asset paths, argv, environment, credentials, raw process results, runner construction, snapshots, and integrity override hooks SHALL remain package-private. The Provider SHALL own receipt-to-Content-Space semantics and SHALL NOT create a second supplier process, raw CLI path, or transport.

The pinned supplier snapshot SHALL freeze exactly 86 inventory commands and an exact 56-command admitted adapter union. The wider inventory MAY contain commands that are not executable. Only the package-owned reviewed union MAY reach the process transport; commands without an exact Provider semantic contract SHALL fail before source transfer, temporary-file creation, or subprocess dispatch. Static CLI inventory characterization SHALL remain a Connector package test and SHALL NOT be represented as canonical packaged callability.

#### Scenario: Provider requests a command outside the executable union

- **WHEN** the typed Provider adapter requests a supplier command that is present only in inventory
- **THEN** the Connector SHALL reject it before process launch and SHALL NOT reinterpret it through an alias or generic argv surface

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
