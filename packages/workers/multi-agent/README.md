# @sciforge/multi-agent

Shared child-run contract, file store, and supervised runtime for SciForge AgentRuntime integrations.

The package does not call model providers and does not store provider credentials.
`AgentRuntimeHost` injects a `ChildRunExecutor` backed by the selected adapter's
provider-neutral `spawn/inspect/message/cancel` contract. Provider protocol and
credentials remain inside that adapter.

Hosts that expose delegation to a model should provide one batch-capable
delegation contract. Independent child tasks submitted in the same request start
concurrently up to `maxParallel`; the runtime reserves parallel and per-turn
child capacity atomically so concurrent starts cannot exceed either budget.

The Host registers one `MultiAgentLifecycleControl` before provider spawn and
the adapter reports `missing` until its child channel is active. Once the
provider creates a real thread, the executor persists it through `setThreadRef`
so running children can be opened immediately. Child work has no wall-clock
completion deadline. Callers receive a stable child ID immediately and can
inspect liveness, wait for a bounded observation window, send guidance, or
explicitly cancel the child. An observation timeout or a failed liveness probe
never changes the child to a terminal state. Parent cancellation uses the same
canonical termination control.
