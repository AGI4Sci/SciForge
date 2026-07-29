# @sciforge/multi-agent

Shared child-run contract, file store, and bounded runtime for SciForge AgentRuntime integrations.

The package does not call model providers and does not store provider credentials. Runtime hosts inject a `ChildRunExecutor`; in SciForge that executor must use the canonical Model Router-backed model client.

Hosts that expose delegation to a model should provide one batch-capable
delegation contract. Independent child tasks submitted in the same request start
concurrently up to `maxParallel`; the runtime reserves parallel and per-turn
child capacity atomically so concurrent starts cannot exceed either budget.

Executors register one `MultiAgentLifecycleControl` after their child channel is
active. When a child exceeds its deadline, the runtime first requests a progress
summary through that channel, waits for the bounded summary grace period, and
only then terminates an unresponsive child. A missing or failed channel skips the
grace period and proceeds directly to bounded termination. Parent cancellation
uses the same canonical termination control.
