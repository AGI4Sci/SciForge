# PR 78 Identity Access Acceptance Receipt

Status date: 2026-08-22

This receipt records non-sensitive evidence for the Desktop identity changes in
PR 78. It does not contain account names, passwords, tokens, callback
parameters, cloud user identifiers, Device identifiers, or private keys.

## Scope

- Desktop system-browser Authorization Code with PKCE.
- OIDC token and JWKS validation before establishing a Cloud Principal.
- JIT Cloud user lookup and Desktop Device enrollment.
- Package-owned identity runtime, renderer projection, and Principal provider.
- Fail-closed logout, Device, lifecycle, persistence, and provider-change
  behavior.
- The Cloud server implementation remains an external deployment dependency
  and is not imported into this PR.

## Frozen Packaged Build

- Source HEAD: `31d1d1a15198e2c98b4984a86fdda4adacef6f22` plus the uncommitted reviewer
  response diff represented by the source hashes below.
- Source tree SHA-256:
  `ee17a2cc5ca913240caf8c443f9fecca270c154ab58f6560b4a40eda9225e5a5`
- Working diff SHA-256:
  `0c24253762171e4ab3467f6de2a05c693a0ec238016bbbf94a656f4b64da0352`
- `package-lock.json` SHA-256:
  `77920b00c360091b89bdecfb6d8d9c139722a587332e79a07a71ece3737e6dbb`
- Windows unpacked executable SHA-256:
  `b9c07609b44e7fd28055eba0f2868f559efcacbc5e99f44498dd0fad42afd983`
- `app.asar` SHA-256:
  `42df794e1894bf3b3ac466ef8dc87bbf73e574b21bb3809906f65badc0343687`
- Electron `42.7.0`, modules ABI `146`, Windows x64 native PTY spawn: PASS.
- Generated composition contains identity-access main and renderer exactly
  once, exposes all seven `identity.cloud.*` capabilities, and contains no
  legacy identity IPC or `DesktopIdentityControl`: PASS.
- Standard packaged Electron smoke with an isolated profile: PASS.

## Final Commit Metadata/Test Normalization

After packaged validation, the only changes relative to the frozen source
snapshot were `package-lock.json`, the domain-package tarball test harness, its
CI workflow gate, and this receipt. Production/runtime source and dependency
versions did not change.

- Final source tree SHA-256, covering all tracked and intended untracked source
  except this receipt to avoid a self-referential digest (2,896 entries):
  `0adc31655272145ac8b58006e7128ccd9595b6568b10c121b249934b69bef117`
- Final tracked working diff SHA-256:
  `a3820503c8e881111c10d46729f1faac59ca9f513822c45ce0a776e60feab4c1`
- Final `package-lock.json` SHA-256:
  `ca336adfc04f739c9b26a62d30bfafd3fa81e740295e8294bc6d657f394e7c5c`
- Final Git status path-set SHA-256 (59 entries):
  `36e018663495d73c5a9a7447624de7df96d493a1b9f03a031e24e360f7b2f2de`

The lock-only diff adds exactly the existing `0.1.0` workspace dependencies
for `@sciforge/collaboration-contracts` and
`@sciforge/collaboration-identity`; it changes no registry resolution or
integrity. The complete independent multi-package tarball smoke, including
both local dependency tarballs and every public export, is PASS. The packaged
artifact above predates these metadata/test changes and is not represented as
having been rebuilt from the final tree.

## Real Packaged PKCE Evidence

The following checks ran against the newly built unpacked executable with a
new isolated user-data directory and only the non-sensitive OIDC issuer and
Cloud base URL configured:

- Fresh system-browser PKCE login reached signed-in state: PASS.
- RS256/JWKS signature gate, non-empty signing `kid`, integer `nbf`, and token
  time-order gates were passed before the client exposed signed-in state: PASS.
- `/v1/me`, JIT identity projection, and ACTIVE Desktop Device: PASS.
- Normal application close followed by a second real process start with the
  same isolated profile restored signed-in state and the ACTIVE Device without
  another browser login: PASS.
- UI logout immediately returned to signed-out; Sign in became available and
  connected, Revoke, and Sign out actions disappeared: PASS.
- Temporary token or credential files after shutdown: 0.
- PKCE callback listeners after shutdown: 0.
- The isolated validation profile and temporary launcher were deleted after
  strict path and process-count checks; no existing user profile was touched:
  PASS.

The shared encrypted package-secret container was inspected only by file
existence, size, and modification time. Its contents were never read. The file
also owns the Desktop private key, so container existence or size is not used
to infer whether a particular session entry exists.

## Evidence Boundaries

- Logout followed by another packaged process start remaining signed-out:
  **NOT INDEPENDENTLY PROVEN**. The isolated profile had already been safely
  deleted when this additional runtime check was requested. Unit and local
  integration tests cover session-clear ordering, logout races, rotation, and
  restart behavior, but those tests are code-level evidence and are not
  represented as a packaged-runtime pass.
- Remote refresh-token revocation and identity-provider end-session completion:
  **NOT INDEPENDENTLY PROVEN**. The UI completed local logout without exposing
  a failure, but no separate server-side receipt was collected.

## Automated Evidence

Focused tests cover OIDC verification and refresh rotation, persistence
ordering, concurrent logout, Device operation epochs and fail-closed
projection, real loopback HTTP transport, package-secret cross-process format
recovery, Broker provider-change events, Principal transitions, renderer
observation races, Host IPC removal, generated composition, and packaged smoke
support cleanup. The complete independent multi-package tarball install and
public-export smoke is also PASS and is now required by Collaboration CI. These
tests supplement, but do not replace, the real packaged runtime evidence above.

## Required Follow-up

- Rotate the dedicated acceptance-test account passwords after this validation.
- Keep the two unproven logout items explicit unless a new isolated packaged
  validation is authorized and completed.
