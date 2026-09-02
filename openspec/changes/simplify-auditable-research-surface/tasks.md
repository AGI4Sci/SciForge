## Delivery rule

This is a program-level blueprint. Implement Stages 1-4 as separate OpenSpec changes and PRs. A stage may start only after the previous stage's migration/deletion gate passes. Do not create dual-read, dual-write, compatibility-alias, or Host domain-switch paths to make stages coexist.

## 0. Baseline and contract inventory

- [ ] 0.1 Inventory every caller, public contract, manifest contribution, queue/worker, sidecar, renderer, command, event, and exact resource kind for Research Dossier, Scientific Plotting, Artifact Versions, Evidence DAG, Project DAG, Review, Decision, Release, and Agent routing.
- [ ] 0.2 Record the canonical owner and write path for Artifact identity/version, model receipt, Plot render, Evidence delta/head/closure, Project Goal/Scope/Snapshot, Finding/Review event, Decision, Approval, Release, and Runtime authorization.
- [x] 0.3 Add architecture tests that prevent a Research aggregate store, duplicate current pointer, Host feature map/domain switch, cross-package private import, alternate write path, and formal reference to `latest`, `current`, a mutable path, or a display label.
- [x] 0.4 Define only the missing generic/public contracts: `renderer.research-summary.v1`, exact resource-navigation kinds, `ProjectSnapshotIdentity`, typed Release Artifact refs, governed operation state, and minimal append-only decision records.
- [x] 0.5 Update glossary and ADRs first; use `Research Surface`, `Research Artifact`, `Evidence Delta`, `Sealed Evidence Closure`, `Research Project`, `Project View`, `Project Snapshot`, and `Decision Packet` consistently.

## 1. Research Surface and contextual navigation

- [x] 1.1 Rename the ordinary Research Dossier toolbar entry and title to `Research`; preserve checkpoint/compute-run loading and recording controls.
- [x] 1.2 Add `renderer.research-summary.v1` to Domain SDK with stable ID, generic slot, order, applicable scope/resource kinds, bounded owner provider, unavailable state, and exact navigation actions.
- [x] 1.3 Make Research Dossier enumerate installed summary contributions without owner schema knowledge, persistence, client-side permission filtering, arbitrary package UI mounting, or domain-ID branches.
- [x] 1.4 Add owner contributions for Goal/Scope, Evidence freshness/coverage/risk, recent root Artifacts, and pending decisions. Owners authorize and filter every read.
- [x] 1.5 Add/complete exact Figure/render-manifest, Claim/Source Anchor/Evidence closure, Workspace Project/Snapshot, and Artifact-history resource navigators inside the existing Session-owned right-panel dock.
- [x] 1.6 Prove every Artifact history/restore/compare/materialize/export/bundle verify/import path has contextual owner navigation before removing the standalone Artifact Versions renderer.
- [x] 1.7 Remove peer toolbar entries for Scientific Plotting, Evidence DAG, Project DAG, and Artifact Versions; remove duplicate Dossier Evidence UI, ordinary rebuild controls, orphaned commands, and obsolete tests without aliases.
- [x] 1.8 Verify installed/uninstalled packages, composition conflict detection, access-filtered/unavailable summaries, exact back/forward navigation, hidden Session residency, source and packaged composition, type safety, lint, and focused UI tests.

## 2. Figure and Research Artifact experience

- [x] 2.1 Group supporting recipe/code/data/manifest/log Artifact Versions beneath the root Figure/Report/Dataset presentation while preserving each supporting Artifact's independent identity and canonical Artifact Versions actions.
- [x] 2.2 Make Figure preview the first view and expose `Preview | Reproduce | Evidence | Versions`, with raw digests/manifests in Technical Details.
- [x] 2.3 For code/hybrid formal renders, commit executable Code, Figure, Recipe, Data refs, Manifest, and Log as exact Artifact Versions; execute the committed Code Artifact copy and keep one rerun/compare path.
- [x] 2.4 For model-owned renders, keep the receipt in the image-generation owner and store effective Prompt/hash, public model/version, parameters, references, available seed, renderer, recipe, and review refs; label the result replayable unless byte determinism is proven.
- [x] 2.5 Represent external paper Figures as source-located Artifacts with exact Source Anchors; never fabricate code or a model receipt.
- [x] 2.6 Persist generic governed-operation route state and require explicit plot-provenance requests to satisfy the Scientific Plotting output contract across compression, retry, and handoff; record any user-authorized downgrade.
- [x] 2.7 Verify old Versions without Code Artifacts, missing/restricted dependencies, failed rerun, bundle round-trip, code/hybrid reproduction, model replay, external source Figure, and source/packaged routes.

## 3. Evidence delta, provisional view, and formal seal

