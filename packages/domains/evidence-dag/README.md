# `@sciforge/domain-evidence-dag`

Installed Evidence DAG domain package. This package is the single ownership,
versioning, installation, and release boundary for the Python Evidence engine,
durable update state, public contracts, main-process lifecycle, agent artifact
ingestion, and optional renderer panel.

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

Thread-scoped Evidence DAG compiler for SciForge. The package-owned engine consumes visible runtime trace deltas through one update command, links SourceAssertions to structured SourceAnchors and versioned Artifacts, executes A0-A2 review, and commits immutable Evidence Snapshots. Audit is a read-only side chain over a selected committed snapshot.

The package follows [`docs/evidence-project-dag-design.zh-CN.md`](../../../docs/evidence-project-dag-design.zh-CN.md). There is no direct ingest, verify, inline-audit, or mutable PROV import route.

## Core contracts

- Semantic nodes use domain-separated normalized semantic IDs. Artifact bytes use separate `sha256:` content digests.
- The canonical source node type is `source_assertion`.
- A SourceAssertion PROV entity links through `edag:artifact_id`, `edag:artifact_version_id`, and `edag:source_anchor_id`.
- `edag:artifactRegistry` is the historical snapshot projection key. New snapshots may also contain exact `artifactVersionRefs`; it is not a writable Registry.
- SourceAnchor selectors are structured (`pdf|text|table|figure|code|dataset|web`) and carry a digest of the selected content.
- The main-process adapter commits only explicit reference candidates with locator, digest, and byte length, or consumes an already-pinned `ArtifactVersionRefV1`. The Python compiler never opens a locator, hashes a file, creates an Artifact identity, or rebinds a version.
- Missing, incomplete, or ambiguous artifact provenance remains `pending`/`failed` and fails closed at L0. Chat/agent summaries and raw tool receipts are never promoted into scientific Artifacts.
- Artifact identity, version commits, access policy, source availability, moves, and content-change detection are owned by `@sciforge/domain-artifact-versions`. On activation and on a bounded background interval, Evidence drains that durable lifecycle outbox to empty by workspace. Evidence persists its sequence cursor, exact thread/version associations, and idempotent queue receipts in `artifact-version-lifecycle.json`; a cursor advances only after every affected thread update is durably accepted by the existing Evidence queue. Restart replays the same receipt safely. Missing/content/current-change events mark affected current projections stale, moves require review, and old snapshots and pinned IDs/digests are never rewritten.
- Scientific Plotting publishes immutable `pending` receipts under `.sciforge/evidence-dag/inbox/scientific-plotting/<sha256(operationId)>.json`. Evidence validates the routed thread/workspace, all five committed refs, every lineage ref, and the stored bytes before appending a synthetic structured trace to its durable queue. It writes a separate `enqueued` delivery receipt only after that queue write is durable; `enqueued` means hand-off accepted, not Evidence Snapshot or L4 completion. Missing services/threads and any scope or digest mismatch leave the producer receipt pending for restart-safe retry.
- A0, A1, and A2 assessments are append-only records bound to the committed snapshot digest. A1/A2 use prompts and context independent from extraction.
- ExperimentRun, AnalysisRun, DatasetVersion, SoftwareVersion, Environment, Observation, Artifact, and Agent are first-class source-layer objects. PROV export maps runs to `activity`, actors to `agent`, and other records to `entity`; `used`, `wasGeneratedBy`, `wasDerivedFrom`, `wasAssociatedWith`, and `wasAttributedTo` retain their native PROV-JSON forms.
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
  "schemaVersion": "evidence.v2",
  "extractorVersion": "extractor.v2",
  "verifierVersion": "verifier.v2",
  "artifactDigests": [],
  "createdAt": "timestamp",
  "status": "committed"
}
```

Latest files use the shared collision-resistant filename contract exported by `evidence_dag.snapshot.snapshot_filename(thread_id)`. Historical versions are stored under `snapshots/<snapshot_storage_key(thread_id)>/` and never rewritten.

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
