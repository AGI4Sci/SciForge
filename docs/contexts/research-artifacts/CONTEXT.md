# Research Artifacts

Owns the language for researcher-facing records, scientific outputs, evidence interpretation, project synthesis, and accountable research decisions. This context separates immutable scientific history from editable intent and reconstructable current views.

## Language

**Research Surface (研究界面)**:
The single researcher-facing navigation and presentation surface for research overview, Artifacts, Evidence, Projects, and Decisions. It owns no scientific record, current pointer, or cross-domain aggregate.
_Avoid_: research database, super-DAG, research-artifacts owner

**Research Artifact (科研产物)**:
A researcher-facing scientific output identified by one stable Artifact identity and presented at one exact Artifact Version. Supporting code, data, recipe, manifest, and log objects retain their own shareable Artifact identities but are grouped as dependencies in the root output's presentation.
_Avoid_: Research Product store, output folder, latest file

**Research Dossier (科研档案)**:
A read-only, exact-version presentation of one research checkpoint or scientific compute run, combining the research narrative, sources, outputs, version position, reproduction state, and actionable limitations. It owns no records or current pointer and never substitutes `latest`.
_Avoid_: plot provenance, evidence graph, chat history

**Scientific Plot Provenance (科学图表数据溯源)**:
A figure-level reproduction projection over an exact Figure Version and its immutable dependencies. It shows exact inputs, transformations, statistics, code or Prompt, model, parameters, environment, execution, review, and rerun/compare relationships without owning another figure history.
_Avoid_: chart folder, bare PNG metadata, research dossier

**Formal Plot Render (正式图表渲染)**:
A route-locked code or hybrid plotting operation that maps data and commits the figure, recipe, render manifest, and render log through the Scientific Plotting capability and Artifact Versions; an arbitrary terminal/Python-generated file is not a formal render.
_Avoid_: manual export, file watcher capture, ordinary PNG save

**Model Render Receipt (模型生成回执)**:
The persisted replay record for a model-owned visual route: the effective prompt and hash, public Model Router identity/version, generation parameters (including negative prompt, references, and seed when available), renderer version, and recipe hash. A reviewed visual can later be accepted as an Artifact Version, while the receipt remains the worker-owned manifest used for replay. Replay repeats the governed request; stochastic providers do not promise byte-identical pixels.
_Avoid_: provider-private credentials/model names, an untracked generated file, a claim of deterministic pixels

**Artifact Version (产物版本)**:
An immutable, content-addressed version belonging to a stable Artifact identity; it is the authority for exact bytes, history, dependencies, current-version comparison, and restore-as-new.
_Avoid_: latest file, workspace snapshot, folder version

**Evidence Record (证据记录)**:
An immutable record of what a source, Run, tool, Agent, or person asserted or produced at a particular time. Its immutability preserves history but does not establish that its interpretation is scientifically true.
_Avoid_: scientific truth, verified conclusion, mutable note

**Evidence Delta (证据增量)**:
An immutable, ordered addition to one Session's Evidence history, bound to exact source, Run, Artifact, extraction, and predecessor identities. Deltas preserve what was captured without requiring every update to become a formal Evidence baseline.
_Avoid_: editable graph patch, full project snapshot

**Sealed Evidence Closure (封存证据闭包)**:
An immutable Evidence Snapshot containing the Evidence-owned support, contradiction, limitations, negative results, shared origins, exact sources and Runs, and coverage gaps selected by a versioned closure policy through a declared freshness boundary. Project Goal, Scope, and Decisions remain external exact references rather than copied Evidence facts.
_Avoid_: shortest support path, favorable evidence bundle, current graph

**Evidence DAG (证据 DAG)**:
A reconstructable Session-scoped interpretation of Claims, source assertions, Source Anchors, Runs, Findings, and their typed relationships. Committed Evidence records and sealed closures are immutable, while current interpretation, applicability, independence, freshness, and status may evolve.
_Avoid_: plot provenance, research dossier

**Project Scope (项目范围)**:
The versioned selection of included, excluded, and isolated Sessions, with reasons, used to answer one Goal. A formal Project Snapshot captures the exact Scope it used.
_Avoid_: all workspace chats, implicit membership, global session scan

**Research Project (科研项目)**:
The single Project-DAG-owned synthesis context for one SciForge Workspace. It has one revisioned Goal and one explicit Project Scope. Multiple Research Projects per Workspace and cross-Workspace Project identity are not implied by this term.
_Avoid_: Collaboration Project, automatically discovered session collection, active-project registry

**Project View (项目视图)**:
A disposable synthesis of current project conclusions, conflicts, coverage, risks, and relevant Artifacts derived from an exact Goal, Scope, Evidence input vector, and policy. It is not a formal audit baseline until sealed as a Project Snapshot.
_Avoid_: project truth, committed project graph, release record

**Project Snapshot (项目快照)**:
An immutable project baseline that fixes the Goal, captured Scope, Evidence closures and input vector, policy, conclusions, conflicts, gaps, and output Artifact Versions used by a formal Decision, Review, Release, export, or comparison.
_Avoid_: current project, latest conclusions, mutable dashboard

**Decision Packet (决策包)**:
A bounded presentation of one accountable question, its exact scientific inputs, strongest support and contradiction, missing information, impact, alternatives, required role, and consequences. It assists judgement but does not itself approve or execute an action.
_Avoid_: generic confirmation, DAG approval, runtime permission

## Relationships

- Research Surface navigates among exact owner-provided views without storing a parallel research aggregate.
- Research Artifact is the user-facing form of a stable Artifact identity at an exact Artifact Version; Artifact Versions remains the sole version authority.
- Research Dossier reads exact Research Checkpoint or compute-run identities and composes owner projections for a research process.
- Scientific Plot Provenance reads exact Artifact Versions of kind `scientific-plot-render-manifest` and its declared recipe, figure, data, and log dependencies for code/hybrid routes; model-only routes persist the Model Render Receipt in the image-generation manifest for replay and review.
- Evidence Delta preserves Session history; Evidence DAG is its current interpretation; a Sealed Evidence Closure is the immutable formal baseline for a Claim.
- The Workspace's one Research Project derives current meaning from one Goal, explicit Project Scope, and exact Evidence inputs; Project Snapshot freezes that meaning only when a formal record needs it.
- Decision and Review records refer to an exact Project Snapshot; Approval refers to the exact Decision; Release refers to the Project Snapshot, typed output Artifact Versions, and exact audit/Decision/Approval records. The Snapshot already fixes Goal, Scope, and Evidence inputs, so sidechain records do not duplicate them. Later corrections supersede or invalidate records without rewriting history.
- Research Dossier and Scientific Plot Provenance are sibling owner projections: the dossier explains a research checkpoint, while plot provenance explains how one exact Figure was produced and can be reproduced or replayed.
