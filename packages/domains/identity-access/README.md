# Identity and Access

Package-owned V1 local account selection for SciForge. Local Accounts provide
stable attribution with `local-selection` assurance; they are not security
authentication and do not isolate installation-local data.

The package is the single contributor of the generic `main.principal-provider`
contract. It publishes `sciforge.identity-access` with `local-selection` by
default. A selected account is promoted to `sciforge-cloud` with
`cloud-authenticated` only while the current OIDC user matches its cloud link
and the current login session has confirmed an active cloud Device. Temporary
network failures retain this identity binding and its version so local Agent
turns and children can continue under their existing permissions. The Principal
is identity attribution, not proof of current Cloud availability: authenticated
Cloud transport, Agent authority, and fact signing independently require fresh
ACTIVE Device validation and fence in-flight operations when it is unavailable.
A restored connection to the same User and Device does not replace the local
turn lease. Missing/revoked Devices, explicit authority rejection, invalid
Device responses, and logout clear the binding.
Logout or Device revocation advances `identityVersion` and immediately falls
back to local selection.

Authenticated Cloud commands retry one connection-establishment timeout
(`UND_ERR_CONNECT_TIMEOUT`) with the exact same payload and idempotency key.
Both attempts share the existing deadline and authority-cancellation signal.
Socket failures, response failures, and HTTP business errors are not retried
by this path; their outcomes may already have been committed. The existing
401 token-renewal path remains the only authentication recovery path.

Desktop refresh responses are escrowed in the existing private session vault before
signing-key and Cloud profile requests. This pending material grants no access:
retry and restart must verify the signatures, issuer, audience, lifetime and saved
identity binding, then confirm the Cloud profile before activating it. A transient
verification or profile failure retains the rotated credential instead of reusing
the consumed refresh token. Repeated initialization reuses the live credential
owner and joins its refresh instead of replacing it with a vault snapshot; a
vault read also rechecks for credentials established while it was awaiting.
Expired pending access tokens are verified only to
recover the rotation credential, then replaced and fully validated before use.
A vault write failure is reported and retried without discarding the in-memory
rotation; a process crash before a successful vault write cannot recover it.
Logout clears both active and pending local session material and requests
revocation of the latest pending rotated refresh token when present.

Loopback callbacks with missing or stale state return an error without ending the
current login attempt. The browser confirms receipt of authorization; the Desktop
remains the authority for the final login result. The deployed callback remains
fixed to the exact registered loopback URI; concurrent Desktop instances can
still contend for its port. Login connection details expose only the known error
code, failed step and allowlisted transport codes, not provider text or tokens.

Each immutable local account UUID is the opaque local Principal subject;
display-name and first-run preference edits do not change the authorization
`identityVersion`.

The main process publishes three owner-scoped, token-free internal services.
The authenticated User Cloud transport is available only to its manifest
allowlist. Its `2.0.0` contract accepts only the closed Collaboration
`RestRequest`/`RestResponse` protocol, rejects credential-shaped portable
resource identities, and excludes Agent credential lifecycle envelopes. The
`sciforge.agent-cloud-runtime@4.0.0` owns bounded Device Agent ensure, rotation,
revocation, command, pull, and WSS operations for Collaboration. Bootstrap is
strictly ordered as current OIDC User and freshly revalidated ACTIVE Device. No renderer or consuming domain supplies an
Agent name, node type, capability, bootstrap key, or idempotency key. Identity
derives the Device-bound display name through Cloud and the exact token-free Runtime/model-access tags
from the Host readiness observation and sends those facts to Cloud. Missing or
unexecutable Runtime configuration yields empty capability observations. Agent registration,
Inbox and authenticated Cloud commands remain available; execution checks Runtime readiness separately. The
service performs bootstrap decryption and bearer injection without returning
Agent authority. A local fence or
revocation advances the exact Agent authority epoch synchronously, aborts
in-flight HTTP, closes in-flight WSS, and rechecks the epoch before accepting a
response. OIDC ownership changes, logout, Device revoke, and unconfirmed Device
refresh invalidate in-flight Agent authority and stop Collaboration delivery;
same-User token refresh preserves the existing binding. Only a newly committed
replacement authority can reopen a locally fenced Agent. At startup Identity
reuses a matching encrypted local authority or performs the bounded rotation
itself. Cloud remains the authority enforcing at most one active, Device-named
Agent for each Device.
The Device fact-attestation signer is available only to
`sciforge.collaboration`, accepts the single
`project-content-provisioning-attestation` fact envelope, revalidates the exact
OIDC User and ACTIVE Device before every signature, and returns public
verification metadata only. No renderer capability, arbitrary-byte signing
surface, Token, Agent authority, or Device private key crosses any service
contract.

OIDC refresh material, the Device signing key, and per-Agent authority remain
behind one Identity private-vault interface. On macOS the vault uses the
in-process Node-API Keychain adapter with `WhenUnlockedThisDeviceOnly` and
non-synchronizable accessibility, preserving the existing Device identity. On
Windows and Linux it uses the public package-scoped Host secret store; Electron
`safeStorage` provides DPAPI on Windows and requires an approved libsecret or
KWallet backend on Linux. Vault keys bind the installation and typed secret
purpose. Missing or insecure platform storage fails closed; there is no
environment, plaintext file, subprocess, IPC, renderer, or alternate fallback.

