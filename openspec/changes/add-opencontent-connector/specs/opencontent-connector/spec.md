## Purpose

Defines the OpenContent integration package that enrolls existing accounts and owns Principal-bound authentication, secure Token use, validated transport, and one Host-mediated Content Space adapter facade.

## ADDED Requirements

### Requirement: Connector is one independently composed integration package

`opencontent-connector` SHALL be a trusted compile-time package discovered through standard manifest/generated composition. Its renderer entrypoint SHALL expose only Human enrollment/status UI; its main entrypoint SHALL own connection state, credential use, endpoint policy, authentication, schemas, transport, and redaction. It SHALL register no ContentSpaceProvider, DocumentProvider, portable resolver, raw public client, Agent credential surface, sidecar, or Host vendor switch.

#### Scenario: Connector is absent

- **WHEN** the Connector and adapter are omitted
- **THEN** generic Content Space, mock/other Providers, renderer, and source/packaged application SHALL continue without alias or fallback

### Requirement: Enrollment binds an existing account without retaining a password

Only trusted Human UI MAY submit an existing OpenContent username/password for one bind or reauthenticate transaction. The Connector SHALL fetch the trusted login key, use RSA-OAEP-SHA256, validate the returned Token and current account identity, persist only the encrypted Token, and release the password. SciForge SHALL NOT create an OpenContent account or expose credentials to Agent, logs, traces, settings, Workspace, Project, Task, URLs, fixtures, or public status.

#### Scenario: Authentication or identity validation fails

- **WHEN** login, Token validation, or who-am-I validation fails
- **THEN** no new connection metadata or credential SHALL commit and the prior valid binding, if any, SHALL remain unchanged

### Requirement: Exactly one current connection is owned by the executing Principal

The Connector SHALL permit at most one active node-local connection per `(Host-asserted Human Principal, Provider Instance)`. Every operation SHALL derive that Principal and connection from trusted execution context. Requesters, Tasks, prompts, portable references, runtime input, usernames, Project roles, coordinators, and administrators SHALL NOT nominate, transfer, or borrow a connection.

#### Scenario: Agent executes a Content Space operation

- **WHEN** an Agent operation reaches the Connector
- **THEN** it SHALL use only the current execution node owner's binding or fail `connection_required`/`reauthentication_required`

#### Scenario: Current Principal changes

- **WHEN** the Local Account selection changes
- **THEN** live sessions and operations for the prior Principal SHALL be cancelled while each Principal's stored binding remains isolated

### Requirement: Token lifecycle fails closed

Secret material SHALL exist only in the owner-scoped secure credential facility. Invalid, expired, revoked, mismatched, or superseded Tokens SHALL produce `reauthentication_required`; the Connector SHALL NOT silently log in, choose another account, or use administrator credentials. Unbind SHALL immediately disable local use and delete local metadata/Token even if best-effort remote logout cannot be confirmed.

#### Scenario: Saved Token becomes invalid

- **WHEN** preflight or provider response proves the Token invalid
- **THEN** the connection SHALL become `reauthentication_required` and no content operation SHALL proceed

### Requirement: Instance policy and callable transport are trusted and private

The Connector SHALL contribute a non-secret OpenContent Provider Instance directory entry and bind its exact reference to Connector-private HTTPS endpoint, tenant/build expectations, limits, and readiness/audience policy. Callers SHALL NOT supply an endpoint or promote readiness. A generic Host mediator SHALL issue the narrow token-free callable facade only to the allowlisted OpenContent Content Space adapter owner; the global contribution list SHALL contain only a non-callable descriptor.

#### Scenario: Consumer impersonates the adapter or supplies an endpoint

- **WHEN** an untrusted package/runtime caller requests the facade or changes instance policy
- **THEN** access SHALL fail before credential or network use

### Requirement: Authentication and transport validate exact schemas

Every admitted operation SHALL validate HTTP status, OpenContent business result, bounded request/response schema, instance, Principal, connection, target, cancellation, and limits. Personal and Team roots SHALL be distinguishable; stable folder identity SHALL be returned without exposing raw Token, Cookie, endpoint, region URL, credential record, or unbounded DTO.

#### Scenario: OpenContent returns HTTP success with business failure or malformed data

- **WHEN** either condition occurs
- **THEN** the Connector SHALL return a bounded typed failure and SHALL NOT emit a resource reference

### Requirement: Writes and two-stage transfers preserve safety and uncertainty

Create-folder/upload-new SHALL never overwrite, auto-rename, retarget, retry blindly, or fall back. Collision SHALL return conflict. Upload/download region transfer SHALL remain main-process only. Timeout, cancellation, session supersession, or ambiguous provider receipt SHALL return `outcome_unknown` for a possibly committed write and SHALL NOT retry.

#### Scenario: Upload completion cannot be proven

- **WHEN** the second-stage response is lost or invalid after bytes may have reached OpenContent
- **THEN** the Connector SHALL return `outcome_unknown` and SHALL NOT upload again

### Requirement: Development admission is exact and production remains blocked

The reviewed shared demonstration instance MAY execute only through a trusted development profile that fixes the Provider Instance, least-privilege account class, exact operations, transfer limits, and UI/Agent audiences. Renderer, Agent, Task, portable input, environment text, or ordinary configuration SHALL NOT widen it. Production readiness remains a separate decision.

#### Scenario: One operation lacks a pinned contract

- **WHEN** another operation in the profile has passed its probe
- **THEN** only the proven operation MAY execute and the incomplete operation SHALL remain `blocked_by_contract`

### Requirement: Shared Documents and Project semantics remain absent

The Connector SHALL define no Document port/provider, collaborative editing, Project binding, Workspace synchronization, ACL/member administration, or shared administrator fallback.

#### Scenario: Change 1 is installed alone

- **WHEN** Shared Documents and ProjectContentSpaceBinding are absent
- **THEN** account binding and provider-neutral personal/team file access SHALL remain complete
