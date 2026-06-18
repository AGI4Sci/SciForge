"""Engine facade: per-thread graph store tying extraction, verification,
provenance, metrics, and PROV-JSON persistence together.

One thread == one graph (phase-1 scope). In-memory, with optional PROV-JSON
disk persistence so a thread's DAG survives restart and is citable.
"""
from __future__ import annotations

import os
import time
from typing import Optional

from . import analysis as _analysis
from . import metrics as _metrics
from . import provjson
from . import reconcile as _reconcile
from .extractor import extract_dag
from .graph import ThreadGraph
from .llm import LLM
from .verifier import verify as _verify


class Engine:
    def __init__(self, llm: Optional[LLM] = None, *, storage_dir: Optional[str] = None) -> None:
        self.llm = llm
        self.storage_dir = storage_dir
        self._graphs: dict[str, ThreadGraph] = {}
        self._updated: dict[str, float] = {}  # thread_id -> last-write time (for recency)
        self._last_delta: dict[str, dict] = {}  # thread_id -> ids added by last ingest
        if storage_dir:
            os.makedirs(storage_dir, exist_ok=True)

    def _touch(self, thread_id: str) -> None:
        self._updated[thread_id] = time.time()

    # --- thread lifecycle ---------------------------------------------------
    def ingest_trace(self, thread_id: str, trace: list[dict], *, merge: bool = False) -> ThreadGraph:
        """Extract a trace into the thread's graph.

        merge=False (default, back-compatible): REPLACE the thread's graph with a
        fresh extraction of `trace` (feed the whole conversation each time).

        merge=True: extract `trace` as a DELTA (typically just the latest turn)
        and ACCUMULATE it into the thread's existing graph — the DAG grows across
        the conversation instead of resetting. Newly added node/edge ids are
        recorded in `last_delta(thread_id)` so the caller can verify only the new
        supports edges.
        """
        if self.llm is None:
            raise RuntimeError("no LLM configured for extraction")
        extracted = extract_dag(trace, self.llm, thread_id)
        if merge:
            base = self.get(thread_id)
            if base is None:
                graph = extracted
                delta = {"new_nodes": list(extracted.nodes), "new_edges": list(extracted.edges)}
            else:
                delta = base.merge_from(extracted)
                graph = base
        else:
            graph = extracted
            delta = {"new_nodes": list(extracted.nodes), "new_edges": list(extracted.edges)}
        self._graphs[thread_id] = graph
        self._last_delta[thread_id] = delta
        self._touch(thread_id)
        self._persist(thread_id)
        return graph

    def last_delta(self, thread_id: str) -> dict:
        """Node/edge ids added by the most recent ingest_trace for this thread."""
        return self._last_delta.get(thread_id, {"new_nodes": [], "new_edges": []})

    def get(self, thread_id: str) -> Optional[ThreadGraph]:
        if thread_id in self._graphs:
            return self._graphs[thread_id]
        loaded = self._load_from_disk(thread_id)
        if loaded is not None:
            self._graphs[thread_id] = loaded
        return loaded

    def require(self, thread_id: str) -> ThreadGraph:
        g = self.get(thread_id)
        if g is None:
            raise KeyError(thread_id)
        return g

    def list_threads(self) -> list[str]:
        """Known thread ids, NEWEST-FIRST (so the UI/button lands on the thread
        most recently fed — i.e. the one you're actively working in)."""
        recency: dict[str, float] = {}
        if self.storage_dir and os.path.isdir(self.storage_dir):
            for fn in os.listdir(self.storage_dir):
                if fn.endswith(".prov.json"):
                    tid = fn[: -len(".prov.json")]
                    try:
                        recency[tid] = os.path.getmtime(os.path.join(self.storage_dir, fn))
                    except OSError:
                        recency[tid] = 0.0
        for tid in self._graphs:
            recency.setdefault(tid, 0.0)
        for tid, t in self._updated.items():  # in-memory writes win
            recency[tid] = max(recency.get(tid, 0.0), t)
        return [tid for tid, _ in sorted(recency.items(), key=lambda kv: (-kv[1], kv[0]))]

    def verify(self, thread_id: str, *, threshold: float = 0.7, only_unscored: bool = False) -> dict:
        if self.llm is None:
            raise RuntimeError("no LLM configured for verification")
        graph = self.require(thread_id)
        diff = _verify(graph, self.llm, threshold=threshold, only_unscored=only_unscored)
        self._touch(thread_id)
        self._persist(thread_id)
        return diff

    def provenance(self, thread_id: str, node_id: str) -> dict:
        return self.require(thread_id).provenance_path(node_id)

    def metrics(self, thread_id: str) -> dict:
        return _metrics.all_metrics(self.require(thread_id))

    def analysis(self, thread_id: str, *, threshold: float = 0.7) -> dict:
        return _analysis.analyze(self.require(thread_id), threshold=threshold)

    def reconcile(self, thread_id: str, *, remove_nodes=(), remove_edges=(),
                  add_contradicts=(), threshold: float = 0.7) -> dict:
        """Read-only what-if 扰动:模拟删源/删边后哪些结论坍塌,不改动已存的图。"""
        return _reconcile.reconcile(
            self.require(thread_id), remove_nodes=remove_nodes, remove_edges=remove_edges,
            add_contradicts=add_contradicts, threshold=threshold)

    def export_prov_json(self, thread_id: str) -> dict:
        return provjson.to_prov_json(self.require(thread_id))

    def import_prov_json(self, doc: dict) -> ThreadGraph:
        graph = provjson.from_prov_json(doc)
        self._graphs[graph.thread_id] = graph
        self._persist(graph.thread_id)
        return graph

    # --- persistence --------------------------------------------------------
    def _path(self, thread_id: str) -> Optional[str]:
        if not self.storage_dir:
            return None
        safe = thread_id.replace("/", "_").replace("\\", "_")
        return os.path.join(self.storage_dir, f"{safe}.prov.json")

    def _persist(self, thread_id: str) -> None:
        path = self._path(thread_id)
        if path and thread_id in self._graphs:
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(provjson.dumps(self._graphs[thread_id]))

    def _load_from_disk(self, thread_id: str) -> Optional[ThreadGraph]:
        path = self._path(thread_id)
        if path and os.path.exists(path):
            with open(path, encoding="utf-8") as fh:
                return provjson.loads(fh.read())
        return None
