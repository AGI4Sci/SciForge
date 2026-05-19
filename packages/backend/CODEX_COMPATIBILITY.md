# Codex CLI Compatibility Notes

Last updated: 2026-05-19

## Current Decision

SciForge should keep using the upstream Codex CLI as an external runtime boundary:

```text
SciForge runtime bridge
-> codex exec --json --profile sciforge-runtime-deepseek
-> packages/backend local Responses proxy
-> DeepSeek-compatible Chat Completions upstream
```

Do not vendor or fork Codex CLI into `packages/backend` by default. The current integration problem is provider compatibility, not a confirmed need to change Codex CLI agent logic.

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

## Native Session Resume

Current upstream Codex CLI exposes:

```bash
codex exec resume --json <SESSION_ID> <PROMPT>
```

SciForge runtime may use that native path for multi-turn continuity when the previous turn surfaced a `codexSessionId` from Codex JSONL `session_meta.payload.id` or the isolated Codex session store. The resumed prompt must remain terminal-equivalent user text; GUI transcript replay, custom AgentServer session logs, provider/capability policy injection, and artifact-body prompt stuffing are outside the runtime bridge boundary.

If `codex exec resume` is unavailable or cannot recover the native session inside `packages/backend/.codex-runtime/codex-home`, browser acceptance should report: single-turn Runtime Codex works, multi-turn is blocked by Phase 1 Codex exec capability and must move to Phase 2 Codex app-server/thread integration.

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

raw codex exec --json JSONL
  audit/debug only

normalized SciForge runtime events
  GUI-facing stream
```

Codex JSONL is the runtime boundary. It does not have to be the final UI protocol. The backend runtime bridge may translate JSONL into a more direct local SSE or normalized event stream for the existing SciForge UI.

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

Smoke Runtime Codex through the isolated home:

```bash
SCIFORGE_RUNTIME_API_KEY="..." \
npm run backend:codex-runtime:exec -- \
  --prompt "Reply with exactly: SCIFORGE_DEEPSEEK_OK"
```

Complex tool-use acceptance should verify all of the following:

- `codex_exit=0`
- JSONL contains `item.started` / `item.completed` tool activity, not only `agent_message`
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
