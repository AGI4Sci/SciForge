## 1. Contract and Package Foundation

- [ ] 1.1 Complete Secure Provider Credentials and the OpenContent Connector; keep Shared Documents and Project binding out of the dependency chain.
- [x] 1.2 Extend `ContentContainerSummary` with required provider-neutral `scope: personal | shared` and update mock/provider/UI tests.
- [x] 1.3 Add the optional main-only adapter with one exact `main.content-space-provider-factory` contribution, standard manifest/generated composition, lazy construction, and no OpenContent-specific Host branch.
- [x] 1.4 Acquire only the Host-issued token-free Connector facade; prove catalog/factory construction has no login, credential, network, or remote side effect.

## 2. Read Mapping and Authorization

- [x] 2.1 Map the personal root to `personal` and accessible Team roots to `shared`, using stable folder identity for portable references and bounded labels for display.
- [x] 2.2 Map paginated folder/file entries and typed unauthorized/unavailable/malformed/rate outcomes without exposing DTOs, Tokens, endpoints, or numeric internal handles.
- [x] 2.3 Bind every result to the exact Provider Instance, current Principal-owned connection, explicit target, cancellation state, and trusted development profile.
- [x] 2.4 Enforce Personal Session Human-authorized roots and prepare the generic descendant-scope input required by Change 2 Project Tasks; callers cannot pass a connection.

## 3. Write and Workspace Transfer Path

- [x] 3.1 Implement create-folder and upload-new only, mapping name collision to conflict and ambiguous completion to `outcome_unknown` with no overwrite, rename, retry, or fallback.
- [x] 3.2 Add canonical Agent upload grants for Human-confirmed Workspace-relative regular files; validate real path, symlink escape, type, and 16 MiB limit in Host.
- [x] 3.3 Add canonical Agent download grants for Human-confirmed new Workspace-relative destinations; use a temporary file plus atomic commit, prohibit overwrite, and enforce 1 GiB limit.
- [x] 3.4 Preserve progress, cancellation, one-shot handle ownership, current Principal, audience, invocation identity, and cleanup across UI and Agent transfers.

## 4. Development Profile and Verification

- [x] 4.1 Pin exact read/write schemas with least-privilege `test3` probes; locate exact Team `sciforge test`, create it with `test3` only if absent and permitted, otherwise stop before administrator use.
- [x] 4.2 Verify personal/team browse, folder create, upload-new conflict/uncertainty, and download without remote cleanup or destructive operations outside explicitly created test fixtures.
- [x] 4.3 Test unauthorized, missing binding, reauthentication, wrong Principal, scope escape, unsafe Workspace path, cancellation, size bounds, token leakage, and adapter removal.
- [x] 4.4 Run package tests/typecheck, Content Space regression, generator freshness, governance/boundaries, changed-file lint, and source/packaged smoke.
- [x] 4.5 Keep production, ProjectContentSpaceBinding, ACL/member operations, automatic sync, Shared Documents, and ArtifactReference issuance blocked.
