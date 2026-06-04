# Annotation Overlay Keyboard And Multiscreen Design

## Context

Full-screen annotation currently depends too much on mouse-only controls. In overlay mode, the user can get stuck because the overlay owns the interaction surface and ordinary buttons may be unreachable. Multiscreen setups also need native-feeling screen selection: the user should be able to move the cursor to any connected display and annotate there without cross-display crop stitching.

## Goals

- Let users complete or cancel annotation with the keyboard in full-screen overlay mode.
- Support multiple displays with one annotation constrained to one real display.
- Match WeChat-like screenshot behavior: cursor hover chooses the active display, and starting a drag locks the selection to that display.
- Preserve refs-first output and existing screen-region/app-window metadata principles.

## Non-Goals

- Do not create one crop that spans multiple displays.
- Do not stitch screenshots across displays.
- Do not expose raw screenshots, raw window lists, DOM payloads, or provider payloads.
- Do not add app-specific adapters for annotation.

## Keyboard Interaction

- `Esc` cancels the current annotation at any stage and closes the overlay.
- `Enter` submits the annotation only after a valid selection exists.
- `Enter` before a selection is a no-op.
- `Shift+Enter` inserts a newline in the comment textarea.
- After the user finishes a selection, focus moves to the comment textarea so they can type immediately.
- If the comment is empty, submit stays blocked and focus remains in the textarea.

## Multiscreen Interaction

- The overlay covers every connected display in the current display topology. The logical topology is the union of the displays, while the native implementation may use one overlay window per real display to avoid unstable transparent all-display windows on mixed monitor layouts.
- While no drag is active, pointer movement over a real display updates the active display, hides the old display overlay, shows only the new active display overlay, and focuses the new comment textarea.
- If the pointer moves through a geometric gap in the display union, the previous active display is retained.
- Mouse down starts a selection on the current active display, locks the selection to it, and pauses main-process display switching until drag end/cancel.
- Dragging beyond that display clips the selection to the locked display bounds.
- A selection cannot start until there is an active real display.
- The final screen-region output uses the locked display metadata: `displayId`, `screenId`, `scale`, and clipped global `screenBounds`.

## Visual Feedback

- The active display should have lightweight visual feedback, such as a subtle boundary or mask, so the user knows which screen will be annotated.
- During drag, the selection rectangle is rendered only inside the locked display bounds.
- The feedback should remain minimal and not introduce extra buttons required for the happy path.

## Architecture

The desktop overlay controller derives the connected display topology from Electron `screen.getAllDisplays()` when available, falling back to `getPrimaryDisplay()` for older tests or constrained environments. It creates one transparent native overlay window per normalized real display, keeps only the current cursor display window visible, and rebuilds those windows when the display topology signature changes across overlay sessions. This is more robust than one giant transparent union window because Electron/macOS can move cross-display transparent windows after first paint on mixed-position, mixed-scale monitor layouts.

Each overlay page receives the full display metadata list, plus the id of the display owned by that native window. It maintains:

- `activeDisplay`: last real display under the pointer.
- `lockedDisplay`: display chosen at mouse-down time for the current drag.
- `selectedBounds`: clipped global bounds for the final selection.

The renderer sends sanitized active-display and drag-state events through the trusted annotation overlay preload only. The main process also polls Electron `screen.getCursorScreenPoint()` while overlay mode is active, canonicalizes the cursor display against the current Electron display topology, hides the previous active display overlay, shows/focuses the new active display overlay, and broadcasts the active display back to every overlay page. If an event only has bounds and no id, the bounds are matched against the current topology before assigning the renderer display id. During drag, display switching is locked to the mouse-down display and resumes after pointer up/cancel.

The controller continues to output refs-first annotation data through the existing overlay/update/submit/capture path. Screen-region capture providers receive clipped bounds and locked display metadata, so downstream capture can use the existing region-capture path.

## Error Handling

- If no displays are available, fall back to the primary display metadata already used by the overlay.
- If a pointer event lands outside every display and no previous active display exists, ignore drag start.
- If clipped selection bounds are empty, do not create a selection.
- Existing blocked refs-only diagnostics remain the fallback when native capture providers are unavailable.

## Testing

- Unit/smoke test keyboard behavior: `Esc` cancels, `Enter` submits after selection, `Enter` before selection is no-op, and `Shift+Enter` preserves multiline comment text.
- Test overlay bounds use the union of multiple displays.
- Test hover active display is retained across display-union gaps.
- Test drag locks to the active display and clips bounds when crossing into another display.
- Test metadata uses the locked display id/scale and clipped `screenBounds`.
- Re-run annotation smoke tests, typecheck, and `git diff --check`.

## Completion Record

