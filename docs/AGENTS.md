# Agent Runtime Notes

SciForge supports two user-selectable local agent runtimes: **SciForge Runtime** and
**Codex**. SciForge Runtime remains the default runtime for existing and new users. Codex is
optional and must be selected or enabled explicitly; the app must never
silently fall back from SciForge Runtime to Codex.

Code, Write, Connect phone, and scheduled tasks should enter agent work through
the runtime-neutral `AgentRuntime` contract. Renderer code should use
`AgentRuntimeProvider` and the `window.sciforge.agentRuntime` preload API instead
of calling SciForge Runtime `/v1/*` endpoints or Codex `codex:*` IPC directly. SciForge Runtime continues
to serve HTTP/SSE behind its adapter. Codex runtime code must stay modular and
centralized under `src/main/runtime/codex/`. Connect phone / remote-channel
code still has a small number of historical `claw` files or symbols; when kept,
they are internal compatibility names, not user-visible or public API names.
Connect phone and scheduled tasks record runtime ids and preserve runtime-specific thread mappings, but
their non-default runtime execution path currently fails closed until native adapter support
is implemented for those background workflows.

The contract and event/capability shape are documented in
[`docs/agent-runtime-contract.md`](./agent-runtime-contract.md).

## Allowed Extension Path

1. For SciForge Runtime behavior, add protocol fields in `kun/src/contracts/`.
2. For SciForge Runtime behavior, add agent behavior in `kun/src/loop/`, `kun/src/services/`, or a
   new port/adapter under `kun/src/ports/` and `kun/src/adapters/`.
3. For SciForge Runtime behavior, add HTTP endpoints under `kun/src/server/routes/`.
4. Map SciForge Runtime endpoint/events through `src/main/runtime/local-runtime-agent-runtime-adapter.ts`
   and the shared AgentRuntime event/capability types. Renderer mapping belongs
   in `src/renderer/src/agent/agent-runtime-event-dispatcher.ts`.
5. For Codex behavior, keep app-server JSON-RPC, configuration, event
   normalization, thread/event stores, and lifecycle code inside
   `src/main/runtime/codex/`; expose only the narrow adapter surface from that
   directory.
6. Keep shared integration thin: settings type/schema/migration, main-process
   runtime selection, renderer provider registry, and Settings UI may know
   about `sciforge | codex`.
7. Add settings under `agents.sciforge` or `agents.codex`, with
   `activeAgentRuntime` recording the explicit user choice.
8. Do not add `runtimeRequest` / `startSse` renderer paths; app code uses the
   neutral `agentRuntime:*` IPC surface. Renderer-specific `codex:*` IPC has
   been removed; `codex:` strings should
   remain internal app-server method/event names only.

## Forbidden Paths

- No CodeWhale/Reasonix adapter, process manager, RPC bridge, updater, or
  importer.
- No implicit fallback from SciForge Runtime to Codex when SciForge Runtime fails.
- No new renderer business logic that bypasses `AgentRuntimeProvider` or the
  neutral `window.sciforge.agentRuntime` API.
- No scattered Codex implementation outside `src/main/runtime/codex/`, beyond
  the thin integration points listed above.
- Model access has one explicit billing boundary: API credentials use the Model
  Router sidecar, while login-backed coding subscriptions use the Plan Gateway
  adapter selected for that runtime. These paths never fall back to each other.
  Do not mix SciForge workspace server, Browser, Computer Use, desktop runtime
  launcher, VSCode app module, or artifact pipeline into either boundary.
- No legacy `AgentSwitcher`, `ConnectionStatusBar`, `RuntimeDiagnosticsDialog`,
  or runtime self-check UI for old providers.
- No drawing/design starter card in the core workbench.
- No `/usage` or `/runtime` slash command that opens a runtime control panel.

## Historical Data Migration Rule

Old persisted keys may be read only inside settings migration. They are
historical input, not a compatibility API for new writes or new code paths:

- `agentProvider: codewhale | reasonix | deepseek-runtime` maps to
  `activeAgentRuntime: "sciforge"`.
- `agents.codewhale`, `agents.reasonix`, and historical `deepseek` values are
  discarded during migration; configure canonical `agents.sciforge`,
  `agents.codex`, or `agents.claude` entries instead.
- Saved settings preserve `agents.sciforge` and may contain `agents.codex`; they must
  not retain `agents.codewhale` or `agents.reasonix`.
- Old Connect phone `agentThreadIds.codewhale/reasonix` mappings are discarded;
  only canonical `agentThreadIds.sciforge`, `agentThreadIds.codex`, and
  `agentThreadIds.claude` mappings are retained.
- New Codex thread mappings must use Codex-owned runtime/thread storage and must
  not be written into local runtime mappings.

## Verification

Run:

```bash
npm run typecheck
npm test
npm run build
```

Manual smoke:

- Existing users and fresh installs default to SciForge Runtime.
- Settings -> Agents can expose SciForge Runtime and Codex runtime settings, but not
  CodeWhale/Reasonix blocks.
- Code can create a SciForge Runtime thread, stream a reply, approve/deny tools, and
  interrupt a turn.
- When Codex is explicitly configured and selected, Code routes through the
  Codex runtime boundary without changing SciForge Runtime settings or threads.
- SciForge Runtime covers the current AgentRuntime behaviors: thread search/archive
  filters, fork, session resume, request_user_input submit/cancel, and usage.
- Cache telemetry uses upstream DeepSeek-compatible `prompt_cache_hit_tokens` /
  `prompt_cache_miss_tokens` returned through Model Router; hot SciForge Runtime
  turns should stay above 90% cache hit after the stable prefix is warm.
- Immutable prefix drift and malformed tool-call/tool-result history must be
  caught before a request reaches Model Router.
- Write can open the workspace, request inline completion, and use selected-text
  assistant actions; assistant threads are isolated by active runtime.
- Connect phone can save settings and run manual SciForge Runtime tasks. Runtime-id support
  for Codex-backed phone/schedule tasks must preserve migrated SciForge Runtime mappings
  and must not write Codex thread IDs into local runtime mappings.

SciForge Runtime details are in
[`docs/local-runtime-architecture.md`](./local-runtime-architecture.md). Product-level runtime
contract details are in
[`docs/agent-runtime-contract.md`](./agent-runtime-contract.md).
