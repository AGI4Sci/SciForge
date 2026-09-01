## Decision Summary

The final product has one primary `Research` surface and no new aggregate store. Artifact Versions remains the source of exact scientific bytes; Evidence appends immutable Session records and derives its current relationship view; the Workspace's single Research Project derives cross-Session meaning from a user-applied Goal and explicit Session Scope. DAGs remain owner-internal audit/impact models and advanced views. Evidence closures and Project Snapshots are sealed only when a formal Decision, Review, Approval, Release, export, comparison, or ordinary-retention boundary needs an exact baseline. Users are interrupted only for material scientific choices or policy-required responsibility; Runtime permission is checked separately.

## Context

SciForge has already implemented the hard scientific primitives:

- Artifact Versions owns stable Artifact identity, immutable content versions, exact dependency references, restore-as-new, compare, materialize, and portable bundles.
- Scientific Plotting owns formal render/rerun/compare behavior, plot manifests and recipes, and executable Code Artifacts for code/hybrid routes. The image-generation worker owns model-render receipts; Scientific Plotting reads their exact manifest refs for replay and review.
- Research Dossier is an exact-version, read-only presentation of a Research Checkpoint or compute run.
- Evidence DAG owns thread-scoped extraction, Source Anchors, Runs, Claims, assessments, committed Evidence state, and scientific audit inputs.
- Project DAG owns Goal versions, captured Session scope, cross-Session synthesis, Project Snapshots, Findings, Reviews, Decisions, and Release Records.
- The Capability Broker, generic resource navigation, installed-domain composition, and the Session-owned right-panel dock already provide the integration substrate.

The problem is not missing storage. It is that technical ownership boundaries appear as peer product concepts, automatic graph materialization creates more state than the researcher needs to understand, and a generic green status can conflate content integrity, computational reproducibility, scientific validity, freshness, access, and human approval.

This change treats auditability as an end-to-end workflow over existing owners. It does not build a super-domain, a super-DAG, or a second Artifact registry.

## Goals / Non-Goals

**Goals:**

- Give researchers one understandable Research entry and contextual paths to overview, artifacts, evidence, project synthesis, and decisions.
- Preserve an exact, reconstructable history without forcing users to manage versions, graph nodes, queue receipts, or backend retries.
- Separate editable intent, immutable scientific content, append-only actions, and disposable projections.
- Capture ordinary work automatically and ask the user only for material scientific, scope, responsibility, authorization, or irreversible decisions.
- Reuse current Artifact, Plot, Evidence, Project, Review, Release, Broker, and resource-navigation capabilities.
- Keep one canonical owner and one write path for every fact, transition, and external action.
- Make stale, incomplete, conflicted, restricted, or irreproducible state visible without requiring the full graph.

**Non-Goals:**

- A new `research-artifacts` database, aggregate service, or package that copies domain state.
- Treating an immutable record as a verified scientific truth.
- A single graph containing every Goal, Session, Claim, source, Run, Artifact, review, and project relationship.
- Manual node/edge editing.
- Persisting every provisional graph layout or every keystroke as a scientific version.
- Replacing runtime authorization, consent, ACL, ethics, or legal governance with a scientific audit decision.
- Guaranteeing byte-identical model-generated images from stochastic providers.
- Adding field-level history tables where an existing whole-object version or append-only event is sufficient.

## Design Principles

### 1. Immutable record does not mean immutable truth

An Artifact Version proves which bytes and dependencies were used. An Evidence record proves what a source, Run, tool, Agent, or person asserted at a particular time. Neither proves that the assertion is scientifically correct.

Committed records and Snapshots are never rewritten. Interpretation, applicability, independence, source status, access, and project meaning evolve through new Claims, assessments, relationships, versions, or events.

### 2. Freeze at the reference boundary

Drafts remain editable. Once content becomes an input to Evidence, Decision, Approval, Release, export, or another formal scientific record, the consumer must bind an exact immutable identity and digest.

```text
editable draft
    -> apply/commit
immutable version
    -> referenced by a formal record
pinned version
    -> correction
new version or superseding event
```

No formal record may depend only on `current`, `latest`, a mutable path, or a display label.

### 3. Hide implementation names, not scientific risk

The ordinary UI hides DAG, Snapshot, watermark, digest, queue, receipt, and manifest vocabulary. It must not hide stale Evidence, coverage gaps, excluded Sessions, contradictory or shared sources, failed reproduction, access breakpoints, or critical Findings.

### 4. One owner, one write path

