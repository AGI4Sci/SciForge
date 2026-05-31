# Virtual Screen Viewer

Presentation-only viewer for Computer Use virtual desktop sessions.

## Agent quick contract

- componentId: `virtual-screen-viewer`
- accepts: `computer-use-virtual-screen`, `virtual-desktop-session`, `computer-use-screen`, `computer-use-replay`
- requires: one of `sessionRef`, `visibleScreenRefs`, `frameRefs`, `replayRef`, `completionEvidenceRef`, `blockedRef`, or `errorRef`
- outputs: presentation-only `computer-use-virtual-screen`
- state: `waiting`, `blocked`, `error`, `completed`, or host-provided status
- commands: `Observe`, `Replay`, `Stop` as terminal-equivalent text only
- safety: no Computer Use execution, no executor lease ownership, no provider route, no inline screenshot/base64/raw JSON rendering
- demo fixtures: `fixtures/basic.ts`, `fixtures/empty.ts`, `fixtures/refs-contract.ts`, `fixtures/selection.ts`
- primitive/preset: refs-first multi-screen actor-cursor presentation for the Screen result pane

## Human notes

- artifact type: `computer-use-virtual-screen`
- purpose: display refs-first virtual screen state, host-provided frame previews, actor cursors, lease owners, action proposals, before/after evidence refs, completion/blocked/error refs, isolation flags, replay refs, and terminal-equivalent actions.

Accepted frame presentation is refs-first: `visibleScreenRefs`, `visibleCursorRefs`, `replayRef`, `frameRefs`, `cursorOverlayRefs`, `leaseOwnerRefs`, `proposalRefs`, `beforeEvidenceRef`, `afterEvidenceRef`, `completionEvidenceRef`, `blockedRef`, `errorRef`, and permission/shared-input flags. Frames render only from a host-provided materializer URL field such as `frameUrl`, safe URL `frameDataRef`, `framePreviewUrl`, `thumbnailPreviewUrl`, `safePreviewUrl`, `previewUrl`, `thumbnailUrl`, or a legacy safe `rawUrl`; inline screenshots, base64/data URLs, raw trace dumps, and raw JSON/provider payloads are rejected and surfaced only as typed warnings.

This package does not start noVNC/RDP, does not execute input, does not read raw screenshots, does not render raw trace/provider JSON, does not accept provider routes, and does not own executor lease parameters. Host/runtime code owns capture, action scheduling, executor leases, approval, and replay evidence. Observe, Replay, and Stop emit only `virtual-screen-terminal-equivalent-text`.
