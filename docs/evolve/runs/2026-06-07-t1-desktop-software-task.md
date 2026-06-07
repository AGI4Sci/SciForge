# T1 Desktop Software Task Run - 2026-06-07

## Result

- Desktop Computer Use hard-confirm product smoke: passed.
- Desktop file dogfood: passed as `workspace-file-writer-assisted` local evidence.
- CU-NEXT-08 desktop local document save acceptance mapping: passed unit / smoke validation.
- Appium/TextEdit live acceptance runner contracts: passed fixture / fail-closed validation.
- Computer Use chat live product-strict smoke: blocked.
- T1 real desktop software file task: blocked.
- Product-strict T1 task binding now targets `CU-NEXT-08` / `CU-LONG-005`.
- TextEdit/Appium pass claims now require a generic desktop software task evidence gate.

## Commands

```bash
npm run smoke:desktop-computer-use-hard-confirm-product:strict --silent
npm run smoke:desktop-computer-use-file-dogfood --silent
npm run smoke:desktop-computer-use-file-dogfood:test --silent
npm run smoke:computer-use-chat-live-e2e:product-strict --silent
npm run smoke:cu-next-live-acceptance --silent
npm run smoke:cu-next-runner --silent
npm run smoke:cu-next-readiness --silent
node --import tsx tests/smoke/smoke-real-task-matrix.ts
npm run smoke:computer-use-chat-live-preflight --silent
npm run smoke:runtime-provider-preflight --silent
node --import tsx --test tests/smoke/computer-use-chat-live-preflight.test.ts
node --import tsx --test src/ui/src/api/workspaceClient.feedback.test.ts
npx tsc --noEmit --pretty false
npm run desktop:dev:prepare --silent
SCIFORGE_VISION_INPUT_ADAPTER=remote-desktop \
SCIFORGE_VISION_INDEPENDENT_INPUT_ADAPTER_PROVIDER=sciforge-simulated-remote-desktop \
  npm run smoke:computer-use-chat-live-e2e:product-strict --silent
node --import tsx --test src/runtime/window-action-session.test.ts
node --import tsx --test src/runtime/codex/agent-host-window-action-computer-use-act-materializer.test.ts
node --import tsx --test src/runtime/codex/appium-mac2-window-action-adapter.test.ts
node --import tsx --test src/runtime/codex/appium-mac2-webdriver-client.test.ts
node --import tsx --test src/runtime/codex/textedit-saved-artifact-validator.test.ts
node --import tsx --test tests/smoke/textedit-appium-live-acceptance-runner.test.ts
node --import tsx --test src/runtime/codex/appium-textedit-live-acceptance.test.ts
node --import tsx --test tests/smoke/textedit-appium-live-acceptance-runner.test.ts src/runtime/codex/appium-textedit-live-acceptance.test.ts src/runtime/codex/appium-mac2-window-action-adapter.test.ts src/runtime/codex/appium-mac2-webdriver-client.test.ts src/runtime/codex/textedit-saved-artifact-validator.test.ts
node --import tsx --test --test-name-pattern 'product-strict CLI uses ordinary Desktop chat prompt|product-strict script targets the T1 Desktop local document save task|routes ordinary chat through host-owned Computer Use intent|projects task bindings' tests/smoke/computer-use-chat-live-e2e.test.ts
node --import tsx --test src/runtime/desktop/runtime-launcher.test.ts
```

## Evidence

- Hard-confirm product manifest: `docs/test-artifacts/desktop-computer-use-hard-confirm-product/manifest.json`
- Desktop file dogfood manifest: `docs/evolve/runs/desktop-computer-use-file-dogfood/manifest.json`
- Desktop file dogfood final answer: `docs/evolve/runs/desktop-computer-use-file-dogfood/final-answer.md`
- Desktop file artifact: `sciforge-computer-use-proof.txt`
- Chat live product-strict manifest: `docs/test-artifacts/computer-use-chat-live-e2e/product-strict-manifest.json`
- Chat live preflight manifest: `docs/test-artifacts/computer-use-chat-live-preflight/manifest.json`
- CU-NEXT-08 task map: `packages/actions/computer-use/task-map.ts`, `tools/computer-use-next/task-map.json`, `tests/computer-use-next/task-map.json`
- WebDriver-level TextEdit live runner: `tools/textedit-appium-live-acceptance.ts`
- Runtime scoped TextEdit live runner: `tools/appium-textedit-live-acceptance.ts`
- Desktop software task evidence gate: `src/runtime/codex/desktop-software-task-evidence.ts`

