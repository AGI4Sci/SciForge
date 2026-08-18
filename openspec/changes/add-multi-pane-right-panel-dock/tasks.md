## 1. Multi-pane state model

- [x] 1.1 Replace singleton Session right-panel page fields with an ordered pane collection, focused pane identity, pure creation/update/focus/split/close/rebind/history/width operations, and deterministic Session rekey/disposal.
- [x] 1.2 Migrate reducer and lifecycle tests to cover independent panes, duplicate modes, new/focused placement, adjacent focus after close, resource discard, Session switching, and Session removal.

## 2. Generic contracts and contribution isolation

- [x] 2.1 Extend Domain SDK right-panel open and render contracts with focused/new placement, stable Host surface identity, and focused state; update contract tests and public exports.
- [x] 2.2 Audit official right-panel contributions for duplicate mounts and qualify pane-local or visible-context identity by the supplied surface identity without adding Host domain-ID branches.

## 3. Dock layout and pane chrome

- [x] 3.1 Add a generic Session right-panel dock that renders ordered stable pane instances with focus semantics, per-pane navigation, binding selector, split/new, close, and accessible pane headers.
- [x] 3.2 Add independent pane resizing, main-surface minimum protection, dock-local horizontal overflow, and responsive layout tests without a fixed pane-count limit.

## 4. Canonical routing and Workbench integration

- [x] 4.1 Route top-bar modes, domain panel opens, exact-resource navigation, file preview events, nested file opens, auto-preview, and resource discard through one focused/new pane placement policy.
- [x] 4.2 Refactor Workbench Session snapshots and resident renderers to pane identity while preserving mounted lifetimes across Session focus changes and exact cleanup on pane or Session close.
- [x] 4.3 Add “open in new right sidebar” file actions and ensure ordinary opens target the focused pane while explicit splits create adjacent focused panes.

## 5. Visible context and visual capture

- [x] 5.1 Publish generic right-panel directory entries, file preview components, and visual targets with Session-plus-surface identity for every visible pane.
- [x] 5.2 Keep inactive Session panes mounted but context-inactive, and make toolbar `activeSurface` reflect only the focused pane.

## 6. Verification and cleanup

- [x] 6.1 Add integration tests for simultaneous file comparison, duplicate domain panels, navigation isolation, resizing/overflow, Session switching, and cleanup.
- [x] 6.2 Run focused renderer and Domain SDK tests, domain package tests, generated composition checks, typecheck, changed-file lint, and full regression tests in proportion to the change.
- [x] 6.3 Audit and remove singleton right-panel fields, implicit focused-Session mutations, duplicate placement paths, visible-context ID collisions, dead helpers, and stale tests or documentation.
