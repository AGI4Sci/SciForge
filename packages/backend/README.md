# SciForge Backend Tools

Small backend utilities for connecting CLI agent runtimes to provider endpoints used by SciForge.

See [`CODEX_COMPATIBILITY.md`](CODEX_COMPATIBILITY.md) for the Codex CLI integration boundary, provider compatibility notes, and the upgrade checklist.

## Model Router

Runtime Codex defaults to the SciForge Model Router public alias/profile. Product UI, Browser acceptance, and runtime audit surfaces should show only the router alias/profile, capabilities, role coverage, and readiness. Provider URLs, raw model slugs, and member-model API keys remain private Model Router configuration.

Start the Model Router with member-model configuration in environment variables:

```bash
export SCIFORGE_RUNTIME_API_KEY="sciforge-local-model-router"
export SCIFORGE_TEXT_BASE_URL="https://provider-compatible-endpoint.example/v1"
export SCIFORGE_TEXT_MODEL="private-text-model"
export SCIFORGE_TEXT_API_KEY="..."
npm run backend:model-router -- --host 127.0.0.1 --port 3892
```

Codex profile example:

```toml
[profiles.sciforge-runtime-default]
model = "sciforge-router"
model_provider = "sciforge-model-router"
model_reasoning_effort = "low"
model_reasoning_summary = "none"

[model_providers.sciforge-model-router]
name = "SciForge Model Router"
base_url = "http://127.0.0.1:3892/v1"
env_key = "SCIFORGE_RUNTIME_API_KEY"
wire_api = "responses"
```

The legacy Codex Responses proxy CLI is disabled for active Runtime/Browser paths. Use Model Router for local diagnostics and product acceptance.

Useful options:

```bash
npm run backend:model-router -- \
  --host 127.0.0.1 \
  --port 3892
```

For Runtime Codex browser acceptance, `SCIFORGE_RUNTIME_API_KEY` must be present in the service environment that starts Runtime Codex/Model Router, and `SCIFORGE_MODEL_ROUTER_BASE_URL` (or Router URL/PORT) must point to the router `/v1` endpoint. A member-model key found in `config.local.json` or `.sciforge/**/config.local.json` cannot satisfy release acceptance by itself.

## Isolated Runtime Codex Home

SciForge uses two Codex instances with separate responsibilities:

- Developer Codex uses the normal user `CODEX_HOME` and edits the SciForge repository.
- Runtime Codex uses `packages/backend/.codex-runtime/codex-home`, the `sciforge-runtime-default` profile, and a task workspace.

Generate or refresh the local runtime home:

```bash
npm run backend:codex-runtime:setup -- --overwrite
```

This creates:

```text
packages/backend/.codex-runtime/codex-home/config.toml
packages/backend/.codex-runtime/codex-home/memories/
packages/backend/.codex-runtime/codex-home/sessions/
packages/backend/.codex-runtime/logs/
packages/backend/.codex-runtime/workspaces/default/
```

`packages/backend/.codex-runtime/**` is intentionally ignored by git. It is the local state boundary for runtime Codex config, memories, sessions, logs, and the default scratch workspace.

Legacy exec JSON compatibility smoke only:

The product Runtime Codex path uses `codex app-server` and the SciForge web/browser acceptance flow. The wrapper below only preserves the legacy `codex exec --json` compatibility smoke path and does not satisfy product runtime or release acceptance on its own.

```bash
SCIFORGE_RUNTIME_API_KEY="..." \
npm run backend:codex-runtime:exec -- \
  --prompt "Reply with exactly: SCIFORGE_RUNTIME_OK"
```

By default, the wrapper keeps the task workspace inside `packages/backend/.codex-runtime/workspaces/default`. SciForge can pass a real user workspace explicitly:

```bash
SCIFORGE_RUNTIME_API_KEY="..." \
npm run backend:codex-runtime:exec -- \
  --workspace "$SCIFORGE_USER_WORKSPACE" \
  --allow-workspace-outside-runtime-root \
  --prompt "$SCIFORGE_USER_TEXT_COMMAND"
```

The wrapper fails closed if the isolated `CODEX_HOME` leaves `packages/backend/.codex-runtime`, if the Model Router profile/provider/alias is missing, or if the configured runtime provider key is absent. Secrets stay in the process environment, not in repository files.

## Browser Acceptance Service Checklist

Runtime Codex browser acceptance expects the Model Router-compatible provider facade plus the SciForge services below to be alive. Concrete upstream text reasoner and vision translator choices live in private router config, not in UI defaults or audit output.

```text
UI:               http://127.0.0.1:5173/
Workspace writer: http://127.0.0.1:6173/health
Runtime Codex:    http://127.0.0.1:18080/health
Model Router:     http://127.0.0.1:3892/health
```

No-secret service launch skeleton:

```bash
export SCIFORGE_UI_PORT=5173
export SCIFORGE_WORKSPACE_PORT=6173
export SCIFORGE_RUNTIME_CODEX_PORT=18080
export SCIFORGE_MODEL_ROUTER_PORT=3892
export SCIFORGE_WORKSPACE_PATH="$PWD/workspace/parallel/p1"
export SCIFORGE_RUNTIME_API_KEY="<set-in-service-env-only>"
export SCIFORGE_TEXT_BASE_URL="https://text-provider-compatible-endpoint.example/v1"
export SCIFORGE_TEXT_MODEL="<private-text-reasoner-model>"
export SCIFORGE_TEXT_API_KEY="$SCIFORGE_RUNTIME_API_KEY"
export SCIFORGE_VISION_BASE_URL="https://vision-provider-compatible-endpoint.example/v1"
export SCIFORGE_VISION_MODEL="<private-vision-translator-model>"
export SCIFORGE_VISION_API_KEY="$SCIFORGE_RUNTIME_API_KEY"

npm run backend:model-router -- --host 127.0.0.1 --port 3892
npm run backend:codex-runtime:setup -- --overwrite --model-router-base-url http://127.0.0.1:3892/v1
SCIFORGE_WORKSPACE_PORT=6173 npm run workspace:server
SCIFORGE_RUNTIME_CODEX_PORT=18080 node --import tsx src/runtime/codex/codex-runtime-standalone-server.ts
npm run dev:ui -- --host 127.0.0.1 --port 5173 --strictPort
```

Before claiming acceptance, run:

```bash
npm run smoke:runtime-provider-preflight
npm run smoke:runtime-codex-browser-acceptance
SCIFORGE_REQUIRE_LIVE_BROWSER_ACCEPTANCE=1 npm run smoke:runtime-codex-browser-acceptance
```

The preflight artifact is diagnostic-only. Browser/release acceptance is still blocked until the Codex in-app browser default chat shows a live non-seed Runtime Codex second-turn answer and the strict manifest is `passed`.

## Boundary

This package is a protocol compatibility tool. It does not include GUI state, task planning, approval policy, workspace persistence, or agent orchestration. Those concerns stay outside this package and should call the local HTTP endpoint only when they need a model-provider compatibility bridge.

## Verification

```bash
node --import tsx --test packages/backend/src/*.test.ts
npm run smoke:workspace-package-metadata
npm run smoke:package-runtime-boundary
```
