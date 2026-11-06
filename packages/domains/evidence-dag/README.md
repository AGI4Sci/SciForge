# `@sciforge/domain-evidence-dag`

Installed Evidence DAG domain package. This package is the single ownership,
versioning, installation, and release boundary for the Python Evidence engine,
durable update state, public contracts, main-process lifecycle, generic artifact
ingestion, and optional renderer panel.

Human review packets bind to a deterministic digest of the scientific graph,
artifact registry, access policy and current checks. Changing evidence creates a
new review identity even when target IDs and severity codes stay the same. An
unchanged recomputation preserves the existing decision. Old approved packets
remain audit history, not approval of new material. The current implementation
conservatively binds the whole graph; unrelated material changes can also require
another review. Incremental updates rebuild the current check projection without
appending duplicate assessments to the ledger.

The package intentionally has no root export. Consumers select one public
boundary:

- `./definition` validates the installed-domain manifest and exposes contribution declarations.
- `./contract` contains process-neutral Zod schemas and inferred types.
- `./main` is the privileged process entrypoint.
- `./renderer` is the renderer entrypoint.

The canonical status contract keeps the last committed snapshot separate from
the pending delta. A pending failure therefore remains observable without
making an already committed graph unavailable. Host code composes the declared
contributions generically and does not import package-private implementation.

## Python Evidence engine

Thread-scoped Evidence compiler for SciForge. Ordinary completed turns and executions append visible runtime trace deltas to the Evidence delta store; an explicit update or formal boundary may compile those records into an immutable Evidence Snapshot. The package-owned engine links SourceAssertions to structured SourceAnchors and versioned Artifacts and executes A0-A2 review. Audit is a read-only side chain over a selected committed snapshot.

The package follows [`ADR-0043`](../../../docs/adr/0043-derive-research-graphs-and-seal-formal-baselines.md)
and the [`Research Artifacts context`](../../../docs/contexts/research-artifacts/CONTEXT.md). There is no direct ingest,
verify, inline-audit, or mutable PROV import route.

## Core contracts

