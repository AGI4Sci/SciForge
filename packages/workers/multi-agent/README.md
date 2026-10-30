# @sciforge/multi-agent

Shared child-run contract, file store, and supervised runtime for SciForge AgentRuntime integrations.

The package does not call model providers and does not store provider credentials.
`AgentRuntimeHost` injects a `ChildRunExecutor` backed by the selected adapter's
provider-neutral `spawn/resume/inspect/message/cancel/delete` contract. Provider protocol and
credentials remain inside that adapter.

Hosts that expose delegation to a model should provide one batch-capable
delegation contract. Independent child tasks submitted in the same request start
concurrently up to `maxParallel`; the runtime admits starts atomically so active
children cannot exceed that configured capacity. A parent turn has no separate
lifetime child-run quota: after children finish, the parent may delegate more
work in the same turn.

The Host registers one `MultiAgentLifecycleControl` before provider spawn and
the adapter reports `missing` until its child channel is active. Once the
provider creates a real thread, the executor persists it through `setThreadRef`
so running children can be opened immediately. Child work has no wall-clock
completion deadline. Callers receive a stable child ID immediately and can
inspect liveness, wait for a bounded observation window, send guidance, or
explicitly cancel the child. An observation timeout or a failed liveness probe
never changes the child to a terminal state. Parent cancellation uses the same
canonical termination control. Terminal children with a persisted provider
thread can resume with the same stable child ID and conversation context; this
includes provider-completed work whose external deliverables still need
attention. Each continuation increments the persisted attempt counter. The
durable transcript is available through `subagent_status` with
`includeTranscript`, so a parent can recover work history after a runtime
restart before deciding whether to continue. Permanent deletion first settles
active work,
then removes both provider and canonical store state and emits a delete refresh
event so historical lifecycle events cannot repopulate the child sidebar.

The child-run store is the canonical lifecycle state. `child_event` callbacks
are best-effort refresh notifications, so notification delivery failures never
change or interrupt a persisted child run. A new runtime instance persistently
recovers stale `queued` or `running` records as `aborted` before accepting tool
operations; it preserves their prompts, transcripts, usage, request identities,
and provider thread references for audit instead of deleting or replaying them.

The SciForge Host accepts arbitrary delegation batches without a client-side
parallel cap. Status inspection succeeds even when the observed child failed;
the child's error is result data, not an inspection-tool error. Parents can list
their persisted children with `subagent_status` without a child ID, page through
history, and inspect recent progress. New parent turns receive persisted child
state; terminal notifications steer only the matching active parent turn when
the adapter supports steering. Interrupted or incomplete terminal work resumes
in the original provider conversation through `subagent_resume`, not by
restoring an OS process or replaying an in-flight tool. Concurrent resumes of
one child are rejected.

Running children publish a bounded heartbeat on the same `child_event` channel
at the supervision interval (30 seconds by default). The heartbeat persists
`lastHeartbeatAt` and any provider-reported `progress` snapshot, and the Host
forwards it to an active parent turn. The parent can then inspect the durable
record and choose to send guidance, continue, cancel/delete, or resume the
existing child, while independent work can be delegated concurrently. A
heartbeat is an observation signal; it never cancels or recreates a child by
itself.

Child execution supervision combines terminal events with a bounded liveness
probe every 30 seconds. The provider adapter must check actual provider state;
`unknown` (including probe errors) and `waiting` do not mean the child is dead.
Codex reconciles durable terminal turns through its existing event/completion
barrier; Claude checks its SDK execution and abort state. An unexpectedly closed
child event stream is an error, never proof of successful delivery.

Unexpected interruptions and explicitly retryable execution errors receive up
to three automatic recovery attempts. The child ID, original objective,
transcript, workspace, tool scope, and Host execution context remain attached
to the same child run. Recovery first resumes the saved provider conversation.
A missing conversation can be replaced with the bounded saved progress and
original objective; replacement does not reset the persisted recovery budget.
The executor promise and parent wait cover all recovery attempts. No terminal
notification is emitted for an intermediate attempt. Every attempt receives
and releases its own exact child Principal lease.

A confirmed missing execution is terminated through the canonical lifecycle
control before recovery, and its executor must settle before a replacement can
start. Unconfirmed cleanup requires human attention and blocks resume. User or
parent cancellation is never automatically revived, including cancellation
while recovery is queued. Silence, long computations, and approval waits alone
never trigger termination. Exhausted recovery publishes the child failure and
puts waiting parent work into `needs_attention` instead of opening another
retry loop. Parent reconciliation reads the canonical child store for the
specific parent turn. Terminal notifications use the durable retry outbox;
when the parent is idle and waiting for children, they trigger serialized work
reconciliation and continuation without reviving cancelled parent work.
