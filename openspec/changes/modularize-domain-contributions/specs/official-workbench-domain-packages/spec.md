# Official Workbench domain packages

## Requirements

### Requirement: Six independent official packages

SciForge SHALL own Create Loop, Visual Review, Change Inspector, Terminal, Anchored Comments, and Git Checkpoints as the independent domain packages `@sciforge/domain-create-loop`, `@sciforge/domain-visual-review`, `@sciforge/domain-change-inspector`, `@sciforge/domain-terminal`, `@sciforge/domain-anchored-comments`, and `@sciforge/domain-git-checkpoints`.

#### Scenario: Discover installed official packages

- **WHEN** generated installed-domain composition is built
- **THEN** all six package definitions are discovered through their manifests
- **AND** main and renderer receive only their process-specific entrypoints
- **AND** Host core contains no parallel six-item feature map or domain-ID switch

#### Scenario: Remove one package from composition

- **WHEN** one package is absent from the selected installed-domain set
- **THEN** only that package's commands, views, overlay, composer context, capabilities, and runtime lifecycle are absent
- **AND** no Host feature map is edited
- **AND** the other five packages remain unchanged

### Requirement: Preinstalled and default enabled

The signed SciForge distribution SHALL represent all six packages as preinstalled and enabled by default for fresh and migrated installations.

#### Scenario: Fresh installation

- **WHEN** SciForge initializes package state for the first time
- **THEN** all six official packages are installed and enabled
- **AND** their package-declared default commands and surfaces preserve current product availability

#### Scenario: Existing installation migrates

- **WHEN** an existing user upgrades to the package-owned implementation without an explicit prior disable choice
- **THEN** all six packages are enabled
- **AND** existing toolbar placement and session layout preferences are preserved by stable IDs

### Requirement: Package-complete ownership

Each official package SHALL own its manifest, version, pure shared contract, process-separated entrypoints, renderer contributions, main capabilities, runtime lifecycle, tests, and package-specific assets or workers.

#### Scenario: Package boundary audit

- **WHEN** architecture checks scan an official package
- **THEN** it imports only public SDK or package exports
- **AND** it does not import Host-private main, renderer, shared, preload, or another domain's implementation source

#### Scenario: UI-only package process

- **WHEN** a package has no main contribution for a supported build
- **THEN** it may omit the main entrypoint
- **AND** SHALL NOT add an empty Host facade or lifecycle solely to satisfy symmetry

### Requirement: Capability Broker is the business authority

Every migrated package operation SHALL use a package-owned Capability Broker definition for UI, agent, and generic adapter callers, with no second domain-specific IPC, preload, service facade, or MCP business implementation.

#### Scenario: Invoke from UI and agent

- **WHEN** a UI command and an agent request perform the same package operation
- **THEN** both resolve the same capability definition, validation, authorization, idempotency, audit, and handler

#### Scenario: Disabled package invocation

- **WHEN** a caller invokes a capability after its package is disabled or before activation commits
- **THEN** invocation fails closed
- **AND** no retired direct transport or Host service fallback runs

### Requirement: Owner-scoped runtime lifecycle

A package that owns background services, processes, subscriptions, or sessions SHALL expose them through `main.runtime-lifecycle` and SHALL release them when activation fails, the package is disabled, its active version changes, or the application shuts down.

#### Scenario: Successful activation

- **WHEN** a package's manifest, entrypoint, contributions, and required capabilities validate
- **THEN** the Host commits its owner-scoped registrations atomically
- **AND** starts its runtime lifecycle only through the canonical package activation path

#### Scenario: Disable with live resources

- **WHEN** Terminal has live sessions, Create Loop has active runtime resources, or another package has subscriptions when disabled
- **THEN** new capability calls are blocked
- **AND** owned resources are disposed in reverse order
- **AND** disposal is idempotent
- **AND** no events are delivered after disposal

### Requirement: Independent lifecycle states

The Host SHALL distinguish toolbar placement, package enablement, and package installation.

#### Scenario: Hidden but enabled

- **WHEN** an official package's toolbar command is hidden
- **THEN** the package remains enabled
- **AND** its non-toolbar placements, views, overlays, composer context, capabilities, and runtime remain active

#### Scenario: Disabled but installed

- **WHEN** an official package is disabled
- **THEN** its artifact remains installed and its settings, data, and stable-ID placement preferences remain intact
- **AND** none of its contributions or runtime resources remain active

#### Scenario: Uninstalled or absent

- **WHEN** package policy permits uninstall and the artifact is removed, or the package is absent from an installation
- **THEN** it cannot be enabled or activated
- **AND** the Host may retain bounded stable-ID preferences for later reinstall
- **AND** SHALL NOT report it as merely disabled or toolbar-hidden

#### Scenario: Protected bundled package

- **WHEN** product policy marks a preinstalled bundled package as non-removable
- **THEN** the uninstall action is unavailable with an explicit reason
- **AND** hide and disable retain their distinct semantics
