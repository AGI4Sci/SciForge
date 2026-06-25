# @sciforge/gui-owl-computer-use

GUI-Owl-1.5 **vision** computer-use worker: turn one natural-language task into
real desktop actions (click / type / scroll / open apps) on the user's own
**Windows / macOS / Linux** machine.

Computer-use is delegated **end-to-end to one model — GUI-Owl-1.5-32B**
(Qwen3-VL based). That single model is the whole agent: it reads the screen,
plans, grounds (pixel coords) *and* decides when to stop — **no planner/grounder
split, no Agent-S, and the main agent (DeepSeek) does not plan the steps**; it
just hands the whole task to `computer_use`. The optional Mobile-Agent-v3
Reflector is **off by default** for the 32B (it's strong enough end-to-end).

```
                ┌──────────────────────────────────────────────┐
task ──▶        │  observe → GUI-Owl plans+grounds+decides → act → …    │
                │   model  → GUI-Owl-1.5-32B (remote vLLM, served "gui-owl") │
                │   act    → DesktopExecutor (local, the only OS layer) │
                └──────────────────────────────────────────────┘
```

The model is remote (it only sees screenshots + text); the executor runs locally
where the desktop is. No Linux VM required. Serve it with
[`server/serve-gui-owl-32b.sh`](server/serve-gui-owl-32b.sh) (tensor-parallel
across 2 GPUs). The 8B variant also works — just point `CUA_MODEL_BASE_URL` at it
and set `CUA_REFLECT=true`.

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
| GUI-Owl 32B vLLM serve script (runs on the GPU box) | `server/serve-gui-owl-32b.sh` |
| One-click launcher: tunnel + service + SciForge GUI | `一键启动-computer-use.bat`, `启动-sciforge-computer-use.ps1` |
| Launcher secrets template (copy to `启动-secrets.local.ps1`) | `启动-secrets.example.ps1` |

Everything for the module lives in this one folder; see **Integration touchpoints**
below for the few unavoidable edits elsewhere in the app.

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
agent gets a `computer_use` tool), double-click `一键启动-computer-use.bat`
(or run `启动-sciforge-computer-use.ps1`) **in this folder**: it builds the SSH
tunnel to the GUI-Owl box, starts this service, sets `SCIFORGE_CUA_SERVICE_URL`,
then runs `npm run dev` from the repo root.

## Integration touchpoints (outside this folder)

The module is self-contained here; the only edits elsewhere in the app are the
minimal wiring needed to expose it to the agent runtime:

| File | Why |
|---|---|
| `kun/src/adapters/tool/computer-use-tool-provider.ts` (+ test) | the Kun `computer_use` tool that calls this service over HTTP |
| `kun/src/server/runtime-factory.ts` | registers the tool provider (1 import + 1 spread) |
| `src/main/kun-process.ts` | disables the built-in browser/native `computer_use` MCP when this module is active (avoids a duplicate tool name) |
| `src/main/model-router-sidecar.ts` | unrelated Windows fix: spawn `npm.cmd` via a shell (Node EINVAL) so the Model Router can auto-start |

## Config

See [`.env.example`](.env.example). Key vars: `CUA_MODEL_BASE_URL`, `CUA_MODEL`,
`CUA_MODEL_API_KEY`, `CUA_MAX_STEPS`, `CUA_REFLECT`, `CUA_ALLOW_EXECUTE`,
`CUA_PORT`, `CUA_SHOW_OVERLAY`, `CUA_ARTIFACT_DIR`.