- Semantic nodes use domain-separated normalized semantic IDs. Artifact bytes use separate `sha256:` content digests.
- The canonical source node type is `source_assertion`.
- A SourceAssertion PROV entity links through `edag:artifact_id`, `edag:artifact_version_id`, and `edag:source_anchor_id`.
- `edag:artifactRegistry` is the historical snapshot projection key. New snapshots may also contain exact `artifactVersionRefs`; it is not a writable Registry.
- SourceAnchor selectors are structured (`pdf|text|table|figure|code|dataset|web`) and carry a digest of the selected content.
- The main-process adapter commits only explicit reference candidates with locator, digest, and byte length, or consumes an already-pinned `ArtifactVersionRefV1`. The Python compiler never opens a locator, hashes a file, creates an Artifact identity, or rebinds a version.
- Missing, incomplete, or ambiguous artifact provenance remains `pending`/`failed` and fails closed at L0. Chat/agent summaries and raw tool receipts are never promoted into scientific Artifacts.
- Artifact identity, version commits, access policy, source availability, moves, and content-change detection are owned by `@sciforge/domain-artifact-versions`. On activation and on a bounded background interval, Evidence drains that durable lifecycle outbox to empty by workspace. Evidence persists its sequence cursor, exact thread/version associations, and idempotent delivery receipts in `artifact-version-lifecycle.json`; a cursor advances only after every affected thread delta is durably accepted by the Evidence delta store. Restart replays the same receipt safely. Missing/content/current-change events mark affected current projections stale, moves require review, and old snapshots and pinned IDs/digests are never rewritten.
- A producer package publishes immutable `pending` receipts under `.sciforge/evidence-dag/inbox/<producer>/<sha256(operationId)>.json` after committing its artifacts as Artifact Versions. The receipt and the delivery receipt are defined once, in the public contract entry (`@sciforge/domain-evidence-dag/contract`: `evidenceProducerReceiptV1Schema`, `evidenceProducerDeliveryReceiptV1Schema`, `evidenceLineageV1Schema`); producers import those instead of copying the shape, and the node-only path helpers are in `@sciforge/domain-evidence-dag/producer-inbox`. A producer without its own adapter uses the producer-neutral receipt (`producer`, `operationId`, `toolName`, named `commitRefs`, `evidenceLineage`); Scientific Plotting keeps its role-named receipt through a registered adapter. Evidence validates the routed thread and workspace, every committed ref, every lineage ref, and the stored bytes before appending a synthetic structured trace to the Evidence delta store. It then writes a separate delivery receipt under `.sciforge/evidence-dag/delivery-receipts/<producer>/`. `committed` means the delta append is durable, not Evidence Snapshot or L4 completion. Delivery receipts persisted by earlier consumers (`state: "enqueued"` with a `jobId`, written before 2026-09-02) share `schemaVersion: 1`, are still read, and count as delivered; they are never rewritten. Missing services or threads and any scope or digest mismatch leave the producer receipt pending for restart-safe retry.
- A0, A1, and A2 assessments are append-only records bound to the committed snapshot digest. A1/A2 use prompts and context independent from extraction.
- ExperimentRun, AnalysisRun, DatasetVersion, SoftwareVersion, Environment, Observation, Artifact, and Agent are first-class source-layer objects. PROV export maps runs to `activity`, actors to `agent`, and other records to `entity`; `used`, `wasGeneratedBy`, `wasDerivedFrom`, `wasAssociatedWith`, and `wasAttributedTo` retain their native PROV-JSON forms.
- Evidence v3 adds first-class ParameterSet, ToolInvocation, ApprovalDecision, WorkflowRun, and Conclusion nodes. Existing Artifact/SoftwareVersion nodes carry `semanticRole` for input, output, code, or Evidence instead of duplicating node types. `part_of`, `authorized_by`, and `rerun_of` complete executable and governance lineage.
- Lineage edges have explicit families. Causal provenance and version relations are cycle-checked; contradiction, identity, and replication relations may cycle by design.
- A Finding is promoted to `L4` only when every linked run has a stable visible run record, verifiable input, exact software, an explicit parameter map, a verifiable environment, and verifiable log/output ArtifactVersions. Stochastic runs additionally require an explicit random seed. Missing metadata becomes a named provenance breakpoint and is never inferred from prose.
- `EvidenceUpdateQueued`, `EvidenceSnapshotCommitted`, `AuditCompleted`, and `FindingOpened` form the Evidence-owned durable idempotent outbox. Historical `ArtifactMoved`/`ArtifactContentChanged` mirrors remain readable, but new artifact lifecycle events are written only by Artifact Versions.

## Structured run lineage

Visible `tool_result` / `function_result` / `tool_output` items can declare a canonical `evidenceLineage` envelope. This deterministic contract is processed independently of semantic LLM extraction:

```json
{
  "evidenceLineage": {
    "activity": {
      "id": "analysis-run-42",
      "type": "analysis_run",
      "name": "Primary analysis",
      "status": "completed",
      "parameters": {"alpha": 0.05},
      "stochastic": true,
      "randomSeed": 734
    },
    "inputs": [{
      "id": "dataset:measurements:v2",
      "type": "dataset_version",
      "name": "Measurements v2",
      "artifact": {
        "kind": "dataset",
        "locator": "data/measurements-v2.csv",
        "contentDigest": "sha256:<64 hex>",
        "byteLength": 1234
      }
    }],
    "software": [{
      "id": "software:analysis-package",
      "name": "analysis-package",
      "version": "3.4.1",
      "commit": "15b34a2c46bd9f78"
    }],
    "environment": {
      "id": "environment:container",
      "name": "OCI environment",
      "containerDigest": "sha256:<64 hex>"
    },
    "logs": [{
      "id": "artifact:run-log",
      "name": "run log",
      "artifact": {"kind": "log", "locator": "logs/run-42.log", "contentDigest": "sha256:<64 hex>", "byteLength": 321}
    }],
    "outputs": [{
      "id": "artifact:result-table",
      "type": "artifact",
      "name": "result table",
      "artifact": {"kind": "dataset", "locator": "results/table.csv", "contentDigest": "sha256:<64 hex>", "byteLength": 456}
    }],
    "agents": [{"id": "agent:stats-worker", "name": "Statistics worker", "agentType": "software_agent"}],
    "relations": [
      {"src": "finding:<semantic id>", "dst": "analysis-run-42", "rel": "generated_by"}
    ]
  }
}
```

