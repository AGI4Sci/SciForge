# `@sciforge/domain-artifact-versions`

This package is the SciForge-owned version substrate for workspace-scoped scientific
artifacts. It owns stable artifact identity, immutable content versions, content-addressed
snapshot bytes, physical source lifecycle, portable bundles, and the Artifact History UI.

It deliberately does **not** own scientific evidence semantics. Claims, source anchors,
experiment and analysis runs, assessments, Evidence snapshots, and claim invalidation remain
in Evidence DAG. Producers such as plotting commit opaque recipe, input, and output artifacts;
Evidence DAG may consume the returned pinned `ArtifactVersionRefV1` values.

## Public contract

Import cross-domain types and the governed commit port only from the contract entrypoint:

```ts
import {
  createArtifactVersionCommitPortV1,
  type ArtifactVersionRefV1
} from '@sciforge/domain-artifact-versions/contract'
```

`commit` accepts up to 128 candidates. Every update names its expected current version, every
dependency is pinned to an immutable version reference, and candidate-to-candidate dependencies
are resolved inside the same atomic transaction. Reusing an idempotency key with changed input
returns `idempotency-conflict`; committing from a stale current version returns `stale-base`.

Explicit `save`, `rerun`, `restore`, and `publish` intents create a new version even when bytes
are unchanged. Passive `observe` returns the current version when the current bytes are unchanged.

Every stored version carries an immutable access policy. Workspace/public versions are visible to
workspace callers; restricted versions require the caller principal (or a host-issued trusted
`system` audience). Reads, dependency resolution, restore, compare, lifecycle pages, imports, and
idempotent replays enforce the same policy. History projections omit inaccessible parents and
dependencies, and bundle export fails as a whole if any exact version in the closure is hidden or
sets `allowExport: false`.

## Durable layout

Data lives below the host-provided user data directory, partitioned by a SHA-256 workspace key:

```text
artifact-versions/workspaces/<workspace-key>/
├── index.v1.json
└── objects/sha256/<prefix>/<content-digest>
```

Snapshot bytes are written and fsynced before a single atomic index replacement makes a batch
visible. A failed metadata commit can leave an unreachable immutable object, but can never expose
a partial version batch. Reads verify byte length and digest. Referenced workspace files are
scope-checked and verified on every read.

The durable lifecycle stream reports version commits, current changes, source moves, source
content changes, missing/restored sources, materialization, and bundle import. Consumers page it
with an ordered sequence cursor rather than introducing another event store.

## One-time Evidence Registry migration

When a workspace has no Artifact Versions records, the first store read looks for the retired
Evidence DAG registry at:

```text
<userDataDir>/evidence-dag/threads/artifact-registries/<legacy-safe-scope>.json
```

The legacy scope is calculated exactly as Evidence DAG did for
`workspaceRoot = projectRoot = <canonical workspace root>`. A valid `artifact-registry.v1` file
is imported without changing that file. Artifact IDs, version IDs, current pointers, SHA-256
digests, and the linear `supersedes` history are retained. Each local locator candidate is read
through the workspace boundary and hashed: matching bytes become a CAS snapshot; unavailable or
non-matching bytes remain a reference. The old availability and retention are retained in version
metadata; effective local availability is marked `missing` when the exact bytes cannot be verified.

Migration is fail-closed and all-or-nothing. A version with no valid SHA-256 digest, or with
neither a verified local byte length nor a recorded size, cannot be represented by an exact
`ArtifactVersionRefV1`, so no new index is published. Malformed, branched, disconnected, or
cross-artifact histories are rejected for the same reason. Unknown legacy access policy shapes
are narrowed to a non-exportable restricted policy while their original JSON is retained in
metadata. A durable migration receipt in `index.v1.json` prevents repeat import after restart.
Legacy `sourceAnchors` are intentionally not imported because they remain owned by Evidence DAG.

## Capabilities

- `artifact-versions.commit`
- `artifact-versions.observe`
- `artifact-versions.read`
- `artifact-versions.list`
- `artifact-versions.materialize`
- `artifact-versions.restore-as-new`
- `artifact-versions.compare`
- `artifact-versions.bundle.export`
- `artifact-versions.bundle.import`
- `artifact-versions.bundle.verify`
- `artifact-versions.events.list`
- `artifact-versions.lifecycle.refresh`

All operations use the capability broker. The package declares no direct transport prefix or
alternate IPC/MCP path.
