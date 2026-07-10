# @sciforge/project-dag

Single-user, local **Project DAG compiler**. The Evidence-DAG engine turns each
agent thread into its own claim–evidence graph; this package **merges those
per-thread graphs into ONE goal-oriented project graph** — so a research project
spread across many threads becomes a single, auditable, deduplicated picture of
"what do we now believe, how well-supported is it, and where does it conflict."

The Evidence-DAG engine is **unchanged**; its persisted per-thread PROV-JSON
files are this package's read-only input.

## Features

- **Goal-oriented compile** — one click compiles *all* threads (incremental via
  watermarks). Conclusions are distilled, attributed to a project **goal**, and
  the same finding reached in different threads is **merged** (not duplicated).
- **True cross-session merge** — entity resolution (same thing, different name),
  claim matching, and same-source evidence dedup. A claim independently
  confirmed by N threads gains N support paths (a robustness signal).
- **Conflict adjudication** — contradictory claims are detected (LLM yes/no) and
  resolved by **rules** (evidence strength / independent-source count); the
  reason is written to the edge for audit. Ties go to the review queue.
- **Belief maintenance** — every claim is labelled `supported / fragile /
  conflicted / invalidated`; load-bearing / fragility / hidden-shared-source are
  computed by reusing Evidence-DAG's dominator analysis.
- **Append-only evidence state** — invalidation closes a `t_invalid` window so
  Project DAG keeps an auditable current graph without destructive rewrites.
- **Review queue** — entity/claim merges below the auto threshold, unresolved
  conflicts, and orphan claims (no goal).
- **Web UI (4 views)** — 项目主页 / Goal 树 / **图谱** / 编译控制台. The 图谱 view
  is an interactive, draggable, collapsible tree:
  `GOAL → subtopic group (session) → claim (derived children nested) → evidence`,
  colour-coded by status with ⚡ load-bearing and amber fragility overlays.

## Implementation

Compile pipeline (one run, mirrors the construction plan; each session commits
as one SQLite transaction with its watermark — crash-safe, resumable, idempotent):

```
Phase 0  dirty sessions     file hash vs watermark
Phase 1  delta              new eligible claim nodes + vanished ids (rewrite)
Phase 2  distill (LLM)      claim + goal attribution + hard citation check;
                            evidence dedup by content-addressed source_hash
Phase 3  entity resolution  text dual-recall -> 3-vote LLM gate (0.85 / 0.60)
Phase 4  claim matching     equivalent -> merge support paths | refines -> derived_from
Phase 5  conflicts          LLM detects; adjudication is RULES ONLY (auditable)
Phase 6  reconcile          incremental relabel of the affected subgraph
Phase 7  orphan pool        -> review queue
```

Reuse — no duplicated machinery:

| Concern | Comes from |
|---|---|
| Session graph parsing | `evidence_dag.provjson` |
| Model Router client + offline stub | `evidence_dag.llm` |
| Load-bearing / fragility / pseudo-robust | `evidence_dag.analysis` — the project graph is *projected* into a `ThreadGraph` and run through the same dominator analysis the session sidebar uses |
| Node identity / dedup | Evidence-DAG content-addressed ids double as `evidence.source_hash` |

Key design choices (vs the original plan): the real engine uses
**content-addressed node ids** (no monotonic `seq`), so the watermark is
`(dag file hash, set of processed node ids)` and a rewritten node = vanished id
+ new id → the invalidate path (append-only preserved). `quality_score` maps
from the extractor's `credibility` (high .9 / medium .6 / low .3).

Layout:

| File | Concern |
|---|---|
| `src/project_dag/store.py` | SQLite schema (goals versioned, bi-temporal edges, watermark, review queue) |
| `src/project_dag/reader.py` | read-only adapter over the Evidence-DAG PROV-JSON store + watermark delta |
| `src/project_dag/judge.py` | `llm_judge(task, payload)` — the single LLM funnel, cached; offline stub |
| `src/project_dag/compiler.py` | Phase 0–7 pipeline + rule-based conflict adjudication |
| `src/project_dag/reconcile.py` | status relabel + projection into `ThreadGraph` for analysis reuse |
| `src/project_dag/service.py` | engine facade: compile, goals, claims, review, graph |
| `src/project_dag/server.py` | HTTP service (ServiceResult) + bundled UI + daily scheduler |
| `ui/index.html` | zero-dependency web UI (the 图谱 view lives here) |
| `desktop/{contract,sidecar}.ts` | desktop integration: URL/deep-link contract + managed Python sidecar |
| `samples/seed_showcase.py` | offline demo seeder exercising every node type / DAG feature |

