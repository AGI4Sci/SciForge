# SciForge Codex Runtime

This package owns the process-neutral Codex `app-server` protocol client used by
both the Electron main process and the headless Workspace Host. It also exposes
the package-owned Workspace Host AgentRuntime operation handlers.

It does not own SSH, workspace placement, UI state, or desktop settings.

## Workspace Host runtime

The first remote cohort keeps the runtime ID `codex` and supports connect,
capability discovery, list/start/read/rename/delete thread, start/interrupt/
steer turn, sequenced live events and replay, approvals, and structured user
input. Compact, fork, resume, relation updates, usage aggregation, remote MCP,
skills, memories, and subagents are reported unavailable until their canonical
backend contracts are implemented.

Remote Codex starts only with valid workspace-scoped Model Router access. The
Workspace Host supplies a loopback `/v1` endpoint, short-lived bearer token, and
expiry through its trusted operation context. The runtime writes only the
provider definition to its private managed `CODEX_HOME`; the scoped token stays
in `SCIFORGE_RUNTIME_API_KEY` in process memory. It never imports a desktop or
remote login `CODEX_HOME`, OpenAI/upstream API key, Plan Gateway login state, or
complete shell environment.

Workspace network egress is separate from model access. A valid scoped CONNECT
lease is injected only for the current app-server generation and enables
`sandboxPolicy.networkAccess`; `none`, expiry, or revocation removes the proxy
and makes tool network access false. Proxy or Model Router lease rotation
stops the old app-server before reconnecting, so stale credentials cannot fall
back to a direct route.

GUI-to-Codex thread bindings are atomically stored in a private
`~/.sciforge/workspace-host-state/` directory keyed by the authorized workspace
root. No state is written into the research project, and every loaded binding
is validated against the canonical Workspace Host root.

The same package owns an append-only `runtime-events/` JSONL log and atomic
per-thread summaries below that private state directory. Status and thread-list
reads use summaries, history uses opaque bounded reverse-page cursors, replay
streams only records newer than `sinceSeq`, and full tool output is recovered
from the newest matching persisted event only when its artifact reference is
opened. Live, replay, and page payloads bound duplicated tool detail, metadata,
arguments, receipts, and completion receipts before transport serialization;
the canonical event log is never truncated at an in-memory event count.
