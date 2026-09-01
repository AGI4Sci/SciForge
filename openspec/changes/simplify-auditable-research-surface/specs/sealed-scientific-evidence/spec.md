## ADDED Requirements

### Requirement: Completed work appends an immutable Evidence delta chain

Evidence SHALL persist every governed completed turn or execution as an immutable, content-addressed delta bound to canonical thread/turn or execution scope, requested and committed watermark, predecessor and payload digests, schema and extractor/verifier identities, exact source/run/artifact references, and an idempotency key. Evidence SHALL reject missing predecessors, reordering, identity drift, scope mismatch, digest mismatch, or reuse of an idempotency key with different content.

#### Scenario: A completed turn is captured

- **WHEN** a completed turn contributes visible Claims, sources, Runs, or Artifact lineage
- **THEN** Evidence appends one exact delta after its predecessor and advances the authoritative Evidence head
- **AND** does not require publication of a complete immutable graph Snapshot for that turn.

#### Scenario: The same completed event is delivered again

- **WHEN** the canonical scope and idempotency key match an already committed delta with the same content
- **THEN** Evidence returns the same committed identity without appending another delta.

#### Scenario: A replay changes its payload

- **WHEN** an existing idempotency key is reused with a different trace, reference, extractor identity, or payload digest
- **THEN** Evidence fails closed and does not advance the head.

### Requirement: Provisional Evidence is a reconstructable interpretation

Evidence SHALL derive a provisional thread-scoped view from the immutable delta chain and SHALL treat extracted Claims, support, contradiction, applicability, independence, coverage, and attention as versioned interpretation rather than immutable scientific truth. The view SHALL be replaceable and SHALL carry its exact input fingerprint, compiler/policy identity, freshness, and last-good state.

#### Scenario: A newer extractor corrects an old interpretation

- **WHEN** recompilation determines that an older Claim or relationship misread negation, units, subgroup, or applicability
- **THEN** Evidence emits a corrected Claim, assessment, or superseding relationship in the new view
- **AND** retains the old delta and any sealed historical Snapshot unchanged.

#### Scenario: Provisional compilation fails

- **WHEN** compilation of the newest head fails
- **THEN** Evidence preserves the last-good view, records the desired and applied heads separately, and exposes bounded stale/error status
- **AND** does not label the last-good interpretation current.

### Requirement: Formal use seals a policy-complete Claim audit closure

Before a Claim is endorsed, challenged, used by a Project Decision, reviewed collaboratively, audited, shared, exported, published, or otherwise used as a formal baseline, Evidence SHALL seal an immutable Snapshot containing the relevant Claim audit closure through the existing Evidence Snapshot owner. `EvidenceClosurePolicyV1` SHALL deterministically declare target Claims, exact expected head/barrier, traversed edge families/directions/depth, equivalence/refinement expansion, cycle and unknown-edge handling, required Evidence-owned records and exact external refs, and stable gap codes. The closure SHALL include reached support, contradiction, refinement, negative result, failed replication, shared upstream source, Source Anchor, Artifact Version, Run, environment, parameter, Evidence-owned assessment, access-breakpoint, and gap records. Project Goal, Scope, inclusion/exclusion, Decisions, Approvals, and Releases SHALL remain external Project-owned refs rather than copied Evidence facts.

#### Scenario: A researcher endorses a load-bearing Claim

- **WHEN** the researcher endorses a Claim that exists only in a provisional Evidence view
- **THEN** Evidence first seals its complete audit closure and binds the endorsement to the closure digest
- **AND** the endorsement does not target a mutable current Claim.

#### Scenario: The Evidence head changes during seal

- **WHEN** a caller requests `seal if expectedHeadDigest` and the authoritative head no longer matches
- **THEN** Evidence rejects the seal as stale without silently substituting the newer head
- **AND** the caller may deliberately retry against an exact newly described head.

#### Scenario: Only favorable support is selected

