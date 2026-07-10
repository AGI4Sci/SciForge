# @sciforge/evidence-dag

Standalone, dependency-light **Python** service (`packages/workers/evidence-dag`) that
turns an agent trace into a typed **claim–evidence DAG**, verifies its `supports` edges
with an NLI judge, and serialises losslessly to **PROV-JSON**. It is the engine half of the
"living evidence DAG" — the embedded Workbench view, sidecar launcher, and trace-feed contract live in this
package's `desktop/` modules and are called from the SciForge desktop app.

The service returns structured **`ServiceResult`** evidence only (graph, provenance,
metrics, audit findings) — never a user-level final answer or completion truth.

> **Scope (phase 1):** one **thread == one graph**. Status is limited to
> `supported / unverified / conflicting`; `contradicts` edges are extracted, scored
> when a verifier is available, and exposed. `fragile`, load-bearing, weak support,
> hidden shared-source, and audit findings are computed as read-only views; Reconcile-write,
> source retraction feeds, and ATMS labels remain phase 2+.

## Layout

| Concern | File |
|---|---|
| Data contract (Node/Edge/enums, content-addressed ids, dedup key) | `src/evidence_dag/model.py` |
| Thread graph: dedup, cycle detection, provenance traversal, topo layers | `src/evidence_dag/graph.py` |
| PROV-JSON serialize/deserialize (lossless round-trip) | `src/evidence_dag/provjson.py` |
| Model Router client (+ offline stub) | `src/evidence_dag/llm.py` |
| Trace → DAG extractor (LLM structured output) | `src/evidence_dag/extractor.py` |
| L2 verifier: NLI ν per supports edge, noisy-OR status | `src/evidence_dag/verifier.py` |
| Four AAR metrics | `src/evidence_dag/metrics.py` |
| Load-bearing / fragility / hidden shared-source (dominator analysis) | `src/evidence_dag/analysis.py` |
| Reconcile / what-if 扰动 (deterministic, read-only) | `src/evidence_dag/reconcile.py` |
| Evidence Audit Runs (deterministic adversarial findings + risk digest) | `src/evidence_dag/audit.py` |
| Engine facade + per-thread persistence | `src/evidence_dag/service.py` |
| HTTP service (`ServiceResult`) | `src/evidence_dag/server.py` |
| Bundled Workbench UI (graph view, served at `/`) | `ui/index.html` |
| Desktop contract/sidecar modules | `desktop/*.ts` |
| Demo multi-turn traces for acceptance | `samples/*.json`, `samples/load.py` |

## Run

As an npm workspace (installs the Python package editable, then serves on :3897):

```bash
export SCIFORGE_EVIDENCE_DAG_API_KEY=dev-token
export EDAG_MODEL_ROUTER_BASE_URL=http://127.0.0.1:3892/v1
export EDAG_MODEL_ROUTER_API_KEY=local-router-key
export EDAG_MODEL_ROUTER_MODEL=sciforge-router
npm --workspace @sciforge/evidence-dag run start
```

The desktop app normally starts this sidecar automatically from
`desktop/sidecar.ts`, using the app's local Model Router settings. Direct runs are
for diagnostics:

```powershell
cd packages/workers/evidence-dag
python -m pip install -r requirements.txt    # networkx (stdlib otherwise)
$env:PYTHONPATH = 'src'; $env:PYTHONUTF8 = '1'
$env:EDAG_STORAGE_DIR = '.\out\threads'      # optional PROV-JSON persistence
$env:EDAG_MODEL_ROUTER_BASE_URL = 'http://127.0.0.1:3892/v1'
$env:EDAG_MODEL_ROUTER_API_KEY  = 'local-router-key'
$env:EDAG_MODEL_ROUTER_MODEL    = 'sciforge-router'
$env:SCIFORGE_EVIDENCE_DAG_API_KEY = 'dev-token'
python -m evidence_dag.server                # http://127.0.0.1:3897
```

Load the sample traces into a running engine for diagnostics, then open
`http://127.0.0.1:3897/#token=dev-token` or use the Workbench right-panel item:

```bash
SCIFORGE_EVIDENCE_DAG_API_KEY=dev-token python samples/load.py
# or EDAG_URL=http://127.0.0.1:3897 SCIFORGE_EVIDENCE_DAG_API_KEY=dev-token python samples/load.py
```

## HTTP API (ServiceResult)

```text
GET  /health
GET  /version
GET  /                                                 # bundled web UI
POST /threads/{id}/ingest-trace   {"trace":[ {id,type,role?,tool_name?,content} ... ], "rebuild?":bool, "verify?":bool}
GET  /threads/{id}/graph
POST /threads/{id}/verify         {"threshold":0.7}
GET  /threads/{id}/provenance?node=<nodeId>
GET  /threads/{id}/metrics
GET  /threads/{id}/analysis?threshold=0.7              # load-bearing / fragility / hidden shared-source
GET  /threads/{id}/audit-runs                          # latest + persisted audit runs
POST /threads/{id}/audit-runs      {"trigger":"manual","threshold":0.7,"verify?":bool}
POST /threads/{id}/reconcile      {"remove_nodes":[...],"remove_edges":[...],"add_contradicts":[...]}
GET  /threads/{id}/prov-json                           # export
POST /threads/{id}/prov-json      {"doc":{...}}        # import / reload
GET  /threads                                          # list known thread ids
```

