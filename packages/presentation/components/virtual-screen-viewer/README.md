# Virtual Screen Viewer

Presentation-only VirtualAppScreen surface for Computer Use sessions.

## Agent quick contract

- componentId: `virtual-screen-viewer`
- accepts: `computer-use-virtual-screen`, `virtual-desktop-session`, `computer-use-screen`, `computer-use-replay`
- requires: one of `sessionRef`, `visibleScreenRefs`, `frameRefs`, `replayRef`, `completionEvidenceRef`, `blockedRef`, or `errorRef`
- outputs: presentation-only `computer-use-virtual-screen`
- state: `waiting`, `replay`, `blocked`, `error`, `completed`, or host-provided status
- presentation mode: `replay-ref-inspector`; `frameStreamRef` is displayed as refs-first evidence unless the host attaches the same owner-owned `webrtc` or `native-frame-stream` live surface transport
- commands: `Observe`, `Replay`, permission `Handoff`/`Recheck`, and human intervention controls (`Take over`, `Pause agent`, `Resume agent`, `Stop`) as terminal-equivalent text only
- input: frame clicks, drags, scrolls, text, hotkeys, takeover, pause, resume, and stop are enabled only for attached screens with session/frame/lease owner/adapter/readiness refs and explicit safe isolation flags; observe-only disables intervention controls
- safety: no Computer Use execution, no executor lease ownership, no provider route, no inline screenshot/base64/raw JSON rendering, no shared system input
- demo fixtures: `fixtures/basic.ts`, `fixtures/empty.ts`, `fixtures/refs-contract.ts`, `fixtures/selection.ts`
- primitive/preset: refs-first multi-screen actor-cursor presentation for the Screen result pane

## Human notes

- artifact type: `computer-use-virtual-screen`
- purpose: display refs-first virtual screen state, host-provided frame previews, actor cursors, action proposals, before/after evidence refs, completion/blocked/error refs, isolation flags, replay refs, and terminal-equivalent actions. The right-pane surface can request scoped `InputIntent` commands from the frame, but it is not a Computer Use executor or scheduler lease owner.

Accepted frame presentation is refs-first: `visibleScreenRefs`, `visibleCursorRefs`, `replayRef`, `frameRefs`, `cursorOverlayRefs`, `leaseOwnerRefs`, `activeLeaseOwnerRef`, `userLeaseRef`, `agentLeaseRef`, `inputLeaseRef`, `takeoverRef`, `pauseRef`, `resumeRef`, `stopRef`, `proposalRefs`, `beforeEvidenceRef`, `afterEvidenceRef`, `completionEvidenceRef`, `blockedRef`, `errorRef`, `permissionHandoffRef`/`permissionHandoffRefs`, `permissionRecheckRef`/`permissionRecheckRefs`, and permission/shared-input flags. Frames render only from a host-provided materializer URL field such as `frameUrl`, safe URL `frameDataRef`, `framePreviewUrl`, `thumbnailPreviewUrl`, `safePreviewUrl`, `previewUrl`, `thumbnailUrl`, or a legacy safe `rawUrl`; inline screenshots, base64/data URLs, raw trace dumps, and raw JSON/provider payloads are rejected and surfaced only as typed warnings.

This package does not start or accept noVNC/RDP/VNC/MJPEG transports, execute input, read raw screenshots, render raw trace/provider JSON, accept provider routes, or own executor lease parameters. Host/runtime code owns capture, action scheduling, executor leases, approval, the owner live-surface transport, and replay evidence. Replay, screenshots, PDFs, documents, and old frames are evidence views only, never an interaction fallback. Observe, Replay, permission handoff/recheck, frame input capture, and human takeover/pause/resume/stop emit only `virtual-screen-terminal-equivalent-text`; the host must materialize the resulting command into `InputIntent`, lease/evidence refs, executor event, before/after frame, verifier, and evidence refs before any user-level acceptance can pass.