Every object requires an explicit stable `id`. Inputs require an explicit `type`; section semantics supply fixed types only for software, environment, logs, outputs, and agents. Optional `relations` may declare `extracted_from`, `used`, `generated_by`, `derived_from`, `associated_with`, `attributed_to`, `version_of`, `supersedes`, `replicates`, `fails_to_replicate`, `same_as`, or `invalidates` using envelope IDs or existing graph node IDs. Unknown, ambiguous, dangling, cyclic causal, and unstructured relations are dropped rather than guessed.

Every committed PROV document contains `edag:meta.snapshot`:

```json
{
  "threadId": "runtime-qualified thread id",
  "version": 1,
  "digest": "sha256:...",
  "inputWatermark": "runtime item id",
  "schemaVersion": "evidence.v3",
  "extractorVersion": "extractor.v3",
  "verifierVersion": "verifier.v3",
  "artifactDigests": [],
  "createdAt": "timestamp",
  "status": "committed"
}
```

Latest files use the shared collision-resistant filename contract exported by `evidence_dag.snapshot.snapshot_filename(thread_id)`. Historical versions are stored under `snapshots/<snapshot_storage_key(thread_id)>/` and never rewritten. New snapshots are exact immutable manifests over content-defined, SHA-256-addressed chunks in `snapshot-blobs/v1/`; unchanged graph regions are reused across versions and `latest` is atomically linked to the committed manifest. Consumers must read snapshots through `evidence_dag.snapshot_storage` so both this format and existing full-PROV user data are integrity-verified without migration or deletion.

## RO-Crate exchange

`evidence_dag.rocrate` exports one exact committed Evidence Snapshot as a
reference-first RO-Crate. The metadata represents Evidence nodes, the Artifact
Registry, ArtifactVersions, structured SourceAnchors, assessments, and
ExperimentRun/AnalysisRun lineage. Runs are W3C PROV Activities, actors are
Agents, other scientific records are Entities, and `used`, `wasGeneratedBy`,
`wasDerivedFrom`, `wasAssociatedWith`, `wasAttributedTo`, and general influence
relations remain explicit in JSON-LD.

```python
from evidence_dag import read_ro_crate, write_ro_crate

metadata = write_ro_crate("archive/run-42", graph, committed_snapshot)
restored = read_ro_crate(
    metadata.parent,
    expected_snapshot_digest=committed_snapshot.digest,
)
```

Export never copies referenced paper, dataset, code, log, model, or environment
bytes. Import accepts only `sciforge-ro-crate.v1`, reconstructs the canonical
ThreadGraph, validates every Registry and PROV reference, and recomputes the
Evidence Snapshot digest. It therefore cannot act as a mutable or legacy ingest
bypass. Re-export to an existing crate is idempotent only when its metadata is
byte-identical; a different snapshot cannot overwrite it.

## DataCite metadata exchange

`evidence_dag.datacite` generates canonical DataCite REST metadata for either a
Project or one exact ArtifactVersion. Mandatory discovery fields (title,
creator, publisher, publication year, and DOI) must be explicit; only an exact
DOI/SWHID locator may supply the corresponding identifier. Artifact kind maps
deterministically to DataCite `resourceTypeGeneral`.

ArtifactVersion exports carry the same `urn:sciforge:ro-crate:*` identity used
by RO-Crate PROV Entities, the Artifact content digest when known, and explicit
Project/version relations. Full SWHIDs and full 40/64-hex Git commits are
accepted; a Git commit also requires its repository URL. Related identifiers
are restricted to validated DOI, HTTP(S) URL, or URN values. The export contains
metadata references only and never reads or copies Artifact bytes.

```python
from evidence_dag import datacite_digest, export_datacite, import_datacite

metadata = export_datacite(
    resource, project, artifact=artifact, artifact_version=artifact_version,
)
digest = datacite_digest(metadata)  # retain with the immutable archive record
verified = import_datacite(
    metadata,
    expected_metadata_digest=digest,
    resource=resource,
    project=project,
    artifact=artifact,
    artifact_version=artifact_version,
)
```

Import accepts only the canonical `sciforge-datacite.v1` projection, validates
the detached SHA-256 digest plus authoritative Project/ArtifactVersion
identities, and rejects unknown fields, invalid identifiers, invented content
digests, or relation mismatches. It does not create or mutate a DAG.

