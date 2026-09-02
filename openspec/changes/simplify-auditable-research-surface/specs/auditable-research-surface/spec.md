## ADDED Requirements

### Requirement: One primary Research entry uses owner-provided views

SciForge SHALL expose one ordinary workbench entry labelled `Research` and SHALL route exact research resources to their package-owned Dossier, Scientific Plotting, Evidence, Project, or Artifact-history view through generic resource navigation. Its overview SHALL compose access-filtered `renderer.research-summary.v1` contributions and SHALL NOT own or copy Artifact, Evidence, Project, Decision, Review, Release, summary, or current-pointer state. The Host and Dossier SHALL NOT select views through domain-ID switches.

#### Scenario: Research opens without a selected resource

- **WHEN** the researcher opens the primary Research entry without a selected exact resource
- **THEN** the Research Dossier landing view shows the current research overview and contextual navigation available from owner-provided read models
- **AND** no adjacent domain UI or private state is imported into the Dossier package.

#### Scenario: A researcher opens a Figure from chat

- **WHEN** a chat result or Artifact card opens an exact Figure or render-manifest Version
- **THEN** generic resource navigation activates the Scientific Plotting owner view in the same right-panel dock
- **AND** back navigation returns to the originating Research context without copying the Figure into Dossier state.

#### Scenario: A domain package is removed

- **WHEN** an optional Plot, Evidence, or Project package is absent from generated installed-domain composition
- **THEN** its resource kinds and owner views disappear without editing a Host feature map
- **AND** the Research landing view degrades only the missing contextual action.

### Requirement: Research navigation follows researcher tasks

The default Research experience SHALL organize information as Overview, Artifacts, and Evidence. Project Goal and Session Scope SHALL be visible in Overview; Figure detail SHALL present Preview, Reproduce, Evidence, and Versions; full graph visualization SHALL be an explicit advanced action rather than the default Evidence or Project view.

#### Scenario: A Figure is the current resource

- **WHEN** the exact current resource is a Figure
- **THEN** its image preview is the first content shown
- **AND** code, Prompt, model, data, environment, manifest, digest, and graph details remain available through Reproduce, Evidence, Versions, or Technical Details.

#### Scenario: A Claim is the current resource

- **WHEN** the exact current resource is a Claim or Source Anchor
- **THEN** the Evidence owner shows the conclusion, applicability, strongest support, strongest contradiction, coverage, and gaps before offering the full graph.

#### Scenario: The workspace Project is not initialized

- **WHEN** a researcher views or reproduces a standalone Artifact before initializing Goal and Scope
- **THEN** Artifact and Evidence functionality remains available
- **AND** SciForge does not require Project initialization or fabricate Project state.

### Requirement: Ordinary UI exposes scientific state without implementation state

The ordinary Research surface SHALL show Evidence freshness, Scope coverage, material risk, and Artifact reproduction as separate dimensions. It SHALL NOT collapse integrity, reproducibility, scientific validity, freshness, access, or approval into one trusted flag, and SHALL hide raw queue, receipt, watermark, digest, and graph-layout details unless Technical Details is opened.

#### Scenario: A reproducible Figure has uncompiled Evidence

- **WHEN** a Figure has an exact Code Artifact and successful rerun but its Evidence input is pending or stale
- **THEN** the UI shows its reproduction as exact and its Evidence as updating or based on older evidence
- **AND** does not present a single green scientific-verification status.

#### Scenario: A pending update fails

- **WHEN** an older owner snapshot or view remains readable and the newest update fails
- **THEN** the last-good content remains visible with a `based on older evidence` or `needs attention` indication
- **AND** only the canonical owner offers retry diagnostics.

#### Scenario: A critical issue exists

- **WHEN** a current Claim, Artifact, Project, or Release path has a critical Finding, missing source, access breakpoint, failed reproduction, or incomplete coverage
- **THEN** the ordinary view exposes the risk and a precise navigation action
- **AND** does not require the researcher to open the advanced graph to discover it.

### Requirement: Owner actions remain canonical

Research surfaces SHALL navigate or invoke only package-owned public capabilities. Scientific Plotting owns rerun and compare, Artifact Versions owns restore and bundle operations, Evidence owns claim/source review and sealing, Project owns Goal/Scope/Decision/Release, and Runtime owns external-action permission. No Research view SHALL implement a second repair, review, refresh, or write path.

#### Scenario: A researcher restores plot code

- **WHEN** the researcher restores an exact historical Code Artifact from Figure Reproduce
- **THEN** Scientific Plotting invokes Artifact Versions materialize or restore-as-new through the public capability path
- **AND** Dossier does not write workspace files or Artifact history itself.

#### Scenario: A researcher challenges a Claim

