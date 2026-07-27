## Context

SciForge has three execution runtimes and a local Model Router that exposes Responses, Chat Completions, and Anthropic Messages façades, but its configured text upstream is always called through Chat Completions and requires a user-visible provider label. Codex and Claude are forced through that API-backed router. Model request information is split between refs-first sanitized router bundles and an in-memory Agent-runtime request summary, neither of which is the complete request/response trajectory requested by the product.

The new product boundary is based on billing/auth shape rather than vendor identity: API credentials use Model Router; login-backed coding subscriptions use Plan Gateway. Configuration and routing must remain generic, local-first, and simple. Legacy behavior that conflicts with this boundary will be removed instead of migrated.

## Goals / Non-Goals

**Goals:**

- Require only Base URL, API key, and model name for every generic model API member.
- Negotiate among OpenAI Responses, OpenAI Chat Completions, and Anthropic Messages without provider-specific branches or user protocol settings.
- Allow Codex to use its own ChatGPT subscription auth through a local transparent Plan Gateway without SciForge owning the OAuth token lifecycle.
- Persist one complete client-visible model and Agent trajectory with secret removal, correlation, retention, export, and clear capture status.
- Present one access-mode setup and diagnostics flow with no silent billing fallback.
- Delete redundant configuration, audit, and routing branches rather than retaining compatibility shims.

**Non-Goals:**

- Recovering hidden chain-of-thought that a provider does not return.
- Turning a coding subscription into a public or remotely shared API.
- Provider-name presets or provider-specific protocol heuristics in the routing core.
- Supporting every login-backed coding plan in the first release; the first adapter is Codex.
- Migrating legacy Model Router configuration or in-memory audit records.

## Decisions

### 1. One generic API member shape

All model API members use `{ baseUrl, apiKey, model }`. The old `provider` field and any user-facing protocol selector are removed from shared settings, sidecar config, UI, and public contracts. Role names such as text reasoner and image generator remain capability roles, not provider identities.

This keeps billing credentials and model choice explicit while making transport an implementation detail. Keeping a hidden provider enum was rejected because it would continue the same branching and configuration burden under a different UI.

### 2. Canonical request model with generic wire drivers

Model Router normalizes incoming Responses, Chat Completions, and Messages requests into its existing canonical Responses representation. A small upstream-driver interface implements the three wire APIs:

```text
canonical request
    ├─ responses driver
    ├─ chat-completions driver
    └─ anthropic-messages driver
```

Candidate order prefers the incoming wire shape to minimize conversion, followed by the remaining generic drivers in a stable order. Fallback occurs only after a definitive endpoint/protocol rejection such as 404, 405, 415, or a recognized schema/unsupported-endpoint response; auth, quota, rate-limit, timeout, and ambiguous server failures never trigger another billable candidate. The successful driver is cached in memory by a hash of Base URL plus model and invalidated when configuration changes or a definitive incompatibility is returned. No vendor names, URL substrings, or model-name rules participate in selection.

The first real request performs negotiation so SciForge does not send synthetic billable prompts. A connection test uses non-generating discovery where available and otherwise reports that protocol will be confirmed on first use.

Model Router emits a wire-compatible ordered stream, but its cross-protocol driver currently buffers the upstream body before canonical conversion. This intentionally favors one small, deterministic conversion path and complete terminal tracing over progressive token latency. Plan Gateway does not convert protocols and continues to relay response bytes progressively.

### 3. Plan Gateway is a transparent adapter host

Plan Gateway is a loopback-only HTTP service with a generic adapter contract:

```ts
interface CodingPlanAdapter {
  id: string
  upstreamBaseUrl: string
  createRuntimeConfig(localBaseUrl: string): string
  validateRequest(request: IncomingMessage): void
  transformForwardHeaders(headers: Headers): Headers
}
```

The forwarding core preserves method, path, query, body bytes, response status, response headers, and streaming chunks. It removes hop-by-hop headers, never persists authorization/cookies, and accepts only fixed adapter-owned HTTPS upstreams. It cannot be bound to a non-loopback interface.

