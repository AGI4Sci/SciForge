## Context

SciForge currently has two durable layers for one Project update. `EvidenceDagUpdateQueue` commits Evidence, POSTs Project, synchronously waits for a Project-wide exact vector plus global idle, and retries that whole sequence. Project DAG separately owns a durable coalescing job. When requests overlap, the Project service advances its desired generation while the desktop waiter continues waiting for an intermediate vector that may never be the latest snapshot. Timeout is then recorded as a terminal local failure even though the canonical Project worker remains healthy and later commits.

The same desktop queue reports status by selecting any historical non-success record. Startup rewrites terminal timestamps, terminal Evidence failures block unrelated Project propagation, and the UI lets those records override a fresh Project snapshot. Evidence extraction also treats a Responses `incomplete` result with empty output as successful text, producing an unhelpful `JSONDecodeError`.

## Goals / Non-Goals

**Goals:**

- Establish one durable owner and one canonical status source for each DAG.
- Make update submission idempotent and asynchronous across the Evidence-to-Project boundary.
- Preserve the last committed graph while exposing a separate pending or failed delta.
- Make model-response failures typed, actionable, and bounded.
- Remove synthetic progress and historical-status poisoning.
- Put backend and optional UI for each DAG in its independently ownable domain package.

**Non-Goals:**

- Cancelling a Project compile when a client stops observing it.
- Preserving the old `phase=project` queue schema or exact-vector waiting API.
- Adding provider- or model-name-specific branches.
- Introducing a third coordinator, registry, IPC path, or fallback service.
- Implementing multi-process Project workers unless the runtime contract changes from the current single sidecar; idempotency is required either way.

## Decisions

### 1. One durable owner per DAG

The Evidence domain queue persists only Evidence ingestion. Its success boundary is an immutable Evidence snapshot at the requested watermark, so the Evidence execution slot is released without waiting for Project work.

Project DAG exclusively owns its durable completed-turn handoff outbox plus Project queuing, coalescing, retry, execution, and terminal state. Its package-owned artifact consumer waits until the public Evidence capability covers the turn watermark, submits Project once, persists the accepted receipt, and never re-POSTs because an observer timed out. The host only broadcasts the generic completed-turn artifact event.

### 2. Project enqueue returns a durable receipt

`POST /updates` returns:

```text
projectKey
jobId
acceptedRequestVersion
desiredFingerprint
desiredEvidenceVector
```

The fingerprint covers canonical Evidence vector and all other compilation inputs. Repeating an identical active request returns the same receipt and does not increment `request_version`. A truly different desired input advances the generation once.

Project status exposes requested, processing, and committed generations plus the committed snapshot digest and terminal error. A receipt is complete when its generation is committed directly or a later committed generation monotonically covers it. `covered` and `superseded` are successful coordination outcomes, not failures.

### 3. Evidence vectors are monotonic

Project validates that a thread's accepted Evidence snapshot does not regress from a newer committed version or watermark. A stale retry cannot overwrite a newer digest. Immutable snapshot integrity remains mandatory.

### 4. Current status is target-relative

Status is computed from the latest target and authoritative committed state. Historical failed records are history only. On startup, only interrupted running work is recovered; terminal timestamps are immutable. A committed watermark or Project receipt reconciles and covers older local attempts.

The UI status model separates:

```text
committed: available snapshot/version/digest
pending: none | queued | running | retrying | failed
```

A failed pending delta never makes an available committed graph disappear.

### 5. Structured Evidence operations have an explicit inference contract

Evidence extraction, NLI verification, and adversarial review request an explicit low-reasoning policy through the generic Model Router request contract and reserve operation-appropriate output budget for JSON. Extraction starts at 8,192 output tokens and can adapt once to 16,384. The small structured judges keep their narrow public call signatures, while the package-owned Router boundary applies a 2,048-token floor and can adapt once to 4,096. The client checks Responses terminal status before parsing output.

