# Computer Use Control Plane

- componentId: `computer-use-control-plane`
- artifact types: `computer-use-control-plane`, `computer-use-user-control-plane`, `computer-use-session-control`, `computer-use-replay-control`
- lifecycle: presentation-only

This renderer displays the Computer Use user-control-plane contract: session permission refs, app/window allowlist refs, forbidden app refs, risk preview refs, data visibility refs, stop/cancel refs, and approval mode/status.

It never executes Computer Use actions. Stop and cancel buttons emit terminal-equivalent `/computer-use ...` text records. Approval buttons emit a confirmation result with public refs and an equivalent command string. Provider routes, executor leases, scheduler policy, desktop bridge settings, raw screenshots, tokens, coordinates, and private backend params are not accepted by the payload normalizer.