## Versioned snapshot products

The public `evidence-dag.export-snapshot-products` capability publishes five
Evidence-owned projections for one caller-pinned snapshot digest: PROV-JSON,
RO-Crate, DataCite metadata, an L0 audit report, and a reproduction report.
`runtimeId`, `threadId`, `workspaceRoot`, `snapshotDigest`, an idempotency key,
and explicit DataCite DOI/title/creators/publisher/publication year/project
identity are required. Evidence never substitutes current/latest when the
pinned historical snapshot is missing or corrupt.

Before writing, the Python engine validates every snapshot-referenced
ArtifactVersion against its immutable `ArtifactVersionRefV1`. The main runtime
then resolves each exact version through Artifact Versions, verifies the bytes
and full ref, and rejects unavailable, mismatched, non-exportable, or
over-limit sources. All five canonical JSON byte streams are submitted through
one `ArtifactVersionCommitTransaction`; every output depends on all exact
source refs and carries `threadId + snapshotDigest` metadata. No receipt is
returned if the atomic commit fails. Optional per-product
`artifactId + expectedCurrentVersionId` targets provide optimistic CAS when an
export is appended to an existing product identity; otherwise the first
idempotent transaction creates the identities.

The reproduction report says `L4` only when every included run/claim/finding
passes the existing strict lineage checks. Otherwise it is explicitly
`incomplete` and preserves named breakpoints. The audit export is generated
deterministically against the exact requested snapshot and declares that
binding; an unrelated audit run is never relabeled as current.

## HTTP API

All JSON routes except `/health` require `Authorization: Bearer $SCIFORGE_EVIDENCE_DAG_API_KEY`.

```text
GET  /health
GET  /version
GET  /threads
GET  /threads/{id}/graph                  # latest committed graph + snapshot
GET  /threads/{id}/snapshot
GET  /threads/{id}/provenance?node=<id>
GET  /threads/{id}/conclusion-lineage?snapshotDigest=<sha256>&conclusionId=<id>
                                              # complete executable + Evidence closure
GET  /threads/{id}/rerun-spec?snapshotDigest=<sha256>&conclusionId=<id>
                                              # canonical sciforge.rerun.v1
GET  /threads/{id}/rerun-compare?baselineDigest=<sha256>&baselineConclusionId=<id>&candidateDigest=<sha256>&candidateConclusionId=<id>
                                              # explicit comparator result
GET  /threads/{id}/metrics
GET  /threads/{id}/analysis?threshold=0.7
POST /threads/{id}/reconcile              # read-only what-if
GET  /threads/{id}/prov-json              # committed snapshot export only
GET  /events?threadId=<id>&type=<type>&afterSequence=<n>&limit=<n>

POST /updates
GET  /updates/status?threadId=<id>

POST /audits
GET  /audits?threadId=<id>
POST /snapshot-products                     # exact snapshot projection; desktop commits bytes
```

Canonical update body:

```json
{
  "threadId": "sciforge:thread-id",
  "targetWatermark": "item-id",
  "reason": "turn_committed",
  "priority": "P2",
  "workspaceRoot": "/workspace",
  "projectRoot": "/workspace/project-scope",
  "trace": [],
  "accessPolicy": {},
  "queuedAt": "2026-07-10T00:00:00Z",
  "idempotencyKey": "durable-queue-job-id",
  "correlationId": "runtime-turn-or-job-id"
}
```

`workspaceRoot` is the required public scope identity. The service normalizes it
and validates that an optional `projectRoot` stays contained within it. The main
runtime uses that exact workspace root when invoking Artifact Versions commit
and lifecycle-list contracts.

The three scheduling fields are optional transport metadata. When supplied, they preserve end-to-end queue time, delivery identity, and correlation. An identical canonical input digest is returned from the latest committed snapshot without another model call or duplicate queue/snapshot event. Artifact/decision changes use a different reason or effective payload and compile normally.

`rebuild` is an advanced operation only. It requires `rebuild: true`, a reason of `schema_upgrade`, `corruption_recovery`, or `reinterpretation`, and a non-empty `rebuildRationale`.

Canonical Evidence audit body:

```json
{
  "threadId": "sciforge:thread-id",
  "targetDigest": "sha256:immutable-snapshot",
  "level": "L0",
  "trigger": "manual",
  "threshold": 0.7
}
```

