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

Run Runtime Codex through the isolated home:

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

## Boundary

This package is a protocol compatibility tool. It does not include GUI state, task planning, approval policy, workspace persistence, or agent orchestration. Those concerns stay outside this package and should call the local HTTP endpoint only when they need a model-provider compatibility bridge.

## Verification

```bash
node --import tsx --test packages/backend/src/*.test.ts
npm run smoke:workspace-package-metadata
npm run smoke:package-runtime-boundary
```
