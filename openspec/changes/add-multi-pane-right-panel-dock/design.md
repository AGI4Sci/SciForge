## Context

`SessionRightPanelWorkspace` currently stores one mode, width, file target, activation, file-tree context, and history for a Session. `SessionRightPanelStack` keeps one keyed workspace subtree mounted per resident Session and changes visibility on Session focus. `Workbench` renders the focused workspace inside one resizable right sidebar, while file preview and domain open events replace that workspace's selected mode.

Workspace preview shells are already independently instantiable and domain right-panel renderers are resolved through the generic installed contribution registry. The target design must reuse those canonical paths, must not add a file-only split controller, and must not create a central map of domain IDs.

## Goals / Non-Goals

**Goals:**

- Support any number of pane instances in one Session without an arbitrary product limit.
- Keep each open pane mounted and independently stateful across pane focus and Session switches.
- Allow duplicate instances of the same core or domain contribution.
- Keep ordinary launch behavior focused and predictable while exposing an explicit new-pane placement.
- Preserve automatic installed-domain discovery and generic Host ownership of layout, focus, accessibility, and cleanup.
- Keep the main Workbench usable when pane widths exceed the available viewport.

**Non-Goals:**

- Arbitrary two-dimensional editor grids or vertical pane splitting.
- Cross-restart pane restoration.
- A second preview implementation, domain-specific Host layout branches, or plugin-authored pane geometry.
- Silent suspension or unmounting of open panes under memory pressure.

## Decisions

### A Session workspace owns one ordered pane collection

Keep `SessionRightPanelWorkspace` as the Session ownership and lifecycle unit, but replace its singleton page fields with `panes` and `focusedPaneId`. Each `SessionRightPanelPane` has a stable `instanceKey`, a stable pane ID, mode, width, file target and return context, contribution activation, file-tree context, child focus request, and navigation history.

All reducer operations identify both the Session and pane. Session rekey and disposal move or remove the complete dock. Closing one pane removes exactly that pane and focuses an adjacent pane. Closing the last pane hides the dock without deleting the Session workspace. No parallel singleton fields remain.

### The existing Session stack remains the cross-Session lifetime boundary

`SessionRightPanelStack` continues to mount one surface per resident Session. Its child becomes a horizontal Session dock that renders all open panes for that Session, keyed by pane instance identity. Inactive Session docks remain mounted with inert and hidden semantics. All panes in the focused Session remain mounted, only the panes intersecting the dock viewport are context-active, and one pane is additionally focused for keyboard and command routing.

### Pane layout is horizontally unbounded but viewport bounded

Each pane has a hard usable minimum and an independent preferred width. The outer dock is capped by the available Workbench width after reserving a minimum main-surface width. The ordered pane strip uses horizontal overflow when the sum of pane widths exceeds the dock viewport. Resizers change the pane on their immediate right or left through one generic width reducer. The implementation adds no hard pane-count limit.

### One canonical placement policy serves every launcher

Existing top-bar, domain `openRightPanel`, resource navigation, and workspace preview events continue through their existing canonical event paths, but resolve placement through one Host helper:

- `focused`: replace or update the focused pane, creating one if none exists.
- `new`: create an adjacent pane, bind the requested content, and focus it.
- exact `surfaceId`: update the existing Host-issued pane, with no fallback when that pane no longer exists.

Ordinary launches use `focused`. Pane split controls and explicit “open in new right sidebar” actions use `new`. Internal pane callbacks target the owning pane ID directly and never re-resolve global focus.

### Contribution discovery remains registry driven

The pane binder lists core Host panel descriptors and installed `renderer.workbench-right-panel` contributions from the existing registry. Domain packages own their title, renderer, command, resource metadata, and activation. Adding or removing a domain package requires no Workbench domain-ID branch or feature-map edit.

### Public surface identity separates visibility from focus

Extend the generic right-panel render context with a stable `surfaceId` and `focused`. `active` means that the owning Session is foreground-visible and the pane intersects the horizontal dock viewport; horizontally offscreen panes remain mounted but are context-inactive. Only the focused pane is `focused`, and focusing a pane scrolls it into the dock viewport. When viewport observation is unavailable, only the focused pane is active. Extend open inputs with a mutually exclusive target: optional `placement: 'focused' | 'new'`, defaulting to `focused`, or an exact Host-issued `surfaceId` echoed by a mounted contribution callback.

Official domain panels must qualify visible-context identities and any pane-local external ownership by `surfaceId` when necessary. The Host does not expose mutable pane registries or allow packages to choose pane IDs; packages may only echo the surface identity supplied in their render context.

### Visible context represents every visible pane

The generic right-sidebar directory entry becomes pane-qualified rather than a singleton `right-sidebar` registration. File preview bridges and domain surfaces receive `surfaceId`; component and visual-target IDs include both Session and surface identity. Every pane in the focused Session that intersects the dock viewport may publish visible resources; horizontally offscreen panes and panes in inactive Sessions publish none. This keeps logically unbounded mounted panes from exhausting bounded visible-context registries. Toolbar `activeSurface` and command state describe only the focused pane.

### Open panes retain lifecycle; close owns cleanup

Open panes, including horizontally offscreen panes and panes in inactive Sessions, remain mounted so preview sessions, iframe state, subscriptions, and background observations survive. Viewport visibility changes only context-active publication; it never controls mounting. Closing a pane unmounts its subtree and releases its resources. Removing a Session releases every pane. The Host may expose diagnostics for high pane counts but must not silently evict open panes.

## Risks / Trade-offs

- **Many heavy viewers increase memory use.** Panes are created only by explicit opens, close releases the exact subtree, and no closed-pane cache is added.
- **Duplicate domain mounts may share Session-only identities.** Add `surfaceId`, audit official contributions, and test two instances of the same contribution in one Session.
- **Global callbacks may mutate the wrong pane.** Resolve focus once at event entry; nested callbacks carry explicit Session and pane IDs.
- **Multiple visible registrations may collide.** Qualify Host and preview component IDs by Session and surface identity and test simultaneous previews.
- **The dock can consume the entire window.** Reserve a main-surface minimum and overflow inside the dock rather than shrinking panes below their usable minimum.
- **Legacy singleton assumptions can survive in selectors.** Delete singleton fields and helpers after migrating every reference; do not keep forwarding aliases.

## Migration Plan

1. Introduce the pure multi-pane reducer and migrate its focused selectors and lifecycle tests.
2. Add the generic Session dock and pane chrome with independent resize, focus, split, rebind, and close operations.
3. Extend SDK contracts and route existing domain and preview launches through the focused/new placement policy.
4. Refactor Workbench rendering and snapshots from Session-workspace renderers to pane renderers without changing preview/provider backends.
5. Qualify visible-context and visual-capture identities and audit official right-panel packages for duplicate mounts.
6. Delete singleton page state and run focused, full renderer, SDK, domain package, type, lint, and packaged-composition checks in proportion to the changed surface.
