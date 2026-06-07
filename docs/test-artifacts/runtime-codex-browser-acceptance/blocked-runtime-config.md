# Runtime Codex browser acceptance blocked

Observed at: 2026-06-07T00:16:42.444Z
Requested UI port: 5173
Requested workspace writer port: 6173
Actual/intended URL evidence: length=22; sha256=f91f474a9c7a1e3685f375bf10b045349fdb5eca121b9afa38213aec630313af
Actual/intended workspace writer URL evidence: length=21; sha256=37f8ee8831db62338ad5bfa2d514dc755f01fc6185cebe31b91f8efe46a845fe
Actual/intended RuntimeCodex URL evidence: length=22; sha256=d27399a3d529a195d84f7ef9aff7ccd37f9c37b75b876025864bd63e4a6cb6ab
Workspace path evidence: length=73; sha256=06f2700939355f29a921c67f9c5087c2c73c6e275377b3c0c87551ab46aa43cd
Profile: sciforge-runtime-default
Provider: sciforge-model-router
Model: sciforge-router
Reason: Runtime Codex environment is not fully configured; missing SCIFORGE_RUNTIME_API_KEY and Runtime Codex secret must be supplied by service environment, not config file debug fallback. Set SCIFORGE_RUNTIME_API_KEY in the service environment, and set SCIFORGE_PROXY_UPSTREAM_BASE_URL or a non-secret local upstream config before live browser E2E can pass. Checked config path count: 2. Runtime secret-like keys were found in ignored config file count=2; they are accepted only as local proxy debug fallback and cannot satisfy browser/release acceptance.
Provider preflight artifact: docs/test-artifacts/runtime-provider-preflight/manifest.json
Provider preflight category: config-secret-source
Provider preflight checked at: 2026-06-06T19:21:12.810Z
Provider preflight release acceptance: not-evaluated
Runtime key in service env: missing
Provider upstream base URL: present
Runtime key source: config-debug-fallback
Upstream URL source: config
Acceptance scope: non-seed Runtime Codex messages only; seed/demo/fixture messages are excluded from success criteria.

Acceptance rubric:
- User intent: prove the real default-chat Runtime Codex path can complete single-turn, selected-ref, and multi-turn tasks.
- Expected observable result: gui.present projection or native Runtime Codex assistant answer rendered in default chat with provider/model/profile/workspace/command id and folded audit logs.
- Actual result: blocked before release acceptance because Runtime Codex environment is not fully configured; missing SCIFORGE_RUNTIME_API_KEY and Runtime Codex secret must be supplied by service environment, not config file debug fallback. Set SCIFORGE_RUNTIME_API_KEY in the service environment, and set SCIFORGE_PROXY_UPSTREAM_BASE_URL or a non-secret local upstream config before live browser E2E can pass. Checked config path count: 2. Runtime secret-like keys were found in ignored config file count=2; they are accepted only as local proxy debug fallback and cannot satisfy browser/release acceptance.
- Current evidence refs: manifest.json plus blocked notes. Prior or stale browser screenshots/DOM refs are diagnostic only and cannot count as current release evidence.
- Negative checks: fake passed status, missing DOM/screenshot, missing command id, missing task result, seed/demo evidence, and partial/blocked/failed status remain release-blocking.
- Required key: set SCIFORGE_RUNTIME_API_KEY in the service environment; do not store it in repository files.
- Config-file apiKey fallback: accepted only for local provider proxy debugging, and rejected as browser/release acceptance evidence.
- Required provider proxy upstream: set SCIFORGE_PROXY_UPSTREAM_BASE_URL or a non-secret local upstream config so the local proxy has an upstream OpenAI-compatible endpoint.
- Provider preflight artifact: docs/test-artifacts/runtime-provider-preflight/manifest.json records the current non-secret service-env/upstream diagnostic and remains diagnostic-only, not browser/release acceptance.
- Required Runtime Codex config: active profile, provider, model, env_key SCIFORGE_RUNTIME_API_KEY, and responses wire_api must be resolved from the local runtime config.
- Re-run provider preflight command evidence: length=208; sha256=9fa52a43a1839552c896a0cc9dbc463a7f3167e39d3f0601f5e3493dcc3dd93d
- Re-run default browser acceptance command evidence: length=214; sha256=521bdbedb488cd9cd7ecace14df1f52105fdf7919f995d09248204c7dc0a0401
- Re-run strict release acceptance command evidence: length=469; sha256=1eeeec4c1452a9f5918237e26302bd8ca6f2733106217c13366220c96ee5d295
- Remaining risk: live browser acceptance still requires configured Runtime Codex credentials/upstream and visible second-turn answer.

No passed user-level conclusion is claimed.
