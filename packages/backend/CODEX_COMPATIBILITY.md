# Codex CLI Compatibility Notes

Last updated: 2026-05-30

## Current Decision

SciForge should keep using upstream Codex as an external runtime boundary, but the product runtime now targets Codex app-server:

```text
SciForge runtime bridge
-> codex app-server --listen stdio://
-> thread/start or thread/resume + turn/start
-> packages/backend local Responses proxy
-> DeepSeek-compatible Chat Completions upstream
```

`codex exec --json` is retained only for legacy/test-only compatibility and historical evidence. Do not vendor or fork Codex CLI into `packages/backend` by default. The current integration problem is provider compatibility and app-server event integration, not a confirmed need to change Codex CLI agent logic.

## Why Not Fork Now

- The successful boundary is already small: Codex CLI speaks Responses API, while `packages/backend` adapts provider-specific Chat Completions behavior.
- Provider quirks can be fixed and tested locally in the proxy without taking ownership of Codex CLI sandbox, approval, plugin, and event-stream internals.
- Forking Codex CLI would make upstream security fixes, model metadata updates, tool protocol changes, and plugin behavior harder to absorb.
- SciForge needs a runtime compatibility layer it can audit and test quickly; a fork should be a last resort, not the default extension point.

## Fork Trigger Conditions

Consider a Codex CLI fork only if all of these are true:

- The blocker cannot be fixed through Codex config, runtime profile isolation, or the provider compatibility proxy.
- The required change is inside Codex CLI itself, such as tool dispatch, sandbox behavior, approval handling, or event emission.
- The patch can be kept small and documented with fixtures.
- The fork can live outside the main backend package path, for example under `vendor/` or a separate worktree/submodule.
- A rebase checklist exists before the fork is used by the default SciForge runtime path.

## Runtime Isolation Contract

Developer Codex and Runtime Codex must remain separate:

```text
Developer Codex
  CODEX_HOME: ~/.codex
  purpose: edit SciForge
  model: developer-selected, currently GPT-5.5

Runtime Codex
  CODEX_HOME: packages/backend/.codex-runtime/codex-home
  purpose: serve SciForge user tasks
  profile: sciforge-runtime-deepseek
  model: bailian/deepseek-v4-flash
  provider: sciforge-deepseek-proxy
```

Runtime config, memories, sessions, logs, and the default scratch workspace stay under:

```text
packages/backend/.codex-runtime/
```

Secrets must stay in process environment variables, especially `SCIFORGE_RUNTIME_API_KEY`.

## Native Thread Resume

Current product runtime uses Codex app-server thread semantics:

```bash
thread/resume <THREAD_ID>
turn/start <PROMPT>
```

SciForge runtime may use that native app-server path for multi-turn continuity when the previous turn surfaced a `threadId`/`codexSessionId` from Codex app-server. The resumed prompt must remain terminal-equivalent user text; GUI transcript replay, custom AgentServer session logs, provider/capability policy injection, and artifact-body prompt stuffing are outside the runtime bridge boundary.

Legacy `codex exec resume --json` remains test-only compatibility evidence. It must not be used to satisfy product runtime, release acceptance, or app-server parity requirements.

## Known DeepSeek Compatibility Fix

DeepSeek Chat Completions streaming tool-call chunks may send empty string fields in later deltas:

```json
{
  "tool_calls": [
    {
      "index": 0,
      "id": "",
      "function": {
        "name": "",
        "arguments": "{\"cmd\":\"printf OK\"}"
      }
    }
  ]
}
```

Earlier chunks can contain the real tool call id and function name. The proxy must not let later empty fields overwrite non-empty values.

Failure symptom before the fix:

```text
ERROR codex_core::tools::router: error=unsupported call:
```

The model would repeatedly say it was going to use `exec_command`, but Codex would receive a completed function call with an empty `name`, so no tool executed.

Current fix location:

```text
packages/backend/src/proxy.ts
```

Regression test:

```text
packages/backend/src/response-compat.test.ts
```

Test name:

```text
preserves streaming tool call name across empty DeepSeek deltas
```

## Event Stream Policy

Do not expose raw provider streams directly as the main GUI contract.

Keep three layers:

```text
raw upstream SSE
  audit/debug only

raw legacy codex exec --json JSONL
  legacy/test-only audit/debug only

normalized SciForge runtime events
  GUI-facing stream
```

Codex app-server rich-client events are the product runtime boundary. Legacy JSONL may still be translated into normalized events for fixture replay and regression coverage, but it is not a product fallback.

## Verification Commands

Local backend tests:

```bash
npm --workspace @sciforge/backend test
npm run typecheck
git diff --check
```

Generate or refresh the isolated Runtime Codex home:

```bash
npm run backend:codex-runtime:setup -- --overwrite
```

Start the local Responses proxy:

```bash
SCIFORGE_RUNTIME_API_KEY="..." \
SCIFORGE_PROXY_UPSTREAM_BASE_URL="http://35.220.164.252:3888/v1" \
npm run backend:codex-proxy
```

Smoke the legacy exec JSON path only when auditing compatibility fixtures:

```bash
SCIFORGE_RUNTIME_API_KEY="..." \
npm run backend:codex-runtime:exec -- \
  --prompt "Reply with exactly: SCIFORGE_DEEPSEEK_OK"
```

Product runtime acceptance should use Codex app-server and verify all of the following:

- app-server emits `thread/*`, `turn/*`, `item/*`, approval, and dynamic-tool lifecycle events
- a command is actually executed by Codex
- workspace files are created or modified as requested
- generated artifacts pass deterministic validation

The latest successful complex check used a CSV analysis task. Runtime Codex read `README.md` and `data/measurements.csv`, ran commands, wrote `report.md` and `summary.json`, and produced:

```text
A = 12
B = 8
C = 22.5
highestMeanGroup = C
```

## Codex CLI Upgrade Checklist

When upgrading Codex CLI:

1. Confirm `codex --version`.
2. Capture one `/v1/responses` request body against a local fake provider and inspect `tools`, `tool_choice`, `parallel_tool_calls`, and streaming expectations.
3. Run `npm --workspace @sciforge/backend test`.
4. Run direct proxy tool-call shape smoke and confirm function call `name` and `call_id` are non-empty.
5. Run Runtime Codex simple completion through isolated `CODEX_HOME`.
6. Run Runtime Codex complex tool-use acceptance.
7. Check stderr for new tool router errors, schema errors, or Responses event-shape warnings.
8. Only consider Codex CLI source changes if the failure cannot be fixed in config or the proxy.

## Source Change Log

### 2026-05-19

- Added isolated Runtime Codex home under `packages/backend/.codex-runtime`.
- Added `sciforge-runtime-deepseek` profile template and setup wrapper.
- Added `backend:codex-runtime:exec` wrapper that forces isolated `CODEX_HOME`.
- Fixed DeepSeek streaming tool-call delta handling so empty later deltas do not clear `call_id` or `name`.
- Verified DeepSeek can complete a real tool-use task through upstream Codex CLI without forking Codex.
