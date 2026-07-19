# SciForge Plan Gateway

Plan Gateway is a loopback-only, fail-closed forwarding worker for coding plans that are authenticated by an official runtime rather than an API key. It does not translate protocols, own login tokens, expose a remote endpoint, or fall back to Model Router.

The built-in Codex adapter accepts only the subscription model catalog (`GET /v1/models`) and Responses traffic (`POST /v1/responses` and `POST /v1/responses/compact`). It forwards those requests to the fixed Codex subscription upstream and preserves runtime-supplied authentication. The forwarding policy requests semantically equivalent identity-encoded responses so durable traces remain complete, readable, and eligible for shared SciForge redaction, including credentials echoed across streaming chunk boundaries. An upstream that violates identity negotiation is rejected with an explicit diagnostic instead of recording compressed bytes as text.

```bash
npm run start -- --adapter codex --host 127.0.0.1 --port 3893 --user-data-dir /absolute/sciforge-user-data
```

The CLI requires an application user-data directory and writes every observed request and streamed response through `@sciforge/full-trace`. Codex's `runtime_id`, GUI thread ID, and native turn ID are reduced to the same deterministic trace ID used by Agent events. The encoded Codex metadata envelope is parsed and retained as sanitized structured data for a complete trace; credential fields and known secret values are never persisted. For tests or non-Electron embedding, pass an explicit `--trace-storage-dir` instead. The server exposes `GET /healthz` and `GET /manifest`. Use `createCodexPlanRuntimeConfig("http://127.0.0.1:3893/v1")` to generate the Codex provider layer; Codex remains responsible for ChatGPT login and token refresh.