The Research experience is a presentation and navigation shell. It stores no Artifact, Claim, Evidence, Project, Decision, or current pointer. Every owner continues to execute its canonical actions through public capability contracts.

### 5. Scientific review and runtime permission are separate

A scientific decision answers whether the evidence is sufficient and who accepts scientific responsibility. Runtime authorization answers whether the actor may publish, transmit, delete, spend, or perform a physical action. Both may be required; neither substitutes for the other.

## Researcher Mental Model

```text
Research
├─ Overview
│  ├─ Goal
│  ├─ included / excluded / isolated Sessions
│  ├─ current conclusions
│  ├─ evidence freshness, coverage, and risk
│  └─ decisions needing attention
├─ Artifacts
│  ├─ Figure, Dataset, Code, Report, Checkpoint
│  └─ Figure detail: Preview | Reproduce | Evidence | Versions
└─ Evidence
   ├─ Claim -> support / contradiction / limits / gaps
   └─ Advanced relationship graph
```

The toolbar has one primary `Research` entry. The existing right-panel host remains the visual shell. Research Dossier provides the landing presentation, while exact resource navigation activates the owner-provided Plot, Evidence, Project, or Artifact history view in the same dock with existing back/forward behavior.

The shell does not mount or import adjacent package UI. It discovers bounded owner-provided status summaries and exact navigation actions through generated generic contributions, but never caches or becomes authoritative for them.

The one new renderer extension point is `renderer.research-summary.v1`. A contribution declares a stable contribution ID, one generic slot (`goal`, `scope`, `status`, `artifacts`, or `attention`), order, applicable resource/scope kinds, a bounded read-model provider, and exact resource-navigation actions. Contributions are read-only, access-filtered by their owner, and may return unavailable. Research Dossier enumerates installed contributions without knowing domain IDs or owner schemas. The contract does not permit writes or arbitrary package UI mounting.

## Why DAGs Still Exist

DAG is an implementation shape, not a top-level product or a universal storage model. It remains valuable where the system must answer questions that a flat version list cannot answer reliably: which source and computation produced this Claim or Figure, which conclusions are affected by a correction, whether several Sessions share one upstream source, and which exact inputs a Decision used.

- Evidence persists immutable records and deltas; its current relationship graph is a reconstructable interpretation. Only derivation/generation edge families must be acyclic. Contradiction, equivalence, and replication relationships may form cycles, so the default product language is Evidence view or chain rather than promising one strict DAG.
- Project derives a cross-Session dependency/synthesis graph from Goal, Scope, and exact Evidence inputs. The graph is disposable until a formal consumer seals a Project Snapshot.
- Research Artifacts are versioned objects, not graph nodes the user must manage. Their exact dependency refs make them inputs/outputs of Evidence and Project relationships.
- The ordinary UI shows lineage, gaps, conflicts, and impact in task language. Full graphs exist only for advanced inspection and debugging.

Removing all graph structure would remove impact analysis, shared-ancestry detection, and deterministic audit closure. Persisting every graph projection would create duplicate truth. The minimal design therefore persists exact scientific records and selected sealed baselines, while rebuilding ordinary graph views.

```text
Session work ──append──> Evidence Delta chain ──derive──> Evidence view
      │                         │                               │
      └──commit exact bytes─────┴──ref──> Artifact Versions     └──seal on formal use──> Evidence Closure

Goal + explicit Session Scope + exact Evidence heads/closures
      └──derive on demand──> Project view ──seal on formal use──> Project Snapshot
                                                               └──ref──> Decision / Review / Approval / Release
```

Arrows marked `derive` are replaceable computation. Arrows marked `append`, `commit`, `seal`, or `ref` create durable audit history.

## Ownership Model

| Concern | Authority | Research surface responsibility |
| --- | --- | --- |
| Artifact identity, bytes, versions, dependencies, restore, bundles | Artifact Versions | Group by stable Artifact identity; navigate to exact Version/history |
| Figure render, recipe, rerun, compare, review | Scientific Plotting | Preview first; show reproduction/evidence/version actions |
| Research checkpoint narrative | Research Checkpoints, presented by Research Dossier | Show exact overview, declared sources/outputs, limitations, and recording policy |
| Session source/run/claim capture and assessment | Evidence DAG | Show strongest paths, contradictions, gaps, and advanced graph |
| Goal, explicit Session scope, project synthesis and decisions | Project DAG | Edit Goal/scope, derive Project view, present decision packets and releases |
| External execution authority | Runtime and Capability Broker | Show permission state separately; execute only after both applicable gates pass |
| Artifact availability and current retention behavior | Artifact Versions, under current governance authority | Show withdrawal/unavailability and downstream breakpoints without deciding retention locally |