- **WHEN** a requested closure omits a relevant contradiction, negative result, failed replication, shared source, excluded input, or known gap before the barrier
- **THEN** sealing fails or records the closure as incomplete according to policy
- **AND** the result cannot support certified approval.

#### Scenario: Required work is still pending

- **WHEN** the requested watermark, Artifact lifecycle event, retraction event, or required delta has not committed
- **THEN** Evidence may return a `lagging` or `incomplete` draft closure with explicit gaps
- **AND** SHALL NOT return a certification-ready Snapshot.

#### Scenario: A review is created from a sealed closure

- **WHEN** an AuditRun, Finding, Review, Decision, or Approval evaluates a closure
- **THEN** it appends as a sidechain record referencing the closure digest
- **AND** Evidence does not backfill that record into the same closure it evaluates.

### Requirement: Independence is explicit and cannot self-verify

Every semantic assessment SHALL record producer and reviewer identities, prompt, effective context boundary, public model/tool version, and the applied independence predicate. The same invocation, prompt, and effective context that produced a Claim SHALL NOT count as independent verification. If policy cannot establish independence, the assessment SHALL be `not independently assessed`.

#### Scenario: One model invocation generates and checks a Claim

- **WHEN** the producer and claimed verifier share the same invocation and effective context
- **THEN** Evidence retains the check as a non-independent assessment
- **AND** it does not increase independent-support or replication coverage.

### Requirement: Evidence correction never rewrites committed history

Committed deltas, Source Anchors, Runs, Claims, relationships, assessments, and Snapshots SHALL NOT be edited in place. A correction SHALL append a new record linked by `corrects`, `refines`, `supersedes`, `invalidates`, `retracts`, `derived_from`, `rerun_of`, or another typed relationship whose lifecycle and cycle semantics are defined.

#### Scenario: A paper is retracted

- **WHEN** a source used by a sealed Evidence Snapshot is retracted
- **THEN** the original Artifact Version and Snapshot remain resolvable, a source-status event is appended, dependent current views become stale or invalidated, and any new formal use requires a newer Snapshot.

#### Scenario: An instrument calibration was wrong

- **WHEN** a researcher records that a historical Observation or Run used an invalid calibration
- **THEN** the original Observation and Run remain immutable and a corrected Observation/Run plus calibration basis is appended
- **AND** current analyses may use the correction without hiding the original result.

#### Scenario: A Claim extraction was wrong

- **WHEN** a researcher or verifier challenges the wording or scope of a committed Claim
- **THEN** Evidence creates a corrected Claim or assessment linked to the old record
- **AND** no UI or capability overwrites the old statement.

### Requirement: Evidence graph semantics distinguish acyclic lineage from cyclic interpretation

Evidence SHALL enforce acyclicity only for edge families whose semantics require derivation or generation order. Support, contradiction, equivalence, replication, and other interpretive relationships MAY form cycles according to their typed policies. User-facing surfaces SHALL call the default view an Evidence chain or Evidence view rather than implying that every relationship belongs to one strict DAG.

#### Scenario: Two Claims contradict each other

- **WHEN** Evidence records reciprocal or cyclic contradiction/refinement relationships
- **THEN** the interpretive graph remains valid under its edge-family rules
- **AND** derivation and generated-by subgraphs remain independently acyclic.

### Requirement: Evidence exposes compact audit state without another authority

Evidence SHALL expose an owner-produced compact status suitable for Research summaries containing freshness, desired/applied head, coverage/gap count, material-risk count, last success, and bounded failure information. The status SHALL be a read projection and SHALL NOT become another mutable truth or start an advanced graph surface merely to render a badge.

#### Scenario: Research requests an Evidence status chip

- **WHEN** the Research landing view requests compact state for an exact thread or closure
- **THEN** Evidence returns its owner-derived status without returning graph payload or private storage details
- **AND** the Research surface renders but does not persist that status.
