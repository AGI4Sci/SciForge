## 1. Session workspace state

- [x] 1.1 Replace singleton right-panel mode, target, width, and navigation history with a pure Session-keyed workspace reducer and targeted actions.
- [x] 1.2 Remove legacy global right-panel local-storage restoration and thread-following code.
- [x] 1.3 Route top-bar, file-preview, DAG, visual-review, auto-preview, and resource-discard commands through the focused Session entry.

## 2. Resident panel host

- [x] 2.1 Render keyed right-panel content surfaces for resident Sessions and switch focus with visibility/inert semantics instead of unmounting.
- [x] 2.2 Capture Session-specific render inputs so hidden panels retain their own thread, runtime, workspace, resources, and callbacks.
- [x] 2.3 Prune and unmount workspaces for deleted or archived Sessions while preserving them across ordinary Session switches.

## 3. Panel lifecycle isolation

- [x] 3.1 Gate visible-context and visual-capture registration by the active Session without stopping hidden preview subscriptions or DAG/plot lifecycles.
- [x] 3.2 Scope bounded mode-switch view memory, including PDF view state, by Session ID.
- [x] 3.3 Verify file preview, Evidence DAG, Project DAG, and visual review use explicit owning Session context and cannot rebind to another Session.

## 4. Verification

- [x] 4.1 Add reducer tests for independent Session state, focused command routing, navigation isolation, and archive/delete cleanup.
- [x] 4.2 Add host/panel tests for stable mounted identity and active-only visible-context behavior.
- [x] 4.3 Run targeted renderer tests, typecheck, and lint; fix all regressions within the changed scope.
