# opencontent-connector Specification

## Purpose
Defines the OpenContent integration package that enrolls existing accounts and owns Principal-bound authentication, secure Token use, validated HTTP and supplier transport, and one Host-mediated Content Space Provider facade.
## Requirements
### Requirement: Connector is one independently composed integration package

`opencontent-connector` SHALL be a trusted compile-time package discovered through standard manifest/generated composition. Its renderer entrypoint SHALL expose only Human enrollment/status UI; its main entrypoint SHALL own connection state, credential use, endpoint policy, authentication, schemas, transport, and redaction. It SHALL register no ContentSpaceProvider, DocumentProvider, portable resolver, raw public client, Agent credential surface, public sidecar contribution, or Host vendor switch.

#### Scenario: Connector is absent

- **WHEN** the Connector and adapter are omitted
- **THEN** generic Content Space, mock/other Providers, renderer, and the source-development application SHALL continue without alias or fallback

### Requirement: Enrollment binds an existing account without retaining a password

Only trusted Human UI MAY submit an existing OpenContent username/password for one bind or reauthenticate transaction. The Connector SHALL fetch the trusted login key, use RSA-OAEP-SHA256, validate the returned Token and current account identity, persist only the encrypted Token, and release the password. SciForge SHALL NOT create an OpenContent account or expose credentials to Agent, logs, traces, settings, Workspace, Project, Task, fixtures, public status, or any public/caller-controlled/durable URL. A Token MAY appear only in a Connector-private outbound HTTPS query when the verified OpenContent operation requires it, and that ephemeral request SHALL remain inside bounded use, target a pinned origin/path, reject redirects, and never be exposed or persisted.

#### Scenario: Authentication or identity validation fails

- **WHEN** login, Token validation, or who-am-I validation fails
- **THEN** no new Session Token SHALL commit and the prior stored Session Token, if any, SHALL remain unchanged

### Requirement: Exactly one current connection is owned by the executing Principal

The Connector SHALL permit at most one active node-local connection per `(Host-asserted Human Principal, Provider Instance)`. Every operation SHALL derive that Principal and connection from trusted execution context. Requesters, Tasks, prompts, portable references, runtime input, usernames, Project roles, coordinators, and administrators SHALL NOT nominate, transfer, or borrow a connection.

#### Scenario: Agent executes a Content Space operation

- **WHEN** an Agent operation reaches the Connector
- **THEN** it SHALL use only the current execution node owner's binding or fail `connection_required`/`reauthentication_required`

#### Scenario: Current Principal changes

- **WHEN** the Local Account selection changes
- **THEN** live sessions and operations for the prior Principal SHALL be cancelled while each Principal's stored binding remains isolated

### Requirement: Token lifecycle fails closed

Secret material SHALL exist only in the owner-scoped secure credential facility. Invalid, expired, revoked, mismatched, or superseded Tokens SHALL produce `reauthentication_required`; the Connector SHALL NOT silently log in, choose another account, or use administrator credentials. Unbind SHALL immediately disable local use and delete the fixed-slot encrypted Session Token even if best-effort remote logout cannot be confirmed.

#### Scenario: Saved Token becomes invalid

- **WHEN** preflight or provider response proves the Token invalid
- **THEN** the connection SHALL become `reauthentication_required` and no content operation SHALL proceed

### Requirement: Instance policy and callable transport are trusted and private

