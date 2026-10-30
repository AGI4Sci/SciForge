# DSH ModelRouter route handoff

The production Host resolves only `{baseUrl, apiKey, model}` using `resolveRuntimeModelRouterSettings`. DSH owns the provider mapping in `src/model-router.ts`; it receives only loopback `/v1`, the runtime-local key, and the exact public alias. No upstream key, model endpoint or inherited provider environment is copied.

## Official contract audited read-only

Official tag `dsh-v0.2.0-rc.2`, source `639ed015397290b3745d163aafe02ffee4aa3f84`:

- `packages/bundle/acp-app/cordis.patch.yml`: ACP defaults to provider `deepseek-official`, model `deepseek-v4-flash`.
- `packages/llm/llm-deepseek/src/config.ts`: the native adapter is Messages-only (`protocol is not configurable`), resolves `baseURL` from config / launch environment and otherwise public default. It is NOT the OpenAI chat route.
- `packages/llm/llm-pi-ai/src/config.ts`: provider dictionary key is the provider route; custom routes accept `api`, `apiKeyEnv`, `baseURL`, and explicit `models: [{id}]`.
- The Host overlay disables both native DeepSeek adapters and configures a single custom `sciforge-model-router` route using `openai-completions`. ACP provider and model are explicitly overridden. Model id is the exact public router alias, not an upstream model name.
- `apps/cli/src/dump-config.ts`: boot-free config dump preserves `!!js` without evaluating it. The three expressions are fixed Host-controlled environment accesses, not user code. Aliases never appear as executable config text.

## Pin / executor integration required

The deployment verifier remains unchanged: complete artifact closure, exact composed-config SHA, entry/plugin allowlist and safety checks still run. The new overlay changes the reviewed composed configuration, so the executor MUST generate a fresh reviewed pin with this overlay. Do not reuse the old config digest, disable checks, or enroll runtime output as authority. The test substitutes only release metadata for its synthetic executable; production has no fixture pin or verifier bypass.

The patch uses fixed `!!js process.env.SCIFORGE_DSH_ROUTER_{URL,MODEL}` and fixed `apiKeyEnv: SCIFORGE_DSH_ROUTER_KEY`. This keeps alias/key changes out of the config digest. Actual official CLI dump serialization/composition and real-model/Electron execution belong to the executor/parent acceptance; the local fixture is not official-CLI or model acceptance.

## Lifecycle

The package resolves settings again on each connection use, checks route identity and retires an old child on route changes or route rejection. `invalidateModelAccess()` is a reusable stop (not terminal `close`), and production settings patching invokes it before publishing router/access/runtime selection changes. Active leases are revoked and the child is awaited. Subsequent use resolves new settings and verifies deployment again. Codex and Claude lifecycle behavior is unchanged.

Policy authorizes DSH only for selected API mode. Disabled/missing configuration, explicit blank alias, missing local key, nonlocal endpoint and unavailable existing router fail closed with recoverable `runtime_model_route_*` errors. Startup readiness reuses existing `/health`, not a new proxy or provider probe.

## Acceptance scope

`dsh-model-router.test.ts` uses a real stdio ACP child, real local HTTP server and the production factory. Artifact bytes, config digest, closure and safety checks execute normally against test-only compiled release metadata. It proves loopback chat path, bearer local key, exact alias, no upstream environment inheritance, PID replacement, fail-closed cases and retry after repair. No real upstream request is made.
