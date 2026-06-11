# SciForge Vision Router Service

A **standalone, pluggable** SciForge service module. It translates a visual input
(image, or a video keyframe) into **natural-language evidence** using Qwen3.7-Plus,
so a text-only main agent (DeepSeek V4) can "see" the image.

- **Translate-only.** The vision model describes what is visible. It never reasons,
  answers the user, gives advice, or claims task completion. Reasoning stays with the
  main agent.
- **Independent.** No dependency on the SciForge main repo. Zero runtime npm
  dependencies (Node 20+ `node:http` + `fetch`).
- **Template-conformant.** Returns the `ServiceResult` envelope from
  [`../Servic_Module_Template.md`](../Servic_Module_Template.md). Per the template's
  placement rules this is an **HTTP service** (a stable transform invoked by the host),
  not an Agent-chosen MCP tool — SciForge's gateway calls it during input pre-extraction.

## Run

```bash
npm install
cp .env.example .env   # fill VISION_PROVIDER_API_KEY from ../开发资源.txt (Qwen3.7-Plus)
npm start              # http://127.0.0.1:3899
```

## API

```
GET  /health   -> { ok, service, checkedAt }
GET  /version  -> { service, version, model }
POST /vision/translate
```

`POST /vision/translate` request:

```jsonc
{
  "instruction": "optional — what the user cares about (context, NOT a task to solve)",
  "image": { "base64": "<raw base64>", "mime": "image/png" },  // or { "url": "data:... | https://..." }
  "objectId": "optional upload/object id, echoed into provenance",
  "requestId": "optional"
}
```

Response — `ServiceResult<VisionTranslation>`:

```jsonc
{
  "ok": true,
  "summary": "A bar chart titled Q3 Revenue with three bars…",   // bounded, for the agent
  "data": { "summary": "…full description…", "model": "Qwen3.7-Plus" },
  "provenance": { "serviceId": "sciforge.vision-router", "operation": "vision_translate", "requestId": "…" }
}
```

Failures return `{ ok: false, error: { code, message, retryable }, provenance }` with codes
`INVALID_ARGUMENT` / `UNAUTHENTICATED` / `RATE_LIMITED` / `TIMEOUT` / `UNAVAILABLE` / `INTERNAL_ERROR`.

## Robustness (lives here, not in the caller)

The main agent has **no vision**, so a raw-image fallback is useless — this service is the
authority on "keep trying until Qwen answers". Each call retries transient failures
(timeout / 5xx / 429 / network) with exponential backoff; only auth failures (401/403) and a
caller disconnect stop it early. The HTTP caller (SciForge) therefore stays a thin one-shot
POST. Tunables (env):

| Var | Default | Meaning |
|---|---|---|
| `VISION_PROVIDER_TIMEOUT_MS` | `180000` | Per-attempt timeout (Qwen can be slow). |
| `VISION_PROVIDER_MAX_ATTEMPTS` | `6` | Total attempts before giving up. |
| `VISION_PROVIDER_RETRY_BASE_MS` | `1500` | Exponential backoff base (capped at 15s). |

## How SciForge uses it

SciForge uploads mark each image with a **pending** `visionDescriptor`
(`source: 'upload-preextract'`). A gateway pre-extract stage calls this service, writes
the returned `summary` into the descriptor (`status: 'ready'`), and emits a visible inline
transcript event. Codex's existing input builder then feeds the `ready` descriptor's
summary to DeepSeek as text. See `../SciForge-dev` integration (gateway stage) and
[`../CLAUDE.md`](../CLAUDE.md).

## Test

```bash
npm test         # stubbed provider, no network
npm run typecheck
```
