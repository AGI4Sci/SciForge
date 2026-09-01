## ADDED Requirements

### Requirement: Project derivation uses explicit Goal, Scope, and exact Evidence inputs

Project SHALL own exactly one Research Project for one canonical SciForge Workspace and SHALL derive its provisional view from a versioned Goal, an explicit captured Scope of included, excluded, and isolated Sessions with reasons, exact Evidence head or sealed-Snapshot identities, policy version, and compiler version. This change SHALL NOT add create/list/select/active-project state. On first initialization Project MAY visibly include the current Session and recommend related Sessions, but SHALL NOT silently add every Workspace Session or rescan outside selected Scope.

#### Scenario: A researcher initializes the Workspace Project from one Session

- **WHEN** the researcher initializes Goal and Scope while viewing a Session
- **THEN** the current Session is visibly included and related Sessions are offered as recommendations
- **AND** only Sessions the researcher applies become part of captured Scope.

#### Scenario: Scope excludes a Session

- **WHEN** a researcher excludes or isolates a Session
- **THEN** Project records the reason, derives the new input fingerprint, and exposes affected conclusions, conflicts, coverage, and approvals
- **AND** does not modify the Session or its Evidence history.

#### Scenario: A submitted Evidence identity regresses

- **WHEN** a derivation request would replace a selected Session's newer applied Evidence head with an older head without selecting a historical baseline explicitly
- **THEN** Project rejects the regression rather than silently deriving a current view from older Evidence.

### Requirement: Project views are demand-driven disposable read models

Project SHALL use one package-owned compiler to derive or refresh the provisional Project view when its surface opens, Goal or Scope is applied, an Agent requests synthesis, a retry is requested, or a Decision/Review/Release barrier requires it. Upstream changes SHALL mark the Workspace Project stale through a lightweight freshness index and SHALL NOT compile while the Project surface is closed.

#### Scenario: A closed Project surface receives new Evidence

- **WHEN** a selected Session advances its Evidence head while the Project surface is closed
- **THEN** Project records the desired input digest and stale reason without compiling a new immutable Project Snapshot
- **AND** the last-good Project view remains readable as based on older Evidence.

#### Scenario: The researcher opens a stale Project

- **WHEN** the researcher opens a Project whose desired input differs from its applied view
- **THEN** Project derives or schedules the canonical compiler for the new fingerprint and shows last-good conclusions with explicit stale state until success
- **AND** no second UI-only synthesis path interprets the Sessions.

#### Scenario: Identical derivation is requested repeatedly

- **WHEN** several callers request the same Goal, Scope, Evidence vector, policy, and compiler fingerprint
- **THEN** Project reuses one canonical active or cached derivation without advancing a scientific version.

### Requirement: Formal Project use seals an immutable Project Snapshot

Before a Project conclusion or view is referenced by a Decision, Approval, collaborative review, Release, export, formal comparison, or other high-impact operation, Project SHALL satisfy the applicable freshness and coverage barrier, seal required Evidence closures, and commit an immutable Project Snapshot bound to exact Goal, captured Scope, Evidence vector, closure identities, policy/compiler identities, graph output, coverage, gaps, conflicts, and output Artifact Version refs. Sealing SHALL compare-and-set an explicit expected head digest and SHALL NOT resolve `latest` during commit. AuditRun, Finding, Review, Decision, Approval, and Release records created from the Snapshot SHALL reference it as append-only sidechains and SHALL NOT be backfilled into that Snapshot.

#### Scenario: A provisional conclusion enters a Decision

- **WHEN** a user or Agent attempts to decide from a provisional Project view
- **THEN** Project first seals an exact Snapshot and the Decision binds its `projectKey + digest`
- **AND** the Decision does not reference `current` or a cache identity.

#### Scenario: Required Evidence is incomplete

- **WHEN** the relevant Evidence barrier is lagging, incomplete, inaccessible, or has a blocking gap
- **THEN** Project may save a draft Snapshot or Decision Packet that truthfully records the gap
- **AND** SHALL NOT present it as certification-ready.

#### Scenario: Project inputs materially change after approval

- **WHEN** Goal, captured Scope, Evidence head/closure, policy, action target, or output Artifact changes after an Approval
- **THEN** Project derives that Approval as expired and requires a new exact Snapshot and Approval
- **AND** retains the historical Approval unchanged.

### Requirement: Project invalidation is deterministic and fail-closed

`ProjectInvalidationPolicyV1` SHALL classify exact fingerprint fields. Goal intent, captured Scope, Evidence refs/digests, Evidence schema/extractor/verifier/closure policy, Project compiler/policy, source and Artifact lifecycle state, ACL/consent/retention revision, action/target, output Artifact refs, and gate-relevant risk changes SHALL be material. Enumerated layout and presentation changes MAY be non-material. An unknown field SHALL be material at a formal gate.

#### Scenario: Evidence compiler policy changes

- **WHEN** a Snapshot's exact Evidence compiler or closure-policy version differs from the current formal input
- **THEN** Project marks the old view stale and derives bound Approvals as expired for new action
- **AND** retains the historical Snapshot and Approval unchanged.

### Requirement: Project distinguishes independent Evidence from repeated ancestry

Project SHALL preserve exact origin paths and SHALL NOT count different Sessions as independent support merely because their Claim IDs differ. Shared Artifact, Source Anchor, Dataset, Run, code, or other material ancestry SHALL be visible, and unresolved independence SHALL be reported as unknown rather than assumed.

