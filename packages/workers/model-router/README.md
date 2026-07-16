# SciForge Model Router

Standalone provider-compatible `/v1/responses` facade for SciForge multimodal routing.

The router is a deterministic orchestrator. It selects registered profile roles, translates visual and scientific inputs into text observations, runs a bounded supplement loop, and writes refs-first trace bundles under the configured Model Router trace data root. It does not plan tasks, choose capabilities for agents, execute desktop actions, or silently fall back to unregistered providers.

## Run

```bash
npm run model-router:start -- --port 3892 --workspace-root /path/to/workspace
```

The default environment-driven profile uses role-oriented settings:

```bash
export SCIFORGE_MODEL_ROUTER_PUBLIC_MODEL_ALIAS=sciforge-router
export SCIFORGE_TEXT_BASE_URL=https://text-provider.example/v1
export SCIFORGE_TEXT_MODEL=private-text-model
export SCIFORGE_TEXT_API_KEY=...
export SCIFORGE_VISION_BASE_URL=https://vision-provider.example/v1
export SCIFORGE_VISION_MODEL=private-vision-model
export SCIFORGE_VISION_API_KEY=...
export SCIFORGE_MODEL_ROUTER_TRACE_DATA_ROOT=/var/tmp/sciforge-model-router
```

Optional translator workers are attached only through Model Router-owned environment:

```bash
export SCIFORGE_SCIMODALITY_SERVICE_URL=http://127.0.0.1:3898
export SCIFORGE_SCIMODALITY_SERVICE_TOKEN=...
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

`SCIFORGE_MODEL_ROUTER_CONFIG=/path/to/router.config.json` can provide the same `ModelRouterConfig` shape exported by `src/router.ts`. Relative profile `traceRoot` values resolve under `SCIFORGE_MODEL_ROUTER_TRACE_DATA_ROOT` or the platform state-data default, never under the workspace. Public UI and audits should show only the router alias/profile/role readiness; provider URLs, API keys, and raw model slugs remain private router configuration.

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

## Trace Audit

Trace bundles are refs-first evidence. They should contain role aliases, hashes, public router alias/profile, bounded call status, and sanitized summaries only. After a live or staging provider run, scan the trace root before using it as release evidence:

```bash
npm --workspace @sciforge/model-router exec -- node --import tsx tools/model-router-trace-audit.ts \
  --trace-root "$SCIFORGE_MODEL_ROUTER_TRACE_DATA_ROOT/traces" \
  --known-secret-env SCIFORGE_TEXT_API_KEY \
  --known-secret-env SCIFORGE_VISION_API_KEY \
  --out docs/test-artifacts/model-router-live-trace-audit/report.json
```

The report stores finding kinds, file refs, JSON paths, and hashes only. It must not echo matching secret values.
