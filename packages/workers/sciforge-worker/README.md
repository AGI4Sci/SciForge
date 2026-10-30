# SciForge Worker

The worker is launched over an authenticated SSH stdio channel. Its frame envelope is intentionally thin and reuses the canonical Workspace Host operation, payload, and event contracts from `@sciforge/domain-sdk/workspace-host`.

The `sciforge-worker` entrypoint reuses the Workspace Host service and JSONL server over SSH stdio; it does not implement a second operation layer.
