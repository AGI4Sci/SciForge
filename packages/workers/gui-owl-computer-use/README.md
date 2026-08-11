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
                │   act    → SessionInputChannel → routed backend       │
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
- **External side effects require a trusted invocation proof**: dry-run by
  default. Real actions require `execute=true`, `CUA_ALLOW_EXECUTE=true`, and a
  short-lived signed proof created by the GUI-managed MCP wrapper after the
  runtime approval gate. A caller-provided `approve=true` is not authorization.
- **HTTP sidecar auth**: mutation endpoints require the optional bearer token
  configured by `CUA_SERVICE_TOKEN` and, in the default `required` mode, the
  signed `X-Sciforge-CUA-Invocation` header. The GUI launcher supplies the
  service token and proof secret only to the managed wrapper/worker boundary.
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
| Session/request/lease and cancellation authority | `cua/session_registry.py` |
| **MCP** stdio transport adapter | `cua/mcp_server.py` |
| **HTTP** ServiceResult sidecar | `cua/server.py` |
| Local entry (`--stdio` / `--http`) | `cua/cli.py` |
| Backend protocol and capability routing | `driver/backend.py`, `driver/router.py` |
| Target-bound runner facade | `driver/channel.py` |
| Approved process-global compatibility backend | `driver/backends/legacy_pyautogui.py` |
| Target-scoped Chromium bridge | `driver/backends/cdp_adapter.py`, `packages/domains/computer-use/src/main/services/computer-use-cdp-adapter.ts` |
| Pattern-driven Windows UI Automation backend | `driver/backends/windows_uia.py` |
| Isolated environment SPI and optional P6a remote Worker controller (unavailable by default) | `driver/backends/isolated_desktop.py`, `driver/backends/remote_windows_worker.py` |
| Explicit-hook click-through mouse overlay | `driver/overlay.py` |
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

# Live execution is intentionally unavailable to an unsigned raw curl call.
# Use the GUI-managed MCP path so the runtime approval gate can issue a
# short-lived invocation proof. `approve=true` in this JSON is not sufficient.
```

Standalone service smoke tests may use dry-run requests. Real actions must use
the managed proof path; the explicitly weaker `legacy` proof mode exists only
as a visible local rollback and must not be presented as the secure default.

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
| `packages/domains/computer-use/src/main/mcp-server.ts` | Domain-owned GUI-managed MCP wrapper that exposes `computer_use` and calls this sidecar |
| `src/main/gui-mcp-registry.ts` | registers `gui_owl_computer_use` for Codex and Claude Code |

## Config

See [`.env.example`](.env.example). Key vars: `SCIFORGE_MODEL_ROUTER_BASE_URL`,
`SCIFORGE_MODEL_ROUTER_MODEL`, `SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY`,
`CUA_MAX_STEPS`, `CUA_REFLECT`, `CUA_ALLOW_EXECUTE`,
`CUA_INVOCATION_PROOF_MODE`, `SCIFORGE_CUA_INVOCATION_SECRET`,
`SCIFORGE_CUA_INVOCATION_PROOF_TTL_MS`,
`CUA_PORT`, `CUA_SERVICE_TOKEN`, `CUA_SHOW_OVERLAY`, `CUA_ARTIFACT_DIR`,
`CUA_LEASE_TTL_S`, `CUA_LEASE_REAPER_ENABLED`, `CUA_LEASE_REAPER_INTERVAL_S`,
`CUA_ARTIFACT_RETENTION_S`, `CUA_ARTIFACT_MAX_RUNS`.

Lease expiry is detected by a service reaper, but a lease is released only
after the owning backend handle closes successfully. `/computer-use/status`
and `/computer-use/cleanup-pending` expose handles that still need cleanup.
Artifact retention is disabled unless an age or count limit is configured.
Set `CUA_LEASE_REAPER_ENABLED=false` to roll back the watchdog without
disabling the target-bound channel and backend routing introduced earlier.

## P5 capability and operations references

- [Backend capability matrix](docs/computer-use-backend-capability-matrix.md)
- [Operations, diagnostics and rollback](docs/computer-use-operations.md)
- [Approval trust boundary ADR](docs/adr-001-approval-trust-boundary.md)
- [Real SciForge Agent E2E and verified web-task evidence](../../../docs/computer-use-real-e2e.zh-CN.md)

The current verification matrix and its known Windows-only baselines are kept
in the real E2E guide linked above. That guide also records the exact outcomes
of test-owned Playwright TodoMVC tasks and public Wikipedia search/readback
tasks. Those results do not prove ordinary Chrome, arbitrary production sites,
Word document content, a real isolated desktop provider, or multiple physical
Windows input desktops.

### Isolated desktop provider SPI

P4 defines the lifecycle boundary for an infrastructure-owned isolated
environment. P6a adds a fail-closed HTTPS/mTLS Controller for one explicitly
configured attached remote Windows Worker, but this repository still does not
ship the Guest Worker, VM image, credentials, provisioning control plane, RDP,
Hyper-V or Windows Sandbox infrastructure. Consequently `isolated-desktop`
reports `ISOLATED_DESKTOP_UNAVAILABLE` by default. Controller/fake-transport
unit tests are not evidence that even one real isolated desktop is available.

### Optional CDP/Playwright backend

The browser backend controls only Chromium targets exposed by an explicitly
allowlisted loopback CDP endpoint. It cannot attach to an ordinary Chrome
profile that was not launched with remote debugging enabled.

Start the Node adapter in a development checkout, then start the Python worker
with the printed loopback URL and the same token:

```powershell
$env:SCIFORGE_CUA_CDP_ENDPOINTS = 'http://127.0.0.1:9222'
$env:SCIFORGE_CUA_CDP_ADAPTER_TOKEN = '<random-secret>'
npx tsx packages/domains/computer-use/src/main/cdp-adapter-node-entry.ts

