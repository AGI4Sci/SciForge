# SciForge Browser Product Protocol

Last updated: 2026-06-03

This document is the current design contract for the SciForge right-pane
Browser. Historical TODO lists and completed task logs are intentionally
removed; use Git history and `docs/test-artifacts/**` when old evidence is
needed.

## Product Decision

The Browser product is a Desktop-native capability.

`localhost:5173` is a React development and diagnostic surface. It can render
the Browser UI, show health, and explain why native attach is blocked. It must
not claim that a real webpage is open inside the product Browser.

The Desktop Electron app is the product shell for real browsing. It loads the
same React UI, but it also owns the native window bridge required to embed a
real page through Electron `WebContentsView`.

## Mental Model

```text
Web dev mode
  Browser / Codex in-app Browser
    -> http://localhost:5173
       -> React UI
       -> diagnostics only for external pages

Desktop product mode
  Electron app
    -> React UI
    -> Desktop native surface bridge
    -> Workspace Writer
    -> BrowserHostSession
    -> Electron WebContentsView display/input adapter
       -> real HTTP/HTTPS page
```

## Ownership

- `BrowserHostSession` is the only Browser owner.
- React owns layout, toolbar controls, mount bounds, and typed diagnostics.
- Workspace Writer owns local HTTP routes, session state, refs, and bounded
  proxying to a trusted Desktop native adapter.
- Electron `WebContentsView` is only a display/input adapter. It is not a
  second browser owner.
- Desktop Electron main process owns creation, placement, resize, focus, and
  lifecycle of native embedded surfaces.

## Required Live Path

A product-live Browser pane must satisfy all of these:

- `owner=BrowserHostSession`
- `adapterRole=display-input-adapter`
- `liveSurfaceTransport=native-embedded`
- `singleInteractiveTruth=true`
- `secondTruthSource=false`
- Session-scoped `sessionRef` and `liveSurfaceRef`
- Trusted attach/state responses from Desktop native adapter or its Workspace
  Writer route proxy
- User input goes through BrowserHostSession actions, not host shell capture

If any item is missing, the Browser pane must render a typed blocked,
handoff, or retry state.

## Forbidden Product Fallbacks

These may exist only as migration diagnostics, test fixtures, or explicit
external handoff. They must not be used as the product live Browser surface:

- iframe
- HTTP proxy page rendering
- screenshot or snapshot replay
- canvas stream
- WebRTC stream
- HTTP `/frame` or frame-stream transport
- `<webview>`
- system popup or external browser as a claimed embedded pass
- site-specific or URL-specific patches

## Development Modes

### Web Dev Mode

Entry: `npm run dev`, then open `http://localhost:5173`.

Use this mode for:

- React layout
- toolbar behavior
- address bar state
- loading, blocked, retry, and handoff copy
- Workspace Writer health diagnostics
- command text and refs projection

Do not use this mode to claim:

- real external webpage attach
- click/type/scroll fidelity
- native focus/caret/cursor behavior
- M0/M1 Browser pass

When Web dev mode lacks a Desktop native adapter, the correct state is
`native-surface-adapter-missing` or an equivalent typed blocked diagnostic.

### Desktop Product Mode

Entry: `npm run desktop:start:prod`.

Use this mode for:

- real external HTTP/HTTPS navigation
- real click/type/scroll/reload/back/forward/stop
- native surface attach and resize
- BrowserHostSession input latency
- focus, cursor, caret, and OS UI parity
- pass-grade Browser evidence

### Desired Desktop Dev Mode

The intended developer experience is a dedicated Desktop dev shell:

```text
desktop dev shell
  starts Vite
  starts Workspace Writer
  starts Electron
  Electron loads the Vite URL
  Electron injects the native Browser adapter URL into Workspace Writer
```

This keeps React hot reload while preserving the real native Browser path.
Until this mode exists, use Web dev mode for UI-only work and Desktop product
mode for real Browser verification.

## Workspace Writer Contract

Workspace Writer `/health` may advertise `browser-host-native-surface` only
when a trusted loopback Desktop adapter is configured by
`SCIFORGE_BROWSER_HOST_NATIVE_ADAPTER_URL`.

The public route
`/api/sciforge/browser-host/native-surface/{health,attach,state}` may proxy the
Desktop adapter only if the bounded response passes the BrowserHostSession
trust checks. Raw URLs, raw DOM, raw logs, screenshots, base64, provider
payloads, secrets, or forged refs must be blocked.

## Evidence Rules

Pass-grade Browser evidence records only bounded facts:

- session refs
- live surface refs
- transport and surface type
- capability health
- action coverage
- latency summaries
- hashes, lengths, counts, and refs

It must not record:

- raw DOM
- raw console or network logs
- raw screenshot or base64
- raw page content
- provider payloads
- secrets
- full private URLs

## Current Status

- Desktop Electron native live acceptance has passed for the M0 Browser path.
- Web dev mode correctly fails closed when no Desktop native adapter is
  present.
- Workspace Writer native-surface routes exist and must stay bounded.
- M1 real OS UI parity remains separate from M0 browsing and requires Desktop
  observation, not Web dev mode.

## Next Design Work

1. Add a first-class Desktop dev shell that loads the Vite renderer while
   injecting Desktop native adapter capability into Workspace Writer.
2. Keep Web dev mode diagnostics explicit so users do not mistake 5173 for the
   product Browser host.
3. Continue M1 work only in Desktop product/dev mode: cursor, caret, context
   menu, IME, clipboard, selection, rerender, resize, and focus retention.
4. Keep all Browser evidence bounded and refs-first.

## Verification

For Browser UI or model changes:

```bash
npm run typecheck --silent
node --import tsx --test packages/presentation/components/browser-workbench/render.test.tsx src/ui/src/app/results/browserPaneModel.test.ts src/ui/src/app/results/browserPaneHostAdapter.test.ts src/ui/src/api/workspaceClient.browser-host-preflight.test.ts
node --import tsx --test src/runtime/browser-host-session.test.ts src/runtime/browser-host-search-runtime.test.ts
git diff --check
```

For native Browser product changes:

```bash
npm run smoke:desktop-browser-native-live-acceptance --silent
npm run smoke:desktop-browser-native-live-acceptance:strict --silent
npm run smoke:browser-bounded-evidence-crosscheck --silent
```

For Web dev diagnostics:

```bash
npm run dev
curl -sS -X POST http://127.0.0.1:5173/api/sciforge/runtime/start \
  -H 'Content-Type: application/json' \
  -d '{"requireBrowserHostNativeSurface":true}'
```

The expected Web dev result without Desktop native adapter is a typed blocked
diagnostic, not a claimed live Browser pass.
