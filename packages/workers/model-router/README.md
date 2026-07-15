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
# Use "responses" for Responses-only reasoners; omitted defaults to "chat_completions".
export SCIFORGE_TEXT_ENDPOINT_FORMAT=responses
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

For a Responses-only text reasoner, set `profiles.<id>.textReasoner.endpointFormat` to
`"responses"`. The default is `"chat_completions"`. Native Responses routing preserves function
tools, reasoning configuration, and tool-call transcripts while the router continues to own its
public response and stream ids.

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
