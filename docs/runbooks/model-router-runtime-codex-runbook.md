# Model Router Runtime Codex Runbook

Last updated: 2026-06-05

This runbook covers the product default path:

```text
Runtime Codex profile sciforge-runtime-default
  -> provider sciforge-model-router
  -> model alias sciforge-router
  -> Model Router /v1/responses
  -> profile-selected textReasoner and translators.vision
```

Public UI, settings, runtime health, and audit surfaces may show the router alias, router profile, capabilities, role coverage, and readiness. They must not show private provider URLs, API keys, secret environment variable names, or raw upstream model slugs. Public alias overrides are allowed only when they remain generic router aliases; raw provider/model terms hidden behind a `sciforge-model-router-*` or `sciforge-router-*` prefix must be normalized back to the default public alias before metadata is returned.

## Runtime Codex Default

Refresh the isolated Runtime Codex home:

```bash
npm run backend:codex-runtime:setup -- --overwrite
```

Expected public defaults in `packages/backend/.codex-runtime/codex-home/config.toml`:

```toml
model = "sciforge-router"
profile = "sciforge-runtime-default"

[profiles.sciforge-runtime-default]
model = "sciforge-router"
model_provider = "sciforge-model-router"

[model_providers.sciforge-model-router]
name = "SciForge Model Router"
base_url = "http://127.0.0.1:3892/v1"
env_key = "SCIFORGE_RUNTIME_API_KEY"
wire_api = "responses"
```

`base_url` and `env_key` are private runtime configuration, not product labels. The default managed Model Router configuration is considered ready by Settings/runtime health without requiring users to enter a separate Base URL or API key in UI fields.

## Model Router Profile

Model Router config owns concrete upstream routing. Keep profile IDs stable and put model/provider details behind roles:

```yaml
defaultProfile: sciforge-runtime-default
publicModelAlias: sciforge-router

profiles:
  sciforge-runtime-default:
    traceRoot: .sciforge/model-router-traces
    textReasoner:
      provider: <text-provider-id>
      baseUrl: <private-text-provider-base-url>
      apiKeyEnv: <private-text-provider-key-env>
      model: <private-text-reasoner-model-slug>
    translators:
      vision:
        provider: <vision-provider-id>
        baseUrl: <private-vision-provider-base-url>
        apiKeyEnv: <private-vision-provider-key-env>
        model: <private-vision-translator-model-slug>
        maxSupplementRounds: 2
```

Pure text requests go straight to `textReasoner`. Requests with image, screenshot, or visual refs call `translators.vision` first, then pass text observations to `textReasoner`.

## Workspace Override

Default Runtime Codex workspaces stay under the runtime root:

```bash
export SCIFORGE_RUNTIME_DEFAULT_WORKSPACE="$PWD/packages/backend/.codex-runtime/workspaces/default"
```

For a user workspace outside the runtime root, callers must opt in explicitly:

```bash
npm run backend:codex-runtime:exec -- \
  --workspace "$SCIFORGE_USER_WORKSPACE" \
  --allow-workspace-outside-runtime-root \
  --prompt "$SCIFORGE_USER_TEXT_COMMAND"
```

The workspace override changes file/action scope only. It must not change router provider URL, secret selection, or raw upstream model selection.

## Trace Root

Use a refs-first trace root inside the active workspace unless release packaging provides a scoped AppData location:

```yaml
profiles:
  sciforge-runtime-default:
    traceRoot: .sciforge/model-router-traces
```

Trace bundles may include profile ID, public alias, role names, latency, status, modality refs, hashes, dimensions, and sanitized error summaries. They must not include API keys, raw secret headers, long-lived base64 image payloads, complete raw provider payloads, private endpoint URLs, or raw upstream model slugs in public manifests.

## Release Check

Run focused checks after changing runtime defaults or audit redaction:

```bash
node --import tsx --test packages/backend/src/runtime-home.test.ts
node --import tsx --test src/ui/src/runtimeHealth.test.ts
node --import tsx --test src/runtime/codex/codex-runtime-config.test.ts src/runtime/codex/codex-runtime-audit-bundle.test.ts
node --import tsx --test packages/workers/model-router/src/trace-audit.test.ts
git diff --check -- packages/backend/runtime-config/config.toml.example docs packages/backend/README.md
```

Before release acceptance, also run the normal runtime provider preflight and browser acceptance smokes required by the release checklist. After the live/staging provider matrix has generated traces, scan the trace root without printing secret values:

```bash
node --import tsx tools/model-router-trace-audit.ts \
  --trace-root .sciforge/model-router-traces \
  --require-non-empty \
  --known-secret-env SCIFORGE_TEXT_API_KEY \
  --known-secret-env SCIFORGE_VISION_API_KEY \
  --out docs/test-artifacts/model-router-live-trace-audit/report.json
```

For release gates that bind live matrix `traceRef` values to audit evidence, scan the workspace-relative trace root (`.sciforge/model-router-traces`), not a single response bundle or an absolute private trace root. The resulting `scannedFileRefs` are exact file refs such as `YYYY-MM-DD/resp_*/trace.json`.

The audit report must have `status: "pass"`, positive `policy.knownSecretsChecked`, positive `scannedBytes`, and internally consistent `scannedFiles`/`scannedFileRefs` before the `真实 provider trace 脱敏` blocker in `PROJECT.md` can be checked. Live matrix release gates can also require an expected known-corpus count derived from the explicit `--known-secret-env` names. The scanner treats JSON, JSONL, and SSE `data:` JSON trace records as auditable structured payloads, fail-closes raw provider payload/header key aliases, `Authorization:`/`Authorization=`/`Authorization Bearer` text variants, symlink/unscannable trace entries, unsafe public trace fileRefs, and unknown CLI args, and redacts unsafe JSON keys from finding paths.

For Computer Use release acceptance, each passed case must include a workspace-file `current-run.json` marker with schema `sciforge.model-router.computer-use.current-run.v1`, a non-empty `runId`, and `startedAt`/`completedAt` timestamps enclosing the scoped evidence files. The external trace audit report must be generated after the matrix manifest/input and passed with the expected count:

```bash
node --import tsx tools/model-router-computer-use-live-acceptance-matrix.ts \
  --manifest docs/test-artifacts/model-router-computer-use-live-matrix/manifest.json \
  --trace-audit-report docs/test-artifacts/model-router-live-trace-audit/report.json \
  --expected-known-secrets-checked 2 \
  --strict
```
