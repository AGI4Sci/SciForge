## 1. Dependency and Gate Baseline

- [ ] 1.1 Complete/archive Content Space V1 and the separate `add-secure-provider-credentials` change; verify a stable Host Principal at required assurance.
- [ ] 1.2 Record formal OpenContent evidence for build/schema, per-user identity/authentication, Token lifecycle/revocation, session coexistence, metadata authorization, tenant isolation, and operation readiness.
- [ ] 1.3 Keep every network operation `blocked_by_contract` until its exact dependency and environment Gate passes.

## 2. Main-Only Package and Composition

- [ ] 2.1 Add the trusted compile-time main-only Connector with standard manifest, exact public exports, lazy lifecycle, tests/typecheck, and no renderer/Agent/MCP/sidecar.
- [ ] 2.2 Add or reuse a package-generic Host-mediated owner-scoped internal-service contract; expose only a non-callable Connector descriptor globally, register the internal-service implementation factory only through the private generic main-entry Host mediator, and issue the token-free facade only to the allowlisted trusted owner. This registration is neither `main.document-provider-factory` nor `main.content-space-provider-factory`.
- [ ] 2.3 Define no Document port, universal client, ContentSpaceProvider factory, portable codec/resolver, public capability, compatibility alias, or fallback.
- [ ] 2.4 Close and validate the complete service registration set before acquisition; test declaration/runtime version/location/owner mismatch, duplicate/missing/incompatible implementation, load-order independence, global raw-callable rejection, consumer impersonation, and source/packaged composition.

## 3. Connection, Credential, and Transport Foundation

- [ ] 3.1 Contribute reviewed OpenContent instances through `main.provider-instance-directory-entry`; bind Connector-private endpoint/tenant policy to the same exact reference and keep entries separate from per-Principal connection metadata and credential-store records.
- [ ] 3.2 Use only the owner-scoped secure-credential facade and implement the documented per-user Token/session state machine after evidence passes.
- [ ] 3.3 Pin trusted endpoint/tenant/TLS/redirect policy and runtime-validate every selected request, response, business result, error, cursor, and receipt.
- [ ] 3.4 Add timeouts, cancellation, bounds, rate classification, redaction, and explicit missing/ambiguous/reauthentication/superseded/revoked/disabled outcomes.

## 4. Content Space Port and Safety Gates

- [ ] 4.1 Return only bounded token-free transport facts needed by the adapter; expose no raw HTTP, Token, Cookie, credential record, DTO, endpoint, or business semantics.
- [ ] 4.2 Prove Content Space portable materialization uses its own resolver and pinned Provider; the Connector registers no competing resolver.
- [ ] 4.3 Keep production metadata/materialization blocked while known-ID BOLA, session coexistence, or object-level authorization remains unproven.
- [ ] 4.4 Return `outcome_unknown` for uncertain writes and never silently log in, blindly retry, choose another connection, or fall back.

## 5. Verification and Handoff

- [ ] 5.1 Run package tests/typecheck, credential contract tests, generator freshness, governance/boundary checks, lint, and source/packaged smoke.
- [ ] 5.2 Hand the Host-issued narrow facade to the separate OpenContent ContentSpaceProvider change with no UI/domain or OpenContent-specific Host coupling.
- [ ] 5.3 Keep cloud-space PoC admission as a later change that adds a trusted Content Space policy/audience Gate; keep Shared Documents/Document port/provider deferred.
