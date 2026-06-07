# T2 Browser Retrieval Run - 2026-06-07

## Result

- Local dogfood: passed.
- Release strict acceptance: passed with current service-env provider readiness.
- Desktop Browser product-live: passed.
- Release validator hardening: passed as a unit/smoke contract update.
- Ordinary-chat acceptance writer: passed unit contract and live release smoke; it now uses a Browser-owned Playwright fallback when no native adapter is configured, closes owned BrowserHostSession ids after evidence capture, and preserves native-adapter mode when `SCIFORGE_BROWSER_HOST_NATIVE_ADAPTER_URL` is present.
- Ordinary-chat local dogfood wrapper: passed unit contract and current CLI run; it produced `browser.open_read` module.invoke evidence plus BrowserHostSession source-page/page-text refs while remaining explicitly local-only / not release-eligible.
- BrowserHostSession `open_read` HTTP route: fixed. The manager already materialized refs; the workspace writer was missing the top-level `/api/sciforge/browser-host/open-read` route, so HTTP callers could not reach the source-page/page-text materialization path.

## Commands

```bash
npm run smoke:runtime-codex-browser-local-dogfood --silent
npm run smoke:runtime-codex-browser-ordinary-chat-local-dogfood --silent
npm run smoke:runtime-codex-browser-acceptance --silent
npm run smoke:runtime-codex-browser-acceptance:strict --silent
npm run verify:browser:desktop-product-live --silent
node --import tsx tests/smoke/smoke-runtime-codex-browser-acceptance.ts
npx tsc --noEmit --pretty false
node --import tsx --test tests/smoke/smoke-runtime-codex-browser-local-dogfood.test.ts src/runtime/browser-host-session-source-pages.test.ts src/runtime/codex/agent-host-turn-loop.test.ts
node --import tsx --test tests/smoke/runtime-codex-browser-ordinary-chat-acceptance-writer.test.ts
node --import tsx --test tests/smoke/runtime-codex-browser-ordinary-chat-acceptance-writer.test.ts src/runtime/codex/agent-host-turn-loop.test.ts tests/smoke/smoke-runtime-codex-browser-local-dogfood.test.ts
node --import tsx --test tests/smoke/runtime-codex-browser-ordinary-chat-acceptance-writer.test.ts tests/smoke/smoke-runtime-codex-browser-acceptance-producer.test.ts
node --import tsx --test tests/smoke/runtime-codex-browser-ordinary-chat-local-dogfood.test.ts
node --import tsx --test src/runtime/browser-host-session.test.ts src/runtime/workspace-server-health.test.ts --test-name-pattern 'HTTP routes expose|openRead|workspace writer health helper'
node --import tsx --test src/runtime/browser-host-session.test.ts tests/smoke/runtime-codex-browser-ordinary-chat-acceptance-writer.test.ts tests/smoke/runtime-codex-browser-ordinary-chat-local-dogfood.test.ts tests/smoke/smoke-runtime-codex-browser-acceptance-producer.test.ts src/runtime/codex/agent-host-turn-loop.test.ts src/runtime/workspace-server-health.test.ts
node --import tsx --test src/runtime/modules/bounded-operation-module-handlers.test.ts --test-name-pattern 'browser\\.(search_read|open_read)'
node .sciforge/run-with-runtime-env.mjs npm run smoke:runtime-codex-browser-acceptance --silent
node .sciforge/run-with-runtime-env.mjs npm run smoke:runtime-codex-browser-acceptance:strict --silent
```

## Evidence

