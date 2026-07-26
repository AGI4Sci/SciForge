## 1. Canonical contracts

- [x] 1.1 Define typed Evidence committed/pending status and model-response error contracts.
- [x] 1.2 Define Project durable receipt, fingerprint, generation, coverage, and terminal-error contracts.
- [x] 1.3 Define the Evidence-only desktop queue replacement schema and one-shot Project handoff boundary.

## 2. Evidence DAG reliability

- [x] 2.1 Reject incomplete/empty Responses results before JSON parsing and preserve typed error metadata.
- [x] 2.2 Apply explicit extraction and independent-judgement reasoning/output policies with one bounded output adaptation.
- [x] 2.3 Resume every retry from the latest committed watermark and preserve the last committed graph on pending failure.
- [x] 2.4 Add focused tests for incomplete, empty, invalid JSON, transport, adaptive retry, and partial-batch recovery.

## 3. Project DAG durability

- [x] 3.1 Add stable desired fingerprints and idempotent active enqueue.
- [x] 3.2 Return durable receipts and expose requested/processing/committed generation status with true terminal errors.
- [x] 3.3 Implement committed/covered/superseded semantics and reject Evidence-vector regression.
- [x] 3.4 Add workflow/API tests for duplicate enqueue, coalescing coverage, stale vectors, failure propagation, and restart recovery.

## 4. Desktop coordination and status

- [x] 4.1 Delete synchronous Project snapshot waiting, Project-phase retries, and the duplicate durable state machine.
- [x] 4.2 Persist one Project handoff receipt without occupying the Evidence worker or re-POSTing on observation timeout.
- [x] 4.3 Replace startup timestamp rewriting and historical-failure selection with target-relative reconciliation.
- [x] 4.4 Ensure terminal Evidence history cannot permanently block a covered Project handoff.
- [x] 4.5 Add queue tests for restart, old-failure/new-success, no duplicate POST, no head-of-line blocking, and direct queue-schema replacement.

## 5. IPC and renderer

- [x] 5.1 Make Project service status authoritative and keep historical/local failures diagnostic.
- [x] 5.2 Expose committed graph availability separately from pending delta state for both DAGs.
- [x] 5.3 Remove synthetic progress; preserve active/detached observation and real terminal errors.
- [x] 5.4 Refresh iframes only on committed identity changes and throttle inactive panels.
- [x] 5.5 Add IPC and renderer regressions for stale failures, manual refresh, polling, and iframe identity.

## 6. Domain package ownership

- [x] 6.1 Create installed Evidence DAG and Project DAG domain packages with manifests and separate main-runtime and renderer entrypoints.
- [x] 6.2 Move backend, UI, contracts, and lifecycle contributions behind package public exports.
- [x] 6.3 Regenerate installed-domain composition and delete old host-private/worker-package entrypoints, central DAG switches, and unused dependencies.
- [x] 6.4 Add boundary tests proving package removal/addition changes all contributions without core edits.

## 7. Verification

- [x] 7.1 Run Evidence and Project focused tests plus desktop queue, IPC, and renderer tests.
- [x] 7.2 Run generated-composition freshness, package-boundary, capability-governance, and changed-file lint checks.
- [x] 7.3 Run repository typecheck, full regression suite, and production build.
- [x] 7.4 Validate source and unpacked packaged application DAG update paths and audit for old entrypoints, private imports, duplicate execution paths, hard-coded domain IDs, and dead files.
