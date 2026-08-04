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

### Requirement: Surface inspection uses Agent Visual Runtime
Workspace surfaces SHALL publish generic visual sources whose native look provider resolves the current layout at execution time.

#### Scenario: Layout changes after observation
- **WHEN** a surface scrolls, resizes, rerenders, or moves after an agent observes it
- **THEN** `sciforge_look` uses the latest target layout and the semantic handle remains valid

#### Scenario: Semantic content changes after observation
- **WHEN** the inspected resource content changes
- **THEN** its semantic revision advances and a subsequent operation observes or resolves the new resource state

#### Scenario: Hidden session continues semantic work
- **WHEN** a user switches away from a session whose agent turn is operating on a bound Workspace Preview resource
- **THEN** annotation, document, and other semantic provider operations continue against that bound resource

#### Scenario: Hidden session requests live-surface visual inspection
- **WHEN** a hidden turn requests `sciforge_look` against its live surface after another session becomes visible
- **THEN** inspection fails visibly as layout unavailable and never captures the foreground session as evidence for the hidden turn

#### Scenario: Hidden session inspects its task-bound preview resource
- **WHEN** a hidden turn requests `sciforge_look` with the retained opaque reference of its question-time Workspace Preview resource
- **THEN** the provider renders that retained resource independently of the foreground surface and UI cleanup cannot retire it before terminal task cleanup

#### Scenario: Stale layout is refreshed on demand
- **WHEN** a still-visible bound surface has exceeded its layout freshness threshold and `sciforge_look` is invoked
- **THEN** the main process requests a renderer publication and resolves the target against the refreshed layout before capture

#### Scenario: Same turn publishes new messages or layout
- **WHEN** the bound runtime and thread remain current while message count, busy state, timeline state, or layout publication changes
- **THEN** `sciforge_look` preserves the turn ownership binding, rebases to the latest layout, and does not report that another session is visible

#### Scenario: Text-primary visual reasoning
- **WHEN** `sciforge_look` inspects an authorized immutable snapshot
- **THEN** a vision translator produces grounded observation evidence and the configured text reasoner remains the primary model for synthesis and final reasoning

#### Scenario: Successful Responses payload includes a null error
- **WHEN** the vision provider returns a completed Responses payload with model output and `error: null`
- **THEN** Model Router accepts the output as successful evidence and does not switch to a text-only degradation path

#### Scenario: Vision evidence is unavailable
- **WHEN** the vision translator cannot produce evidence for a strict native visual inspection
- **THEN** the inspection fails with a typed provider or evidence cause and returns no proof instead of a text-only HTTP-success response

#### Scenario: Browser development surface requests native visual proof
- **WHEN** `sciforge_look` targets the current browser development surface
- **THEN** the main-process bridge challenges the exact connected client for pixels bound to the current layout revision and requested bounds
- **AND** only a bounded PNG matching the client, challenge, revision, dimensions, and crop scale proceeds to Host-owned redaction and inspection

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