The Connector SHALL contribute a non-secret OpenContent Provider Instance directory entry and bind its exact reference to the package-owned fixed HTTPS deployment configuration, tenant/build expectations, limits, and readiness/audience policy. Its package manifest SHALL declare deployment contract version `1`, source-relative path `packages/domains/opencontent-connector/config/opencontent-connector.json`, packaged Resources-relative path `domain-deployments/opencontent-connector.json`, maximum size `4096`, and `publicRelease: allowed`. The public package-owned configuration SHALL contain exactly `{ contractVersion: 1, providerInstanceRef: "opencontent-edoc2-demo", origin }`; `origin` SHALL be an absolute HTTPS origin with no userinfo, path, query, fragment, or unknown field. During activation the Connector SHALL synchronously open only the exact mode-specific path, request no-follow semantics when the platform exposes them, and always bind the opened descriptor to the pre-open regular-file identity, size, modification time, change time, and birth time. It SHALL verify a file no larger than `4096` bytes by descriptor, perform a read bounded to `4097` bytes from that same descriptor, reject identity, size, modification-time, change-time, or birth-time drift after the read, close it, and freeze the strict result. It SHALL also reject relative roots, escapes, symlinked ancestors or files, malformed JSON, or schema drift, and SHALL NOT fall back between source and packaged paths or read environment, argv, caller, renderer, or package settings. Callers SHALL NOT supply or override the fixed origin.

Provider Instance discovery, capability registration, and the Host-mediated service descriptor SHALL remain composed without the sidecar. Every legal bind, status, ordinary facade, Team, or supplier call SHALL instead fail `provider_unavailable` before settings, credentials, network, transfer, or process work. Node-local unbind SHALL remain available without the sidecar, delete the fixed-slot local credential, and perform no Provider business call. The integration-owned unavailable enrollment view SHALL expose that existing local unbind only after explicit Human confirmation and SHALL state that remote files are not deleted. Unknown Provider Instances SHALL retain `invalid_provider_instance`/`invalid_input` priority. Only valid configuration MAY construct the HTTP client and Team runtime, and supplier transport SHALL be exposed only when both deployment configuration and verified supplier assets are available. Callers SHALL NOT supply an endpoint or promote readiness. A generic Host mediator SHALL issue the single narrow token-free callable facade only to the allowlisted OpenContent Content Space adapter owner; the global contribution list SHALL contain only a non-callable descriptor.

Generic manifest-driven packaging SHALL preserve the deployment-configuration declaration and create an `extraResources` entry plus exact size/digest receipt for the package-owned source. Electron Builder SHALL capture this immutable composition exactly once before copying and pass that same composition to the after-pack public-release guard and packaged verifier without recomputation. The verifier SHALL require the exact contained regular non-symlink target, size, and digest. The `publicRelease: allowed` source SHALL remain in the public Connector npm package and MAY enter official public application releases.

#### Scenario: Consumer impersonates the adapter or supplies an endpoint

- **WHEN** an untrusted package/runtime caller requests the facade or changes instance policy
- **THEN** access SHALL fail before credential or network use

#### Scenario: Deployment endpoint is not configured

- **WHEN** the exact package-owned sidecar is missing or invalid
- **THEN** the Provider Instance, capabilities, and service descriptor SHALL remain registered while every Provider-backed call listed above fails `provider_unavailable` before storage, credentials, network, or process work and without contacting a fallback service, and local unbind remains available to remove the fixed-slot stored Session Token

#### Scenario: Human clears an unavailable local connection

- **WHEN** the selected Provider Instance is unavailable and the Human explicitly confirms Disconnect in the integration-owned enrollment view
- **THEN** the Connector SHALL remove the current Principal's fixed-slot local Session Token through the existing unbind path without a Provider business call or remote-file deletion

#### Scenario: Source changes after packaging composition is captured

- **WHEN** an active source sidecar is removed or changed after Electron Builder captures its receipt
- **THEN** after-pack verification SHALL still require the captured target, size, and digest and SHALL NOT recompute an empty or different composition

#### Scenario: An inactive deployment target is injected

- **WHEN** a manifest declaration has no active source receipt but its packaged target exists
- **THEN** after-pack verification SHALL reject the residual target

### Requirement: Authentication and transport validate exact schemas

Every admitted operation SHALL validate HTTP status, OpenContent business result, bounded request/response schema, instance, Principal, connection, target, cancellation, and limits. Personal and Team roots SHALL be distinguishable; stable folder identity SHALL be returned without exposing raw Token, Cookie, endpoint, region URL, credential record, or unbounded DTO.

#### Scenario: OpenContent returns HTTP success with business failure or malformed data

