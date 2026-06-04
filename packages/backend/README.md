# SciForge Backend Tools

Small backend utilities for connecting CLI agent runtimes to provider endpoints used by SciForge.

See [`CODEX_COMPATIBILITY.md`](CODEX_COMPATIBILITY.md) for the Codex CLI integration boundary, DeepSeek compatibility notes, and the upgrade checklist.

## Codex Responses Proxy

`codex-responses-proxy` exposes an OpenAI-compatible `/v1/responses` endpoint for Codex CLI and forwards requests to an upstream `/v1/chat/completions` provider. It is intended for providers that support Chat Completions but do not yet implement the Responses API shape expected by recent Codex CLI releases.

The proxy keeps API keys out of repository files. Provide the key through an environment variable and point Codex at the local proxy:

```bash
export SCIFORGE_RUNTIME_API_KEY="..."
export SCIFORGE_PROXY_UPSTREAM_BASE_URL="http://35.220.164.252:3888/v1"
npm run backend:codex-proxy
```

Codex profile example:

```toml
[profiles.sciforge-runtime-deepseek]
model = "bailian/deepseek-v4-flash"
model_provider = "sciforge-deepseek-proxy"
model_reasoning_effort = "low"
model_reasoning_summary = "none"

[model_providers.sciforge-deepseek-proxy]
name = "SciForge DeepSeek Proxy"
base_url = "http://127.0.0.1:3891/v1"
env_key = "SCIFORGE_RUNTIME_API_KEY"
wire_api = "responses"
```

Useful options:

```bash
npm run backend:codex-proxy -- \
  --host 127.0.0.1 \
  --port 3891 \
  --upstream-base-url http://35.220.164.252:3888/v1 \
  --api-key-env SCIFORGE_RUNTIME_API_KEY
```

For Runtime Codex browser acceptance, the key source is stricter than local proxy debugging: `SCIFORGE_RUNTIME_API_KEY` must be present in the service environment that starts the proxy/runtime process. A key found in `config.local.json` or `.sciforge/**/config.local.json` is diagnostic-only fallback for local proxy troubleshooting and cannot satisfy release acceptance.

## Isolated Runtime Codex Home

SciForge uses two Codex instances with separate responsibilities:

- Developer Codex uses the normal user `CODEX_HOME` and edits the SciForge repository.
- Runtime Codex uses `packages/backend/.codex-runtime/codex-home`, the `sciforge-runtime-deepseek` profile, and a task workspace.

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

The wrapper fails closed if the isolated `CODEX_HOME` leaves `packages/backend/.codex-runtime`, if the DeepSeek profile/provider/model is missing, or if `SCIFORGE_RUNTIME_API_KEY` is absent. Secrets stay in the process environment, not in repository files.

## Browser Acceptance Service Checklist

The legacy no-secret Runtime Codex browser acceptance path expects a KV-Ground-compatible service plus four SciForge services to be alive. Current Computer Use design defaults both VLM and grounding to `qwen3.7-plus`.

```text
Legacy Grounder: http://127.0.0.1:18081/health
UI:               http://127.0.0.1:5173/
Workspace writer: http://127.0.0.1:6173/health
Runtime Codex:    http://127.0.0.1:18080/health
Provider proxy:   http://127.0.0.1:3891/healthz
```

No-secret service launch skeleton:

```bash
export SCIFORGE_UI_PORT=5173
export SCIFORGE_WORKSPACE_PORT=6173
export SCIFORGE_RUNTIME_CODEX_PORT=18080
export SCIFORGE_PROXY_PORT=3891
export SCIFORGE_WORKSPACE_PATH="$PWD/workspace/parallel/p1"
export SCIFORGE_PROXY_UPSTREAM_BASE_URL="https://your-openai-compatible-endpoint.example/v1"
export SCIFORGE_RUNTIME_API_KEY="<set-in-service-env-only>"

npm run backend:codex-runtime:setup -- --overwrite --proxy-base-url http://127.0.0.1:3891/v1
npm run backend:codex-proxy
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