## Current Blockers

- Full T1 is still not claimable because no ordinary Desktop chat run produced a current-run live acceptance bundle for the requested real software file workflow.
- The local desktop file dogfood intentionally does not claim strict TextEdit creation. Its default executor writes the workspace file, opens it in TextEdit for visible inspection, records `fileCreationOwner=workspace-file-writer-assisted`, and leaves `releaseGate.status=local-dogfood-only`.
- Live acceptance now has a dedicated Evolve T1 local document save task, `CU-NEXT-08`, and a `desktop-file-save` semantic marker that rejects `workspace-file-writer-assisted`, shell / direct writes, and shared system input. This closes the acceptance-gate gap, not the product executor gap.
- A first `WindowActionSession` Appium Mac2 seam now exists for TextEdit/editor `type` and `save`: routing can select `appium-mac2` only when explicitly enabled for the target session, and missing Mac2 readiness fails closed with `appium-mac2:*` evidence instead of falling back to shared system input.
- A concrete injected-client Appium Mac2 adapter contract now exists. It allows only loopback Appium server URLs, binds to `bundleId: com.apple.TextEdit`, supports only bounded TextEdit `type` / `save` in this slice, and requires executor event, input event, after evidence, freshness invalidation, and save artifact-validator refs.
- A minimal production Appium Mac2 WebDriver client now exists for TextEdit. It uses built-in fetch against a loopback-only Appium endpoint, creates a Mac2 session for `com.apple.TextEdit`, sends bounded W3C keyboard actions, reads post-action source evidence, deletes the session, and returns only bounded executor/input/verification/after/freshness refs. It refuses non-loopback URLs, credentials, non-TextEdit bundles, WebDriver failures, and `save` without an artifact validator.
- The default WindowActionSession materializer now creates that WebDriver client when `SCIFORGE_WINDOW_ACTION_APPIUM_MAC2=1`, `SCIFORGE_APPIUM_MAC2_EXECUTOR=1`, and `SCIFORGE_APPIUM_MAC2_SERVER_URL` are set, so TextEdit `type` can execute through the real client without a test-injected client. TextEdit `save` can also use the default client when `SCIFORGE_TEXTEDIT_SAVE_ARTIFACT_PATH` points at the exact expected saved file; the validator requires a real nonempty file and exact normalized content match against TextEdit AX source, returning only `artifact-validator/content-match` evidence.
- Two opt-in live runner entrypoints now exist and fail closed without a live Appium/TextEdit environment:
  - `tools/textedit-appium-live-acceptance.ts` exercises the WebDriver client directly, requires `SCIFORGE_APPIUM_MAC2_SERVER_URL`, `SCIFORGE_APPIUM_MAC2_EXECUTOR=1`, and `SCIFORGE_TEXTEDIT_SAVE_ARTIFACT_PATH`, and records only bounded Appium/action/artifact-validator refs.
  - `tools/appium-textedit-live-acceptance.ts` exercises the `WindowActionSession` scoped executor chain, requires `SCIFORGE_T1_APPIUM_TEXTEDIT_LIVE=1`, `SCIFORGE_APPIUM_MAC2_SERVER_URL`, and `SCIFORGE_T1_TEXTEDIT_ARTIFACT_PATH`, and marks `passClaim=false` unless both `type` and `save` complete and artifact content verification passes.
- Desktop launcher now projects only the two non-secret Computer Use input adapter fields from ignored local config into packaged sidecars:
  - `SCIFORGE_VISION_INPUT_ADAPTER`
  - `SCIFORGE_VISION_INDEPENDENT_INPUT_ADAPTER_PROVIDER`
- Product-strict input-path blockers disappear when those non-secret input adapter env values are present: the strict smoke drops from seven issues to three (`live-preflight-not-ready`, `runtime-provider-preflight-blocked`, `runtime-provider:category:provider-auth`). Desktop launcher now provides the same non-secret bridge for packaged sidecars from ignored local config; shared-system-input opt-ins, provider URLs, and secrets are intentionally not projected.
- Runtime provider preflight still reports `provider-auth`, so the ordinary chat live E2E does not submit a request. The chat live preflight manifest now preserves the non-secret distinction: healthz is `ready`, but inference is `provider-auth` with HTTP 403.
- Product-strict now uses the actual Evolve T1 file-save binding (`CU-NEXT-08` / `CU-LONG-005`) instead of the older briefing task binding. Its default ordinary Desktop chat prompt explicitly names `sciforge-computer-use-proof`, requires a TextEdit/document save through the target desktop app, and requires target-window, before/after evidence, executor event, artifact validation, and final-answer refs.