The Evidence engine currently implements deterministic `L0` structural AuditRuns. A run reads the specified immutable historical snapshot, persists `target_digest`, never writes the DAG, and becomes `stale` when a newer snapshot commits.

## Conclusion lineage and reruns

`conclusion_lineage` returns every supporting, contradicting, refining, and
prerequisite Evidence path, followed through runs to input, code, environment,
parameter, tool, approval, Artifact, and registry records. Coverage is explicit:
ungrounded Evidence, unverifiable ArtifactVersion, missing approval, and missing
executor metadata become structured breakpoints.

The rerun exporter uses the SDK `sciforge.rerun.v1` contract and RFC 8785/JCS
digest semantics. A canonical resource supplied by an execution producer is
preserved byte-for-byte at the executor boundary, including secret slots and
breakpoints; Evidence never rebuilds a Create Loop private payload when the
shared resource is available. Raw secret detection blocks execution without
silently rewriting a hashed executor.

Comparison stores observed differences separately from the replication verdict.
`replicates` is written only for an explicit match, and
`fails_to_replicate` only for a controlled explicit mismatch. Uncontrolled or
unverifiable comparisons retain `rerun_of` with an inconclusive reason. The
Workbench panel exposes native Conclusion nodes, lineage coverage, breakpoints,
and canonical rerun-spec download.

See [`ADR-0043`](../../../docs/adr/0043-derive-research-graphs-and-seal-formal-baselines.md)
for the cross-package derivation and sealing contract.

## Domain events and metrics

With `EDAG_STORAGE_DIR`, the append-only stream is stored at
`events/evidence-domain-events.json`. `GET /events` reloads persisted state and
supports sequence polling. Artifact scan events retain the Registry `eventId`;
acknowledgement removes only the pending Registry inbox record, never history.

`GET /threads/{id}/metrics` also returns `queue_latency_ms`,
`commit_latency_ms`, `audit_staleness`, `provenance_break_rate`, and
`reproducible_finding_rate`. `metric_evidence` reports sample counts or exact
numerator/denominator. A value is `null` with an explicit reason when timestamps,
snapshot history, provenance, or explicit run links are absent; missing facts are
never inferred from prose.

## Run and test

```bash
export SCIFORGE_EVIDENCE_DAG_API_KEY=dev-token
export EDAG_MODEL_ROUTER_BASE_URL=http://127.0.0.1:3892/v1
export EDAG_MODEL_ROUTER_API_KEY=local-router-key
export EDAG_MODEL_ROUTER_MODEL=sciforge-router
export EDAG_STORAGE_DIR=/path/to/evidence-store
npm --workspace @sciforge/domain-evidence-dag run start

npm --workspace @sciforge/domain-evidence-dag test
```

The sample loader also uses `/updates`:

```bash
SCIFORGE_EVIDENCE_DAG_API_KEY=dev-token python samples/load.py
```

The `EDAG_MODEL_ROUTER_*` variables above are only for running the Python
service directly. The package-owned desktop sidecar does not resolve Model
Router settings or credentials from environment variables. It obtains the
current text-reasoner endpoint, credential, and model from the generic main host
contract before every queued submission, projects those values into the child
process, and restarts its owned process when they change. Reads during
extraction/review continue to return the prior committed graph; failed updates
remain visible through `/updates/status` and never expose a partial snapshot.

Unless `SCIFORGE_EVIDENCE_DAG_SERVICE_URL` explicitly selects an external
service, the desktop lifecycle allocates a private loopback port for its owned
sidecar. Concurrent readiness requests share one startup attempt, and an owned
child that exits before readiness fails immediately. This keeps another app or
an orphaned prior process on the standalone default port from causing repeated
bind attempts or an unbounded startup backlog; the lifecycle never terminates a
process it did not spawn.

The package-owned Host-service resolver validates Artifact Versions contracts
and maps Evidence operations to their public capability actions. The Host
supplies only generic ordinary-Session capability invocation, preserving the
original caller, Session, context, cancellation signal and invocation identity.
The resolver and Host both fence stale or aborted calls; artifact access and
write admission remain enforced by the canonical Capability Broker.

## Native research record

