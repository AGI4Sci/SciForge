## 1. Admission Safety

- [x] 1.1 Add failing Provider characterization tests for `poc_only` ordinary, administration, native, and extended operations and for blocked native `edit`.
- [x] 1.2 Downgrade unverified OpenContent operations per operation, keep contract-incomplete operations blocked, and preserve `updateFileVersion` fail-closed before Provider invocation.
- [x] 1.3 Add a generic trusted Content Space verification-policy contract, strict package-owned static `main.extension` composition, and service/Broker admission tests proving default failure, exact-match read/bootstrap admission, Provider-binding fail-closed behavior, and rejection of caller-controlled widening.
- [x] 1.4 Add Provider-authenticated opaque external-subject/binding-revision evidence, bind it to the exact Principal and Provider Instance, and require the Connector to recheck the expected binding in the current session before every admitted remote business dispatch.
- [x] 1.5 Separate Provider-declared readiness evidence from current invocation admission in Content Space outputs and renderer behavior without promoting `poc_only` operations.

## 2. Project Authority Boundary

- [x] 2.1 Remove Project provisioning from the Content Space capability and Administration contracts, service dispatch, Provider binding, OpenContent implementation, tests, governance, and generated documentation.
- [x] 2.2 Enforce an exact Provider administration binding with no extra legacy port and prove malformed bindings fail closed before Provider dispatch.
- [x] 2.3 Make all four provider-neutral directory searches literal-kind typed, block the four OpenContent search operations before supplier dispatch until exact success item/pagination receipts are frozen, use only an independently authoritative same-instance user reference for ordinary add/list/remove membership, reject legacy Host `contentUserId` mutation payloads, and keep ordinary membership incapable of creating Project authority.
- [x] 2.4 Use a value-free live-response shape fingerprint and test-first regression to support the Provider's `teamUser` member collection key while preserving fail-closed behavior for a metadata-free full page whose pagination completion is unknowable.
- [x] 2.5 Remove the public member-role/ownership delegates and every Administration revision/CAS field; require complete stable Team or Team-user pagination before dependent mutation, exact `{ member }` page items, and exact request binding for all ten Administration outputs with read/write error classification.

## 3. Public and Private Runtime Isolation

- [x] 3.1 Remove `internal/**` from the public root workspace and add boundary/lockfile tests that reject internal package participation.
- [x] 3.2 Change internal runtime composition to retain manifest-discovered package directories for static validation without a root workspace link or executable attachment build.
- [x] 3.3 Remove private `node_modules` source resolution and add shadow-package, absent-overlay, fixed-source-root, and packaged-no-fallback tests.
- [x] 3.4 Move supplier protocol/transport/process ownership into the Connector and semantic adapters into the Provider, delete the standalone runtime workspace and root deep-import smoke, and assert generated composition contains no stale runtime package or private cross-boundary import.

## 4. Internal Packaging and Release Safety

- [x] 4.1 Replace build/after-pack execution of supplier code with complete SciForge-owned static inventory, containment, and digest validation.
- [x] 4.2 Require trusted overlay installation evidence before source activation and packaging, and reject changed, extra, missing, escaping, wrong-version, or unreceipted resources.
- [x] 4.3 Add provider-neutral public Mac/Windows release guards that stop when internal runtime composition is non-empty before signing or upload.
- [x] 4.4 Verify clean public checkout and installed-overlay source/package flows remain deterministic and do not modify the public lockfile.
- [x] 4.5 Reject active Content Space verification-profile packages from every official public release path before build/sign/upload and again after packaging.

## 5. Documentation and Evidence

- [x] 5.1 Align Content Space/OpenContent ADRs, context, capability matrix, distribution guide, package READMEs, and the Chinese runbook with PoC/blocked states and the Project/Artifact boundaries.
- [x] 5.2 Record exact evidence requirements for per-operation promotion, atomic same-file CAS, immutable retention/version-specific retrieval, and UPDATE versus UPGRADE resolution.
- [x] 5.3 Regenerate domain composition and capability governance documentation and audit for private imports, raw clients, stale runtime artifacts, duplicate paths, and Host domain hard-coding.

## 6. Verification and Delivery

