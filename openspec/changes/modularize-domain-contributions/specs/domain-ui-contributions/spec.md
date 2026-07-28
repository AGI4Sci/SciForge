# Domain UI contributions

## Requirements

### Requirement: One generic renderer contribution contract

The renderer SDK SHALL provide owner-aware contribution contracts for commands, Workbench right panels, Workbench bottom panels, application overlays, and bounded composer context without naming a concrete domain in Host core.

#### Scenario: Package declares renderer surfaces

- **WHEN** an enabled package declares one or more supported renderer contributions
- **THEN** its renderer entrypoint binds each declaration by exact kind and stable ID
- **AND** the Host exposes the contributions through their generic slots
- **AND** the Workbench SHALL NOT import or branch on that package's feature implementation

#### Scenario: Unsupported or mismatched contribution

- **WHEN** an entrypoint supplies a missing, extra, duplicate, or wrong-kind renderer contribution
- **THEN** activation fails before any contribution from that package becomes visible

### Requirement: Commands are execution identity

A package SHALL publish each user action as one stable `renderer.command`, and toolbar, menu, shortcut, or other launch placements SHALL reference that command rather than own separate execution callbacks.

#### Scenario: Same command in multiple placements

- **WHEN** a package command is visible in the toolbar and another registered placement
- **THEN** both placements invoke the same command ID, contextual availability, and canonical execution path

#### Scenario: Command hidden from toolbar

- **WHEN** the user hides a command's toolbar placement
- **THEN** the command remains registered for other placements while its package is enabled

### Requirement: Typed right and bottom panels

The Host SHALL resolve right and bottom Workbench panels from separate typed contribution slots with package-owned renderers and Host-owned layout, focus, accessibility, and error boundaries.

#### Scenario: Open a right panel

- **WHEN** an available command targets a contributed right panel
- **THEN** the focused Session's generic right-panel workspace opens that panel by stable contribution ID
- **AND** package-defined visible-context metadata is exposed through the standard context path

#### Scenario: Open a bottom panel

- **WHEN** an available command targets a contributed bottom panel
- **THEN** the generic bottom-panel outlet opens it with Host-governed sizing and focus
- **AND** the Host does not add a package-specific layout branch

### Requirement: Controlled overlay contributions

The Host SHALL mount application overlay contributions only while their enabled package and explicit activation state are active, with deterministic z-order, sensitive-target policy, error isolation, and cleanup.

#### Scenario: Activate an overlay

- **WHEN** the user invokes a command that activates an enabled overlay contribution
- **THEN** the generic overlay outlet mounts the package renderer at its deterministic layer
- **AND** the overlay receives only its declared Host contract

#### Scenario: Disable during overlay interaction

- **WHEN** the owning package is disabled or disposed while its overlay is active
- **THEN** pointer interception, subscriptions, transient state, and rendered overlay are removed
- **AND** no overlay callback runs after disposal

### Requirement: Bounded composer context

A `renderer.composer-context` contribution SHALL expose serializable display references and bounded send-time runtime context without directly mutating the message or invoking a parallel backend operation.

#### Scenario: Send selected package context

- **WHEN** the user explicitly selects context owned by an enabled package and sends a message
- **THEN** the composer resolves that provider at send time
- **AND** shows package-owned context chips
- **AND** includes only schema-valid context within Host count and byte limits

#### Scenario: Provider unavailable

- **WHEN** selected context belongs to a disabled, uninstalled, failed, or disposed package
- **THEN** the composer fails visibly or omits it according to the generic context policy
- **AND** SHALL NOT import the package implementation or use a legacy feature branch

### Requirement: Atomic lifecycle

Renderer contributions SHALL activate as one owner-scoped batch and SHALL dispose in reverse registration order idempotently.

#### Scenario: Activation fails

- **WHEN** validation or construction of any declared renderer contribution fails
- **THEN** none of the package's commands, panels, overlays, or composer providers remain registered

#### Scenario: Package disabled

- **WHEN** an enabled package is disabled
- **THEN** new renderer invocations are blocked before disposal begins
- **AND** all of its contribution registrations and mounted surfaces are removed
- **AND** repeated disposal has no additional effect
