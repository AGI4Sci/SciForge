## ADDED Requirements

### Requirement: One authoritative Artifact Version owner supports researcher-facing artifacts

SciForge SHALL continue to assign Artifact identity, immutable Version records, verified bytes, current pointers, structural dependencies, lifecycle events, restore, compare, materialize, and bundles exclusively to Artifact Versions. `Research Artifact` SHALL be product language for one stable Artifact identity viewed at an exact Version and SHALL NOT introduce another registry, byte store, current pointer, or version schema.

#### Scenario: Research lists a scientific Figure

- **WHEN** a Figure has supporting recipe, code, derived-data, manifest, and log Versions
- **THEN** Research groups those exact dependencies under the root Figure Artifact instead of listing six unrelated recent products
- **AND** every dependency remains owned and exact-readable through Artifact Versions.

#### Scenario: A consumer references a current Artifact

- **WHEN** Evidence, Project, Decision, Approval, Release, export, or rerun needs an Artifact
- **THEN** the consumer pins the exact Artifact ID, Version ID, digest, and canonical ref
- **AND** rejects a request that supplies only current, latest, label, or mutable path.

### Requirement: Artifact content changes append whole Versions

Scientific content SHALL change only by committing a new whole Artifact Version. Scientific captions, bytes, dependencies, recipes, and version-bound restrictions SHALL be versioned content. Existing owner-controlled availability and current-pointer projections MAY change without mutating a Version. This change SHALL NOT introduce a second metadata authority for labels, tags, ordering, or archive state. Restore SHALL remain restore-as-new.

#### Scenario: A researcher changes a Figure caption

- **WHEN** the caption changes the scientific interpretation or declared result
- **THEN** the Figure is committed as a new Version with its exact dependencies
- **AND** the old caption remains available in the old Version.

#### Scenario: A historical Version is restored

- **WHEN** the researcher restores a historical Figure, Code, or Report Version
- **THEN** Artifact Versions commits a new semantic Version derived from the historical ref
- **AND** does not move current backward in a way that hides intermediate history.

### Requirement: Ordinary withdrawal preserves referenced audit history

Referenced Artifact Versions SHALL be withdrawn, retracted, marked unavailable, or superseded through existing owner lifecycle events rather than normally edited or deleted. Draft materializations and disposable caches MAY be hard-deleted. This change SHALL NOT add distributed legal/privacy purge semantics or a second retention authority.

#### Scenario: A researcher deletes an ordinary saved Figure

- **WHEN** the Figure Version is referenced by Evidence, Project, Decision, Approval, Release, or export
- **THEN** ordinary delete records the applicable owner lifecycle state and removes it from default current views
- **AND** authorized historical audit continues to resolve the exact record.

### Requirement: Plot reproduction is a Figure Version projection

Scientific Plot Provenance SHALL be the owner-provided reproduction view of an exact Figure/render-manifest Version and its declared dependencies, not an independent product registry or graph. The default Figure view SHALL show the image first and expose Preview, Reproduce, Evidence, and Versions through the Research surface.

#### Scenario: Code/hybrid Figure is saved

- **WHEN** Scientific Plotting completes a formal code/hybrid render
- **THEN** it copies the effective source bytes into a new immutable Code Artifact, atomically commits the Figure, recipe, declared data, manifest, and log with exact dependencies, and executes that committed Code Version
- **AND** the reproduction view can restore, rerun, and compare from those exact Versions.

#### Scenario: Model-owned Figure is saved

- **WHEN** a governed model-owned render is accepted
- **THEN** its Version retains the effective Prompt and hash, public model/version, generation parameters, references, seed when available, renderer, recipe, and review identity
- **AND** the reproduction view labels it replayable unless deterministic byte reproduction is proven.

#### Scenario: External paper Figure is referenced

- **WHEN** a paper Figure was not rendered by SciForge
- **THEN** Research presents it as a source Artifact with exact Source Anchor and source-location status
- **AND** does not claim that executable code or a model replay recipe exists.

### Requirement: Artifact availability and effective access remain live projections

An immutable Artifact Version ref SHALL fix content identity and version-bound restrictions but SHALL NOT imply permanent availability or authorization. Every exact read, materialize, bundle, export, rerun, or release SHALL re-evaluate current availability and effective access according to owner policy, current authorization, consent, purpose, and retention.

#### Scenario: A file moves without changing bytes

- **WHEN** Artifact Versions observes the same content digest at a new authorized locator
- **THEN** it updates locator/availability projection or appends the lifecycle observation without creating a content Version
- **AND** historical exact identity remains unchanged.

#### Scenario: Consent is withdrawn

- **WHEN** current consent or authorization no longer permits access to an immutable Version
- **THEN** exact reads and downstream actions fail closed or return a restricted projection according to policy
- **AND** historical permission metadata does not grant continued use.

### Requirement: Version and reproduction actions remain owner-canonical

Removing the ordinary Artifact Versions panel SHALL NOT create replacement restore, compare, bundle, materialize, or history implementations. Dossier and Scientific Plotting MAY present those actions only by invoking the existing Artifact Versions capabilities with exact refs.

#### Scenario: Standalone Artifact Versions UI is removed

- **WHEN** all Artifact history, restore, compare, materialize, and bundle consumers have exact contextual navigation
- **THEN** the renderer contribution and orphaned commands are deleted
- **AND** backend Artifact Versions capability ownership remains unchanged.
