# Computer Use Control Plane

- componentId: `computer-use-control-plane`
- artifact types: `computer-use-control-plane`, `computer-use-user-control-plane`, `computer-use-session-control`, `computer-use-replay-control`
- lifecycle: presentation-only

This renderer displays Computer Use user-plane public refs: session grant refs, app/window allowlist refs, forbidden app refs, risk preview refs, data visibility refs, stop/cancel refs, and approval mode/status.

It never executes Computer Use actions. Stop and cancel buttons emit terminal-equivalent `/computer-use ...` text records. Approval buttons emit a confirmation result with public refs and an equivalent command string. Provider routes, executor leases, scheduler policy, desktop bridge settings, raw screenshots, tokens, coordinates, and private backend params are not accepted by the payload normalizer.

## Agent quick contract

- componentId: `computer-use-control-plane`
- accepts: `computer-use-control-plane`, `computer-use-user-control-plane`, `computer-use-session-control`, `computer-use-replay-control`
- requires: public permission refs, app/window allowlist refs, risk/data visibility refs, or stop/cancel refs
- outputs: presentation-only user-control-plane state and terminal-equivalent command events
- commands: `Stop`, `Cancel`, and approval confirmation as terminal-equivalent text only
- safety: no Computer Use execution, no provider route, no executor lease ownership, no raw screenshots/base64/provider payloads/secrets
- demo fixtures: `fixtures/basic.ts`, `fixtures/empty.ts`, `fixtures/selection.ts`
- primitive/preset: Computer Use confirmation and control-plane presentation surface