Cross-domain records contain exact references, not copied owner facts. Evidence pins Artifact Version refs. Project pins Evidence heads or sealed Snapshot identities and owns Goal, captured Scope, and Project Decisions. A Decision pins one Project Snapshot plus its action context; an Approval pins the Decision; a Release pins the Project Snapshot, typed output Artifact Versions, audit/Decision/Approval refs, classification, and external target.

## Mutability Model

Scientific records in this design use four persistence semantics. Operational jobs, leases, locks, and caches may use package-owned runtime storage but never become scientific authority.

### Revisioned current documents

Working Goal text, desired Session scope, unaccepted Prompt drafts, view preferences, notification preferences, and recording policy are mutable documents. Updates use an expected revision to prevent lost updates. This design does not add Artifact tags, ordering, archive fields, or other metadata without an existing owner contract and consumer.

Goal and Scope editing follows a draft/apply interaction. Keystrokes are not scientific versions. Applying a Goal creates a meaningful Goal Version; changing the root research intent, primary endpoint, or formal success criterion also creates an explicit reframe Decision. Applying Scope captures included, excluded, and isolated Sessions plus reasons. Session membership has no second authority outside Project Scope.

### Immutable versions and sealed baselines

Figures, datasets, code, reports, checkpoints, manifests, recipes, logs, model render receipts, Source Anchors, sealed Evidence Snapshots, and Project Snapshots are immutable after commit. Corrections, reruns, restore, and republishing append new versions. Restore is restore-as-new.

An Artifact identity is stable. Existing owner-controlled availability projection and current-version pointer may change, but formal references always pin a Version ID and digest. Scientific captions belong to versioned content. Presentation may derive a display label without creating another mutable Artifact authority.

### Append-only events

Committed traces, execution receipts, Decisions, Approvals, Reviews, Findings, Releases, source withdrawals, access/consent changes, artifact lifecycle observations, and compensations are append-only. Correction uses `supersedes`, `invalidates`, `retracts`, `reverses`, or a new assessment. An already executed external action is never deleted; cancellation or compensation is a later event.

### Disposable projections

Research Dossier, Plot Provenance, provisional Evidence and Project graphs, summaries, attention lists, coverage calculations, current status, previews, search indexes, layouts, and comparisons are read models. They may be overwritten, rebuilt, or deleted. Every externally referenceable projection carries its exact input fingerprint; a formal consumer seals the required inputs before relying on it.

`latest`, `current`, `fresh`, `stale`, `effective`, and `expired` are pointers or derived states. They are never sufficient as a reproducibility or approval reference.

## Evidence Lifecycle

### Durable delta capture

Each completed turn or governed execution appends an immutable Evidence delta. A delta binds:

- canonical thread and turn/execution scope;
- requested and committed watermark;
- previous delta digest and payload digest;
- schema, extractor, verifier, prompt, public model/version, and policy identities as applicable;
- exact Source Anchor, Artifact Version, Run, and visible-trace references;
- an idempotency key.

Missing predecessors, reordering, identity drift, workspace mismatch, digest mismatch, or replay with different content fails closed. Pending job state is operational metadata and is not part of the immutable delta.

### Provisional Evidence view

Evidence incrementally compiles a provisional thread-scoped read model from the delta chain. It may identify Claims, support, contradiction, refinement, applicability, shared upstream sources, and reproducibility relationships. The model is explicitly an interpretation, may change with new inputs or compiler versions, and is not a sealed scientific baseline.

Every semantic assessment records its producer and reviewer method, prompt, context boundary, public model/tool version, and independence result. The same model invocation, prompt, and effective context that produced a Claim cannot count as its independent verifier. A policy-defined independence predicate may accept a distinct deterministic tool, independently scoped reviewer, or other configured method; otherwise the status is `not independently assessed`, never silently independent.

The system keeps the last-good view and a small freshness index:

```text
desired watermark / input digest
applied watermark / cache digest
last success time
dirty reason
last-known coverage summary
last-known critical-risk summary
```

Failure preserves the last-good view and labels it as based on older Evidence.

### Sealed Evidence closure

Evidence seals an immutable Snapshot when a Claim is endorsed, challenged, used by a Project Decision, reviewed collaboratively, audited, shared, exported, published, or at risk of losing its source trace. The sealed product reuses the existing Evidence Snapshot ownership and export path; it is not a fifth store. It contains only Evidence-owned records plus exact external context refs; Project Goal, Scope, Project Decisions, and exclusions remain Project-owned.

