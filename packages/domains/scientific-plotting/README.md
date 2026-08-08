# Scientific Plotting domain

This package is the governed SciForge composition boundary for deterministic
scientific plotting. It exposes status, data mapping, render, rerun, and compare
through the Capability Broker. The worker owns rendering; the shared Artifact
Versions domain owns immutable bytes, history, dependencies, restore, and bundle
operations.

Every formal render uses a workspace-bound Artifact Version commit port. Input
workspace paths from callers are replaced by the broker-owned workspace scope.
`map-data`, `render`, and `rerun` require a caller-owned `operationId`; retries
reuse that ID, deterministic output identity, and the exact prepared bytes. A
lost commit response therefore replays one Artifact Versions transaction rather
than creating another Figure version. Reusing an ID with different request or
prepared bytes fails closed.

After a successful commit, plotting atomically writes an immutable pending
receipt under `.sciforge/evidence-dag/inbox/scientific-plotting/` (the filename
is the SHA-256 of `operationId`). Evidence DAG writes a separate `enqueued`
delivery receipt after durable queueing. `pending` and `enqueued` describe only
handoff state; neither claims an Evidence Snapshot or L4 reproducibility.
Formal reproducible saves accept only pinned `ArtifactVersionRefV1` inputs.

The renderer entry contributes a governed Plot Provenance right panel. It reads
immutable `scientific-plot-render-manifest` snapshots through
`artifact-versions.list/read`, displays the pinned Data, Statistics,
Transformations, Parameters, Environment, Execution, and Review sections, and
invokes rerun/compare only through public capability contracts. Exact reruns use
the historical Figure and Recipe `ArtifactVersionRefV1` values plus an explicit
current-version compare-and-swap base; the panel never treats a workspace path
or `latest` pointer as version truth.
