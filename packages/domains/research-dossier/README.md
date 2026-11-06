# Research

Presentation-only SciForge entry that defaults to the installed research stage
view. It discovers the SDK `research.workspace` renderer extension after
composition publication, without importing another domain implementation.
Artifact versions, owner summaries and formal evidence are available on demand.
Historical compute references remain readable as unavailable owner records;
Scientific Compute is retired. It stores no records, owns no current pointer, and
never falls back to `latest`.

Research recording starts automatically at the Host pre-turn boundary. The
ordinary chat exposes no recording controls. The dossier recording-status
surface can persistently stop automatic recording and
explicitly start it again through the Research Checkpoints owner capabilities.
The same controls are available before the first record, so a researcher can
opt out before the next completed turn creates v1. Historical turns are never
silently backfilled; an explicit legacy import selects durable turns and
permanently marks the resulting record `legacy/incomplete`. A successful import
opens the exact committed Version ID and digest returned by the owner.

The status response carries the canonical `policyRevision`. Every Start/Stop
request supplies that exact value as `expectedPolicyRevision`; the owner rejects
stale controls instead of applying a lost update. The dossier disables the
control while the request is pending and re-reads canonical status after either
an owner receipt or an owner-reported error. It never advances policy locally
from the button click or receipt alone.

When the exact Artifact is a Research Checkpoint, the dossier calls the public
`research-checkpoints.read` capability with its exact Version ID (and recording
identity when present). It verifies the returned full `ArtifactVersionRefV1`
and immutable recording/turn scope before rendering the narrative, sources,
declared files, Artifact/Compute/Git references, untracked operations,
breakpoints, and applicable trust status. The default view prioritizes research
findings, sources, outputs, version position, reproduction state, and actionable
limitations; raw IDs, digests, receipts, and codes stay in collapsed technical
details, while empty or inapplicable sections are omitted. Owner unavailability
degrades only that projection; an identity or digest mismatch fails closed and
never substitutes a source, current, or latest Version.

Rich Artifact history is requested only through the additive Artifact Versions
`describe-v2`, `list-v2`, and `bundle.export-v2` actions. The dossier does not
add fields to the existing V1 list, export receipt, verification, issue, or
reference wires, preserving strict clients built from `origin/gui`.

## Researcher-facing presentation

Current-session records precede a collapsed list of other sessions and unknown
ownership. Grouping uses exact runtime/thread or recording identity; it does not
infer auxiliary purpose. Readable labels are presentation only. Immutable titles
and IDs remain available in row tooltips and exact reference details.

The stage owner retains selection, source navigation, discussions, annotations,
folding and global/sidebar presentation state. Opening a round uses the public
turn-status capability and exact Artifact version/digest navigation. Organization
coverage, byte integrity, formal evidence and reproduction remain separate.


The default dossier is a decision surface, not a provenance debugger. It keeps
the research summary, change reason, useful sources, outputs and previews,
version position, reproduction status, and actionable trust limitations visible.
Exact IDs, SHA-256 values, raw receipts, provider revisions, breakpoint codes,
and redundant owner fields remain available under collapsed technical details.
Empty or inapplicable Compute, Evidence, or Review sections are omitted.

Integrity and authorization are never hidden for visual simplicity. Access
denial, expected-content mismatch, exact owner scope/ref mismatch, unavailable
claimed evidence, failed reproduction, and blocking provenance limitations stay
visible and fail closed. The loader never substitutes current or latest data.

The ordinary chat is only an exact navigation surface. A committed turn may
render one neutral “打开科研档案” button bound to the Version ID and expected
digest; the expanded checkpoint, output cards, version badges, warnings, raw
identifiers, and recording status strip do not appear in the transcript or
composer.

Cross-domain callers do not import the dossier activation schema or name its
right-panel contribution. They send the generic renderer Host an exact resource
kind, resource ID, and optional SHA-256 integrity binding. This package owns the
single `renderer.resource-navigation` contribution for supported Artifact and
Compute identities and translates that request into its private panel
activation. Dossier-specific schemas and helpers are published only from the
package-owned `@sciforge/domain-research-dossier/contract` entrypoint.

## Verification

