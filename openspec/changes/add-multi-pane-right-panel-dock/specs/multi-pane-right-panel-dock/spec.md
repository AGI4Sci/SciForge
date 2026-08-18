## ADDED Requirements

### Requirement: Session-owned multi-pane dock

The renderer SHALL let each Session own an ordered collection of independently stateful right-panel panes and one focused pane.

#### Scenario: Compare two files

- **WHEN** a user opens two workspace files in separate panes of one Session
- **THEN** both previews remain visible and mounted with independent targets, histories, view state, and widths

#### Scenario: Duplicate contribution

- **WHEN** two panes bind the same core mode or installed domain right-panel contribution
- **THEN** each pane receives a distinct stable surface identity and component instance
- **AND** state or cleanup in one pane does not overwrite or dispose the other pane

#### Scenario: No arbitrary pane count

- **WHEN** the user repeatedly creates panes
- **THEN** the state model imposes no fixed pane-count limit
- **AND** the layout handles unavailable horizontal space through dock-local overflow

### Requirement: Generic pane binding

Each pane SHALL bind exactly one core right-panel mode or installed generic right-panel contribution without a central domain feature map.

#### Scenario: Installed contribution appears

- **WHEN** an enabled domain package registers a `renderer.workbench-right-panel` contribution
- **THEN** the generic pane binder can select it from registry metadata
- **AND** the Workbench contains no branch for that domain ID

#### Scenario: Rebind focused pane

- **WHEN** the user selects another available panel for the focused pane
- **THEN** only that pane replaces its mounted content and records its own navigation state

### Requirement: Focused and new placement

All canonical right-panel launch paths MUST resolve either focused-pane or new-pane placement through one Host policy.

#### Scenario: Ordinary launch

- **WHEN** a top-bar command, resource navigation, or file-preview event uses focused placement
- **THEN** it updates the focused pane or creates the first pane when none exists

#### Scenario: Explicit new pane

- **WHEN** a launcher requests new placement
- **THEN** the Host creates and focuses an adjacent pane bound to the requested content
- **AND** existing panes remain unchanged

#### Scenario: Exact owning pane

- **WHEN** a mounted contribution echoes its Host-issued surface identity in a nested open request
- **THEN** the Host routes the request to that exact pane even when another pane is focused
- **AND** an unknown surface identity does not fall back to the focused pane

#### Scenario: Hidden pane callback

- **WHEN** a mounted pane callback runs after another pane becomes focused
- **THEN** it updates only its explicit Session and pane identity

### Requirement: Pane layout and interaction

The Host SHALL own horizontal pane ordering, focus, sizing, accessibility, overflow, split, and close behavior.

#### Scenario: Resize one pane

- **WHEN** the user drags a separator between panes
- **THEN** the targeted pane width changes within generic bounds
- **AND** unrelated pane state remains unchanged

#### Scenario: Pane overflow

- **WHEN** pane preferred widths exceed available Workbench space
- **THEN** the main Workbench retains its minimum usable width
- **AND** the pane strip becomes horizontally scrollable without shrinking panes below their hard minimum

#### Scenario: Close pane

- **WHEN** the user closes one pane
- **THEN** only that pane unmounts and releases resources
- **AND** focus moves deterministically to an adjacent pane

### Requirement: Session switching preserves every pane

The renderer SHALL keep every open pane of inactive Sessions mounted and inert until its pane or Session is closed.

#### Scenario: Return to a multi-pane Session

- **WHEN** a user switches away from a Session with several open panes and later returns
- **THEN** every pane retains its stable component identity, target, history, width, and panel-owned state

#### Scenario: Session removal

- **WHEN** a Session is archived or removed
- **THEN** all pane subtrees and resources owned by that Session are disposed

### Requirement: Pane-qualified visible context

The renderer MUST publish visible context and visual targets for every visible pane with collision-free Session and surface identities.

#### Scenario: Two viewport-visible file previews

- **WHEN** two file preview panes intersect the horizontal dock viewport in one focused Session
- **THEN** both resources are published under distinct component identities
- **AND** toolbar command state identifies only the focused pane

#### Scenario: More mounted panes than visible-context capacity

- **WHEN** one focused Session owns more than 64 mounted panes and only a subset intersects the dock viewport
- **THEN** every pane remains mounted with its component identity and state
- **AND** only the viewport-intersecting panes publish active visible context
- **AND** the renderer imposes no pane-count limit

#### Scenario: Horizontally offscreen pane

- **WHEN** an open pane is outside the horizontal dock viewport
- **THEN** its subtree remains mounted
- **AND** it does not publish active visible-context or visual-capture targets

#### Scenario: Inactive Session dock

- **WHEN** a Session dock remains mounted but is not foreground-visible
- **THEN** none of its panes publishes active visible-context or visual-capture targets

### Requirement: In-memory lifetime only

The renderer SHALL keep pane layout and content state only for the current application lifetime.

#### Scenario: Application restart

- **WHEN** the application restarts after several panes were open
- **THEN** the panes are not reconstructed from legacy or new browser persistence
