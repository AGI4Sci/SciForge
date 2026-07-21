# SciForge Model Router

Standalone protocol-negotiating model gateway for SciForge multimodal routing. Its public API accepts OpenAI Responses, OpenAI Chat Completions, and Anthropic Messages requests.

The router is a deterministic orchestrator. It selects registered profile roles, translates visual and scientific inputs into text observations, and runs a bounded supplement loop. Client requests and actual upstream attempts are recorded in the shared append-only Full Trace store. It does not plan tasks, choose capabilities for agents, execute desktop actions, or silently fall back to unregistered providers.

## Run

```bash
npm run model-router:start -- --port 3892 --config /path/to/router.config.json --user-data-dir /path/to/app-data --workspace-root /path/to/workspace
```

The required config file uses role-oriented settings. Credentials remain environment references inside that file:

```bash
{
  "defaultProfile": "default",
  "publicModelAlias": "sciforge-router",
  "profiles": {
    "default": {
      "textReasoner": {
        "baseUrl": "https://provider.example/v1",
        "apiKeyEnv": "SCIFORGE_MODEL_ROUTER_TEXT_API_KEY",
        "model": "provider-model"
      },
      "translators": {}
    }
  }
}
```

Each upstream role needs a base URL, model name, and API key. Provider behavior is capability-driven: the router does not infer a vendor from domains, model names, or error text. In `auto` mode it starts with the client wire, then uses the same adapters and negotiation state machine for every upstream. The desktop settings expose an upstream-protocol selector; selecting a wire also constrains `allowedProtocols` to that wire.

Capabilities can be configured for private gateways without adding provider-specific branches to routing code:

```json
{
  "baseUrl": "https://gateway.example/v1",
  "apiKeyEnv": "SCIFORGE_MODEL_ROUTER_TEXT_API_KEY",
  "model": "gateway-model",
  "compatibility": {
    "preferredProtocol": "chat-completions",
    "allowedProtocols": ["chat-completions"],
    "preserveResponsesReasoningContent": true,
    "preserveChatReasoningContent": true,
    "chatMaxTokensField": "max_completion_tokens",
    "schemaPatternPolicy": "reject"
  }
}
```

All compatibility fields are optional. `allowedProtocols` is also a safety boundary: negotiation never sends a request on a wire outside that list. Working protocols are cached by normalized base URL, model, and compatibility settings.

The router retries another protocol only after protocol-level HTTP status evidence (`404`, `405`, or `415`). It never infers retry safety from localized error-message keywords or vendor-specific error codes. Authentication, quota, rate-limit, timeout, ambiguous server, and ordinary validation failures remain terminal. An explicit error inside a 2xx Responses payload may trigger fallback only before any model output or ambiguous provider data has arrived; malformed successful payloads and partial streams are terminal and are never resubmitted.

Tool JSON Schema passes through one bounded, prototype-safe normalizer on every protocol path. Property names, `required`, composition keywords, and validation constraints are never truncated or silently removed. If a configured provider cannot safely represent a schema constraint such as `pattern`, the candidate fails closed before a provider request is sent.

When a Responses request negotiates to Anthropic Messages, reasoning effort maps to enabled thinking with a budget bounded by the output-token limit. Invalid constraints fail explicitly. Native Anthropic thinking controls, including adaptive controls, remain native on Messages requests and fail explicitly when another protocol cannot represent them. Response finish reasons, stop reasons, and stop sequences are retained through the canonical response and mapped only where the client protocol can represent them.

Streaming compatibility endpoints currently preserve protocol-correct SSE ordering but buffer the routed upstream result before emitting the completed stream. This keeps the bounded orchestration path unified, but it does not provide progressive token latency. Byte-transparent Plan Gateway traffic is a separate runtime path and is not subject to this router buffering behavior.

Optional translator workers are attached through the same config and credential-reference pattern:

```bash
"scientific": {
  "baseUrl": "http://127.0.0.1:3898",
  "tokenEnv": "SCIFORGE_MODEL_ROUTER_SCIENTIFIC_TRANSLATOR_TOKEN",
  "model": "scientific-translator"
}
```

Do not configure app runtimes to call these workers or provider APIs directly. If a translator
worker is unset, Model Router degrades or falls back according to its own routing policy.

Scientific routing distinguishes **protected** files from **translatable** files. Protected
scientific formats are never inlined into the text reasoner. Only FASTA protein sequences,
PDB/mmCIF structures, and SMILES files are sent to the managed scientific
translator with an explicit modality. Other protected formats such as VCF, BED, GFF, and MGF
return `scientific_modality_unsupported` without sending raw contents to either upstream service.
Ambiguous `.fasta` and `.fa` uploads are classified locally and conservatively: only a clearly
protein sequence is translated, while DNA/RNA or nucleotide-ambiguous content fails closed.

`--config` is the single configuration entry and accepts the `ModelRouterConfig` shape exported by `src/router.ts`. Full request and response events are written through the shared trace store under `--user-data-dir` (or its launcher-provided user-data environment); the router does not maintain a second summary or per-profile trace directory. Public UI should show only the router alias/profile/role readiness; upstream URLs, API keys, and raw model slugs remain private router configuration.

## Capability discovery

Authenticated runtimes negotiate the active registered profile through the same router control plane:

```bash
curl -H "Authorization: Bearer $SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY" \
  http://127.0.0.1:3892/v1/capabilities
```

The `sciforge.model-router.capabilities.v1` response contains only the public model alias,
selected profile id, role readiness, accepted visual MIME/input limits, and image
generation/edit/reference/mask/size features. It never returns provider URLs, provider names,
credential environment names, raw model slugs, or keys. Use
`x-sciforge-model-router-profile` to inspect a registered non-default profile; unknown profiles
fail closed.

Profiles may narrow the router defaults with a public capability registration:

```json
{
  "capabilities": {
    "vision": {
      "mimeTypes": ["image/png", "image/jpeg", "image/webp"],
      "maxInputBytes": 8388608
    },
    "images": {
      "generation": true,
      "editing": true,
      "referenceImages": true,
      "masks": true,
      "sizeSelection": true,
      "sizes": ["512x512", "1024x1024"]
    }
  }
}
```

Feature availability is the intersection of this registration, the profile's registered roles,
and current credential readiness. If no size list is registered, `sizes.mode` is
`provider-defined`; clients should omit `size` and use the provider default instead of guessing.