`status=incomplete`, empty output, invalid JSON, transport failure, rate limiting, and upstream failure are distinct typed errors. Deterministic incomplete output receives at most one larger output allowance under the same low-reasoning contract. Transport failures use bounded backoff. Identical deterministic requests are not replayed five times.

Structured schema output is used when supported by the generic router contract; no direct provider path is added.

### 6. Domain packages own complete features

Evidence DAG and Project DAG each become installed domain packages with separate main/worker and renderer entrypoints in one package/version. Host code depends only on Domain SDK and package public contracts. Generated composition discovers both manifests; the host contains no DAG ID switch or direct import of package-private `src` code.

The previous worker-package and host-private renderer/main implementations are deleted once callers use the package entrypoints. There is one IPC/capability path per operation.

### 7. Rendering follows committed identity

Status polling updates the status band only. The iframe key changes only when its URL or committed snapshot identity changes. Inactive resident panels do not run an aggressive polling loop. Without authoritative progress telemetry, the UI shows an indeterminate active phase instead of a fabricated percentage.

### 8. Package-owned Python runtimes are self-contained

The Evidence runtime owns the small directed-graph surface it consumes
(reachability, strongly connected components, topological generations, and
dominators) as standard-library code. Evidence and Project do not install
packages into the host Python environment at application startup. Source and
packaged runtime entrypoints therefore have the same dependency behavior, and
packaging validates both with global site packages disabled.

### 9. Project runtime actors own separate SQLite connections

The threaded Project HTTP API, Project update worker, and audit worker are
separate concurrent actors and each owns one Engine, Store, and SQLite
connection. HTTP requests serialize access to the API connection. Update and
audit workers atomically select and claim work with `BEGIN IMMEDIATE`, so an
API enqueue cannot nest, commit, or interleave with a worker transaction.

### 10. Evidence update scope is workspace-owned

Evidence update commands carry the workspace root through the public package
contract and persisted queue. The service derives its stable registry identity
from canonical workspace/project roots and enforces real-path containment; it
does not require Project-domain metadata. Artifact events without a workspace
scope are not enqueued into work that cannot safely resolve provenance.

## Error and State Contract

Evidence pending errors use stable codes such as:

```text
model_output_incomplete
model_output_empty
model_output_invalid_json
upstream_timeout
upstream_unavailable
```

Project receipt states are:

```text
queued | running | committed | covered | superseded | failed
```

Only `failed` from the canonical Project service is a red Project failure. Client observation timeout is represented as detached observation and does not mutate execution state.

## Migration Plan

1. Add typed Evidence response handling and focused tests.
2. Add Project fingerprint, receipt, generation coverage, monotonic-vector validation, and tests.
3. Replace the desktop queue schema with Evidence-only jobs, add the Project package-owned durable handoff outbox, and remove synchronous wait and Project-phase retry.
4. Switch IPC and UI to canonical committed/pending status and receipt-aware Project state.
5. Move both feature implementations into installed domain packages, regenerate composition, and delete old entrypoints.
6. On first load of the old queue file, retain actionable Evidence jobs and directly discard/cover Project-phase records using committed Project state; persist only the new schema.
7. Run focused, architectural, type, lint, full regression, source-app, and packaged-app validation.

## Risks / Trade-offs

- **A Project compile can outlive the desktop observer.** This is intentional; canonical status and receipt lookup allow later observation.
- **A newer generation may not contain an older vector verbatim.** Monotonic Evidence-version validation makes generation coverage safe.
- **Lower reasoning can affect Evidence judgement quality.** Structured schema validation, operation-specific output floors, independent review, and Evidence quality tests constrain the trade-off.
- **Direct queue-schema replacement drops historical Project retry records.** Those records are not execution authority; completed Project snapshots and Project job history remain authoritative.
- **Domain migration touches packaging.** Generated composition, boundary tests, unpacked packaging, and source/packaged smoke tests are required before completion.

## Open Questions

None for implementation. Project membership remains the currently committed explicit project scope; changing automatic session admission is a separate product change.
