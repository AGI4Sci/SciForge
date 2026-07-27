## ADDED Requirements

### Requirement: Session-owned right-panel workspace
The renderer SHALL own the complete right-panel workspace by Session thread ID and SHALL NOT reuse one mutable panel workspace across different Sessions.

#### Scenario: Independent pages in two Sessions
- **WHEN** Session 1 opens a file preview and Session 2 opens a DAG page
- **THEN** each Session retains its own mode, target, navigation state, and component instance

#### Scenario: Same workspace used by two Sessions
- **WHEN** two Sessions belong to the same filesystem workspace
- **THEN** their right-panel UI state remains independent because ownership is based on Session ID rather than workspace path

#### Scenario: Any right-panel mode
- **WHEN** a Session opens any supported right-panel mode, including changes, child agents, todo, paper, browser, checkpoints, visual review, plan, or SDD assistant
- **THEN** that mode and all of its panel-owned state use the same Session workspace lifecycle without a global fallback or mode-specific side path

### Requirement: Session switching preserves mounted lifetime
The renderer SHALL change visibility when focus moves between Sessions and SHALL keep each inactive Session's selected right-panel page mounted.

#### Scenario: Return to a file preview
- **WHEN** a user changes preview zoom, scroll, selection, or plot state in Session 1, switches to Session 2, and returns
- **THEN** Session 1 displays the same mounted page with the state unchanged

#### Scenario: Background observation continues
- **WHEN** an inactive Session's preview or DAG has an active subscription, poll, iframe watcher, or backend update
- **THEN** switching focus does not dispose that lifecycle and the page can observe the resulting state

### Requirement: Focused command routing
The renderer MUST route user and window-level right-panel commands to the focused Session only.

#### Scenario: File preview command
- **WHEN** a file-preview command is emitted while Session 2 is focused
- **THEN** only Session 2's right-panel workspace changes target or mode

#### Scenario: Hidden workspace callback
- **WHEN** a hidden workspace receives a background event
- **THEN** it updates only resources owned by its Session and does not mutate the focused Session's panel state

### Requirement: Visible-context isolation
The renderer MUST publish visible-context and visual-capture registrations only for the focused right-panel surface while allowing hidden surfaces to remain mounted.

#### Scenario: Two resident file previews
- **WHEN** Session 1 and Session 2 both retain mounted file previews and Session 2 is focused
- **THEN** the published right-sidebar context and capture targets describe Session 2 only

### Requirement: Deterministic workspace disposal
The renderer SHALL dispose a Session's right-panel workspace only when the panel is explicitly closed, the Session is removed, or the application exits.

#### Scenario: Session switch
- **WHEN** focus moves away from a Session
- **THEN** the Session's workspace is not disposed

#### Scenario: Session removal
- **WHEN** a Session is removed from the canonical thread collection
- **THEN** its mounted panel is unmounted and its workspace state, subscriptions, timers, and iframe resources are released

### Requirement: In-memory lifetime only
The renderer SHALL keep Session right-panel workspace state only for the current application lifetime and SHALL NOT restore it from a legacy global right-panel persistence payload.

#### Scenario: Application restart
- **WHEN** the application starts after a previous run with right panels open
- **THEN** no Session right-panel workspace is reconstructed from global mode or context storage
