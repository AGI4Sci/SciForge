# SciForge Computer-Use Plugin

A standalone, plug-and-play module that gives SciForge **GUI computer-use** ability: turn a
natural-language task into screen actions (click / type / scroll) on the user's own
**Windows / macOS / Linux** desktop.

It does **not** reinvent the agent loop. It drives a validated SOTA loop —
**Agent-S / `AgentS2_5`** (OSWorld benchmark SOTA, Worker + reflection, no external-search
dependency) — and only injects three swappable pieces:

```
          ┌──────────────────────────────────────────────┐
task ──▶  │  AgentS2_5 loop  (observe→plan→ground→act→…)  │
          │    plan/reflect → qwen3.7-plus  (planner)     │  ← remote, OS-agnostic
          │    ground       → GUI-Owl-1.5-8B (grounder)   │  ← remote, OS-agnostic
          │    act          → DesktopExecutor             │  ← local, the only OS layer
          └──────────────────────────────────────────────┘
```

The **grounder** and **planner** are remote inference services (they only take screenshots +
text). The **executor** runs locally where the desktop is — so the agent runs on the machine
you actually work on; no Linux VM required.

## Why a dedicated grounder

On **ScreenSpot-Pro** (dense, professional, small targets) the dedicated grounder beats a
strong general VLM ~**2.7×** (GUI-Owl-1.5-8B **64%** vs qwen3.7-plus **24%**, matched samples).
On easy UIs they tie; the gap is exactly the real-world GUI case. Hence: GUI-Owl grounds,
qwen plans. (See [`eval/`](eval/).)

## Boundary (Servic_Module_Template.md)

- Returns a **`ServiceResult`** with status + trace + screenshot artifact refs — **never a final
  answer or completion truth**. The Agent Host decides if the task is truly done.
- **External side effects require approval**: actions are **dry-run by default**. Real
  mouse/keyboard happens only when the call sets `execute=true` **and** `approve=true` **and**
  the service is started with `CUA_ALLOW_EXECUTE=true`; otherwise it returns `NEEDS_APPROVAL`.
- **Refs-first**: screenshots are written to disk and returned as artifact refs, never inlined.

## HTTP API

```
GET  /health
GET  /version
POST /computer-use/run     -> ServiceResult<ComputerUseRun>
```

`POST /computer-use/run` body:

```jsonc
{
  "instruction": "Open Notepad and type hello",
  "execute": false,                  // default: dry-run (plan + ground, no actions)
  "approve": false,                  // must be true (+ CUA_ALLOW_EXECUTE) to act
  "imagePath": "…" | "imageBase64": "…",  // optional: static screen (headless test)
  "requestId": "…"
}
```

`ComputerUseRun.data`: `{ status, executed, instruction, platform, screen, steps[], stepCount }`
where each step has `{ plan, action, coords, screenshot, executed }`. `status` is descriptive
(`dry_run_planned` / `agent_reported_done` / `agent_reported_fail` / …), **not** a completion claim.

## Layout

| Concern | Location |
|---|---|
| ServiceResult HTTP API | `cua/server.py` |
| run_task orchestration (loop, trace, safety) | `cua/runner.py` |
| Wire AgentS2_5 + GUI-Owl + qwen | `cua/agent.py` |
| Env config / secrets | `cua/config.py` |
| Grounder client (VLMGrounder / KVGround) | `grounding/client.py` |
| Cross-platform desktop executor | `driver/desktop.py` |
| Desktop mouse overlay (highlight ring + ripple + banner) | `driver/overlay.py` |
| Grounding eval (synthetic + ScreenSpot-Pro) | `eval/` |
| CLI runner | `run_cua.py` |
| Grounder vLLM serve script (GPU box) | `serve_grounder.sh` |

## Run

```bash
pip install -r requirements.txt        # see notes for headless boxes (opencv-headless, numpy<2.3)

# 1) Grounder (on the GPU box): serve GUI-Owl-1.5-8B via vLLM
bash serve_grounder.sh                 # -> http://127.0.0.1:18901

# 2) Plugin (on your Win/Mac desktop):
export CUA_PLANNER_API_KEY=...                       # qwen3.7-plus gateway key
export CUA_GROUNDER_BASE_URL=http://127.0.0.1:18901/v1   # tunnel to the grounder
python -m cua.server                   # -> http://127.0.0.1:3900

# dry-run (safe): plan + ground, no actions
curl -s localhost:3900/computer-use/run -d '{"instruction":"click the Save button","imagePath":"eval/_assets/synthetic_ui.png"}'

# live execution (opt-in): start with CUA_ALLOW_EXECUTE=true, then
curl -s localhost:3900/computer-use/run -d '{"instruction":"...","execute":true,"approve":true}'
```

## Config (env)

`CUA_PLANNER_BASE_URL` / `CUA_PLANNER_API_KEY` / `CUA_PLANNER_MODEL` (qwen3.7-plus) ·
`CUA_GROUNDER_BASE_URL` / `CUA_GROUNDER_MODEL` (gui-owl-1.5-8b) · `CUA_GROUNDING_DIM` (1000) ·
`CUA_MAX_STEPS` (15) · `CUA_ALLOW_EXECUTE` (false) · `CUA_PORT` (3900) · `CUA_ARTIFACT_DIR` ·
`CUA_SHOW_OVERLAY` (true).

## Mouse overlay (so the user can see the agent act)

During **live execution** the plugin paints a translucent, always-on-top,
**click-through** overlay on the real desktop ([`driver/overlay.py`](driver/overlay.py)):
a "Computer Use 进行中" banner, a highlight **ring** that follows the agent's
target, and a **ripple** at each click. It is hidden during every screenshot so
it never pollutes the grounder's observation, and it can never block the agent's
own clicks (Windows `WS_EX_TRANSPARENT`). Full overlay on Windows; a safe no-op
elsewhere or when no display is available. Toggle with `CUA_SHOW_OVERLAY`.
Visual self-test: `python -m driver.overlay`. Unit test: `python tests/test_overlay.py`.

## Use from SciForge (as a main-agent tool)

The plugin is invoked by SciForge's main agent (DeepSeek) as a `computer_use`
tool — the user just asks in natural language; there is no separate "wake up the
plugin" step. The Kun runtime advertises the tool when `SCIFORGE_CUA_SERVICE_URL`
points at this service, and gates every call behind a user approval prompt before
forwarding `execute:true & approve:true`. See
`SciForge-gui/kun/src/adapters/tool/computer-use-tool-provider.ts`. Start this
service with `CUA_ALLOW_EXECUTE=true` to let approved calls actually act.
