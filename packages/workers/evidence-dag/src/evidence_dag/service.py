"""Engine facade: per-thread graph store tying extraction, verification,
provenance, metrics, and PROV-JSON persistence together.

One thread == one graph (phase-1 scope). In-memory, with optional PROV-JSON
disk persistence so a thread's DAG survives restart and is citable.
"""
from __future__ import annotations

import json
import os
import re
import time
import uuid
from typing import Optional

from . import analysis as _analysis
from . import audit as _audit
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
        self._audit_runs: dict[str, list[dict]] = {}
        self._updated: dict[str, float] = {}  # thread_id -> last-write time (for recency)
        self._last_delta: dict[str, dict] = {}  # thread_id -> ids added by last ingest
        self._meta_tid_cache: dict[str, tuple[float, str]] = {}  # file -> (mtime, thread_id)
        if storage_dir:
            os.makedirs(storage_dir, exist_ok=True)

    def _touch(self, thread_id: str) -> None:
        self._updated[thread_id] = time.time()

    # --- thread lifecycle ---------------------------------------------------
    def ingest_trace(self, thread_id: str, trace: list[dict], *, rebuild: bool = False) -> ThreadGraph:
        """Extract a trace into the thread's graph.

        By default, each trace is treated as a completed-turn delta and merged
        into the existing thread DAG. Use rebuild=True only for an explicit full
        graph rebuild from a whole-conversation trace.

        Newly added node/edge ids are recorded in `last_delta(thread_id)` so the
        caller can verify only the new supports edges.
        """
        if self.llm is None:
            raise RuntimeError("no LLM configured for extraction")
        extracted = extract_dag(trace, self.llm, thread_id)
        if rebuild:
            graph = extracted
            delta = {"new_nodes": list(extracted.nodes), "new_edges": list(extracted.edges)}
        else:
            base = self.get(thread_id)
            if base is None:
                graph = extracted
                delta = {"new_nodes": list(extracted.nodes), "new_edges": list(extracted.edges)}
            else:
                delta = base.merge_from(extracted)
                graph = base
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
        most recently fed — i.e. the one you're actively working in).

        The authoritative id is `edag:meta.thread_id` INSIDE each file, not the
        filename: filenames are sanitised for Windows-illegal characters (real
        ids look like `runtime:thread`), so deriving the id from the filename
        would list a phantom `runtime_thread` alongside the real id once the
        thread is loaded. Meta reads are mtime-cached, so a steady-state list
        costs one os.listdir + getmtime per file."""
        recency: dict[str, float] = {}
        if self.storage_dir and os.path.isdir(self.storage_dir):
            for fn in os.listdir(self.storage_dir):
                if not fn.endswith(".prov.json"):
                    continue
                path = os.path.join(self.storage_dir, fn)
                try:
                    mtime = os.path.getmtime(path)
                except OSError:
                    continue
                cached = self._meta_tid_cache.get(fn)
                if cached is not None and cached[0] == mtime:
                    tid = cached[1]
                else:
                    tid = self._read_thread_id(path) or fn[: -len(".prov.json")]
                    self._meta_tid_cache[fn] = (mtime, tid)
                recency[tid] = mtime
        for tid in self._graphs:
            recency.setdefault(tid, 0.0)
        for tid, t in self._updated.items():  # in-memory writes win
            recency[tid] = max(recency.get(tid, 0.0), t)
        return [tid for tid, _ in sorted(recency.items(), key=lambda kv: (-kv[1], kv[0]))]

    @staticmethod
    def _read_thread_id(path: str) -> Optional[str]:
        try:
            with open(path, encoding="utf-8") as fh:
                doc = json.load(fh)
            tid = (doc.get("edag:meta") or {}).get("thread_id")
            return tid if isinstance(tid, str) and tid else None
        except (OSError, ValueError):
            return None

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

    def audit(self, thread_id: str, *, trigger: str = "manual", threshold: float = 0.7) -> dict:
        run = _audit.run_audit(
            self.require(thread_id),
            threshold=threshold,
            trigger=trigger,
            run_id=f"audit:{uuid.uuid4().hex[:12]}",
        )
        latest = self.latest_audit(thread_id)
        if trigger == "auto" and latest is not None \
                and latest.get("dag_digest") == run.get("dag_digest") \
                and latest.get("threshold") == run.get("threshold"):
            return latest
        runs = [run, *self.audit_runs(thread_id)]
        self._audit_runs[thread_id] = runs[:50]
        self._persist_audit(thread_id)
        return run

    def audit_runs(self, thread_id: str) -> list[dict]:
        if thread_id in self._audit_runs:
            return self._audit_runs[thread_id]
        loaded = self._load_audit_from_disk(thread_id)
        self._audit_runs[thread_id] = loaded
        return loaded

    def latest_audit(self, thread_id: str) -> Optional[dict]:
        runs = self.audit_runs(thread_id)
        return runs[0] if runs else None

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
    @staticmethod
    def _safe_thread_filename(thread_id: str) -> str:
        return re.sub(r'[/\\:<>"|?*]', "_", thread_id)

    def _path(self, thread_id: str) -> Optional[str]:
        if not self.storage_dir:
            return None
        # Sanitise every Windows-illegal filename character, not just path
        # separators. Real thread ids are `{runtimeId}:{threadId}` — on NTFS a
        # colon silently turns the tail into an alternate data stream, so the
        # directory ends up with no `.prov.json` file at all and persistence
        # fails without an error. Ids without these characters keep the exact
        # same filename as before (backward compatible).
        safe = self._safe_thread_filename(thread_id)
        return os.path.join(self.storage_dir, f"{safe}.prov.json")

    def _audit_path(self, thread_id: str) -> Optional[str]:
        if not self.storage_dir:
            return None
        return os.path.join(self.storage_dir, f"{self._safe_thread_filename(thread_id)}.audit.json")

    def _persist(self, thread_id: str) -> None:
        path = self._path(thread_id)
        if path and thread_id in self._graphs:
            tmp = f"{path}.tmp"
            with open(tmp, "w", encoding="utf-8") as fh:
                fh.write(provjson.dumps(self._graphs[thread_id]))
            os.replace(tmp, path)

    def _persist_audit(self, thread_id: str) -> None:
        path = self._audit_path(thread_id)
        if path and thread_id in self._audit_runs:
            tmp = f"{path}.tmp"
            with open(tmp, "w", encoding="utf-8") as fh:
                json.dump({
                    "thread_id": thread_id,
                    "runs": self._audit_runs[thread_id],
                }, fh, ensure_ascii=False, indent=2)
            os.replace(tmp, path)

    def _load_from_disk(self, thread_id: str) -> Optional[ThreadGraph]:
        path = self._path(thread_id)
        if path and os.path.exists(path):
            with open(path, encoding="utf-8") as fh:
                return provjson.loads(fh.read())
        return None

    def _load_audit_from_disk(self, thread_id: str) -> list[dict]:
        path = self._audit_path(thread_id)
        if path and os.path.exists(path):
            try:
                with open(path, encoding="utf-8") as fh:
                    doc = json.load(fh)
                runs = doc.get("runs") if isinstance(doc, dict) else doc
                return runs if isinstance(runs, list) else []
            except (OSError, ValueError):
                return []
        return []