All JSON APIs except `/health` and the bundled UI require
`Authorization: Bearer $SCIFORGE_EVIDENCE_DAG_API_KEY`. If the service starts
without a configured API key, JSON APIs return `UNAVAILABLE` instead of running
open on localhost.

The bundled UI reads the token from the URL hash fragment, removes it from the
address bar, and then sends JSON API requests with the same bearer token. The
desktop Workbench right-panel item fills this in automatically from the main-process env.

`/analysis` (read-only, no LLM) reports **load-bearing** nodes (dominators ≥2 conclusions
depend on), **fragile** conclusions (ungrounded / single-source / contested), and
**hidden shared-source** claims (look multi-supported but every path funnels through one
source). `/reconcile` is a deterministic **what-if** — simulate removing sources/edges (or
adding a contradiction) and get the blast radius (which conclusions collapse / weaken /
turn conflicting); it never mutates the graph. `/audit-runs` converts the current graph and
analysis view into adversarial findings such as ungrounded claims, unresolved contradictions,
weak support, single-source dependencies, hidden shared-source, load-bearing evidence, and
low-credibility sources. Audit runs are persisted next to the thread graph as `.audit.json`,
carry a stable `dag_digest`, and do not mutate the DAG. `ingest-trace` grows the thread's
graph incrementally across turns by default; `rebuild:true` explicitly replaces the graph
from a whole-conversation trace. Ingest runs a lightweight advisory audit by default
(`EDAG_AUTO_AUDIT=1`) and deduplicates auto-runs for unchanged DAG digests.

## Config (env)

| Var | Default | Meaning |
|---|---|---|
| `EDAG_MODEL_ROUTER_BASE_URL` | — | local Model Router base URL (enables extraction/verify; omit for offline) |
| `EDAG_MODEL_ROUTER_API_KEY` | — | Model Router runtime bearer key |
| `EDAG_MODEL_ROUTER_MODEL` | `sciforge-router` | public Model Router alias |
| `EDAG_AUTO_VERIFY` | `1` | auto-verify supports edges right after ingest |
| `EDAG_AUTO_AUDIT` | `1` | run a quick advisory audit after ingest; duplicate DAG digests reuse the latest auto run |
| `EDAG_STORAGE_DIR` | — | if set, each thread's DAG is persisted as PROV-JSON |
| `EDAG_HOST` / `EDAG_PORT` | `127.0.0.1` / `3897` | HTTP bind |
| `SCIFORGE_EVIDENCE_DAG_API_KEY` | — | required bearer token for JSON APIs/feed |
| `SCIFORGE_EVIDENCE_DAG_MAX_BODY_BYTES` | `1048576` | max JSON body size for fixed and chunked requests |

Retry/backoff over a slow/flaky model lives in the module (`llm.py`: `max_attempts=5`,
exp backoff), not in the host.

## App integration seam (SciForge desktop → engine)

Real-time feed: the GUI's unified `AgentRuntimeHost` reads each completed turn's neutral
items and POSTs them to `/threads/{runtimeId}:{threadId}/ingest-trace`. SciForge Runtime,
Codex, and the Claude Code CLI all flow through the same public `AgentRuntime` contract, so
they enter one Evidence-DAG seam. Touch points in the app:

| Piece | Location |
|---|---|
| Embedded view + sidecar modules | `packages/workers/evidence-dag/desktop/*.ts` |
| Mapping + feed (pure mapping + fail-open client) | `src/main/runtime/evidence-dag-feed.ts` |
| Call site (completed turn, fire-and-forget) | `src/main/runtime/agent-runtime/host.ts` |
| Resolve UI view | `evidenceDag:view` IPC + Workbench right-panel Evidence DAG item |
| Rebuild current thread DAG | `evidenceDag:update` IPC + Workbench Evidence DAG update button |

GUI main-process env. In normal app runs `desktop/sidecar.ts` fills these from the
managed sidecar config; manual env remains useful for diagnostics:

| Var | Default | Meaning |
|---|---|---|
| `SCIFORGE_EVIDENCE_DAG_SERVICE_URL` | `http://127.0.0.1:3897` | engine base URL |
| `SCIFORGE_EVIDENCE_DAG_API_KEY` | generated | required Bearer for app feed/view |
| `SCIFORGE_EVIDENCE_DAG_TIMEOUT_MS` | `600000` | per-feed timeout (fire-and-forget) |

`trace_ref` reuses the neutral `AgentRuntimeItem.id` (stable, persistent); when the LLM does
not echo it verbatim, the extractor (`extractor.resolve_trace_refs`) deterministically
re-anchors to the real item id by content overlap.
