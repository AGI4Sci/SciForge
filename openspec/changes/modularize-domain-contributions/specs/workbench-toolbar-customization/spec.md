# Workbench toolbar customization

## Requirements

### Requirement: User-owned placement

The host SHALL persist toolbar contribution visibility and ordering by stable contribution command ID.

#### Scenario: Default placement

- **WHEN** no user preference exists for an installed toolbar action
- **THEN** the action appears according to deterministic contribution order when contextually available

#### Scenario: Remove and add

- **WHEN** the user removes an installed action from the toolbar
- **THEN** the host hides only that toolbar placement without disabling or uninstalling its package
- **AND WHEN** the user adds it again
- **THEN** the action resumes using the same registered command and execution path

#### Scenario: Reorder

- **WHEN** the user moves an action in the configuration surface
- **THEN** the host persists and renders the new relative command order

### Requirement: Package lifecycle independence

The host SHALL keep placement preferences independent from package installation state.

#### Scenario: Temporarily missing package

- **WHEN** a command referenced by preferences is not currently installed
- **THEN** it is omitted from the toolbar and configuration surface without deleting the preference
- **AND WHEN** the same stable command is installed again
- **THEN** the retained preference applies

### Requirement: Bounded and recoverable configuration

The host SHALL normalize and bound persisted command IDs and SHALL provide a reset-to-default action.

#### Scenario: Reset

- **WHEN** the user resets toolbar customization
- **THEN** explicit ordering and hidden-command preferences are cleared
- **AND** installed actions return to package-declared deterministic defaults

### Requirement: Discoverable configuration

The Workbench SHALL expose the toolbar configuration entry with a visible text label in addition to its icon and accessible name.

#### Scenario: Locate configuration

- **WHEN** at least one configurable toolbar contribution is installed
- **THEN** the top bar displays a visibly labeled plugin-configuration control
- **AND** the control remains keyboard accessible and identifies the configuration dialog
