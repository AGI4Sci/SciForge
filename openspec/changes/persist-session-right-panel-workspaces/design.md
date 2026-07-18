## Context

`Workbench` is mounted once and `useWorkbenchLayout` owns one `rightPanelMode`, one file target, and one history. The rendered panel is selected by a conditional on that global mode. On Session selection the same component subtree receives another `activeThreadId`, so effects rebind and mode changes unmount the previous file preview, DAG iframe, or visual-review surface. Lightweight in-memory view caches and the legacy local-storage context can reconstruct some values, but they cannot preserve mounted component identity, subscriptions, timers, or iframe state.

The change must preserve concurrent in-app Session work only. It must not restore panel state after application restart, introduce another state path per panel type, or special-case individual scientific formats.

The ownership rule applies to every current and future `RightPanelMode`. File preview, DAG, and plotting are lifecycle-heavy acceptance cases, not a limited allow-list.

## Goals / Non-Goals

**Goals:**

- Make the Session thread ID the ownership key for the complete right-panel workspace.
- Keep every visited Session's selected panel subtree mounted while another Session is active.
- Route focused-user commands to one Session while allowing hidden panel effects and backend work to continue.
- Isolate all navigation and panel target state without duplicating per-panel controllers.
- Release resident UI resources deterministically when their Session disappears.

**Non-Goals:**

- Cross-restart restoration of right-panel state.
- Keeping multiple right-panel modes mounted simultaneously inside one Session.
- Changing backend DAG, plotting, preview, or agent task execution APIs.
- Persisting inactive chat transcripts in additional renderer stores.

## Decisions

### One Session-keyed workspace reducer is the only right-panel state path

Replace the singleton mode/target/history state with a `SessionRightPanelWorkspace` map owned by the existing Workbench layout hook. Each entry contains the mode, file target and return context, navigation history, width, and panel routing metadata for exactly one Session. All existing top-bar toggles, preview events, history navigation, resource discard, and visual-review open commands update the focused entry through the same reducer operations.

This is preferred over adding per-panel caches because caches preserve values but not component lifetime and would create parallel update paths. It is preferred over mounting one entire `Workbench` per Session because that would duplicate global listeners, sidebars, composer effects, and runtime coordination.

### Resident panel surfaces are stacked and visibility-switched

The right sidebar renders one outer layout shell for the focused Session and a keyed content surface for every resident workspace whose mode is open. Inactive surfaces use `hidden`, `aria-hidden`, and `inert` semantics but remain in the React tree. Switching Sessions changes which surface is visible; it does not change the inactive surface's key or component type. Switching modes inside the same Session retains current behavior and replaces that Session's selected page.

Panel render inputs that otherwise come from global active-thread state are captured as a Session render snapshot whenever that Session is focused. An inactive surface continues receiving its own last Session snapshot, never values from the newly focused Session. Panel-owned effects that already accept explicit thread/runtime/workspace identifiers therefore remain correctly bound.

### Global commands target only the focused Session

Window-level file-preview, DAG-open, auto-preview, and top-bar commands resolve the current Session ID once and dispatch to that workspace. Hidden workspaces do not install competing global command handlers. Panel callbacks receive the owning Session ID and use targeted workspace mutations rather than an implicit global current panel.

### Background lifetime and visible-context activation are separate

Hidden panel components remain mounted so subscriptions, polling, preview hosts, plot state, and iframes survive. Visibility-only integrations such as visible-context publication and visual capture are enabled only for the focused surface. File-preview bridges receive an explicit active flag; nested viewers receive no active visible-context component ID while hidden. DAG priority signalling may lower hidden UI priority, but must not cancel the underlying Session task or destroy the iframe.

### Removal, not switching, owns disposal

The reducer prunes workspace entries only when their Session ID no longer exists in the canonical thread list. Closing a panel clears that Session's mode and unmounts its current page; deleting/removing a Session removes its full workspace. Ordinary Session selection never invokes disposal.

### Delete conflicting persistence and thread-following logic

Remove the global right-panel mode/context local-storage keys, restore validation, and `shouldCloseRightPanelOnThreadChange` path. Width preferences unrelated to Session content may remain only if they are not a second source of workspace state; Session-owned width lives in the workspace entry. Existing bounded view-memory helpers remain solely for mode changes within one Session where a page is intentionally replaced.

## Risks / Trade-offs

- **More resident iframes and preview viewers consume memory** → Create entries lazily, mount only a Session's currently selected mode, and dispose immediately when the Session is removed or its panel is closed.
- **Hidden panels can overwrite active visible-context registrations** → Gate registration using the focused-surface flag and use Session-qualified component identity where registration spans multiple mounted surfaces.
- **Global active-thread data can leak through props** → Capture a stable render snapshot per Session and require explicit Session/thread/runtime/workspace identifiers at panel boundaries.
- **Thread refresh can transiently omit Sessions** → Prune only after the canonical thread collection is initialized and never prune the current active ID.
- **Browser timer throttling can delay hidden UI polling** → Keep backend tasks authoritative; retained effects observe completion when scheduled without treating UI timer cadence as task execution.