```bash
npm --workspace @sciforge/domain-research-dossier run test
npm --workspace @sciforge/domain-research-dossier run typecheck
```

These package commands are focused gates; repository typecheck, composition,
build, and real Electron checkpoint/Dossier tests remain release gates.

## Historical discovery and formal review

The history browser reads one `list-v2` page of 25 current versions per unfinished
research kind. Each kind keeps its own owner `nextBeforeSequence`; exhaustion of
one kind does not restart it, and a rejected page keeps its cursor and previous
records until an explicit continuation or refresh. The merged loaded set removes
duplicate Version IDs and orders by descending global sequence, then timestamp,
then Version ID for deterministic ties. A page of the loaded list mounts at most
25 rows. New batches can change loaded page boundaries; exact selection always
uses Version ID and expected digest, never the row index.

Search matches loaded titles, IDs and metadata only. It does not search file
contents or unread pages. The UI reports loaded/matching counts and per-kind
page coverage, and offers an explicit next batch for continuing the search.
Exhaustion means the accessible current-version query has no further owner
cursor; it does not establish full-history capture, authorization to hidden
records, a frozen snapshot, or a scientific verdict. Older revisions are reached
through the exact artifact history. Refresh starts new cursors to discover
new current records.

Opening an exact version bypasses the browse window. Its selected identity stays
visible even if it lies outside the first artifact history page. Returning to
history preserves loaded metadata, query, local page and scroll while this
Dossier panel remains mounted. Workspace/client/session changes isolate the
cache and ignore late reads; a new exact target also hides the previous target
while loading. Closing/unmounting the panel does not persist this browsing state.

Formal Evidence review is an explicit read through the SDK's existing
`evidence-dag.audit-query` contract with the complete ArtifactVersionRef. The
projection rejects another artifact/version/digest, displays freshness, coverage
gaps, reviewer identity and owner payloads, and requests closure navigation only
through `workbench.openResource`. No review, approval, model run or fact write is
performed by browsing or querying. Execution, provenance, control, replication
and Evidence remain separate axes. The receiving Evidence viewer owns exact
closure validation; requesting navigation does not prove that viewer displayed
the requested historical closure.

See [history design](../../../docs/design/research-dossier-history.md) for
contracts, boundaries and integration checks.

See the Chinese guide:
[产物与版本管理](../../../docs/research/artifact-versioning-and-research-checkpoints.zh-CN.md).


## Owner-backed historical metadata search

The archive queries `artifact-versions.list-v2` with `currentOnly: false` and
`metadataQuery`, then continues each kind with the owner's `nextCursor`.
Search covers accessible historical metadata, including versions absent from
the first displayed page; it does not search file contents. Presentation page
controls only divide returned results. Changing the search resets owner cursors;
changing workspace, runtime, session or client invalidates pending results and
cached scope. Errors leave successful pages visible and the failed owner stream
available for explicit continuation. Exact selection retains the returned
Version ID and SHA-256; there is no current/latest substitution.

Formal Evidence reads validate the full canonical ArtifactVersion reference,
including policy, byte length, media type, retention and availability. Late
responses after a scope, invoker, active-state or document-visibility change
cannot populate the new review.

The formal Evidence impact entry renders the Evidence package's shared rerun
review component. A researcher selects an affected conclusion and explicitly
requests its spec. Evidence resolves the immutable closure-to-Snapshot binding,
authorizes the thread workspace and reads the existing Python owner. No latest
Snapshot fallback is allowed. Spec preview and download execute nothing. The
explicit start button uses Create Loop's existing governed execution capability
with confirmation; execution readiness is not authorization. Refusal, failure and
unknown transport outcomes remain visible. Candidate comparison requires an
explicit exact Snapshot digest and conclusion in the same owner thread and
returns to the currently selected exact ArtifactVersion review. Recorded
comparison output is not scientific proof.

Coverage disclosures show the owner index revision, indexed/scanned/relevant
counts, bounded reasons and continuation cursor. Source-retention usage and
single-source export are presented by the owning Evidence research-record UI;
unknown usage is never displayed as zero. Export preserves raw/ref/digest for
one authorized retained source representation and never deletes originals or
claims full-archive migration.
