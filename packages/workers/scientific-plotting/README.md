# SciForge Scientific Plotting Worker

First-party MCP worker for controlled scientific plotting, figure style extraction/review, and read-only K-Dense Scientific Agent Skills discovery.

Generic vector scenes enter through the route-locked `VisualScene` owned by
`visual_generate`. The worker maps code-owned scene layers into its existing
`schematic-grid` renderer; it does not expose a second raw-primitives planning
path. On hybrid routes its render result hands the truth artifact to the model
stage, and the deterministic composite hands the final artifact to unified
semantic review.

Governed map/render/rerun requests carry a persistent `operationId`. Formal
reproducible renders reject inline or workspace-file inputs until they are
pinned as Artifact Versions, retain exact pre-commit candidate digests for
crash recovery, and publish immutable Evidence lineage receipts for asynchronous
Evidence DAG ingestion. An `enqueued` receipt is a durable handoff only, not a
claim that an Evidence Snapshot or L4 assessment exists.

The scientific skills MCP tools only index/search/read/plan against locally installed K-Dense skills. Explicit installation is a separate GUI/IPC approval path that writes the selected workspace target and `.sciforge-provenance.json`; the MCP tools do not silently install, update, execute, or add those third-party skills to always-on runtime roots.

It exposes two stdio launch flags through the SciForge app node entries:

- `--scientific-skills-mcp-server`
- `--scientific-plotting-mcp-server`
