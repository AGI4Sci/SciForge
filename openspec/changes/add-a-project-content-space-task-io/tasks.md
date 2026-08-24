# Implementation tasks: Project ContentSpace binding and typed Task file intent

## 0. Migration lineage checkpoint

- [x] 0.1 Freeze the exact upstream-v4, public-a-v5, and isolated-a-v9 source provenance and migration identities.
- [x] 0.2 Define fail-closed classification using ordered migration rows plus catalog fingerprints.
- [x] 0.3 Define a forward-only convergence contract without allocating the target migration number.
- [x] 0.4 Prove all source classifiers on PostgreSQL 17, then allocate target version 11.

## 1. Contracts

- [x] 1.1 Define strict `ProjectContentSpaceBinding`, authorization-proof locator, binding revision, and digest contracts.
- [x] 1.2 Define provider-neutral Cloud `ResourceRef` and typed `TaskFileIntent` variants with bounded payloads.
- [x] 1.3 Make `fileIntent` the only caller-authored Task file truth and reject caller-supplied `resourceRefIds`.
- [x] 1.4 Define the sole execution fence as `executionId + assigneeAgentId + taskRevision + bindingRevision + intentDigest`.

## 2. Canonical collaboration service

- [x] 2.1 Validate E/Host authorization proof under the current Principal before binding or revising a Project.
- [x] 2.2 Derive and persist Cloud ResourceRefs atomically from typed file intent.
- [x] 2.3 Persist and enforce the execution fence on accept, progress, result, failure, unbind, and reassign paths.
- [x] 2.4 Port only required A-owned OIDC, Device, Agent, and governed human-approval semantics.

## 3. Forward-only storage convergence

- [x] 3.1 Generate mechanical catalog fingerprints for the three accepted source routes.
- [x] 3.2 Add target migration 0011 with route-specific normalization and no old-number reuse.
- [x] 3.3 Add final fingerprint readiness validation and reject unknown/hybrid/partial ancestry.
- [x] 3.4 Update only canonical collaboration deployment assets.

## 4. PostgreSQL 17 and contract verification

- [x] 4.1 Run real PostgreSQL 17 fresh migration with zero skipped tests.
- [x] 4.2 Run real PostgreSQL 17 upstream-v4 and public-v5 upgrades with zero skipped tests.
- [x] 4.3 Run real PostgreSQL 17 isolated-v9 upgrade and exact schema-fingerprint convergence with zero skipped tests.
- [x] 4.4 Test concurrent binding, current-Principal proof binding, unbind/reassign fencing, typed intent derivation, and stale execution rejection.
- [x] 4.5 Run contract/server/domain typecheck, focused tests, package-boundary tests, lint, and generated-file freshness.

## 5. Release coordination

- [x] 5.1 Record provenance and withdraw isolated staging revision `910ef7e...` from candidate eligibility.
- [x] 5.2 Push the A-owned contract checkpoint and open PR #83 without deploying public infrastructure.
- [ ] 5.3 Give B the fixed contract commit SHA after the final contract checkpoint is published.
