## 1. Admission Safety

- [x] 1.1 Add failing Provider characterization tests for `poc_only` ordinary, administration, native, and extended operations and for blocked native `edit`.
- [x] 1.2 Downgrade unverified OpenContent operations per operation, keep contract-incomplete operations blocked, and preserve `updateFileVersion` fail-closed before Provider invocation.
- [x] 1.3 Add a generic trusted Content Space verification-policy contract, strict package-owned static `main.extension` composition, and service/Broker admission tests proving default failure, exact-match read/bootstrap admission, Provider-binding fail-closed behavior, and rejection of caller-controlled widening.

## 2. Project Authority Boundary

- [x] 2.1 Remove `content-space.agent-provision-project` from the capability contract, registration, tests, governance, and generated documentation.
- [x] 2.2 Retain the provider-neutral provisioning port, remove the unused coordinator field, and prove the dormant port creates no generic Agent authority.

## 3. Public and Private Runtime Isolation

- [x] 3.1 Remove `internal/**` from the public root workspace and add boundary/lockfile tests that reject internal package participation.
- [x] 3.2 Change internal runtime composition to retain manifest-discovered package directories for static validation without a root workspace link or executable attachment build.
- [x] 3.3 Remove private `node_modules` source resolution and add shadow-package, absent-overlay, fixed-source-root, and packaged-no-fallback tests.
- [x] 3.4 Express public source-runtime bundling through package-owned/generated metadata and assert the Electron main artifact has no bare source-runtime import.

## 4. Internal Packaging and Release Safety

- [x] 4.1 Replace build/after-pack execution of supplier code with complete SciForge-owned static inventory, containment, and digest validation.
- [x] 4.2 Require trusted overlay installation evidence before source activation and packaging, and reject changed, extra, missing, escaping, wrong-version, or unreceipted resources.
- [x] 4.3 Add provider-neutral public Mac/Windows release guards that stop when internal runtime composition is non-empty before signing or upload.
- [x] 4.4 Verify clean public checkout and installed-overlay source/package flows remain deterministic and do not modify the public lockfile.

## 5. Documentation and Evidence

- [x] 5.1 Align Content Space/OpenContent ADRs, context, capability matrix, distribution guide, package READMEs, and the Chinese runbook with PoC/blocked states and the Project/Artifact boundaries.
- [x] 5.2 Record exact evidence requirements for per-operation promotion, atomic same-file CAS, immutable retention/version-specific retrieval, and UPDATE versus UPGRADE resolution.
- [x] 5.3 Regenerate domain composition and capability governance documentation and audit for private imports, raw clients, stale runtime artifacts, duplicate paths, and Host domain hard-coding.

## 6. Verification and Delivery

- [x] 6.1 Run focused Content Space, OpenContent Provider/Connector/runtime, internal packaging, release, and boundary tests plus package/root typechecks and changed-file lint.
- [x] 6.2 Build and smoke source Electron with and without an overlay, then build and inspect a packaged application through the canonical runtime path.
- [x] 6.3 Run full regression, OpenSpec strict validation, domain composition freshness, capability governance, and final diff/secret/private-asset audits.
- [ ] 6.4 Obtain the OpenContent test tenant, personal/shared roots, least-privilege accounts, and supplier CAS/version contract; run packaged Broker → Content Space → Provider → Connector live acceptance and promote only separately proven operations.
- [x] 6.5 Commit the scoped change and push only to the fork branch; do not update or push upstream.
