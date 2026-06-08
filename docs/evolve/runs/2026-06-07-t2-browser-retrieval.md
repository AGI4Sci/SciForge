# T2 Browser Retrieval Run - 2026-06-07

Superseded scope note: this run log preserves the names and evidence shape used during the 2026-06-07 T2 diagnostic work. References to `browser.search_read`, `browser.open_read`, `browser.open`, or browser `executeBoundedOperation` are historical trace labels only. They are not current Browser public/product surface, compatibility aliases, or product acceptance criteria. Current task-facing Browser access is the six primitive surface: `browser.search`, `browser.navigate`, `browser.observe`, `browser.read`, `browser.extract`, and `browser.download`, with `resources` / `evidenceState` / refs-first evidence.

## Result

- Local dogfood: passed.
- Release strict acceptance: passed with current Model Router / provider readiness.
- Desktop Browser product-live: passed.
- Release validator hardening: passed as a unit/smoke contract update.
- Ordinary-chat acceptance writer: passed unit contract and live release smoke; it now uses a Browser-owned Playwright fallback when no native adapter is configured, closes owned BrowserHostSession ids after evidence capture, and preserves native-adapter mode when `SCIFORGE_BROWSER_HOST_NATIVE_ADAPTER_URL` is present.
- Ordinary-chat local dogfood wrapper: passed unit contract and the CLI run captured in this log; at the time it produced historical `browser.open_read` module.invoke evidence plus BrowserHostSession source-page/page-text refs while remaining explicitly local-only / not release-eligible.
- BrowserHostSession `open_read` HTTP route: fixed as a historical adapter route. The manager already materialized refs; the workspace writer was missing the top-level `/api/sciforge/browser-host/open-read` route, so HTTP callers could not reach the source-page/page-text materialization path. This route is no longer the current product surface.

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
node --import tsx --test src/runtime/browser-host-session.test.ts src/runtime/workspace-server-health.test.ts --test-name-pattern 'HTTP routes expose|pageRead|workspace writer health helper'
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

The release smoke no longer remains blocked in this environment when Model Router is started first and Runtime Codex points at `http://127.0.0.1:<router>/v1` with model `sciforge-router`. `.sciforge/run-with-runtime-env.mjs` may read ignored local config without printing secrets, but only to populate Router member-model env; it must not configure Runtime Codex to a raw upstream provider. Provider preflight remains diagnostic-only, but the live browser acceptance now produces a passed release-shaped manifest from current BrowserHostSession source refs.

At that time, the release validator was hardened to reject a default-chat/native answer that lacked current-run Browser source evidence. A passed historical `sciforge.runtime-codex.browser-acceptance.v1` manifest had to prove:

- Browser came through historical `module.invoke(executeBoundedOperation)` evidence.
- The historical operation was `browser.search_read` or `browser.open_read`.
- Evidence includes a `BrowserHostSession` ref.
- Evidence includes current-run source-page refs and page-text refs.
- Evidence includes final-answer refs.

This closes the acceptance loophole where a visible Runtime Codex answer could look successful without proving it actually used SciForge BrowserHostSession source/page text evidence.

The ordinary-chat acceptance writer described here existed as a narrow runtime helper for the historical combined-operation path. It called the Agent Host ordinary chat turn loop and, by default, wrapped the real Browser bounded-operation module handler with `{ workspacePath }`, so production runs used `BrowserHostSessionManager.search/pageRead` instead of a fake invoker. Tests could still inject bounded Browser ports. At that time the writer required historical `browser.search_read/open_read` results to return current `BrowserHostSession` source-page and page-text refs, verified those refs mapped to non-empty files under `.sciforge/browser-host/sessions/<id>/source-pages/`, parsed each `.source.json`, required `status: "read"`, a non-empty `finalUrl`, a paired current-run `.txt` `textRef`, and non-empty page text, wrote `final-answer.md`, and wrote a release-shaped `sciforge.runtime-codex.browser-acceptance.v1` manifest only when the current run was complete. If the referenced source files were missing or source metadata was invalid, it wrote a blocked manifest instead. Current product acceptance must be expressed through Browser primitive evidence, `resources`, `evidenceState`, source/page-text refs, and user-level final answer.

