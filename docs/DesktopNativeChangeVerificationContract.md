# Desktop Native Change Verification Contract

Last updated: 2026-06-04

This contract covers every Desktop native Browser, Annotation, Image / Evidence capture, and Window Action native path change. A pass claim must prove the Desktop app native path and cannot be satisfied by a web screenshot, Vite screenshot, Playwright page screenshot, iframe, proxy, snapshot, frame-stream, external browser, raw screenshot, or base64 evidence.

## Required Evidence By Change Type

| Change type | Required Desktop native path evidence | Minimum verification command |
| --- | --- | --- |
| Browser native surface | Electron Desktop app launches a BrowserHostSession-backed `WebContentsView`, uses `native-embedded` transport, opens a configured public external HTTP(S) target, records bounded refs, and writes `docs/test-artifacts/desktop-browser-native-live-acceptance/manifest.json`. | `SCIFORGE_REQUIRE_DESKTOP_BROWSER_NATIVE_LIVE_ACCEPTANCE=1 SCIFORGE_DESKTOP_BROWSER_NATIVE_REAL_EXTERNAL_TARGET_JSON='{"url":"https://example.com/","secondUrl":"https://www.iana.org/domains/example"}' npm run smoke:desktop-browser-native-live-acceptance --silent` |
| Annotation native bridge | Desktop overlay/picker/preload path sanitizes payloads, hides overlay before capture, returns refs-only annotation/image/crop/screenshot metadata, and never exposes raw provider payloads. | `node --import tsx --test tests/smoke/smoke-desktop-annotation-overlay.test.ts tests/smoke/smoke-desktop-screen-region-overlay-bridge.test.ts tests/smoke/smoke-desktop-app-window-picker.test.ts tests/smoke/smoke-desktop-app-window-selection-provider.test.ts` |
| Image / Evidence native capture | Native window/screen capture records refs, dimensions, hash, bounds, scale, overlay exclusion, and bounded diagnostics without raw screenshot or base64 payloads. | `node --import tsx --test tests/smoke/smoke-desktop-window-capture.test.ts tests/smoke/smoke-desktop-screen-region-auto-binding.test.ts tests/smoke/smoke-desktop-macos-window-inventory.test.ts` |
| Window Action native path | WindowActionSession change records target window/session refs, actorCursor refs, pause/stop/remove behavior, before/after evidence refs, and a scoped adapter path. Annotation may supply context, but must not execute the action itself. | `node --import tsx --test src/runtime/window-action-session.test.ts` |

## Pass Claim Rules

- Desktop native changes must include the focused command above for every touched change type.
- Browser native changes that affect live surface, input, navigation, or native adapter behavior must use the strict command with `SCIFORGE_REQUIRE_DESKTOP_BROWSER_NATIVE_LIVE_ACCEPTANCE=1` and `SCIFORGE_DESKTOP_BROWSER_NATIVE_REAL_EXTERNAL_TARGET_JSON`.
- Web screenshots are diagnostic only. A web screenshot, Vite screenshot, Playwright page screenshot, iframe, proxy, snapshot, frame-stream, external browser, raw screenshot, or base64 payload cannot prove Desktop native Browser, overlay, capture, or Window Action behavior.
- Evidence must be refs-first and bounded: refs, sha256/hash, dimensions, bounds, owner/session ids, diagnostics, and manifest paths are allowed; raw DOM, raw logs, raw screenshots, provider payloads, secrets, and unbounded window lists are not.
- This contract is enforced by `npm run smoke:desktop-native-change-verification-contract` and is included in `npm run verify:fast`.
