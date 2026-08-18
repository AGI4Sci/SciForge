## 1. Generic Contracts

- [x] 1.1 Define the exact bounded envelope, canonical serialization, closed errors, codec contract, resolver contract, and safe export projection in the public Domain SDK.
- [x] 1.2 Reject extra/sensitive/local fields, runtime handles, accessors, non-plain and polluted prototypes, unsupported values, and every configured bound.
- [x] 1.3 Bind codec and resolver declarations/runtime values by generic `main.extension` location, version, kind, resolver ID, and trusted owner.

## 2. Materialization and Export

- [x] 2.1 Validate envelope, codec, exact resolver binding, and trusted Provider Instance before any provider or network operation.
- [x] 2.2 Use Host-injected current Principal and the canonical Broker resource issuance path; re-check cancellation and Principal lease before issue.
- [x] 2.3 Reauthorize observations and Artifact immutable proof instead of treating first materialization as perpetual authority.
- [x] 2.4 Derive export consumer identity from owner-scoped composition and bind bounded collision-safe export state to Broker retirement.

## 3. Architecture and Verification

- [x] 3.1 Prove unknown/duplicate/forged authority, resolver mismatch, prototype attacks, Principal changes, cancellation, revoked access, and cross-node handles fail closed.
- [x] 3.2 Prove no business-resource union, central Provider/vendor/domain routing, parallel Broker/IPC/MCP, or Host-private domain import.
- [x] 3.3 Run SDK and Host tests/typecheck, generated-composition freshness, governance/boundary checks, changed-file lint, regression, and source/packaged smoke.