#### Scenario: Three Sessions quote the same paper

- **WHEN** three included Sessions derive support from the same paper Version or equivalent source lineage
- **THEN** Project groups them as shared ancestry for independence and coverage summaries
- **AND** does not advertise three independent replications.

#### Scenario: Independence cannot be proved

- **WHEN** lineage is incomplete or access restrictions prevent comparison
- **THEN** Project reports independence as unknown with an access or coverage breakpoint
- **AND** does not inflate evidence strength.

### Requirement: Legacy Snapshots remain exact roots without invented history

Existing committed Project Snapshots SHALL retain their original bytes and digests. Migration SHALL represent a Snapshot whose complete predecessor/input trace cannot be proven as `legacy_checkpoint_root` with `legacy/incomplete` coverage. Cutover SHALL inventory all readers/writers, transactionally build the new index, verify every root, switch the canonical read/write path without dual-read or dual-write fallback, and delete obsolete paths only after readiness passes.

#### Scenario: A legacy Snapshot lacks complete Evidence ancestry

- **WHEN** migration can resolve the historical Snapshot but cannot prove its full predecessor vector
- **THEN** the Snapshot remains exact-readable as a legacy root with an explicit incomplete breakpoint
- **AND** the migration does not fabricate missing deltas or certify it as complete.

### Requirement: Goal and Scope evolution preserves historical meaning

Goal editing SHALL use a mutable draft followed by an applied Goal Version. Applying a change to root intent, primary endpoint, or formal success criterion SHALL require an impact-aware reframe Decision. Desired Session Scope MAY be edited as a revisioned working document, but every Project Snapshot SHALL capture its exact included, excluded, and isolated Sessions and reasons.

#### Scenario: Goal wording changes cosmetically

- **WHEN** a draft edit does not change scientific intent according to the user-confirmed impact summary
- **THEN** Project may create the next Goal Version without a high-impact reframe gate
- **AND** still binds later formal Snapshots to that exact Version.

#### Scenario: Goal changes the primary endpoint

- **WHEN** the applied draft changes the primary endpoint or success criterion
- **THEN** Project presents affected Claims, Sessions, Artifacts, Decisions, and Approvals and records an explicit reframe Decision
- **AND** historical Snapshots continue to resolve against the old Goal Version.

### Requirement: Decision, Review, Approval, and Release are append-only exact records

Project SHALL record minimal append-only `DecisionV1`, `ApprovalV1`, and `ReleaseV1` records. A Decision SHALL bind one exact Project Snapshot plus action, target, actor, rationale, reversibility, and policy. An Approval SHALL bind the exact Decision plus attestor, trusted role assertion, attestation, and policy. A Release SHALL bind the exact Project Snapshot, typed output Artifact Versions, audit/Decision/Approval refs, classification, target, and attempt outcome. Finding and Review changes SHALL append typed events whose current state is derived. Goal, Scope, Evidence, and conclusions SHALL NOT be redundantly copied into every sidechain record. Correction or reversal SHALL append a superseding, reversing, expiring, revoking, or compensating event.

#### Scenario: A researcher changes a prior Decision

- **WHEN** a researcher reverses or corrects a prior Decision
- **THEN** Project appends a new Decision that references and supersedes or reverses the old Decision
- **AND** current status is derived from the event chain.

#### Scenario: A Release candidate is certified

- **WHEN** a candidate passes the applicable barriers and is approved for certification
- **THEN** Project appends a new certified Release Record bound to exact inputs
- **AND** does not mutate the candidate record in place.

### Requirement: Certified release requires policy-defined accountable human approval

An unresolved critical Finding MAY be accepted by policy for internal, reversible, non-certified work. Every certified/public Release or publication submission SHALL require at least one accountable-human Approval. Specialized action classes SHALL additionally require the trusted role slots and quorum declared by the exact `DecisionPolicyV1`; when the role source or quorum is unavailable, Project SHALL return `blocked_by_policy`. Scientific risk acceptance SHALL be recorded separately from Runtime authorization for the external action.

#### Scenario: Autonomous policy permits internal override

- **WHEN** an Agent records an override for internal reversible work under an exact policy and Snapshot
- **THEN** Project preserves that Decision and may continue the internal workflow
- **AND** marks it insufficient for later certified/public release.

#### Scenario: Certified release has no critical risk

- **WHEN** a certified/public Release passes deterministic audit without an unresolved critical Finding
- **THEN** Project still requires at least one accountable-human Approval bound to the exact Decision and Snapshot
- **AND** Runtime separately authorizes the external target.

#### Scenario: Certified release has unresolved critical risk

- **WHEN** a certified/public Release is requested with an unresolved critical Finding
- **THEN** Project requires a human Decision/Approval with rationale and responsibility scope bound to the exact Snapshot
- **AND** Runtime still verifies independent permission to execute the release.

### Requirement: Project exposes compact status and advanced graph separately

Project SHALL expose owner-derived Goal, Scope, freshness, coverage, risk, pending-decision, and exact Snapshot identity suitable for a compact Research summary. Full graph, queue history, compiler receipts, and raw digests SHALL remain an owner-provided advanced view and SHALL NOT be required for ordinary Project use.

#### Scenario: Research renders a Project summary

- **WHEN** the Research landing view invokes the installed Project `renderer.research-summary.v1` contribution
- **THEN** Project returns a bounded owner read model containing Goal, Scope counts, freshness, coverage/gaps, material risks, and pending decisions
- **AND** Research does not read Project persistence or copy the graph.