- [x] 6.1 Run focused Content Space, OpenContent Provider/Connector supplier-transport/semantic-adapter, internal packaging, release, and boundary tests plus package/root typechecks and changed-file lint.
- [x] 6.2 Build and smoke source Electron with and without an overlay, then build and inspect a packaged application through the canonical Broker → Content Space → Provider → Connector path.
- [x] 6.3 Run full regression, OpenSpec strict validation, domain composition freshness, capability governance, and final diff/secret/private-asset audits.
- [x] 6.4 Use disposable static verification-profile composition to run packaged Broker → Content Space → Provider → Connector live acceptance for root discovery, bounded upload/download, native-document skill use, and Team creation; record each exact outcome without promoting readiness.
  - Completed packaged canonical live evidence: `list-containers`, `observe-entry`, `list-entries`, `upload-new`, and `download` are `live_verified`; each remains `poc_only` / `verification_profile_required`.
  - Native packaged outcomes, not live success: `native-document:create` returned `outcome_unknown` with one unique new `.mdoc` attributable to the attempt; `native-document:read` and `native-document:probe` returned `provider_contract_error`; `native-document:plan` was not executed.
  - The earlier Team-create invocation remains remote-commit/read-only-reconciliation evidence only. After its delivery defect was fixed, exactly one new packaged `createSpace` Agent invocation reached terminal success and is `live_verified`.
  - One earlier B-side attachment-backed `getCurrentPrincipal` invocation completed through the now-retired `user-info` mapping and returned a typed current-principal result. The final Provider path instead derives this reference from the Connector-revalidated current session's strict canonical external identity and dispatches no supplier command. One current-account `addMember` invocation then issued exactly one successful `SaveTeamUserList` write; post-write `listMembers` observed two distinct members and exactly one match for the B-side Provider user reference. No duplicate member write occurred, and no public role value is inferred from that historical response.
  - A later attempt to extend current-run file upload/download and native evidence did not reach Provider business dispatch because external Agent operation-reference/cursor consumption was unstable. Provider business-dispatch and remote-write counts were both zero, so the attempt adds no live row; prior cumulative ordinary live evidence remains valid and native evidence remains static/composed plus the explicitly non-live historical outcomes above.
  - Readiness snapshot: `production_ready` remains zero; exact live evidence does not promote readiness or any sibling operation.
- [x] 6.5 Commit the scoped change and push only to the fork branch; do not update or push upstream.
- [x] 6.6 Prove a clean checkout with no OpenContent overlay builds and starts in both source and packaged modes, registers no native supplier feature, and contains no OpenContent packaged resources.
- [x] 6.7 Confirm the supplier CAS/version contract and UPDATE-versus-UPGRADE semantics before implementing or admitting same-file mutation.
  - Confirmed negatively for the current pinned snapshot by no-network static characterization: the receipt-verified `opencontent-attachment-assets` version `1.0.1` update documentation and CLI expose no expected immutable version, revision, `baseHash`, or `If-Match` input; `FileVerId`/`fileVerId` is response-only.
  - The pinned CLI sends `UPDATE` and automatically retries a same-name `610`/`ExistedFileId` result as `UPDATE`, while the public offline SDK overview says `UPGRADE` and its detailed request table says `UPDATE`. The current contract is therefore absent and the spelling remains conflicted, not frozen.
  - No concurrent two-writer same-file CAS experiment was dispatched: without an atomic expected-state field it would test only last-writer behavior rather than CAS. `updateFileVersion` and every hash-bound native mutation remain `blocked_by_contract`; this snapshot result is neither a future supplier guarantee nor a readiness promotion.
- [x] 6.8 While that contract is absent, attempt native `edit` only as a packaged pre-dispatch fail-closed acceptance with zero remote mutation. The packaged request failed closed as `blocked_by_contract` before adapter invocation or supplier process launch, with zero remote mutation.
- [x] 6.9 Keep the no-credential supplier inventory characterization inside the Connector package: freeze attachment CLI version `1.0.0`, all 86 supplier commands, and the exact 56-command admitted adapter union. Do not treat direct CLI execution as packaged/canonical callability or readiness evidence.
