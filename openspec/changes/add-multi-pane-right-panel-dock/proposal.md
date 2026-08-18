## Why

The Workbench currently allows one right-panel page per Session. Opening another file or domain panel replaces the current page, so users cannot compare two files or keep several domain tools visible side by side. The renderer already has Session-owned right-panel workspaces, stable mounted lifetimes, a generic domain contribution registry, and independently instantiable workspace preview shells; the missing layer is a generic multi-pane dock inside each Session workspace.

## What Changes

- Evolve each Session right-panel workspace from one selected page into an ordered dock of independently owned pane instances with one focused pane.
- Let each pane bind one core right-panel mode or installed domain right-panel contribution and own its width, activation, file target, navigation history, file-tree context, and mounted lifecycle.
- Render logically unbounded horizontal panes with per-pane resize controls and dock-local horizontal overflow while retaining a usable main Workbench surface.
- Add pane controls to create/split, focus, rebind, navigate, and close panes; ordinary launches target the focused pane, while explicit new-pane placement creates an adjacent pane.
- Extend generic right-panel render/open contracts with Host-owned surface identity, focus state, and placement without introducing domain-specific layout configuration.
- Scope file preview, visible-context, visual-capture, and contribution state by Session and pane identity so duplicate panel contributions remain isolated.
- Preserve panes across ordinary Session switches and release only the exact pane or Session that is closed, archived, or removed.

## Capabilities

### New Capabilities

- `multi-pane-right-panel-dock`: Session-owned, horizontally split right-panel panes with generic contribution binding, focused command routing, independent state, and deterministic lifecycle.

### Modified Capabilities

- `session-right-panel-workspaces`: A Session workspace owns multiple resident pane instances instead of one selected page while retaining the same Session switching and disposal semantics.
- `domain-ui-contributions`: Generic right-panel contributions receive a stable Host surface identity and focus state and can request focused-pane or new-pane placement.

## Impact

- Renderer Workbench layout, Session right-panel reducer, panel stack, panel chrome, command routing, file preview, and visible-context publication.
- `@sciforge/domain-sdk` right-panel host and renderer contracts plus official domain right-panel contribution audits.
- Renderer tests for pane state isolation, duplicate contributions, placement, resizing, overflow, Session switching, visible context, and cleanup.
- No backend preview/provider protocol, domain package discovery map, persisted-data migration, or cross-restart restoration is introduced.