- **WHEN** the researcher chooses `Challenge` from a Research summary
- **THEN** navigation targets the exact Evidence Claim/closure and Evidence records the action through its canonical assessment/decision path
- **AND** the summary does not mutate Claim state locally.

### Requirement: Research reads preserve owner access boundaries

Every Artifact, Evidence closure, Project Snapshot, Decision Packet, summary, preview, export, and Release read SHALL be authorized by its owner against the current Principal, purpose, consent, policy revision, and complete exact provenance path. A restricted ancestor SHALL restrict the result. Research SHALL receive an already filtered payload or bounded unavailable state and SHALL NOT receive an unfiltered aggregate for client-side permission filtering.

#### Scenario: A summary depends on restricted Evidence

- **WHEN** the current Principal cannot read an upstream source required by a Project summary
- **THEN** the Project owner returns a restricted or unavailable bounded summary with only policy-permitted existence information
- **AND** Research does not cache or expose the protected Claim, source, or derived conclusion.

### Requirement: Decision packets ask only accountable questions

SciForge SHALL present a Decision Packet when a material scientific or high-impact action requires accountable judgement. The packet SHALL identify the question, trigger, exact bound inputs, strongest support and contradiction, missing information, blast radius, alternatives, recommended action, required role, and consequences. It SHALL NOT use a generic `continue?` approval or require the researcher to inspect a full DAG before deciding.

#### Scenario: Root Goal is reframed

- **WHEN** applying a Goal draft changes the root research intent, primary endpoint, or formal success criterion
- **THEN** the packet shows affected Sessions, Claims, Artifacts, Decisions, and Approvals
- **AND** confirmation creates a new Goal Version and explicit reframe Decision without rewriting the old Goal.

#### Scenario: Scope removes a negative result

- **WHEN** applying Project Scope excludes or isolates a Session containing a contradicting or failed-replication result
- **THEN** the packet highlights that impact and records the exclusion reason
- **AND** any previous conclusion or approval dependent on the old Scope becomes stale or expired.

### Requirement: Scientific approval and runtime authorization are independent

Every certified/public release or publication submission SHALL require at least one accountable-human Approval. Unresolved critical-risk override, restricted export, formal data correction affecting conclusions, and specialized high-impact actions SHALL additionally require the installed Decision Policy's trusted role slots and quorum. Runtime authorization SHALL remain a separate exact prerequisite, and an Agent SHALL NOT occupy an accountable-human role.

#### Scenario: Agent proposes critical-risk release

- **WHEN** an Agent prepares a certified/public Release while a critical Finding remains unresolved
- **THEN** SciForge may generate a recommendation and Decision Packet but SHALL require an accountable human Approval bound to the exact baseline
- **AND** Runtime export permission remains independently required.

#### Scenario: Internal reversible work accepts risk

- **WHEN** policy allows an Agent to accept a risk for internal, reversible, non-certified work
- **THEN** the Agent Decision records exact inputs, actor, rationale, alternatives, reversibility, and policy
- **AND** that Decision cannot satisfy a later certified/public human-approval gate.

### Requirement: Explicit plot-provenance requests use governed Scientific Plotting

Agent routing SHALL lock explicit requests for scientific plot provenance, governed plot reproducibility, or the Scientific Plotting route to the package-owned Scientific Plotting capability. A model-owned fallback MAY be used only when allowed by the request or when code rendering is unavailable, and the result SHALL disclose that it is replayable rather than exactly reproducible.

#### Scenario: User requests code-reproducible plot provenance

- **WHEN** the user explicitly requests a code-reproducible scientific plot with provenance
- **THEN** the Agent uses the formal code/hybrid render route, commits an executable Code Artifact with exact dependencies, and opens the exact Figure reproduction view
- **AND** an arbitrary workspace image or terminal-generated PNG does not satisfy the request.

#### Scenario: Governed model-owned fallback is used

- **WHEN** a model-owned visual route is allowed and selected
- **THEN** the worker saves the effective Prompt, public model/version, parameters, references, seed when available, renderer, and replay recipe
- **AND** the UI labels the result replayable and does not claim deterministic pixel reproduction.

### Requirement: Technical surfaces are secondary and restorable without compatibility aliases

Evidence Graph, Project Graph, plot technical details, and raw Artifact history MAY remain accessible through contextual or advanced actions, but they SHALL NOT occupy ordinary peer toolbar entries. Removed toolbar commands or renderer surfaces SHALL be deleted after caller audit rather than retained through aliases, forwarding handlers, or Host hard-coding.

#### Scenario: An advanced reviewer opens the full graph

- **WHEN** an authorized reviewer explicitly chooses the advanced relationship view
- **THEN** the owner package opens the exact graph or Snapshot through resource navigation
- **AND** closing or navigating back returns to the same Session-owned Research surface.
