## Why

Evidence DAG and scientific plotting both need stable research-artifact identity, immutable bytes, exact dependencies, history, recovery, and portable verification. Keeping those mechanics inside either feature would create competing registries and make a figure's provenance diverge from the evidence used to justify it.

## What Changes

- Add `@sciforge/domain-artifact-versions` as the only owner of Artifact identity, immutable Version records, CAS bytes, current pointers, lifecycle events, restore, and bundles.
- Migrate Evidence DAG to exact `ArtifactVersionRefV1` projections while retaining ownership of SourceAnchor, Run, Claim, assessment, stale policy, and immutable Evidence Snapshot.
- Make Scientific Plotting a governed producer that atomically commits derived data, recipe, figure, render manifest, and log, then emits Evidence lineage.
- Add exact-version rerun, clean-room bundle reproduction, Artifact History UI, plotting provenance UI, and version-bound Visual Review.
- Version Evidence exports such as PROV, RO-Crate, DataCite, audit, and reproduction reports through the same Artifact Versions write path.
- **BREAKING** Remove Evidence's live Artifact Registry write path and the plotting worker's parallel MCP business endpoints.

## Capabilities

### New Capabilities

- `research-artifact-versioning`: immutable versions, CAS bytes, dependencies, recovery, lifecycle, and verifiable bundles.
- `scientific-plot-provenance`: explicit data, transformations, statistics, parameters, environment, execution, review, and exact rerun.
- `versioned-evidence-exports`: fixed-snapshot semantic exports saved as immutable Artifact Versions.

### Modified Capabilities

- `durable-evidence-dag-update`: consumes exact Artifact Version references and durable lifecycle events without owning a second registry.
- `domain-package-composition`: discovers Artifact Versions and Scientific Plotting as installed domain packages.

## Impact

- New Artifact Versions and Scientific Plotting domain packages and renderer contributions.
- Evidence DAG contracts, persistence projections, lifecycle consumer, exports, and one-time Registry migration.
- Scientific Plotting worker contracts and fixtures; Visual Review activation and accept flow.
- Generated installed-domain composition, capability governance, package lock, research report, and source/packaged smoke paths.