### Cloud deployment configuration

Desktop Cloud sign-in needs an OIDC issuer and a SciForge Cloud API origin. They
come from the package-owned non-secret settings document (Account →
SciForge Cloud → Configure cloud service), falling back per field to
`SCIFORGE_OIDC_ISSUER` and `SCIFORGE_CLOUD_BASE_URL`. Saved settings win over
the environment. The public client ships no endpoint defaults or deployment
configuration. Configure your authorized service explicitly; missing settings
fail closed with an actionable message naming the missing values. Saving settings rebuilds the OIDC and Cloud clients in place,
and a saved session is restored only while its issuer still matches.

OIDC discovery, token exchange, and signing-key reads each have a 15-second
transport deadline, including response bodies. A stalled request is aborted and
returns control so the user can retry; authorization-code exchange is never
automatically replayed. The browser callback retains its separate five-minute
interactive deadline. Network diagnostics contain only fixed stage and error-code
categories, never provider text or credentials. The account panel keeps the login
command visibly pending even when background identity observations complete.

### Current user profile service

The Host-mediated sciforge.current-user-profile@1.0.0 service projects only the live cloud user's userId/displayName, signed-out, or unavailable. Its explicit consumer is the SiYuan provider's embedded comment attribution. It exposes no token, email, model configuration, transport command or authentication authority. Profiles are read live instead of cached across account transitions.

Signed-in names come from the canonical SciForge Cloud User profile. OIDC claims seed new profiles only; sign-in usernames remain separate from editable display names. The account overlay's existing rename capability writes linked accounts through the authenticated `user.get` / revision-checked `user.update` command path, then reloads the profile and local account projection. Failed cloud writes do not acknowledge a local rename. Profile metadata refreshes through device revalidation (coalesced at 30 seconds) and token refresh; collaboration dashboards read authoritative labels through their existing refresh path. Display-name changes preserve User ID and authorization revision. SiYuan's live current-user service observes the same display name for comment attribution. The cloud server must include the OIDC profile-preservation fix before enabling linked-account renaming in deployed clients.

### Native Keychain verification

Normal tests compile, stage, verify both macOS architectures, and load the native binding without changing OS credentials. The real Keychain round-trip is an explicit interactive smoke: run `SCIFORGE_TEST_KEYCHAIN=1 npm test --workspace @sciforge/domain-identity-access` only when a human can authorize the operating-system prompt. It runs in a separate process with a 20-second limit. A normal completion removes its random test item; an interrupted run reports only its exact test-item identifier for controlled cleanup. A skipped OS smoke is not evidence that interactive Keychain access passed.
# Authenticated Cloud Host service

`./host-services` contributes `identity-access.authenticated-cloud` through installed domain composition. The Host must admit the exact caller package/version with `authorizeHostService`; requests require a live principal lease, abort signal, and an ordinary Session or authenticated UI caller.

- `status({})` invokes `identity.cloud.host.status` and returns the strict ready status including `baseUrl`, `userId`, `deviceId`, `deviceRevision`, and opaque `sessionGeneration`. A current Cloud principal with a matching ready transport and enrolled device is required.
- `execute({ contractVersion: 1, operationId: 'sciforge.cloud.command', payload, expectedBinding })` requires those five binding fields captured from preflight status. It returns `{ contractVersion: 1, status, body }`. Public schemas expose only admitted commands and relevant responses, additionally validated by the existing credential-filtered transport schemas.
- Reads (`project.list`, `project.get`, `projection.list`, `project.code_conversation.pull`) invoke `identity.cloud.host.read`.
- Conversation `publish`, `append`, `fork`, and `set_status` invoke `identity.cloud.host.execute`, an external-write capability requiring confirmation and idempotency. Each authorized transport attempt gets a fresh Broker invocation identity so settled failures and responses cannot prevent retries. The payload retains its durable Cloud idempotency key for server-side deduplication. Other commands fail closed.
- Local workspace mutations may read Host `status` to fence their account binding, including shared conversation discard. Cloud mutations still require external-write authority.
- Confirmed Cloud writes delegate through the generic Host capability adapter: the admitted service operation carries the outer capability and invocation identity, and the Host validates its exact confirmation, registered effect, and live lease before minting approval for the fresh nested attempt. Missing confirmation or revoked package/tool/service authority prevents dispatch. UI and ordinary Session calls use the same adapter.

Each capability fences the captured `sciforge-cloud` principal subject/device against the ready transport before execution and after settlement. The lease and signal are rechecked, and transport base URL/device revision changes reject settlement. Credentials remain Identity-owned. Existing Identity account-management capabilities remain UI-only.

The runtime compares the expected binding before any credential work and again immediately after token freshness work, synchronously before dispatch. The generation combines a runtime-instance nonce with the OIDC session generation, fencing account switches, same-account logout/login, and runtime replacement. The shared conversation service keeps this fence ephemeral; persistent store identity remains only the Cloud address, user, and Project.