- Local dogfood manifest: `docs/evolve/runs/runtime-codex-browser-local-dogfood/manifest.json`
- Local dogfood final answer: `docs/evolve/runs/runtime-codex-browser-local-dogfood/final-answer.md`
- Runtime Codex release manifest: `docs/test-artifacts/runtime-codex-browser-acceptance/manifest.json`
- Desktop Browser native live manifest: `docs/test-artifacts/desktop-browser-native-live-acceptance/manifest.json`
- Release validator negative fixture: `fake-passed-native-default-chat-without-browser-source-evidence.json`
- Ordinary-chat acceptance writer: `src/runtime/runtime-codex-browser-ordinary-chat-acceptance-writer.ts`
- Ordinary-chat acceptance writer tests: `tests/smoke/runtime-codex-browser-ordinary-chat-acceptance-writer.test.ts`
- Release producer branch test: `tests/smoke/smoke-runtime-codex-browser-acceptance-producer.test.ts`
- Ordinary-chat local dogfood wrapper: `src/runtime/runtime-codex-browser-ordinary-chat-local-dogfood.ts`
- Ordinary-chat local dogfood CLI: `tools/runtime-codex-browser-ordinary-chat-local-dogfood.ts`
- Ordinary-chat local dogfood tests: `tests/smoke/runtime-codex-browser-ordinary-chat-local-dogfood.test.ts`
- Ordinary-chat local dogfood manifest: `docs/evolve/runs/runtime-codex-browser-ordinary-chat-local-dogfood/manifest.json`
- Ordinary-chat local dogfood final answer: `docs/evolve/runs/runtime-codex-browser-ordinary-chat-local-dogfood/ordinary-chat-acceptance/final-answer.md`
- BrowserHostSession open_read route: `src/runtime/workspace-server-browser-host.ts`
- BrowserHostSession open_read route tests: `src/runtime/browser-host-session.test.ts`
- Workspace writer health endpoint inventory: `src/runtime/workspace-server-health.ts`

## Current Conclusion

SciForge can use BrowserHostSession local dogfood with a Browser-owned Playwright fallback to open and read official OpenAI source pages, producing source page refs and page text refs. The current local run read `https://openai.com/products/release-notes/` and recorded the source/page-text refs in the manifest.

The local dogfood now fails closed when an official source page has only empty text refs. The current successful run uses the readable official OpenAI API changelog path, records non-empty source text refs for:

- `https://developers.openai.com/api/docs/changelog`
- `https://developers.openai.com/api/docs/models`

The final answer is a bounded Chinese summary sourced from the changelog text and separately lists every page actually read.

The release smoke no longer remains blocked in this environment. `SCIFORGE_RUNTIME_API_KEY` and `SCIFORGE_PROXY_UPSTREAM_BASE_URL` are supplied to the smoke through `.sciforge/run-with-runtime-env.mjs`, which reads ignored local config without printing secrets and exports the values as child-process service env. Provider preflight remains diagnostic-only, but the live browser acceptance now produces a passed release-shaped manifest from current BrowserHostSession source refs.

The release validator now rejects a default-chat/native answer that lacks current-run Browser source evidence. A passed `sciforge.runtime-codex.browser-acceptance.v1` manifest must prove:

- Browser came through `module.invoke(executeBoundedOperation)`.
- The operation was `browser.search_read` or `browser.open_read`.
- Evidence includes a `BrowserHostSession` ref.
- Evidence includes current-run source-page refs and page-text refs.
- Evidence includes final-answer refs.

This closes the acceptance loophole where a visible Runtime Codex answer could look successful without proving it actually used SciForge BrowserHostSession source/page text evidence.

The ordinary-chat acceptance writer now exists as a narrow runtime helper. It calls the Agent Host ordinary chat turn loop and, by default, wraps the real Browser bounded-operation module handler with `{ workspacePath }`, so production runs use `BrowserHostSessionManager.search/openRead` instead of a fake invoker. Tests can still inject bounded Browser ports. The writer requires `browser.search_read/open_read` to return current `BrowserHostSession` source-page and page-text refs, verifies those refs map to non-empty files under `.sciforge/browser-host/sessions/<id>/source-pages/`, parses each `.source.json`, requires `status: "read"`, a non-empty `finalUrl`, a paired current-run `.txt` `textRef`, and non-empty page text, writes `final-answer.md`, and writes a release-shaped `sciforge.runtime-codex.browser-acceptance.v1` manifest only when the current run is complete. If the referenced source files are missing or source metadata is invalid, it writes a blocked manifest instead.

Follow-up T2 root-cause check: `BrowserHostSession.open_read` was not the source/page-text ref blocker. The live release run now reaches `module.invoke(browser.open_read)`, calls the BrowserHostSession manager with the official OpenAI API changelog URL, and materializes both refs under the smoke workspace.

