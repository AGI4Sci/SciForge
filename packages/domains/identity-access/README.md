# Identity and Access

Package-owned V1 local account selection for SciForge. Local Accounts provide
stable attribution with `local-selection` assurance; they are not security
authentication and do not isolate installation-local data.

The package is the single contributor of the generic `main.principal-provider`
contract. It publishes `sciforge.identity-access` with `local-selection` by
default. A selected account is promoted to `sciforge-cloud` with
`cloud-authenticated` only while the current OIDC user matches its cloud link
and the current login session has freshly confirmed an active cloud Device.
Logout or Device revocation advances `identityVersion` and immediately falls
back to local selection.

Each immutable local account UUID is the opaque local Principal subject;
display-name and first-run preference edits do not change the authorization
`identityVersion`.

The main process publishes three owner-scoped, token-free internal services.
The authenticated User Cloud transport is available only to its manifest
allowlist. Its `2.0.0` contract accepts only the closed Collaboration
`RestRequest`/`RestResponse` protocol, rejects credential-shaped portable
resource identities, and excludes Agent credential lifecycle envelopes. The
Agent Cloud runtime owns bounded registration, rotation, revocation, command,
pull, and WSS operations for Collaboration; it performs bootstrap decryption
and bearer injection without returning Agent authority. A local fence or
revocation advances the exact Agent authority epoch synchronously, aborts
in-flight HTTP, closes in-flight WSS, and rechecks the epoch before accepting a
response. Only a newly committed replacement authority can reopen that Agent.
The Device fact-attestation signer is available only to
`sciforge.project-coordinator`, accepts the single
`project-content-provisioning-attestation` fact envelope, revalidates the exact
OIDC User and ACTIVE Device before every signature, and returns public
verification metadata only. No renderer capability, arbitrary-byte signing
surface, Token, Agent authority, or Device private key crosses any service
contract.

OIDC refresh material, the Device signing key, and per-Agent authority are
stored by the Identity-owned in-process Node-API adapter in the macOS Keychain
with `WhenUnlockedThisDeviceOnly` and non-synchronizable accessibility. Vault
keys bind the installation and typed secret purpose. Missing native support
fails closed; there is no environment, file, subprocess, Host storage, IPC, or
renderer fallback.
