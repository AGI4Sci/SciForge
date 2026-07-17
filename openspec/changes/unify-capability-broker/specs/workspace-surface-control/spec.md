## ADDED Requirements

### Requirement: Workspace surfaces expose executable observations
Workspace Preview and Biology Room SHALL expose observations containing current semantic revision and executable operation descriptors derived from the registered provider.

#### Scenario: Agent observes an open workspace surface
- **WHEN** an authorized agent observes a Workspace Preview or Biology Room resource
- **THEN** it receives a scoped handle, structured state, and operation IDs with input schemas and availability instead of only an action count or textual hint
- **AND** operation schemas are represented by references so current state is not hidden by a large inline catalog

### Requirement: Workspace Preview uses its canonical host
Workspace Preview UI and agent operations SHALL invoke the existing main-process Workspace Preview host through the capability broker.

#### Scenario: PDF annotation action
- **WHEN** an agent invokes an annotation operation returned by a PDF observation
- **THEN** the Workspace Preview host performs the action, its internal annotation storage is updated, and the caller never reads or writes a sidecar path directly

#### Scenario: Unsupported operation
- **WHEN** a file observation does not offer a requested operation
- **THEN** the broker rejects it without adding a format-specific fallback or shell path

#### Scenario: Observe current PDF annotations
- **WHEN** a caller observes a PDF with annotation threads
- **THEN** the compact state includes current canonical thread summaries and distinct thread and annotation record counts

#### Scenario: Legacy or backup sidecars exist
- **WHEN** normal observation resolves the document annotation store
- **THEN** it reads only the canonical workspace-root sidecar and does not scan, promote, or merge legacy or backup files

### Requirement: Surface inspection uses the broker
Workspace surfaces SHALL expose visual inspection as a registered read operation whose provider resolves the current layout at execution time.

#### Scenario: Layout changes after observation
- **WHEN** a surface scrolls, resizes, rerenders, or moves after an agent observes it
- **THEN** `surface.inspect` uses the latest target layout and the semantic handle remains valid

#### Scenario: Semantic content changes after observation
- **WHEN** the inspected resource content changes
- **THEN** its semantic revision advances and a subsequent operation observes or resolves the new resource state

### Requirement: Biology Room uses its canonical service
Biology Room UI and agent operations SHALL invoke the existing Biology Room service through the capability broker.

#### Scenario: Valid revisioned Biology Room operation
- **WHEN** a caller invokes an available Biology Room operation with the current revision
- **THEN** the canonical service applies it and the broker publishes the resulting revision and change event

### Requirement: Surface changes refresh all clients
Successful surface mutations SHALL cause subscribed renderer and agent clients to observe the new state without manual per-feature refresh chains.

#### Scenario: Agent mutation while renderer is open
- **WHEN** an agent changes an open workspace surface
- **THEN** the renderer receives a resource change event and re-observes the updated state

### Requirement: No conflicting migrated path
After a workspace surface is migrated, SciForge MUST NOT retain agent-visible sidecar instructions, nonexistent tool hints, agent access to ambiguous preview dispatch, or a second direct mutation route. A generic UI-only dispatcher MAY remain for plugin domains not yet migrated, but it MUST exclude migrated annotation actions.

#### Scenario: Architecture boundary scan
- **WHEN** the migrated source tree is checked in CI
- **THEN** banned hints, aliases, and direct mutation paths are absent