- **WHEN** either condition occurs
- **THEN** the Connector SHALL return a bounded typed failure and SHALL NOT emit a resource reference

### Requirement: Supplier execution has one Connector-owned transport

The Connector SHALL own the typed supplier invocation/result protocol, executable command allowlist, verified asset resolution, runtime snapshot, bounded runner, and isolated process transport. It SHALL expose to the owning Provider only a token-free `./main-contract` facade and typed supplier invocation surface. Asset paths, argv, environment, credentials, raw process results, runner construction, snapshots, and integrity override hooks SHALL remain package-private. The Provider SHALL own receipt-to-Content-Space semantics and SHALL NOT create a second supplier process, raw CLI path, or transport.

The pinned supplier snapshot SHALL freeze exactly 86 inventory commands and an exact 50-command admitted adapter union. The supplier `download`, `file-list`, `kbox-list`, `file-internal-link`, `meta-modeldata`, and `collab-link` commands SHALL remain inventory-only and SHALL NOT enter the admitted union. Ordinary download and directory listing SHALL remain on the typed Connector facade, while PDF export SHALL remain a format of `native-document:export`. The wider inventory MAY contain commands that are not executable. Only the package-owned reviewed union MAY reach the process transport; commands without an exact Provider semantic contract SHALL fail before source transfer, temporary-file creation, or subprocess dispatch. Static CLI inventory characterization SHALL remain a Connector package test and SHALL NOT be represented as canonical packaged callability.

#### Scenario: Provider requests a command outside the executable union

- **WHEN** the typed Provider adapter requests a supplier command that is present only in inventory
- **THEN** the Connector SHALL reject it before process launch and SHALL NOT reinterpret it through an alias or generic argv surface

### Requirement: Writes and two-stage transfers preserve safety and uncertainty

Create-folder/upload-new SHALL never overwrite, auto-rename, retarget, retry blindly, or fall back. Collision SHALL return conflict. Upload/download region transfer SHALL remain main-process only. Timeout, cancellation, session supersession, or ambiguous provider receipt SHALL return `outcome_unknown` for a possibly committed write and SHALL NOT retry.

#### Scenario: Upload completion cannot be proven

- **WHEN** the second-stage response is lost or invalid after bytes may have reached OpenContent
- **THEN** the Connector SHALL return `outcome_unknown` and SHALL NOT upload again

### Requirement: Runtime authorization uses the current Principal-owned connection

The fixed Provider Instance MAY execute a contract-complete `poc_only / runtime_authorization_required` operation only for a trusted Broker invocation carrying the complete current Host Principal. The Connector SHALL attest that Principal's current Provider connection with the exact Provider Instance, opaque stable external subject, and opaque binding revision, then re-attest those values immediately before business dispatch. Deployment configuration establishes Provider reachability only; renderer state, Agent input, Task data, portable input, environment text, Host assurance, an optional skill package, or ordinary configuration SHALL NOT nominate an external account or synthesize operation authority. Production readiness remains a separate decision.

#### Scenario: One operation lacks a pinned contract

- **WHEN** a sibling operation succeeds under the same current connection
- **THEN** the incomplete operation SHALL remain `blocked_by_contract` and SHALL fail before supplier dispatch

#### Scenario: Current connection changes during invocation

- **WHEN** the Principal signs out, rebinds, changes credentials, or the opaque binding revision changes
- **THEN** the Connector SHALL reject the stale expected binding before the requested business dispatch

### Requirement: Shared Documents and Project semantics remain absent

The Connector SHALL define no Document port/provider, collaborative editing, Project binding, Workspace synchronization, domain-level administration capability, or shared administrator fallback. Its narrow token-free facade MAY expose Provider-specific Team administration transport only to the owning ContentSpaceProvider integration; that transport SHALL register no capability, confer no authority, and accept no caller-selected credential or external account.

#### Scenario: Change 1 is installed alone

- **WHEN** Shared Documents and ProjectContentSpaceBinding are absent
- **THEN** account binding and provider-neutral personal/team file access SHALL remain complete