The bundled Evidence domain owns the research record backend and renderer. The
same chapter-oriented view opens in the right panel or the workspace overlay,
using SciForge theme tokens. Its presentation controller retains scope, nested
folds, selection and scroll across these surfaces. Recursive phases contain
rounds, progression steps, recorded Skill/Plugin groups and raw-action references.
Historical phases fold as a whole; current progression opens by default while raw
actions remain collapsed. Dates describe recorded observations, not experiment duration.

The runtime observes public `agentThreads` snapshots independently of the panel.
It stores derived organization, immutable source IDs/digests, job cursors and
revisions under private Evidence storage. Original items stay with their runtime;
source reads explicitly distinguish current, changed and unavailable content.
Human phase moves remain locked against model placement; earlier step IDs and
failure/cancellation facts survive new batches. Historical discussions and pinned
handoff records are preserved unchanged and old discussions remain readable.

Research records use one atomic commit manifest, verified delta segments and
periodic checkpoints. Fixed reusable slots bound file count while checkpoints
retain all history. Visible source boundaries survive restart; reordered or
temporarily missing projections preserve prior organization, with explicit gaps.
Availability-only recovery does not resynthesize already covered stages. See
[durability and verification boundaries](../../../docs/design/research-record-durable.md).

`evidence-dag.record.view` and `.edit` are the public capabilities. Caller
workspace binding overrides untrusted input scope. The view fetches bounded
canonical discussion context only when explicitly requested, not on every poll.
The renderer opens the Host's persistent native side-chat via public
`workbench.openSideConversation`, with an exact parent scope and distinct source
references. Light/deep modes, composer, conversation history and reviewed Markdown
transfer to the main conversation belong to the Host. Evidence exposes no second
chat or handoff write path. Memory-read instructions do not claim memory was read.

Visible chapter headers and raw details register public visible-context targets
for anchored annotations. Registration keeps receiving runtime/thread/workspace
separate from source runtime/thread/turn/item. Collapsed, offscreen or unmounted
nodes unregister their targets; the Host issues and validates opaque anchors.

The organizer uses public `agentExecution`, bound to source runtime/workspace.
Each request creates a hidden side Session with an empty tool allowlist; scanning
excludes side Sessions. Existing Agent configuration is reused, with an optional
fast-model override (for example `gpt-6.1-terra` on Codex), and no separate HTTP
client. Reasoning and compaction items are excluded. Unfinished streams settle
before classification. Requests run singly at least 15 seconds apart, with a
180-second deadline and 40,000-character output limit. Each batch selects at most
48 sources with 12,000 serialized excerpt characters inside a 24,000-character
total data budget, including bounded phase hints. Three failures
leave a pending job until retry or new evidence. Pausing organization continues
indexing; domain disablement aborts requests. Older sessions backfill in bounded
batches. Coverage is **visible-session-snapshots**, not a complete event ledger;
organization, discussion and annotation do not prove scientific validation.

Validation entrypoints: `npm run desktop:test`, `npm run typecheck`, and from the
repository root `node --import tsx scripts/research-record-ui-smoke.test.mjs <fresh-output-dir>`.
The browser check uses the production capability Broker, runtime and React
contributions, with synthetic session/model data and explicit public Workbench /
visible-context receiver fixtures. It does not validate real Agent execution,
Host anchor signing, main-session delivery, Cloud or an installed desktop package.

### Research review (2.1)

Read-only `record.review` and `record.audit` expose scoped changes, current leaf
concerns, paginated revisions and source checks. New organization receipts retain
native execution references, recipe version and business-input/output digests;
the audit view verifies those against the native transcript on demand. Manual
changes retain their before/after fields. Legacy missing evidence stays explicit.
Browser viewing position is not an approval or verification receipt.

Foreground activity defers new organization, followed by a 15-second quiet window;
pending workspaces rotate. In-flight calls are not preempted. Review uses no LLM.
The single JSON store and history scan remain scalability limits; this is not a
tamper-proof ledger, complete event inventory or global token-budget scheduler.


### Scientific audit observations (2.11)

The record ingestion owner retains each settled, public visible source observation
under its scoped digest in Evidence private storage. Its existing source reference
is the durable index; v1/v2 record-state migration and manifest/segment replay are
unchanged. Old states without retained bytes stay explicitly `not-retained` until
the exact observed version is encountered. No latest-version substitution occurs.
A source larger than 2 MiB is not retained; the gap is recorded. Historical reads
verify the digest and enforce the same byte bound before reading. Corruption is
visible and is never silently repaired. Source-thread and workspace authorization
runs for each read, including retained bytes. Missing authorization denies bytes.

