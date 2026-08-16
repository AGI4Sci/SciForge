# Agent Runtime Notes

SciForge supports two user-selectable agent runtimes: **Codex** and **Claude
Code**. Codex is the default for fresh installs and migrated settings. Claude
Code must be selected explicitly. SciForge does not ship or expose a custom
agent runtime, and a runtime failure must never silently switch the user to the
other runtime.

Code, Write, Collaboration, and scheduled tasks should enter agent work through
the runtime-neutral `AgentRuntime` contract. Renderer code uses
`AgentRuntimeProvider` and the `window.sciforge.agentRuntime` preload API; it
must not call Codex app-server JSON-RPC or the Claude Agent SDK directly.
Collaboration projections and scheduled tasks record runtime ids and keep runtime-specific
thread mappings. A background workflow must fail closed when its selected
runtime does not support a required operation.

The shared contract and event/capability shape are documented in
[`docs/agent-runtime-contract.md`](./agent-runtime-contract.md).

## Allowed Extension Path

1. Keep Codex app-server JSON-RPC, executable discovery, configuration, event
   normalization, thread/event stores, and process lifecycle code inside
   `src/main/runtime/codex/`.
2. Keep Claude Agent SDK integration, executable discovery, configuration,
   event normalization, and lifecycle code inside
   `src/main/runtime/claude-code/`.
3. Put runtime-neutral adapter contracts, host orchestration, governance, and
   shared lifecycle behavior under `src/main/runtime/agent-runtime/`.
4. Map runtime events into the shared contract in the main process. Renderer
   display mapping belongs in
   `src/renderer/src/agent/agent-runtime-event-dispatcher.ts`.
5. Keep shared integration thin: settings type/schema/migration, main-process
   runtime selection, renderer provider registration, and Settings UI may know
   about `codex | claude`.
6. Add user-facing settings under `agents.codex` or `agents.claude`, with
   `activeAgentRuntime` recording the selected runtime.
7. Keep command-path discovery centralized in each runtime module. Do not add
   renderer-side shell probing or assume that a GUI process inherits a login
   shell's `PATH`.
8. Keep model-access boundaries explicit: provider API credentials use Model
   Router, while login-backed coding subscriptions use the adapter selected for
   that runtime. These paths do not silently fall back to one another.

## Forbidden Paths

- Do not restore SciForge Runtime, Kun, CodeWhale, Reasonix, or another custom
  runtime process, HTTP/SSE adapter, updater, or importer.
- Do not silently fall back between Codex and Claude Code when an executable,
  login, model, or runtime operation fails.
- Do not add renderer business logic that bypasses `AgentRuntimeProvider` or
  the neutral `window.sciforge.agentRuntime` API.
- Do not scatter Codex or Claude implementation outside their runtime modules,
  beyond the thin shared integration points above.
- Do not mix SciForge workspace services, Browser, Computer Use, VSCode app
  modules, or artifact pipelines into the model-access billing boundary.
- Do not restore legacy `AgentSwitcher`, `ConnectionStatusBar`,
  `RuntimeDiagnosticsDialog`, or self-check UI for removed providers.
- Do not add `/usage` or `/runtime` slash commands that open a runtime control
  panel.

## Historical Data Migration Rule

Old persisted keys may be read only by migration or narrowly scoped legacy
cleanup. They are historical input, not a compatibility API for new writes:

- `activeAgentRuntime: "sciforge"`, unknown runtime ids, and historical
  `agentProvider: codewhale | reasonix | deepseek-runtime` selections normalize
  to `activeAgentRuntime: "codex"`.
- `agents.sciforge`, `agents.codewhale`, `agents.reasonix`, and historical
  `deepseek` values must not be exposed as selectable runtime settings or used
  by new code. New user-facing settings belong to `agents.codex` or
  `agents.claude`.
- Historical `sciforge`, `codewhale`, and `reasonix` thread mappings may be read
  only where migration requires them. New mappings use `codex` or `claude` and
  remain owned by that runtime.
- Historical remote-channel and `claw` runtime files are migration input only;
  production code must not restore them or expose compatibility APIs for them.

## Verification

Run:

```bash
npm run typecheck
npm test
npm run build
```

Manual smoke:

- Fresh installs and migrated settings select Codex by default.
- Settings -> Agents exposes Codex and Claude Code, with no SciForge Runtime,
  Kun, CodeWhale, or Reasonix block.
- Codex can connect, create and resume threads, stream replies, approve or deny
  tools, interrupt turns, and surface actionable executable/login errors.
- Claude Code can be selected explicitly and perform the supported shared
  operations without changing Codex settings or thread mappings.
- A missing or unhealthy selected runtime fails visibly and does not switch to
  the other runtime.
- Write uses the selected runtime for inline and selected-text assistant work;
  assistant threads stay isolated by runtime.
- Collaboration projections, schedules, and workflows preserve their selected runtime id
  and fail closed for unsupported operations.
- Saved settings do not reintroduce a removed runtime as a selectable value.
