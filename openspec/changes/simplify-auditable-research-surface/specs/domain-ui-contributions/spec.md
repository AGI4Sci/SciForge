## ADDED Requirements

### Requirement: Research summaries are generic bounded owner contributions

Domain SDK SHALL expose one generic `renderer.research-summary.v1` contribution contract containing a stable contribution ID, one generic slot, order, applicable resource/scope kinds, a bounded read-model provider, and exact resource-navigation actions. Research Dossier SHALL enumerate installed contributions without a domain-ID switch, owner-schema dependency, package-private import, or summary-state store. Each owner SHALL authorize and filter its payload before returning it.

#### Scenario: Evidence contributes compact status

- **WHEN** Evidence DAG is installed and the Research surface requests the current Workspace summary
- **THEN** generated composition invokes Evidence's bounded summary contribution for the applicable scope
- **AND** Dossier receives only access-filtered freshness, coverage, risk, and exact navigation refs rather than Evidence's private graph state.

#### Scenario: A summary owner is unavailable

- **WHEN** one installed owner cannot authorize, compute, or return its summary
- **THEN** its contribution returns a bounded unavailable state
- **AND** the Research surface renders the other contributions without treating absence as a healthy result or caching the failed owner's state.

#### Scenario: A package is removed

- **WHEN** an installed package and its manifest are removed
- **THEN** generated composition removes its summary and navigation contributions together
- **AND** neither Host nor Dossier requires a feature-map edit.

### Requirement: Research surfaces compose through generic package contributions

Installed domain packages SHALL contribute the one primary Research entry, exact resource navigators, and owner views through generic renderer contribution contracts. The Host SHALL compose generated package entrypoints only and SHALL NOT contain a Research feature map, resource-kind switch, domain-specific tab list, or package-private import.

#### Scenario: Scientific Plotting adds an exact Figure navigator

- **WHEN** the installed Scientific Plotting package declares its compatible resource-navigation contribution
- **THEN** generated renderer composition exposes it without an edit to Workbench or Research Dossier
- **AND** removing the package removes that navigator and view together.

#### Scenario: Two packages claim the same resource kind

- **WHEN** incompatible navigators claim one canonical exact resource kind
- **THEN** composition fails deterministically before either view is activated.

### Requirement: Primary and advanced presentation does not create parallel commands

Ordinary toolbar presentation SHALL expose one Research entry. Owner graph, plot, and version surfaces SHALL be reachable contextually or as advanced actions through their canonical contribution/navigation path. Removing peer toolbar actions SHALL remove orphaned command handlers after caller audit and SHALL NOT retain aliases, forwarding layers, or Host special cases.

#### Scenario: Advanced Evidence graph is opened

- **WHEN** a researcher requests the full graph from an exact Claim or Evidence closure
- **THEN** the Evidence owner view opens through resource navigation in the Session-owned panel
- **AND** no hidden peer toolbar action or duplicate open command is required.

#### Scenario: Artifact Versions renderer is removed

- **WHEN** all ordinary history and restore callers use contextual Dossier/Plot paths
- **THEN** generated composition omits the Artifact Versions renderer contribution while its backend capabilities remain installed
- **AND** no compatibility surface is registered.