`EvidenceClosurePolicyV1` makes closure membership executable and testable. It fixes:

- target Claim IDs and the exact Evidence head/freshness barrier;
- the traversed edge families, directions, depth/termination rule, equivalence/refinement expansion, cycle handling, and unknown-edge behavior;
- required upstream Source Assertions, Source Anchors, Artifact Versions, Runs, code, parameters, environment, model/tool identities, and Evidence-owned assessments committed before the barrier;
- inclusion of contradiction, negative-result, failed-replication, shared-ancestry, access-breakpoint, and incomplete-lineage records reached by that traversal;
- exact included node/edge/ref sets and stable gap codes such as `missing_delta`, `unsupported_edge_family`, `access_restricted`, `source_unavailable`, `lineage_incomplete`, and `independence_unknown`.

Closure `complete` means complete only under that exact policy over Evidence ingested by the declared barrier. It never claims that unknown external Evidence does not exist. A Project records Goal, Scope, unassessed/excluded Sessions, and cross-Session coverage separately.

If the barrier cannot prove that required deltas and lifecycle events have been consumed, a closure may be produced only as `lagging` or `incomplete`; it cannot support certified approval.

The closure fixes only records committed before its barrier. AuditRun, Finding, Review, Decision, and Approval records created against the closure are append-only sidechains that reference its digest; they are never backfilled into that closure. A later Evidence closure may include earlier Evidence-owned assessments as inputs, but never the event that is being created from itself.

Before ordinary retention cleanup removes source trace, Artifact Versions asks Evidence for typed retention references and seal readiness. Evidence may seal only when current policy permits the additional retained copy. This change does not introduce distributed legal/privacy purge orchestration; current owner governance remains authoritative, and Evidence must never manufacture a retained copy when policy forbids it.

### Evidence correction

Committed Evidence is never edited. Extraction mistakes, changed interpretation, retractions, calibration corrections, and new applicability limits append a corrected Claim, assessment, relationship, Observation, Run, or source-status event linked to the old record. The current view may prefer the correction while the historical Snapshot continues to explain the earlier decision.

## Project Lifecycle

### Goal and Scope

This change supports exactly one Research Project per SciForge Workspace. Its stable `projectKey` is derived from the canonical Workspace identity already used by Project DAG; it does not add create/list/select/active-project state. Cross-workspace Project identity and multiple Research Projects in one Workspace are separate future changes.

The researcher sees and edits one revisioned Goal and an explicit Scope consisting of included, excluded, and isolated Sessions with reasons. On first initialization, the current Session is visibly included and related Sessions may be recommended, but recommendations never silently expand Scope.

Changing the root Goal or material Scope produces an impact summary. Affected conclusions, Evidence coverage, decisions, and approvals are marked stale or expired. Historical Project Snapshots retain the exact older Goal and captured Scope.

### Demand-driven Project view

Project derives a provisional view from:

```text
Goal version
+ included / excluded / isolated Sessions
+ exact Evidence head or closure vector
+ Evidence schema / extractor / verifier / closure-policy versions
+ Project policy / compiler versions
+ Artifact lifecycle / source-status revisions
+ ACL / consent / retention policy revisions
```

Ordinary derivation begins when the researcher opens the Project, applies Goal/Scope, requests synthesis, or crosses a formal decision/review/release barrier. An upstream event only marks the workspace Project stale; it does not force compilation while the Project surface is closed. There remains one package-owned compiler path whether triggered by UI, Agent, retry, decision, or release.

`ProjectInvalidationPolicyV1` classifies changes from exact fingerprint fields. Scientific input refs/digests, Goal intent, captured Scope, Evidence schema/extractor/verifier/closure policy, Project compiler/policy, source/lifecycle status, ACL/consent/retention revision, action/target, output Artifact refs, and gate-relevant risk changes are material. Presentation labels, layout, selected tab, and other enumerated cosmetic metadata are non-material. Unknown fields fail closed as material for a formal gate.

The Project view can be cached by the complete input fingerprint and discarded. It shows conclusions, contradictions, shared ancestry, known-input coverage, unassessed or restricted Sessions, negative results, limitations, and attention. It does not become an audit authority merely because it is current. Caches containing protected content either remain owner-internal and are filtered on every read or are partitioned by Principal identity version, purpose, and policy revision; unfiltered content is never shared across callers.

### Immutable Project Snapshot

