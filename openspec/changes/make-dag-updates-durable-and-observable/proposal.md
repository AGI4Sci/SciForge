## Why

Evidence DAG and Project DAG currently expose divergent update states. The desktop Evidence queue can report a historical Project propagation timeout after the Project service has already committed a fresh snapshot, while deterministic incomplete model responses are retried as opaque JSON failures. This creates false failures, head-of-line blocking, duplicate durable ownership, and progress indicators that do not describe real work.

## What Changes

- Make the Evidence domain the sole owner of Evidence extraction, batching, committed watermarks, and Evidence retry classification.
- Make the Project domain the sole owner of Project enqueue, coalescing, execution, retries, committed generations, and terminal errors.
- Replace desktop synchronous Project polling and repeated enqueue with one durable handoff that returns a stable receipt and releases the Evidence worker.
- Define idempotent Project request fingerprints and generation coverage so a newer committed generation can cover an earlier accepted request.
- Reconcile current status from authoritative committed snapshots and current targets; historical failures remain diagnostic history and cannot override newer success.
- Treat incomplete or empty model output as a typed model-response failure, use an explicit structured-extraction inference policy, and adapt once instead of replaying the same deterministic failure.
- Separate committed DAG availability from the latest refresh attempt in the UI, remove synthetic percentage progress, and refresh embedded graphs only when the committed snapshot changes.
- Move the complete Evidence DAG and Project DAG backend/UI ownership behind installed domain-package entrypoints and remove host-private domain implementations and duplicate paths.
- **BREAKING** Remove the desktop queue `phase=project` execution path and exact-vector/global-idle waiting contract.
- **BREAKING** Replace ambiguous JSON parsing errors and synthetic progress with typed update outcomes and canonical domain status.

## Capabilities

### New Capabilities

- `durable-evidence-dag-update`: typed structured extraction, committed-watermark recovery, and separate committed/pending status.
- `durable-project-dag-update`: idempotent durable receipts, generation coverage, canonical Project status, and real terminal errors.

### Modified Capabilities

- `domain-package-composition`: Evidence DAG and Project DAG become independently owned domain packages discovered through the generated installed-domain set.

## Impact

- Evidence DAG Python client, extraction service, desktop contract, tests, and package entrypoints.
- Project DAG workflow, HTTP contract, persistence, tests, and package entrypoints.
- Electron update orchestration, IPC status aggregation, renderer panels, and focused tests.
- Installed-domain manifests and generated main/renderer composition.
- Existing persisted desktop queue records are read once into the new Evidence-only shape; obsolete Project-phase records are discarded or marked covered during direct schema replacement, with no runtime compatibility path.