## Code Progress

Host-owned Computer Use runtime intents can now route ordinary chat text through the native package bridge without requiring a `/computer-use` slash command. This preserves the GUI slash text behavior while allowing host-owned product intent to use the native route.

The T1 acceptance path now has a dedicated `CU-NEXT-08` task:

- `Desktop local document save`, bound to `CU-LONG-005` and `TextEdit`.
- `desktop-file-save` live acceptance marker with before / after screenshot refs, before / after AX refs, target window ref, GUI save command ref, executor event ref, final artifact ref, and artifact validation ref.
- Causality checks that require `fileCreationOwner=scoped-gui-save` or `native-gui-save`.
- Rejection of `workspace-file-writer-assisted`, shared system input, and shell / direct artifact writes.
- Product smoke matrix `real-artifact-save` now maps to `CU-NEXT-08`.

The chat live preflight now imports the workspace runtime provider `checkedInference` summary with only `category`, `ok`, `httpStatus`, and `retryable`, matching the existing non-secret `checkedHealthz` shape. This makes provider-auth blockers actionable without printing provider keys, raw base URLs, or raw upstream responses.

The provider diagnostic path was also hardened so runtime provider categories are whitelist-normalized before entering chat-live manifests. Unknown or malformed category strings become `unknown`; they are not copied verbatim into evidence. Runtime provider preflight, Browser acceptance fallback, workspace feedback API tests, UI loader tests, and chat-live fixture tests now preserve `checkedInference` instead of regressing to healthz-only evidence.

`WindowActionSession` can now route TextEdit/editor `type` and `save` actions to an `appium-mac2` scoped adapter when explicitly enabled for the target session. The default materializer blocks with a non-secret `appium-mac2:*` evidence ref if `SCIFORGE_APPIUM_MAC2_SERVER_URL` is absent. When `SCIFORGE_APPIUM_MAC2_EXECUTOR=1`, TextEdit `type` can use the default Appium WebDriver client and complete with current-action executor/input/verification/after/freshness refs. TextEdit `save` can complete through the default client only when `SCIFORGE_TEXTEDIT_SAVE_ARTIFACT_PATH` creates a TextEdit saved-artifact validator; mismatched or missing files fail closed without leaking raw path or text.

The Appium Mac2 adapter still keeps the executor bounded: no raw text, raw source XML, loopback URL, or secret is returned as evidence. The WebDriver client constructs session/action/source/delete requests but live GUI mutation on this host has not been run as release evidence.

The new live runners preserve the same boundary: tests prove blocked manifests when readiness is absent, pass manifests through fixture Appium clients, and manifest sanitization rejects raw loopback URLs, `/tmp` paths, file names, workspace writer markers, shared system input, `osascript`, `CGEvent`, `base64`, and secret/token-looking strings. These runner contracts close another acceptance gap, but they do not replace a current ordinary Desktop chat run against a real TextEdit window.

The TextEdit/Appium runners now use a generic `sciforge.desktop-software-task-evidence.v1` gate before any pass claim. The gate requires bounded slots for target window, before evidence, action grounding, executor event, after evidence, artifact, artifact validation, final answer, and a `scoped-gui-save` / `native-gui-save` owner. Shared system input, workspace writer ownership, shell/direct writers, raw paths, loopback URLs, base64, and secret-looking refs fail closed. This is an acceptance hardening step only; fixture Appium runs still do not become real ordinary Desktop chat completion evidence.

Desktop runtime launcher now copies non-secret local Computer Use input adapter config into packaged sidecars. It allowlists adapter IDs such as `remote-desktop`, `virtual-hid`, and `window-action-session`, allows provider IDs as local identifiers only, and refuses URL / secret / shared-system-looking values. It does not hydrate provider secrets or `SCIFORGE_VISION_ALLOW_SHARED_SYSTEM_INPUT`.

The real-task matrix now covers all active `CU-NEXT` task-map entries through `CU-NEXT-08`. Because current `PROJECT.md` is a principles / bounded-operation document rather than the old CU task board, the matrix validates task-map coverage and the PROJECT checkmark policy instead of requiring a legacy board section.

The hard-confirm product smoke now asserts the current product path:

