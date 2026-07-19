# SciForge Plan Gateway

Plan Gateway is a loopback-only, routing/authentication-fail-closed forwarding worker for coding plans that are authenticated by an official runtime rather than an API key. It does not translate protocols, scrape private OAuth state, expose a remote endpoint, or fall back to Model Router.

The built-in Codex adapter accepts only the subscription model catalog (`GET /v1/models`) and Responses traffic (`POST /v1/responses` and `POST /v1/responses/compact`). It forwards those requests to the fixed Codex subscription upstream and preserves runtime-supplied authentication. The forwarding policy requests semantically equivalent identity-encoded responses so durable traces stay readable and eligible for shared SciForge redaction, including credentials echoed across streaming chunk boundaries. An upstream that violates identity negotiation is rejected with an explicit diagnostic instead of recording compressed bytes as text.

```bash
npm run start -- --adapter codex --host 127.0.0.1 --port 3893 --user-data-dir /absolute/sciforge-user-data
```

The CLI attempts to persist every observed request and streamed response through `@sciforge/full-trace`. Codex's `runtime_id`, GUI thread ID, and native turn ID are reduced to the same deterministic trace ID used by Agent events. The encoded Codex metadata envelope is parsed and retained as sanitized structured data; credential fields and known secret values are never persisted. Trace writes are best-effort if the local store is unavailable, and a forced process kill can leave an in-flight request partial. For tests or non-Electron embedding, pass an explicit `--trace-storage-dir` instead. The server exposes `GET /healthz` and `GET /manifest`. Use `createCodexPlanRuntimeConfig("http://127.0.0.1:3893/v1")` to generate the Codex provider layer; Codex remains responsible for ChatGPT login and token refresh.

Authentication uses one internal delegated credential path. Codex Runtime must supply its own Bearer token on every request; Plan Gateway does not cache credentials, acquire private OAuth state, expose a managed-auth mode, or fall back to API keys.

Inbound credential headers such as `Cookie`, `Proxy-Authorization`, `X-API-Key`, `API-Key`, and `Anthropic-API-Key` are never sent to the coding-plan upstream. The provider-generated Bearer `Authorization` is the only upstream credential header; ordinary content, correlation, and non-secret runtime headers continue through the transparent path.
