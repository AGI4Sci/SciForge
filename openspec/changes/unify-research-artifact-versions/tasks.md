## 1. Artifact Version domain

- [x] 1.1 Define stable Artifact, immutable Version, exact ref, transaction, dependency, policy, lifecycle, and issue contracts.
- [x] 1.2 Implement CAS bytes, atomic multi-candidate commit, optimistic concurrency, semantic-version dedupe, read/list/compare, materialize, and restore-as-new.
- [x] 1.3 Implement exact dependency-closure bundle export/import/verify and Artifact History UI.
- [x] 1.4 Complete and test one-time legacy Evidence Registry migration.

## 2. Evidence integration

- [x] 2.1 Replace the live Evidence Registry write path with exact Artifact Version projections.
- [x] 2.2 Persist a proactive lifecycle cursor/receipt consumer and regenerate affected immutable Evidence Snapshots.
- [x] 2.3 Version fixed-snapshot PROV, RO-Crate, DataCite, audit, and reproduction reports through Artifact Versions.

## 3. Scientific plotting and review

- [x] 3.1 Commit derived data, recipe, PNG, manifest, and log atomically with explicit statistics and lineage.
- [x] 3.2 Rerun from exact CAS refs, classify replication, and validate two SciForge fixtures including clean-room bundle reproduction.
- [x] 3.3 Add plotting provenance UI and remove parallel plotting business MCP/IPC paths.
- [x] 3.4 Finish durable, idempotent Visual Review post-commit activation recovery.

## 4. Verification and evidence

- [x] 4.1 Regenerate installed-domain composition and capability governance outputs.
- [x] 4.2 Run package and repository typecheck, tests, production build, and source/packaged capability-path checks.
- [x] 4.3 Finalize the Claude Science capability matrix with separate promotion, documentation, static, and fixture evidence.

## 5. Merge-readiness audit fixes

- [x] 5.1 Verify every externally supplied `ArtifactVersionRefV1`, including prebuilt ready projections, through the workspace-scoped authoritative read before Evidence marks it ready or tracks its lifecycle identity.
- [x] 5.2 Require explicit bundle export selection and verify complete canonical dependency refs, linear histories, unique sequences, and an acyclic parent/dependency graph before verify or import succeeds.
- [x] 5.3 Update the adoption record and run focused package checks, repository regression tests, capability governance, lint, and production build.