- Electron product shell.
- Dynamic Workspace Writer.
- `sciforgeDesktop` native host.
- Runtime Codex SSE.
- Host-owned Computer Use native package bridge.
- Guard / preflight blocked surface.
- High-risk `needs-confirmation` surface with Confirm / Cancel controls.

The smoke no longer requires `event: agent_host_turn_loop`, because the current product path routes Computer Use through app-server/native package bridge events. The desktop build manifest loader also now resolves package manifests from both source and `dist-desktop` layouts, fixing the product run failure where `dist-desktop/src/packages/actions/computer-use/action-provider.manifest.json` was incorrectly expected.

## Current Conclusion

T1 is not yet claimable as a completed real desktop software task. The safety / hard-confirm product surface is now proved, and the dedicated T1 acceptance gate now exists, but the remaining work is wiring a real target-bound desktop executor path that can create and verify the requested file through ordinary Desktop chat and produce a current-run live acceptance bundle without fixture, package-diagnostic, shared system input, or stale evidence promotion.

The current local file dogfood is useful as a refs-first artifact prototype only: it proves the workspace file, TextEdit visibility, before / after screenshots, AX evidence refs, action grounding, executor event, validation ref, and final answer shape, while explicitly preserving the blocker that strict T1 still requires real scoped desktop creation / save evidence.

## Verification Notes

Passed after the `CU-NEXT-08` / `checkedInference` sync:

- `node --import tsx --test tests/smoke/computer-use-chat-live-preflight.test.ts`
- `npm run smoke:runtime-provider-preflight --silent`
- `node --import tsx tests/smoke/smoke-real-task-matrix.ts`
- `npm run smoke:cu-next-live-acceptance --silent`
- `node --import tsx --test src/ui/src/api/workspaceClient.feedback.test.ts`
- `npx tsc --noEmit --pretty false`
- `npm run smoke:cu-next-runner --silent`
- `node --import tsx --test src/runtime/window-action-session.test.ts`
- `node --import tsx --test src/runtime/codex/agent-host-window-action-computer-use-act-materializer.test.ts`
- `node --import tsx --test src/runtime/codex/appium-mac2-window-action-adapter.test.ts`
- `node --import tsx --test src/runtime/codex/appium-mac2-webdriver-client.test.ts`
- `node --import tsx --test src/runtime/codex/textedit-saved-artifact-validator.test.ts`
- `node --import tsx --test tests/smoke/textedit-appium-live-acceptance-runner.test.ts src/runtime/codex/appium-textedit-live-acceptance.test.ts src/runtime/codex/appium-mac2-window-action-adapter.test.ts src/runtime/codex/appium-mac2-webdriver-client.test.ts src/runtime/codex/textedit-saved-artifact-validator.test.ts`
- `node --import tsx --test src/runtime/desktop/runtime-launcher.test.ts`
- `git diff --check`

Current expected / residual blockers:

- `npm run smoke:computer-use-chat-live-preflight --silent` still writes a blocked manifest in direct CLI runs: missing `SCIFORGE_VISION_INPUT_ADAPTER`, missing `SCIFORGE_VISION_INDEPENDENT_INPUT_ADAPTER_PROVIDER`, and runtime provider `checkedInference.category=provider-auth` with HTTP 403. The missing input env is expected outside Desktop launcher/service-env.
- `npm run smoke:computer-use-chat-live-e2e:product-strict --silent` exits blocked before submit with seven issues in direct CLI runs.
- With `SCIFORGE_VISION_INPUT_ADAPTER=remote-desktop` and `SCIFORGE_VISION_INDEPENDENT_INPUT_ADAPTER_PROVIDER=sciforge-simulated-remote-desktop`, `npm run smoke:computer-use-chat-live-e2e:product-strict --silent` exits blocked before submit with three remaining issues: `live-preflight-not-ready`, `runtime-provider-preflight-blocked`, and `runtime-provider:category:provider-auth`.
- After the T1 binding correction, direct CLI product-strict still exits blocked before submit. With explicit input-adapter env, no missing-env or input-isolation blockers remain; this environment currently leaves `live-preflight-not-ready`, `service:runtime-codex`, and `service:provider-proxy`.
- The broader historical fixture suites `tests/smoke/computer-use-chat-live-e2e.test.ts` and `tests/smoke/computer-use-chat-live-complex-matrix.test.ts` still have unrelated expectation drift around diagnostic/product-path classification; they were not used as completion evidence for T1.