The Codex adapter writes a custom Responses provider with `requires_openai_auth = true`, no `env_key`, and WebSockets disabled. Codex app-server owns ChatGPT browser/device login, token persistence, refresh, account status, plan type, and rate-limit reporting. The gateway forwards to the official Codex subscription upstream and preserves Codex request identity. This is preferred over copying `~/.codex/auth.json`, reading tokens, installing a certificate authority, or intercepting TLS.

### 4. Access mode is explicit and never falls through

Runtime model access is an explicit discriminated setting: `api` or `coding-plan`. API mode starts Model Router and requires the three API fields. Coding-plan mode starts Plan Gateway and the selected plan adapter, and for Codex requires a ChatGPT-authenticated app-server account. A failure remains on its selected path and produces an actionable diagnostic. It never falls back from subscription usage to a paid API key or the reverse.

### 5. One durable trace event contract and store

The existing summary-only `ModelRequestAuditRecorder` and parallel raw/sanitized router trace concepts are replaced by one append-only trace contract. Events cover request start/body, response headers/chunks/end, Agent events, usage, errors, and lifecycle. Every event includes stable `traceId`, `runtimeId`, `threadId`, `turnId`, and `requestId` where known; child model calls include `parentRequestId`.

Model Router and Plan Gateway write through the same store module. Runtime adapters append normalized Agent events to that same session/turn. The stored model body and stream data are complete as observed at the local boundary, while secret-bearing headers, cookies, known credential fields, and inline secret patterns are removed before persistence. Sanitized summaries and UI cards are derived views of the same records, not a second capture path.

Trace data lives under application user data, outside workspaces, with owner-only file permissions. Retention is 30 days by default and cleanup runs at startup and at most once per day. Export reads the same store and produces a portable bundle after the same mandatory secret filter. The store does not log hidden provider reasoning that was not returned.

### 6. One setup and diagnostics surface

Onboarding and settings first ask for access mode. API mode shows exactly the three fields. Coding-plan mode shows the available plan adapters and an official login action. Both expose a single status result containing service health, credential/auth state, selected/cached wire protocol when known, trace capture readiness, and a concise corrective action.

Advanced protocol/provider controls are not exposed. Vendor-specific examples can appear as documentation text but cannot change code paths or configuration schemas.

### 7. Breaking replacement instead of compatibility layers

Legacy provider fields, forced Model Router-only Codex launch logic, in-memory model audit IPC, and duplicate trace summaries are deleted as their replacements land. Parsers use the new schema directly and fail clearly on old shapes. Tests are rewritten around final contracts rather than preserving legacy fixtures.

## Risks / Trade-offs

- **First-request negotiation can add failed round trips** → fallback only on definitive non-billable incompatibility responses and cache the result immediately.
- **Some compatible servers return ambiguous errors for unsupported schemas** → do not guess after ambiguous failures; surface one concise diagnostic and keep billing safe.
- **Full prompts and tool results are sensitive** → local-only storage, owner permissions, mandatory credential removal, bounded retention, explicit export, and no workspace storage.
- **A Codex release may change its subscription upstream contract** → keep the upstream and header policy inside the Codex adapter, validate supported Codex versions, and fail closed without API fallback.
- **A provider may not support enough of a canonical request after conversion** → drivers validate required capabilities and return a protocol-capability error rather than silently dropping tools, reasoning, or multimodal content.
- **Removing legacy settings is disruptive** → this is intentional; present a clear setup-required state and keep the new form to three fields.

## Migration Plan

1. Land the new settings and trace contracts, deleting legacy fields and consumers in the same change.
2. Land generic upstream drivers and update Model Router to use them.
3. Land Plan Gateway core, Codex adapter, and Codex app-server login/account operations.
4. Switch runtime launch selection to the explicit access mode.
5. Replace onboarding/settings and diagnostics with the unified surface.
6. Run unit, worker, runtime, renderer, typecheck, and end-to-end tests, including fake subscription and multi-protocol upstreams.
7. On first launch with an old config, show setup-required; do not auto-convert it.

Rollback is a code rollback plus deletion of newly generated local config. Full trace files remain self-describing and can be exported or cleared independently.

## Open Questions

None for implementation. A live Codex subscription smoke test remains an explicit user-approved release validation because it consumes plan quota; automated tests use a fake upstream and fake app-server auth state.
