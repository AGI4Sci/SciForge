# Model access and full tracing

SciForge separates model access by authentication and billing shape:

```text
API credential             Login-backed coding subscription
      |                                  |
      v                                  v
Model Router                         Plan Gateway
```

Both paths are local-only boundaries and write the same correlated trace format. Neither path is a fallback for the other.

## API access

API setup has exactly three required values:

- Base URL
- API key
- Model name

The user does not choose a vendor or wire protocol. Model Router normalizes runtime requests and negotiates the upstream protocol among OpenAI Responses, OpenAI Chat Completions, and Anthropic Messages.

Negotiation happens on the first real request. Model Router prefers the request's incoming protocol, caches the first working driver for the configured Base URL and model, and tries another driver only after a definitive unsupported-endpoint or unsupported-schema response. Authentication, quota, rate-limit, timeout, and ambiguous server failures stop negotiation immediately so the same prompt is not submitted through multiple potentially billable paths.

Model Router returns protocol-correct ordered streaming events, but currently buffers the upstream body before cross-protocol conversion, so it does not provide progressive token latency. Plan Gateway performs no protocol conversion and relays plan response bytes progressively.

## Coding-plan access

Coding-plan access is handled by Plan Gateway adapters. Plan Gateway binds only to loopback, accepts only adapter-approved paths, and forwards request and streaming response bytes without protocol translation. The core does not contain vendor URL, model, or authentication branches; each coding plan supplies those through its adapter.

The initial Codex adapter uses a SciForge-managed Codex home and Codex app-server's official ChatGPT login flow. Codex owns token persistence and refresh. SciForge does not copy the user's default Codex home, parse its authentication files, or silently switch to an API key when subscription access fails.

## Full trace boundary

The unified local trace contains all information visible at SciForge's boundaries:

- complete model request bodies after mandatory secret filtering;
- ordered response headers, stream chunks, completion, usage, retries, timing, and errors;
- normalized Agent lifecycle, assistant, reasoning, tool, approval, usage, and error events;
- runtime, thread, turn, request, and parent-request identifiers used to correlate the trajectory.

The trace cannot contain hidden chain-of-thought that a provider does not return. If the upstream returns only a reasoning summary, only that summary is recorded.

Authorization headers, cookies, API keys, credential-shaped fields, and recognized inline secrets are removed before persistence and export. Traces live under application user data rather than a workspace, use owner-only file permissions, and expire after 30 days by default. The settings UI can read summaries, export selected traces, or clear retained traces; these are views and operations on the same store rather than separate audit pipelines.

## Release verification

Automated tests use fake upstreams and must cover:

1. all three API wire protocols;
2. safe negotiation and cache invalidation;
3. no fallback after authentication, quota, rate-limit, timeout, or ambiguous failures;
4. loopback-only Plan Gateway binding and route/header enforcement;
5. Codex plan provider generation with OpenAI authentication required and no API-key environment variable;
6. full request/stream/Agent correlation and mandatory secret exclusion;
7. retention, export, clear, and setup diagnostics.

A live Codex Plan smoke test is opt-in because it consumes the tester's subscription quota:

1. Select coding-plan access and the Codex adapter.
2. Sign in through the official browser or device flow shown by Codex app-server.
3. Confirm the reported plan type and Plan Gateway health.
4. Run one harmless prompt that does not modify files.
5. Confirm the request is counted by the ChatGPT plan, no API key is configured, and the trace contains the complete client-visible request, ordered response events, and Agent lifecycle.
6. Export the trace and scan it for authorization, cookie, token, and API-key values before treating it as release evidence.

Do not run the live smoke test automatically or in CI, and do not expose Plan Gateway on a non-loopback interface.
