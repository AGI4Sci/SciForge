## 1. Dependency and Contract Baseline

- [ ] 1.1 Complete the `add-secure-provider-credentials` canonical Host facade and verify owner/Principal/node binding.
- [x] 1.2 Record the read-only `test3` contract probe for login, Token validation, who-am-I, personal root, Team list, and folder identity without persisting credentials.
- [x] 1.3 Pin unresolved create-folder/upload/download schemas with least-privilege test-account probes before admitting each write.

## 2. Package, Composition, and Enrollment

- [x] 2.1 Add the trusted compile-time Connector package with separate main and renderer entrypoints, exact manifest/generated composition, lazy lifecycle, and no Host vendor switch.
- [x] 2.2 Add a Human-only enrollment/status contract for bind, reauthenticate, and unbind existing accounts; prohibit account registration and Agent-supplied credentials.
- [x] 2.3 Implement unique node-local `(Principal, Provider Instance)` connection metadata and explicit replacement semantics using stable external user ID.
- [x] 2.4 Prove password ephemerality and that only the validated Token enters the owner-scoped secure credential facility.

## 3. Private Service and Trusted Instance

- [x] 3.1 Add or reuse one package-generic Host-mediated owner-scoped internal-service contract; publish only a non-callable descriptor and issue the facade only to the allowlisted adapter owner.
- [ ] 3.2 Validate missing/duplicate/incompatible descriptors, implementation ownership, consumer impersonation, load-order independence, and source/packaged composition.
- [x] 3.3 Contribute the reviewed non-secret OpenContent instance and bind the HTTPS endpoint, tenant/build expectations, limits, and UI/Agent audiences in Connector-private trusted policy.

## 4. Authentication and Transport

- [x] 4.1 Implement RSA-OAEP-SHA256 login, Token validity and who-am-I validation, status, reauthentication-required, supersession, logout/revocation reporting, and local unbind.
- [x] 4.2 Implement schema-pinned personal root, Team roots, folder metadata, and paginated child listing with current-Principal authorization.
- [x] 4.3 Implement create-folder, upload-new, and download two-stage transport with bounds, progress, cancellation, conflict, and `outcome_unknown`; never overwrite, rename, retry, or expose region URLs.
- [x] 4.4 Add timeouts, business-result validation, redaction, and bounded typed errors for unauthorized, unavailable, rate-limited, malformed, cancelled, and uncertain outcomes.

## 5. Verification and Handoff

- [ ] 5.1 Run package tests/typecheck, credential/security tests, generator freshness, governance/boundary checks, changed-file lint, regression tests, and source/packaged smoke.
- [x] 5.2 Hand only the token-free facade to `add-opencontent-content-space-provider-v1`; keep Content Space, Project, Workspace, and Shared Documents models out of the Connector.
- [x] 5.3 Verify the exact development profile with `test3`; use no administrator credential unless a separately approved setup step proves it necessary.