Follow-up T2 root-cause check: historical `BrowserHostSession.open_read` was not the source/page-text ref blocker. The live release run at that point reached `module.invoke(browser.open_read)`, called the BrowserHostSession manager with the official OpenAI API changelog URL, and materialized both refs under the smoke workspace.

The latest strict release run recorded:

- `runtime-truth:module.invoke/browser.open_read/codex-command-browser-ordinary-chat-mq334kzs`
- `browser-host-session:browser-host-180cf7dd662c/source-pages/source-1-f9c4b4d7a3.source.json`
- `browser-host-session:browser-host-180cf7dd662c/source-pages/source-1-f9c4b4d7a3.txt`
- `artifact:runtime-codex-browser-acceptance/final-answer.md`

The source metadata records `status="read"` and `finalUrl="https://developers.openai.com/api/docs/changelog"`. The page text evidence summarizes the OpenAI API changelog and includes current entries such as `omni-moderation-latest`, deprecations, container billing, and OpenAI models on Amazon Bedrock.

The ordinary-chat local dogfood wrapper now gives `config.local.json` users a separate diagnostic entrypoint without weakening release gates. It reads local provider settings only as Router member-model env / redacted presence evidence, invokes the ordinary-chat acceptance writer into `ordinary-chat-acceptance/`, writes a wrapper manifest with `releaseEligible=false`, `releaseBlocking=true`, and `releaseGate.status=local-dogfood-only`, and filters evidence refs so raw provider URLs, local paths, secrets, workspace writer refs, and shared-system-input markers cannot enter the local manifest. If `config.local.json` is unavailable, the wrapper blocks before invoking the writer. For local dogfood, it explicitly supplies a BrowserHostSessionManager with Playwright fallback when no native adapter is configured, then closes current BrowserHostSession ids from the produced refs so the CLI exits cleanly.

The CLI run of that wrapper was a local-only success claim, not a release claim. It reached the ordinary-chat writer and historical `module.invoke(browser.open_read)`, read `https://developers.openai.com/api/docs/changelog`, and recorded:

- `browser-host-session:.../source-pages/source-1-...source.json`
- `browser-host-session:.../source-pages/source-1-...txt`
- `action-ledger:browser.executeBoundedOperation/.../module.invoke`
- `runtime-truth:module.invoke/browser.open_read/...`
- `artifact:runtime-codex-browser-acceptance/final-answer.md`

The wrapper manifest records `status=passed`, `localConfig.secretValuesRedacted=true`, `ordinaryChatAcceptance.acceptanceConclusionFromRealBrowser=true`, and `releaseGate.status=local-dogfood-only`.

Superseded note: the direct BrowserHostSession `open_read` HTTP path described in this run log has been removed from the public task surface. Current task-facing browser access goes through `packages/actions/browser-runtime` primitives (`browser.search`, `browser.navigate`, `browser.observe`, `browser.read`, `browser.extract`, `browser.download`), while BrowserHostSession remains only the host-owned live browser implementation behind those primitives.

The release smoke now keeps `runtimeBridgeBlockedReason()` as the fail-close service-env/provider gate. The gate requires a running Model Router, Runtime Codex configured to `http://127.0.0.1:<router>/v1` with model `sciforge-router`, and a current provider preflight manifest with `category=ready`; fake env values alone remain blocked as preflight-only evidence. When that gate passes and `SCIFORGE_BROWSER_ACCEPTANCE_VALIDATE_ONLY` is not set, the smoke invokes the ordinary-chat writer, enriches its manifest with bounded port/workspace/provider metadata and negative checks, then validates it with the ordinary-chat Browser source-evidence assertion. `SCIFORGE_BROWSER_ACCEPTANCE_VALIDATE_ONLY=1` still validates an existing manifest only.

A focused producer-branch test at that time used a `NODE_ENV=test` + explicit writer-fixture hook to force ready preflight and prove the release smoke enrichment path produced bounded metadata without raw loopback URLs, absolute paths, or secrets. The historical fixture also required the official OpenAI changelog prompt and emitted `browser.open_read` refs so the old release producer could not regress to broad search-result evidence. The hook was not active outside tests; normal smoke still required the real writer and provider preflight gate.

T2 is release-proven for the current ordinary-chat Browser retrieval task. Remaining work moves to T1 Desktop Software Task unless future T2 hardening discovers a new gap.