- 2026-06-04 status: implemented, corrected after live-use issues, and live-verified end-to-end in the SciForge desktop app.
- Evidence refs: `src/desktop/annotation-overlay.ts`, `src/desktop/main.ts`, `src/desktop/annotation-overlay-preload.cjs`, `tests/smoke/smoke-desktop-annotation-overlay.test.ts`, `tests/smoke/smoke-desktop-electron-main.test.ts`.
- Final implementation notes:
  - The native overlay now uses one overlay `BrowserWindow` per connected display, with display topology rebuilt from `screen.getAllDisplays()` on each overlay show/create and primary-display fallback when `getAllDisplays()` is unavailable.
  - Only the display under the real cursor is visible during hover; moving the cursor to another real display hides the old overlay window and shows/focuses the new overlay window.
  - The older single transparent union-window approach was removed for real display coverage because it drifted on the user's mixed macOS layout.
  - Hover active-display updates are refs-only and sanitized through the trusted overlay preload, then canonicalized against the current display topology before focus/broadcast.
  - Drag state is sanitized through the trusted overlay preload and locks visible-overlay switching to the mouse-down display until pointer up/cancel, preserving selection visual continuity and clipped single-display crop semantics.
  - Keyboard behavior is implemented in the overlay renderer: `Esc` cancels, `Enter` submits only with a valid selection and non-empty comment, `Enter` before selection is a no-op, and `Shift+Enter` in the textarea inserts a newline.
  - Cancel and successful capture both hide every native overlay window and restore click-through, preventing stale overlay residue.
- Added focused tests for keyboard cancel/submit/no-op/multiline behavior, textarea focus after selection, per-display native overlay bounds, only-current-cursor-display visibility, cursor display switching, drag-time display-switch lock, visible-window no-reassert behavior, hover active display, gap retention, display-bound clipping, canonical active-display metadata, sanitized drag-state IPC/preload flow, and locked display metadata in capture input/output.
- Live SciForge desktop app evidence on the user's 3-display macOS layout:
  - Displays: `1` at `{x:0,y:0,width:1512,height:982,scale:2}`, `2` at `{x:-1840,y:-1440,width:2560,height:1440,scale:1}`, `3` at `{x:720,y:-1440,width:2560,height:1440,scale:1}`.
  - Root cause reproduced: a single transparent all-display `BrowserWindow` targeting union `{x:-1840,y:-1440,width:5120,height:2422}` drifted after show/load to scaled negative coordinates such as `{x:-3680,y:-2893,width:5120,height:2422}`, which made larger displays only partly capturable.
  - Per-display correction verified: native overlay windows stayed exactly at display `1` `{x:0,y:0,width:1512,height:982}`, display `2` `{x:-1840,y:-1440,width:2560,height:1440}`, and display `3` `{x:720,y:-1440,width:2560,height:1440}`.
  - Hovering display `2`, then display `1`, then display `3` activated only that display, moved the visible comment panel there, and focused that window's comment textarea.
  - A large selection on display `2` rendered within that display only (`left:120px`, `top:120px`, `width:2320px`, `height:1140px`) and did not spill into adjacent displays.
  - `Esc` after selection hid all overlay windows and returned focus to the main SciForge window.
  - A stale SciForge desktop app process from the prior annotation run left the overlay visible on screen; the residual process tree was terminated.
- Final live validation on the user's 3-display layout using the real SciForge desktop app, real system cursor movement, real keyboard events, Electron native window inspection, and visual screenshot inspection:
  - Displays observed: `1` at `{x:0,y:0,width:1512,height:982,scale:2}`, `2` at `{x:720,y:-1440,width:2560,height:1440,scale:1}`, `3` at `{x:-1840,y:-1440,width:2560,height:1440,scale:1}`.
  - Starting annotation with the cursor on display `2` showed exactly one visible overlay window on display `2`, focused.
  - Pressing `Enter` with no selection returned no result and kept the display `2` overlay visible.
  - Moving the real cursor to display `3` hid display `2` and showed exactly one visible focused overlay on display `3`; visual screenshots confirmed display `3` had the mask/panel and display `2` did not.
  - Creating a selection on display `3` focused the comment textarea, kept `Save` disabled while the comment was empty, and rendered selection `{left:120px,top:120px,width:240px,height:160px}` inside display `3`.
  - Pressing `Enter` with an empty comment returned no result, kept focus in `#comment`, and left submit disabled.
  - Pressing `Shift+Enter` in the textarea inserted a newline: `First line\nSecond line`.
  - Pressing `Enter` with a valid selection and comment submitted refs-only output with `status:"captured"`, `refs:4`, clipped `screenBounds:{x:-1720,y:-1320,width:240,height:160}`, locked `display.id:"3"`, and no raw screenshot/window/provider payload flags.
  - Starting a fresh annotation on display `2` and pressing `Esc` returned `status:"cancelled"` and left no visible overlay windows; screenshots after submit and after Esc showed no overlay residue.
- Verification:
  - `npm run desktop:build` (pass; existing Vite chunk-size and xterm default-import warnings only).
  - Live SciForge desktop app Playwright/Electron smoke against `dist-desktop/src/desktop/main.js` (pass, including only-current-display overlay visibility, cross-display cursor switching, selection, all requested keyboard shortcuts, submit, cancel, visual screenshot inspection, and no residual live app/sidecar process).
  - `node --import tsx --test tests/smoke/smoke-desktop-annotation-overlay.test.ts tests/smoke/smoke-desktop-electron-main.test.ts` (42/42 pass).
  - `node --import tsx --test tests/smoke/smoke-desktop-annotation-overlay.test.ts tests/smoke/smoke-desktop-electron-main.test.ts tests/smoke/smoke-desktop-window-capture.test.ts tests/smoke/smoke-desktop-screen-region-auto-binding.test.ts src/shared/annotation-reference-contract.test.ts src/ui/src/app/SciForgeApp.desktopAnnotation.test.ts` (76/76 pass).
  - `npm run typecheck -- --pretty false` (pass).
  - `git diff --check` (pass).