- [ ] 3.1 Create a separate OpenSpec change for this stage. Define immutable delta/head identities, deterministic `EvidenceClosurePolicyV1`, stable gap codes, semantic-assessment independence metadata, exact compact summary, and `seal if expectedHeadDigest`.
- [x] 3.2 Inventory all Evidence readers/writers and migrate the canonical completed-turn/execution path to one delta queue/worker with predecessor/payload digests, exact scope/refs, schema/extractor/verifier identity, and idempotency.
- [x] 3.3 Implement one disposable provisional compiler with desired/applied head, complete input fingerprint, last-good view, freshness, coverage, risk, last success, and bounded failure. Keep graph layout and summaries non-authoritative.
- [x] 3.4 Seal only Evidence-owned records plus exact external refs reached by the declared closure policy. Include contradiction, negative result, failed replication, shared ancestry, access breakpoints, and incomplete lineage; never copy Project Goal, Scope, Decision, Approval, or Release facts.
- [x] 3.5 Append independent assessment and correction records; do not allow a Claim-producing invocation to count as its independent verifier.
- [x] 3.6 Append Audit/Finding/Review/Decision/Approval as sidechains referencing the sealed digest; never backfill the record being created into the same closure.
- [x] 3.7 Migrate existing Snapshots byte-for-byte as `legacy_checkpoint_root`; use `legacy/incomplete` when ancestry cannot be proven. Transactionally build/verify new heads, switch the canonical reader/writer without dual paths, then delete per-turn full-Snapshot fan-out.
- [x] 3.8 Verify chain corruption/regression/replay drift, crash recovery, last-good failure behavior, closure anti-cherry-picking, stale-head CAS, independence, correction/retraction, legacy roots, export, ordinary retention readiness, and source/packaged runtime.

## 4. Workspace Project, decisions, and release governance

- [ ] 4.1 Create a separate OpenSpec change for this stage. Keep exactly one Research Project per canonical Workspace; do not add create/list/select/active-project state.
- [x] 4.2 Implement Goal draft/apply and revisioned desired Scope with included/excluded/isolated Sessions and reasons. First initialization visibly includes the current Session; recommendations never change Scope until applied.
- [x] 4.3 Make the one Project compiler accept only exact Goal Version, complete captured Scope, Evidence head/closure vector, policy/compiler identities, and live lifecycle/access revisions. Remove implicit Workspace scans and duplicate membership authority.
- [x] 4.4 Implement `ProjectInvalidationPolicyV1`; unknown fingerprint changes are material at formal gates. Upstream events mark the Project stale while its surface is closed and never trigger eager compilation.
- [x] 4.5 Derive on open, applied Goal/Scope, explicit user/Agent synthesis, retry, or formal barrier. Keep one last-good cache keyed by the complete authorized input fingerprint.
- [x] 4.6 Seal a Project Snapshot with exact expected-head CAS before Decision, Review, Approval, Release, export, or formal comparison; preserve shared-source/independence, exclusions, gaps, conflicts, and typed Artifact refs.
- [x] 4.7 Add minimal append-only `DecisionV1`, `ApprovalV1`, and `ReleaseV1` records plus `FindingEventV1` and `ReviewEventV1`. Migrate existing records as legacy roots; derive status and expiry instead of mutating records.
- [x] 4.8 Enforce action classes: Agent decisions for formal internal reversible choices; at least one accountable human for every certified/public release; installed policy role slots/quorum for specialized high-impact actions; `blocked_by_policy` when trusted roles cannot be established.
- [x] 4.9 Keep Runtime authorization separate and re-evaluate current Principal, trusted roles, ACL, consent, purpose, and target authorization at read/export/action time.
- [x] 4.10 Migrate existing Project Snapshots without rewriting bytes/digests, switch canonical readers/writers without dual paths, delete automatic per-Evidence compilation and redundant status/retry paths after readiness.
- [x] 4.11 Verify Goal reframe, Scope exclusion of negative results, vector regression, stale/open derivation, last-good cache, shared ancestry, seal CAS, legacy roots, Decision reversal, Approval expiry/revocation, candidate-to-certified append, restricted export, consent change, policy block, and source/packaged runtime.

## 5. Final verification and deferred work

- [x] 5.1 Run generated-composition freshness, capability governance, package-boundary/private-import scans, changed-file lint, web/node typecheck, focused package tests, full regression, production build, and packaged-domain validation for each stage.
- [ ] 5.2 Use Computer Use for end-to-end acceptance: standalone Figure, source paper Figure, code/hybrid rerun, model replay, multi-Session Scope with negative result/shared source, stale Evidence, Goal reframe, failed rerun, retracted source, Approval expiry, critical certified release, and ACL/consent withdrawal.
- [x] 5.3 Audit and delete old entrypoints, compatibility aliases, duplicate stores/current pointers, Host hard-coding, dead schemas, queues, sidecars, renderer files, commands, tests, dependencies, and outdated documentation before each stage is complete.
- [ ] 5.4 Do not implement multi-Project-per-Workspace identity, cross-Workspace Project identity, discipline-specific role sources, named Release series, or distributed legal/privacy purge in this program. Each requires a separate decision and OpenSpec change.