Before a Project conclusion is used by a Decision, Approval, collaborative review, Release, export, or formal comparison, Project crosses a freshness/coverage barrier, seals required Evidence closures, and commits one immutable Project Snapshot containing the exact Goal, captured Scope, Evidence vector, policy/compiler identities, graph output, known-input coverage, unassessed/excluded/restricted Session gaps, conflicts, and Artifact refs. Sealing uses an atomic `seal if expectedHeadDigest` compare-and-set operation; an advanced caller may supply an older exact head for historical comparison, but no caller may implicitly resolve `latest` during seal.

The Project Snapshot fixes audit inputs only. AuditRun, Finding, ReviewPacket, Decision, Approval, and Release are append-only sidechains that reference its digest. A Decision may become an input to a newly compiled successor Snapshot, but no sidechain result is backfilled into the Snapshot it evaluates.

Any material change to Goal, Scope, Evidence vector, closure, policy, action target, or output Artifact creates a new Snapshot and expires approvals bound to the old baseline. No consumer may approve `latest`.

## Research Artifacts and Plot Reproduction

`Research Artifact` is product language for a stable Artifact identity viewed at an exact Version. It is not a new domain object. Supporting recipe, code, data, manifest, and log objects retain separate shareable and independently versioned Artifact identities; the Artifact list groups their exact Versions under the root researcher-facing output instead of presenting them as unrelated recent products.

A Figure detail starts with the rendered image and exposes:

```text
Preview | Reproduce | Evidence | Versions
```

- `Preview` shows the image, scientific caption, exact version, and compact status.
- `Reproduce` shows exact data, transformations, statistics, Code Artifact or effective Prompt, public model/version, parameters, renderer, environment, recipe, rerun, restore, and compare.
- `Evidence` shows which Claims the Figure supports or contradicts and navigates to the exact Evidence closure.
- `Versions` shows root-Artifact history and supporting dependencies through Artifact Versions.

Code/hybrid formal renders must copy the effective source bytes into a new immutable Code Artifact, bind that exact Version in the Plot manifest, and execute the committed copy rather than a mutable workspace path. The Figure's Reproduce tab renders those frozen code bytes inline while all restore/materialize/history actions remain Artifact-Versions-owned. Model-owned renders must retain the effective Prompt and hash, public model identity/version, parameters, references, seed when available, renderer, and replay recipe. Their visible state is `replayable`, not `exactly reproducible`, unless a deterministic provider contract and byte comparison prove otherwise.

An external paper Figure without a SciForge render is a source Artifact with an exact Source Anchor. It is labelled `source located`, not presented as possessing executable plotting code.

When a user explicitly asks for plot provenance, plot reproducibility, or the governed Scientific Plotting route, Agent routing is locked to Scientific Plotting for that operation. A model-owned fallback is allowed only when the request permits it or code rendering is unavailable, and the response must disclose the downgrade before or with the result.

The route lock is generic operation state rather than a Plot-specific Host branch:

```text
GovernedOperationV1 {
  operationId,
  lockedIntent,
  selectedRouteContributionId,
  requiredOutputContract,
  terminalState: pending | committed | failed | cancelled,
  userAuthorizedDowngrade?
}
```

Context compression, retry, and handoff preserve this state. Completion requires an output satisfying the required contract; a generic image file cannot satisfy a locked Scientific Plotting operation. Only the user or the selected route's declared policy may authorize a downgrade.

## Audit and Decision Model

### Non-blocking attention

Ordinary research, draft generation, evidence compilation, deterministic integrity checks, candidate duplicate/conflict detection, and low-risk reversible reruns continue without approval. Users can always challenge, exclude, request Evidence, or inspect source anchors.

An Agent action still creates an append-only Decision and seals its basis when it materially changes root Goal or Scope, selects a formal analysis protocol or next experiment whose result will be treated as a project input, resolves a scientific conflict, accepts a risk, triggers an external cost, or performs an irreversible/high-impact action. Human approval may be unnecessary for policy-authorized internal work, but the scientific rationale is not allowed to exist only in a disposable view.

### Explicit reversible decisions

Root Goal reframe, material Scope exclusion/isolation, Claim supersession, formal analysis-policy change, and acceptance of unresolved conflict require an impact-aware Decision. The Decision records actor, role, rationale, alternatives, exact target identities, reversibility, and supersession.

### Mandatory accountable-human gates

Every certified/public release or publication submission requires at least one accountable human Approval. Unresolved critical-risk override, formal data exclusion/correction affecting conclusions, consent/ethics decisions, restricted data or code export, authorship responsibility, and R3/R4 high-risk or physical actions additionally require the role slots and quorum declared by the exact versioned Decision Policy; they cannot be approved by an Agent alone.

