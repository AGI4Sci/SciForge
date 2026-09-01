# Research Artifacts

Owns the language for researcher-facing records, scientific figure lineage, and the evidence relationships that connect them. This context separates conversation-level research records from figure-level reproducibility and thread-level claim/source graphs.

## Language

**Research Dossier (科研档案)**:
A read-only, exact-version presentation of one research checkpoint or scientific compute run, combining the research narrative, sources, outputs, version position, reproduction state, and actionable limitations. It owns no records or current pointer and never substitutes `latest`.
_Avoid_: plot provenance, evidence graph, chat history

**Scientific Plot Provenance (科学图表数据溯源)**:
A figure-level technical projection over immutable plot outputs. Code and hybrid routes use `scientific-plot-render-manifest` versions and show exact data sources, transformations, statistics, parameters, environment, execution, review, and rerun/compare relationships. Model-only routes retain the same provenance intent through a Model Render Receipt (effective prompt, public model identity/version, generation parameters, renderer version, and replay recipe) in the image manifest.
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

**Evidence DAG (证据 DAG)**:
A thread-scoped graph of claims, source assertions, source anchors, runs, findings, and their support or contradiction relations. Scientific Plotting may hand off committed lineage to it asynchronously, but Evidence DAG does not own the figure manifest or the figure's byte history.
_Avoid_: plot provenance, research dossier

## Relationships

- Research Dossier reads exact Research Checkpoint or compute-run identities and composes owner projections for a research process.
- Scientific Plot Provenance reads exact Artifact Versions of kind `scientific-plot-render-manifest` and its declared recipe, figure, data, and log dependencies for code/hybrid routes; model-only routes persist the Model Render Receipt in the image-generation manifest for replay and review.
- A formal plot render commits to Artifact Versions first and may publish a pending/enqueued lineage handoff to Evidence DAG; an enqueued handoff is not an Evidence Snapshot or an L4 claim. Model-only output remains a governed image-generation artifact until an Artifact Version is explicitly committed through the visual-review acceptance path.
- Research Dossier and Scientific Plot Provenance are sibling projections. They may refer to the same figure, but neither replaces the other: the dossier explains the research result and its context, while plot provenance explains how one figure was produced and can be rerun.
