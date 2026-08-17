## Context

The current desktop asserts a Local Account as a `local-selection` Human Principal. ADR-0026 allows that Principal to own a separately authenticated node-local Provider Connection; it does not treat the Local Account as proof of the OpenContent identity. The offline SDK and the read-only `test3` probe confirm RSA-OAEP-SHA256 login, opaque Token validation, stable external user ID, personal-root discovery, Team discovery, and folder metadata. Upload/download use main-site validation/creation followed by region transfer, so transport schemas remain Connector-owned.

## Goals / Non-Goals

**Goals:**

- Enroll one existing OpenContent account per Principal/instance without implementing account registration.
- Persist only a Host-encrypted Token and non-secret connection metadata.
- Keep all Token, endpoint, session, HTTP, provider DTO, and transfer-region details in main process.
- Give only the OpenContent Content Space adapter a bounded token-free facade.
- Fail closed on stale/superseded sessions, schema drift, authorization failure, and uncertain writes.

**Non-Goals:**

- SciForge login, OpenContent account creation, ACL/member administration, Project semantics, Shared Documents, or collaborative editing.
- A public raw client, Agent-supplied credentials/connections, automatic login, automatic retry, fallback account, or administrator borrowing.

## Decisions

### Keep enrollment UI and transport in separate entrypoints of one package

The renderer entrypoint contributes only Human enrollment/status UI. Password input is sent once over a dedicated trusted enrollment capability, used immediately by the main entrypoint, and then released. It never enters domain state, settings, Workspace, logs, traces, Agent traffic, or fixtures. The main entrypoint owns authentication, Token validation, secure persistence, logout, redaction, and transport. No transport callable is exported to renderer or Agent code.

### Make the executing Principal's connection non-selectable

Connection metadata has a unique `(principalId, providerInstanceRef)` key and a local `connectionId`. Bind either creates the missing record or explicitly replaces the current record after successful authentication. All operations derive the current Principal from Host context and locate that exact record. A caller cannot pass a connection ID, username, or alternate Principal. Principal switch cancels live sessions and operations; it does not delete either Principal's stored binding.

The stable OpenContent `GetUserInfoByToken.data.id` is stored as the external account ID. `identityId` is optional diagnostic metadata only. A changed stable ID during reauthentication is an explicit replacement, never silent continuation.

### Persist the Token, never the password

Bind fetches the login RSA key, encrypts the password with RSA-OAEP-SHA256, calls `UserLogin`, validates the returned opaque Token through `CheckUserTokenValidity` and `GetUserInfoByToken`, and only then atomically commits connection metadata plus the Token through the owner-scoped secure credential facade. Failed validation commits nothing. Every later facade operation checks Token validity before provider content access. An invalid, expired, revoked, or superseded Token atomically moves local connection metadata to `reauthentication_required`; the Connector never silently logs in because no password is retained.

Unbind first invalidates local usability, attempts provider logout/revocation when supported, removes the encrypted Token and metadata, and reports remote revocation separately. Local deletion is never contingent on remote success.

### Separate trusted instance policy from portable identity

The package contributes a safe `main.provider-instance-directory-entry`. Connector-private policy binds the exact ProviderInstanceRef to HTTPS endpoint, tenant/build expectations, redirect policy, timeouts, and the development profile. Neither portable references nor ordinary configuration may provide an endpoint. The shared demonstration instance is development-only and uses least-privilege accounts; production remains blocked.

### Use one Host-mediated internal facade

The Connector publishes a non-callable service descriptor through standard main extension composition. Its implementation is registered privately through a generic Host mediator, which derives both provider and consumer owners from trusted package entrypoints and issues the token-free facade only to the allowlisted OpenContent adapter. Descriptor/implementation owner, version, and location mismatches fail composition. Content Space and the Broker are not private service buses.

### Pin schemas and preserve two-stage transfer uncertainty

Every admitted API validates HTTP status, OpenContent business result, and an exact bounded schema. Personal and Team roots normalize numeric IDs internally; the adapter receives stable folder identity facts and prefers `folderGuid` as portable container identity. Upload/download region URLs never reach renderer or Agent. Create/upload collision maps to conflict. Timeout, cancellation, session supersession, or an ambiguous second-stage receipt maps to `outcome_unknown`; writes are never retried automatically.

## Risks / Trade-offs

- A new login may supersede another OpenContent session. The Connector treats it as explicit Human enrollment and requires reauthentication when the saved Token becomes invalid.
- JavaScript cannot guarantee password zeroization, so the contract minimizes lifetime and prohibits every durable/observable copy.
- The current shared demo endpoint is not a production security boundary. Exact compile-time policy limits development use; production requires a separate readiness decision.
- Some SDK response shapes remain under-documented. Operations stay blocked until contract probes and fixtures pin them.

## Migration Plan

1. Complete the canonical secure provider-credential facade.
2. Add package manifests, enrollment UI contract, connection metadata, and trusted instance profile with network operations mocked.
3. Implement bind/status/reauthenticate/unbind and schema-pinned read transport.
4. Implement two-stage create/upload/download transport with conflict, cancellation, bounds, and uncertainty handling.
5. Compose the separate OpenContent ContentSpaceProvider and verify the Change 1 UI/Agent path against the exact development profile.
6. Removing the Connector/adapter leaves generic Content Space and other Providers operational with no fallback.