The latest strict release run recorded:

- `runtime-truth:module.invoke/browser.open_read/codex-command-browser-ordinary-chat-mq334kzs`
- `browser-host-session:browser-host-180cf7dd662c/source-pages/source-1-f9c4b4d7a3.source.json`
- `browser-host-session:browser-host-180cf7dd662c/source-pages/source-1-f9c4b4d7a3.txt`
- `artifact:runtime-codex-browser-acceptance/final-answer.md`

The source metadata records `status="read"` and `finalUrl="https://developers.openai.com/api/docs/changelog"`. The page text evidence summarizes the OpenAI API changelog and includes current entries such as `omni-moderation-latest`, deprecations, container billing, and OpenAI models on Amazon Bedrock.

The ordinary-chat local dogfood wrapper now gives `config.local.json` users a separate diagnostic entrypoint without weakening release gates. It reads local provider settings only as redacted presence evidence, invokes the ordinary-chat acceptance writer into `ordinary-chat-acceptance/`, writes a wrapper manifest with `releaseEligible=false`, `releaseBlocking=true`, and `releaseGate.status=local-dogfood-only`, and filters evidence refs so raw provider URLs, local paths, secrets, workspace writer refs, and shared-system-input markers cannot enter the local manifest. If `config.local.json` is unavailable, the wrapper blocks before invoking the writer. For local dogfood, it explicitly supplies a BrowserHostSessionManager with Playwright fallback when no native adapter is configured, then closes current BrowserHostSession ids from the produced refs so the CLI exits cleanly.

The current CLI run of that wrapper is a local-only success claim, not a release claim. It reached the ordinary-chat writer and `module.invoke(browser.open_read)`, read `https://developers.openai.com/api/docs/changelog`, and recorded:

- `browser-host-session:.../source-pages/source-1-...source.json`
- `browser-host-session:.../source-pages/source-1-...txt`
- `action-ledger:browser.executeBoundedOperation/.../module.invoke`
- `runtime-truth:module.invoke/browser.open_read/...`
- `artifact:runtime-codex-browser-acceptance/final-answer.md`

The wrapper manifest records `status=passed`, `localConfig.secretValuesRedacted=true`, `ordinaryChatAcceptance.acceptanceConclusionFromRealBrowser=true`, and `releaseGate.status=local-dogfood-only`.

Superseded note: the direct BrowserHostSession `open_read` HTTP path described in this run log has been removed from the public task surface. Current task-facing browser access goes through `packages/actions/browser-runtime` primitives (`browser.search`, `browser.navigate`, `browser.observe`, `browser.read`, `browser.extract`, `browser.download`), while BrowserHostSession remains only the host-owned live browser implementation behind those primitives.

The release smoke now keeps `runtimeBridgeBlockedReason()` as the fail-close service-env/provider gate. The gate requires service-env Runtime Codex credentials/upstream and a current provider preflight manifest with `category=ready`; fake env values alone remain blocked as preflight-only evidence. When that gate passes and `SCIFORGE_BROWSER_ACCEPTANCE_VALIDATE_ONLY` is not set, the smoke invokes the ordinary-chat writer, enriches its manifest with bounded port/workspace/provider metadata and negative checks, then validates it with the ordinary-chat Browser source-evidence assertion. `SCIFORGE_BROWSER_ACCEPTANCE_VALIDATE_ONLY=1` still validates an existing manifest only.

A focused producer-branch test now uses a `NODE_ENV=test` + explicit writer-fixture hook to force ready preflight and prove the release smoke enrichment path produces bounded metadata without raw loopback URLs, absolute paths, or secrets. The fixture also requires the official OpenAI changelog prompt and emits `browser.open_read` refs so the release producer cannot regress to broad search-result evidence. The hook is not active outside tests; normal smoke still requires the real writer and provider preflight gate.

T2 is release-proven for the current ordinary-chat Browser retrieval task. Remaining work moves to T1 Desktop Software Task unless future T2 hardening discovers a new gap.
