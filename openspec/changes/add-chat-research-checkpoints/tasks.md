# Tasks: Add Chat Research Checkpoints

## 1. Version substrate and compatibility

- [x] 1.1 Add stable Artifact identity, immutable versions, CAS bytes, atomic multi-candidate commit, exact read/materialize/compare, restore-as-new and lifecycle events.
- [x] 1.2 Add bounded staging, range read, rich list/describe and directory Bundle contracts.
- [x] 1.3 Preserve every existing V1 action/input/output/issue/selector wire shape and move additive extensions to explicit V2 actions.
- [x] 1.4 Add write-ahead index/CAS/staging budgets, usage warning and zero-publish-side-effect rejection.
- [x] 1.5 Preflight legacy Registry migration capacity before writing migrated CAS/index state.

## 2. Host turn and file attribution

- [x] 2.1 Persist Host `issuerEpoch`, monotonic attempt ordinal and random attempt/pending-start before provider delivery, then establish its required workspace-bound boundary decision.
- [x] 2.2 Upgrade Turn Artifact Outbox to V4 ownership for pending-start/provider-accepted watch/completed-intent/terminal-settlement, at-least-once settlement, double-ACK exact ordinal retirement and per-thread retry isolation.
- [x] 2.3 Accept only complete successful Codex `apply_patch/fileChange` executor receipts with exact call/sequence/path/content closure.
- [x] 2.4 Strictly replay updates from the frozen before-turn parent and compare terminal digest/length; quarantine missing, ambient, deleted, sensitive or ambiguous effects.
- [x] 2.5 Keep Terminal, IDE, PTY, `exec_command`, watcher, Git-diff and post-hoc observations `untracked/incomplete`.

## 3. Research Checkpoints

- [x] 3.1 Add package contracts, recording-independent automatic policy with status `policyRevision` and expected-revision Start/Stop, status/read/list, producer journal, legacy import and restore-as-new.
- [x] 3.2 Atomically commit checkpoint plus independent trusted output histories and validate the complete returned receipt before local adoption.
- [x] 3.3 Add exact committed-manifest loading through Artifact Versions with full ref/digest/scope checks and no latest fallback.
- [x] 3.4 Sanitize narrative, reason, source URLs, tool summaries and all journal free text before digest/persistence.
- [x] 3.5 Default new checkpoint/output policy to workspace-only and `allowExport: false`.
- [x] 3.6 Atomically bind each enabled lease to its recording/exact snapshot, persist disabled attempts as replay-stable `skipped` decisions, and compact the committed journal without global binding history.
- [x] 3.7 Overlay locally exact-verified pending output predecessors into the next consecutive turn lease without waiting for Artifact commit or falling back to stale current.

## 4. Researcher UI

- [x] 4.1 Add exact Research Dossier activation and owner-projection checks.
- [x] 4.2 Keep ordinary chat free of recording controls and expose owner-backed Start/Stop only from Dossier, including waiting status before a recording exists.
- [x] 4.3 Prioritize findings, sources, outputs, version position and actionable limitations; collapse IDs/digests/receipts/codes as technical details.
- [x] 4.4 Hide empty/not-applicable pages and keep integrity, access, claimed-owner and blocking failures visible.
- [x] 4.5 Use only existing SciForge design tokens and exact preview/compare/restore navigation.

## 5. Production composition and lifecycle repairs

- [x] 5.1 Replace the shared `domain-runtime` invoker with a package-scoped invoker derived from authoritative generated composition for every domain runtime.
- [x] 5.2 Define a generic SDK/Broker grant for caller-selected Artifact/Version identity and remove every Artifact Versions check for a concrete Research Checkpoints domain ID.
- [x] 5.3 Use Host `issuerEpoch`, monotonic ordinal and random `deliveryAttemptId`; bind an enabled workspace lease atomically to `recordingId` plus exact snapshot.
- [x] 5.4 Bind pending-start automatically only from the authoritative provider-accepted handle; keep ambiguity durable and expose generic governed list/resolve/release with exact scope/turn/item verification.
- [x] 5.5 Reconcile issuer/ordinal owners against exact retired ranges, retire bounded receipts only after lifecycle+artifact ACK, use no Bloom/time cutoff, and isolate pending gaps by runtime/thread.
- [x] 5.6 Persist revisioned automatic policy separately from recording lifecycle; support waiting Stop with nullable recording, durable replay-stable skipped attempts, and Start re-enable followed by next-turn v1.
- [x] 5.7 Remove cross-domain private `src` imports from Checkpoint tests and remove the unused composer-status SDK contribution.

## 6. Privacy, capacity and package integration

- [x] 6.1 Add Host opaque-secret sanitizer injection and structural URL/credential redaction.
- [x] 6.2 Add Artifact and Checkpoint durable-store limits without automatic deletion of committed history.
- [x] 6.3 Install packages in main/renderer composition and regenerate the npm lock from package manifests.
- [x] 6.4 Regenerate and verify installed-domain/capability governance outputs after all V2 IDs are final.
- [x] 6.5 Run staged-equivalent secret, absolute-path, runtime-state and large-file hygiene scans. Scans are clean, and the seven unrelated worker CLI mode-only changes from `postinstall` were excluded.
- [x] 6.6 Bump `@sciforge/domain-sdk` to `0.2.0` and additive `@sciforge/domain-artifact-versions` to `1.1.0`, update all dependent ranges, package metadata, lock and generated composition consistently.

## 7. Historical baseline and final delivery gates

- [x] 7.1 Record the original pre-review clean-install, focused package tests/typechecks, root regression/typecheck/build and diff-check results as historical evidence only; they are not final acceptance for the repaired source.
- [x] 7.2 Record the original pre-review domain composition and capability governance results as historical evidence only.
- [x] 7.3 Record the original pre-review Electron flow results for automatic v1, V2 exact describe/list/range, compact Dossier entry, digest mismatch fail-closed and restart persistence as historical evidence only.
- [x] 7.4 Re-fetch latest `origin/gui`, verify the local merge base and review the original staged-equivalent diff.
- [x] 7.5 Update Chinese product/architecture documentation with the intended final architecture and explicit pending repair gates.
- [x] 7.6 Update the live PR body with the final architecture, removed controlled-script scope and final-source verification evidence after those gates run.
- [x] 7.7 Receive explicit user approval to implement, commit, push and update PR #63.
- [x] 7.8 Add a production-composition integration test that uses the real package-scoped invoker and authenticated `apply_patch/fileChange`, then proves output and checkpoint commit atomically without privileged test injection.
- [x] 7.9 Add final lifecycle integration tests for revisioned policy CAS, waiting Stop, skipped replay, issuer/ordinal ownership, accepted-handle-only binding, governed pending list/resolve/release, ambiguous retention, double-ACK exact retirement, ordinal-gap corruption, per-thread isolation, atomic snapshots, pending predecessor and next-turn v1.
- [x] 7.10 Pack Domain SDK, Artifact Versions and Research Checkpoints, install the tarballs into an empty project and run a public-export/minimal-composition smoke without workspace links.
- [x] 7.11 Rerun final-source package tests/typechecks, root tests/typecheck/build, changed-file lint, composition/capability governance, source and packaged Electron paths, diff and hygiene scans; record audit and remote mergeability separately.

Scientific Compute controlled-script beta has been removed from this change and requires a separate OpenSpec change and PR before implementation or release.
