## ADDED Requirements

### Requirement: Supplier execution has one Connector-owned transport

The Connector SHALL own the typed supplier invocation/result protocol, executable command allowlist, verified asset resolution, runtime snapshot, bounded runner, and isolated process transport. It SHALL expose to the owning Provider only a token-free `./main-contract` facade and typed supplier invocation surface. Asset paths, argv, environment, credentials, raw process results, runner construction, snapshots, and integrity override hooks SHALL remain package-private. The Provider SHALL own receipt-to-Content-Space semantics and SHALL NOT create a second supplier process, raw CLI path, or transport.

The pinned supplier snapshot SHALL freeze exactly 86 inventory commands and an exact 50-command admitted adapter union. The supplier `download`, `file-list`, `kbox-list`, `file-internal-link`, `meta-modeldata`, and `collab-link` commands SHALL remain inventory-only and SHALL NOT enter the admitted union. Ordinary download and directory listing SHALL remain on the typed Connector facade, while PDF export SHALL remain a format of `native-document:export`. The wider inventory MAY contain commands that are not executable. Only the package-owned reviewed union MAY reach the process transport; commands without an exact Provider semantic contract SHALL fail before source transfer, temporary-file creation, or subprocess dispatch. Static CLI inventory characterization SHALL remain a Connector package test and SHALL NOT be represented as canonical packaged callability.

#### Scenario: Provider requests a command outside the executable union

- **WHEN** the typed Provider adapter requests a supplier command that is present only in inventory
- **THEN** the Connector SHALL reject it before process launch and SHALL NOT reinterpret it through an alias or generic argv surface

## MODIFIED Requirements

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

### Requirement: Development admission is exact and production remains blocked

The fixed Provider Instance MAY execute a `poc_only` operation only through a trusted development profile that fixes the Provider Instance, complete Host Principal snapshot, exact authority, operation, transfer limits, bounded validity window, and UI/Agent audience. Any operation that is not an explicitly allowed bootstrap or exact-root zero-transfer read SHALL also bind the profile to the Connector-attested opaque external subject and current binding revision. Deployment configuration establishes runtime availability only; it is not an operation verification profile and cannot change readiness or admission. Renderer, Agent, Task, portable input, environment text, Host assurance, or ordinary configuration SHALL NOT nominate an external account or widen the profile. Production readiness remains a separate decision.

#### Scenario: One operation lacks a pinned contract

- **WHEN** another operation in the profile has passed its probe
- **THEN** only the proven operation MAY execute and the incomplete operation SHALL remain `blocked_by_contract`

### Requirement: Shared Documents and Project semantics remain absent

The Connector SHALL define no Document port/provider, collaborative editing, Project binding, Workspace synchronization, domain-level administration capability, or shared administrator fallback. Its narrow token-free facade MAY expose Provider-specific Team administration transport only to the owning ContentSpaceProvider integration; that transport SHALL register no capability, confer no authority, and accept no caller-selected credential or external account.

#### Scenario: Change 1 is installed alone

- **WHEN** Shared Documents and ProjectContentSpaceBinding are absent
- **THEN** account binding and provider-neutral personal/team file access SHALL remain complete
