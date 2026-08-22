# PR 78 Identity Access Acceptance Receipt

Status date: 2026-08-22

This receipt records non-sensitive evidence and its provenance for the Desktop
identity changes in PR 78. It does not contain account names, passwords,
tokens, callback parameters, Cloud User identifiers, Device identifiers, or
private keys.

## Canonical Source And Provenance

- The canonical source under review is the current head of
  [AGI4Sci/SciForge PR 78](https://github.com/AGI4Sci/SciForge/pull/78). This
  receipt deliberately does not call a pre-review commit the final PR head.
- `2d47fd25745e595f3d0886afa9fc880d499b967c` moved Desktop Cloud identity into
  the versioned `identity-access` domain package and removed the legacy Host
  identity paths.
- `983b6afd9f26a8eb24b6bee0c9fcc2e65b6af44c` added the repository-managed
  Keycloak test delivery and its non-sensitive verification evidence.
- `2c3b55b3d3d127a1b0b77a6fd550570cd8e5f32a` merged the then-current `gui`
  baseline before this review response. It is provenance, not a permanent
  substitute for the live PR head.
- `7ad6d48c3bd4c6eba23c90dda370c912e6950f49` identifies the externally
  deployed A-side SciForge Cloud release used during integration. That release
  belongs to another repository and is not code shipped by PR 78.

## PR Scope

- Desktop system-browser Authorization Code with PKCE.
- Strict OIDC token and JWKS validation before Cloud authority is established.
- Canonical `/v1/me` projection and Desktop Device enrollment/state handling.
- Package-owned identity runtime, renderer contribution, and Principal
  provider.
- Fail-closed configuration, logout, Device, lifecycle, persistence, and
  provider-change behavior.
- Repository-managed Keycloak test deployment, backup/restore, and OIDC
  contract verification.

The SciForge Cloud API implementation, authorization policy, and persistence
remain an external deployment dependency and are not imported into this PR.

## Historical Frozen Packaged Artifact

The following artifact was built from a frozen historical source snapshot and
remains useful regression evidence for the package-owned identity design:

- Source HEAD: `31d1d1a15198e2c98b4984a86fdda4adacef6f22` plus the uncommitted review
  response represented by the source hashes below.
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
- Generated composition contained identity-access main and renderer exactly
  once, exposed all seven `identity.cloud.*` capabilities, and contained no
  legacy identity IPC or `DesktopIdentityControl`: PASS.
- Standard packaged Electron smoke with an isolated profile: PASS.

The current review changes production runtime behavior by requiring explicit
OIDC and Cloud configuration and removing the automatic in-memory identity
fallback. Package versions and the current source tree have also advanced.
Consequently, the historical artifact above does not represent the current PR
head and MUST NOT be presented as its final packaged acceptance.

## Final Frozen Windows Packaged Artifact

The final automated Windows artifact was built from the following frozen
production source snapshot before this post-build evidence-only update:

- Source HEAD: `2c3b55b3d3d127a1b0b77a6fd550570cd8e5f32a` plus the review response
  represented by the source hashes below.
- Source tree SHA-256:
  `2109ee7833b1cbb73517535ffe0e7878ad6b25d827cf26ffea4530405393efac`
- Working diff SHA-256:
  `e6c393a9b3595ab6b5ee8fce32706ef6c0630932e46b2387578a859de4d4c4d5`
- `package-lock.json` SHA-256:
  `98a6b6c9b9ff1ec8277d02d563fcc508502ac094cea14b88e06a28b6698c0f1a`
- Windows unpacked executable SHA-256:
  `53e6372a487cbbfc9de348f87d6ddce208ea9fd2663591e328d310443e363c9e`
- `app.asar` SHA-256:
  `01171b2a435eca9f099c80c4605588fc64906c299d2ff3e8829023c93786d709`
- Electron `42.7.0`, modules ABI `146`, Windows x64 native PTY spawn and
  `PTY_OK`: PASS.
- `identity-access` `1.1.0` occurred exactly once in both main and renderer
  composition. All seven `identity.cloud.*` capabilities occurred exactly once
  in each bundle: PASS.
- Production bundles contained no automatic development-memory fallback,
  `InMemoryCollaborationIdentityClient`, legacy identity IPC channel,
  `DesktopIdentityControl`, or duplicate identity UI path: PASS.
- Standard packaged Electron smoke used the fixed new executable and an
  isolated temporary profile. Readiness, native visual integration, Codex hook,
  workspace-edit persistence, and Paper Radar persistence: PASS.
- SciForge process count and temporary smoke-profile count were both zero after
  the run. No diagnostic rerun was used: PASS.

The first `npm run build` attempt stopped in the prebuild capability check
because ignored workspace support `dist` files had been removed during
validation cleanup. The repository-standard `npm run build:agent-support`
restored those managed artifacts; capability checks and source equivalence then
passed, and the single authorized build retry completed successfully. No source,
lock file, package manifest, network dependency, Visual Studio installation, or
native rebuild setting changed during that recovery.

This final artifact provides automated packaged evidence only. A human-driven
PKCE login was deliberately not repeated against it. The PKCE observations in
the next section belong exclusively to the older historical artifact and must
not be attributed to this final binary.

## Historical Packaged PKCE Evidence

The older historical packaged artifact was run with a new isolated user-data
directory and only non-sensitive OIDC issuer and Cloud base URL configuration.
These observations do not claim that the final frozen artifact above repeated
the human interaction:

- Fresh system-browser PKCE login reached signed-in state: PASS.
- RS256/JWKS signature, non-empty signing `kid`, integer `nbf`, and token time
  gates passed before signed-in state was exposed: PASS.
- `/v1/me`, JIT identity projection, and an ACTIVE Desktop Device were observed
  through the packaged client: PASS.
- A normal close followed by a second real process start with the same isolated
  profile restored signed-in state and the ACTIVE Device without another
  browser login: PASS.
- UI logout immediately returned to signed-out; Sign in became available and
  connected, Revoke, and Sign out actions disappeared: PASS.
- Temporary token or credential files after shutdown: 0.
- PKCE callback listeners after shutdown: 0.
- The isolated validation profile and launcher were removed after strict path
  and process-count checks; no existing user profile was touched: PASS.

The shared encrypted package-secret container was inspected only by file
existence, size, and modification time. Its contents were never read. Because
the container also owns the Desktop private key, its existence or size is not
used to infer whether a particular session entry exists.

## Evidence Ownership

### Independently exercised from the Desktop side

- System-browser PKCE, strict token acceptance, `/v1/me` projection, signed-in
  UI state, ACTIVE Device projection, same-profile restart recovery, local
  logout transition, and fail-closed same-installation ownership conflict.
- Automated OIDC, Device, persistence, Broker, Principal transition, renderer,
  generated composition, package tarball, and packaged-smoke support tests.

### Repository-managed Keycloak evidence

- The Keycloak delivery, production-mode configuration, HTTPS issuer contract,
  network isolation, health, backup/restore, restart, and non-disclosing token
  checks are recorded separately in
  `infra/keycloak/test/ACCEPTANCE-RECEIPT.md` and its hashed release files.

### External A-side evidence

- The A-side release receipt for `7ad6d48c...` reports its Cloud service,
  authorization, persistence, and broader User-to-Device-to-Agent path. PR 78
  consumed the agreed API contract during integration but did not reproduce or
  independently audit that service implementation.

## Residual Evidence Gaps

- The final frozen Windows artifact passed automated packaged smoke but did not
  repeat a human-driven system-browser PKCE login. The PKCE results above remain
  historical-artifact evidence only.
- Logout followed by another packaged process start remaining signed-out was
  not independently proven; the isolated profile had already been safely
  removed when that additional check was requested.
- Remote Refresh Token revocation and identity-provider end-session completion
  were not independently proven from the server side.
- The Desktop observed `/v1/me` and ACTIVE Device behavior against the external
  Cloud, but this receipt does not independently prove every Cloud Device
  create/revoke persistence transition or the A-side implementation behind it.
- The macOS `/bin/bash` 3.2 Keycloak verifier gate remains pending in CI. Local
  Bash 5 and Ubuntu results do not substitute for that platform evidence.

## Final Commit Metadata And Test Normalization

After the artifact was built, only this receipt and
`scripts/identity-access-docs.test.mjs` were updated to record and enforce the
evidence boundary. Production/runtime source, package manifests,
`package-lock.json`, and generated composition did not change, so the artifact
continues to correspond to the frozen snapshot recorded above and was not
rebuilt after this metadata-only normalization.

To avoid making this receipt hash itself, the final source-tree and working-diff
hashes below exclude this receipt's contents. The status hash includes all path
states and is content-independent:

- Final source tree SHA-256:
  `d86748a625d3864f1638d791692bd13df5cead563002287d5e16539eff4ff478`
- Final working diff SHA-256:
  `575526d9d583d3b10260f78e4f4640fcf47d7ae5c2e9b4cdba5f59594b626af2`
- Final status SHA-256:
  `7964fb5afc0a65f0884180fd0a7953dcfee7673cf8dec9f2841897bc8d946d6e`

## Required Follow-up

- Keep the unproven logout and external Cloud items explicit unless new,
  independently auditable evidence is collected.
- Require the macOS Bash 3.2 CI job to pass before approval.
- Rotate the dedicated acceptance-test account passwords before future shared
  use. Neither old nor replacement passwords belong in this repository.
