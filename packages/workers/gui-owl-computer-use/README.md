# @sciforge/gui-owl-computer-use

GUI-Owl-1.5 **vision** computer-use worker: turn one natural-language task into
real desktop actions (click / type / scroll / open apps) on the user's own
**Windows / macOS / Linux** machine.

One end-to-end model — **GUI-Owl-1.5-8B** (Qwen3-VL based) — is the whole agent:
it reads the screen *and* decides each action (no separate planner/grounder, no
Agent-S). After each action the official **Mobile-Agent-v3 Reflector** verifies
the before/after screenshots and self-corrects.

```
                ┌──────────────────────────────────────────────┐
task ──▶        │  observe → GUI-Owl plans+grounds → act → reflect → …  │
                │   model  → GUI-Owl-1.5 (remote vLLM / model router)   │
                │   act    → DesktopExecutor (local, the only OS layer) │
                └──────────────────────────────────────────────┘
```

The model is remote (it only sees screenshots + text); the executor runs locally
where the desktop is. No Linux VM required.

## Relationship to `@sciforge/computer-use`

This worker is **not** a duplicate of the existing
[`packages/workers/computer-use`](../computer-use). They are complementary layers:

| | `@sciforge/computer-use` | `@sciforge/gui-owl-computer-use` (this) |
|---|---|---|
| Level | low-level **primitives** (`click x,y`, `type`, `screenshot`) | high-level **autonomous task** (NL → multi-step) |
| Decides what to click | the caller | the GUI-Owl VLM |
| Tool | `computer_use` (action verbs) | `gui_computer_use_run` (one instruction) |

> Follow-up (not in this drop): the executor could delegate its individual
> click/type/screenshot to `@sciforge/computer-use` so there is a single
> host-control path. Today it uses its own validated `driver/` to preserve the
> end-to-end-verified pipeline.

## Boundary (Servic_Module_Template.md / PROJECT_mcp.md)

- Returns a **`ServiceResult`** with status + trace + screenshot artifact refs —
  **never a final answer or completion truth**. The agent host decides if the
  task is truly done.
- **External side effects require approval**: dry-run by default. Real
  mouse/keyboard happens only when the call sets `execute=true` **and**
  `approve=true` **and** the worker was started with `CUA_ALLOW_EXECUTE=true`;
  otherwise it returns `NEEDS_APPROVAL`.
- **Refs-first**: screenshots are written to disk and returned as artifact refs,
  never inlined into a tool result.
- **Model router**: in production point `CUA_MODEL_BASE_URL` at the SciForge
  model router's OpenAI-compatible gateway rather than the raw vLLM endpoint.

## Package layout

| Concern | File |
|---|---|
| Public contract (tool names, schemas, error codes, result mapping) | `cua/contract.py` |
| ServiceResult envelope | `cua/result.py` |
| Service core: the observe→plan→act→reflect loop, trace, safety | `cua/runner.py` |
| GUI-Owl driver (prompt, call, parse, coord mapping) | `cua/owl_agent.py` |
| Mobile-Agent-v3 reflector | `cua/reflector.py` |
| Env-driven config | `cua/config.py` |
| Cancellation registry | `cua/cancel.py` |
| **MCP** stdio transport adapter | `cua/mcp_server.py` |
| **HTTP** ServiceResult sidecar | `cua/server.py` |
| Local entry (`--stdio` / `--http`) | `cua/cli.py` |
| Cross-platform desktop executor | `driver/desktop.py` |
| Click-through mouse overlay | `driver/overlay.py` |
| Pure contract/result/parse tests | `tests/test_contract.py` |

## MCP tools

- `gui_computer_use_run` — `{ instruction, execute?, approve?, imagePath?, imageBase64?, requestId? }`
- `gui_computer_use_cancel` — `{ requestId }`

The full machine-readable `ServiceResult` is returned as a compact JSON text
block alongside a one-line summary; screenshots stay as artifact refs.

## Run

```bash
python -m pip install -r requirements.txt

# MCP stdio server (for Kun / Codex / agent runtimes):
python -m cua.cli --stdio

# HTTP sidecar (curl-able; what the Kun computer_use tool provider calls):
python -m cua.cli --http        # -> http://127.0.0.1:3900

# dry-run (safe): plan + ground against a static screen, no actions
curl -s localhost:3900/computer-use/run \
  -d '{"instruction":"click the Save button","imagePath":"some_ui.png"}'

# live execution (opt-in): start with CUA_ALLOW_EXECUTE=true, then
curl -s localhost:3900/computer-use/run \
  -d '{"instruction":"open Notepad and type hello","execute":true,"approve":true}'
```

Standalone service smoke test (no GUI): start `--http`, then
`python accept.py --task "open Notepad"` (add `--execute` for real actions).

To launch the **full SciForge GUI with this module wired in** (so the in-app
agent gets a `computer_use` tool), use the repo-root one-click launcher
`一键启动-computer-use.bat` / `启动-sciforge-computer-use.ps1`, which starts the
SSH tunnel + this service, sets `SCIFORGE_CUA_SERVICE_URL`, and runs `npm run dev`.

## Config

See [`.env.example`](.env.example). Key vars: `CUA_MODEL_BASE_URL`, `CUA_MODEL`,
`CUA_MODEL_API_KEY`, `CUA_MAX_STEPS`, `CUA_REFLECT`, `CUA_ALLOW_EXECUTE`,
`CUA_PORT`, `CUA_SHOW_OVERLAY`, `CUA_ARTIFACT_DIR`.
