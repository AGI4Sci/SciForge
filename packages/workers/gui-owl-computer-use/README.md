# @sciforge/gui-owl-computer-use

Model-Router-backed **vision** computer-use worker: turn one natural-language
task into real desktop actions (click / type / scroll / open apps) on the
user's own **Windows / macOS / Linux** machine.

Computer-use is delegated through SciForge's app-owned Model Router. The routed
vision and reasoning models read the screen, plan,
grounds pixel coordinates, and decides when to stop. The main agent does not
call provider APIs or plan the desktop steps; it hands the task to
`computer_use`, and this worker sends model traffic only to the local Model
Router responses endpoint.

```
                ┌──────────────────────────────────────────────┐
task ──▶        │  observe → routed model plans+grounds+decides → act → …    │
                │   model  → local SciForge Model Router                      │
                │   act    → DesktopExecutor (local, the only OS layer) │
                └──────────────────────────────────────────────┘
```

The model is remote (it only sees screenshots + text); the executor runs locally
where the desktop is. No Linux VM required. This package does not ship model
weights. The development-only
[`server/serve-gui-owl-32b.sh`](server/serve-gui-owl-32b.sh) helper refuses to
start unless the operator explicitly opts in and supplies a licensed checkpoint.

## Relationship to the retired primitive MCP path

This worker is now the single computer-use path. The old
`@sciforge/computer-use` GUI-managed primitive MCP server has been retired, and
startup cleanup removes stale `gui_computer_use` entries from user MCP config.

All runtimes expose the same `computer_use` tool through the GUI-managed
`gui_owl_computer_use` MCP wrapper. That wrapper calls this HTTP sidecar.
GUI-Owl owns the observe → plan → act loop, while Model Router owns all
model/provider selection and policy.

## Boundary (Servic_Module_Template.md / PROJECT_mcp.md)

- Returns a **`ServiceResult`** with status + trace + screenshot artifact refs —
  **never a final answer or completion truth**. The agent host decides if the
  task is truly done.
- **External side effects require approval**: dry-run by default. Real
  mouse/keyboard happens only when the call sets `execute=true` **and**
  `approve=true` **and** the worker was started with `CUA_ALLOW_EXECUTE=true`;
  otherwise it returns `NEEDS_APPROVAL`.
- **HTTP sidecar auth**: `POST /computer-use/run` and
  `POST /computer-use/cancel` accept an optional bearer token via
  `CUA_SERVICE_TOKEN`. The GUI launcher generates a random token per start and
  passes it to the GUI-managed MCP wrapper as `SCIFORGE_CUA_SERVICE_TOKEN`.
- **Refs-first**: screenshots are written to disk and returned as artifact refs,
  never inlined into a tool result.
- **Model Router only**: computer-use and optional reflection share the local
  Model Router public alias (`sciforge-router` by default). This worker accepts
  no upstream provider URL, provider model name, provider header, or provider
  credential.

## Package layout

| Concern | File |
|---|---|
| Public contract (tool names, schemas, error codes, result mapping) | `cua/contract.py` |
| ServiceResult envelope | `cua/result.py` |
| Service core: the observe→plan→act→reflect loop, trace, safety | `cua/runner.py` |
| Grounding model driver (prompt, call, parse, coord mapping) | `cua/owl_agent.py` |
| Mobile-Agent-v3 reflector | `cua/reflector.py` |
| Env-driven config | `cua/config.py` |
| Cancellation registry | `cua/cancel.py` |
| **MCP** stdio transport adapter | `cua/mcp_server.py` |
| **HTTP** ServiceResult sidecar | `cua/server.py` |
| Local entry (`--stdio` / `--http`) | `cua/cli.py` |
| Cross-platform desktop executor | `driver/desktop.py` |
| Click-through mouse overlay | `driver/overlay.py` |
| Pure contract/result/parse tests | `tests/test_contract.py` |
| Development-only local model serve helper | `server/serve-gui-owl-32b.sh` |
| One-click launcher: Model Router config + service + SciForge GUI | `一键启动-computer-use.bat`, `启动-sciforge-computer-use.ps1` |
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
export CUA_SERVICE_TOKEN=dev-local-token
export SCIFORGE_MODEL_ROUTER_BASE_URL=http://127.0.0.1:3892/v1
export SCIFORGE_MODEL_ROUTER_MODEL=sciforge-router
export SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY=replace-with-router-runtime-key

# MCP stdio server (worker-native contract; the app uses a managed wrapper):
python -m cua.cli --stdio

# HTTP sidecar (curl-able; what the GUI-managed MCP wrapper calls):
python -m cua.cli --http        # -> http://127.0.0.1:3900

# dry-run (safe): plan + ground against a static screen, no actions
curl -s localhost:3900/computer-use/run \
  -H "Authorization: Bearer $CUA_SERVICE_TOKEN" \
  -d '{"instruction":"click the Save button","imagePath":"some_ui.png"}'

# live execution (opt-in): start with CUA_ALLOW_EXECUTE=true, then
curl -s localhost:3900/computer-use/run \
  -H "Authorization: Bearer $CUA_SERVICE_TOKEN" \
  -d '{"instruction":"open Notepad and type hello","execute":true,"approve":true}'
```

Standalone service smoke test (no GUI): start `--http`, then
`python accept.py --task "open Notepad"` (add `--execute` for real actions).

To launch the **full SciForge GUI with this module wired in** (so the in-app
agent gets a `computer_use` tool), double-click `一键启动-computer-use.bat`
(or run `启动-sciforge-computer-use.ps1`) **in this folder**: it verifies
the local Model Router runtime key, starts this service, sets `SCIFORGE_CUA_SERVICE_URL`,
then runs `npm run dev` from the repo root.

## Integration touchpoints (outside this folder)

The module is self-contained here; the only edits elsewhere in the app are the
minimal wiring needed to expose it to the agent runtime:

| File | Why |
|---|---|
| `src/main/computer-use-mcp-server.ts` | GUI-managed MCP wrapper that exposes `computer_use` and calls this sidecar |
| `src/main/gui-mcp-registry.ts` | registers `gui_owl_computer_use` for Codex and Claude Code |

## Config

See [`.env.example`](.env.example). Key vars: `SCIFORGE_MODEL_ROUTER_BASE_URL`,
`SCIFORGE_MODEL_ROUTER_MODEL`, `SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY`,
`CUA_MAX_STEPS`, `CUA_REFLECT`, `CUA_ALLOW_EXECUTE`,
`CUA_PORT`, `CUA_SERVICE_TOKEN`, `CUA_SHOW_OVERLAY`, `CUA_ARTIFACT_DIR`.
