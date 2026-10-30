# Local Qwen compatibility notes

## Tested setup

- Hardware: Iluvatar TY1100-NX with one MR-V100 (32 GiB)
- Model: `Qwen3.8-27B-AWQ-INT4`
- Serving runtime: vLLM in the Iluvatar 4.4.0 container
- Endpoint: OpenAI-compatible `/v1` API
- SciForge upstream protocol: `chat-completions`

The standalone vLLM endpoint was healthy and returned successful benchmark
results before SciForge integration was tested.

## Failure and diagnosis

SciForge initially used Anthropic Messages for the local endpoint. That path
failed for two independent reasons:

1. Qwen's template and vLLM's Anthropic adapter add constraints around system
   messages and thinking budgets.
2. A normal agent request carried 106 tool schemas. Their descriptions were
   large enough to consume almost the entire 32K context window. vLLM rejected
   requests at the boundary with a prompt-plus-output total of 32769 tokens.

The UI also persisted the selected protocol in
`sciforge-settings.json`; changing only the Router file did not change the
setting shown in SciForge.

## Source changes

`packages/workers/model-router/src/response-compat.ts` now:

- passes the caller's output budget through to Chat Completions. The temporary
  1024/2048/4096 caps have been removed for boundary testing;
- compacts oversized Chat Completions tool schemas by removing prose-only
  fields (`description`, `title`, `examples`, and `default`) while preserving
  names, types, properties, and required fields.

The compaction threshold is 60,000 serialized characters, so ordinary-sized
provider requests retain their descriptions.

## Local verification

With the local provider configured as `chat-completions`, a fresh SciForge
conversation successfully returned:

```text
本地模型测试成功
```

The installed application bundle was patched locally for this verification;
the bundle replacement and user-specific settings are not part of the source
change. A future PR should submit the source change and this note, then let CI
produce the packaged application.

## Follow-up for a PR

- Add focused tests for oversized tool-schema compaction. The current recursive
  stripping implementation must be made schema-aware before a PR: properties
  named `description`, `title`, `examples`, or `default` must not be deleted.
- Consider making the context limit and output budget provider configuration
  fields instead of fixed constants.
- Validate tool-call round trips after compaction, not only text responses.
- Measure input plus output against the active server limit. On October 7,
  `/v1/models` reported 8192, unlike the earlier 32768 setting.

## Interpretation corrections

Errors saying the prompt contains "at least" N tokens report a lower bound,
not its exact length. Changing that bound after lowering the output budget
does not prove that SciForge grew or truncated the prompt to the boundary.
HTTP 200 alone does not establish task correctness or complete generation.
The local schema compaction remains an experimental workaround, not a
validated preservation of tool semantics. Long-output results are recorded in
the separate `results/output_budget_probe` artifacts.

## Long-request timeout experiment (2026-10-07)

After restoring vLLM to 32768 context, a Router code request failed at 300 s
with `upstream_timeout`, while direct vLLM decoding completed 8192 output tokens.
`captureUpstreamResponse` buffers the upstream body before conversion, so this
timeout covers generation, not just connection establishment.

The driver now accepts a positive integer `SCIFORGE_UPSTREAM_TIMEOUT_MS`
environment override when no explicit per-request timeout is supplied.
The default remains 300000 ms. Invalid environment values use the default.
The local test launch uses 1800000 ms; it must be inherited by the app process.
This is not incremental stream forwarding or an unlimited request lifetime.
The timeout change passed typecheck, build, and 52 upstream driver tests.

The follow-up batch also exposed a named-function `tool_choice` conversion
rejection and zero usage counters in streaming responses. Automatic function
selection plus tool-result return succeeded. Those issues are recorded as
separate findings, not resolved by the timeout change.

## Protocol follow-up (2026-10-07)

The subsequent Router fix normalizes named Responses function tool choices
to the nested Chat Completions shape even when no tool alias is needed.
Streaming Chat requests now request usage with `stream_options.include_usage`.
The Router emits `response.incomplete` when the normalized response is incomplete,
instead of unconditionally emitting `response.completed`.

Validation: 184 driver/router tests passed, together with typecheck and the
production build. Four live local-Qwen checks passed: forced add_numbers(17,25),
tool-output round trip returning 42, an eight-token truncated response with
incomplete status and correct usage, and a normal OK response with nonzero usage.
The rebuilt sidecar was installed locally; no model weights or vLLM code changed.

This does not implement incremental upstream stream forwarding: the Router
still buffers the upstream body before conversion. These HTTP checks also do
not establish full GUI Agent task correctness. The experimental schema-compaction
limitation above remains unresolved and must be addressed before upstreaming.
