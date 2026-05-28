# Runtime Codex browser acceptance blocked

Observed at: 2026-05-28T06:26:51.279Z
Requested UI port: 5173
Requested workspace writer port: 6173
Actual/intended URL: http://127.0.0.1:5173/
Actual/intended workspace writer URL: http://127.0.0.1:6173
Actual/intended RuntimeCodex URL: http://127.0.0.1:18080
Workspace path: /Applications/workspace/ailab/research/app/SciForge/workspace/parallel/p1
Profile: sciforge-runtime-deepseek
Provider: sciforge-deepseek-proxy
Model: bailian/deepseek-v4-flash
Reason: Runtime Codex environment is not fully configured; missing SCIFORGE_RUNTIME_API_KEY and Runtime Codex secret must be supplied by service environment, not config file debug fallback. Set SCIFORGE_RUNTIME_API_KEY in the service environment, and set SCIFORGE_PROXY_UPSTREAM_BASE_URL or config.local.json/.sciforge instance config codexProxy.upstreamBaseUrl/llm.baseUrl before live browser E2E can pass. Checked config paths: workspace/parallel/p1/.sciforge/config.local.json, config.local.json. Runtime secret-like keys were found in ignored config files (workspace/parallel/p1/.sciforge/config.local.json, config.local.json); they are accepted only as local proxy debug fallback and cannot satisfy browser/release acceptance.
Provider preflight artifact: docs/test-artifacts/runtime-provider-preflight/manifest.json
Provider preflight category: config-secret-source
Provider preflight checked at: 2026-05-26T05:37:47.062Z
Provider preflight release acceptance: not-evaluated
Runtime key in service env: missing
Provider upstream base URL: present
Runtime key source: config-debug-fallback
Upstream URL source: config
Acceptance scope: non-seed Runtime Codex messages only; seed/demo/fixture messages are excluded from success criteria.

Acceptance rubric:
- User intent: prove the real default-chat Runtime Codex path can complete single-turn, selected-ref, and multi-turn tasks.
- Expected observable result: gui.present projection or native Runtime Codex assistant answer rendered in default chat with provider/model/profile/workspace/command id and folded audit logs.
- Actual result: blocked before release acceptance because Runtime Codex environment is not fully configured; missing SCIFORGE_RUNTIME_API_KEY and Runtime Codex secret must be supplied by service environment, not config file debug fallback. Set SCIFORGE_RUNTIME_API_KEY in the service environment, and set SCIFORGE_PROXY_UPSTREAM_BASE_URL or config.local.json/.sciforge instance config codexProxy.upstreamBaseUrl/llm.baseUrl before live browser E2E can pass. Checked config paths: workspace/parallel/p1/.sciforge/config.local.json, config.local.json. Runtime secret-like keys were found in ignored config files (workspace/parallel/p1/.sciforge/config.local.json, config.local.json); they are accepted only as local proxy debug fallback and cannot satisfy browser/release acceptance.
- Current evidence refs: manifest.json plus blocked notes. Prior or stale browser screenshots/DOM refs are diagnostic only and cannot count as current release evidence.
- Negative checks: fake passed status, missing DOM/screenshot, missing command id, missing task result, seed/demo evidence, and partial/blocked/failed status remain release-blocking.
- Required key: set SCIFORGE_RUNTIME_API_KEY in the service environment; do not store it in repository files.
- Config-file apiKey fallback: accepted only for local provider proxy debugging, and rejected as browser/release acceptance evidence.
- Required provider proxy upstream: set SCIFORGE_PROXY_UPSTREAM_BASE_URL or config.local.json codexProxy.upstreamBaseUrl/llm.baseUrl so the local proxy has an upstream OpenAI-compatible endpoint.
- Provider preflight artifact: docs/test-artifacts/runtime-provider-preflight/manifest.json records the current non-secret service-env/upstream diagnostic and remains diagnostic-only, not browser/release acceptance.
- Required Runtime Codex config: active profile, provider, model, env_key SCIFORGE_RUNTIME_API_KEY, and responses wire_api must be resolved from the local runtime config.
- Re-run strict release acceptance with SCIFORGE_REQUIRE_LIVE_BROWSER_ACCEPTANCE=1 npm run smoke:runtime-codex-browser-acceptance after the key/upstream are present and the browser shows the second-turn answer.
- Remaining risk: live browser acceptance still requires configured Runtime Codex credentials/upstream and visible second-turn answer.

No passed user-level conclusion is claimed.
