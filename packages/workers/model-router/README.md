# SciForge Model Router

Standalone provider-compatible `/v1/responses` facade for SciForge multimodal routing.

The router is a deterministic orchestrator. It selects registered profile roles, translates visual inputs into text observations, runs a bounded supplement loop, and writes refs-first trace bundles under `.sciforge/model-router-traces`. It does not plan tasks, choose capabilities for agents, execute desktop actions, or silently fall back to unregistered providers.

## Run

```bash
npm run backend:model-router -- --port 3892 --workspace-root /path/to/workspace
```

The default environment-driven profile uses role-oriented settings:

```bash
export SCIFORGE_MODEL_ROUTER_PUBLIC_MODEL_ALIAS=sciforge-router
export SCIFORGE_TEXT_BASE_URL=https://text-provider.example/v1
export SCIFORGE_TEXT_MODEL=private-text-model
export SCIFORGE_TEXT_API_KEY=...
export SCIFORGE_VISION_BASE_URL=https://vision-provider.example/v1
export SCIFORGE_VISION_MODEL=private-vision-model
export SCIFORGE_VISION_API_KEY=...
```

`SCIFORGE_MODEL_ROUTER_CONFIG=/path/to/router.config.json` can provide the same `ModelRouterConfig` shape exported by `src/router.ts`. Public UI and audits should show only the router alias/profile/role readiness; provider URLs, API keys, and raw model slugs remain private router configuration.

## Trace Audit

Trace bundles are refs-first evidence. They should contain role aliases, hashes, public router alias/profile, bounded call status, and sanitized summaries only. After a live or staging provider run, scan the trace root before using it as release evidence:

```bash
node --import tsx tools/model-router-trace-audit.ts \
  --trace-root .sciforge/model-router-traces \
  --known-secret-env SCIFORGE_TEXT_API_KEY \
  --known-secret-env SCIFORGE_VISION_API_KEY \
  --out docs/test-artifacts/model-router-live-trace-audit/report.json
```

The report stores finding kinds, file refs, JSON paths, and hashes only. It must not echo matching secret values.