$env:SCIFORGE_CUA_CDP_ADAPTER_URL = 'http://127.0.0.1:<printed-port>'
$env:SCIFORGE_CUA_CDP_ADAPTER_TOKEN = '<same-random-secret>'
python -m cua.cli --http
```

The adapter uses `playwright-core` already pinned by the repository. Attached
handles are released without closing user pages. Targets and endpoint secrets
remain redacted at the public sidecar boundary.

### Windows UI Automation backend

On Windows, the worker loads the pinned `comtypes==1.4.16` binding and resolves
each target from its PID/HWND/AutomationId on the request thread. It supports
only control patterns exposed by the target provider: Value, Invoke, Toggle,
SelectionItem, RangeValue and Scroll. Value-like writes are read back before a
`verified` result is returned. Invoke is verified against a bounded, fresh
target-level semantic snapshot rather than assuming that the invoked button's
own properties must change.

The managed `computer_use` tool also accepts a bounded deterministic
`semanticAction.kind=sequence` for Windows UIA. A sequence contains 1-16
`write`, `invoke`, or `toggle` steps. Each step selects exactly one enabled
control by `role` and `name` and/or `automationId`; the runner observes again
after every step so it never reuses an old opaque element token. Completion is
reported only after a fresh final semantic tree contains the requested text.
The sequence path does not call the model planner and never falls back to
coordinates, focus-dependent keyboard input, PyAutoGUI, or host-global input.

Before a target lease is acquired, the backend resolves a provider-owned
canonical PID/HWND-or-root/runtime identity. Caller-supplied or generated
`targetId` values cannot create a second lease for the same physical control.
Every actionable semantic-tree node also carries an opaque `elementToken`
bound to that target and observation revision. Actions must use that token;
`automationId` is display/discovery metadata and is not action authority.

Window titles remain redacted from target descriptors by default. For a
deployment with an operator-approved set of UIA windows, set
`CUA_UIA_TRUSTED_TITLE_PATTERN` to a regular expression that fully matches the
allowed titles. Discovery then excludes every non-matching top-level window and
publishes each matching title as the bounded `metadata.publicLabel` used by the
Agent to select a target before binding. An invalid expression fails sidecar
startup; this is an explicit trust boundary, not a fallback to broad discovery.

This backend never calls `SetFocus`, PyAutoGUI, PostMessage or the host
clipboard. A third-party UIA provider may nevertheless activate its own window
while committing a semantic Pattern action; the capability therefore exposes
`mayActivateTarget=true`. A physical key, coordinate-only operation, missing
pattern, changed HWND/PID/runtime identity or focus-dependent control fails
explicitly. UIA semantic observation does not imply target-bound pixels;
`imageAvailable=false` is returned when no such image exists. See
`docs/adr-002-windows-uia-binding.md` for the dependency and COM-threading
decision.
