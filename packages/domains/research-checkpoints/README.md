# Research Checkpoints

`@sciforge/domain-research-checkpoints` automatically turns newly accepted,
completed chat turns into immutable `ResearchCheckpointManifestV1` Artifact
Versions. It owns recording/session bindings and its durable producer journal
only. Artifact bytes, Version identity, current pointers, comparison,
restoration, and bundles remain owned by `@sciforge/domain-artifact-versions`.

Recording policy defaults to enabled before the first provider delivery. The
Research Dossier exposes Start/Stop controls backed by the owner's canonical
status even before a recording exists, so Stop can persist a pre-first-turn
opt-out. A Stop receipt has `recording: null` when no recording exists. Start
re-enables the independent automatic policy without emitting a checkpoint
Version; the next accepted, completed turn creates v1. Turns while disabled are
never backfilled. Ordinary Terminal commands, ambient execution, and editor-only
changes are preserved as incomplete observations and never upgraded to
controlled or reproducible execution.

Status publishes a required nonnegative `policyRevision`. Start and Stop require
the caller's exact `expectedPolicyRevision`, and successful receipts return the
resulting revision. A stale control fails instead of overwriting a concurrent
policy decision; renderer consumers must then re-read canonical status. A
disabled delivery attempt persists a `skipped` decision with no recording or
binding snapshot. Replaying the same attempt after response loss remains skipped
even if policy later changes; only a newly issued attempt can use the new policy.

Historical chat is exposed through `research-checkpoints.legacy.preview` as
bounded turn summaries only. The UI selects exact turn IDs, asks the owner for a
selection-bound transcript digest, then passes that digest to the confirmed
legacy import. Import re-reads the durable transcript and fails closed if it
changed; imported records remain permanently `legacy/incomplete`.

## Trusted output boundary

Automatic trusted file attribution accepts only a complete, successful,
Host-authenticated Codex `apply_patch/fileChange` executor receipt. The receipt
must bind runtime, thread, turn, directive, call, executor sequence, normalized
workspace-relative path, patch/content, and the independently captured terminal
digest and byte length. Updates replay from the exact frozen before-turn parent.
A missing parent, ambiguous ordering, sensitive path, symlink, delete, terminal
mismatch, or ambient overwrite stays quarantined and does not advance an output
current.

External Terminal, IDE, PTY, ordinary `exec_command`, file watchers, recursive
workspace scans, Git diffs, mtimes, stdout, exit codes, and later hashes are
observations only. They remain `untracked/incomplete`; temporal correlation is
never promoted to producer causality.

The runtime uses the additive Artifact Versions V2 commit/list contracts for
deterministic identities and rich history. Existing Artifact Versions V1 action,
input/output, reference, receipt, issue, and selector wires are not extended by
this package. This split is required for strict `origin/gui` compatibility.

## Privacy, access, and capacity

New checkpoint and research-output candidates are workspace-visible and set
`allowExport: false`. Narrative, change reason, source URLs, tool summaries,
Git references, and journal errors are structurally redacted and passed through
the Host opaque-secret sanitizer before durable identity or digest creation.
URL userinfo and fragments are removed, and credential-like query parameters
are redacted. This protects configured secrets and common credential shapes; it
is not a general content-DLP system.

The producer store has a hard serialized-size limit. Before provider delivery,
the Host persists an installation `issuerEpoch`, a monotonic attempt ordinal, a
random `deliveryAttemptId`, and a workspace-bound boundary lease in Turn
Artifact Outbox V4. An enabled lease atomically binds one `recordingId` and its
exact output-binding snapshot; there is no global binding revision or history.
Outbox V4 remains the durable owner across pending start, accepted watch,
completed intent, and terminal settlement. Settlement delivery is retried at
least once until its durable consumer receipt exists.

A pending start is never recovered by scanning text or historical turns. Only
the authoritative handle returned by provider acceptance binds it automatically.
If acceptance is ambiguous, generic governed list/resolve/release operations are
required: they validate runtime/thread/workspace scope, and resolution also
verifies the exact provider turn plus user-message item before binding.

A completed turn consumes the lease after the artifact event is durably
enqueued. Authoritatively failed, cancelled, or explicitly released delivery
releases it. An ambiguous provider delivery remains durably owned and fail
closed until Host evidence can reconcile it; ambiguity is never converted to
rejection. Startup validates the complete Host snapshot: an issued ordinal must
remain owned/receipted or appear in an exact retired range. Missing gaps and a
retired-but-open lease are corruption, never implicit release. For consecutive
turns, a locally verified but not-yet-committed output is frozen as a
deterministic pending predecessor overlay in the following lease snapshot.

After lifecycle and artifact-delivery acknowledgements are both durable, bounded
receipts may retire into exact ordinal ranges for the same `issuerEpoch`. Issued
ordinals must be present as an owner/receipt or in those exact retired ranges;
missing gaps are corruption, not implicit release. There is no Bloom filter or
time cutoff. Retry scheduling is isolated per runtime/thread, so one unresolved
pending gap does not block unrelated threads.

After commit, the journal keeps a minimal summary and exact ref; canonical
manifest bytes are loaded from Artifact Versions by exact Version ID and full
ref verification. It never falls back to current or latest.

## Verification

Run the package checks from the repository root:

```bash
npm --workspace @sciforge/domain-research-checkpoints run test
npm --workspace @sciforge/domain-research-checkpoints run typecheck
```

The final staged-equivalent tree passed focused and repository-level tests,
production build, source/packaged Electron, policy-revision CAS, skipped replay,
provider-accepted/governed pending recovery, issuer/ordinal ownership,
at-least-once settlement, double-ACK exact retirement, per-thread isolation,
ambiguous delivery, pending predecessor overlay, package composition and
capability governance. Dependency audit and remote mergeability are recorded
separately in PR #63. See the Chinese guide:
[产物与版本管理](../../../docs/research/artifact-versioning-and-research-checkpoints.zh-CN.md).
