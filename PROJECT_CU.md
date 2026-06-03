# SciForge Computer Use Product Protocol

Last updated: 2026-06-03

This document is the current design contract for Computer Use and
VirtualAppScreen. Historical task logs are intentionally removed; use Git
history, smoke manifests, and `docs/test-artifacts/**` for old evidence.

## Product Decision

VirtualAppScreen is a Native Host capability.

`localhost:5173` is a React development and diagnostic surface. It can render
the Screen pane, show refs, expose commands, and explain blocked/handoff
states. It cannot create an isolated app session, own a native surface, route
real human input safely, or prove that input did not hit the user's physical
desktop.

The product path must run through the package-owned Computer Use Native Host
and a platform provider.

## Mental Model

```text
Web dev mode
  Browser / Codex in-app Browser
    -> http://localhost:5173
       -> React Screen pane
       -> diagnostics, commands, refs, blocked/handoff states

Native product mode
  Desktop app or native-capable runtime
    -> React Screen pane
    -> Workspace Writer / runtime
    -> VirtualAppScreen Native Host
    -> platform provider
       -> real app session
       -> host-owned surface/frame/input/ledger refs
```

## Ownership

- React owns UI layout, controls, visible state, and command projection.
- Workspace Writer/runtime owns local orchestration, artifacts, refs, and
  dispatch into Computer Use contracts.
- `packages/actions/computer-use/virtual-app-screen-host` owns the product
  Host API, session lifecycle, surface refs, frame refs, input acceptance,
  control barriers, and ledger validation.
- Platform providers own OS-specific attach, frame capture, isolated input,
  permissions, and readiness evidence.
- Desktop app owns presentation and bridging. It does not become the source of
  truth for the VirtualAppScreen session.

## Required Live Path

A product-live VirtualAppScreen must satisfy all of these:

- Host-owned `sessionRef`
- Host-owned `liveSurfaceRef`
- Host-owned `frameStreamRef` or `currentFrameRef`
- validated grant or attach proof
- platform readiness and permission readiness
- `diagnosticOnly=false`
- user input accepted through Host `sendHumanInput`
- input evidence proves it targets the app session, not the user's physical
  desktop
- ledger can replay create, app launch, surface attach, grant validation,
  frame read, human input, pause/resume, and close where applicable

If any item is missing, the Screen pane must render a typed blocked, handoff,
permission, replay, fallback, or retry state. It must not render pseudo-live.

## Forbidden Product Fallbacks

These may exist only as diagnostics, compatibility experiments, or explicit
fallback adapters. They must not be used as product live proof:

- noVNC, VNC, xpra, Xvfb, MJPEG, PNG delta, WebRTC, WebCodecs, Playwright, or
  Electron as a claimed product owner
- fixture refs
- replay-only refs
- provider lifecycle refs without Host-owned session and surface proof
- screenshots pretending to be live control
- user physical desktop input
- raw payload evidence
- app-specific shortcuts that bypass the Host API

## Development Modes

### Web Dev Mode

Entry: `npm run dev`, then open `http://localhost:5173`.

Use this mode for:

- Screen pane layout
- blocked, handoff, permission, replay, fallback, and live state rendering
- command text generation
- ref projection
- artifact inspection
- Workspace Writer/runtime route diagnostics

Do not use this mode to claim:

- a real virtual screen session
- isolated app launch
- real frame stream quality
- real click/type/scroll safety
- physical-desktop isolation
- takeover/pause/resume correctness

### Native Product Mode

Use this mode for:

- app launch/attach/readFrame
- real Host session and surface identity
- isolated human input
- pause, resume, takeover, and closeSession
- stream quality
- platform permission and driver readiness
- pass-grade dogfood and user acceptance

On macOS, current real-pass evidence is centered on Native Host + platform
provider runs for app profiles such as VS Code, Word, and PowerPoint. Linux and
Windows real provider pass remain gated by their platform conditions and must
not be inferred from macOS evidence.

### Desired Desktop Dev Mode

The intended developer experience is a Desktop dev shell:

```text
desktop dev shell
  starts Vite
  starts Workspace Writer/runtime
  starts Electron/Desktop shell
  connects React UI to Native Host capabilities
  keeps hot reload for UI-only edits
  verifies real Screen behavior in the native product path
```

Until this mode is first-class, use Web dev mode for UI-only work and native
product/opt-in smoke runs for real VirtualAppScreen behavior.

## State Model

Screen state must be mutually exclusive and explainable:

- `permission`: platform or user authorization is missing
- `blocked`: driver, provider, Host, session, or identity requirements failed
- `handoff`: a human or platform action is required before retry
- `live`: Host-owned session and live surface are validated
- `replay`: bounded evidence is available, but no live control is claimed
- `fallback`: degraded stream or diagnostic view is explicitly marked
- `empty`: no current Host session or replay evidence exists

React may display these states, but it does not decide that a session is live
without Host/provider evidence.

## Evidence Rules

Pass-grade Computer Use evidence records only bounded facts:

- Host session refs
- surface and frame refs
- current-run pointer refs
- permission/readiness refs
- ledger refs and event names
- provider isolation refs
- latency/framerate/reconnect summaries
- counts, hashes, lengths, and refs

It must not record:

- raw screenshots or base64
- raw app payloads
- raw clipboard or IME contents
- raw user text
- raw provider data
- secrets
- unbounded OS or accessibility dumps

## Current Status

- The product design is Native Host first.
- macOS real Host evidence exists for the minimal VirtualAppScreen loop.
- VS Code, Word, and PowerPoint profiles use the same Host API contract rather
  than app-specific product shortcuts.
- Web dev mode remains useful for UI and diagnostic work but is not a product
  proof environment.
- Linux and Windows real provider passes remain deferred and fail closed by
  design until their platform requirements are available.

## Next Design Work

1. Add a first-class Desktop dev shell so UI hot reload and native product
   verification share one workflow.
2. Keep Web dev mode honest: it may show blocked/handoff diagnostics, but not
   product pass claims.
3. Continue improving real Native Host evidence for app profiles through the
   same Host API.
4. Keep platform-specific logic inside provider adapters, never in product UI.
5. Keep all Computer Use evidence bounded and refs-first.

## Verification

For UI/model changes:

```bash
npm run typecheck --silent
node --import tsx --test src/ui/src/app/results/screenPaneModel.test.ts src/ui/src/app/results/screenPaneHostAdapter.test.ts packages/presentation/components/virtual-screen-viewer/render.test.tsx
git diff --check
```

For Native Host contract changes:

```bash
npm run smoke:virtual-app-screen-native-host --silent
npm run smoke:native-extension-ownership --silent
```

For viewer/runtime dogfood:

```bash
npm run smoke:computer-use-viewer --silent
npm run smoke:virtual-app-screen-dogfood-product --silent
```

For real app/provider changes:

```bash
node --import tsx --test src/runtime/computer-use/native-providers/macos-virtual-display-driver.test.ts
node --import tsx --test src/runtime/computer-use/native-providers/macos-ax-input-control-hook.test.ts
```

Real provider opt-in smokes must remain explicit. If platform permissions,
drivers, or app availability are missing, the correct result is bounded
fail-closed evidence, not a claimed pass.