Internal, reversible, non-certified work may retain policy-governed Agent Decisions and overrides. The Agent may prepare and recommend a decision packet but may not sign as the accountable human.

`DecisionPolicyV1` assigns each action class a stable rule containing whether Agent-only action is permitted, required trusted role slots and counts, quorum, whether one Principal may occupy several slots, material-change fingerprint fields, and certification eligibility. Role assertions come from the current trusted identity/project-governance authority, never from request payload. Roles and authorization are revalidated at Approval and action time. If the installed product cannot establish the required roles or quorum, the action is `blocked_by_policy`; one generic researcher Approval does not impersonate ethics, clinical, statistics, authorship, or other discipline-specific sign-off.

The initial product supports a default one-accountable-researcher rule for ordinary certified/public releases and the general multi-slot policy/record model. It does not claim support for a discipline-specific workflow until that workflow's trusted role source and policy are installed.

The initial action classes are deliberately small:

| Action class | Scientific gate | Runtime gate |
| --- | --- | --- |
| `draft_internal_reversible` | Agent Decision allowed when a formal scientific choice is made; no human Approval | Normal scoped capability authority |
| `certified_internal` | At least one accountable-human Approval | Required for any external write or privileged operation |
| `public_external` | At least one accountable-human Approval plus installed policy role slots/quorum | Always reauthorized for the exact target and action |
| `specialized_high_impact` | Installed versioned policy and trusted role source; otherwise `blocked_by_policy` | Independent action-specific authorization |

Project owns three minimal append-only record families; Goal, Scope, Evidence, and conclusions are not duplicated into each record because `projectSnapshot` already fixes them:

```text
DecisionV1 {
  decisionId, projectSnapshot, actionClass, action, target?,
  actor, rationale, alternatives?, reversibility, policyRef,
  createdAt, supersedesDecisionId?
}

ApprovalV1 {
  approvalId, decisionRef, attestor, trustedRoleAssertionRef,
  attestation, policyRef, createdAt, expiresAt?, revokesApprovalId?
}

ReleaseV1 {
  releaseId, projectSnapshot, classification, target,
  outputArtifactVersions[], auditRefs[], decisionRefs[], approvalRefs[],
  attemptOutcome, createdAt, supersedesReleaseId?
}
```

Finding and Review history follows the same rule: changes append typed `FindingEventV1` and `ReviewEventV1` records, while current status is derived. Migration preserves each existing record as a legacy root event and never rewrites its historical payload.

### Decision packet

A decision packet contains:

- the precise question and why it now requires attention;
- the action and external target, if any;
- the exact Goal, Scope, Project Snapshot, Evidence closures, Artifact Versions, audit, and policy;
- strongest support, strongest contradiction, missing information, and shared-source concerns;
- blast radius, affected outputs, and alternatives;
- recommended action and required responsibility role;
- the consequences of approve, reject, defer, request Evidence, or accept risk.

The default UI shows at most three highest-impact risks and the remaining count, with exact graph and digest details available on demand. Approval creates an immutable attestation; its effective/expired/revoked status is derived.

The packet references a sealed baseline and any already-completed Audit/Finding/Review sidechain records. The Decision and Approval are then appended against those exact refs; they are not inserted into the baseline they evaluate.

## User-visible Status

Do not collapse scientific state into one `trusted` or green badge. The default surface shows a small set of orthogonal dimensions and always permits `unknown`, `not assessed`, `not tested`, `unavailable`, or `inconclusive` where the system cannot prove a stronger state:

| Dimension | States |
| --- | --- |
| Evidence freshness | `up to date` / `updating` / `based on older evidence` / `unknown` / `unavailable` |
| Known-input coverage | `assessed` / `gaps (n)` / `restricted` / `unknown` |
| Audit coverage | `not assessed` / `partial` / `assessed` / `expired` / `unavailable` |
| Material risk | `not assessed` / `no known blocker` / `attention (n)` / `blocked` / `unknown` |
| Reproduction method/readiness | `exact route ready` / `replay route ready` / `source located` / `incomplete` / `unavailable` |
| Latest attempt outcome | `not tested` / `running` / `replicates` / `fails to replicate` / `inconclusive` / `execution failed` |
| Environment comparability | `matched` / `drifted` / `unknown` / `not applicable` |