## Desktop (GUI) integration

The SciForge app starts this as a **lazy managed sidecar** (on first use, from
Model Router settings — same model the app is configured with) and exposes it
inside the Workbench right sidebar. The panel can refresh the graph, store the
project goal, and trigger a compile through IPC while keeping the bundled web UI
embedded in the app. Wiring mirrors the Evidence-DAG panel:

| Piece | Location |
|---|---|
| Managed sidecar (spawn / health / stop) | `desktop/sidecar.ts` |
| Deep-link contract (`?view=`, `?embed=1`) | `desktop/contract.ts` |
| IPC handlers `projectDag:view` / `projectDag:compile` | `src/main/ipc/register-app-ipc-handlers.ts` |
| Right-sidebar panel | `src/renderer/src/components/project-dag/ProjectDagPanel.tsx` |

## Run (standalone, for diagnostics)

```powershell
cd packages/workers/project-dag
python -m pip install -r requirements.txt
$env:PYTHONPATH = 'src'
$env:PDAG_SESSION_DIR = "$env:APPDATA\SciForge\evidence-dag\threads"  # = EDAG_STORAGE_DIR
$env:PDAG_DB_PATH     = '.\out\project.db'
$env:SCIFORGE_PROJECT_DAG_API_KEY = 'dev-token'
# optional LLM (omit -> OFFLINE: browse works, compile needs the router):
$env:EDAG_MODEL_ROUTER_BASE_URL = 'http://127.0.0.1:3892/v1'
$env:EDAG_MODEL_ROUTER_API_KEY  = 'local-router-key'
python -m project_dag.server          # http://127.0.0.1:3898/#token=dev-token
```

Offline demo (no LLM): seed the showcase project, then open the 图谱 view —

```powershell
$env:PYTHONPATH = 'src'
python samples/seed_showcase.py .\out\project.db .\out\threads
```

Tests are fully offline (StubJudge): `python tests/test_compile.py`

## HTTP API (ServiceResult, bearer `SCIFORGE_PROJECT_DAG_API_KEY`)

```
GET  /health | /version | /             bundled UI
POST /compile                {"scope":"all"|["thread-id",...]}
POST /full-check                         full relabel safety net (report drift)
GET  /compile-runs[/{id}]                history / full persisted diff
GET  /goals   POST /goals   POST /goals/{root}/update    (versioned, never in place)
GET  /claims?goal=        GET /claims/{id}
GET  /analysis?goal=&threshold=          reused dominator analysis
GET  /graph                              alive goals/claims/evidence/edges (图谱 view)
GET  /review  POST /review/{id}/resolve  {"decision","extra":{"winner"|"goal_id"}}
```

## Env

| Var | Default | Meaning |
|---|---|---|
| `PDAG_SESSION_DIR` | `EDAG_STORAGE_DIR` → `./threads` | Evidence-DAG PROV-JSON dir (read-only) |
| `PDAG_DB_PATH` | `./project.db` | SQLite (WAL) project store |
| `PDAG_HOST` / `PDAG_PORT` | `127.0.0.1` / `3898` | HTTP bind |
| `SCIFORGE_PROJECT_DAG_API_KEY` | — | required bearer; unset ⇒ JSON APIs answer UNAVAILABLE |
| `PDAG_SCHEDULE` | `1` | daily scheduled compile + catch-up |
| `EDAG_MODEL_ROUTER_*` | — | reused Model Router config (same as Evidence-DAG) |

## Deferred (documented, not silently dropped)

- `artifact_registry` / `depends_on_artifact` — phase-1 session graphs carry no
  file provenance yet (needs a runtime seam).
- Embedding recall — text dual-recall only; add when claim volume demands it.
- `needs_regoal` re-attribution step; min-cut source independence.
