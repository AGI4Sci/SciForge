# Implementation tasks: Project ContentSpace binding and typed Task file intent

## 0. Migration lineage checkpoint

- [x] 0.1 Freeze the exact upstream-v4, public-a-v5, and isolated-a-v9 source provenance and migration identities.
- [x] 0.2 Define fail-closed classification using ordered migration rows plus catalog fingerprints.
- [x] 0.3 Define a forward-only convergence contract without allocating the target migration number.
- [ ] 0.4 Prove all three source classifiers on PostgreSQL 17, then allocate a target version greater than 10.

## 1. Contracts

- [ ] 1.1 Define strict `ProjectContentSpaceBinding`, authorization-proof locator, binding revision, and digest contracts.
- [ ] 1.2 Define provider-neutral Cloud `ResourceRef` and typed `TaskFileIntent` variants with bounded payloads.
- [ ] 1.3 Make `fileIntent` the only caller-authored Task file truth and reject caller-supplied `resourceRefIds`.
- [ ] 1.4 Define the sole execution fence as `executionId + assigneeAgentId + taskRevision + bindingRevision + intentDigest`.

## 2. Canonical collaboration service

- [ ] 2.1 Validate E/Host authorization proof under the current Principal before binding or revising a Project.
- [ ] 2.2 Derive and persist Cloud ResourceRefs atomically from typed file intent.
- [ ] 2.3 Persist and enforce the execution fence on accept, progress, result, failure, unbind, and reassign paths.
- [ ] 2.4 Port only required A-owned OIDC, Device, Agent, and governed human-approval semantics.

## 3. Forward-only storage convergence

- [ ] 3.1 Generate mechanical catalog fingerprints for the three accepted source routes.
- [ ] 3.2 Add one target migration above historical version 10 and route-specific normalization with no old-number reuse.
- [ ] 3.3 Add final fingerprint readiness validation and reject unknown/hybrid/partial ancestry.
- [ ] 3.4 Update only canonical collaboration deployment assets.

## 4. PostgreSQL 17 and contract verification

- [ ] 4.1 Run real PostgreSQL 17 fresh migration with zero skipped tests.
- [ ] 4.2 Run real PostgreSQL 17 upstream-v4 and public-v5 upgrades with zero skipped tests.
- [ ] 4.3 Run real PostgreSQL 17 isolated-v9 upgrade and exact schema-fingerprint convergence with zero skipped tests.
- [ ] 4.4 Test concurrent binding, unbind/reassign fencing, typed intent derivation, and stale execution rejection.
- [ ] 4.5 Run contract/server/domain typecheck, focused tests, package-boundary tests, lint, and generated-file freshness.

## 5. Release coordination

- [ ] 5.1 Record or withdraw isolated staging revision `910ef7e...` based on source/image/database provenance and retained backup receipts.
- [ ] 5.2 Push the A-owned contract checkpoint and open a PR without deploying public infrastructure.
- [ ] 5.3 Give B the fixed contract commit SHA only after the checkpoint is immutable and published.