`assessed` is always scoped to the exact known inputs and policy; it is not a claim that unknown Sessions or external Evidence do not exist. Integrity failure, access denial, expected-content mismatch, stale exact references, critical Finding, reproduction failure, and unassessed exclusions remain visible in ordinary views. Raw digests, internal state codes, queue attempts, and receipts remain technical detail.

## Access, Retraction, and Deletion

Effective access is evaluated at every Artifact, Evidence Closure, Project Snapshot, Decision Packet, summary, preview, export, and Release read as the intersection of version-fixed restrictions and current Principal, authorization, consent, purpose, and retention policy revisions along the complete provenance path. A restricted ancestor restricts the path; stored access metadata is not caller authority, and a historical authorization does not grant permanent access. Existence itself is withheld when policy marks it sensitive.

Owner-internal caches are filtered at read time, or protected cache entries are keyed by Principal identity version, purpose, and policy revision. Revocation invalidates applicable cached projections. A shared Research summary never receives an unfiltered owner payload and then attempts client-side permission filtering.

- Drafts and disposable caches may be hard-deleted.
- Immutable Versions, sealed Snapshots, Decisions, Approvals, Reviews, and Releases are normally withdrawn, retracted, invalidated, or archived by a later event, not edited or deleted.
- File movement changes locator/availability projections and triggers stale propagation; it does not rewrite content identity.
- Artifact Versions remains the current Artifact-byte retention authority. Evidence and Project expose exact retention references and seal readiness but do not create a second hold/purge authority.
- Ordinary cleanup may wait for policy-permitted closure sealing and verification. If current policy forbids copying, sealing is skipped and cleanup follows the governing rule.
- End-to-end legal/privacy purge propagation across Artifact, Evidence, Project, cache, preview, and exported copies requires a separate capability and OpenSpec change. Until then, this program must not claim global erasure or add another copy solely to improve provenance.

## Reuse and Minimal Contract Changes

Reuse the existing capabilities before adding contracts:

- Artifact Versions `describe-v2`, `list-v2`, exact read, compare, materialize, restore-as-new, bundle export/import/verify, and lifecycle events.
- Scientific Plotting map/render/rerun/compare, render manifest, recipe, code copy, exact image-generation receipt ref/read, and review.
- Research Dossier exact checkpoint/compute-run loading and recording controls.
- Evidence update/status/priority/preview, Source Anchors, Snapshot exports, audit input, and advanced iframe.
- Project view/update/Goal, evidence preview, Snapshot compiler, ReviewPacket, Decision, Audit, and Release workflows.
- Capability Broker, installed-domain composition, resource navigation, right-panel docking, and Session-resident panel history.

Only add a package-owned contract when there is a real consumer:

- Domain SDK adds `renderer.research-summary.v1`, the minimal generic contribution described above; Dossier consumes it without importing owner packages.
- Project may expose `ProjectSnapshotIdentity { projectKey, digest }` and an exact `snapshot.describe` read.
- Decision contracts should bind `projectSnapshot` explicitly rather than an ambiguously named `evidenceDigest`.
- Release outputs should use typed exact `ArtifactVersionRefV1` values.
- Evidence and Project may expose UI-safe compact summaries through their `renderer.research-summary.v1` contributions without starting advanced graph UI.
- Scientific Plot, Evidence, and Project add `renderer.resource-navigation` resolvers for their exact resource kinds when absent.

Do not add a generic cross-domain Snapshot schema, research summary database, synchronization service, or compatibility alias.

## Migration

### Phase 0: Language and decision baseline

Update the Research Artifacts glossary and architecture decisions. Make `Research Surface`, `Research Artifact`, Evidence record versus interpretation, Project View versus Snapshot, and the four scientific-record mutability semantics canonical.

### Phase 1: One Research entry

Rename the primary Research Dossier toolbar surface to `Research`. Add `renderer.research-summary.v1`, compact navigation, and status links, then remove ordinary toolbar contributions for Scientific Plotting, Evidence DAG, Project DAG, and Artifact Versions. Preserve exact owner panels and resource navigation. Delete orphaned commands only after callers are audited; do not leave forwarding aliases.

### Phase 2: Contextual owner navigation

Add missing package-owned resource resolvers. Route Figures to Scientific Plotting, Claim/Source/Closure resources to Evidence, Project/Project Claim/Snapshot resources to Project, and Artifact history to the existing Dossier/Artifact Versions read model. Remove the standalone Artifact Versions renderer after every history, restore, compare, and export path has an owner surface.

### Phase 3: Decision-focused UI

