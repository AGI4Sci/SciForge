# SciForge Web Observe

This package owns the read-only web observe capability contracts.

It answers what SciForge can ask from web providers:

- `web_search`: search public web or configured search indexes and return ranked result refs with provider diagnostics.
- `web_fetch`: fetch a public URL or search result URL through a configured network provider and return durable content refs.

It does not own where the work runs. The default standalone implementation lives in `packages/workers/web-worker` and advertises provider routes such as `sciforge.web-worker.web_search` and `sciforge.web-worker.web_fetch`.

## Boundary

- Capability contract lives here: ids, schemas, validators, side effects, repair hints, and examples.
- Worker/provider implementation lives in a worker package or an AgentServer-discovered provider.
- Runtime provider selection, route recording, preflight, validation, and repair orchestration stay in `src/runtime`.
