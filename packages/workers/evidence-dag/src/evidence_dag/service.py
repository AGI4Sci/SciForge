"""Evidence compiler facade with one update path and immutable snapshots."""
from __future__ import annotations

import hashlib
import glob
import json
import os
import re
import threading
import time
import uuid
from typing import Any, Optional

from . import analysis as _analysis
from . import audit as _audit
from . import metrics as _metrics
from . import provjson
from . import reconcile as _reconcile
from .artifacts import ArtifactRegistry
from .assessment import bind_target_digest, run_a0, run_a1, run_a2
from .events import EventStore, utc_now_iso
from .extractor import extract_dag
from .graph import ThreadGraph
from .llm import LLM
from .snapshot import (
    EXTRACTOR_VERSION,
    SCHEMA_VERSION,
    EvidenceSnapshot,
    VERIFIER_VERSION,
    build_snapshot,
    snapshot_filename,
    snapshot_storage_key,
)
from .verifier import verify as _verify


class Engine:
    def __init__(self, llm: Optional[LLM] = None, *, storage_dir: Optional[str] = None) -> None:
        self.llm = llm
        self.storage_dir = storage_dir
        self._graphs: dict[str, ThreadGraph] = {}
        self._snapshots: dict[str, EvidenceSnapshot] = {}
        self._updates: dict[str, dict[str, Any]] = {}
        self._audit_runs: dict[str, list[dict]] = {}
        self._updated: dict[str, float] = {}
        self._last_delta: dict[str, dict] = {}
        self._registries: dict[str, ArtifactRegistry] = {}
        self._lock = threading.RLock()
        if storage_dir:
            os.makedirs(storage_dir, exist_ok=True)
        self._event_store = EventStore(
            os.path.join(storage_dir, "events", "evidence-domain-events.json")
            if storage_dir else None
        )

    @staticmethod
    def _safe_key(value: str) -> str:
        slug = re.sub(r"[^A-Za-z0-9._-]", "_", value)[:80] or "scope"
        suffix = hashlib.sha256(value.encode("utf-8")).hexdigest()[:12]
        return f"{slug}-{suffix}"

    def _path(self, thread_id: str) -> Optional[str]:
        return os.path.join(self.storage_dir, snapshot_filename(thread_id)) \
            if self.storage_dir else None

    def _snapshot_dir(self, thread_id: str) -> Optional[str]:
        return os.path.join(self.storage_dir, "snapshots", snapshot_storage_key(thread_id)) \
            if self.storage_dir else None

    def _audit_path(self, thread_id: str) -> Optional[str]:
        return os.path.join(self.storage_dir, f"{self._safe_key(thread_id)}.audit.json") \
            if self.storage_dir else None

    def _update_path(self, thread_id: str) -> Optional[str]:
        return os.path.join(self.storage_dir, f"{self._safe_key(thread_id)}.update.json") \
            if self.storage_dir else None

    def _registry(
        self, project_key: str, *, workspace_root: str, project_root: Optional[str],
    ) -> ArtifactRegistry:
        workspace = os.path.abspath(workspace_root)
        project = os.path.abspath(project_root or workspace_root)
        try:
            if os.path.commonpath((workspace, project)) != workspace:
                raise ValueError("projectRoot must be contained by workspaceRoot")
        except ValueError as exc:
            raise ValueError("projectRoot must be contained by workspaceRoot") from exc
        cache_key = f"{project_key}|{workspace}|{project}"
        registry = self._registries.get(cache_key)
        if registry is None:
            registry_path = os.path.join(
                self.storage_dir, "artifact-registries", f"{self._safe_key(project_key)}.json",
            ) if self.storage_dir else None
            registry = ArtifactRegistry(
                registry_path, workspace_roots=(project,), locator_root=workspace,
            )
            self._registries[cache_key] = registry
        return registry

    # --- single compiler command -----------------------------------------
    def update(
        self,
        *,
        thread_id: str,
        target_watermark: str,
        reason: str,
        priority: str,
        trace: Optional[list[dict]],
        workspace_root: str,
        project_key: str,
        project_root: Optional[str] = None,
        rebuild: bool = False,
        rebuild_rationale: Optional[str] = None,
        threshold: float = 0.7,
        access_policy: Optional[dict[str, Any]] = None,
        queued_at: Optional[str] = None,
        correlation_id: Optional[str] = None,
        idempotency_key: Optional[str] = None,
    ) -> dict[str, Any]:
        if not thread_id or not str(target_watermark):
            raise ValueError("threadId and targetWatermark are required")
        if not workspace_root or not project_key:
            raise ValueError("workspaceRoot and projectKey are required")
        if not reason or not priority:
            raise ValueError("reason and priority are required")
        if trace is not None and not isinstance(trace, list):
            raise ValueError("trace must be a list when supplied")
        if rebuild and reason not in {"schema_upgrade", "corruption_recovery", "reinterpretation"}:
            raise ValueError("rebuild requires an explicit advanced rebuild reason")
        if rebuild and not str(rebuild_rationale or "").strip():
            raise ValueError("rebuildRationale is required for rebuild")
        if not rebuild and rebuild_rationale is not None:
            raise ValueError("rebuildRationale is only valid when rebuild=true")

        with self._lock:
            registry = self._registry(
                project_key, workspace_root=workspace_root, project_root=project_root,
            )
            input_digest = self._update_input_digest(
                thread_id=thread_id, target_watermark=str(target_watermark), reason=reason,
                trace=trace, workspace_root=workspace_root, project_root=project_root,
                project_key=project_key, rebuild=rebuild, threshold=threshold,
                access_policy=access_policy, rebuild_rationale=rebuild_rationale,
                # Artifact lifecycle is an input even when the runtime trace and
                # watermark are unchanged.  Omitting it here would make an
                # ArtifactContentChanged update incorrectly replay the old snapshot.
                registry_digest=registry.state_digest(),
            )
            previous_status = self._updates.get(thread_id) or self._load_update_status(thread_id)
            current = self.latest_snapshot(thread_id)
            current_graph = self.get(thread_id) if current is not None else None
            prior_input_digest = (previous_status or {}).get("inputDigest") or (
                current_graph.meta.get("inputDigest") if current_graph is not None else None
            )
            event_key = str(
                idempotency_key
                or ((previous_status or {}).get("eventIdempotencyKey")
                    if current is not None and prior_input_digest == input_digest else None)
                or input_digest
            )
            queued_event = self._event_store.append(
                "EvidenceUpdateQueued",
                aggregate_type="EvidenceThread",
                aggregate_id=thread_id,
                idempotency_key=event_key,
                occurred_at=queued_at,
                correlation_id=correlation_id,
                payload={
                    "threadId": thread_id,
                    "targetWatermark": str(target_watermark),
                    "reason": reason,
                    "priority": priority,
                    "projectKey": project_key,
                    "inputDigest": input_digest,
                },
            )
            if current is not None and prior_input_digest == input_digest:
                replay = {
                    "id": f"evidence-update:{uuid.uuid4().hex}", "threadId": thread_id,
                    "state": "fresh", "desiredWatermark": str(target_watermark),
                    "currentWatermark": current.input_watermark, "reason": reason, "priority": priority,
                    "inputDigest": input_digest, "snapshotDigest": current.digest,
                    "eventIdempotencyKey": event_key, "queuedEventId": queued_event["eventId"],
                    "startedAt": utc_now_iso(), "completedAt": utc_now_iso(), "error": None,
                }
                self._updates[thread_id] = replay
                self._persist_update_status(thread_id)
                return {
                    "update": replay, "snapshot": current.to_dict(),
                    "delta": {"new_nodes": [], "new_edges": []}, "verification": None,
                    "idempotent": True, "events": [queued_event],
                }

            status = {
                "id": f"evidence-update:{uuid.uuid4().hex}",
                "threadId": thread_id,
                "state": "updating",
                "desiredWatermark": str(target_watermark),
                "reason": reason,
                "priority": priority,
                "inputDigest": input_digest,
                "eventIdempotencyKey": event_key,
                "queuedEventId": queued_event["eventId"],
                "startedAt": utc_now_iso(),
                "error": None,
            }
            self._updates[thread_id] = status
            self._persist_update_status(thread_id)
            try:
                base = None if rebuild else self.get(thread_id)
                graph = ThreadGraph.from_dict(base.to_dict()) if base is not None else ThreadGraph(thread_id)
                graph.meta["inputDigest"] = input_digest
                graph.meta["scope"] = {
                    "projectKey": project_key,
                    "workspaceRoot": os.path.abspath(workspace_root),
                    "projectRoot": os.path.abspath(project_root or workspace_root),
                    "accessPolicy": dict(access_policy or {}),
                }

                if trace:
                    if self.llm is None:
                        raise RuntimeError("no independent Model Router client configured for extraction/review")
                    extracted = extract_dag(trace, self.llm, thread_id, artifact_registry=registry)
                    if rebuild or base is None:
                        extracted.meta.update(graph.meta)
                        graph = extracted
                        delta = {"new_nodes": list(graph.nodes), "new_edges": list(graph.edges)}
                    else:
                        delta = graph.merge_from(extracted)
                else:
                    delta = {"new_nodes": [], "new_edges": []}

                # Extraction may register the first observed ArtifactVersion.
                # Persist the post-extraction Registry digest so replaying the
                # same trace remains idempotent while later lifecycle changes
                # still invalidate the compiler input.
                input_digest = self._update_input_digest(
                    thread_id=thread_id, target_watermark=str(target_watermark), reason=reason,
                    trace=trace, workspace_root=workspace_root, project_root=project_root,
                    project_key=project_key, rebuild=rebuild, threshold=threshold,
                    access_policy=access_policy, rebuild_rationale=rebuild_rationale,
                    registry_digest=registry.state_digest(),
                )
                graph.meta["inputDigest"] = input_digest
                status["inputDigest"] = input_digest
                self._sync_registry(graph, registry)
                if graph.edges:
                    if self.llm is None:
                        raise RuntimeError("no independent verifier configured")
                    verification = _verify(
                        graph, self.llm, threshold=threshold, only_unscored=not rebuild,
                    )
                else:
                    verification = {
                        "threshold": threshold, "supports_edges_scored": 0,
                        "supports_edges_total": 0, "contradicts_edges_scored": 0,
                        "status_changes": [], "aggregates": {},
                    }

                pending = [*run_a0(graph), *run_a1(
                    graph, threshold=threshold, verifier_version=VERIFIER_VERSION,
                )]
                if self.llm is not None:
                    pending.extend(run_a2(graph, self.llm, reviewer_version=VERIFIER_VERSION))
                else:
                    raise RuntimeError("A2 independent reviewer is required for Evidence Snapshot commit")
                prior_assessment_count = len(graph.assessments)
                graph.assessments.extend(pending)

                candidate = build_snapshot(
                    graph, version=(current.version + 1 if current else 1),
                    input_watermark=str(target_watermark),
                )
                if current is not None and candidate.digest == current.digest:
                    status.update({
                        "state": "fresh", "completedAt": utc_now_iso(),
                        "currentWatermark": current.input_watermark, "snapshotDigest": current.digest,
                    })
                    self._persist_update_status(thread_id)
                    return {"update": dict(status), "snapshot": current.to_dict(),
                            "delta": {"new_nodes": [], "new_edges": []}, "verification": verification,
                            "idempotent": True, "events": [queued_event]}

                bound = bind_target_digest(pending, candidate.digest)
                graph.assessments[prior_assessment_count:] = bound
                for assessment in bound:
                    edge = graph.edges.get(assessment.target_id)
                    if edge is not None and assessment.assessment_id not in edge.assessment_ids:
                        edge.assessment_ids.append(assessment.assessment_id)
                graph.meta["snapshot"] = candidate.to_dict()
                self._commit_snapshot(graph, candidate)
                self._graphs[thread_id] = graph
                self._snapshots[thread_id] = candidate
                self._last_delta[thread_id] = delta
                self._updated[thread_id] = time.time()
                status.update({
                    "state": "fresh", "completedAt": utc_now_iso(),
                    "currentWatermark": candidate.input_watermark,
                    "snapshotDigest": candidate.digest,
                })
                self._persist_update_status(thread_id)
                committed_event = self._event_store.append(
                    "EvidenceSnapshotCommitted",
                    aggregate_type="EvidenceThread",
                    aggregate_id=thread_id,
                    idempotency_key=candidate.digest,
                    occurred_at=status["completedAt"],
                    correlation_id=correlation_id or queued_event.get("correlationId"),
                    causation_id=queued_event["eventId"],
                    payload={
                        "threadId": thread_id,
                        "snapshotDigest": candidate.digest,
                        "snapshotVersion": candidate.version,
                        "inputWatermark": candidate.input_watermark,
                        "queuedEventId": queued_event["eventId"],
                        "updateId": status["id"],
                        "startedAt": status["startedAt"],
                        "completedAt": status["completedAt"],
                    },
                )
                return {
                    "update": dict(status), "snapshot": candidate.to_dict(), "delta": delta,
                    "verification": verification, "idempotent": False,
                    "events": [queued_event, committed_event],
                }
            except Exception as exc:
                status.update({
                    "state": "error", "completedAt": utc_now_iso(),
                    "error": {"type": type(exc).__name__, "message": str(exc)},
                })
                self._persist_update_status(thread_id)
                raise

    @staticmethod
    def _update_input_digest(
        *, thread_id: str, target_watermark: str, reason: str, trace: Optional[list[dict]],
        workspace_root: str, project_root: Optional[str], project_key: str, rebuild: bool,
        threshold: float, access_policy: Optional[dict[str, Any]], registry_digest: str,
        rebuild_rationale: Optional[str],
    ) -> str:
        payload = json.dumps({
            "threadId": thread_id, "targetWatermark": target_watermark, "reason": reason,
            "trace": trace, "workspaceRoot": os.path.abspath(workspace_root),
            "projectRoot": os.path.abspath(project_root or workspace_root), "projectKey": project_key,
            "rebuild": rebuild, "threshold": threshold, "accessPolicy": access_policy or {},
            "rebuildRationale": rebuild_rationale,
            "schemaVersion": SCHEMA_VERSION, "extractorVersion": EXTRACTOR_VERSION,
            "verifierVersion": VERIFIER_VERSION, "artifactRegistryDigest": registry_digest,
        }, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        return f"sha256:{hashlib.sha256(payload.encode('utf-8')).hexdigest()}"

    def update_status(self, thread_id: str) -> dict[str, Any]:
        with self._lock:
            status = self._updates.get(thread_id) or self._load_update_status(thread_id)
            snapshot = self.latest_snapshot(thread_id)
            return {
                "threadId": thread_id,
                "status": (status or {}).get("state", "fresh" if snapshot else "dirty"),
                "desiredWatermark": (status or {}).get("desiredWatermark"),
                "currentWatermark": (status or {}).get("currentWatermark") or
                    (snapshot.input_watermark if snapshot else None),
                "error": (status or {}).get("error"),
                "updateId": (status or {}).get("id"),
                "queuedEventId": (status or {}).get("queuedEventId"),
                "reason": (status or {}).get("reason"),
                "priority": (status or {}).get("priority"),
                "snapshot": snapshot.to_dict() if snapshot else None,
            }

    def _sync_registry(self, graph: ThreadGraph, registry: ArtifactRegistry) -> None:
        stale_roots: list[str] = []
        for node in graph.nodes.values():
            if not node.artifact_id:
                continue
            artifact = registry.artifacts.get(node.artifact_id)
            referenced = registry.versions.get(node.artifact_version_id or "")
            if not artifact or not referenced:
                node.freshness = "stale"
                stale_roots.append(node.id)
                continue
            graph.artifacts[artifact.artifact_id] = type(artifact).from_dict(artifact.to_dict())
            graph.artifact_versions[referenced.version_id] = type(referenced).from_dict(referenced.to_dict())
            current = registry.versions.get(artifact.current_version_id)
            if current:
                graph.artifact_versions[current.version_id] = type(current).from_dict(current.to_dict())
            if node.source_anchor_id and node.source_anchor_id in registry.anchors:
                anchor = registry.anchors[node.source_anchor_id]
                graph.source_anchors[anchor.anchor_id] = type(anchor).from_dict(anchor.to_dict())
            if referenced.availability == "missing" or artifact.current_version_id != referenced.version_id:
                node.freshness = "stale"
                stale_roots.append(node.id)
            else:
                node.freshness = "fresh"
        support_graph = graph.supports_digraph()
        for root in stale_roots:
            for downstream in support_graph.successors(root):
                graph.nodes[downstream].freshness = "stale"
            try:
                import networkx as nx
                for downstream in nx.descendants(support_graph, root):
                    graph.nodes[downstream].freshness = "stale"
            except Exception:
                pass

    # --- Artifact Registry commands --------------------------------------
    def register_artifact(
        self, *, project_key: str, workspace_root: str, project_root: Optional[str], payload: dict[str, Any],
    ) -> dict[str, Any]:
        registry = self._registry(project_key, workspace_root=workspace_root, project_root=project_root)
        artifact, version, outcome = registry.register(
            kind=payload.get("kind", "other"), locator=payload.get("locator", ""),
            content_digest=payload.get("contentDigest"), version=payload.get("version"),
            size=payload.get("size"), media_type=payload.get("mediaType"),
            retention=payload.get("retention", "reference"),
            access_policy=payload.get("accessPolicy") if isinstance(payload.get("accessPolicy"), dict) else None,
        )
        anchor = None
        if isinstance(payload.get("selector"), dict):
            anchor = registry.create_anchor(
                artifact.artifact_id, payload["selector"], anchor_digest=payload.get("anchorDigest"),
                artifact_version_id=version.version_id,
            )
        return {"outcome": outcome, "artifact": artifact.to_dict(), "artifactVersion": version.to_dict(),
                "sourceAnchor": anchor.to_dict() if anchor else None}

    def resolve_artifact(
        self, artifact_id: str, *, project_key: str, workspace_root: str,
        project_root: Optional[str], candidate_locators: list[str],
    ) -> dict[str, Any]:
        result = self._registry(
            project_key, workspace_root=workspace_root, project_root=project_root,
        ).resolve(
            artifact_id, candidate_locators=candidate_locators,
        )
        event = result.get("event")
        if isinstance(event, dict):
            result = {**result, "domainEvent": self._event_store.append_lifecycle(
                event, project_key=project_key,
            )}
        return result

    def resolve_artifacts(
        self, *, project_key: str, workspace_root: str, project_root: Optional[str],
    ) -> dict[str, Any]:
        """Scan one project-scoped Registry and locate affected Evidence snapshots."""
        registry = self._registry(
            project_key, workspace_root=workspace_root, project_root=project_root,
        )
        events = registry.resolve_all()
        domain_events = [
            self._event_store.append_lifecycle(event, project_key=project_key)
            for event in events
        ]
        changed_ids = {event["artifactId"] for event in events}
        affected: list[dict[str, Any]] = []
        if changed_ids:
            for thread_id in self.list_threads():
                graph = self.get(thread_id)
                if graph is None:
                    continue
                scope = (graph.meta or {}).get("scope") or {}
                if scope.get("projectKey") != project_key:
                    continue
                used = sorted({
                    node.artifact_id for node in graph.nodes.values()
                    if node.artifact_id in changed_ids
                })
                if not used:
                    continue
                snapshot = self.latest_snapshot(thread_id)
                if snapshot is None:
                    continue
                affected.append({
                    "threadId": thread_id,
                    "targetWatermark": snapshot.input_watermark,
                    "artifactIds": used,
                })
        return {
            "events": events,
            "domainEvents": domain_events,
            "affectedThreads": affected,
            "scope": {
                "projectKey": project_key,
                "workspaceRoot": os.path.abspath(workspace_root),
                "projectRoot": os.path.abspath(project_root or workspace_root),
            },
        }

    def acknowledge_artifact_events(
        self, *, project_key: str, workspace_root: str, project_root: Optional[str],
        event_ids: list[str],
    ) -> dict[str, Any]:
        registry = self._registry(
            project_key, workspace_root=workspace_root, project_root=project_root,
        )
        acknowledged = registry.acknowledge_events(event_ids)
        return {"acknowledged": acknowledged, "pending": len(registry.pending_events)}

    # --- read models / audit side chain ----------------------------------
    def get(self, thread_id: str) -> Optional[ThreadGraph]:
        if thread_id in self._graphs:
            return self._graphs[thread_id]
        path = self._path(thread_id)
        if not path or not os.path.exists(path):
            return None
        with open(path, encoding="utf-8") as fh:
            graph = provjson.loads(fh.read())
        snapshot = EvidenceSnapshot.from_dict((graph.meta or {}).get("snapshot") or {})
        if snapshot.thread_id != thread_id:
            raise ValueError("snapshot threadId does not match requested thread")
        self._graphs[thread_id] = graph
        self._snapshots[thread_id] = snapshot
        return graph

    def require(self, thread_id: str) -> ThreadGraph:
        graph = self.get(thread_id)
        if graph is None:
            raise KeyError(thread_id)
        return graph

    def latest_snapshot(self, thread_id: str) -> Optional[EvidenceSnapshot]:
        if thread_id in self._snapshots:
            return self._snapshots[thread_id]
        graph = self.get(thread_id)
        return EvidenceSnapshot.from_dict(graph.meta["snapshot"]) if graph else None

    def list_threads(self) -> list[str]:
        found: dict[str, float] = {}
        if self.storage_dir:
            for filename in os.listdir(self.storage_dir):
                if not filename.endswith(".prov.json"):
                    continue
                path = os.path.join(self.storage_dir, filename)
                try:
                    with open(path, encoding="utf-8") as fh:
                        doc = json.load(fh)
                    snapshot = EvidenceSnapshot.from_dict((doc.get("edag:meta") or {}).get("snapshot") or {})
                    found[snapshot.thread_id] = os.path.getmtime(path)
                except (OSError, ValueError, TypeError):
                    continue
        for thread_id in self._graphs:
            found[thread_id] = max(found.get(thread_id, 0.0), self._updated.get(thread_id, 0.0))
        return [key for key, _ in sorted(found.items(), key=lambda item: (-item[1], item[0]))]

    def last_delta(self, thread_id: str) -> dict:
        return self._last_delta.get(thread_id, {"new_nodes": [], "new_edges": []})

    def provenance(self, thread_id: str, node_id: str) -> dict:
        return self.require(thread_id).provenance_path(node_id)

    def metrics(self, thread_id: str) -> dict:
        snapshot = self.latest_snapshot(thread_id)
        return _metrics.all_metrics(
            self.require(thread_id),
            events=self.events(thread_id=thread_id, limit=5000),
            audits=self.audit_runs(thread_id),
            snapshot=snapshot.to_dict() if snapshot else None,
            snapshot_history=self._snapshot_history(thread_id),
        )

    def events(
        self, *, thread_id: Optional[str] = None, event_types=(),
        after_sequence: int = 0, limit: int = 500,
    ) -> list[dict[str, Any]]:
        if limit < 1 or limit > 5000:
            raise ValueError("limit must be between 1 and 5000")
        # Audit/Finding events aggregate by their own identity, so thread
        # filtering also checks the durable payload instead of inventing a
        # duplicate per-thread event.
        events = self._event_store.read(
            event_types=event_types, after_sequence=after_sequence, limit=5000,
        )
        if thread_id is not None:
            events = [
                event for event in events
                if event.get("aggregateId") == thread_id
                or (isinstance(event.get("payload"), dict)
                    and event["payload"].get("threadId") == thread_id)
            ]
        return events[:limit]

    def _snapshot_history(self, thread_id: str) -> list[dict[str, Any]]:
        directory = self._snapshot_dir(thread_id)
        snapshots: dict[str, dict[str, Any]] = {}
        if directory and os.path.isdir(directory):
            for path in glob.glob(os.path.join(directory, "*.prov.json")):
                try:
                    with open(path, encoding="utf-8") as fh:
                        graph = provjson.loads(fh.read())
                    snapshot = EvidenceSnapshot.from_dict((graph.meta or {}).get("snapshot") or {})
                    if snapshot.thread_id == thread_id:
                        snapshots[snapshot.digest] = snapshot.to_dict()
                except (OSError, TypeError, ValueError):
                    continue
        current = self.latest_snapshot(thread_id)
        if current is not None:
            snapshots[current.digest] = current.to_dict()
        return sorted(snapshots.values(), key=lambda item: int(item["version"]))

    def analysis(self, thread_id: str, *, threshold: float = 0.7) -> dict:
        return _analysis.analyze(self.require(thread_id), threshold=threshold)

    def reconcile(self, thread_id: str, *, remove_nodes=(), remove_edges=(),
                  add_contradicts=(), threshold: float = 0.7) -> dict:
        return _reconcile.reconcile(
            self.require(thread_id), remove_nodes=remove_nodes, remove_edges=remove_edges,
            add_contradicts=add_contradicts, threshold=threshold,
        )

    def snapshot_graph(self, thread_id: str, target_digest: str) -> tuple[ThreadGraph, EvidenceSnapshot]:
        current = self.latest_snapshot(thread_id)
        if current is not None and current.digest == target_digest:
            return self.require(thread_id), current
        directory = self._snapshot_dir(thread_id)
        if not directory:
            raise KeyError(target_digest)
        matches = glob.glob(os.path.join(directory, f"*-{target_digest.removeprefix('sha256:')}.prov.json"))
        if len(matches) != 1:
            raise KeyError(target_digest)
        with open(matches[0], encoding="utf-8") as fh:
            graph = provjson.loads(fh.read())
        snapshot = EvidenceSnapshot.from_dict((graph.meta or {}).get("snapshot") or {})
        if snapshot.thread_id != thread_id or snapshot.digest != target_digest:
            raise ValueError("immutable snapshot identity mismatch")
        return graph, snapshot

    def audit(
        self, thread_id: str, *, target_digest: str, level: str = "L0",
        trigger: str = "manual", threshold: float = 0.7,
    ) -> dict:
        graph, snapshot = self.snapshot_graph(thread_id, target_digest)
        if trigger == "auto":
            existing = next((
                run for run in self.audit_runs(thread_id)
                if run.get("target_digest") == target_digest and run.get("trigger") == trigger and
                run.get("threshold") == threshold
            ), None)
            if existing is not None:
                self._record_audit_events(existing)
                return existing
        run = _audit.run_audit(
            graph, threshold=threshold, trigger=trigger, level=level,
            run_id=f"audit:{uuid.uuid4().hex[:12]}", target_digest=snapshot.digest,
        )
        runs = [run, *self.audit_runs(thread_id)]
        self._audit_runs[thread_id] = runs[:50]
        self._persist_audit(thread_id)
        self._record_audit_events(run)
        return run

    def _record_audit_events(self, run: dict[str, Any]) -> None:
        completed = self._event_store.append(
            "AuditCompleted",
            aggregate_type="AuditRun",
            aggregate_id=str(run["id"]),
            idempotency_key=str(run["id"]),
            occurred_at=run.get("completed_at"),
            payload={
                "threadId": run.get("thread_id"),
                "auditRunId": run.get("id"),
                "targetDigest": run.get("target_digest"),
                "level": run.get("level"),
                "trigger": run.get("trigger"),
                "status": run.get("status"),
                "startedAt": run.get("started_at"),
                "completedAt": run.get("completed_at"),
                "findingCount": len(run.get("findings") or []),
            },
        )
        for finding in run.get("findings") or []:
            fingerprint = str(finding.get("fingerprint") or finding.get("id") or "")
            if not fingerprint:
                continue
            self._event_store.append(
                "FindingOpened",
                aggregate_type="AuditFinding",
                aggregate_id=fingerprint,
                idempotency_key=f"{run.get('target_digest')}|{fingerprint}",
                occurred_at=run.get("completed_at"),
                causation_id=completed["eventId"],
                payload={
                    "threadId": run.get("thread_id"),
                    "auditRunId": run.get("id"),
                    "targetDigest": run.get("target_digest"),
                    "findingId": finding.get("id"),
                    "fingerprint": fingerprint,
                    "targetId": finding.get("target_id"),
                    "findingType": finding.get("finding_type"),
                    "severity": finding.get("severity"),
                    "status": finding.get("status"),
                },
            )

    def audit_runs(self, thread_id: str) -> list[dict]:
        if thread_id in self._audit_runs:
            return self._mark_audit_staleness(thread_id, self._audit_runs[thread_id])
        path = self._audit_path(thread_id)
        runs: list[dict] = []
        if path and os.path.exists(path):
            with open(path, encoding="utf-8") as fh:
                doc = json.load(fh)
            runs = doc.get("runs") or []
        self._audit_runs[thread_id] = runs
        return self._mark_audit_staleness(thread_id, runs)

    def _mark_audit_staleness(self, thread_id: str, runs: list[dict]) -> list[dict]:
        snapshot = self.latest_snapshot(thread_id)
        current = snapshot.digest if snapshot else None
        return [{**run, "stale": run.get("target_digest") != current} for run in runs]

    def export_prov_json(self, thread_id: str) -> dict:
        return provjson.to_prov_json(self.require(thread_id))

    # --- atomic persistence -----------------------------------------------
    def _commit_snapshot(self, graph: ThreadGraph, snapshot: EvidenceSnapshot) -> None:
        latest_path = self._path(graph.thread_id)
        if not latest_path:
            return
        snapshot_dir = self._snapshot_dir(graph.thread_id)
        assert snapshot_dir is not None
        os.makedirs(snapshot_dir, exist_ok=True)
        content = provjson.dumps(graph)
        immutable_path = os.path.join(
            snapshot_dir, f"{snapshot.version:08d}-{snapshot.digest[7:]}.prov.json",
        )
        if os.path.exists(immutable_path):
            with open(immutable_path, encoding="utf-8") as fh:
                if fh.read() != content:
                    raise RuntimeError("immutable Evidence Snapshot collision")
        else:
            self._atomic_write(immutable_path, content)
        self._atomic_write(latest_path, content)

    @staticmethod
    def _atomic_write(path: str, content: str) -> None:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = f"{path}.{uuid.uuid4().hex}.tmp"
        try:
            with open(tmp, "x", encoding="utf-8") as fh:
                fh.write(content)
                fh.flush()
                os.fsync(fh.fileno())
            os.replace(tmp, path)
        finally:
            if os.path.exists(tmp):
                os.unlink(tmp)

    def _persist_update_status(self, thread_id: str) -> None:
        path = self._update_path(thread_id)
        if path and thread_id in self._updates:
            self._atomic_write(path, json.dumps(self._updates[thread_id], ensure_ascii=False, indent=2))

    def _load_update_status(self, thread_id: str) -> Optional[dict[str, Any]]:
        path = self._update_path(thread_id)
        if not path or not os.path.exists(path):
            return None
        with open(path, encoding="utf-8") as fh:
            status = json.load(fh)
        if status.get("state") == "updating":
            status = {**status, "state": "error", "error": {
                "type": "InterruptedUpdate", "message": "worker restarted during update; retry through /updates",
            }}
            self._updates[thread_id] = status
            self._persist_update_status(thread_id)
        return status

    def _persist_audit(self, thread_id: str) -> None:
        path = self._audit_path(thread_id)
        if path:
            self._atomic_write(path, json.dumps({
                "threadId": thread_id, "runs": self._audit_runs.get(thread_id, []),
            }, ensure_ascii=False, indent=2))

    @staticmethod
    def _now_iso() -> str:
        return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