Replace duplicate Dossier Evidence detail, manual update/rebuild controls, raw status machines, and default full graphs with compact freshness/coverage/risk summaries and exact navigation. Reuse Project ReviewPacket and governance workflows to present decision packets. Keep advanced graph and technical diagnostics behind explicit actions.

### Phase 4: Evidence delta and seal lifecycle

Introduce the immutable delta chain and provisional read cache within Evidence ownership. Before cutover, inventory every reader/writer, transactionally create the new head/index state, and run a readiness check that exact-reads every migrated root. Preserve existing committed Snapshots as exact legacy baselines without changing bytes or digests. When complete predecessor trace cannot be proven, use an explicit `legacy_checkpoint_root` plus `legacy/incomplete` coverage breakpoint rather than pretending the old Snapshot is a complete delta chain. Switch the canonical writer and reader in one release; do not add a dual-read or dual-write fallback. Stop automatic full-Snapshot publication only after delta recovery, seal, retention, export, stale propagation, and fail-closed tests pass, then delete the obsolete fan-out and duplicate status paths.

### Phase 5: Demand-driven Project derivation

Keep exactly one Project per Workspace. Make explicit Goal/Scope and exact Evidence input fingerprints its only inputs. Mark the Project stale without compiling while its surface is closed. Reuse the single compiler for open, apply-scope, Agent-request, retry, decision, review, and release triggers. Migrate existing Snapshots as exact legacy roots, switch readers/writers without dual paths, commit new immutable Project Snapshots only at formal reference boundaries, and remove per-Evidence global compilation and obsolete durable states after the readiness gate passes.

### Phase 6: Governance and release hardening

Introduce the explicit append-only Decision/Approval/Release schemas and Finding/Review event migration before changing status derivation. Bind records to the minimum exact identities and typed Artifact outputs. Enforce at least one accountable-human Approval for every certified/public release plus policy-declared role slots/quorum for specialized actions. Keep runtime authorization independent. Add approval expiry for policy-enumerated material changes and verify roles, access, consent, and purpose again at read/export/action time.

Each phase after Phase 0 is a separate implementation change and PR with its own migration/deletion gate. Phase 1-3 may ship before Phase 4; Phase 4 must ship before Phase 5; Phase 5 must ship before Phase 6. The umbrella document defines the final invariants, not permission to implement all data migrations in one patch.

## Risks / Trade-offs

- **Delta/seal migration is more complex than leaving per-turn Snapshots.** It removes long-term write amplification and makes the formal audit boundary explicit, but must preserve every old Snapshot and prove deterministic closure coverage before the old path is deleted.
- **Demand-driven Project views may be stale when first opened.** A lightweight dirty index, last-good cache, visible stale state, and a mandatory decision barrier prevent silent use of old evidence without adding prefetch policy.
- **A single Research entry could become a god-domain.** The shell owns only presentation and navigation; owner views, data, actions, and state stay package-owned.
- **Users may confuse reproducibility with validity.** Orthogonal status dimensions and explicit wording prevent a reproducible computation from being labelled scientifically verified.
- **Human gates can become burdensome.** Only material reversible decisions and enumerated high-impact actions create checkpoints; ordinary work and deterministic checks remain non-blocking.
- **Evidence extraction is probabilistic.** Exact model/prompt/tool identity, visible Source Anchors, correction-by-supersession, independent review, and sealed closures preserve auditability without claiming infallibility.

## Resolved Decisions

- One primary `Research` entry; full DAG views are advanced.
- Research Artifact is product language over Artifact identity plus exact Version, not a new store.
- Goal and Scope use editable drafts and meaningful applied versions, not keystroke-level history.
- Evidence records are immutable; interpretations and current status evolve through new records and projections.
- Per-turn capture uses durable deltas; formal Evidence is sealed at use/retention boundaries.
- Project view is derived from user Goal and explicit Sessions; formal Project Snapshot is sealed at reference boundaries.
- Claim correction creates a new Claim or assessment and preserves the old record.
- Referenced scientific records are withdrawn/retracted rather than normally hard-deleted; distributed privacy/legal purge is deliberately a separate capability change.
- Certified/public critical-risk override requires an accountable human.
- Every certified/public release requires at least one accountable human. Specialized ethics, clinical, statistical, authorship, restricted-data, or physical-action workflows fail closed until their versioned required-role/quorum policy and trusted role source are installed.

## Open Questions

None for the scoped phases. Discipline-specific role sources, multiple Projects per Workspace, cross-workspace stable Project identity, named Release series, and distributed legal/privacy purge are separate changes.
