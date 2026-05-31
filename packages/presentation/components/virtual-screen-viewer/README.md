# Virtual Screen Viewer

Presentation-only viewer for Computer Use virtual desktop sessions.

- componentId: `virtual-screen-viewer`
- artifact type: `computer-use-virtual-screen`
- purpose: display refs-first virtual screen state, actor cursors, isolation flags, replay refs, and terminal-equivalent actions.

This package does not start noVNC/RDP, does not execute input, does not read raw screenshots, and does not expand permissions. Host/runtime code owns capture, action scheduling, executor leases, approval, and replay evidence.
