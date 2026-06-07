# T2 Browser Retrieval Run - 2026-06-07

## Result

- Local dogfood: passed.
- Release strict acceptance: blocked by service-env policy.
- Desktop Browser product-live: passed.
- Release validator hardening: passed as a unit/smoke contract update.
- Ordinary-chat acceptance writer: passed unit contract and is wired into the release smoke producer branch after service-env/provider preflight passes.
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

The release smoke remains blocked because strict Runtime Codex browser acceptance requires `SCIFORGE_RUNTIME_API_KEY` from the service environment and must not use ignored config-file secret fallback as release proof.

The release validator now rejects a default-chat/native answer that lacks current-run Browser source evidence. A passed `sciforge.runtime-codex.browser-acceptance.v1` manifest must prove:

- Browser came through `module.invoke(executeBoundedOperation)`.
- The operation was `browser.search_read` or `browser.open_read`.
- Evidence includes a `BrowserHostSession` ref.
- Evidence includes current-run source-page refs and page-text refs.
- Evidence includes final-answer refs.

This closes the acceptance loophole where a visible Runtime Codex answer could look successful without proving it actually used SciForge BrowserHostSession source/page text evidence.

The ordinary-chat acceptance writer now exists as a narrow runtime helper. It calls the Agent Host ordinary chat turn loop and, by default, wraps the real Browser bounded-operation module handler with `{ workspacePath }`, so production runs use `BrowserHostSessionManager.search/openRead` instead of a fake invoker. Tests can still inject bounded Browser ports. The writer requires `browser.search_read/open_read` to return current `BrowserHostSession` source-page and page-text refs, verifies those refs map to non-empty files under `.sciforge/browser-host/sessions/<id>/source-pages/`, writes `final-answer.md`, and writes a release-shaped `sciforge.runtime-codex.browser-acceptance.v1` manifest only when the current run is complete. If the referenced source files are missing, it writes a blocked manifest instead.

The ordinary-chat local dogfood wrapper now gives `config.local.json` users a separate diagnostic entrypoint without weakening release gates. It reads local provider settings only as redacted presence evidence, invokes the ordinary-chat acceptance writer into `ordinary-chat-acceptance/`, writes a wrapper manifest with `releaseEligible=false`, `releaseBlocking=true`, and `releaseGate.status=local-dogfood-only`, and filters evidence refs so raw provider URLs, local paths, secrets, workspace writer refs, and shared-system-input markers cannot enter the local manifest. If `config.local.json` is unavailable, the wrapper blocks before invoking the writer. For local dogfood, it explicitly supplies a BrowserHostSessionManager with Playwright fallback when no native adapter is configured, then closes current BrowserHostSession ids from the produced refs so the CLI exits cleanly.

The current CLI run of that wrapper is a local-only success claim, not a release claim. It reached the ordinary-chat writer and `module.invoke(browser.open_read)`, read `https://developers.openai.com/api/docs/changelog`, and recorded:

- `browser-host-session:.../source-pages/source-1-...source.json`
- `browser-host-session:.../source-pages/source-1-...txt`
- `action-ledger:browser.executeBoundedOperation/.../module.invoke`
- `runtime-truth:module.invoke/browser.open_read/...`
- `artifact:runtime-codex-browser-acceptance/final-answer.md`

The wrapper manifest records `status=passed`, `localConfig.secretValuesRedacted=true`, `ordinaryChatAcceptance.acceptanceConclusionFromRealBrowser=true`, and `releaseGate.status=local-dogfood-only`.

The direct BrowserHostSession `open_read` HTTP path now follows the existing top-level `/api/sciforge/browser-host/search` route shape. `POST /api/sciforge/browser-host/open-read` resolves the workspace through the route options, accepts only `url`, `sessionId`, `title`, and `timeoutMs`, calls `manager.openRead()`, and returns `{ ok, workspacePath, openRead }`. The returned `openRead.sourcePage` stays refs-first and bounded; full page text remains materialized behind `browser-host-session:<sessionId>/source-pages/*.txt`. Workspace writer health now advertises `browser-host-open-read` and `browserHostOpenRead: /api/sciforge/browser-host/open-read`.

The release smoke now keeps `runtimeBridgeBlockedReason()` as the fail-close service-env/provider gate. The gate requires service-env Runtime Codex credentials/upstream and a current provider preflight manifest with `category=ready`; fake env values alone now remain blocked as preflight-only evidence. When that gate passes and `SCIFORGE_BROWSER_ACCEPTANCE_VALIDATE_ONLY` is not set, the smoke invokes the ordinary-chat writer, enriches its manifest with bounded port/workspace/provider metadata and negative checks, then validates it with the ordinary-chat Browser source-evidence assertion. `SCIFORGE_BROWSER_ACCEPTANCE_VALIDATE_ONLY=1` still validates an existing manifest only.

A focused producer-branch test now uses a `NODE_ENV=test` + explicit writer-fixture hook to force ready preflight and prove the release smoke enrichment path produces bounded metadata without raw loopback URLs, absolute paths, or secrets. The hook is not active outside tests; normal smoke still requires the real writer and provider preflight gate.

This is still not full T2 completion in this environment: `npm run smoke:runtime-codex-browser-acceptance --silent` remains blocked by the service-env Runtime Codex provider policy before the live writer branch can run.
