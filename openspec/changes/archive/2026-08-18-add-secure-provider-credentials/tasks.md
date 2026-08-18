## 1. Host Contract and Owner Binding

- [x] 1.1 Audit the existing `DomainMainPackageSecretStoreHost`, encrypted package storage, generated per-owner Host binding, all callers, and source-development behavior; identify exact gaps without creating a second secret path.
- [x] 1.2 Evolve the canonical owner-bound main-only package-secret facade with versioned provider record bindings, bounded use/status/errors, and required Host principal-assurance input; keep owner derivation in generated composition with no runtime owner parameter.
- [x] 1.3 Add architecture tests preventing renderer, Agent, business-domain, Host-private file, provider-specific IPC, and direct platform-storage access paths.
- [x] 1.4 Add architecture tests forbidding a second provider vault/store/facade and prove existing non-provider package-secret consumers still use the one canonical storage lifecycle.

## 2. Secure Storage Lifecycle

- [x] 2.1 Implement supported OS secure-storage adapters and fail closed for locked, unavailable, insecure, corrupt, or undecryptable states without plaintext fallback.
- [x] 2.2 Store only versioned secret material and binding identifiers; keep non-secret connection metadata outside the facility.
- [x] 2.3 Implement bounded owner-only secret use, atomic create/replace/delete, restart recovery, wrong-binding rejection, and immediate local invalidation.
- [x] 2.4 Add active/recent-secret registration to the canonical managed-log and trace redaction path with bounded retirement.

## 3. Security Tests

- [x] 3.1 Test forged owner, wrong node, wrong/current/absent principal, insufficient assurance, wrong instance/connection, cross-package access, and another-principal enumeration.
- [x] 3.2 Test interruption during replacement/deletion and prove restart yields exactly one committed or absent state.
- [x] 3.3 Run secret canaries through errors, logs, traces, diagnostics, renderer IPC, capability traffic, provider-mandated private HTTPS query URLs, every forbidden/public URL surface, and cross-node serialization.

## 4. Platform Acceptance

- [x] 4.1 Verify store/restart/use/rotate/delete/restart through the real Electron source-development application on the current supported development platform.
- [x] 4.2 Verify approved Windows/macOS/Linux backend policy and insecure/unavailable/unsupported fail-closed behavior with automated tests; keep installed/distribution package acceptance outside this open-source development change.
- [x] 4.3 Run Domain SDK typecheck/tests, generator freshness/tests, package-boundary tests, root regression tests, and changed-file lint.
