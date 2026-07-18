## Why

The renderer currently reuses one right-panel controller and one mounted panel surface across every chat Session. Switching Sessions therefore rebinds or unmounts file previews, DAG views, plots, subscriptions, and in-progress UI state, preventing Sessions from working independently in parallel.

## What Changes

- Give every visited Session its own right-panel workspace, keyed only by the Session thread ID.
- Keep each Session's current right-panel page mounted while another Session is focused; Session switching changes visibility instead of component identity.
- Isolate panel mode, navigation history, file targets, DAG selections, visual-review targets, and panel-owned background effects between Sessions.
- Route global open/preview commands to the focused Session and prevent hidden workspaces from publishing active visible-context state.
- Dispose a Session's right-panel workspace only when that Session is removed or the application exits.
- Remove the global mode/context persistence and thread-following behavior that conflict with Session ownership; no compatibility path or cross-restart restoration is retained.

## Capabilities

### New Capabilities

- `session-right-panel-workspaces`: Session-owned, concurrently resident right-panel workspaces with isolated state, lifecycle, and command routing.

### Modified Capabilities

None.

## Impact

- Renderer Workbench and right-panel layout/controller code.
- File preview, Evidence DAG, Project DAG, plotting/visual-review, and visible-context activation boundaries.
- Renderer tests for Session switching, workspace cleanup, navigation isolation, and background lifecycle continuity.
- No main-process API, persisted-data migration, dependency, or backend runtime change is required.
