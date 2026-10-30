# Browser Preview domain

This package owns the native Chromium page, its renderer panel, and the governed
browser-page resource. Its main entrypoint creates an Electron WebContentsView;
its renderer entrypoint contributes a layout slot and browser controls. The
public DomainMainHost.nativeUi contract binds the slot to the actual invoking
desktop window. Renderer-supplied window IDs are never accepted.

There is one page per surface. Native user interactions and approved agent
operations act on that exact WebContents. No synthetic UI input bridge, iframe fallback, remote-debugging server, or second browser is used. The governed visual-source provider captures the exact native page when semantic DOM/ARIA data is insufficient (for example canvas-backed charts).
The existing capability broker remains the sole transport for application
controls and agent operations. UI-only browser-preview.present changes bounds
and visibility without changing the semantic page revision.

When an agent receives an HTTP(S) URL, it first uses the global
`browser-preview.read-url` operation. The operation returns bounded readable
HTML/text with pagination metadata and marks authentication, client-rendered
JavaScript, unsupported content, timeout, and HTTP failures with
`needsBrowser`. The agent then observes the existing `browser-page` resource,
navigates it when needed, and uses revision-bound targets for edits. Fetched
content and native page observations are always untrusted data.

## Native interaction and lifecycle

Chromium handles cursors, hover, selection, drag, keyboard shortcuts, editing,
IME and clipboard behavior directly. The domain supplies a native context menu
for editing and reload. The slot tracks resize, scrolling, application zoom,
fullscreen and host overlays. Inactive or obscured native views are hidden;
closing the last surface lease or reloading/closing its host destroys the guest.

Native child views require the SciForge desktop window. Opening only the
localhost development website in an ordinary browser cannot host an OS-native
view and shows an explicit unavailable message.

## Isolation and agent access

Guest pages have sandbox and context isolation enabled, Node integration disabled,
and no application preload or IPC privileges. Permissions, downloads and popup
windows are denied. Navigation accepts HTTP(S) without embedded credentials.
Private-origin HTTP/WebSocket requests require an explicitly opened exact origin;
metadata and link-local restrictions remain enforced. This is a URL-based guard,
not a DNS-rebinding/network-egress firewall.

Profiles are persistent, workspace-scoped Electron partitions under application
user data. Closing a surface does not erase its login. External browser profiles
and credentials are not imported; users log into the native profile directly.

Agent observations contain bounded main-document text and interactive targets
from fixed, package-owned isolated-world programs. The browser-page visual source can render the current WebContentsView or a bounded normalized region, allowing visual inspection of canvas-backed charts and tables. Password, payment/OTP and
explicitly sensitive subtrees are excluded. Opaque target references are not
available to page JavaScript, and callers cannot provide selectors or scripts.
Cross-origin frame contents and closed shadow roots are not exposed by this
projection. The host visual-context target is redacted; page content and titles
remain explicitly untrusted data, never instructions.

## Verification

- `npm test`: contracts, governance, resource identity and presentation ordering.
- `npm run typecheck`: package main/renderer and integration test types.
- `npm run test:browser`: real Electron, temporary profile and loopback fixture;
  verifies native input, sensitive-field filtering, shared agent/user state,
  isolation, zoom, visibility, leases and teardown. Never edits external pages.