`record.view` returns `retainedSource` and `rawOrigin` independently of live
`sourceStatus`. Retained bytes are observational records, not scientific Artifacts,
proof of complete recording, or a scientific truth claim. Model organization still
requires current live sources; retention does not authorize processing stale input.

The existing `evidence-dag.audit-query` capability now returns `scientificReview`
through the SDK output contract. The projection consumes recorded corrections,
ArtifactVersion lifecycle events, dependency links and formal reconcile effects.
It follows recorded links to closure targets/review subjects without recomputing
scientific support or changing approval identities. A changed material status is
`requires-review`, never scientific falsification. `no-recorded-impact` describes
only known links; unmapped or bounded queries report unknown. The projection scans
at most 1,000 deltas per contributing chain and 10,000 nested values, with at most
100 review impacts (20 affected subjects and 10 changes each) and 20 observations on each of five separate judgment axes.

Dossier displays source independence, declared controls/comparison conditions,
negative observations, reproduction and scope/limitations separately, with missing
facts explicitly unknown. Recorded metadata is not a validation result. Existing
exact ArtifactVersion navigation and closure routes remain the canonical entry.
The deterministic repeatable integration evaluation is `npm run eval:scientific:audit`;
use `npm run eval:scientific:audit -- --output <run-path>/results.json` for per-scenario measured machine results. Outputs are execution records, not repository documentation.


The normal record inspector reads scientific review through the registered exact-version
Evidence query. Full artifact/version/digest identity is required; an index string alone
cannot prove this identity. Condition observations carry their target, review record and
closure identities. Only selected scientific claim/source rows or attributed assessment
holders contribute conditions, never tool schemas or unrelated branches.

New closure seals record `semanticGapPolicy: explicit-v2`: missing evidence requires
explicit gap declarations or unassessed owner metadata. Immutable historical policies
without this field retain their original keyword semantics on restart, including their
original digests, status, Snapshot bindings and approval identities.

Inspector summary impact is read on demand. It follows entry source IDs, resolution
source IDs and recorded discussion/human-revision citations; absent relationships remain
unknown. Historical source audit and side-discussion excerpts use the same digest-verified,
authorized retained observation as source inspection. Automatic organization remains
live-current-only. Model input/output receipts may still be unavailable independently.


### Long-history scientific review and source retention

The canonical audit read port uses owner-maintained exact-version/closure indexes, append-only suffix updates and revision-bound projections. Cold index work and graph traversal have separate total budgets. `scientificReview.coverageDetails` reports indexed/scanned work, omitted records and explicit reasons; incomplete indexing or unknown relationships never establish absence of material impact. Historical closure and approval identities remain immutable.

Research-record detail now reports local retained-source storage usage separately from bounded verification of authorized references. The retention manifest accounts for reservations, quota refusal and corrupt/missing observations, keeps referenced history, and performs no automatic pruning. A selected authorized source can be exported with its exact reference and digest through the existing view read contract; partial storage coverage is not a complete Session-history archive.

The scientific-review panel handles exact references independently with bounded concurrency and local retry. Retained and pending responses are scoped to the full material identity, Session, workspace, revision and visible surface. Compact research rows register their own visible-context targets; a new scope remounts retained views before its first render.

`evidence-dag.rerun-spec` and `evidence-dag.rerun-compare` are governed read capabilities over the existing Python reproduction engine. A selected closure resolves only through its recorded committed-snapshot binding; no latest substitution is allowed. The normal record/dossier UI previews the bound specification, requests execution explicitly through the existing Create Loop `workflow.execute` contract, compares pinned baseline/candidate specifications, and returns the selected current version to review. Admission, execution, byte integrity and scientific reproduction remain separate results. Previewing, exporting, browsing or comparing never creates a human approval.

The companion real-material evaluation command is `node --import tsx scripts/scientific-human-audit.mjs` from the repository root (see its usage and `docs/local-release-and-human-audit.md`). Its default manifest is pending import and human measurements are null. Fixed synthetic cases and supplied observations are not evidence of human audit-quality benefit.
